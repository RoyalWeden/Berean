import type { AppState, Session, ArchivedGroup } from './index'
import type { SpaceId, Tab, TabType } from '../types'
import type { ArchivedGroupRow, SessionRow, SessionsSnapshot, TabRow } from '../platform/services/sessionsService'
import { splitTabState, mergeTabState, stableJson, isKnownTabType } from '../platform/sync/tabFields'
import { keyBetween } from '../platform/sync/fractional'

/**
 * Sessions / tabs / archived groups ⇄ SQLite (docs/mobile/decisions.md D-006).
 *
 * The zustand store keeps its shape and its localStorage persistence exactly as before; this
 * module mirrors the tab structure into the `sessions` / `tabs` / `archived_groups` tables
 * (through `window.sessions`, the same API on desktop and iPhone) and hydrates the store from
 * those rows at startup. Those rows — with stable ids, fractional order keys, `updated_at` and
 * tombstones — are what the sync engine journals (Phase 6+).
 *
 * Pure functions (`buildSnapshot`, `hydrateFromRows`, `assignOrderKeys`) are separated from the
 * runtime installer so they can be unit-tested without a store or a DB.
 */

export const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']

export interface OrderKeyMaps {
  /** session id → order_key */
  sessions: Map<string, string>
  /** tab id → order_key (within its space) */
  tabs: Map<string, string>
  /** tab id → display_order_key (unified per-session order) */
  display: Map<string, string>
}

export function emptyKeyMaps(): OrderKeyMaps {
  return { sessions: new Map(), tabs: new Map(), display: new Map() }
}

/**
 * Assign fractional order keys to `ids` in the given order, reusing existing keys wherever they
 * already form an increasing sequence and generating new keys only for the ids that moved. This
 * keeps sync churn to "the record that moved" for the common single-move / append cases.
 */
export function assignOrderKeys(ids: readonly string[], existing: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  // Greedy: keep an existing key when it is greater than the last kept key AND smaller than
  // every existing key of an id that comes later (otherwise keeping it would force those to move).
  const later: (string | undefined)[] = new Array(ids.length)
  let minLater: string | undefined
  for (let i = ids.length - 1; i >= 0; i--) {
    later[i] = minLater
    const k = existing.get(ids[i])
    if (k !== undefined && (minLater === undefined || k < minLater)) minLater = k
  }
  const kept: (string | undefined)[] = new Array(ids.length)
  let last: string | undefined
  for (let i = 0; i < ids.length; i++) {
    const k = existing.get(ids[i])
    if (k !== undefined && (last === undefined || k > last) && (later[i] === undefined || k < later[i]!)) {
      kept[i] = k
      last = k
    }
  }
  // Fill the gaps between kept keys.
  let prev: string | undefined
  for (let i = 0; i < ids.length; i++) {
    if (kept[i] !== undefined) { out.set(ids[i], kept[i]!); prev = kept[i]; continue }
    let next: string | undefined
    for (let j = i + 1; j < ids.length; j++) if (kept[j] !== undefined) { next = kept[j]; break }
    const k = keyBetween(prev, next)
    out.set(ids[i], k)
    prev = k
  }
  return out
}

/** The store's sessions with the live current-session tabs folded in (what `partialize` does). */
export function effectiveSessions(state: Pick<AppState, 'sessions' | 'currentSessionId' | 'tabs' | 'activeTabId'>): Session[] {
  return state.sessions.map((s) => (s.id === state.currentSessionId ? { ...s, tabs: state.tabs, activeTabId: state.activeTabId } : s))
}

export interface BuiltSnapshot {
  snapshot: SessionsSnapshot
  keys: OrderKeyMaps
  /** session id → active tab per space (device-local) */
  localState: Map<string, Record<string, string | null>>
}

export function buildSnapshot(
  state: Pick<AppState, 'sessions' | 'currentSessionId' | 'tabs' | 'activeTabId' | 'sessionDisplayOrders' | 'archivedGroups'>,
  prev: OrderKeyMaps = emptyKeyMaps(),
): BuiltSnapshot {
  const sessions = effectiveSessions(state)
  const keys = emptyKeyMaps()
  keys.sessions = assignOrderKeys(sessions.map((s) => s.id), prev.sessions)

  const snapshot: SessionsSnapshot = { sessions: [], tabs: [], archivedGroups: [] }
  const localState = new Map<string, Record<string, string | null>>()

  for (const s of sessions) {
    snapshot.sessions.push({
      id: s.id, name: s.name, icon: s.icon ?? null, tab_filter: s.tabFilter ?? null, order_key: keys.sessions.get(s.id)!,
    })
    localState.set(s.id, { ...(s.activeTabId ?? {}) })

    const allTabs: Tab[] = []
    for (const sp of SPACES) {
      const list = (s.tabs?.[sp] ?? []).filter((t): t is Tab => !!t && typeof t === 'object' && typeof t.id === 'string')
      const spaceKeys = assignOrderKeys(list.map((t) => t.id), prev.tabs)
      for (const [id, k] of spaceKeys) keys.tabs.set(id, k)
      allTabs.push(...list)
    }
    // Unified display order: the stored order first (only ids that still exist), then any tab
    // missing from it in space order — exactly how computeInsertOrder() treats a stale list.
    const present = new Set(allTabs.map((t) => t.id))
    const stored = (state.sessionDisplayOrders?.[s.id] ?? []).filter((id) => present.has(id))
    const seen = new Set(stored)
    const displayIds = [...stored, ...allTabs.map((t) => t.id).filter((id) => !seen.has(id))]
    const displayKeys = assignOrderKeys(displayIds, prev.display)
    for (const [id, k] of displayKeys) keys.display.set(id, k)

    for (const t of allTabs) {
      const type: TabType = isKnownTabType(t.type) ? t.type : 'bible'
      const { sync, local } = splitTabState(type, t.state ?? ({} as Tab['state']))
      snapshot.tabs.push({
        id: t.id,
        session_id: s.id,
        space_id: t.spaceId,
        type: t.type,
        title: t.title ?? '',
        is_pinned: t.isPinned ? 1 : 0,
        order_key: keys.tabs.get(t.id)!,
        display_order_key: keys.display.get(t.id)!,
        origin_tab_id: t.originTabId ?? null,
        origin_space_id: t.originSpaceId ?? null,
        sync_state_json: stableJson(sync),
        local_state_json: stableJson(local),
      })
    }
  }

  for (const g of state.archivedGroups ?? []) {
    snapshot.archivedGroups.push({ id: g.id, label: g.label, archived_at: g.archivedAt, tabs_json: JSON.stringify(g.tabs ?? []) })
  }

  return { snapshot, keys, localState }
}

export interface HydratedState {
  sessions: Session[]
  sessionDisplayOrders: Record<string, string[]>
  archivedGroups: ArchivedGroup[]
  keys: OrderKeyMaps
}

/** Inverse of buildSnapshot: rows → store-shaped sessions (tabs grouped by space, ordered). */
export function hydrateFromRows(
  sessionRows: SessionRow[],
  tabRows: TabRow[],
  groupRows: ArchivedGroupRow[],
  localState: Map<string, Record<string, string | null>>,
): HydratedState {
  const keys = emptyKeyMaps()
  const byOrder = <T extends { id: string }>(rows: T[], key: (r: T) => string) =>
    [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const tabsBySession = new Map<string, TabRow[]>()
  for (const t of tabRows) {
    if (t.deleted_at !== null) continue
    const list = tabsBySession.get(t.session_id) ?? []
    list.push(t)
    tabsBySession.set(t.session_id, list)
  }

  const sessions: Session[] = []
  const sessionDisplayOrders: Record<string, string[]> = {}
  for (const s of byOrder(sessionRows.filter((r) => r.deleted_at === null), (r) => r.order_key)) {
    keys.sessions.set(s.id, s.order_key)
    const rows = tabsBySession.get(s.id) ?? []
    const tabs = { scripture: [], notes: [], lexicon: [], youtube: [], search: [] } as Record<SpaceId, Tab[]>
    for (const r of byOrder(rows, (r) => r.order_key)) {
      keys.tabs.set(r.id, r.order_key)
      keys.display.set(r.id, r.display_order_key)
      const type: TabType = isKnownTabType(r.type) ? r.type : 'bible'
      let sync: Record<string, unknown> = {}
      let local: Record<string, unknown> = {}
      try { sync = JSON.parse(r.sync_state_json) } catch { /* corrupt row → empty state, never a crash */ }
      try { local = JSON.parse(r.local_state_json) } catch { /* same */ }
      const tab: Tab = {
        id: r.id,
        spaceId: (SPACES.includes(r.space_id as SpaceId) ? r.space_id : 'scripture') as SpaceId,
        type: r.type as TabType,
        title: r.title,
        state: mergeTabState(type, sync, local),
        ...(r.is_pinned ? { isPinned: true } : {}),
        ...(r.origin_tab_id ? { originTabId: r.origin_tab_id } : {}),
        ...(r.origin_space_id ? { originSpaceId: r.origin_space_id as SpaceId } : {}),
      }
      tabs[tab.spaceId].push(tab)
    }
    sessionDisplayOrders[s.id] = byOrder(rows, (r) => r.display_order_key).map((r) => r.id)
    const active = localState.get(s.id) ?? {}
    const activeTabId = { scripture: null, notes: null, lexicon: null, youtube: null, search: null } as Record<SpaceId, string | null>
    for (const sp of SPACES) {
      const wanted = active[sp] ?? null
      activeTabId[sp] = wanted && tabs[sp].some((t) => t.id === wanted) ? wanted : (tabs[sp][0]?.id ?? null)
    }
    sessions.push({
      id: s.id, name: s.name, tabs, activeTabId,
      ...(s.icon ? { icon: s.icon } : {}),
      ...(s.tab_filter ? { tabFilter: s.tab_filter as Session['tabFilter'] } : {}),
    })
  }

  const archivedGroups: ArchivedGroup[] = []
  for (const g of groupRows) {
    if (g.deleted_at !== null) continue
    let tabs: Tab[] = []
    try { tabs = JSON.parse(g.tabs_json) } catch { /* corrupt → empty group */ }
    archivedGroups.push({ id: g.id, label: g.label, archivedAt: g.archived_at, tabs })
  }
  archivedGroups.sort((a, b) => b.archivedAt - a.archivedAt)

  return { sessions, sessionDisplayOrders, archivedGroups, keys }
}
