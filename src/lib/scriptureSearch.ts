import type { WordReplacerRule } from '@/store'
import { getWordReplacerSearchVariants, getWordReplacerStrongsSearch } from '@/lib/wordReplacer'
import { parseMultiStrongsQuery, searchMultiStrongs, searchAnyStrongs } from '@/lib/strongsSearch'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import type { WordMode } from '@/lib/scriptureHighlight'

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

/** Group hits by book in canonical order of appearance. */
export function groupHitsByBook(hits: ScriptureHit[]): Array<{ bookId: string; hits: ScriptureHit[] }> {
  const groups = new Map<string, ScriptureHit[]>()
  for (const h of hits) { const arr = groups.get(h.book_id) ?? []; arr.push(h); groups.set(h.book_id, arr) }
  return [...groups.entries()].map(([bookId, hs]) => ({ bookId, hits: hs.sort((a, b) => a.chapter - b.chapter || a.verse_num - b.verse_num) }))
}
