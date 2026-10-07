/**
 * Pure (no Electron, no network, no DB) parts of the dev-only YouTube transcript pipeline in
 * electron/ipc/youtube.ts — caption-track selection, timedtext parsing, the tactiq "list has
 * stopped growing" check and retry eligibility for stored failure rows. Unit-tested in
 * electron/__tests__/youtubeTranscriptCore.test.ts with fixtures.
 */

export type Seg = { start_ms: number; dur_ms: number; text: string }

// ─── Text helpers ─────────────────────────────────────────────────────────────

const ENTITY_MAP: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

/** Decode HTML entities (incl. double-encoded) in caption text before storing. */
export function decodeHtmlEntities(text: string): string {
  if (!text || text.indexOf('&') === -1) return text
  const once = (s: string) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole
  })
  let out = once(text)
  if (out.indexOf('&') !== -1) out = once(out)
  return out
}

/** Collapse caption whitespace (line breaks inside a cue) to single spaces. */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** `HH:MM:SS.mmm` (tactiq) → ms. */
export function parseTsMs(ts: string): number {
  const [h, m, s] = ts.split(':')
  return Math.round((parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)) * 1000)
}

/** Fill each segment's missing duration from the next segment's start (tactiq has none). */
export function fillDurations(segs: Seg[]): Seg[] {
  for (let j = 0; j < segs.length - 1; j++) {
    if (!segs[j].dur_ms) segs[j].dur_ms = Math.max(0, segs[j + 1].start_ms - segs[j].start_ms)
  }
  return segs
}

// ─── Caption-track selection (InnerTube player response) ─────────────────────

export interface CaptionTrack {
  baseUrl: string
  languageCode: string
  /** 'asr' = YouTube's automatic speech recognition track; absent for uploaded captions. */
  kind?: string
  isTranslatable?: boolean
  name?: { simpleText?: string; runs?: Array<{ text: string }> }
  vssId?: string
}

export interface TrackChoice {
  track: CaptionTrack
  /** Set when the track must be machine-translated to English via `&tlang=en`. */
  translateTo?: 'en'
  /** Language of the text that will be stored. */
  lang: string
  /** 'manual' | 'asr' | 'translated' — recorded in youtube_transcripts.source. */
  kind: 'manual' | 'asr' | 'translated'
}

const isEnglish = (code: string) => /^en(?:[-_]|$)/i.test(code)

/** Pulls `captionTracks` out of a youtubei/v1/player response (empty when none). */
export function captionTracksFromPlayer(player: unknown): CaptionTrack[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracks = (player as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  return Array.isArray(tracks) ? tracks.filter((t) => t && typeof t.baseUrl === 'string' && typeof t.languageCode === 'string') : []
}

/**
 * Preference: manual English (plain `en` before regional `en-US`/`en-GB`…) → English ASR →
 * the first translatable track (manual before ASR) translated with `tlang=en` → the first
 * track as-is. Null when there are no tracks at all.
 */
export function selectCaptionTrack(tracks: CaptionTrack[]): TrackChoice | null {
  if (tracks.length === 0) return null
  const manual = tracks.filter((t) => t.kind !== 'asr')
  const asr = tracks.filter((t) => t.kind === 'asr')
  const enRank = (t: CaptionTrack) => (t.languageCode.toLowerCase() === 'en' ? 0 : 1)
  const byEn = (list: CaptionTrack[]) => list.filter((t) => isEnglish(t.languageCode)).sort((a, b) => enRank(a) - enRank(b))

  const manualEn = byEn(manual)[0]
  if (manualEn) return { track: manualEn, lang: manualEn.languageCode, kind: 'manual' }
  const asrEn = byEn(asr)[0]
  if (asrEn) return { track: asrEn, lang: asrEn.languageCode, kind: 'asr' }
  const translatable = [...manual, ...asr].find((t) => t.isTranslatable)
  if (translatable) return { track: translatable, translateTo: 'en', lang: 'en', kind: 'translated' }
  const first = manual[0] ?? asr[0]
  return { track: first, lang: first.languageCode, kind: first.kind === 'asr' ? 'asr' : 'manual' }
}

/** The track's timedtext URL with the requested format (and optional translation). */
export function timedTextUrl(choice: TrackChoice, fmt: 'json3' | null): string {
  const u = new URL(choice.track.baseUrl, 'https://www.youtube.com')
  if (fmt) u.searchParams.set('fmt', fmt)
  else u.searchParams.delete('fmt')
  if (choice.translateTo) u.searchParams.set('tlang', choice.translateTo)
  return u.toString()
}

// ─── Timedtext parsing ────────────────────────────────────────────────────────

/** Parse `fmt=json3` timedtext: `{ events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }`. */
export function parseJson3(body: string | unknown): Seg[] {
  let data: unknown = body
  if (typeof body === 'string') {
    try { data = JSON.parse(body) } catch { return [] }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (data as any)?.events
  if (!Array.isArray(events)) return []
  const out: Seg[] = []
  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs)) continue          // window/style events carry no segs
    const text = clean(decodeHtmlEntities(ev.segs.map((s: { utf8?: string }) => s?.utf8 ?? '').join('')))
    if (!text) continue                                    // "\n" append events in ASR tracks
    out.push({ start_ms: Math.round(Number(ev.tStartMs) || 0), dur_ms: Math.round(Number(ev.dDurationMs) || 0), text })
  }
  return fillDurations(out)
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? m[1] : null
}

/**
 * Parse XML timedtext — both the classic format (`<transcript><text start="1.2" dur="3.4">`,
 * seconds) and srv3 (`<timedtext format="3"><body><p t="1200" d="3400">`, ms, optional `<s>`
 * word children). Regex-based: main process has no DOMParser, and the formats are flat.
 */
export function parseTimedTextXml(xml: string): Seg[] {
  if (typeof xml !== 'string' || !xml) return []
  const out: Seg[] = []
  const strip = (inner: string) => clean(decodeHtmlEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')))
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = textRe.exec(xml))) {
    const start = parseFloat(attr(m[1], 'start') ?? '')
    const dur = parseFloat(attr(m[1], 'dur') ?? '0')
    const text = strip(m[2])
    if (!Number.isFinite(start) || !text) continue
    out.push({ start_ms: Math.round(start * 1000), dur_ms: Math.round((Number.isFinite(dur) ? dur : 0) * 1000), text })
  }
  if (out.length === 0) {
    const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
    while ((m = pRe.exec(xml))) {
      const t = parseInt(attr(m[1], 't') ?? '', 10)
      const d = parseInt(attr(m[1], 'd') ?? '0', 10)
      const text = strip(m[2])
      if (!Number.isFinite(t) || !text) continue
      out.push({ start_ms: t, dur_ms: Number.isFinite(d) ? d : 0, text })
    }
  }
  return fillDurations(out)
}

/** Parse a timedtext body of either format. */
export function parseTimedText(body: string): Seg[] {
  const trimmed = (body ?? '').trimStart()
  if (trimmed.startsWith('{')) return parseJson3(trimmed)
  if (trimmed.startsWith('<')) return parseTimedTextXml(trimmed)
  return []
}

// ─── tactiq stabilisation ─────────────────────────────────────────────────────

/**
 * tactiq renders the transcript list progressively; accepting the first poll with count > 0
 * stored truncated transcripts. Accept only once the row count has been identical (and > 0)
 * for `required` consecutive polls.
 */
export function createStabilityTracker(required = 3): { observe: (count: number) => boolean; last: () => number } {
  let lastCount = -1
  let streak = 0
  return {
    observe(count: number) {
      if (count > 0 && count === lastCount) streak++
      else streak = count > 0 ? 1 : 0
      lastCount = count
      return count > 0 && streak >= required
    },
    last: () => lastCount,
  }
}

// ─── Retry eligibility ────────────────────────────────────────────────────────

/** Errors that say nothing about the video itself — retried on the very next run. */
const TRANSIENT_ERROR = /\b(?:429|5\d\d|timeout|timed out|rate[- ]limit\w*|network|fetch failed|bot|abort\w*|HTTP (?!404|418)\d{3}|API (?!418)\d{3})\b/i

export function isTransientTranscriptError(error: string): boolean {
  return TRANSIENT_ERROR.test(error)
}

/** Permanent-looking failures ("no captions") are re-checked after this many days — captions
 *  (esp. ASR) can appear after upload, and tactiq's error-text regex produced false negatives. */
export const TRANSCRIPT_RETRY_DAYS = 14

export interface TranscriptRowState {
  /** null = no youtube_transcripts row yet. */
  error: string | null | undefined
  fetched_at: number | null | undefined
  segment_count: number | null | undefined
  hasRow: boolean
}

/**
 * Whether a video should be (re)fetched: never attempted; a stored success with zero segments;
 * a transient error (429 / 5xx / timeout …) — always; any other stored error once it is older
 * than `retryDays`. Returns a priority (lower = sooner) or null when not eligible.
 */
export function transcriptFetchPriority(row: TranscriptRowState, now: number, retryDays = TRANSCRIPT_RETRY_DAYS): number | null {
  if (!row.hasRow) return 0
  if (row.error == null || row.error === '') return (row.segment_count ?? 0) > 0 ? null : 1
  if (isTransientTranscriptError(row.error)) return 1
  const age = now - (row.fetched_at ?? 0)
  return age >= retryDays * 86_400_000 ? 2 : null
}
