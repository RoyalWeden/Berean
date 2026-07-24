import { bookName, getTranslationForBook } from './parseRef'
import { editionForTextId } from './bibleTexts'

/** Recognitions of Clement (RCL1-10) has a genuine 3-level Book.Chapter.Verse addressing
 *  scheme, so its copy format spells out the edition's full name and book number
 *  explicitly (e.g. "Recognitions of Clement, Book 5, 3:5") rather than relying on
 *  bookName()'s per-book label, which for RCL is just "Recognitions, Book N" (missing
 *  "of Clement"). Other multi-book editions (T12P, Hermas) already have fully descriptive
 *  bookName() labels ("Testament of Reuben", "Hermas, Visions") and have no numbered
 *  book subdivision, so they're left as-is. */
function bookRefLabel(bookId: string, chapter: number, verse: number): string {
  const rcl = bookId.match(/^RCL(\d{1,3})$/)
  if (rcl) {
    const textId = getTranslationForBook(bookId)
    const editionName = (textId && editionForTextId(textId)?.label) || 'Recognitions of Clement'
    return `${editionName}, Book ${rcl[1]}, ${chapter}:${verse}`
  }
  return `${bookName(bookId)} ${chapter}:${verse}`
}

/** Human-readable verse reference, e.g. "Genesis 1:1" or
 *  "Recognitions of Clement, Book 5, 3:5". Optional LXX suffix. */
export function formatVerseRef(bookId: string, chapter: number, verse: number, lxx = false): string {
  return `${bookRefLabel(bookId, chapter, verse)}${lxx ? ' LXX' : ''}`
}

/** Copy "Reference text" to the clipboard (the same format the Bible reader uses). */
export function copyVerse(bookId: string, chapter: number, verse: number, text: string, lxx = false): void {
  const clean = text.replace(/\{[HG]\d+\}/g, '').replace(/\s+/g, ' ').trim()
  navigator.clipboard.writeText(`${formatVerseRef(bookId, chapter, verse, lxx)} ${clean}`).catch(() => {})
}

/** Copy just the reference (no verse text). */
export function copyVerseRef(bookId: string, chapter: number, verse: number, lxx = false): void {
  navigator.clipboard.writeText(formatVerseRef(bookId, chapter, verse, lxx)).catch(() => {})
}
