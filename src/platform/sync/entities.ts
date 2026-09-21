import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { placeholders } from '../db/DatabaseAdapter'
import { expandRanges, type TagRange } from '../services/verseTagsService'

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
  const exclude = new Set(o.exclude ?? [])
  return {
    kind: o.kind,
    async read(db, key) {
      const row = await db.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [key])
      if (!row) return undefined
      if (o.tombstoneColumn && row[o.tombstoneColumn] != null) return { fields: { [o.tombstoneColumn]: row[o.tombstoneColumn] }, deleted: true }
      const fields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) if (!exclude.has(k)) fields[k] = v
      return { fields }
    },
    async listKeys(db) {
      const where = o.tombstoneColumn ? ` WHERE ${assertIdent(o.tombstoneColumn)} IS NULL` : ''
      return (await db.all<{ id: string }>(`SELECT id FROM ${table}${where}`)).map((r) => r.id)
    },
    async applyUpsert(db, key, fields) {
      const cols = await tableColumns(db, table)
      const incoming: Record<string, unknown> = { ...fields, id: key }
      const use = cols.filter((c) => c in incoming && !exclude.has(c))
      if (!use.includes('id')) use.unshift('id')
      const values = use.map((c) => toSql(incoming[c]))
      const updates = use.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`)
      if (o.tombstoneColumn && !use.includes(o.tombstoneColumn)) updates.push(`${o.tombstoneColumn} = NULL`)
      await db.run(
        `INSERT INTO ${table} (${use.join(', ')}) VALUES (${placeholders(use.length)})
         ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`,
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
        await db.run(`UPDATE ${table} SET ${col} = ?${setUpdated} WHERE id = ? AND ${col} IS NULL`, [deletedAt, key])
      } else {
        await db.run(`DELETE FROM ${table} WHERE id = ?`, [key])
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
  const base = tableEntity({ kind: 'verse_tag', table: 'verse_tags' })
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

/** The registry of synced entities — the authoritative list of what leaves the device. */
export function createEntityRegistry(): Map<string, EntityAdapter> {
  const list: EntityAdapter[] = [
    tableEntity({ kind: 'note', table: 'notes' }),
    tableEntity({ kind: 'note_folder', table: 'note_folders' }),
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
  ]
  return new Map(list.map((e) => [e.kind, e]))
}

/** Which `data:changed` entities map to which sync entity (identity unless renamed). */
export const SYNCED_ENTITY_KINDS = new Set(['note', 'note_folder', 'note_version', 'highlight', 'verse_tag', 'verse_tag_member', 'tag_edge', 'workspace', 'session', 'tab', 'archived_group', 'playlist'])
