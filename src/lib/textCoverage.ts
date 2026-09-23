import { getTranslationForBook, isDedicatedTranslation, maxChapterFor } from '@/lib/parseRef'

/**
 * Which books a Bible text can actually display — shared by every navigation path (desktop
 * cross-ref clicks, search, reference bar, the iPhone reader and picker) so "open this
 * reference" never lands on a text that has no such book (TEST-009) or a chapter the book does
 * not have (TEST-025).
 *
 * Coverage is taken from the bundled databases. Only texts whose book list differs from the
 * canonical set need an entry: `kjva` carries every canonical book (+ Apocrypha); dedicated
 * texts (Enoch, Jubilees, …) are already handled by `getTranslationForBook`/
 * `isDedicatedTranslation`. The LXX list is `SELECT id FROM books` of `lxx_brenton.db`.
 */
const TEXT_BOOKS: Record<string, ReadonlySet<string>> = {
  lxx: new Set([
    '1CH', '1ES', '1KI', '1MA', '1SA', '2CH', '2KI', '2MA', '2SA', '3MA', '4MA', 'AMO', 'BAR', 'BEL',
    'DAN', 'DEU', 'ECC', 'ESG', 'EXO', 'EZK', 'EZR', 'GEN', 'HAB', 'HAG', 'HOS', 'ISA', 'JDG', 'JDT',
    'JER', 'JOB', 'JOL', 'JON', 'JOS', 'LAM', 'LEV', 'LJE', 'MAL', 'MIC', 'NAM', 'NEH', 'NUM', 'OBA',
    'PRM', 'PRO', 'PSA', 'RUT', 'SIR', 'SNG', 'SUS', 'TOB', 'WIS', 'ZEC', 'ZEP',
  ]),
}

/** The text every canonical reference can fall back to. */
export const FALLBACK_TEXT_ID = 'kjva'

/** True when `textId` can display `bookId`. Unknown texts are assumed to (no false fallbacks). */
export function textHasBook(textId: string, bookId: string): boolean {
  const id = textId.toLowerCase()
  const books = TEXT_BOOKS[id]
  if (books) return books.has(bookId)
  if (isDedicatedTranslation(id)) return getTranslationForBook(bookId) === id
  return true
}

/**
 * The text a navigation to `bookId` should use when the reader is currently on `currentTextId`:
 * a dedicated translation for dedicated books, the current text when it has the book, otherwise
 * KJV. Returns `undefined` when the current text should be kept.
 */
export function resolveTextForBook(currentTextId: string | undefined, bookId: string): string | undefined {
  const dedicated = getTranslationForBook(bookId)
  if (dedicated) return dedicated === currentTextId?.toLowerCase() ? undefined : dedicated
  const cur = (currentTextId ?? FALLBACK_TEXT_ID).toLowerCase()
  if (isDedicatedTranslation(cur)) return FALLBACK_TEXT_ID
  return textHasBook(cur, bookId) ? undefined : FALLBACK_TEXT_ID
}

/**
 * Chapter to open when switching to `bookId` while `chapter` was showing: the same chapter when
 * the book has it, otherwise chapter 1 (never a chapter the book does not contain). `chapterCount`
 * wins over the static table when the caller has the real count (loaded book list).
 */
export function chapterForBookSwitch(bookId: string, chapter: number, chapterCount?: number): number {
  const max = chapterCount ?? maxChapterFor(bookId)
  if (!Number.isFinite(chapter) || chapter < 1) return 1
  if (max != null && chapter > max) return 1
  return chapter
}
