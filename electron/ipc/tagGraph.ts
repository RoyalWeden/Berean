import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'
import { listTags } from './verseTags'

// Statement cache per DB instance (mirrors verseTags.ts / highlights.ts).
const _stmtCache = new WeakMap<object, Map<string, any>>()
function prep(db: ReturnType<typeof getBereanDb>, sql: string): any {
  let m = _stmtCache.get(db as unknown as object)
  if (!m) { m = new Map(); _stmtCache.set(db as unknown as object, m) }
  let s = m.get(sql)
  if (!s) { s = (db as any).prepare(sql); m.set(sql, s) }
  return s
}

// Above this many verse_tag_verse rows the co-occurrence self-join gets expensive; skip it and
// let the renderer show a "co-occurrence omitted" hint instead of blocking getGraph.
const COOCCURRENCE_ROW_CAP = 50_000

export type TagEdgeArrows = 'none' | 'forward' | 'backward' | 'both'

interface EdgeRow {
  id: string
  source: string
  target: string
  arrows: string
  color: string | null
  dashed: number
  note: string
  createdAt: number
  updatedAt: number
}

function listEdges(db: any): EdgeRow[] {
  return prep(db, `
    SELECT id, source_tag_id AS source, target_tag_id AS target, arrows, color, dashed, note,
      created_at AS createdAt, updated_at AS updatedAt
    FROM tag_edges
  `).all() as EdgeRow[]
}

export function registerTagGraphHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('tagGraph:getGraph', () => {
    const db = getBereanDb()
    const tags = listTags(db)
    const edges = listEdges(db).map((e) => ({ ...e, dashed: !!e.dashed }))

    const total = (prep(db, 'SELECT COUNT(*) AS n FROM verse_tag_verse WHERE verse > 0').get() as { n: number }).n
    if (total > COOCCURRENCE_ROW_CAP) {
      return { tags, edges, coOccurrence: [], coOccurrenceOmitted: true }
    }
    const coOccurrence = prep(db, `
      SELECT a.tag_id AS a, b.tag_id AS b, COUNT(*) AS weight
      FROM verse_tag_verse a
      JOIN verse_tag_verse b
        ON a.book_id = b.book_id AND a.chapter = b.chapter AND a.verse = b.verse AND a.tag_id < b.tag_id
      WHERE a.verse > 0
      GROUP BY a.tag_id, b.tag_id
      HAVING weight >= 2
      ORDER BY weight DESC
      LIMIT 2000
    `).all() as Array<{ a: string; b: string; weight: number }>

    return { tags, edges, coOccurrence, coOccurrenceOmitted: false }
  })

  // Create a plain (arrow-less) edge between two distinct tags. Fails if an edge already exists
  // for that exact (source, target) ordering — the renderer then edits the existing one.
  ipcMain.handle('tagGraph:createEdge', (_e, source: string, target: string) => {
    const db = getBereanDb()
    if (!source || !target || source === target) return { created: false, invalid: true }
    const existing = prep(db, 'SELECT id FROM tag_edges WHERE source_tag_id = ? AND target_tag_id = ?').get(source, target) as { id: string } | undefined
    if (existing) {
      const row = prep(db, `
        SELECT id, source_tag_id AS source, target_tag_id AS target, arrows, color, dashed, note,
          created_at AS createdAt, updated_at AS updatedAt
        FROM tag_edges WHERE id = ?
      `).get(existing.id) as EdgeRow
      return { created: false, conflict: true, existing: { ...row, dashed: !!row.dashed } }
    }
    const now = Date.now()
    const id = randomUUID()
    prep(db, `INSERT INTO tag_edges (id, source_tag_id, target_tag_id, arrows, color, dashed, note, created_at, updated_at)
      VALUES (?, ?, ?, 'none', NULL, 0, '', ?, ?)`).run(id, source, target, now, now)
    return {
      created: true,
      edge: { id, source, target, arrows: 'none' as TagEdgeArrows, color: null, dashed: false, note: '', createdAt: now, updatedAt: now },
    }
  })

  ipcMain.handle('tagGraph:updateEdge', (_e, id: string, patch: { arrows?: TagEdgeArrows; color?: string | null; dashed?: boolean; note?: string }) => {
    const db = getBereanDb()
    const cur = prep(db, 'SELECT arrows, color, dashed, note FROM tag_edges WHERE id = ?').get(id) as
      { arrows: string; color: string | null; dashed: number; note: string } | undefined
    if (!cur) return { updated: false, notFound: true }
    const arrows = patch.arrows ?? cur.arrows
    const color = 'color' in patch ? (patch.color ?? null) : cur.color
    const dashed = patch.dashed == null ? cur.dashed : (patch.dashed ? 1 : 0)
    const note = patch.note == null ? cur.note : patch.note
    const now = Date.now()
    prep(db, 'UPDATE tag_edges SET arrows = ?, color = ?, dashed = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(arrows, color, dashed, note, now, id)
    return { updated: true, edges: listEdges(db).map((e) => ({ ...e, dashed: !!e.dashed })) }
  })

  ipcMain.handle('tagGraph:deleteEdge', (_e, id: string) => {
    const db = getBereanDb()
    prep(db, 'DELETE FROM tag_edges WHERE id = ?').run(id)
    return { deleted: true, edges: listEdges(db).map((e) => ({ ...e, dashed: !!e.dashed })) }
  })

  ipcMain.handle('tagGraph:setTagPosition', (_e, tagId: string, x: number | null, y: number | null, pinned: boolean) => {
    const db = getBereanDb()
    prep(db, 'UPDATE verse_tags SET graph_x = ?, graph_y = ?, graph_pinned = ? WHERE id = ?')
      .run(x == null ? null : x, y == null ? null : y, pinned ? 1 : 0, tagId)
    return { ok: true }
  })
}
