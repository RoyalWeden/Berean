import type { WordReplacerRule } from '@/store'
import { getWordReplacerSearchVariants, getWordReplacerStrongsSearch, type WordReplacerStrongsSearch } from '@/lib/wordReplacer'
import { parseMultiStrongsQuery, searchMultiStrongs, searchAnyStrongs } from '@/lib/strongsSearch'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { bookOrder } from '@/lib/parseRef'
import type { WordMode } from '@/lib/scriptureHighlight'
import type { VerseTagMember } from '@/types'

/**
 * The scripture full-text search algorithm as a plain function — the same steps
 * ScriptureSearchView.runSearch performs (word-replacer variants run as separate queries and
 * merged, phrase-mode exact post-filter, testament/book scoping pushed into the query, the
 * word-replacer → Strong's bridge for KJVA, and Strong's-number queries via the lexicon
 * occurrence data), so the phone's SearchPage gets identical results.
 */
export interface ScriptureHit {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  text_tagged?: string
  textId: string
  /** Word indices (verse.text.split(' ')) that matched a Strong's query / replacer bridge. */
  strongsWords?: number[]
  /** Replacer bridge hit: the restored word to show at `strongsWords` (displayHitText). */
  wrReplacement?: string
}

export interface ScriptureSearchOptions {
  textId: string | 'all'
  wordMode: WordMode
  /** Restrict to these books (ids). */
  bookIds?: string[]
  wordReplacerEnabled: boolean
  wordReplacerRules: WordReplacerRule[]
  /** Override which texts 'all' searches (defaults to SEARCHABLE_TEXT_IDS). SearchTab's own
   *  "all texts" list is a curated subset; pass it here rather than duplicating this
   *  function's target-list/bridge logic for a different text set. */
  targets?: string[]
}

/** Texts an "all texts" search covers: every bundled edition except `hermas_taylor`, which is a
 *  second translation of the same book (the reader picks Hermas's translation by setting; searching
 *  both would double every Hermas hit). Shared by the desktop search view and the phone. */
export const SEARCHABLE_TEXT_IDS = TRANSLATIONS.map((t) => t.id).filter((id) => id !== 'hermas_taylor')

/** Texts whose verses.text_tagged carries Strong's numbers — the only texts the
 *  word-replacer → Strong's bridge (below) can search by occurrence. See
 *  lexiconService.ts's getOccurrences: H-numbers only ever scan 'kjva'; G-numbers scan
 *  both 'kjva' and 'lxx'. */
export const STRONGS_TAGGED_TEXT_IDS = new Set(['kjva', 'lxx'])

/** Best-effort literal KJV renderings for word-replacer rules that are Strong's-number-only
 *  (empty `queries`, e.g. the divine-name rules in store/index.ts) — used ONLY to build an
 *  extra PHRASE-mode search variant ("Yehovah said" → also try "LORD said" as one coherent
 *  phrase). Not exhaustive (H3068 also appears inside combinations like "GOD" within "Lord
 *  GOD") — the exact, non-phrase bridge below (occurrence-based) is what actually guarantees
 *  correctness; this is just so a common phrase search isn't silently empty in phrase mode,
 *  where the occurrence bridge's own results still get phrase-filtered out anyway. */
const STRONGS_RULE_LITERALS: Record<string, string[]> = {
  H3068: ['LORD'],
  H3069: ['GOD'],
  H3050: ['JAH', 'YAH'],
}

const key = (r: { book_id: string; chapter: number; verse_num: number }, textId?: string) =>
  textId != null ? `${textId}:${r.book_id}:${r.chapter}:${r.verse_num}` : `${r.book_id}:${r.chapter}:${r.verse_num}`

/**
 * ONE expansion function for the bidirectional word-replacer search + its Strong's bridge —
 * shared by runScriptureSearch below (desktop Advanced Search, the floating quick search, and
 * SearchTab all route through it) instead of each call site re-deriving its own variant list
 * and bridge. `variants` are complete, independent query strings to run and merge (never a
 * single "term1 OR term2" string — see getWordReplacerSearchVariants's own comment for why).
 * `strongsBridge`, when non-null, names the Strong's number(s)/residual words to search by
 * occurrence instead (a query like "yehovah" restores from H3068/H3069, which plain FTS can
 * never find since the index still says "LORD").
 */
export function expandScriptureQuery(
  query: string,
  rules: WordReplacerRule[],
  wordMode: WordMode,
): { variants: string[]; strongsBridge: WordReplacerStrongsSearch | null } {
  const trimmed = query.trim()
  if (!trimmed) return { variants: [query], strongsBridge: null }

  const variants = new Set(getWordReplacerSearchVariants(trimmed, rules))
  const strongsBridge = getWordReplacerStrongsSearch(trimmed, rules)

  // Phrase mode: try substituting the literal KJV rendering too, so "Yehovah said" also
  // runs as the plain phrase "LORD said" — the exact bridge below still runs separately
  // and is unioned in, this is just an extra, cheaper variant for the common case.
  if (wordMode === 'phrase' && strongsBridge) {
    for (const rule of rules) {
      if (!rule.enabled || !rule.strongsNum) continue
      if (!strongsBridge.strongsNums.includes(rule.strongsNum)) continue
      const literals = STRONGS_RULE_LITERALS[rule.strongsNum]
      if (!literals) continue
      const pattern = rule.replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(pattern, 'i').test(trimmed)) continue
      for (const lit of literals) {
        variants.add(trimmed.replace(new RegExp(pattern, 'ig'), lit))
      }
    }
  }

  return { variants: [...variants], strongsBridge }
}

export async function runRawScriptureSearch(
  trimmed: string,
  tid: string | 'all',
  wordMode: WordMode,
  variants: string[],
  bookIds: string[] | undefined,
  /** Override which texts 'all' searches — SearchTab's own "all texts" list is a curated
   *  subset of SEARCHABLE_TEXT_IDS (no `hermas_taylor` alongside `hermas`, same idea). Ignored
   *  when `tid` isn't 'all'. */
  targetsOverride?: string[],
): Promise<ScriptureHit[]> {
  const targets = tid === 'all' ? (targetsOverride ?? SEARCHABLE_TEXT_IDS) : [tid]
  const seen = new Set<string>()
  let raw: ScriptureHit[] = []
  for (const textId of targets) {
    for (const variant of variants) {
      let res: Array<{ book_id: string; chapter: number; verse_num: number; text: string; text_tagged?: string }>
      try { res = (await window.bible.searchText(variant, textId, wordMode, bookIds)) as unknown as typeof res } catch { continue }
      for (const r of res) {
        const k = `${textId}|${key(r)}`
        if (seen.has(k)) continue
        seen.add(k)
        raw.push({ ...r, textId })
      }
    }
  }
  if (wordMode === 'phrase') {
    // Exact-phrase post-filter, punctuation-insensitive, checked against every variant.
    const strip = (s: string) => s.toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim()
    const phrases = variants.map(strip)
    raw = raw.filter((r) => { const t = strip(r.text); return phrases.some((p) => t.includes(p)) })
  }
  return raw
}

/** Full-text search with the desktop's expansions — variant generation, the Strong's bridge,
 *  phrase-mode post-filtering — ALL live here so the Advanced Scripture Search tab, the
 *  floating quick search, and the plain Search tab share one algorithm instead of each
 *  re-implementing it (see expandScriptureQuery above). */
export async function runScriptureSearch(query: string, o: ScriptureSearchOptions): Promise<ScriptureHit[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const { variants, strongsBridge } = o.wordReplacerEnabled
    ? expandScriptureQuery(trimmed, o.wordReplacerRules, o.wordMode)
    : { variants: [trimmed], strongsBridge: null }
  const targets = o.textId === 'all' ? (o.targets ?? SEARCHABLE_TEXT_IDS) : [o.textId]
  const raw = await runRawScriptureSearch(trimmed, o.textId, o.wordMode, variants, o.bookIds, targets)
  // Strong's-tagged texts actually in scope for this search — the bridge can only ever find
  // hits in 'kjva'/'lxx' occurrence data (STRONGS_TAGGED_TEXT_IDS), so skip it entirely when
  // neither is among the texts being searched (e.g. a single-text search on 'enoch').
  const bridgeTargets = targets.filter((t) => STRONGS_TAGGED_TEXT_IDS.has(t))
  if (o.wordReplacerEnabled && strongsBridge && bridgeTargets.length > 0) {
    try {
      let hits = await searchAnyStrongs(strongsBridge.strongsNums, strongsBridge.residualWords, window.lexicon.getOccurrences)
      if (o.wordMode === 'phrase') {
        // The bridge finds by OCCURRENCE, not FTS, so it never went through
        // runRawScriptureSearch's own exact-phrase post-filter above — apply the same check
        // here, against every variant (including expandScriptureQuery's literal-rendering
        // phrase substitution), punctuation-insensitive.
        const strip = (s: string) => s.toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim()
        const phrases = variants.map(strip)
        hits = hits.filter((h) => { const t = strip(h.text); return phrases.some((p) => t.includes(p)) })
      }
      const bridgeTargetSet = new Set(bridgeTargets)
      const seen = new Set(raw.map((r) => key(r, r.textId)))
      const scope = o.bookIds ? new Set(o.bookIds) : null
      for (const h of hits) {
        if (!bridgeTargetSet.has(h.text_id)) continue
        const k = key(h, h.text_id)
        const existing = raw.find((r) => r.textId === h.text_id && key(r) === key(h))
        if (existing) { existing.strongsWords = h.matchWordIndices; if (!existing.text_tagged) { if (h.text_tagged) existing.text_tagged = h.text_tagged; else existing.wrReplacement = strongsBridge.replacement } continue }
        if (seen.has(k)) continue
        if (scope && !scope.has(h.book_id)) continue
        // Tagged text when the occurrence row has it (the reader's own Strong's-number display);
        // otherwise the restored word goes back at the matched positions (displayHitText).
        raw.push({ book_id: h.book_id, chapter: h.chapter, verse_num: h.verse_num, text: h.text, textId: h.text_id, strongsWords: h.matchWordIndices,
          ...(h.text_tagged ? { text_tagged: h.text_tagged } : { wrReplacement: strongsBridge.replacement }) })
      }
    } catch { /* best-effort — FTS results still stand */ }
  }
  return raw
}

/** Strong's-number query ("G5485", "H7225 H430", "G5485 jacob") → verses carrying the number(s). */
export async function runStrongsSearch(query: string): Promise<ScriptureHit[] | null> {
  const parsed = parseMultiStrongsQuery(query)
  if (!parsed) return null
  const found = await searchMultiStrongs(parsed, window.lexicon.getOccurrences)
  return found.map((o) => ({ book_id: o.book_id, chapter: o.chapter, verse_num: o.verse_num, text: o.text, textId: o.text_id ?? 'kjva', strongsWords: o.matchWordIndices, ...(o.text_tagged ? { text_tagged: o.text_tagged } : {}) }))
}

// ── Verse-tag filter ──────────────────────────────────────────────────────────
// The same narrowing ScriptureSearchView applies (its `passesTagFilter`): a hit survives when
// the verse — or its whole chapter — belongs to a selected tag; with `matchAll` every selected
// tag must contain it (AND), otherwise any one (OR). Keys are translation-agnostic, so a tag
// placed while reading the LXX still narrows KJV results.

export type VerseTagFilter = (bookId: string, chapter: number, verse: number) => boolean

export function buildVerseTagFilter(members: VerseTagMember[], tagIds: string[], matchAll: boolean): VerseTagFilter {
  if (tagIds.length === 0) return () => true
  const perTag = new Map<string, { verses: Set<string>; chapters: Set<string> }>()
  for (const id of tagIds) perTag.set(id, { verses: new Set(), chapters: new Set() })
  for (const m of members) {
    const e = perTag.get(m.tagId)
    if (!e) continue
    for (const v of m.verses) e.verses.add(`${v.bookId}:${v.chapter}:${v.verse}`)
    for (const c of m.wholeChapters) e.chapters.add(`${c.bookId}:${c.chapter}`)
  }
  const entries = [...perTag.values()]
  return (bookId, chapter, verse) => {
    const vKey = `${bookId}:${chapter}:${verse}`
    const cKey = `${bookId}:${chapter}`
    const hit = (e: { verses: Set<string>; chapters: Set<string> }) => e.verses.has(vKey) || e.chapters.has(cKey)
    return matchAll ? entries.every(hit) : entries.some(hit)
  }
}

/** Hits restricted to the selected verse tags (no-op for an empty selection). */
export function filterHitsByVerseTags(hits: ScriptureHit[], members: VerseTagMember[], tagIds: string[], matchAll: boolean): ScriptureHit[] {
  if (tagIds.length === 0) return hits
  const passes = buildVerseTagFilter(members, tagIds, matchAll)
  return hits.filter((h) => passes(h.book_id, h.chapter, h.verse_num))
}

// ── Grouping + sort ───────────────────────────────────────────────────────────

/** Desktop's two sort modes: FTS rank ("best match first") or canonical book order. */
export type SearchSortMode = 'relevance' | 'bookOrder'
export type SearchSortDirection = 'asc' | 'desc'
export interface GroupHitsOptions {
  sort?: SearchSortMode
  /** Relevance reads best-first as 'desc'; book order reads Genesis→Revelation as 'asc' —
   *  the other value reverses both the group order and the verses inside each group,
   *  exactly as ScriptureSearchView's sortDirection does. */
  direction?: SearchSortDirection
}

export interface HitGroup { bookId: string; hits: ScriptureHit[] }

/**
 * Group hits by book. Without options: groups in order of first appearance, verses in
 * chapter/verse order (the original phone presentation). With `sort`:
 *  - 'relevance' — groups in order of first appearance, verses kept in FTS rank order;
 *  - 'bookOrder' — groups in canonical order, verses in chapter/verse order.
 */
export function groupHitsByBook(hits: ScriptureHit[], options?: GroupHitsOptions): HitGroup[] {
  const groups = new Map<string, ScriptureHit[]>()
  for (const h of hits) { const arr = groups.get(h.book_id) ?? []; arr.push(h); groups.set(h.book_id, arr) }
  const byVerse = (a: ScriptureHit, b: ScriptureHit) => a.chapter - b.chapter || a.verse_num - b.verse_num
  const sort = options?.sort
  let out: HitGroup[] = [...groups.entries()].map(([bookId, hs]) => ({ bookId, hits: sort === 'relevance' ? hs : [...hs].sort(byVerse) }))
  if (sort === 'bookOrder') out.sort((a, b) => bookOrder(a.bookId) - bookOrder(b.bookId))
  const reversed = (sort === 'relevance' && options?.direction === 'asc') || (sort === 'bookOrder' && options?.direction === 'desc')
  if (reversed) out = out.reverse().map((g) => ({ bookId: g.bookId, hits: [...g.hits].reverse() }))
  return out
}

/**
 * The first `limit` rows of a grouped result list, keeping the groups intact — the phone
 * renders long result sets incrementally (a chunk at a time as the user scrolls) so a
 * several-thousand-hit search never mounts every row at once. `total` is the full hit count.
 */
export function takeGroupRows(groups: HitGroup[], limit: number): { groups: HitGroup[]; shown: number; total: number } {
  const total = groups.reduce((n, g) => n + g.hits.length, 0)
  const out: HitGroup[] = []
  let shown = 0
  for (const g of groups) {
    if (shown >= limit) break
    const room = limit - shown
    const hits = g.hits.length <= room ? g.hits : g.hits.slice(0, room)
    out.push({ bookId: g.bookId, hits })
    shown += hits.length
  }
  return { groups: out, shown, total }
}
