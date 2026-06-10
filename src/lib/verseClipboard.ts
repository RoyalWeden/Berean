import { bookName } from './parseRef'

/** Human-readable verse reference, e.g. "Genesis 1:1". Optional LXX suffix. */
export function formatVerseRef(bookId: string, chapter: number, verse: number, lxx = false): string {
  return `${bookName(bookId)} ${chapter}:${verse}${lxx ? ' LXX' : ''}`
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
