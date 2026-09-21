import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'

/**
 * Read Aloud playlists — extracted verbatim from electron/ipc/playlists.ts (Phase 1/3).
 */
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

export interface PlaylistItem {
  id: string; position: number; bookId: string; chapter: number
  startVerse: number; endVerse: number | null; textId: string
}

export interface Playlist { id: string; name: string; createdAt: number; updatedAt: number; items: PlaylistItem[] }

function rowToItem(r: PlaylistItemRow): PlaylistItem {
  return {
    id: r.id, position: r.position, bookId: r.book_id, chapter: r.chapter,
    startVerse: r.start_verse, endVerse: r.end_verse, textId: r.text_id,
  }
}

export function createPlaylistsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  async function writeItems(tx: DatabaseAdapter, playlistId: string, items: PlaylistItemInput[]): Promise<void> {
    await tx.run('DELETE FROM playlist_items WHERE playlist_id = ?', [playlistId])
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      await tx.run(`
    INSERT INTO playlist_items (id, playlist_id, position, book_id, chapter, start_verse, end_verse, text_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [ctx.uuid(), playlistId, i, item.bookId, item.chapter, item.startVerse ?? 1, item.endVerse ?? null, item.textId])
    }
  }

  async function list(): Promise<Playlist[]> {
    const playlists = await db().all<{ id: string; name: string; created_at: number; updated_at: number }>(
      'SELECT id, name, created_at, updated_at FROM playlists ORDER BY updated_at DESC',
    )
    const out: Playlist[] = []
    for (const p of playlists) {
      const rows = await db().all<PlaylistItemRow>('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC', [p.id])
      out.push({ id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at, items: rows.map(rowToItem) })
    }
    return out
  }

  // Creates a new named playlist, or overwrites an existing one's items + updated_at when
  // existingId is passed (used by "Save as playlist" when re-saving over the current queue's
  // originating playlist rather than always forking a new one).
  async function save(name: string, items: PlaylistItemInput[], existingId?: string): Promise<Playlist> {
    const now = ctx.now()
    const id = existingId ?? ctx.uuid()
    let createdAt = now
    await db().transaction(async (tx) => {
      if (existingId) {
        await tx.run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [name, now, id])
        // Report the row's real creation time, not `now` (K9).
        const row = await tx.get<{ created_at: number }>('SELECT created_at FROM playlists WHERE id = ?', [id])
        if (row) createdAt = row.created_at
      } else {
        await tx.run('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, name, now, now])
      }
      await writeItems(tx, id, items)
    })
    ctx.events.emit('data:changed', { entity: 'playlist', id, op: 'upsert' })
    return { id, name, createdAt, updatedAt: now, items: items.map((it, i) => ({ id: '', position: i, ...it, startVerse: it.startVerse ?? 1, endVerse: it.endVerse ?? null })) }
  }

  async function rename(id: string, name: string): Promise<{ success: true }> {
    await db().run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [name, ctx.now(), id])
    ctx.events.emit('data:changed', { entity: 'playlist', id, op: 'upsert' })
    return { success: true }
  }

  async function delete_(id: string): Promise<{ success: true }> {
    // playlist_items rows cascade via ON DELETE CASCADE (foreign_keys=ON, see berean.ts).
    await db().run('DELETE FROM playlists WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'playlist', id, op: 'delete' })
    return { success: true }
  }

  return { list, save, rename, delete: delete_ }
}

export type PlaylistsService = ReturnType<typeof createPlaylistsService>
