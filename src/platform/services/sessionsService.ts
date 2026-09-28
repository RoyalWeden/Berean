import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'

/**
 * Sessions (Arc-style tab groups), tabs and archived tab groups in SQLite — the durable, syncable
 * home for what the zustand store used to keep only in localStorage (docs/mobile/decisions.md
 * D-006, docs/mobile/database.md v43). The store keeps its shape; src/store/tabPersistence.ts
 * mirrors it into these rows and hydrates from them at startup.
 *
 * Rows carry `updated_at` + `deleted_at` so the sync engine (Phase 6+) can journal them; the
 * device-local `session_local_state` (active tab per space) is never journaled.
 */
export interface SessionRow {
  id: string
  name: string
  icon: string | null
  tab_filter: string | null
  order_key: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface TabRow {
  id: string
  session_id: string
  space_id: string
  type: string
  title: string
  is_pinned: number
  order_key: string
  display_order_key: string
  origin_tab_id: string | null
  origin_space_id: string | null
  sync_state_json: string
  local_state_json: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface ArchivedGroupRow {
  id: string
  label: string
  archived_at: number
  tabs_json: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export type SessionUpsert = Omit<SessionRow, 'created_at' | 'updated_at' | 'deleted_at'>
export type TabUpsert = Omit<TabRow, 'created_at' | 'updated_at' | 'deleted_at' | 'local_state_json'> & { local_state_json?: string }
export type ArchivedGroupUpsert = Omit<ArchivedGroupRow, 'created_at' | 'updated_at' | 'deleted_at'>

export interface SessionsSnapshot {
  sessions: SessionUpsert[]
  tabs: TabUpsert[]
  archivedGroups: ArchivedGroupUpsert[]
}

export interface SnapshotDiff { upserted: { sessions: number; tabs: number; archivedGroups: number }; tombstoned: { sessions: number; tabs: number; archivedGroups: number } }

export function createSessionsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  // ── reads ──────────────────────────────────────────────────────────────────────────────────
  async function listSessions(): Promise<SessionRow[]> {
    return db().all<SessionRow>('SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY order_key, id')
  }
  async function listTabs(sessionId?: string): Promise<TabRow[]> {
    return sessionId
      ? db().all<TabRow>('SELECT * FROM tabs WHERE session_id = ? AND deleted_at IS NULL ORDER BY order_key, id', [sessionId])
      : db().all<TabRow>('SELECT * FROM tabs WHERE deleted_at IS NULL ORDER BY session_id, order_key, id')
  }
  async function listArchivedGroups(): Promise<ArchivedGroupRow[]> {
    return db().all<ArchivedGroupRow>('SELECT * FROM archived_groups WHERE deleted_at IS NULL ORDER BY archived_at DESC, id')
  }
  async function getLocalState(sessionId: string): Promise<Record<string, string | null>> {
    const row = await db().get<{ active_tab_json: string }>('SELECT active_tab_json FROM session_local_state WHERE session_id = ?', [sessionId])
    try { return row ? JSON.parse(row.active_tab_json) : {} } catch { return {} }
  }
  async function hasAny(): Promise<boolean> {
    const row = await db().get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')
    return (row?.n ?? 0) > 0
  }

  // ── writes ─────────────────────────────────────────────────────────────────────────────────
  async function upsertSessionWith(h: DatabaseAdapter, s: SessionUpsert, now: number): Promise<boolean> {
    const cur = await h.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [s.id])
    if (cur && cur.deleted_at === null && cur.name === s.name && (cur.icon ?? null) === (s.icon ?? null) && (cur.tab_filter ?? null) === (s.tab_filter ?? null) && cur.order_key === s.order_key) return false
    await h.run(`INSERT INTO sessions (id, name, icon, tab_filter, order_key, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, tab_filter = excluded.tab_filter, order_key = excluded.order_key, updated_at = excluded.updated_at, deleted_at = NULL`,
      [s.id, s.name, s.icon ?? null, s.tab_filter ?? null, s.order_key, cur?.created_at ?? now, now])
    return true
  }

  async function upsertTabWith(h: DatabaseAdapter, t: TabUpsert, now: number): Promise<boolean> {
    const cur = await h.get<TabRow>('SELECT * FROM tabs WHERE id = ?', [t.id])
    const local = t.local_state_json ?? cur?.local_state_json ?? '{}'
    if (cur && cur.deleted_at === null && cur.session_id === t.session_id && cur.space_id === t.space_id && cur.type === t.type && cur.title === t.title
      && cur.is_pinned === t.is_pinned && cur.order_key === t.order_key && cur.display_order_key === t.display_order_key
      && (cur.origin_tab_id ?? null) === (t.origin_tab_id ?? null) && (cur.origin_space_id ?? null) === (t.origin_space_id ?? null)
      && cur.sync_state_json === t.sync_state_json && cur.local_state_json === local) return false
    // Only a change to synced fields bumps updated_at; local-only changes keep the sync clock still.
    const syncChanged = !cur || cur.deleted_at !== null || cur.session_id !== t.session_id || cur.space_id !== t.space_id || cur.type !== t.type || cur.title !== t.title
      || cur.is_pinned !== t.is_pinned || cur.order_key !== t.order_key || cur.display_order_key !== t.display_order_key
      || (cur.origin_tab_id ?? null) !== (t.origin_tab_id ?? null) || (cur.origin_space_id ?? null) !== (t.origin_space_id ?? null) || cur.sync_state_json !== t.sync_state_json
    await h.run(`INSERT INTO tabs (id, session_id, space_id, type, title, is_pinned, order_key, display_order_key, origin_tab_id, origin_space_id, sync_state_json, local_state_json, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, space_id = excluded.space_id, type = excluded.type, title = excluded.title, is_pinned = excluded.is_pinned,
        order_key = excluded.order_key, display_order_key = excluded.display_order_key, origin_tab_id = excluded.origin_tab_id, origin_space_id = excluded.origin_space_id,
        sync_state_json = excluded.sync_state_json, local_state_json = excluded.local_state_json, updated_at = excluded.updated_at, deleted_at = NULL`,
      [t.id, t.session_id, t.space_id, t.type, t.title, t.is_pinned, t.order_key, t.display_order_key, t.origin_tab_id ?? null, t.origin_space_id ?? null, t.sync_state_json, local, cur?.created_at ?? now, syncChanged ? now : (cur?.updated_at ?? now)])
    return true
  }

  async function upsertArchivedGroupWith(h: DatabaseAdapter, g: ArchivedGroupUpsert, now: number): Promise<boolean> {
    const cur = await h.get<ArchivedGroupRow>('SELECT * FROM archived_groups WHERE id = ?', [g.id])
    if (cur && cur.deleted_at === null && cur.label === g.label && cur.archived_at === g.archived_at && cur.tabs_json === g.tabs_json) return false
    await h.run(`INSERT INTO archived_groups (id, label, archived_at, tabs_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, archived_at = excluded.archived_at, tabs_json = excluded.tabs_json, updated_at = excluded.updated_at, deleted_at = NULL`,
      [g.id, g.label, g.archived_at, g.tabs_json, cur?.created_at ?? now, now])
    return true
  }

  async function upsertSession(s: SessionUpsert): Promise<void> {
    if (await upsertSessionWith(db(), s, ctx.now())) ctx.events.emit('data:changed', { entity: 'session', id: s.id, op: 'upsert' })
  }
  async function upsertTab(t: TabUpsert): Promise<void> {
    if (await upsertTabWith(db(), t, ctx.now())) ctx.events.emit('data:changed', { entity: 'tab', id: t.id, op: 'upsert' })
  }
  async function deleteSession(id: string): Promise<void> {
    const now = ctx.now()
    await db().transaction(async (tx) => {
      await tx.run('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id])
      await tx.run('UPDATE tabs SET deleted_at = ?, updated_at = ? WHERE session_id = ? AND deleted_at IS NULL', [now, now, id])
    })
    ctx.events.emit('data:changed', { entity: 'session', id, op: 'delete' })
  }
  async function deleteTab(id: string): Promise<void> {
    const now = ctx.now()
    await db().run('UPDATE tabs SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id])
    ctx.events.emit('data:changed', { entity: 'tab', id, op: 'delete' })
  }
  async function setLocalState(sessionId: string, activeTab: Record<string, string | null>): Promise<void> {
    await db().run('INSERT INTO session_local_state (session_id, active_tab_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET active_tab_json = excluded.active_tab_json, updated_at = excluded.updated_at',
      [sessionId, JSON.stringify(activeTab), ctx.now()])
  }

  /**
   * Make the tables match a full snapshot of the store's sessions/tabs/archived groups: upsert
   * what differs, tombstone rows missing from the snapshot. One transaction, so a crash mid-way
   * never leaves half a session. Returns counts so the mirror can log churn.
   */
  async function applySnapshot(snap: SessionsSnapshot): Promise<SnapshotDiff> {
    const now = ctx.now()
    const diff: SnapshotDiff = { upserted: { sessions: 0, tabs: 0, archivedGroups: 0 }, tombstoned: { sessions: 0, tabs: 0, archivedGroups: 0 } }
    const changed: Array<{ entity: string; id: string; op: 'upsert' | 'delete' }> = []
    await db().transaction(async (tx) => {
      const keepSessions = new Set(snap.sessions.map((s) => s.id))
      const keepTabs = new Set(snap.tabs.map((t) => t.id))
      const keepGroups = new Set(snap.archivedGroups.map((g) => g.id))
      for (const s of snap.sessions) if (await upsertSessionWith(tx, s, now)) { diff.upserted.sessions++; changed.push({ entity: 'session', id: s.id, op: 'upsert' }) }
      for (const t of snap.tabs) if (await upsertTabWith(tx, t, now)) { diff.upserted.tabs++; changed.push({ entity: 'tab', id: t.id, op: 'upsert' }) }
      for (const g of snap.archivedGroups) if (await upsertArchivedGroupWith(tx, g, now)) { diff.upserted.archivedGroups++; changed.push({ entity: 'archived_group', id: g.id, op: 'upsert' }) }
      for (const row of await tx.all<{ id: string }>('SELECT id FROM sessions WHERE deleted_at IS NULL')) {
        if (!keepSessions.has(row.id)) { await tx.run('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, row.id]); diff.tombstoned.sessions++; changed.push({ entity: 'session', id: row.id, op: 'delete' }) }
      }
      for (const row of await tx.all<{ id: string }>('SELECT id FROM tabs WHERE deleted_at IS NULL')) {
        if (!keepTabs.has(row.id)) { await tx.run('UPDATE tabs SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, row.id]); diff.tombstoned.tabs++; changed.push({ entity: 'tab', id: row.id, op: 'delete' }) }
      }
      for (const row of await tx.all<{ id: string }>('SELECT id FROM archived_groups WHERE deleted_at IS NULL')) {
        if (!keepGroups.has(row.id)) { await tx.run('UPDATE archived_groups SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, row.id]); diff.tombstoned.archivedGroups++; changed.push({ entity: 'archived_group', id: row.id, op: 'delete' }) }
      }
    })
    for (const c of changed) ctx.events.emit('data:changed', { entity: c.entity, id: c.id, op: c.op })
    return diff
  }

  /** Physically remove tombstones older than `olderThanMs` (after every device has applied them — Phase 6 decides when). */
  async function purgeTombstones(olderThanMs: number): Promise<number> {
    const cutoff = ctx.now() - olderThanMs
    let n = 0
    for (const table of ['sessions', 'tabs', 'archived_groups'] as const) {
      n += (await db().run(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff])).changes
    }
    return n
  }

  return { listSessions, listTabs, listArchivedGroups, getLocalState, hasAny, upsertSession, upsertTab, deleteSession, deleteTab, setLocalState, applySnapshot, purgeTombstones }
}

export type SessionsService = ReturnType<typeof createSessionsService>
