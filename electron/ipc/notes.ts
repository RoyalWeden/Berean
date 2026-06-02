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
  folder_id: string | null
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
    folderId:   row.folder_id ?? null,
  }
}

export function registerNotesHandlers(ipcMain: IpcMain): void {
  console.log('[berean-ipc] registerNotesHandlers: registering notes + folders IPC handlers')

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

  // ── Note folders (user-created, nestable) ──────────────────────────────────
  ipcMain.handle('folders:getAll', () => {
    const rows = getBereanDb()
      .prepare('SELECT id, name, parent_id, created_at FROM note_folders ORDER BY name COLLATE NOCASE')
      .all() as Array<{ id: string; name: string; parent_id: string | null; created_at: number }>
    return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id ?? null, createdAt: r.created_at }))
  })

  ipcMain.handle('folders:create', (_event, name: string, parentId: string | null = null) => {
    const db = getBereanDb()
    const id = randomUUID()
    db.prepare('INSERT INTO note_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name || 'New Folder', parentId, Date.now())
    return { success: true, id }
  })

  ipcMain.handle('folders:rename', (_event, id: string, name: string) => {
    getBereanDb().prepare('UPDATE note_folders SET name = ? WHERE id = ?').run(name, id)
    return { success: true }
  })

  // Delete a folder: reparent child folders to this folder's parent, and move
  // contained notes to root (folder_id = NULL). Never deletes notes.
  ipcMain.handle('folders:delete', (_event, id: string) => {
    const db = getBereanDb()
    const folder = db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(id) as { parent_id: string | null } | undefined
    const parentId = folder?.parent_id ?? null
    const tx = db.transaction(() => {
      db.prepare('UPDATE note_folders SET parent_id = ? WHERE parent_id = ?').run(parentId, id)
      db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(id)
      db.prepare('DELETE FROM note_folders WHERE id = ?').run(id)
    })
    tx()
    return { success: true }
  })

  // Delete a folder AND its contents: recursively removes all descendant
  // folders and every note contained in any of them. Destructive.
  ipcMain.handle('folders:deleteDeep', (_event, id: string) => {
    const db = getBereanDb()
    const tx = db.transaction(() => {
      const all = db.prepare('SELECT id, parent_id FROM note_folders').all() as Array<{ id: string; parent_id: string | null }>
      const childrenOf = new Map<string | null, string[]>()
      for (const f of all) {
        const arr = childrenOf.get(f.parent_id) ?? []
        arr.push(f.id); childrenOf.set(f.parent_id, arr)
      }
      const toDelete: string[] = []
      const stack = [id]
      while (stack.length) {
        const cur = stack.pop()!
        toDelete.push(cur)
        for (const c of childrenOf.get(cur) ?? []) stack.push(c)
      }
      const delNotes = db.prepare('DELETE FROM notes WHERE folder_id = ?')
      const delFolder = db.prepare('DELETE FROM note_folders WHERE id = ?')
      for (const fid of toDelete) { delNotes.run(fid); delFolder.run(fid) }
    })
    tx()
    return { success: true }
  })

  // Set a folder's parent (for nesting). Guards against cycles.
  ipcMain.handle('folders:setParent', (_event, id: string, parentId: string | null) => {
    const db = getBereanDb()
    // Walk up from the proposed parent; if we reach `id`, it would create a cycle.
    let cur: string | null = parentId
    while (cur) {
      if (cur === id) return { success: false, error: 'cycle' }
      const row = db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(cur) as { parent_id: string | null } | undefined
      cur = row?.parent_id ?? null
    }
    db.prepare('UPDATE note_folders SET parent_id = ? WHERE id = ?').run(parentId, id)
    return { success: true }
  })

  // Assign a note to a user folder (or NULL for root).
  ipcMain.handle('notes:setFolder', (_event, noteId: string, folderId: string | null) => {
    getBereanDb().prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(folderId, noteId)
    return { success: true }
  })

  ipcMain.handle('notes:deleteAll', () => {
    getBereanDb().prepare('DELETE FROM notes').run()
    return { success: true }
  })

  ipcMain.handle('notes:getAll', (_event, limit = 100000, offset = 0) => {
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

  console.log('[berean-ipc] registerNotesHandlers: ALL handlers registered OK (notes:create, notes:update, notes:delete, folders:create, folders:getAll, folders:rename, folders:delete, folders:deleteDeep, folders:setParent, notes:setFolder, notes:deleteAll, notes:getAll, notes:getByVerse, notes:getOne, notes:search, notes:deleteByTag, notes:getByChapter, notes:getChapterCounts)')
}
