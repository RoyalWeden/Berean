import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'

interface NoteRow {
  id: string
  type: string
  title: string | null
  content: string
  verse_ref: string | null
  color: string
  created_at: number
  updated_at: number
  tags: string
  imported_at: number | null
}

function rowToNote(row: NoteRow) {
  return {
    id:         row.id,
    type:       row.type,
    title:      row.title ?? '',
    content:    row.content,
    verseRef:   row.verse_ref,
    color:      row.color,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
    tags:       JSON.parse(row.tags) as string[],
    importedAt: row.imported_at ?? undefined,
  }
}

export function registerNotesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('notes:create', (_event, data: {
    type?: string; title?: string; content?: string; verseRef?: string; color?: string; tags?: string[]
  }) => {
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    db.prepare(`
      INSERT INTO notes (id, type, title, content, verse_ref, color, created_at, updated_at, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.type ?? 'general',
      data.title ?? null,
      data.content ?? '',
      data.verseRef ?? null,
      data.color ?? 'blue',
      now, now,
      JSON.stringify(data.tags ?? [])
    )
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow
    return { success: true, note: rowToNote(row) }
  })

  ipcMain.handle('notes:update', (_event, id: string, data: {
    title?: string; content?: string; color?: string; tags?: string[]
  }) => {
    const db = getBereanDb()
    const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(id)
    if (!existing) return { success: false, error: 'Note not found' }

    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [Date.now()]

    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.content !== undefined) { fields.push('content = ?'); values.push(data.content) }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color) }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)) }

    values.push(id)
    db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return { success: true }
  })

  ipcMain.handle('notes:delete', (_event, id: string) => {
    getBereanDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('notes:deleteAll', () => {
    getBereanDb().prepare('DELETE FROM notes').run()
    return { success: true }
  })

  ipcMain.handle('notes:getAll', (_event, limit = 100, offset = 0) => {
    const rows = getBereanDb()
      .prepare('SELECT * FROM notes ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as NoteRow[]
    return rows.map(rowToNote)
  })

  ipcMain.handle('notes:getByVerse', (_event, verseRef: string) => {
    const rows = getBereanDb()
      .prepare('SELECT * FROM notes WHERE verse_ref = ? ORDER BY created_at ASC')
      .all(verseRef) as NoteRow[]
    return rows.map(rowToNote)
  })

  ipcMain.handle('notes:getOne', (_event, id: string) => {
    const row = getBereanDb()
      .prepare('SELECT * FROM notes WHERE id = ?')
      .get(id) as NoteRow | undefined
    return row ? rowToNote(row) : null
  })

  ipcMain.handle('notes:search', (_event, query: string, limit = 20) => {
    const pat = `%${query.trim()}%`
    const rows = getBereanDb()
      .prepare(`SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT ?`)
      .all(pat, pat, limit) as NoteRow[]
    return rows.map(rowToNote)
  })

  ipcMain.handle('notes:deleteByTag', (_event, tag: string) => {
    const db = getBereanDb()
    const result = db.prepare(`DELETE FROM notes WHERE tags LIKE ?`).run(`%"${tag}"%`)
    return { success: true, deleted: (result as { changes: number }).changes }
  })

  // Returns all notes whose verse_ref belongs to a specific chapter (e.g. "MAT.5.*")
  ipcMain.handle('notes:getByChapter', (_event, bookId: string, chapter: number) => {
    const prefix = `${bookId}.${chapter}.`
    const rows = getBereanDb()
      .prepare(`SELECT * FROM notes WHERE verse_ref LIKE ? AND verse_ref NOT LIKE ? ORDER BY verse_ref ASC`)
      .all(`${prefix}%`, `${prefix}%.%`) as NoteRow[]
    return rows.map(rowToNote)
  })

  // Returns { [verseNum]: count } for all verses in a chapter that have notes
  ipcMain.handle('notes:getChapterCounts', (_event, bookId: string, chapter: number) => {
    const prefix = `${bookId}.${chapter}.`
    const rows = getBereanDb()
      .prepare(`SELECT verse_ref FROM notes WHERE verse_ref LIKE ? AND verse_ref NOT LIKE ?`)
      .all(`${prefix}%`, `${prefix}%.%`) as Array<{ verse_ref: string }>
    const counts: Record<number, number> = {}
    for (const { verse_ref } of rows) {
      const verseNum = parseInt(verse_ref.split('.')[2] ?? '0')
      if (verseNum) counts[verseNum] = (counts[verseNum] ?? 0) + 1
    }
    return counts
  })
}
