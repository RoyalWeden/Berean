/**
 * Shared YouTube search helpers used by the in-tab search box, the floating search,
 * and the transcript FTS query. Pure + unit-tested so behavior is consistent everywhere.
 */

export type SearchScope = 'title' | 'transcript' | 'both'

export interface SearchableVideo {
  videoId: string
  title: string
  channelName: string
  channelHandle: string
}

/** Case-insensitive substring match against title / channel name / channel handle. */
export function matchesTitle(v: SearchableVideo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    v.title.toLowerCase().includes(q) ||
    v.channelName.toLowerCase().includes(q) ||
    v.channelHandle.toLowerCase().includes(q)
  )
}

/**
 * Filter a list of videos by query + scope.
 * `transcriptMatchIds` is the set of videoIds whose transcript matched (resolved separately
 * via FTS, since transcript text isn't held in memory). For scope 'title' it's ignored.
 */
export function filterVideosBySearch<V extends SearchableVideo>(
  videos: V[],
  query: string,
  scope: SearchScope,
  transcriptMatchIds: Set<string>,
): V[] {
  const q = query.trim()
  if (!q) return videos
  return videos.filter((v) => {
    const titleHit = matchesTitle(v, q)
    const transcriptHit = transcriptMatchIds.has(v.videoId)
    if (scope === 'title') return titleHit
    if (scope === 'transcript') return transcriptHit
    return titleHit || transcriptHit // 'both'
  })
}

/**
 * Build a safe FTS5 MATCH expression from a free-text query.
 * - Tokenizes on Unicode letters/numbers (drops punctuation that would break FTS5 syntax).
 * - Each token becomes a prefix term (`token*`) so search-as-you-type works.
 * - Tokens are space-separated → FTS5 ANDs them.
 * Returns '' when there is nothing searchable (caller should skip the query).
 */
export function buildFtsMatch(query: string): string {
  const tokens = query.trim().toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (tokens.length === 0) return ''
  return tokens.map((t) => `${t}*`).join(' ')
}

// ── Relevance ranking ──────────────────────────────────────────────────────────

/** Per-video transcript-match info, supplied by the FTS search (bm25 rank + snippet). */
export interface TranscriptMatchInfo {
  rank: number       // bm25: more negative = stronger match
  matchCount: number // how many segments matched
}

/**
 * Title relevance score (higher = better). Tiers, in descending weight:
 *  exact title  > title starts-with  > whole-word in title  > substring in title
 *  > whole-word in channel  > substring in channel.
 */
export function titleScore(v: SearchableVideo, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const title = v.title.toLowerCase()
  const channel = `${v.channelName} ${v.channelHandle}`.toLowerCase()
  const wordRe = new RegExp(`(^|\\W)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`)

  if (title === q) return 1000
  if (title.startsWith(q)) return 600
  if (wordRe.test(title)) return 400
  if (title.includes(q)) return 250
  if (wordRe.test(channel)) return 150
  if (channel.includes(q)) return 100
  return 0
}

/**
 * Convert a bm25 rank (negative; more negative = better) + match count into a positive
 * transcript relevance score, normalized to a comparable range with title scores.
 */
export function transcriptScore(info: TranscriptMatchInfo | undefined): number {
  if (!info) return 0
  // bm25 is typically in roughly [-10, 0]; flip sign so stronger matches score higher,
  // scale to be in the same ballpark as title tiers, and add a small boost per extra hit.
  const base = Math.max(0, -info.rank) * 30
  const freqBoost = Math.min(info.matchCount - 1, 20) * 5
  return base + freqBoost
}

/**
 * Rank videos by combined relevance for the active query + scope. Returns a NEW array.
 * - scope 'title': order by title score only.
 * - scope 'transcript': order by transcript score only.
 * - scope 'both': sum of title + transcript scores (a video hitting both ranks highest).
 * Ties break by published date (newer first) when available.
 */
export function rankVideosBySearch<V extends SearchableVideo & { published?: string }>(
  videos: V[],
  query: string,
  scope: SearchScope,
  transcriptInfo: Map<string, TranscriptMatchInfo>,
): V[] {
  const q = query.trim()
  if (!q) return videos
  const scoreOf = (v: V): number => {
    const t = scope === 'transcript' ? 0 : titleScore(v, q)
    const tr = scope === 'title' ? 0 : transcriptScore(transcriptInfo.get(v.videoId))
    return t + tr
  }
  return [...videos].sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a)
    if (d !== 0) return d
    // Tiebreak: newer first
    return (b.published ?? '').localeCompare(a.published ?? '')
  })
}

// ── HTML entity decoding ─────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  '#39': "'", '#34': '"', '#38': '&', '#60': '<', '#62': '>',
}

/**
 * Decode HTML entities in transcript text (tactiq stores caption text with entities
 * like `&quot;` and sometimes double-encoded `&amp;quot;`). Runs a couple of passes so
 * double-encoded sequences fully resolve. Pure + testable; no DOM dependency.
 */
export function decodeEntities(text: string): string {
  if (!text || text.indexOf('&') === -1) return text
  const decodeOnce = (s: string) =>
    s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+\d*);/g, (whole, body: string) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      const named = NAMED_ENTITIES[body.toLowerCase()]
      return named ?? whole
    })
  let out = decodeOnce(text)
  if (out.indexOf('&') !== -1) out = decodeOnce(out) // resolve double-encoding
  return out
}

// ── Snippet highlighting ─────────────────────────────────────────────────────────

export interface SnippetPart {
  text: string
  match: boolean
}

/**
 * Split a transcript snippet into highlighted + plain parts for the query terms, and
 * truncate it to a window centered on the first match so long lines show the relevant bit.
 * Returns ordered parts the UI can render (matched parts get emphasis).
 */
export function highlightSnippet(rawSnippet: string, query: string, maxLen = 140): SnippetPart[] {
  const snippet = decodeEntities(rawSnippet)
  const tokens = [...new Set(query.trim().toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
  if (tokens.length === 0 || !snippet) return [{ text: snippet, match: false }]

  // Find the first match position to center the truncation window.
  const lower = snippet.toLowerCase()
  let firstAt = -1
  for (const t of tokens) {
    const i = lower.indexOf(t)
    if (i >= 0 && (firstAt < 0 || i < firstAt)) firstAt = i
  }

  let text = snippet
  let prefixEllipsis = false
  if (snippet.length > maxLen && firstAt >= 0) {
    const start = Math.max(0, firstAt - Math.floor(maxLen / 3))
    const end = Math.min(snippet.length, start + maxLen)
    text = snippet.slice(start, end)
    prefixEllipsis = start > 0
    if (end < snippet.length) text += '…'
    if (prefixEllipsis) text = `…${text}`
  } else if (snippet.length > maxLen) {
    text = `${snippet.slice(0, maxLen)}…`
  }

  // Build a single regex of all tokens (prefix-style: token matches token-prefixed words too).
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts: SnippetPart[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false })
    parts.push({ text: m[0], match: true })
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++ // avoid zero-width loops
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false })
  return parts
}
