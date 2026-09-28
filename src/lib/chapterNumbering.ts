/**
 * Per-book DISPLAY chapter numbering that differs from the STORED chapter numbering.
 *
 * Recognitions of Clement, Book III (RCL3): the ANF translation numbers this book
 * chapter 1, then 12..75 — Rufinus omitted chapters 2–11. recog_clement.db stores the
 * book contiguously as chapters 1..65, and every highlight / note / tag / history entry
 * is keyed by that stored chapter, so storage stays as-is and only display + typed
 * references are mapped: stored 1 → ANF 1, stored n (n ≥ 2) → ANF n + 10.
 *
 * Every other book is the identity mapping. (Shepherd of Hermas has its own, richer
 * section-label scheme in hermasMap.ts and is not handled here.)
 */

/** Books whose display numbering skips a block of chapters: display = stored + offset
 *  for stored chapters ≥ firstShifted; display chapters in `gap` do not exist. */
const SHIFTED_BOOKS: Record<string, { firstShifted: number; offset: number; storedMax: number }> = {
  RCL3: { firstShifted: 2, offset: 10, storedMax: 65 },
}

/** True when the book's displayed chapter numbers differ from its stored ones. */
export function hasCustomChapterNumbering(bookId: string): boolean {
  return bookId in SHIFTED_BOOKS
}

/** Stored (database) chapter → the chapter number shown to the user. */
export function displayChapter(bookId: string | null | undefined, storedChapter: number): number
export function displayChapter(bookId: string | null | undefined, storedChapter: number | undefined): number | undefined
export function displayChapter(bookId: string | null | undefined, storedChapter: number | undefined): number | undefined {
  const s = bookId ? SHIFTED_BOOKS[bookId] : undefined
  if (!s || storedChapter == null || storedChapter < s.firstShifted) return storedChapter
  return storedChapter + s.offset
}

/** Chapter number typed/shown to the user → stored (database) chapter, or null when that
 *  display chapter does not exist (RCL3 chapters 2–11, omitted by Rufinus, or past the end). */
export function storedChapter(bookId: string, displayChapterNum: number): number | null {
  const s = SHIFTED_BOOKS[bookId]
  if (!s) return displayChapterNum
  if (displayChapterNum < s.firstShifted) return displayChapterNum
  if (displayChapterNum < s.firstShifted + s.offset) return null
  const stored = displayChapterNum - s.offset
  return stored > s.storedMax ? null : stored
}

/** Short note explaining a numbering gap, for chapter pickers/headings (null if none). */
export function chapterNumberingNote(bookId: string): string | null {
  if (bookId === 'RCL3') return 'Chapters 2–11 are omitted in Rufinus’ Latin; ANF numbering resumes at 12.'
  return null
}
