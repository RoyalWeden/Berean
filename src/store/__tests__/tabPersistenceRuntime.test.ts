import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAppStore } from '@/store'
import { installTabPersistence, applyExternalSessions, __resetTabPersistence } from '@/store/tabPersistenceRuntime'
import { createSessionsService } from '@/platform/services/sessionsService'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import type { SpaceId, Tab } from '@/types'

/**
 * The runtime mirror against the REAL store and the REAL sessionsService (in-memory SQLite),
 * with `window.sessions` stubbed to the service exactly like the preload/iOS bridge do.
 */
function bibleTab(id: string, chapter: number): Tab {
  return { id, spaceId: 'scripture' as SpaceId, type: 'bible', title: `Gen ${chapter}`, state: { bookId: 'GEN', chapter, translation: 'kjva', showStrongs: false, scrollPosition: chapter * 10 } } as Tab
}

function resetStore() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    currentSessionId: 'default',
    sessions: [{ id: 'default', name: 'Session 1', tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }, activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null } }],
    sessionDisplayOrders: {},
    archivedGroups: [],
    tabMRUList: [],
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle() { await wait(600) }   // > DEBOUNCE_MS

let svc: ReturnType<typeof createSessionsService>
let teardown: () => void = () => {}

beforeEach(async () => {
  __resetTabPersistence()
  resetStore()
  svc = createSessionsService(makeContext({ userDb: await migratedUserDb() }))
  ;(window as unknown as { sessions: unknown }).sessions = {
    hasAny: () => svc.hasAny(), listSessions: () => svc.listSessions(), listTabs: (id?: string) => svc.listTabs(id),
    listArchivedGroups: () => svc.listArchivedGroups(), getLocalState: (id: string) => svc.getLocalState(id),
    setLocalState: (id: string, a: Record<string, string | null>) => svc.setLocalState(id, a),
    applySnapshot: (snap: Parameters<typeof svc.applySnapshot>[0]) => svc.applySnapshot(snap),
    upsertSession: (s: Parameters<typeof svc.upsertSession>[0]) => svc.upsertSession(s), upsertTab: (t: Parameters<typeof svc.upsertTab>[0]) => svc.upsertTab(t),
    deleteSession: (id: string) => svc.deleteSession(id), deleteTab: (id: string) => svc.deleteTab(id),
  }
})
afterEach(() => { teardown(); delete (window as unknown as { sessions?: unknown }).sessions })

describe('installTabPersistence', () => {
  it('legacy import: an empty table takes the localStorage-restored store, then mirrors later changes', async () => {
    useAppStore.getState().addTab(bibleTab('t1', 1), 'end')
    useAppStore.getState().addTab(bibleTab('t2', 2), 'end')
    expect(await svc.hasAny()).toBe(false)
    teardown = installTabPersistence()
    await settle()
    expect((await svc.listSessions()).map((s) => s.id)).toEqual(['default'])
    expect((await svc.listTabs()).map((t) => t.id)).toEqual(['t1', 't2'])
    expect(await svc.getLocalState('default')).toMatchObject({ scripture: 't2' })

    // a later change is mirrored (debounced)
    useAppStore.getState().addTab(bibleTab('t3', 3), 'end')
    useAppStore.getState().closeTab('scripture', 't1')
    await settle()
    const rows = await svc.listTabs()
    expect(rows.map((t) => t.id)).toEqual(['t2', 't3'])
    expect(JSON.parse(rows[1].sync_state_json)).toMatchObject({ bookId: 'GEN', chapter: 3 })
    expect(JSON.parse(rows[1].local_state_json)).toMatchObject({ scrollPosition: 30 })
    // the store itself was not disturbed
    expect(useAppStore.getState().tabs.scripture.map((t) => t.id)).toEqual(['t2', 't3'])
  })

  it('hydrates from existing rows on the next launch, preserving this window\'s session and active tab', async () => {
    // First "launch": import
    useAppStore.getState().addTab(bibleTab('t1', 1), 'end')
    useAppStore.getState().addTab(bibleTab('t2', 2), 'end')
    useAppStore.getState().createSession('Study')
    useAppStore.getState().addTab(bibleTab('s1', 5), 'end')
    teardown = installTabPersistence()
    await settle()
    teardown()
    __resetTabPersistence()
    const sessionIds = (await svc.listSessions()).map((s) => s.id)
    expect(sessionIds.length).toBe(2)
    const studyId = useAppStore.getState().currentSessionId

    // Second "launch": localStorage lost everything (fresh store) but the rows are there
    resetStore()
    useAppStore.setState({ currentSessionId: studyId, sessions: [{ id: studyId, name: 'stale', tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }, activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null } }] })
    teardown = installTabPersistence()
    await settle()
    const st = useAppStore.getState()
    expect(st.sessions.map((s) => s.id)).toEqual(sessionIds)
    expect(st.currentSessionId).toBe(studyId)
    expect(st.tabs.scripture.map((t) => t.id)).toEqual(['s1'])
    expect(st.activeTabId.scripture).toBe('s1')
    expect(st.sessions.find((s) => s.id === 'default')!.tabs.scripture.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(st.sessions.find((s) => s.id === 'default')!.name).toBe('Session 1')
  })

  it('applyExternalSessions adopts structure from the rows but keeps this device\'s local view state', async () => {
    useAppStore.getState().addTab(bibleTab('t1', 1), 'end')
    teardown = installTabPersistence()
    await settle()
    // Simulate a remote device: a new tab row appears and t1 moved to chapter 7 with a different scroll.
    const t1 = (await svc.listTabs()).find((t) => t.id === 't1')!
    await svc.upsertTab({ ...t1, sync_state_json: JSON.stringify({ bookId: 'GEN', chapter: 7, translation: 'kjva', showStrongs: true }), local_state_json: JSON.stringify({ scrollPosition: 999 }) })
    await svc.upsertTab({ id: 'remote', session_id: 'default', space_id: 'scripture', type: 'bible', title: 'Exo 1', is_pinned: 0, order_key: 'a5', display_order_key: 'a5', origin_tab_id: null, origin_space_id: null, sync_state_json: JSON.stringify({ bookId: 'EXO', chapter: 1, translation: 'kjva', showStrongs: false }), local_state_json: '{}' })
    // meanwhile this device scrolled t1
    useAppStore.getState().updateTabState('scripture', 't1', { scrollPosition: 55 })
    await applyExternalSessions()
    const st = useAppStore.getState()
    expect(st.tabs.scripture.map((t) => t.id)).toEqual(['t1', 'remote'])
    const local = st.tabs.scripture[0].state as { chapter: number; showStrongs: boolean; scrollPosition: number }
    expect(local.chapter).toBe(7)          // synced field adopted
    expect(local.showStrongs).toBe(true)
    expect(local.scrollPosition).toBe(55)  // this device's newer local view state wins over the mirrored row
  })
})
