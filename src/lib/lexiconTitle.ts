import type { LexiconEntry } from '@/types'

/**
 * Tab/history title for a lexicon entry — "G26 — ἀγάπη" rather than the bare
 * Strong's number. Falls back to the transliteration when the entry has no
 * lemma, and to the plain number when it has neither.
 */
export function lexiconTitle(entry: Pick<LexiconEntry, 'strongsNum' | 'lemma' | 'transliteration'>): string {
  const word = entry.lemma?.trim() || entry.transliteration?.trim() || ''
  return word ? `${entry.strongsNum} — ${word}` : entry.strongsNum
}

// Composed titles for entries seen this session. Lets the store's nav-stack
// pushes (openLexiconEntry / updateTabState) — which only ever receive a
// Strong's number, never a loaded entry — reuse the fuller title without
// doing their own async lookup. A miss just falls back to the number.
const titleCache = new Map<string, string>()

export function rememberLexiconTitle(entry: Pick<LexiconEntry, 'strongsNum' | 'lemma' | 'transliteration'>): string {
  const title = lexiconTitle(entry)
  titleCache.set(entry.strongsNum, title)
  return title
}

/** Cached composed title for a Strong's number, or undefined if never loaded. */
export function cachedLexiconTitle(strongsNum: string): string | undefined {
  return titleCache.get(strongsNum)
}

/** Cached composed title for a Strong's number, or the number itself if unknown. */
export function lexiconTitleFor(strongsNum: string): string {
  return titleCache.get(strongsNum) ?? strongsNum
}
