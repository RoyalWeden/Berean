/**
 * Scripture Find — the ONE matching rule shared by every find surface (SEP26-FIND-001…004):
 * the desktop find bar, the iPhone Find on Page (whole book), ChapterView's per-row gate and
 * VerseRow's own highlight check.
 *
 * A verse matches when its RAW text or its DISPLAYED text contains the query, case-insensitively.
 * The displayed text matters: the word replacer changes what is on screen (e.g. the default rule
 * "Zacharias" → "Zechariah" in Matthew 23:35, "LORD" → "Yehovah"). Testing only the raw text is
 * what made "zechariah" stop highlighting after "ze" — "z" still matched the raw "Zacharias", but
 * "ze" matched nothing, so the row never received the query. Scripture text itself is never
 * changed; only the comparison ignores case.
 *
 * Modes: 'phrase' = the whole query as typed; 'all' = every word somewhere in the verse;
 * 'any' = at least one word.
 */
export type FindWordMode = 'phrase' | 'all' | 'any'

/** Normalised (lower-cased, trimmed) query; '' when there is nothing to find. */
export function normalizeFindQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** Everything a reader can see for a verse, lower-cased: raw text + displayed text. */
export function verseFindHaystack(rawText: string, displayText?: string | null): string {
  return (displayText && displayText !== rawText ? `${rawText}\n${displayText}` : rawText).toLowerCase()
}

/** Does a haystack (from `verseFindHaystack`) match the query in this mode? */
export function haystackMatchesFind(haystack: string, query: string, mode: FindWordMode = 'phrase'): boolean {
  const q = normalizeFindQuery(query)
  if (!q) return false
  if (mode === 'phrase') return haystack.includes(q)
  const words = q.split(/\s+/).filter(Boolean)
  return mode === 'all' ? words.every((w) => haystack.includes(w)) : words.some((w) => haystack.includes(w))
}

/** Convenience: raw + displayed text of one verse against the query. */
export function verseMatchesFind(rawText: string, displayText: string | null | undefined, query: string, mode: FindWordMode = 'phrase'): boolean {
  return haystackMatchesFind(verseFindHaystack(rawText, displayText), query, mode)
}

/** How many times the query (phrase mode) occurs in a text, case-insensitively — every
 *  occurrence counts, not just the first. */
export function countOccurrences(text: string, query: string): number {
  const q = normalizeFindQuery(query)
  if (!q) return 0
  const t = text.toLowerCase()
  let n = 0
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) n++
  return n
}
