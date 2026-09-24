import { getTranslationForBook, isDedicatedTranslation, maxChapterFor } from '@/lib/parseRef'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'

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

// ── Compare (LXX ↔ KJVA) coverage (T23-022…T23-027) ──────────────────────────────────────────

/** Books the LXX (lxx_brenton.db) has but the KJVA does not: 3–4 Maccabees, and the Epistle of
 *  Jeremiah (the KJVA appends it to Baruch as chapter 6 instead). `SELECT id FROM books` diff. */
const KJVA_LACKS: ReadonlySet<string> = new Set(['3MA', '4MA', 'LJE'])

/** LXX chapter counts wherever they differ from the KJV-numbered `maxChapterFor` table
 *  (`SELECT book_id, MAX(chapter) FROM verses GROUP BY book_id` of lxx_brenton.db — its
 *  `books.chapters_count` column is mostly 0 and cannot be used). */
const LXX_CHAPTER_COUNT: Readonly<Record<string, number>> = { BAR: 5, EZR: 23, JOL: 4, MAL: 3, PSA: 151 }

const isLxxId = (id: string) => id === 'lxx'
const isKjvFamilyId = (id: string) => id === 'kjva' || id === 'kjv'

/** Chapters `textId` has for `bookId` (LXX-aware); undefined when not statically known. */
export function textChapterCount(textId: string, bookId: string): number | undefined {
  const book = bookId.toUpperCase()
  if (isLxxId(textId.toLowerCase()) && LXX_CHAPTER_COUNT[book] != null) return LXX_CHAPTER_COUNT[book]
  return maxChapterFor(book)
}

/**
 * The other side of an LXX ↔ KJVA compare for `bookId` `chapter` as numbered in `textId`, or
 * null when there is none: `textId` is not LXX/KJV(A), the book is missing from either text (every
 * NT book; 3–4 Maccabees…), or the chapter has no counterpart chapter (LXX Psalm 151, LXX Ezra
 * 11–23 = KJV Nehemiah, KJVA Baruch 6). Chapter numbering goes through
 * `mapChapterOnTranslationSwitch` — the same source of truth as every translation switch — so
 * KJV Psalm 23 ↔ LXX Psalm 22, KJV Joel 3 ↔ LXX Joel 4, etc.
 */
export function compareCounterpart(textId: string, bookId: string, chapter: number): { textId: string; chapter: number } | null {
  const from = textId.toLowerCase()
  const book = bookId.toUpperCase()
  const to = isLxxId(from) ? 'kjva' : isKjvFamilyId(from) ? 'lxx' : null
  if (!to) return null
  if (!textHasBook('lxx', book) || !textHasBook('kjva', book) || KJVA_LACKS.has(book)) return null
  if (!Number.isFinite(chapter) || chapter < 1) return null
  const fromMax = textChapterCount(from, book)
  if (fromMax != null && chapter > fromMax) return null
  const mapped = mapChapterOnTranslationSwitch(book, chapter, from, to)
  const toMax = textChapterCount(to, book)
  if (mapped < 1 || (toMax != null && mapped > toMax)) return null
  return { textId: to, chapter: mapped }
}

/** True when Compare (LXX ↔ KJVA) can show `bookId` `chapter` (numbered in `fromTextId`, KJVA by
 *  default) — both texts have the book and the chapter maps to an equivalent chapter. */
export function compareApplicable(bookId: string, chapter: number, fromTextId = 'kjva'): boolean {
  return compareCounterpart(fromTextId, bookId, chapter) != null
}

/**
 * Where a tab should be once `books` (the newly selected text's book list) is known (NEW-005B):
 * the same book and chapter when valid; the book's last chapter / chapter 1 via
 * chapterForBookSwitch when only the chapter is out of range; and — when the text doesn't have the
 * book at all (Matthew 22 → 1 Enoch) — the text's FIRST book, chapter 1. `null` = stay put.
 * Desktop's BiblePanel applies the same rule when its book list loads.
 */
export function passageForTextBooks(books: ReadonlyArray<{ id: string; chapters_count: number }>, bookId: string, chapter: number): { bookId: string; chapter: number } | null {
  if (books.length === 0) return null
  const book = books.find((b) => b.id === bookId)
  if (!book) return { bookId: books[0].id, chapter: 1 }
  const ch = chapterForBookSwitch(book.id, chapter, book.chapters_count)
  return ch === chapter ? null : { bookId, chapter: ch }
}
