import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'

interface HistoryRow {
  id: string; type: string; title: string; timestamp: number
  session_id: string | null; session_name: string | null
  book_id: string | null; chapter: number | null; verse: number | null
  note_id: string | null; strongs_num: string | null; video_id: string | null
  query: string | null; parent_id: string | null
  import_source: string | null; import_count: number | null
}

function rowToEntry(r: HistoryRow) {
  return {
    id: r.id, type: r.type, title: r.title, timestamp: r.timestamp,
    sessionId: r.session_id ?? undefined,
    sessionName: r.session_name ?? undefined,
    bookId: r.book_id ?? undefined,
    chapter: r.chapter ?? undefined,
    verse: r.verse ?? undefined,
    noteId: r.note_id ?? undefined,
    strongsNum: r.strongs_num ?? undefined,
    videoId: r.video_id ?? undefined,
    query: r.query ?? undefined,
    parentId: r.parent_id ?? undefined,
    importSource: r.import_source ?? undefined,
    importCount: r.import_count ?? undefined,
  }
}

export function registerHistoryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('history:add', (_e, entry: {
    id: string; type: string; title: string; timestamp: number
    sessionId?: string; sessionName?: string; bookId?: string; chapter?: number; verse?: number
    noteId?: string; strongsNum?: string; videoId?: string; query?: string; parentId?: string
    importSource?: string; importCount?: number
  }) => {
    const db = getBereanDb()
    db.prepare(`
      INSERT OR REPLACE INTO history (
        id, type, title, timestamp, session_id, session_name, book_id, chapter, verse,
        note_id, strongs_num, video_id, query, parent_id, import_source, import_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.type, entry.title, entry.timestamp,
      entry.sessionId ?? null, entry.sessionName ?? null, entry.bookId ?? null,
      entry.chapter ?? null, entry.verse ?? null, entry.noteId ?? null,
      entry.strongsNum ?? null, entry.videoId ?? null, entry.query ?? null,
      entry.parentId ?? null, entry.importSource ?? null, entry.importCount ?? null
    )
    // Keep only the last 500 entries
    db.prepare(`
      DELETE FROM history WHERE id NOT IN (
        SELECT id FROM history ORDER BY timestamp DESC LIMIT 500
      )
    `).run()
    return { success: true }
  })

  ipcMain.handle('history:getAll', () => {
    const rows = getBereanDb()
      .prepare('SELECT * FROM history ORDER BY timestamp DESC LIMIT 500')
      .all() as HistoryRow[]
    return rows.map(rowToEntry)
  })

  ipcMain.handle('history:delete', (_e, id: string) => {
    getBereanDb().prepare('DELETE FROM history WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('history:clear', () => {
    getBereanDb().prepare('DELETE FROM history').run()
    return { success: true }
  })
}
