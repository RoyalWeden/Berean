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

function safeFtsQuery(q: string): string {
  const trimmed = q.trim()
  if (!trimmed) return ''

  // Phrase query — already wrapped in FTS5 quotes
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1).trim()
    const words = inner.split(/\s+/).filter(Boolean)
      .map(w => w.replace(/[^a-zA-Z0-9']/g, ''))
      .filter(w => w.length >= 1)
    if (words.length === 0) return ''
    return `"${words.join(' ')}"`
  }

  // OR query (any mode) — split on " OR " and wildcard each term
  if (trimmed.includes(' OR ')) {
    const terms = trimmed.split(' OR ').map(t => t.trim())
    const cleanTerms = terms
      .map(t => t.replace(/[^a-zA-Z0-9']/g, '').trim())
      .filter(t => t.length >= 1)
      .map(t => `${t}*`)
    if (cleanTerms.length === 0) return ''
    return cleanTerms.join(' OR ')
  }

  // All-words query (default) — prefix wildcard each word
  const words = trimmed.split(/\s+/).filter(Boolean)
  const clean = words
    .map(w => w.replace(/[^a-zA-Z0-9']/g, ''))
    .filter(w => w.length >= 1)
    .map(w => `${w}*`)
  if (clean.length === 0) return ''
  return clean.join(' ')
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
    // LXX (and some other texts) store chapters_count = 0; compute from verses table
    const countStmt = db.prepare('SELECT MAX(chapter) as max_ch FROM verses WHERE book_id = ?')
    return books.map((b) => {
      if (b.chapters_count === 0) {
        const row = countStmt.get(b.id) as { max_ch: number | null } | undefined
        return { ...b, chapters_count: row?.max_ch ?? 1 }
      }
      return b
    })
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

  ipcMain.handle('bible:searchText', (_event, query: string, textId = 'kjva') => {
    if (!query.trim()) return []
    const db = getTextDb(textId)
    if (!db) return []

    const trimmed = query.trim()

    // ── 'any' mode: query arrives as "word1 OR word2 OR word3" ──────────────
    // FTS5 OR with prefix wildcards (in* OR the* OR beginning*) is unreliable
    // for very common or very short tokens — it can silently return nothing.
    // Fix: run one FTS5 query per word and union the results in JS.
    if (trimmed.includes(' OR ')) {
      const terms = trimmed.split(' OR ').map(t => t.trim()).filter(Boolean)
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
        const ftsQ = safeFtsQuery(term)
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
    const ftsQ = safeFtsQuery(trimmed)
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
