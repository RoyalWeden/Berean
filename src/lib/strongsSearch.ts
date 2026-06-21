/**
 * Helpers for searching scripture by Strong's number (e.g. "g5485", "h1319") and
 * highlighting the tagged words in a result verse.
 *
 * Word indices come from the lexicon `getOccurrences` IPC, which counts words the same
 * way `plainText.split(' ')` does — so highlighting splits the verse text on spaces and
 * wraps the words whose index is in `matchWordIndices`.
 */

/**
 * Normalize a Strong's-number query to canonical form, or return null if the string is
 * not a Strong's number. Accepts an optional space and leading zeros, any case:
 *   "g5485" → "G5485"   "H 1319" → "H1319"   "h0001" → "H1"   "in the beginning" → null
 */
export function parseStrongsQuery(q: string): string | null {
  const m = q.trim().match(/^([hHgG])\s?0*(\d{1,5})$/)
  if (!m) return null
  const n = m[2].replace(/^0+/, '') || '0'
  if (n === '0') return null
  return m[1].toUpperCase() + n
}

/** True if the query is a Strong's number. */
export function isStrongsQuery(q: string): boolean {
  return parseStrongsQuery(q) !== null
}

export interface StrongsHighlightSegment {
  text: string
  /** True when this word carries the searched Strong's number and should be highlighted. */
  match: boolean
}

/**
 * Split a verse into space-delimited words, flagging the ones at `matchWordIndices`.
 * Joining the segment texts with single spaces reproduces the input (modulo runs of
 * whitespace, which the source verses don't contain).
 */
export function splitStrongsHighlight(text: string, matchWordIndices: number[]): StrongsHighlightSegment[] {
  const set = new Set(matchWordIndices)
  return text.split(' ').map((w, i) => ({ text: w, match: set.has(i) }))
}
