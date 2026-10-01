import { bookChapterVerseLabel } from './parseRef'
import { displayVerseText } from './scriptureText'

/** Human-readable verse reference, e.g. "Genesis 1:1", "Genesis 1:1-3", or
 *  "Recognitions of Clement, Book 5, Chapter 3:5" / "Shepherd of Hermas, Vision 2.1:2" for
 *  the multi-book/sectioned editions. This is a thin wrapper around parseRef.ts's
 *  `bookChapterVerseLabel` — the ONE canonical reference-display formatter (full book
 *  names, Recognitions of Clement's Book N addressing, Hermas's Vision/Mandate/Similitude
 *  numbering via hermasMap.ts) — so copy-verse output and the reference bar/search/tab
 *  labels never drift into two different display conventions for the same reference.
 *  `endVerse`, when greater than `verse`, renders a "verse-endVerse" range instead of a
 *  single verse number. */
export function formatVerseRef(bookId: string, chapter: number, verse: number, lxx = false, endVerse?: number): string {
  const label = bookChapterVerseLabel(bookId, chapter, verse)
  const withRange = endVerse && endVerse > verse ? `${label}-${endVerse}` : label
  return `${withRange}${lxx ? ' LXX' : ''}`
}

/** Copy "Reference text" to the clipboard (the same format the Bible reader uses).
 *  `text` should already be the full range's text (joined) when copying a range — pass
 *  the RAW (un-word-replaced) verse text; Word Replacer rules are applied centrally here
 *  via {@link displayVerseText}, so callers no longer need to pre-apply them. Pass
 *  `textTagged`/`textId` when available so Strong's-number rules and "the"-suppression
 *  apply exactly as the reader renders them (KJVA only); otherwise plain text-pattern
 *  rules still apply. */
export function copyVerse(
  bookId: string,
  chapter: number,
  verse: number,
  text: string,
  lxx = false,
  endVerse?: number,
  textTagged?: string | null,
  textId?: string,
): void {
  const replaced = displayVerseText(text, textTagged ?? null, textId ?? 'kjva')
  const clean = replaced.replace(/\{[HG]\d+\}/g, '').replace(/\s+/g, ' ').trim()
  navigator.clipboard.writeText(`${formatVerseRef(bookId, chapter, verse, lxx, endVerse)} ${clean}`).catch(() => {})
}

/** Copy just the reference (no verse text). */
export function copyVerseRef(bookId: string, chapter: number, verse: number, lxx = false, endVerse?: number): void {
  navigator.clipboard.writeText(formatVerseRef(bookId, chapter, verse, lxx, endVerse)).catch(() => {})
}
