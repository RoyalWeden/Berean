import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'

// Statement cache per DB instance (mirrors highlights.ts / studyTrail.ts).
const _stmtCache = new WeakMap<object, Map<string, any>>()
function prep(db: ReturnType<typeof getBereanDb>, sql: string): any {
  let m = _stmtCache.get(db as unknown as object)
  if (!m) { m = new Map(); _stmtCache.set(db as unknown as object, m) }
  let s = m.get(sql)
  if (!s) { s = (db as any).prepare(sql); m.set(sql, s) }
  return s
}

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
function expandRanges(ranges: TagRange[]): Array<{ bookId: string; chapter: number; verse: number }> {
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

interface TagRow { id: string; name: string; color: string | null; sort_order: number | null; created_at: number }

function rebuildMemberVerses(db: any, tagId: string, memberId: string, ranges: TagRange[]): void {
  prep(db, 'DELETE FROM verse_tag_verse WHERE member_id = ?').run(memberId)
  const ins = prep(db, `INSERT OR IGNORE INTO verse_tag_verse (tag_id, member_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)`)
  for (const v of expandRanges(ranges)) ins.run(tagId, memberId, v.bookId, v.chapter, v.verse)
}

function listTags(db: any) {
  const rows = prep(db, `
    SELECT t.id, t.name, t.color, t.sort_order, t.created_at,
      (SELECT COUNT(*) FROM verse_tag_members m WHERE m.tag_id = t.id) AS memberCount,
      (SELECT COUNT(*) FROM verse_tag_verse v WHERE v.tag_id = t.id AND v.verse > 0) AS verseCount,
      (SELECT COUNT(*) FROM verse_tag_verse v WHERE v.tag_id = t.id AND v.verse = 0) AS chapterCount
    FROM verse_tags t
    ORDER BY COALESCE(t.sort_order, 999999), t.name COLLATE NOCASE
  `).all() as Array<TagRow & { memberCount: number; verseCount: number; chapterCount: number }>
  return rows.map((r) => ({
    id: r.id, name: r.name, color: r.color, createdAt: r.created_at,
    memberCount: r.memberCount, verseCount: r.verseCount, chapterCount: r.chapterCount,
  }))
}

function findOrCreateTag(db: any, name: string, color?: string | null): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('tag name required')
  const existing = prep(db, 'SELECT id FROM verse_tags WHERE name = ? COLLATE NOCASE').get(trimmed) as { id: string } | undefined
  if (existing) return existing.id
  const id = randomUUID()
  prep(db, 'INSERT INTO verse_tags (id, name, color, sort_order, created_at) VALUES (?, ?, ?, NULL, ?)')
    .run(id, trimmed, color ?? null, Date.now())
  return id
}

export function registerVerseTagHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('verseTags:list', () => listTags(getBereanDb()))

  ipcMain.handle('verseTags:create', (_e, name: string, color?: string | null) => {
    const db = getBereanDb()
    findOrCreateTag(db, name, color)
    return listTags(db)
  })

  ipcMain.handle('verseTags:rename', (_e, id: string, name: string) => {
    const db = getBereanDb()
    prep(db, 'UPDATE verse_tags SET name = ? WHERE id = ?').run(name.trim(), id)
    return listTags(db)
  })

  ipcMain.handle('verseTags:setColor', (_e, id: string, color: string | null) => {
    const db = getBereanDb()
    prep(db, 'UPDATE verse_tags SET color = ? WHERE id = ?').run(color ?? null, id)
    return listTags(db)
  })

  ipcMain.handle('verseTags:reorder', (_e, orderedIds: string[]) => {
    const db = getBereanDb()
    const upd = prep(db, 'UPDATE verse_tags SET sort_order = ? WHERE id = ?')
    ;(db as any).transaction(() => { orderedIds.forEach((id, i) => upd.run(i, id)) })()
    return listTags(db)
  })

  ipcMain.handle('verseTags:merge', (_e, fromId: string, intoId: string) => {
    const db = getBereanDb()
    ;(db as any).transaction(() => {
      prep(db, 'UPDATE verse_tag_members SET tag_id = ? WHERE tag_id = ?').run(intoId, fromId)
      prep(db, 'UPDATE OR IGNORE verse_tag_verse SET tag_id = ? WHERE tag_id = ?').run(intoId, fromId)
      prep(db, 'DELETE FROM verse_tag_verse WHERE tag_id = ?').run(fromId)
      prep(db, 'DELETE FROM verse_tags WHERE id = ?').run(fromId)
    })()
    return listTags(db)
  })

  // Delete a tag. If it is still referenced by "#name" in any note, refuse (return
  // { blocked, noteRefCount }) unless force === true.
  ipcMain.handle('verseTags:delete', (_e, id: string, force = false) => {
    const db = getBereanDb()
    const tag = prep(db, 'SELECT name FROM verse_tags WHERE id = ?').get(id) as { name: string } | undefined
    if (!tag) return { deleted: false, notFound: true }
    if (!force) {
      const row = prep(db,
        `SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL AND content LIKE '%#' || ? || '%'`,
      ).get(tag.name) as { n: number }
      if (row.n > 0) return { deleted: false, blocked: true, noteRefCount: row.n, name: tag.name }
    }
    ;(db as any).transaction(() => {
      prep(db, 'DELETE FROM verse_tag_verse WHERE tag_id = ?').run(id)
      prep(db, 'DELETE FROM verse_tags WHERE id = ?').run(id) // members cascade
    })()
    return { deleted: true, list: listTags(db) }
  })

  // Add the given ranges as one member to each of tagIds + each freshly-created newTagNames.
  // `label` is the caller-supplied display string (renderer owns naming). kind: 'verses' | 'chapter'.
  ipcMain.handle('verseTags:addMembers', (_e, args: {
    tagIds?: string[]; newTagNames?: string[]; ranges: TagRange[]; label: string; kind?: 'verses' | 'chapter'
  }) => {
    const db = getBereanDb()
    const { ranges, label, kind = 'verses' } = args
    const ins = prep(db, `INSERT INTO verse_tag_members (id, tag_id, kind, ranges, label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    ;(db as any).transaction(() => {
      const ids = new Set<string>(args.tagIds ?? [])
      for (const n of args.newTagNames ?? []) ids.add(findOrCreateTag(db, n))
      for (const tagId of ids) {
        const memberId = randomUUID()
        ins.run(memberId, tagId, kind, JSON.stringify(ranges), label, Date.now())
        rebuildMemberVerses(db, tagId, memberId, ranges)
      }
    })()
    return listTags(db)
  })

  ipcMain.handle('verseTags:removeMember', (_e, memberId: string) => {
    const db = getBereanDb()
    ;(db as any).transaction(() => {
      prep(db, 'DELETE FROM verse_tag_verse WHERE member_id = ?').run(memberId)
      prep(db, 'DELETE FROM verse_tag_members WHERE id = ?').run(memberId)
    })()
    return listTags(db)
  })

  ipcMain.handle('verseTags:updateMemberRanges', (_e, memberId: string, ranges: TagRange[], label: string, kind?: 'verses' | 'chapter') => {
    const db = getBereanDb()
    const row = prep(db, 'SELECT tag_id FROM verse_tag_members WHERE id = ?').get(memberId) as { tag_id: string } | undefined
    if (!row) return listTags(db)
    ;(db as any).transaction(() => {
      if (kind === 'verses' || kind === 'chapter') {
        prep(db, 'UPDATE verse_tag_members SET ranges = ?, label = ?, kind = ? WHERE id = ?').run(JSON.stringify(ranges), label, kind, memberId)
      } else {
        prep(db, 'UPDATE verse_tag_members SET ranges = ?, label = ? WHERE id = ?').run(JSON.stringify(ranges), label, memberId)
      }
      rebuildMemberVerses(db, row.tag_id, memberId, ranges)
    })()
    return listTags(db)
  })

  // Reader lookup: { verseTags: { [verse]: Tag[] }, chapterTags: Tag[] } for one chapter.
  ipcMain.handle('verseTags:getForChapter', (_e, bookId: string, chapter: number) => {
    const db = getBereanDb()
    const rows = prep(db, `
      SELECT v.verse, t.id, t.name, t.color
      FROM verse_tag_verse v JOIN verse_tags t ON t.id = v.tag_id
      WHERE v.book_id = ? AND v.chapter = ?
      ORDER BY t.name COLLATE NOCASE
    `).all(bookId, chapter) as Array<{ verse: number; id: string; name: string; color: string | null }>
    const verseTags: Record<number, Array<{ id: string; name: string; color: string | null }>> = {}
    const chapterTags: Array<{ id: string; name: string; color: string | null }> = []
    const seenChapter = new Set<string>()
    for (const r of rows) {
      const tag = { id: r.id, name: r.name, color: r.color }
      if (r.verse === 0) {
        if (!seenChapter.has(r.id)) { seenChapter.add(r.id); chapterTags.push(tag) }
      } else {
        ;(verseTags[r.verse] ??= []).push(tag)
      }
    }
    return { verseTags, chapterTags }
  })

  // Advanced Search + "#tag" hover: every member of the given tags with its label, ranges,
  // and expanded verse list (verse 0 rows => whole chapter, surfaced via `wholeChapters`).
  ipcMain.handle('verseTags:getMembers', (_e, tagIds: string[]) => {
    const db = getBereanDb()
    if (!tagIds?.length) return []
    const placeholders = tagIds.map(() => '?').join(',')
    const members = (db as any).prepare(`
      SELECT m.id, m.tag_id, m.kind, m.ranges, m.label, m.created_at, t.name AS tagName, t.color AS tagColor
      FROM verse_tag_members m JOIN verse_tags t ON t.id = m.tag_id
      WHERE m.tag_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE, m.created_at
    `).all(...tagIds) as Array<{ id: string; tag_id: string; kind: string; ranges: string; label: string; created_at: number; tagName: string; tagColor: string | null }>
    const versesStmt = prep(db, 'SELECT book_id, chapter, verse FROM verse_tag_verse WHERE member_id = ?')
    return members.map((m) => {
      const rows = versesStmt.all(m.id) as Array<{ book_id: string; chapter: number; verse: number }>
      return {
        memberId: m.id,
        tagId: m.tag_id,
        tagName: m.tagName,
        tagColor: m.tagColor,
        kind: m.kind,
        label: m.label,
        ranges: JSON.parse(m.ranges) as TagRange[],
        verses: rows.filter((r) => r.verse > 0).map((r) => ({ bookId: r.book_id, chapter: r.chapter, verse: r.verse })),
        wholeChapters: rows.filter((r) => r.verse === 0).map((r) => ({ bookId: r.book_id, chapter: r.chapter })),
      }
    })
  })
}
