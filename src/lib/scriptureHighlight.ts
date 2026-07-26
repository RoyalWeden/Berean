import { numberTokenAlternates } from './numberWords'

export type WordMode = 'all' | 'any' | 'phrase'

/**
 * Builds the regex alternation pattern used to highlight search-result verse text.
 * Phrase mode highlights the literal (escaped) phrase. Word modes ('all'/'any') highlight
 * only the literal searched text — no `\w*` suffix — since backend FTS5 matching via a
 * prefix wildcard (word*) means a query like "fire" can match "firebrands", but only the
 * "fire" substring the user actually typed should be visually marked, not the whole word.
 * Each word's number-form alternate (numberTokenAlternates: "7" also matches "seven", and
 * vice versa) gets its own pattern too, so a result matched via the number<->word FTS
 * expansion still gets visibly highlighted either way.
 */
export function buildHighlightPattern(query: string, wordMode: WordMode): string {
  const trimmed = query.trim()
  if (wordMode === 'phrase') {
    return trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0)
  return words
    .flatMap((w) => numberTokenAlternates(w))
    .map((w) => `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    .join('|')
}
