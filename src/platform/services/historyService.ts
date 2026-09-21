import type { ServiceContext } from './context'

/**
 * App navigation history — extracted verbatim from electron/ipc/history.ts (Phase 1/3).
 * Device-local; never synced (docs/mobile/icloud.md §5).
 */
interface HistoryRow {
  id: string; type: string; title: string; timestamp: number
  session_id: string | null; session_name: string | null
  book_id: string | null; chapter: number | null; verse: number | null
  note_id: string | null; strongs_num: string | null; video_id: string | null
  query: string | null; parent_id: string | null
  import_source: string | null; import_count: number | null
}

export interface HistoryEntryInput {
  id: string; type: string; title: string; timestamp: number
  sessionId?: string; sessionName?: string; bookId?: string; chapter?: number; verse?: number
  noteId?: string; strongsNum?: string; videoId?: string; query?: string; parentId?: string
  importSource?: string; importCount?: number
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

export type HistoryEntry = ReturnType<typeof rowToEntry>

export function createHistoryService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  async function add(entry: HistoryEntryInput, maxEntries?: number): Promise<{ success: true }> {
    await db().run(`
      INSERT OR REPLACE INTO history (
        id, type, title, timestamp, session_id, session_name, book_id, chapter, verse,
        note_id, strongs_num, video_id, query, parent_id, import_source, import_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entry.id, entry.type, entry.title, entry.timestamp,
      entry.sessionId ?? null, entry.sessionName ?? null, entry.bookId ?? null,
      entry.chapter ?? null, entry.verse ?? null, entry.noteId ?? null,
      entry.strongsNum ?? null, entry.videoId ?? null, entry.query ?? null,
      entry.parentId ?? null, entry.importSource ?? null, entry.importCount ?? null,
    ])
    // Prune down to the caller's configured cap (Settings → History → "Max entries"), matching
    // what the UI already claims it does. Runs on every insert but is cheap — it's an indexed
    // ORDER BY timestamp DESC LIMIT scan, not a full table scan.
    if (maxEntries && maxEntries > 0) {
      await db().run(`
        DELETE FROM history WHERE id NOT IN (
          SELECT id FROM history ORDER BY timestamp DESC LIMIT ?
        )
      `, [maxEntries])
    }
    ctx.events.emit('data:changed', { entity: 'history', id: entry.id, op: 'upsert' })
    return { success: true }
  }

  // First page (most recent). The renderer lazy-loads older pages via getPage.
  async function getAll(limit = 300): Promise<HistoryEntry[]> {
    const rows = await db().all<HistoryRow>('SELECT * FROM history ORDER BY timestamp DESC LIMIT ?', [limit])
    return rows.map(rowToEntry)
  }

  // Older page: entries strictly older than `beforeTs`, newest first.
  async function getPage(beforeTs: number, limit = 300): Promise<HistoryEntry[]> {
    const rows = await db().all<HistoryRow>('SELECT * FROM history WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?', [beforeTs, limit])
    return rows.map(rowToEntry)
  }

  async function delete_(id: string): Promise<{ success: true }> {
    await db().run('DELETE FROM history WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'history', id, op: 'delete' })
    return { success: true }
  }

  async function clear(): Promise<{ success: true }> {
    await db().run('DELETE FROM history')
    ctx.events.emit('data:changed', { entity: 'history', op: 'bulk' })
    return { success: true }
  }

  return { add, getAll, getPage, delete: delete_, clear }
}

export type HistoryService = ReturnType<typeof createHistoryService>
