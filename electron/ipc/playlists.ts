import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'

export interface PlaylistItemInput {
  bookId: string
  chapter: number
  startVerse?: number
  endVerse?: number | null
  textId: string
}

interface PlaylistItemRow {
  id: string; position: number; book_id: string; chapter: number
  start_verse: number; end_verse: number | null; text_id: string
}

function rowToItem(r: PlaylistItemRow) {
  return {
    id: r.id, position: r.position, bookId: r.book_id, chapter: r.chapter,
    startVerse: r.start_verse, endVerse: r.end_verse, textId: r.text_id,
  }
}

function writeItems(db: ReturnType<typeof getBereanDb>, playlistId: string, items: PlaylistItemInput[]) {
  db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId)
  const insert = db.prepare(`
    INSERT INTO playlist_items (id, playlist_id, position, book_id, chapter, start_verse, end_verse, text_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  items.forEach((item, i) => {
    insert.run(randomUUID(), playlistId, i, item.bookId, item.chapter, item.startVerse ?? 1, item.endVerse ?? null, item.textId)
  })
}

export function registerPlaylistsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('playlists:list', () => {
    const db = getBereanDb()
    const playlists = db.prepare('SELECT id, name, created_at, updated_at FROM playlists ORDER BY updated_at DESC').all() as
      Array<{ id: string; name: string; created_at: number; updated_at: number }>
    const itemsStmt = db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC')
    return playlists.map((p) => ({
      id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at,
      items: (itemsStmt.all(p.id) as PlaylistItemRow[]).map(rowToItem),
    }))
  })

  // Creates a new named playlist, or overwrites an existing one's items + updated_at when
  // existingId is passed (used by "Save as playlist" when re-saving over the current queue's
  // originating playlist rather than always forking a new one).
  ipcMain.handle('playlists:save', (_e, name: string, items: PlaylistItemInput[], existingId?: string) => {
    const db = getBereanDb()
    const now = Date.now()
    const id = existingId ?? randomUUID()
    const tx = db.transaction(() => {
      if (existingId) {
        db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
      } else {
        db.prepare('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now)
      }
      writeItems(db, id, items)
    })
    tx()
    return { id, name, createdAt: now, updatedAt: now, items: items.map((it, i) => ({ id: '', position: i, ...it, startVerse: it.startVerse ?? 1, endVerse: it.endVerse ?? null })) }
  })

  ipcMain.handle('playlists:rename', (_e, id: string, name: string) => {
    getBereanDb().prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
    return { success: true }
  })

  ipcMain.handle('playlists:delete', (_e, id: string) => {
    // playlist_items rows cascade via ON DELETE CASCADE (foreign_keys=ON, see berean.ts).
    getBereanDb().prepare('DELETE FROM playlists WHERE id = ?').run(id)
    return { success: true }
  })
}
