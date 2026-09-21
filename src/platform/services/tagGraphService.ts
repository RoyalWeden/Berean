import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'
import type { Services } from './index'

/**
 * Tags graph edges + positions — extracted verbatim from electron/ipc/tagGraph.ts (Phase 1/3).
 * Tag listing goes through the sibling verseTags service (`getServices().verseTags.list()`).
 */

// Above this many verse_tag_verse rows the co-occurrence self-join gets expensive; skip it and
// let the renderer show a "co-occurrence omitted" hint instead of blocking getGraph.
const COOCCURRENCE_ROW_CAP = 50_000

export type TagEdgeArrows = 'none' | 'forward' | 'backward' | 'both'

interface EdgeRow {
  id: string
  source: string
  target: string
  arrows: TagEdgeArrows
  color: string | null
  dashed: number
  note: string
  createdAt: number
  updatedAt: number
}

export interface TagEdge extends Omit<EdgeRow, 'dashed'> { dashed: boolean }

const EDGE_SELECT = `
    SELECT id, source_tag_id AS source, target_tag_id AS target, arrows, color, dashed, note,
      created_at AS createdAt, updated_at AS updatedAt
    FROM tag_edges
  `

async function listEdges(db: DatabaseAdapter): Promise<TagEdge[]> {
  const rows = await db.all<EdgeRow>(EDGE_SELECT)
  return rows.map((e) => ({ ...e, dashed: !!e.dashed }))
}

export function createTagGraphService(ctx: ServiceContext, getServices: () => Services) {
  const db = () => ctx.userDb

  async function getGraph() {
    const tags = await getServices().verseTags.list()
    const edges = await listEdges(db())

    const total = (await db().get<{ n: number }>('SELECT COUNT(*) AS n FROM verse_tag_verse WHERE verse > 0'))!.n
    if (total > COOCCURRENCE_ROW_CAP) {
      return { tags, edges, coOccurrence: [] as Array<{ a: string; b: string; weight: number }>, coOccurrenceOmitted: true }
    }
    const coOccurrence = await db().all<{ a: string; b: string; weight: number }>(`
      SELECT a.tag_id AS a, b.tag_id AS b, COUNT(*) AS weight
      FROM verse_tag_verse a
      JOIN verse_tag_verse b
        ON a.book_id = b.book_id AND a.chapter = b.chapter AND a.verse = b.verse AND a.tag_id < b.tag_id
      WHERE a.verse > 0
      GROUP BY a.tag_id, b.tag_id
      HAVING weight >= 2
      ORDER BY weight DESC
      LIMIT 2000
    `)

    return { tags, edges, coOccurrence, coOccurrenceOmitted: false }
  }

  // Create a plain (arrow-less) edge between two distinct tags. Fails if an edge already exists
  // for that exact (source, target) ordering — the renderer then edits the existing one.
  async function createEdge(source: string, target: string) {
    if (!source || !target || source === target) return { created: false, invalid: true }
    const existing = await db().get<{ id: string }>('SELECT id FROM tag_edges WHERE source_tag_id = ? AND target_tag_id = ?', [source, target])
    if (existing) {
      const row = (await db().get<EdgeRow>(`${EDGE_SELECT} WHERE id = ?`, [existing.id]))!
      return { created: false, conflict: true, existing: { ...row, dashed: !!row.dashed } }
    }
    const now = ctx.now()
    const id = ctx.uuid()
    await db().run(`INSERT INTO tag_edges (id, source_tag_id, target_tag_id, arrows, color, dashed, note, created_at, updated_at)
      VALUES (?, ?, ?, 'none', NULL, 0, '', ?, ?)`, [id, source, target, now, now])
    ctx.events.emit('data:changed', { entity: 'tag_edge', id, op: 'upsert' })
    return {
      created: true,
      edge: { id, source, target, arrows: 'none' as TagEdgeArrows, color: null, dashed: false, note: '', createdAt: now, updatedAt: now },
    }
  }

  async function updateEdge(id: string, patch: { arrows?: TagEdgeArrows; color?: string | null; dashed?: boolean; note?: string }) {
    const cur = await db().get<{ arrows: TagEdgeArrows; color: string | null; dashed: number; note: string }>('SELECT arrows, color, dashed, note FROM tag_edges WHERE id = ?', [id])
    if (!cur) return { updated: false, notFound: true }
    const arrows = patch.arrows ?? cur.arrows
    const color = 'color' in patch ? (patch.color ?? null) : cur.color
    const dashed = patch.dashed == null ? cur.dashed : (patch.dashed ? 1 : 0)
    const note = patch.note == null ? cur.note : patch.note
    const now = ctx.now()
    await db().run('UPDATE tag_edges SET arrows = ?, color = ?, dashed = ?, note = ?, updated_at = ? WHERE id = ?', [arrows, color, dashed, note, now, id])
    ctx.events.emit('data:changed', { entity: 'tag_edge', id, op: 'upsert' })
    return { updated: true, edges: await listEdges(db()) }
  }

  async function deleteEdge(id: string) {
    await db().run('DELETE FROM tag_edges WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'tag_edge', id, op: 'delete' })
    return { deleted: true, edges: await listEdges(db()) }
  }

  async function setTagPosition(tagId: string, x: number | null, y: number | null, pinned: boolean) {
    await db().run('UPDATE verse_tags SET graph_x = ?, graph_y = ?, graph_pinned = ? WHERE id = ?',
      [x == null ? null : x, y == null ? null : y, pinned ? 1 : 0, tagId])
    ctx.events.emit('data:changed', { entity: 'verse_tag', id: tagId, op: 'upsert' })
    return { ok: true }
  }

  return { getGraph, createEdge, updateEdge, deleteEdge, setTagPosition }
}

export type TagGraphService = ReturnType<typeof createTagGraphService>
