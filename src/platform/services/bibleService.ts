import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { hasColumn, placeholders } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'
import { numberTokenAlternates } from '../../lib/numberWords'

/**
 * Scripture text access — extracted verbatim from electron/ipc/bible.ts (Phase 1/3). The SQL
 * and the result shapes are unchanged; only the execution is async through DatabaseAdapter.
 */

export type WordMode = 'all' | 'any' | 'phrase'

export interface BookRow { id: string; name: string; short_name: string; testament: string; chapters_count: number }
export interface ChapterVerseRow { book_id: string; chapter: number; verse_num: number; text: string; text_tagged?: string; title?: string }
export interface VerseRow { verse_num: number; text: string; text_tagged?: string }
export interface VerseSearchRow { book_id: string; chapter: number; verse_num: number; text: string; text_tagged?: string }
export type VerseRef = { bookId: string; chapter: number; verse: number }
export type VersesMap = Record<string, { text: string; title?: string }>

/** Split a raw query into cleaned, FTS5-safe word tokens (strips anything that isn't
 *  alphanumeric or an apostrophe, drops empties). */
export function cleanWords(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean)
    .map(w => w.replace(/[^a-zA-Z0-9']/g, ''))
    .filter(w => w.length >= 1)
}

/** Build an FTS5 MATCH expression for a phrase or all-words query. `wordMode` is passed
 *  explicitly by the caller rather than sniffed from the query string — an earlier
 *  version guessed intent from quotes/" OR " substrings, which meant a literal "OR" (or
 *  quote marks) typed as part of the user's own query text could silently flip "All
 *  words" mode into "any words" mode regardless of what the UI showed as selected. */
export function safeFtsQuery(q: string, wordMode: 'all' | 'phrase'): string {
  const words = cleanWords(q)
  if (words.length === 0) return ''
  if (wordMode === 'phrase') return `"${words.join(' ')}"`
  // Expand a number-shaped word into "(digits OR words)" so a query in either
  // form finds text written in the other — the KJV spells numbers out as
  // words ("seven") far more often than it uses digits ("7"). Only in 'all'
  // mode: a phrase query's exact wording shouldn't get fuzzed.
  // Explicit AND, not just whitespace — see notesService's safeNotesFts for why a
  // bare term directly before a parenthesized OR-group is an FTS5 syntax error.
  return words.map(w => {
    const alts = numberTokenAlternates(w)
    return alts.length > 1 ? `(${alts.map(a => `${a}*`).join(' OR ')})` : `${w}*`
  }).join(' AND ')
}

// Per-book chapter counts for texts that store chapters_count = 0 in `books` (LXX and
// others) — computed via a GROUP BY MAX(chapter) scan over `verses`. Chapter counts never
// change at runtime for a given text, and getBooks() is called once per text on Advanced
// Scripture Search mount (14 texts) — caching the computed result means each text only pays
// this scan once per process lifetime instead of on every getBooks() call.
const _maxChaptersCache = new Map<string, Map<string, number>>()
async function getMaxChaptersByBook(db: DatabaseAdapter, textId: string): Promise<Map<string, number>> {
  let cached = _maxChaptersCache.get(textId)
  if (!cached) {
    const rows = await db.all<{ book_id: string; max_ch: number }>('SELECT book_id, MAX(chapter) as max_ch FROM verses GROUP BY book_id')
    cached = new Map(rows.map((row) => [row.book_id, row.max_ch]))
    _maxChaptersCache.set(textId, cached)
  }
  return cached
}

export function createBibleService(ctx: ServiceContext) {
  const hasTaggedCol = (db: DatabaseAdapter) => hasColumn(db, 'verses', 'text_tagged')
  // Faint section-heading text, currently only populated for t12p.db.
  const hasTitleCol = (db: DatabaseAdapter) => hasColumn(db, 'verses', 'title')
  const hasSortOrderCol = (db: DatabaseAdapter) => hasColumn(db, 'books', 'sort_order')

  async function getBooks(textId = 'kjva'): Promise<BookRow[]> {
    const db = await ctx.textDb(textId)
    if (!db) return []
    const orderBy = (await hasSortOrderCol(db))
      ? 'ORDER BY COALESCE(sort_order, 9999), rowid'
      : 'ORDER BY rowid'
    const books = await db.all<BookRow>(`SELECT id, name, short_name, testament, chapters_count FROM books ${orderBy}`)
    // LXX (and some other texts) store chapters_count = 0; compute from verses table. A single
    // GROUP BY covers every book in one query — an earlier version ran one MAX(chapter) query
    // PER book needing a fallback, which for a ~80-book text like LXX meant 80+ synchronous
    // better-sqlite3 calls blocking Electron's single main-process thread on every call.
    if (books.some((b) => b.chapters_count === 0)) {
      const maxChapters = await getMaxChaptersByBook(db, textId)
      return books.map((b) => b.chapters_count === 0 ? { ...b, chapters_count: maxChapters.get(b.id) ?? 1 } : b)
    }
    return books
  }

  async function queryChapter(bookId: string, chapter: number, textId = 'kjva'): Promise<ChapterVerseRow[]> {
    const db = await ctx.textDb(textId)
    if (!db) return []
    const withTagged = await hasTaggedCol(db)
    const withTitle = await hasTitleCol(db)
    const cols = ['book_id', 'chapter', 'verse_num', 'text']
    if (withTagged) cols.push('text_tagged')
    if (withTitle) cols.push('title')
    const sql = `SELECT ${cols.join(', ')} FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse_num`
    return db.all<ChapterVerseRow>(sql, [bookId, chapter])
  }

  /** Single-verse lookup, also used by desktop-only modules (electron/ipc/aiLookup.ts). */
  async function queryVerse(bookId: string, chapter: number, verseNum: number, textId = 'kjva'): Promise<VerseRow | null> {
    const db = await ctx.textDb(textId)
    if (!db) return null
    // Include text_tagged where the text has it so callers can build Strong's-aware copy text
    // (e.g. the floating verse-selection bar's "Copy verses", matching VerseRow's own copy).
    const taggedCol = (await hasTaggedCol(db)) ? ', text_tagged' : ''
    const row = await db.get<VerseRow>(`SELECT verse_num, text${taggedCol} FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ?`, [bookId, chapter, verseNum])
    return row ?? null
  }

  // Batch verse-text fetch (Tag graph node inspector, and future callers). Groups the refs by
  // (bookId, chapter) so it runs one `verse_num IN (...)` query per chapter instead of N
  // single-verse round-trips. Returns a map keyed `${bookId}.${chapter}.${verse}`.
  async function queryVerses(refs: VerseRef[], textId = 'kjva'): Promise<VersesMap> {
    const out: VersesMap = {}
    const db = await ctx.textDb(textId)
    if (!db || !Array.isArray(refs) || refs.length === 0) return out
    const capped = refs.slice(0, 500)
    const withTitle = await hasTitleCol(db)
    const titleCol = withTitle ? ', title' : ''
    // group verse numbers by book+chapter
    const byChapter = new Map<string, { bookId: string; chapter: number; verses: Set<number> }>()
    for (const r of capped) {
      if (!r || typeof r.bookId !== 'string' || !Number.isFinite(r.chapter) || !Number.isFinite(r.verse)) continue
      const k = `${r.bookId}|${r.chapter}`
      let g = byChapter.get(k)
      if (!g) { g = { bookId: r.bookId, chapter: r.chapter, verses: new Set() }; byChapter.set(k, g) }
      g.verses.add(r.verse)
    }
    for (const g of byChapter.values()) {
      const nums = [...g.verses]
      const rows = await db.all<{ verse_num: number; text: string; title?: string }>(
        `SELECT verse_num, text${titleCol} FROM verses WHERE book_id = ? AND chapter = ? AND verse_num IN (${placeholders(nums.length)})`,
        [g.bookId, g.chapter, ...nums],
      )
      for (const row of rows) {
        out[`${g.bookId}.${g.chapter}.${row.verse_num}`] = row.title ? { text: row.text, title: row.title } : { text: row.text }
      }
    }
    return out
  }

  /** FTS5 verse search. `chapter` (optional) further narrows to a single chapter within
   *  `bookIds` — used by electron/ipc/aiLookup.ts to pin keyword search to a chapter the question
   *  named explicitly, on top of (not instead of) the existing book-level scope; a chapter number
   *  without a book scope is a caller error and is ignored, same as an empty `bookIds` array is
   *  for book scoping. */
  async function searchText(query: string, textId = 'kjva', wordMode: WordMode = 'all', bookIds?: string[], chapter?: number): Promise<VerseSearchRow[]> {
    if (!query.trim()) return []
    const db = await ctx.textDb(textId)
    if (!db) return []

    const trimmed = query.trim()
    const scoped = !!bookIds && bookIds.length > 0
    const chapterScoped = scoped && chapter != null
    const bookIdsClause = scoped ? ` AND v.book_id IN (${placeholders(bookIds!.length)})` : ''
    const chapterClause = chapterScoped ? ' AND v.chapter = ?' : ''
    // So search results can show KJV italics / red-letter (Yeshua's words) markup the same
    // way the reader does — see ScriptureSearchView.tsx's use of getAnnotationRanges().
    const taggedCol = (await hasTaggedCol(db)) ? ', v.text_tagged' : ''
    const limit = scoped ? 5000 : 2000
    const sql = `
      SELECT v.book_id, v.chapter, v.verse_num, v.text${taggedCol}
      FROM verses_fts f
      JOIN verses v ON v.id = f.rowid
      WHERE verses_fts MATCH ?${bookIdsClause}${chapterClause}
      ORDER BY rank
      LIMIT ${limit}
    `
    const chapterParam = chapterScoped ? [chapter as number] : []

    if (wordMode === 'any') {
      const terms = cleanWords(trimmed)
      const seen = new Set<string>()
      const rows: VerseSearchRow[] = []
      for (const term of terms) {
        const ftsQ = safeFtsQuery(term, 'all')
        if (!ftsQ) continue
        try {
          const termRows = await db.all<VerseSearchRow>(sql, scoped ? [ftsQ, ...bookIds!, ...chapterParam] : [ftsQ])
          for (const row of termRows) {
            const key = `${row.book_id}|${row.chapter}|${row.verse_num}`
            if (!seen.has(key)) { seen.add(key); rows.push(row) }
          }
        } catch { /* skip terms that FTS5 rejects */ }
      }
      return scoped ? rows : rows.slice(0, 3000)
    }

    const ftsQ = safeFtsQuery(trimmed, wordMode === 'phrase' ? 'phrase' : 'all')
    if (!ftsQ) return []
    try {
      return await db.all<VerseSearchRow>(sql, scoped ? [ftsQ, ...bookIds!, ...chapterParam] : [ftsQ])
    } catch {
      return []
    }
  }

  return { getBooks, queryChapter, queryVerse, queryVerses, searchText }
}

export type BibleService = ReturnType<typeof createBibleService>
