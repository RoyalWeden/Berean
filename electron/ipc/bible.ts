import type { IpcMain } from 'electron'
import { getTextDb } from '../db/bible'

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
  return words.map(w => `${w}*`).join(' ')
}

export function registerBibleHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('bible:getBooks', (_event, textId = 'kjva') => {
    const db = getTextDb(textId)
    if (!db) return []
    const orderBy = hasSortOrderCol(db, textId)
      ? 'ORDER BY COALESCE(sort_order, 9999), rowid'
      : 'ORDER BY rowid'
    const books = db.prepare(
      `SELECT id, name, short_name, testament, chapters_count FROM books ${orderBy}`
    ).all() as Array<{ id: string; name: string; short_name: string; testament: string; chapters_count: number }>
    // LXX (and some other texts) store chapters_count = 0; compute from verses table. A single
    // GROUP BY covers every book in one query — an earlier version ran one MAX(chapter) query
    // PER book needing a fallback, which for a ~80-book text like LXX meant 80+ synchronous
    // better-sqlite3 calls blocking Electron's single main-process thread on every call, stalling
    // any other tab's IPC requests queued behind it (most visible as a hang opening Advanced
    // Scripture Search, since it fetches getBooks for all 14 texts on mount).
    if (books.some((b) => b.chapters_count === 0)) {
      const maxChapters = new Map(
        (db.prepare('SELECT book_id, MAX(chapter) as max_ch FROM verses GROUP BY book_id').all() as Array<{ book_id: string; max_ch: number }>)
          .map((row) => [row.book_id, row.max_ch])
      )
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
    return (db as any).prepare(sql).all(bookId, chapter)
  })

  ipcMain.handle('bible:queryVerse', (_event, bookId: string, chapter: number, verseNum: number, textId = 'kjva') => {
    const db = getTextDb(textId)
    if (!db) return null
    return db.prepare(
      'SELECT verse_num, text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ?'
    ).get(bookId, chapter, verseNum)
  })

  ipcMain.handle('bible:searchText', (_event, query: string, textId = 'kjva', wordMode: WordMode = 'all') => {
    if (!query.trim()) return []
    const db = getTextDb(textId)
    if (!db) return []

    const trimmed = query.trim()

    // ── 'any' mode: run one FTS5 query per word and union the results in JS. ──
    // FTS5 OR with prefix wildcards (in* OR the* OR beginning*) is unreliable
    // for very common or very short tokens — it can silently return nothing.
    if (wordMode === 'any') {
      const terms = cleanWords(trimmed)
      const seen = new Set<string>()
      const rows: unknown[] = []
      const stmt = db.prepare(`
        SELECT v.book_id, v.chapter, v.verse_num, v.text
        FROM verses_fts f
        JOIN verses v ON v.id = f.rowid
        WHERE verses_fts MATCH ?
        ORDER BY rank
        LIMIT 200
      `)
      for (const term of terms) {
        const ftsQ = safeFtsQuery(term, 'all')
        if (!ftsQ) continue
        try {
          const termRows = stmt.all(ftsQ) as Array<{ book_id: string; chapter: number; verse_num: number; text: string }>
          for (const row of termRows) {
            const key = `${row.book_id}|${row.chapter}|${row.verse_num}`
            if (!seen.has(key)) {
              seen.add(key)
              rows.push(row)
            }
          }
        } catch { /* skip terms that FTS5 rejects */ }
      }
      return rows.slice(0, 300)
    }

    // ── phrase and all-words modes ───────────────────────────────────────────
    const ftsQ = safeFtsQuery(trimmed, wordMode === 'phrase' ? 'phrase' : 'all')
    if (!ftsQ) return []
    try {
      return db.prepare(`
        SELECT v.book_id, v.chapter, v.verse_num, v.text
        FROM verses_fts f
        JOIN verses v ON v.id = f.rowid
        WHERE verses_fts MATCH ?
        ORDER BY rank
        LIMIT 100
      `).all(ftsQ)
    } catch {
      return []
    }
  })
}
