import type { WordReplacerRule } from '@/store'
import { getWordReplacerSearchVariants, getWordReplacerStrongsSearch } from '@/lib/wordReplacer'
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
}

export interface ScriptureSearchOptions {
  textId: string | 'all'
  wordMode: WordMode
  /** Restrict to these books (ids). */
  bookIds?: string[]
  wordReplacerEnabled: boolean
  wordReplacerRules: WordReplacerRule[]
}

export const SEARCHABLE_TEXT_IDS = TRANSLATIONS.map((t) => t.id)

const key = (r: { book_id: string; chapter: number; verse_num: number }) => `${r.book_id}:${r.chapter}:${r.verse_num}`

export async function runRawScriptureSearch(trimmed: string, tid: string | 'all', wordMode: WordMode, variants: string[], bookIds: string[] | undefined): Promise<ScriptureHit[]> {
  const targets = tid === 'all' ? SEARCHABLE_TEXT_IDS : [tid]
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

/** Full-text search with the desktop's expansions. */
export async function runScriptureSearch(query: string, o: ScriptureSearchOptions): Promise<ScriptureHit[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const variants = o.wordReplacerEnabled ? getWordReplacerSearchVariants(trimmed, o.wordReplacerRules) : [trimmed]
  const raw = await runRawScriptureSearch(trimmed, o.textId, o.wordMode, variants, o.bookIds)
  const bridge = (o.wordReplacerEnabled && o.textId === 'kjva' && o.wordMode !== 'phrase') ? getWordReplacerStrongsSearch(trimmed, o.wordReplacerRules) : null
  if (bridge) {
    try {
      const hits = await searchAnyStrongs(bridge.strongsNums, bridge.residualWords, window.lexicon.getOccurrences)
      const seen = new Set(raw.map(key))
      const scope = o.bookIds ? new Set(o.bookIds) : null
      for (const h of hits) {
        const k = key(h)
        const existing = raw.find((r) => key(r) === k)
        if (existing) { existing.strongsWords = h.matchWordIndices; continue }
        if (seen.has(k)) continue
        if (scope && !scope.has(h.book_id)) continue
        raw.push({ book_id: h.book_id, chapter: h.chapter, verse_num: h.verse_num, text: h.text, textId: 'kjva', strongsWords: h.matchWordIndices })
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
  return found.map((o) => ({ book_id: o.book_id, chapter: o.chapter, verse_num: o.verse_num, text: o.text, textId: 'kjva', strongsWords: o.matchWordIndices }))
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
