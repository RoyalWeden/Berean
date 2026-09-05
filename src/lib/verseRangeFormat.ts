import { parseRef } from './parseRef'

/**
 * Collapses a set of selected verse numbers into the compact range notation parseRef.ts already
 * knows how to read back ("1-2,5,8-10") — built for the verse-tie picker (a two-chapter window
 * where clicking verse numbers builds up a selection), so a click-driven multi-select turns into
 * the same portable reference string format the rest of the app already produces and parses.
 */
export function formatVerseNumbersToRangeString(nums: Iterable<number>): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === end + 1) {
      end = n
      continue
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`)
    if (n !== undefined) { start = n; end = n }
  }
  return parts.join(',')
}

/** Full "Book Chapter:1-2,5,8-10" reference string — what actually gets stored as a tie, so it
 *  round-trips through parseRef() the same way any other reference in the app does. */
export function formatVerseTieReference(bookLabel: string, chapter: number, verseNums: Iterable<number>): string {
  const ranges = formatVerseNumbersToRangeString(verseNums)
  return ranges ? `${bookLabel} ${chapter}:${ranges}` : ''
}

/** Inverse of the two functions above — given an existing tie reference string (e.g.
 *  "Mark 13:1-2,5,8-10"), recover the flat list of verse numbers it names. Used to seed the
 *  verse-picker window's initial selection when reopening it on a connection that already has
 *  a tie recorded. Returns an empty array for an unparseable/empty string. */
export function parseVerseTieReferenceToNumbers(ref: string | null | undefined): number[] {
  if (!ref) return []
  const parsed = parseRef(ref)
  if (!parsed) return []
  const out = new Set<number>()
  if (parsed.verseGroups && parsed.verseGroups.length > 0) {
    for (const g of parsed.verseGroups) {
      const end = g.endVerse ?? g.verse
      for (let v = g.verse; v <= end; v++) out.add(v)
    }
  } else if (typeof parsed.verse === 'number') {
    const end = parsed.endVerse ?? parsed.verse
    for (let v = parsed.verse; v <= end; v++) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}
