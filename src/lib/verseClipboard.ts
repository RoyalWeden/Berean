import { bookName, getTranslationForBook } from './parseRef'
import { editionForTextId } from './bibleTexts'

/** Recognitions of Clement (RCL1-10) has a genuine 3-level Book.Chapter.Verse addressing
 *  scheme, so its copy format spells out the edition's full name and book number
 *  explicitly (e.g. "Recognitions of Clement, Book 5, 3:5") rather than relying on
 *  bookName()'s per-book label, which for RCL is just "Recognitions, Book N" (missing
 *  "of Clement"). T12P's bookName() labels are single, unadorned names ("Testament of
 *  Reuben") that read fine with a bare space before chapter:verse. Hermas's bookName()
 *  labels ("Hermas, Visions" / "Hermas, Mandates" / "Hermas, Similitudes") already carry
 *  their OWN internal comma — a bare space straight after "Similitudes" before the
 *  chapter:verse number read as visually run-together, so those get the same "comma
 *  before chapter:verse" treatment RCL already has, producing e.g. "Hermas, Similitudes,
 *  35:1" — parseRef's own book-token group now tolerates an embedded comma either way
 *  (see that file's comment), so this stays round-trippable for the notes auto-detection
 *  system, not just display. */
function bookRefLabel(bookId: string, chapter: number, verse: number): string {
  const rcl = bookId.match(/^RCL(\d{1,3})$/)
  if (rcl) {
    const textId = getTranslationForBook(bookId)
    const editionName = (textId && editionForTextId(textId)?.label) || 'Recognitions of Clement'
    return `${editionName}, Book ${rcl[1]}, ${chapter}:${verse}`
  }
  if (bookId === 'HER_VIS' || bookId === 'HER_MAN' || bookId === 'HER_SIM') {
    return `${bookName(bookId)}, ${chapter}:${verse}`
  }
  return `${bookName(bookId)} ${chapter}:${verse}`
}

/** Human-readable verse reference, e.g. "Genesis 1:1", "Genesis 1:1-3", or
 *  "Recognitions of Clement, Book 5, 3:5". Optional LXX suffix. `endVerse`, when greater
 *  than `verse`, renders a "verse-endVerse" range instead of a single verse number. */
export function formatVerseRef(bookId: string, chapter: number, verse: number, lxx = false, endVerse?: number): string {
  const label = bookRefLabel(bookId, chapter, verse)
  const withRange = endVerse && endVerse > verse ? `${label}-${endVerse}` : label
  return `${withRange}${lxx ? ' LXX' : ''}`
}

/** Copy "Reference text" to the clipboard (the same format the Bible reader uses).
 *  `text` should already be the full range's text (joined) when copying a range. */
export function copyVerse(bookId: string, chapter: number, verse: number, text: string, lxx = false, endVerse?: number): void {
  const clean = text.replace(/\{[HG]\d+\}/g, '').replace(/\s+/g, ' ').trim()
  navigator.clipboard.writeText(`${formatVerseRef(bookId, chapter, verse, lxx, endVerse)} ${clean}`).catch(() => {})
}

/** Copy just the reference (no verse text). */
export function copyVerseRef(bookId: string, chapter: number, verse: number, lxx = false, endVerse?: number): void {
  navigator.clipboard.writeText(formatVerseRef(bookId, chapter, verse, lxx, endVerse)).catch(() => {})
}
