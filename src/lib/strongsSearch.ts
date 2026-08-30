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

export interface MultiStrongsQuery {
  strongsNums: string[]
  words: string[]
}

/** Parses a query that may combine one or more Strong's numbers with plain words —
 *  "G5485 G54" (two Strong's numbers, AND'd) or "G5485 jacob" (a Strong's number AND
 *  a plain word) — all space-separated tokens ANDed together. Returns null if the
 *  query contains no Strong's-number token at all, so callers fall back to a plain
 *  text/crossref search instead. A single bare Strong's number ("G5485") still
 *  parses fine here too (strongsNums: ["G5485"], words: []) — this is a superset of
 *  the single-number case `isStrongsQuery`/`parseStrongsQuery` already handled. */
export function parseMultiStrongsQuery(q: string): MultiStrongsQuery | null {
  const tokens = q.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const strongsNums: string[] = []
  const words: string[] = []
  for (const t of tokens) {
    const num = parseStrongsQuery(t)
    if (num) strongsNums.push(num)
    else words.push(t)
  }
  if (strongsNums.length === 0) return null
  return { strongsNums, words }
}

interface StrongsOccurrenceRow {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  matchWordIndices?: number[]
}

export interface MultiStrongsResult {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  matchWordIndices: number[]
}

/** Finds every verse matching ALL of a parsed multi-Strong's query's numbers (AND, not
 *  OR — a verse must carry every listed Strong's number) plus, if present, every plain
 *  word (case-insensitive substring match against the verse text). Highlight indices
 *  from every matched Strong's number are unioned per verse. Shared between the
 *  Advanced Scripture Search tab and the floating quick search so "G5485 G54" and
 *  "G5485 jacob" behave identically in both places. */
export async function searchMultiStrongs(
  parsed: MultiStrongsQuery,
  getOccurrences: (strongsNum: string) => Promise<StrongsOccurrenceRow[]>,
): Promise<MultiStrongsResult[]> {
  const occLists = await Promise.all(parsed.strongsNums.map((n) => getOccurrences(n)))
  const perVerse = new Map<string, { row: StrongsOccurrenceRow; indices: Set<number>; count: number }>()
  for (const list of occLists) {
    // A single occurrence list should already be one row per verse, but guard against
    // duplicates so a verse carrying the same Strong's number on two words doesn't
    // inflate `count` past `parsed.strongsNums.length` and get excluded below.
    const seenInThisList = new Set<string>()
    for (const o of list) {
      const key = `${o.book_id}:${o.chapter}:${o.verse_num}`
      if (seenInThisList.has(key)) continue
      seenInThisList.add(key)
      let entry = perVerse.get(key)
      if (!entry) { entry = { row: o, indices: new Set(), count: 0 }; perVerse.set(key, entry) }
      entry.count++
      for (const idx of o.matchWordIndices ?? []) entry.indices.add(idx)
    }
  }
  let matched = [...perVerse.values()].filter((e) => e.count === parsed.strongsNums.length)
  if (parsed.words.length > 0) {
    const lowerWords = parsed.words.map((w) => w.toLowerCase())
    matched = matched.filter((e) => {
      const lt = e.row.text.toLowerCase()
      return lowerWords.every((w) => lt.includes(w))
    })
  }
  return matched.map((e) => ({
    book_id: e.row.book_id,
    chapter: e.row.chapter,
    verse_num: e.row.verse_num,
    text: e.row.text,
    matchWordIndices: [...e.indices],
  }))
}

/** Like `searchMultiStrongs` but OR across the Strong's numbers (a verse carrying ANY of them
 *  is a hit) rather than AND. Used by the word-replacer bridge: "yehovah" restores from
 *  H3068 OR H3069, so both occurrence sets are unioned. `words` (if any) are still AND'd
 *  against each hit's verse text, case-insensitively. Highlight indices from every matched
 *  number are unioned per verse. */
export async function searchAnyStrongs(
  strongsNums: string[],
  words: string[],
  getOccurrences: (strongsNum: string) => Promise<StrongsOccurrenceRow[]>,
): Promise<MultiStrongsResult[]> {
  const lists = await Promise.all(strongsNums.map((n) => getOccurrences(n)))
  const perVerse = new Map<string, { row: StrongsOccurrenceRow; indices: Set<number> }>()
  for (const list of lists) {
    for (const o of list) {
      const key = `${o.book_id}:${o.chapter}:${o.verse_num}`
      let entry = perVerse.get(key)
      if (!entry) { entry = { row: o, indices: new Set() }; perVerse.set(key, entry) }
      for (const idx of o.matchWordIndices ?? []) entry.indices.add(idx)
    }
  }
  let matched = [...perVerse.values()]
  if (words.length > 0) {
    const lowerWords = words.map((w) => w.toLowerCase())
    matched = matched.filter((e) => {
      const lt = e.row.text.toLowerCase()
      return lowerWords.every((w) => lt.includes(w))
    })
  }
  return matched.map((e) => ({
    book_id: e.row.book_id,
    chapter: e.row.chapter,
    verse_num: e.row.verse_num,
    text: e.row.text,
    matchWordIndices: [...e.indices],
  }))
}

export interface StrongsHighlightSegment {
  text: string
  /** True when this word carries the searched Strong's number and should be highlighted. */
  match: boolean
}

/**
 * Split a verse into space-delimited words, flagging the ones at `matchWordIndices` AND,
 * if given, any word (by text, punctuation-stripped, case-insensitive) in `extraWords` —
 * the plain-word part of a combined query like "G5485 god" ANDed together, see
 * parseMultiStrongsQuery. Without `extraWords` this behaves exactly as before (Strong's-
 * indexed words only). Joining the segment texts with single spaces reproduces the input
 * (modulo runs of whitespace, which the source verses don't contain).
 */
export function splitStrongsHighlight(text: string, matchWordIndices: number[], extraWords: string[] = []): StrongsHighlightSegment[] {
  const set = new Set(matchWordIndices)
  const lowerExtra = extraWords.map((w) => w.toLowerCase())
  return text.split(' ').map((w, i) => {
    const strippedLower = w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toLowerCase()
    const match = set.has(i) || (strippedLower.length > 0 && lowerExtra.includes(strippedLower))
    return { text: w, match }
  })
}
