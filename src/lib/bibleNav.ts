/**
 * Pure book/chapter traversal helpers — extracted out of BiblePanel.tsx's closure-bound
 * `nextChapter()`/`prevChapter()` so the same book-traversal logic (Hermas Vision/Mandate/
 * Similitude sub-chapter stepping, Sirach's unnumbered Prologue chapter 0) can be reused by
 * Read Aloud's auto-advance (useTTSPlayback.ts) without depending on any React state.
 *
 * Unlike BiblePanel's own nextChapter()/prevChapter() (which silently no-op at the true start/
 * end of the Bible), these return `null` at that boundary — the caller decides what "no-op"
 * vs. "clean stop" means for its own context.
 *
 * Deliberately does NOT include BiblePanel's `continuousChapterScroll` branch — that's a pure
 * UI scroll action (scrollToChapter), not a navigation of book/chapter state, so it stays in
 * BiblePanel itself.
 */
import type { Book } from '@/types'
import { isHermasBook, getHermasPrevChapter, getHermasNextChapter, hermasVariantForTextId, type HermasBookId } from '@/lib/hermasMap'
import { hasPrologueChapter } from '@/lib/prologueBooks'

export interface ChapterRef {
  bookId: string
  chapter: number
}

/** Mirrors BiblePanel.tsx's prevChapter() book-traversal logic. Returns null when already at
 *  the very first chapter of the very first book (true start-of-Bible). */
export function getPrevChapterRef(
  books: Book[],
  bookId: string,
  chapter: number,
  textId: string,
  opts: { endChapter?: number } = {},
): ChapterRef | null {
  if (opts.endChapter) {
    // In multi-chapter range mode, go to the previous single chapter
    return { bookId, chapter: chapter - 1 }
  }
  if (isHermasBook(bookId)) {
    const prev = getHermasPrevChapter(bookId as HermasBookId, chapter, hermasVariantForTextId(textId))
    return prev !== null ? { bookId, chapter: prev } : null
  }
  if (chapter > 1) {
    return { bookId, chapter: chapter - 1 }
  }
  if (hasPrologueChapter(bookId) && chapter === 1) {
    // Step into the book's unnumbered chapter-0 Prologue before wrapping to the previous book.
    return { bookId, chapter: 0 }
  }
  if (chapter === 0) {
    // Already at the Prologue — nothing before it in this book, no cross-book wrap.
    return null
  }
  const bookIdx = books.findIndex((b) => b.id === bookId)
  if (bookIdx > 0) {
    const prev = books[bookIdx - 1]
    return { bookId: prev.id, chapter: prev.chapters_count }
  }
  return null
}

/** Mirrors BiblePanel.tsx's nextChapter() book-traversal logic. Returns null when already at
 *  the very last chapter of the very last book (true end-of-Bible). */
export function getNextChapterRef(
  books: Book[],
  bookId: string,
  chapter: number,
  chapterCount: number,
  textId: string,
  opts: { endChapter?: number } = {},
): ChapterRef | null {
  if (opts.endChapter) {
    // In multi-chapter range mode, go to the next single chapter after the range
    return { bookId, chapter: opts.endChapter + 1 }
  }
  if (isHermasBook(bookId)) {
    const next = getHermasNextChapter(bookId as HermasBookId, chapter, hermasVariantForTextId(textId))
    return next !== null ? { bookId, chapter: next } : null
  }
  if (chapter < chapterCount) {
    return { bookId, chapter: chapter + 1 }
  }
  const bookIdx = books.findIndex((b) => b.id === bookId)
  if (bookIdx >= 0 && bookIdx < books.length - 1) {
    return { bookId: books[bookIdx + 1].id, chapter: 1 }
  }
  return null
}
