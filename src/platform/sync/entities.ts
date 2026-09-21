import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { placeholders } from '../db/DatabaseAdapter'
import { expandRanges, type TagRange } from '../services/verseTagsService'
import { mirrorYoutubeUserRow } from '../services/youtubeService'

/**
 * Entity adapters: how the sync engine reads a record's synced fields out of berean.db and
 * writes a remote record back in (docs/mobile/icloud.md §5). One adapter per synced entity;
 * everything not registered here never leaves the device.
 *
 * Column lists are discovered from the live schema (`PRAGMA table_info`) so a future migration
 * that adds a column syncs it automatically — unless it is listed in `exclude` (device-local
 * columns such as `tabs.local_state_json`). Unknown incoming fields (from a newer build) are
 * ignored on write, so an older build can still apply a newer device's ops for the columns it has.
 */
export interface EntityRecord {
  fields: Record<string, unknown>
  /** True for a tombstone row (soft-deleted tables); a missing row is `undefined` instead. */
  deleted?: boolean
}

export interface EntityAdapter {
  readonly kind: string
  /** Entities whose rows the app deletes or rewrites together with this one, without events of
   *  their own (the engine re-captures them after a delete/bulk change of this entity). */
  readonly dependents?: string[]
  read(db: DatabaseAdapter, key: string): Promise<EntityRecord | undefined>
  /** Every live key (for the one-time adoption of pre-sync data). */
  listKeys(db: DatabaseAdapter): Promise<string[]>
  applyUpsert(db: DatabaseAdapter, key: string, fields: Record<string, unknown>): Promise<void>
  applyDelete(db: DatabaseAdapter, key: string, deletedAt: number): Promise<void>
}

const columnCache = new Map<string, string[]>()
async function tableColumns(db: DatabaseAdapter, table: string): Promise<string[]> {
  const cacheKey = `${db.label}|${table}`
  let cols = columnCache.get(cacheKey)
  if (!cols) {
    cols = (await db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name)
    columnCache.set(cacheKey, cols)
  }
  return cols
}
export function __resetEntityColumnCache(): void { columnCache.clear() }

function assertIdent(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`invalid identifier: ${s}`)
  return s
}

interface TableEntityOptions {
  kind: string
  table: string
  /** Primary-key column (default `id`). */
  idColumn?: string
  dependents?: string[]
  /** Device-local columns that never sync (kept as-is on remote upsert). */
  exclude?: string[]
  /** Soft-delete column: rows with it set are tombstones (sessions/tabs/archived_groups). Notes'
   *  `deleted_at` is *trash*, which syncs as a normal field, so notes do NOT use this. */
  tombstoneColumn?: string
  /** Hook after a remote upsert/delete (e.g. rebuild derived rows). */
  afterUpsert?: (db: DatabaseAdapter, key: string, fields: Record<string, unknown>) => Promise<void>
  beforeDelete?: (db: DatabaseAdapter, key: string) => Promise<void>
}

export function tableEntity(o: TableEntityOptions): EntityAdapter {
  const table = assertIdent(o.table)
  const idCol = assertIdent(o.idColumn ?? 'id')
  const exclude = new Set(o.exclude ?? [])
  return {
    kind: o.kind,
    dependents: o.dependents,
    async read(db, key) {
      const row = await db.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${idCol} = ?`, [key])
      if (!row) return undefined
      if (o.tombstoneColumn && row[o.tombstoneColumn] != null) return { fields: { [o.tombstoneColumn]: row[o.tombstoneColumn] }, deleted: true }
      const fields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) if (!exclude.has(k)) fields[k] = v
      return { fields }
    },
    async listKeys(db) {
      const where = o.tombstoneColumn ? ` WHERE ${assertIdent(o.tombstoneColumn)} IS NULL` : ''
      return (await db.all<{ k: string }>(`SELECT ${idCol} AS k FROM ${table}${where}`)).map((r) => r.k)
    },
    async applyUpsert(db, key, fields) {
      const cols = await tableColumns(db, table)
      const incoming: Record<string, unknown> = { ...fields, [idCol]: key }
      const use = cols.filter((c) => c in incoming && !exclude.has(c))
      if (!use.includes(idCol)) use.unshift(idCol)
      const values = use.map((c) => toSql(incoming[c]))
      const updates = use.filter((c) => c !== idCol).map((c) => `${c} = excluded.${c}`)
      if (o.tombstoneColumn && !use.includes(o.tombstoneColumn)) updates.push(`${o.tombstoneColumn} = NULL`)
      await db.run(
        `INSERT INTO ${table} (${use.join(', ')}) VALUES (${placeholders(use.length)})
         ON CONFLICT(${idCol}) DO UPDATE SET ${updates.join(', ')}`,
        values,
      )
      if (o.afterUpsert) await o.afterUpsert(db, key, incoming)
    },
    async applyDelete(db, key, deletedAt) {
      if (o.beforeDelete) await o.beforeDelete(db, key)
      if (o.tombstoneColumn) {
        const col = assertIdent(o.tombstoneColumn)
        const cols = await tableColumns(db, table)
        const setUpdated = cols.includes('updated_at') ? `, updated_at = ${Number(deletedAt)}` : ''
        await db.run(`UPDATE ${table} SET ${col} = ?${setUpdated} WHERE ${idCol} = ? AND ${col} IS NULL`, [deletedAt, key])
      } else {
        await db.run(`DELETE FROM ${table} WHERE ${idCol} = ?`, [key])
      }
    },
  }
}

function toSql(v: unknown): string | number | null | Uint8Array {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' || typeof v === 'number') return v
  if (v instanceof Uint8Array) return v
  return JSON.stringify(v)
}

/** Playlists sync as an aggregate (the service rewrites all items on every save and emits one
 *  `playlist` event), so the record carries its items. */
export function playlistEntity(): EntityAdapter {
  return {
    kind: 'playlist',
    async read(db, key) {
      const row = await db.get<Record<string, unknown>>('SELECT * FROM playlists WHERE id = ?', [key])
      if (!row) return undefined
      const items = await db.all<Record<string, unknown>>('SELECT id, position, book_id, chapter, start_verse, end_verse, text_id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC', [key])
      return { fields: { ...row, items } }
    },
    async listKeys(db) {
      return (await db.all<{ id: string }>('SELECT id FROM playlists')).map((r) => r.id)
    },
    async applyUpsert(db, key, fields) {
      const { items, ...row } = fields as { items?: Array<Record<string, unknown>> } & Record<string, unknown>
      await db.run(
        `INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [key, String(row.name ?? ''), Number(row.created_at ?? 0), Number(row.updated_at ?? 0)],
      )
      await db.run('DELETE FROM playlist_items WHERE playlist_id = ?', [key])
      for (const it of items ?? []) {
        await db.run(
          `INSERT OR REPLACE INTO playlist_items (id, playlist_id, position, book_id, chapter, start_verse, end_verse, text_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(it.id), key, Number(it.position ?? 0), String(it.book_id), Number(it.chapter), Number(it.start_verse ?? 1), it.end_verse == null ? null : Number(it.end_verse), String(it.text_id ?? 'kjva')],
        )
      }
    },
    async applyDelete(db, key) {
      await db.run('DELETE FROM playlists WHERE id = ?', [key])   // items cascade (FK)
    },
  }
}

/** verse_tag_members carry `ranges` JSON; the verse_tag_verse index is derived from it locally. */
async function rebuildMemberVerses(db: DatabaseAdapter, memberId: string, fields: Record<string, unknown>): Promise<void> {
  await db.run('DELETE FROM verse_tag_verse WHERE member_id = ?', [memberId])
  let ranges: TagRange[] = []
  try { ranges = typeof fields.ranges === 'string' ? JSON.parse(fields.ranges) : (fields.ranges as TagRange[]) ?? [] } catch { ranges = [] }
  const tagId = String(fields.tag_id)
  for (const v of expandRanges(ranges)) {
    await db.run('INSERT OR IGNORE INTO verse_tag_verse (tag_id, member_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)', [tagId, memberId, v.bookId, v.chapter, v.verse])
  }
}

/**
 * verse_tags.name is UNIQUE (case-insensitive). Two devices can create a tag with the same name
 * while apart; both must survive (independent additions merge) and every device must end with the
 * same result, so the later-created tag (by created_at, then id) is renamed "Name (2)" — on the
 * device that created it and on every device that receives it — and the user can merge them with
 * the Tag Manager if they were meant to be one.
 */
export function verseTagEntity(): EntityAdapter {
  const base = tableEntity({
    kind: 'verse_tag', table: 'verse_tags',
    // members + edges cascade through FKs locally without events of their own; verse_tag_verse
    // (derived index, no FK) is cleared explicitly on a remote delete.
    dependents: ['verse_tag_member', 'tag_edge'],
    beforeDelete: async (db, key) => { await db.run('DELETE FROM verse_tag_verse WHERE tag_id = ?', [key]) },
  })
  return {
    ...base,
    async applyUpsert(db, key, fields) {
      const name = String(fields.name ?? '')
      const clash = await db.get<{ id: string; created_at: number; name: string }>('SELECT id, created_at, name FROM verse_tags WHERE name = ? COLLATE NOCASE AND id != ?', [name, key])
      if (clash) {
        const incomingCreated = Number(fields.created_at ?? 0)
        const incomingLater = incomingCreated > clash.created_at || (incomingCreated === clash.created_at && key > clash.id)
        if (incomingLater) {
          fields = { ...fields, name: await uniqueTagName(db, name, key) }
        } else {
          await db.run('UPDATE verse_tags SET name = ? WHERE id = ?', [await uniqueTagName(db, clash.name, clash.id), clash.id])
        }
      }
      await base.applyUpsert(db, key, fields)
    },
  }
}

async function uniqueTagName(db: DatabaseAdapter, name: string, exceptId: string): Promise<string> {
  const stem = name.replace(/ \(\d+\)$/, '')
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})`
    const taken = await db.get('SELECT 1 FROM verse_tags WHERE name = ? COLLATE NOCASE AND id != ?', [candidate, exceptId])
    if (!taken) return candidate
  }
  return `${stem} (${Date.now()})`
}

/**
 * Study-trail sessions sync as an aggregate: the row plus its paused intervals (written by
 * pause/resume, which only emit a session event) and its tag memberships (`trail_tag_members`
 * has a composite key and is rewritten per session by setSessionTags). Nodes, connections and
 * trail notes are their own entities.
 */
export function trailSessionEntity(): EntityAdapter {
  const base = tableEntity({ kind: 'trail_session', table: 'trail_sessions', dependents: ['trail_node', 'trail_connection', 'trail_note'] })
  return {
    ...base,
    async read(db, key) {
      const rec = await base.read(db, key)
      if (!rec) return undefined
      const paused = await db.all<Record<string, unknown>>('SELECT id, paused_at, resumed_at FROM trail_paused_intervals WHERE trail_session_id = ? ORDER BY paused_at ASC, id ASC', [key])
      const tags = (await db.all<{ tag_id: string }>('SELECT tag_id FROM trail_tag_members WHERE trail_session_id = ? ORDER BY tag_id ASC', [key])).map((r) => r.tag_id)
      return { fields: { ...rec.fields, paused_intervals: paused, tag_ids: tags } }
    },
    async applyUpsert(db, key, fields) {
      const { paused_intervals, tag_ids, ...row } = fields as { paused_intervals?: Array<Record<string, unknown>>; tag_ids?: string[] } & Record<string, unknown>
      await base.applyUpsert(db, key, row)
      if (Array.isArray(paused_intervals)) {
        await db.run('DELETE FROM trail_paused_intervals WHERE trail_session_id = ?', [key])
        for (const p of paused_intervals) {
          await db.run('INSERT OR REPLACE INTO trail_paused_intervals (id, trail_session_id, paused_at, resumed_at) VALUES (?, ?, ?, ?)', [String(p.id), key, Number(p.paused_at), p.resumed_at == null ? null : Number(p.resumed_at)])
        }
      }
      if (Array.isArray(tag_ids)) {
        await db.run('DELETE FROM trail_tag_members WHERE trail_session_id = ?', [key])
        for (const t of tag_ids) {
          // The tag is its own record. Ops are causal, so it normally arrived already; if not
          // (its journal file is still downloading), the membership is parked in sync_state and
          // re-established by the trail_tag adapter when the tag lands (the FK would reject it now).
          const exists = await db.get('SELECT 1 FROM trail_tags WHERE id = ?', [t])
          if (exists) await db.run('INSERT OR IGNORE INTO trail_tag_members (tag_id, trail_session_id, created_at) VALUES (?, ?, ?)', [t, key, Date.now()])
          else await deferTagMembership(db, t, key)
        }
      }
    },
    async applyDelete(db, key) {
      await db.run('DELETE FROM trail_tag_members WHERE trail_session_id = ?', [key])
      await db.run('DELETE FROM trail_paused_intervals WHERE trail_session_id = ?', [key])
      await db.run('DELETE FROM trail_sessions WHERE id = ?', [key])
    },
  }
}

const DEFERRED_MEMBERS = 'deferred_trail_tag_members:'
async function deferTagMembership(db: DatabaseAdapter, tagId: string, sessionId: string): Promise<void> {
  const row = await db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [DEFERRED_MEMBERS + tagId])
  const list = new Set<string>(row ? (JSON.parse(row.value) as string[]) : [])
  list.add(sessionId)
  await db.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [DEFERRED_MEMBERS + tagId, JSON.stringify([...list])])
}
async function applyDeferredMemberships(db: DatabaseAdapter, tagId: string): Promise<void> {
  const row = await db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [DEFERRED_MEMBERS + tagId])
  if (!row) return
  for (const sessionId of JSON.parse(row.value) as string[]) {
    if (await db.get('SELECT 1 FROM trail_sessions WHERE id = ?', [sessionId])) {
      await db.run('INSERT OR IGNORE INTO trail_tag_members (tag_id, trail_session_id, created_at) VALUES (?, ?, ?)', [tagId, sessionId, Date.now()])
    }
  }
  await db.run('DELETE FROM sync_state WHERE key = ?', [DEFERRED_MEMBERS + tagId])
}

/** The registry of synced entities — the authoritative list of what leaves the device. */
export function createEntityRegistry(): Map<string, EntityAdapter> {
  const list: EntityAdapter[] = [
    tableEntity({ kind: 'note', table: 'notes', dependents: ['note_version'] }),
    tableEntity({ kind: 'note_folder', table: 'note_folders', dependents: ['note_folder', 'note'] }),
    tableEntity({ kind: 'note_version', table: 'note_versions' }),
    tableEntity({ kind: 'highlight', table: 'highlights' }),
    verseTagEntity(),
    tableEntity({
      kind: 'verse_tag_member', table: 'verse_tag_members',
      afterUpsert: rebuildMemberVerses,
      beforeDelete: async (db, key) => { await db.run('DELETE FROM verse_tag_verse WHERE member_id = ?', [key]) },
    }),
    tableEntity({ kind: 'tag_edge', table: 'tag_edges' }),
    tableEntity({ kind: 'workspace', table: 'workspaces' }),
    tableEntity({ kind: 'session', table: 'sessions', tombstoneColumn: 'deleted_at' }),
    tableEntity({ kind: 'tab', table: 'tabs', tombstoneColumn: 'deleted_at', exclude: ['local_state_json'] }),
    tableEntity({ kind: 'archived_group', table: 'archived_groups', tombstoneColumn: 'deleted_at' }),
    playlistEntity(),
    // Phase 9 extras (docs/mobile/icloud.md §5)
    tableEntity({ kind: 'ai_chat', table: 'ai_chats' }),
    // PDF metadata only — the bytes never enter the journal; `filename` is `<id>.pdf` on every
    // device and the platform's list/get reports whether the file is present locally.
    tableEntity({ kind: 'pdf', table: 'pdfs', dependents: ['pdf_highlight', 'pdf_bookmark'] }),
    tableEntity({ kind: 'pdf_highlight', table: 'pdf_highlights' }),
    tableEntity({ kind: 'pdf_bookmark', table: 'pdf_bookmarks' }),
    tableEntity({
      kind: 'youtube_user', table: 'youtube_user', idColumn: 'video_id',
      afterUpsert: (db, key) => mirrorYoutubeUserRow(db, key),
      beforeDelete: async (db, key) => { await db.run('DELETE FROM youtube_user WHERE video_id = ?', [key]); await mirrorYoutubeUserRow(db, key) },
    }),
    trailSessionEntity(),
    tableEntity({ kind: 'trail_node', table: 'trail_nodes', dependents: ['trail_connection'] }),
    tableEntity({ kind: 'trail_connection', table: 'trail_connections' }),
    tableEntity({ kind: 'trail_note', table: 'trail_notes' }),
    tableEntity({ kind: 'trail_tag', table: 'trail_tags', dependents: ['trail_session'], afterUpsert: (db, key) => applyDeferredMemberships(db, key) }),
  ]
  return new Map(list.map((e) => [e.kind, e]))
}

/** Which `data:changed` entities map to which sync entity (identity unless renamed). */
export const SYNCED_ENTITY_KINDS = new Set([
  'note', 'note_folder', 'note_version', 'highlight', 'verse_tag', 'verse_tag_member', 'tag_edge', 'workspace',
  'session', 'tab', 'archived_group', 'playlist',
  'ai_chat', 'pdf', 'pdf_highlight', 'pdf_bookmark', 'youtube_user',
  'trail_session', 'trail_node', 'trail_connection', 'trail_note', 'trail_tag',
])
