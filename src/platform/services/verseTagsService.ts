import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { placeholders } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'

/**
 * Verse tags (tags, members, expanded verse index) — extracted verbatim from
 * electron/ipc/verseTags.ts (Phase 1/3).
 */

/** One location a tag member covers: either explicit verse spans within a chapter, or the
 *  whole chapter. Translation-agnostic — no textId. */
export interface TagRange {
  bookId: string
  chapter: number
  spans?: Array<{ s: number; e: number }>
  whole?: boolean
}

const MAX_SPAN_EXPANSION = 400 // guard against a pathological {s:1,e:9999}

/** Expand a member's ranges into (bookId, chapter, verse) tuples for verse_tag_verse.
 *  Whole-chapter ranges emit a single verse = 0 sentinel row. */
export function expandRanges(ranges: TagRange[]): Array<{ bookId: string; chapter: number; verse: number }> {
  const out: Array<{ bookId: string; chapter: number; verse: number }> = []
  const seen = new Set<string>()
  for (const r of ranges) {
    if (!r || typeof r.bookId !== 'string' || !Number.isFinite(r.chapter)) continue
    if (r.whole) {
      const k = `${r.bookId}|${r.chapter}|0`
      if (!seen.has(k)) { seen.add(k); out.push({ bookId: r.bookId, chapter: r.chapter, verse: 0 }) }
      continue
    }
    for (const span of r.spans ?? []) {
      const s = Math.max(1, Math.floor(span.s))
      const e = Math.min(s + MAX_SPAN_EXPANSION, Math.max(s, Math.floor(span.e)))
      for (let v = s; v <= e; v++) {
        const k = `${r.bookId}|${r.chapter}|${v}`
        if (!seen.has(k)) { seen.add(k); out.push({ bookId: r.bookId, chapter: r.chapter, verse: v }) }
      }
    }
  }
  return out
}

interface TagRow {
  id: string; name: string; color: string | null; sort_order: number | null; created_at: number
  color_slot: number | null; graph_x: number | null; graph_y: number | null; graph_pinned: number | null
}

export interface VerseTagSummary {
  id: string; name: string; color: string | null; createdAt: number
  colorSlot: number | null
  graphX: number | null; graphY: number | null; graphPinned: boolean
  memberCount: number; verseCount: number; chapterCount: number
}

export interface TagLite { id: string; name: string; color: string | null; colorSlot: number | null }

export interface TagMemberDetail {
  memberId: string
  tagId: string
  tagName: string
  tagColor: string | null
  tagColorSlot: number | null
  kind: 'verses' | 'chapter'
  label: string
  ranges: TagRange[]
  verses: Array<{ bookId: string; chapter: number; verse: number }>
  wholeChapters: Array<{ bookId: string; chapter: number }>
}

/** Total slots in the generated per-theme tag palette (mirrors TAG_SLOT_COUNT in src/lib/tagPalette.ts). */
const TAG_SLOT_COUNT = 12

export function createVerseTagsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  /** Pick the palette slot currently used by the fewest tags (ties broken randomly), so auto-assigned
   *  tag colours stay well spread across the wheel. */
  async function pickLeastUsedSlot(h: DatabaseAdapter): Promise<number> {
    const rows = await h.all<{ slot: number; c: number }>('SELECT color_slot AS slot, COUNT(*) AS c FROM verse_tags WHERE color_slot IS NOT NULL GROUP BY color_slot')
    const counts = new Array(TAG_SLOT_COUNT).fill(0)
    for (const r of rows) if (r.slot >= 0 && r.slot < TAG_SLOT_COUNT) counts[r.slot] = r.c
    const min = Math.min(...counts)
    const candidates = counts.map((c, i) => (c === min ? i : -1)).filter((i) => i >= 0)
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  async function rebuildMemberVerses(h: DatabaseAdapter, tagId: string, memberId: string, ranges: TagRange[]): Promise<void> {
    await h.run('DELETE FROM verse_tag_verse WHERE member_id = ?', [memberId])
    for (const v of expandRanges(ranges)) {
      await h.run(`INSERT OR IGNORE INTO verse_tag_verse (tag_id, member_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)`, [tagId, memberId, v.bookId, v.chapter, v.verse])
    }
  }

  async function listTagsWith(h: DatabaseAdapter): Promise<VerseTagSummary[]> {
    const rows = await h.all<TagRow & { memberCount: number; verseCount: number; chapterCount: number }>(`
    SELECT t.id, t.name, t.color, t.sort_order, t.created_at,
      t.color_slot, t.graph_x, t.graph_y, t.graph_pinned,
      (SELECT COUNT(*) FROM verse_tag_members m WHERE m.tag_id = t.id) AS memberCount,
      (SELECT COUNT(*) FROM verse_tag_verse v WHERE v.tag_id = t.id AND v.verse > 0) AS verseCount,
      (SELECT COUNT(*) FROM verse_tag_verse v WHERE v.tag_id = t.id AND v.verse = 0) AS chapterCount
    FROM verse_tags t
    ORDER BY COALESCE(t.sort_order, 999999), t.name COLLATE NOCASE
  `)
    return rows.map((r) => ({
      id: r.id, name: r.name, color: r.color, createdAt: r.created_at,
      colorSlot: r.color_slot,
      graphX: r.graph_x, graphY: r.graph_y, graphPinned: !!r.graph_pinned,
      memberCount: r.memberCount, verseCount: r.verseCount, chapterCount: r.chapterCount,
    }))
  }

  async function findOrCreateTag(h: DatabaseAdapter, name: string, color?: string | null): Promise<string> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('tag name required')
    const existing = await h.get<{ id: string }>('SELECT id FROM verse_tags WHERE name = ? COLLATE NOCASE', [trimmed])
    if (existing) return existing.id
    const id = ctx.uuid()
    await h.run('INSERT INTO verse_tags (id, name, color, color_slot, sort_order, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      [id, trimmed, color ?? null, await pickLeastUsedSlot(h), ctx.now()])
    ctx.events.emit('data:changed', { entity: 'verse_tag', id, op: 'upsert' })
    return id
  }

  const list = () => listTagsWith(db())

  async function create(name: string, color?: string | null) {
    await findOrCreateTag(db(), name, color)
    return list()
  }

  async function rename(id: string, name: string) {
    await db().run('UPDATE verse_tags SET name = ? WHERE id = ?', [name.trim(), id])
    ctx.events.emit('data:changed', { entity: 'verse_tag', id, op: 'upsert' })
    return list()
  }

  async function setColor(id: string, color: string | null) {
    await db().run('UPDATE verse_tags SET color = ? WHERE id = ?', [color ?? null, id])
    ctx.events.emit('data:changed', { entity: 'verse_tag', id, op: 'upsert' })
    return list()
  }

  // Set the generated-palette slot (0..11). Clears any literal `color` override so the
  // theme-adaptive slot colour actually takes effect.
  async function setColorSlot(id: string, slot: number) {
    const s = Math.max(0, Math.min(TAG_SLOT_COUNT - 1, Math.floor(slot)))
    await db().run('UPDATE verse_tags SET color_slot = ?, color = NULL WHERE id = ?', [s, id])
    ctx.events.emit('data:changed', { entity: 'verse_tag', id, op: 'upsert' })
    return list()
  }

  async function reorder(orderedIds: string[]) {
    await db().transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) await tx.run('UPDATE verse_tags SET sort_order = ? WHERE id = ?', [i, orderedIds[i]])
    })
    ctx.events.emit('data:changed', { entity: 'verse_tag', op: 'bulk' })
    return list()
  }

  async function merge(fromId: string, intoId: string) {
    await db().transaction(async (tx) => {
      await tx.run('UPDATE verse_tag_members SET tag_id = ? WHERE tag_id = ?', [intoId, fromId])
      await tx.run('UPDATE OR IGNORE verse_tag_verse SET tag_id = ? WHERE tag_id = ?', [intoId, fromId])
      await tx.run('DELETE FROM verse_tag_verse WHERE tag_id = ?', [fromId])
      // Re-point drawn relationship edges onto the surviving tag; UPDATE OR IGNORE drops any
      // that would collide with an existing edge, then clean up leftovers + self-loops.
      await tx.run('UPDATE OR IGNORE tag_edges SET source_tag_id = ? WHERE source_tag_id = ?', [intoId, fromId])
      await tx.run('UPDATE OR IGNORE tag_edges SET target_tag_id = ? WHERE target_tag_id = ?', [intoId, fromId])
      await tx.run('DELETE FROM tag_edges WHERE source_tag_id = ? OR target_tag_id = ? OR source_tag_id = target_tag_id', [fromId, fromId])
      await tx.run('DELETE FROM verse_tags WHERE id = ?', [fromId])
    })
    ctx.events.emit('data:changed', { entity: 'verse_tag', id: fromId, op: 'delete' })
    ctx.events.emit('data:changed', { entity: 'verse_tag', id: intoId, op: 'upsert' })
    return list()
  }

  // Delete a tag. If it is still referenced by "#name" in any note, refuse (return
  // { blocked, noteRefCount }) unless force === true.
  async function delete_(id: string, force = false) {
    const tag = await db().get<{ name: string }>('SELECT name FROM verse_tags WHERE id = ?', [id])
    if (!tag) return { deleted: false as const, notFound: true as const }
    if (!force) {
      const row = (await db().get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL AND content LIKE '%#' || ? || '%'`, [tag.name],
      ))!
      if (row.n > 0) return { deleted: false as const, blocked: true as const, noteRefCount: row.n, name: tag.name }
    }
    await db().transaction(async (tx) => {
      await tx.run('DELETE FROM verse_tag_verse WHERE tag_id = ?', [id])
      await tx.run('DELETE FROM verse_tags WHERE id = ?', [id]) // members cascade
    })
    ctx.events.emit('data:changed', { entity: 'verse_tag', id, op: 'delete' })
    return { deleted: true as const, list: await list() }
  }

  // Add the given ranges as one member to each of tagIds + each freshly-created newTagNames.
  // `label` is the caller-supplied display string (renderer owns naming). kind: 'verses' | 'chapter'.
  async function addMembers(args: {
    tagIds?: string[]; newTagNames?: string[]; ranges: TagRange[]; label: string; kind?: 'verses' | 'chapter'
  }) {
    const { ranges, label, kind = 'verses' } = args
    const touched: string[] = []
    await db().transaction(async (tx) => {
      const ids = new Set<string>(args.tagIds ?? [])
      for (const n of args.newTagNames ?? []) ids.add(await findOrCreateTag(tx, n))
      for (const tagId of ids) {
        const memberId = ctx.uuid()
        await tx.run(`INSERT INTO verse_tag_members (id, tag_id, kind, ranges, label, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [memberId, tagId, kind, JSON.stringify(ranges), label, ctx.now()])
        await rebuildMemberVerses(tx, tagId, memberId, ranges)
        touched.push(memberId)
      }
    })
    for (const id of touched) ctx.events.emit('data:changed', { entity: 'verse_tag_member', id, op: 'upsert' })
    return list()
  }

  async function removeMember(memberId: string) {
    await db().transaction(async (tx) => {
      await tx.run('DELETE FROM verse_tag_verse WHERE member_id = ?', [memberId])
      await tx.run('DELETE FROM verse_tag_members WHERE id = ?', [memberId])
    })
    ctx.events.emit('data:changed', { entity: 'verse_tag_member', id: memberId, op: 'delete' })
    return list()
  }

  async function updateMemberRanges(memberId: string, ranges: TagRange[], label: string, kind?: 'verses' | 'chapter') {
    const row = await db().get<{ tag_id: string }>('SELECT tag_id FROM verse_tag_members WHERE id = ?', [memberId])
    if (!row) return list()
    await db().transaction(async (tx) => {
      if (kind === 'verses' || kind === 'chapter') {
        await tx.run('UPDATE verse_tag_members SET ranges = ?, label = ?, kind = ? WHERE id = ?', [JSON.stringify(ranges), label, kind, memberId])
      } else {
        await tx.run('UPDATE verse_tag_members SET ranges = ?, label = ? WHERE id = ?', [JSON.stringify(ranges), label, memberId])
      }
      await rebuildMemberVerses(tx, row.tag_id, memberId, ranges)
    })
    ctx.events.emit('data:changed', { entity: 'verse_tag_member', id: memberId, op: 'upsert' })
    return list()
  }

  // Reader lookup: { verseTags: { [verse]: Tag[] }, chapterTags: Tag[] } for one chapter.
  async function getForChapter(bookId: string, chapter: number) {
    const rows = await db().all<{ verse: number; id: string; name: string; color: string | null; colorSlot: number | null }>(`
      SELECT v.verse, t.id, t.name, t.color, t.color_slot AS colorSlot
      FROM verse_tag_verse v JOIN verse_tags t ON t.id = v.tag_id
      WHERE v.book_id = ? AND v.chapter = ?
      ORDER BY t.name COLLATE NOCASE
    `, [bookId, chapter])
    const verseTags: Record<number, TagLite[]> = {}
    const chapterTags: TagLite[] = []
    const seenChapter = new Set<string>()
    for (const r of rows) {
      const tag = { id: r.id, name: r.name, color: r.color, colorSlot: r.colorSlot }
      if (r.verse === 0) {
        if (!seenChapter.has(r.id)) { seenChapter.add(r.id); chapterTags.push(tag) }
      } else {
        ;(verseTags[r.verse] ??= []).push(tag)
      }
    }
    return { verseTags, chapterTags }
  }

  // Advanced Search + "#tag" hover: every member of the given tags with its label, ranges,
  // and expanded verse list (verse 0 rows => whole chapter, surfaced via `wholeChapters`).
  async function getMembers(tagIds: string[]): Promise<TagMemberDetail[]> {
    if (!tagIds?.length) return []
    const members = await db().all<{ id: string; tag_id: string; kind: string; ranges: string; label: string; created_at: number; tagName: string; tagColor: string | null; tagColorSlot: number | null }>(`
      SELECT m.id, m.tag_id, m.kind, m.ranges, m.label, m.created_at,
        t.name AS tagName, t.color AS tagColor, t.color_slot AS tagColorSlot
      FROM verse_tag_members m JOIN verse_tags t ON t.id = m.tag_id
      WHERE m.tag_id IN (${placeholders(tagIds.length)})
      ORDER BY t.name COLLATE NOCASE, m.created_at
    `, tagIds)
    const out: TagMemberDetail[] = []
    for (const m of members) {
      const rows = await db().all<{ book_id: string; chapter: number; verse: number }>('SELECT book_id, chapter, verse FROM verse_tag_verse WHERE member_id = ?', [m.id])
      out.push({
        memberId: m.id,
        tagId: m.tag_id,
        tagName: m.tagName,
        tagColor: m.tagColor,
        tagColorSlot: m.tagColorSlot,
        kind: m.kind as 'verses' | 'chapter',
        label: m.label,
        ranges: JSON.parse(m.ranges) as TagRange[],
        verses: rows.filter((r) => r.verse > 0).map((r) => ({ bookId: r.book_id, chapter: r.chapter, verse: r.verse })),
        wholeChapters: rows.filter((r) => r.verse === 0).map((r) => ({ bookId: r.book_id, chapter: r.chapter })),
      })
    }
    return out
  }

  return { list, create, rename, setColor, setColorSlot, reorder, merge, delete: delete_, addMembers, removeMember, updateMemberRanges, getForChapter, getMembers }
}

export type VerseTagsService = ReturnType<typeof createVerseTagsService>
