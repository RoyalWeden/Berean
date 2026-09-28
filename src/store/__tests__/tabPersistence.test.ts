import { describe, it, expect } from 'vitest'
import { assignOrderKeys, buildSnapshot, hydrateFromRows, emptyKeyMaps, effectiveSessions } from '../tabPersistence'
import { makeContext, migratedUserDb } from '../../platform/db/__tests__/testDb'
import { createSessionsService } from '../../platform/services/sessionsService'
import type { Session } from '../index'
import type { Tab } from '../../types'

const bibleTab = (id: string, chapter: number, over: Partial<Tab> = {}): Tab => ({
  id, spaceId: 'scripture', type: 'bible', title: `Gen ${chapter}`,
  state: { bookId: 'GEN', chapter, translation: 'kjva', showStrongs: false, scrollPosition: chapter * 100, rightPanelWidth: 300 },
  ...over,
})
const noteTab = (id: string, noteId: string): Tab => ({ id, spaceId: 'notes', type: 'note', title: 'Note', state: { noteId, isNew: false, scrollTop: 12 } })

function session(id: string, name: string, tabs: Tab[]): Session {
  const grouped = { scripture: [], notes: [], lexicon: [], youtube: [], search: [] } as Session['tabs']
  for (const t of tabs) grouped[t.spaceId].push(t)
  return { id, name, tabs: grouped, activeTabId: { scripture: grouped.scripture[0]?.id ?? null, notes: grouped.notes[0]?.id ?? null, lexicon: null, youtube: null, search: null } }
}

describe('assignOrderKeys', () => {
  it('reuses existing keys and only mints keys for moved/new ids', () => {
    const first = assignOrderKeys(['a', 'b', 'c'], new Map())
    expect([...first.values()]).toEqual([...first.values()].slice().sort())
    // append
    const appended = assignOrderKeys(['a', 'b', 'c', 'd'], first)
    for (const id of ['a', 'b', 'c']) expect(appended.get(id)).toBe(first.get(id))
    expect(appended.get('d')! > appended.get('c')!).toBe(true)
    // move c to the front: only c changes
    const moved = assignOrderKeys(['c', 'a', 'b', 'd'], appended)
    expect(moved.get('a')).toBe(appended.get('a'))
    expect(moved.get('b')).toBe(appended.get('b'))
    expect(moved.get('d')).toBe(appended.get('d'))
    expect(moved.get('c')! < moved.get('a')!).toBe(true)
    // remove b: nothing else changes
    const removed = assignOrderKeys(['c', 'a', 'd'], moved)
    expect(removed.get('c')).toBe(moved.get('c'))
    expect(removed.get('a')).toBe(moved.get('a'))
    expect(removed.get('d')).toBe(moved.get('d'))
    // result is always strictly increasing in list order
    const ids = ['c', 'a', 'd']
    for (let i = 1; i < ids.length; i++) expect(removed.get(ids[i - 1])! < removed.get(ids[i])!).toBe(true)
  })
})

describe('buildSnapshot ⇄ hydrateFromRows through sessionsService', () => {
  it('round-trips sessions, per-space order, unified display order, pinned/origin, sync vs local state, active tabs and archived groups', async () => {
    const t1 = bibleTab('t1', 1, { isPinned: true })
    const t2 = bibleTab('t2', 2, { originTabId: 't1', originSpaceId: 'scripture' })
    const n1 = noteTab('n1', 'note-a')
    const s1 = session('s1', 'Session 1', [t1, t2, n1])
    const s2 = session('s2', 'Study', [bibleTab('t3', 3)])
    s2.icon = '📖'
    s2.tabFilter = 'bible'
    const state = {
      sessions: [s1, s2], currentSessionId: 's1', tabs: s1.tabs, activeTabId: { ...s1.activeTabId, scripture: 't2' },
      sessionDisplayOrders: { s1: ['n1', 't2', 't1'] },
      archivedGroups: [{ id: 'g1', label: 'Old', archivedAt: 42, tabs: [bibleTab('old', 9)] }],
    }
    const built = buildSnapshot(state)
    expect(built.snapshot.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(built.snapshot.tabs.map((t) => t.id).sort()).toEqual(['n1', 't1', 't2', 't3'])
    const t2row = built.snapshot.tabs.find((t) => t.id === 't2')!
    expect(JSON.parse(t2row.sync_state_json)).toEqual({ bookId: 'GEN', chapter: 2, translation: 'kjva', showStrongs: false })
    expect(JSON.parse(t2row.local_state_json!)).toEqual({ scrollPosition: 200, rightPanelWidth: 300 })
    expect(t2row.origin_tab_id).toBe('t1')
    // display order keys follow sessionDisplayOrders: n1 < t2 < t1
    const dk = (id: string): string => built.snapshot.tabs.find((t) => t.id === id)!.display_order_key
    expect(dk('n1') < dk('t2') && dk('t2') < dk('t1')).toBe(true)
    // per-space keys follow array order: t1 < t2
    const ok = (id: string): string => built.snapshot.tabs.find((t) => t.id === id)!.order_key
    expect(ok('t1') < ok('t2')).toBe(true)

    const svc = createSessionsService(makeContext({ userDb: await migratedUserDb() }))
    await svc.applySnapshot(built.snapshot)
    for (const [sid, active] of built.localState) await svc.setLocalState(sid as string, active)

    const local = new Map<string, Record<string, string | null>>()
    for (const s of await svc.listSessions()) local.set(s.id, await svc.getLocalState(s.id))
    const hydrated = hydrateFromRows(await svc.listSessions(), await svc.listTabs(), await svc.listArchivedGroups(), local)

    expect(hydrated.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(hydrated.sessions[1]).toMatchObject({ icon: '📖', tabFilter: 'bible' })
    expect(hydrated.sessions[0].tabs.scripture.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(hydrated.sessions[0].tabs.notes.map((t) => t.id)).toEqual(['n1'])
    expect(hydrated.sessionDisplayOrders.s1).toEqual(['n1', 't2', 't1'])
    expect(hydrated.sessions[0].tabs.scripture[0].isPinned).toBe(true)
    expect(hydrated.sessions[0].tabs.scripture[1]).toMatchObject({ originTabId: 't1', originSpaceId: 'scripture' })
    expect(hydrated.sessions[0].tabs.scripture[1].state).toEqual(t2.state)   // sync + local re-merged
    expect(hydrated.sessions[0].activeTabId.scripture).toBe('t2')            // from session_local_state
    expect(hydrated.sessions[0].activeTabId.notes).toBe('n1')
    expect(hydrated.archivedGroups).toEqual(state.archivedGroups)
    // the keys come back so the next snapshot reuses them (no churn)
    const again = buildSnapshot({ ...state, sessions: hydrated.sessions, tabs: hydrated.sessions[0].tabs, sessionDisplayOrders: hydrated.sessionDisplayOrders, archivedGroups: hydrated.archivedGroups }, hydrated.keys)
    const diff = await svc.applySnapshot(again.snapshot)
    expect(diff.upserted).toEqual({ sessions: 0, tabs: 0, archivedGroups: 0 })
    expect(diff.tombstoned).toEqual({ sessions: 0, tabs: 0, archivedGroups: 0 })
  })

  it('a closed tab is tombstoned and a re-opened id revives; corrupt state JSON hydrates to an empty state', async () => {
    const svc = createSessionsService(makeContext({ userDb: await migratedUserDb() }))
    const s1 = session('s1', 'S', [bibleTab('t1', 1), bibleTab('t2', 2)])
    const base = { sessions: [s1], currentSessionId: 's1', tabs: s1.tabs, activeTabId: s1.activeTabId, sessionDisplayOrders: {}, archivedGroups: [] }
    const b1 = buildSnapshot(base)
    await svc.applySnapshot(b1.snapshot)
    const closed = { ...base, tabs: { ...s1.tabs, scripture: [s1.tabs.scripture[0]] } }
    const b2 = buildSnapshot(closed, b1.keys)
    const d = await svc.applySnapshot(b2.snapshot)
    expect(d.tombstoned.tabs).toBe(1)
    expect((await svc.listTabs()).map((t) => t.id)).toEqual(['t1'])
    await svc.applySnapshot(buildSnapshot(base, b2.keys).snapshot)
    expect((await svc.listTabs()).map((t) => t.id).sort()).toEqual(['t1', 't2'])
    // corrupt JSON in a row
    await svc.upsertTab({ id: 'bad', session_id: 's1', space_id: 'scripture', type: 'bible', title: 'x', is_pinned: 0, order_key: 'a9', display_order_key: 'a9', origin_tab_id: null, origin_space_id: null, sync_state_json: '{not json', local_state_json: '{}' })
    const h = hydrateFromRows(await svc.listSessions(), await svc.listTabs(), [], new Map())
    expect(h.sessions[0].tabs.scripture.find((t) => t.id === 'bad')!.state).toEqual({})
  })

  it('effectiveSessions folds the live tabs/activeTabId of the current session in', () => {
    const s1 = session('s1', 'S', [bibleTab('t1', 1)])
    const live = { ...s1.tabs, scripture: [bibleTab('t1', 1), bibleTab('t9', 9)] }
    const eff = effectiveSessions({ sessions: [s1], currentSessionId: 's1', tabs: live, activeTabId: { ...s1.activeTabId, scripture: 't9' } })
    expect(eff[0].tabs.scripture.map((t) => t.id)).toEqual(['t1', 't9'])
    expect(eff[0].activeTabId.scripture).toBe('t9')
    expect(emptyKeyMaps().tabs.size).toBe(0)
  })
})
