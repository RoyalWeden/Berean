import type { IpcMain } from 'electron'
import { getTextDb } from '../db/bible'
import { numberTokenAlternates } from './numberWords'

// Cache compiled statements per text-DB instance so hot handlers (chapter/verse
// navigation, keystroke-driven search) don't re-compile identical SQL each call.
// Keyed by the db object, so a different textId (different db) gets its own set.
const _stmtCache = new WeakMap<object, Map<string, any>>()
function prep(db: NonNullable<ReturnType<typeof getTextDb>>, sql: string): any {
  let m = _stmtCache.get(db as unknown as object)
  if (!m) { m = new Map(); _stmtCache.set(db as unknown as object, m) }
  let s = m.get(sql)
  if (!s) { s = (db as any).prepare(sql); m.set(sql, s) }
  return s
}

// Cache which text DBs have specific columns
const _taggedColCache = new Map<string, boolean>()
function hasTaggedCol(db: ReturnType<typeof getTextDb>, textId: string): boolean {
  if (_taggedColCache.has(textId)) return _taggedColCache.get(textId)!
  const cols = (db as any).prepare('PRAGMA table_info(verses)').all() as Array<{ name: string }>
  const has = cols.some((c) => c.name === 'text_tagged')
  _taggedColCache.set(textId, has)
  return has
}

const _sortOrderColCache = new Map<string, boolean>()
function hasSortOrderCol(db: ReturnType<typeof getTextDb>, textId: string): boolean {
  if (_sortOrderColCache.has(textId)) return _sortOrderColCache.get(textId)!
  const cols = (db as any).prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>
  const has = cols.some((c) => c.name === 'sort_order')
  _sortOrderColCache.set(textId, has)
  return has
}

// Per-book chapter counts for texts that store chapters_count = 0 in `books` (LXX and
// others) — computed via a GROUP BY MAX(chapter) scan over `verses`. Chapter counts never
// change at runtime for a given text, and getBooks() is called once per text on Advanced
// Scripture Search mount (14 texts) — caching the computed result (not just the compiled
// statement, since `prep()` alone still re-runs the aggregate scan every call) means each
// text only pays this scan once per process lifetime instead of on every getBooks() call.
const _maxChaptersCache = new Map<string, Map<string, number>>()
function getMaxChaptersByBook(db: NonNullable<ReturnType<typeof getTextDb>>, textId: string): Map<string, number> {
  let cached = _maxChaptersCache.get(textId)
  if (!cached) {
    cached = new Map(
      (prep(db, 'SELECT book_id, MAX(chapter) as max_ch FROM verses GROUP BY book_id').all() as Array<{ book_id: string; max_ch: number }>)
        .map((row) => [row.book_id, row.max_ch])
    )
    _maxChaptersCache.set(textId, cached)
  }
  return cached
}

type WordMode = 'all' | 'any' | 'phrase'

/** Split a raw query into cleaned, FTS5-safe word tokens (strips anything that isn't
 *  alphanumeric or an apostrophe, drops empties). */
function cleanWords(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean)
    .map(w => w.replace(/[^a-zA-Z0-9']/g, ''))
    .filter(w => w.length >= 1)
}

/** Build an FTS5 MATCH expression for a phrase or all-words query. `wordMode` is passed
 *  explicitly by the caller rather than sniffed from the query string — an earlier
 *  version guessed intent from quotes/" OR " substrings, which meant a literal "OR" (or
 *  quote marks) typed as part of the user's own query text could silently flip "All
 *  words" mode into "any words" mode regardless of what the UI showed as selected. */
function safeFtsQuery(q: string, wordMode: 'all' | 'phrase'): string {
  const words = cleanWords(q)
  if (words.length === 0) return ''
  if (wordMode === 'phrase') return `"${words.join(' ')}"`
  // Expand a number-shaped word into "(digits OR words)" so a query in either
  // form finds text written in the other — the KJV spells numbers out as
  // words ("seven") far more often than it uses digits ("7"). Only in 'all'
  // mode: a phrase query's exact wording shouldn't get fuzzed.
  // Explicit AND, not just whitespace — see notes.ts's safeNotesFts for why a
  // bare term directly before a parenthesized OR-group is an FTS5 syntax error.
  return words.map(w => {
    const alts = numberTokenAlternates(w)
    return alts.length > 1 ? `(${alts.map(a => `${a}*`).join(' OR ')})` : `${w}*`
  }).join(' AND ')
}

export function registerBibleHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('bible:getBooks', (_event, textId = 'kjva') => {
    const db = getTextDb(textId)
    if (!db) return []
    const orderBy = hasSortOrderCol(db, textId)
      ? 'ORDER BY COALESCE(sort_order, 9999), rowid'
      : 'ORDER BY rowid'
    const books = prep(db,
      `SELECT id, name, short_name, testament, chapters_count FROM books ${orderBy}`
    ).all() as Array<{ id: string; name: string; short_name: string; testament: string; chapters_count: number }>
    // LXX (and some other texts) store chapters_count = 0; compute from verses table. A single
    // GROUP BY covers every book in one query — an earlier version ran one MAX(chapter) query
    // PER book needing a fallback, which for a ~80-book text like LXX meant 80+ synchronous
    // better-sqlite3 calls blocking Electron's single main-process thread on every call, stalling
    // any other tab's IPC requests queued behind it (most visible as a hang opening Advanced
    // Scripture Search, since it fetches getBooks for all 14 texts on mount).
    if (books.some((b) => b.chapters_count === 0)) {
      const maxChapters = getMaxChaptersByBook(db, textId)
      return books.map((b) => b.chapters_count === 0 ? { ...b, chapters_count: maxChapters.get(b.id) ?? 1 } : b)
    }
    return books
  })

  ipcMain.handle('bible:queryChapter', (_event, bookId: string, chapter: number, textId = 'kjva') => {
    const db = getTextDb(textId)
    if (!db) return []
    const withTagged = hasTaggedCol(db, textId)
    const sql = withTagged
      ? 'SELECT book_id, chapter, verse_num, text, text_tagged FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse_num'
      : 'SELECT book_id, chapter, verse_num, text FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse_num'
    return prep(db, sql).all(bookId, chapter)
  })

  ipcMain.handle('bible:queryVerse', (_event, bookId: string, chapter: number, verseNum: number, textId = 'kjva') => {
    const db = getTextDb(textId)
    if (!db) return null
    return prep(db,
      'SELECT verse_num, text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ?'
    ).get(bookId, chapter, verseNum)
  })

  ipcMain.handle('bible:searchText', (_event, query: string, textId = 'kjva', wordMode: WordMode = 'all', bookIds?: string[]) => {
    if (!query.trim()) return []
    const db = getTextDb(textId)
    if (!db) return []

    const trimmed = query.trim()
    const scoped = !!bookIds && bookIds.length > 0
    // A book-scoped search's worst case is one book's full verse count (a few
    // hundred) — a few thousand is effectively unbounded there. Unscoped searches
    // keep a cap too, just raised well past the old 100/200/300 values: the
    // results list is virtualized (@tanstack/react-virtual — see
    // ScriptureSearchView.tsx), so only rows actually scrolled into view ever
    // mount, making a much larger cap safe to render.
    const bookIdsClause = scoped ? ` AND v.book_id IN (${bookIds!.map(() => '?').join(',')})` : ''

    // ── 'any' mode: run one FTS5 query per word and union the results in JS. ──
    // FTS5 OR with prefix wildcards (in* OR the* OR beginning*) is unreliable
    // for very common or very short tokens — it can silently return nothing.
    if (wordMode === 'any') {
      const terms = cleanWords(trimmed)
      const seen = new Set<string>()
      const rows: unknown[] = []
      const limit = scoped ? 5000 : 2000
      // Placeholder count varies with bookIds.length per call, so this can't go
      // through prep()'s cache (keyed only by raw SQL string) when scoped — search
      // is human-triggered, not a hot path, so preparing fresh each call is fine.
      const sql = `
        SELECT v.book_id, v.chapter, v.verse_num, v.text
        FROM verses_fts f
        JOIN verses v ON v.id = f.rowid
        WHERE verses_fts MATCH ?${bookIdsClause}
        ORDER BY rank
        LIMIT ${limit}
      `
      const stmt = scoped ? (db as any).prepare(sql) : prep(db, sql)
      for (const term of terms) {
        const ftsQ = safeFtsQuery(term, 'all')
        if (!ftsQ) continue
        try {
          const termRows = stmt.all(...(scoped ? [ftsQ, ...bookIds!] : [ftsQ])) as Array<{ book_id: string; chapter: number; verse_num: number; text: string }>
          for (const row of termRows) {
            const key = `${row.book_id}|${row.chapter}|${row.verse_num}`
            if (!seen.has(key)) {
              seen.add(key)
              rows.push(row)
            }
          }
        } catch { /* skip terms that FTS5 rejects */ }
      }
      return scoped ? rows : rows.slice(0, 3000)
    }

    // ── phrase and all-words modes ───────────────────────────────────────────
    const ftsQ = safeFtsQuery(trimmed, wordMode === 'phrase' ? 'phrase' : 'all')
    if (!ftsQ) return []
    try {
      const limit = scoped ? 5000 : 2000
      const sql = `
        SELECT v.book_id, v.chapter, v.verse_num, v.text
        FROM verses_fts f
        JOIN verses v ON v.id = f.rowid
        WHERE verses_fts MATCH ?${bookIdsClause}
        ORDER BY rank
        LIMIT ${limit}
      `
      const stmt = scoped ? (db as any).prepare(sql) : prep(db, sql)
      return stmt.all(...(scoped ? [ftsQ, ...bookIds!] : [ftsQ]))
    } catch {
      return []
    }
  })
}
