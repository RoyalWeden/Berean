import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import { buildWorkspaceState, parseWorkspaceState, workspaceSessionId } from '@/lib/workspaceSnapshot'
import { createWorkspacesService } from '@/platform/services/workspacesService'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import type { SpaceId, Tab, BibleTabState } from '@/types'

/**
 * Regression tests for the workspace-load fix (docs/mobile/implementation-progress.md Q4, brief §6):
 * a saved workspace must come back whole — tabs, per-space order, unified display order, per-tab
 * persistent state, active tabs, layout — through the real store and the real workspacesService,
 * for both the new v2 format and the legacy records that already exist in users' databases.
 */
function bibleTab(id: string, chapter: number, translation = 'kjva'): Tab {
  return { id, spaceId: 'scripture' as SpaceId, type: 'bible', title: `Gen ${chapter}`, state: { bookId: 'GEN', chapter, translation, showStrongs: chapter % 2 === 0, scrollPosition: chapter * 10 } } as Tab
}
function noteTab(id: string, noteId: string): Tab {
  return { id, spaceId: 'notes' as SpaceId, type: 'note', title: 'Note', state: { noteId, isNew: false } } as Tab
}
const layoutA = { direction: 'row', first: 'bible-panel', second: 'notes-panel', splitPercentage: 58 } as const
const layoutB = { direction: 'column', first: 'bible-panel', second: 'lexicon-panel', splitPercentage: 40 } as const

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
    panelLayout: layoutA as never,
  })
}

/** Exactly what WorkspacesSection.saveWorkspace does, minus the UI. */
function snapshotFromStore() {
  const st = useAppStore.getState()
  return {
    layoutJson: JSON.stringify(st.panelLayout),
    stateJson: JSON.stringify(buildWorkspaceState({
      tabs: st.tabs, activeTabId: st.activeTabId,
      displayOrder: st.sessionDisplayOrders[st.currentSessionId],
      icon: st.sessions.find((x) => x.id === st.currentSessionId)?.icon,
    })),
  }
}

describe('workspace save → close → reopen', () => {
  let svc: ReturnType<typeof createWorkspacesService>
  beforeEach(async () => {
    resetStore()
    svc = createWorkspacesService(makeContext({ userDb: await migratedUserDb() }))
  })

  it('restores tabs, per-space order, display order, tab state, active tabs and layout; reopening switches instead of duplicating', async () => {
    // 1. a workspace with multiple tabs, custom display order and a non-default layout
    const s = useAppStore.getState()
    s.addTab(bibleTab('t1', 1), 'end'); s.addTab(bibleTab('t2', 2, 'lxx'), 'end'); s.addTab(noteTab('n1', 'note-a'), 'end'); s.addTab(bibleTab('t3', 3), 'end')
    s.activateTab(bibleTab('t2', 2, 'lxx'))
    useAppStore.setState({ sessionDisplayOrders: { default: ['n1', 't3', 't1', 't2'] }, panelLayout: layoutB as never })
    useAppStore.getState().setSessionIcon('default', '📖')
    const snap = snapshotFromStore()
    const saved = await svc.save('Study set', snap.layoutJson, snap.stateJson)

    // 2. close it: switch away and delete the session; layout changes too
    useAppStore.getState().createSession('Other')
    useAppStore.getState().deleteSession('default')
    useAppStore.setState({ panelLayout: layoutA as never })
    expect(useAppStore.getState().tabs.scripture).toEqual([])

    // 3. reopen
    const row = (await svc.load(saved.id))!
    const parsed = parseWorkspaceState(row.state_json)
    expect(parsed.version).toBe(2)
    useAppStore.getState().openWorkspaceSession({ id: row.id, name: row.name }, parsed)
    useAppStore.getState().updatePanelLayout(JSON.parse(row.layout_json))

    const after = useAppStore.getState()
    // 4–6. tabs, ordering, state, active tabs
    expect(after.currentSessionId).toBe(workspaceSessionId(saved.id))
    expect(after.tabs.scripture.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(after.tabs.notes.map((t) => t.id)).toEqual(['n1'])
    expect(after.sessionDisplayOrders[after.currentSessionId]).toEqual(['n1', 't3', 't1', 't2'])
    expect(after.tabs.scripture[1].state).toEqual({ bookId: 'GEN', chapter: 2, translation: 'lxx', showStrongs: true, scrollPosition: 20 })
    expect(after.activeTabId.scripture).toBe('t2')
    expect(after.activeTabId.notes).toBe('n1')
    expect(after.sessions.find((x) => x.id === after.currentSessionId)).toMatchObject({ name: 'Study set', icon: '📖' })
    // 7. layout
    expect(after.panelLayout).toEqual(layoutB)
    // the session the user was on is intact
    expect(after.sessions.some((x) => x.name === 'Other')).toBe(true)

    // reopening again switches to the existing session (no duplicate)
    useAppStore.getState().switchSession(after.sessions.find((x) => x.name === 'Other')!.id)
    useAppStore.getState().openWorkspaceSession({ id: row.id, name: row.name }, parsed)
    const again = useAppStore.getState()
    expect(again.sessions.filter((x) => x.id === workspaceSessionId(saved.id)).length).toBe(1)
    expect(again.currentSessionId).toBe(workspaceSessionId(saved.id))
  })

  it('opening a workspace whose tab ids are still open elsewhere gives the restored copies fresh ids', () => {
    const s = useAppStore.getState()
    s.addTab(bibleTab('t1', 1), 'end')
    const snapshot = parseWorkspaceState(JSON.stringify(buildWorkspaceState({ tabs: useAppStore.getState().tabs, activeTabId: useAppStore.getState().activeTabId })))
    useAppStore.getState().openWorkspaceSession({ id: 'w1', name: 'W' }, snapshot)
    const after = useAppStore.getState()
    expect(after.tabs.scripture.length).toBe(1)
    expect(after.tabs.scripture[0].id).not.toBe('t1')
    expect((after.tabs.scripture[0].state as BibleTabState).chapter).toBe(1)
    expect(after.activeTabId.scripture).toBe(after.tabs.scripture[0].id)
    expect(after.sessions.find((x) => x.id === 'default')!.tabs.scripture[0].id).toBe('t1')
  })

  it('legacy records: v1 {tabs, activeTabId} restores tabs; NULL state_json restores layout only; garbage never throws', async () => {
    // v1 as written by the pre-migration desktop code
    const v1 = JSON.stringify({ tabs: { scripture: [bibleTab('a', 4)], notes: [], lexicon: [], youtube: [], search: [] }, activeTabId: { scripture: 'a', notes: null, lexicon: null, youtube: null, search: null } })
    const p1 = parseWorkspaceState(v1)
    expect(p1.version).toBe(1)
    expect(p1.tabs.scripture.map((t) => t.id)).toEqual(['a'])
    expect(p1.displayOrder).toEqual(['a'])
    useAppStore.getState().openWorkspaceSession({ id: 'legacy', name: 'Legacy' }, p1)
    expect(useAppStore.getState().tabs.scripture.map((t) => t.id)).toEqual(['a'])

    // pre-v9 row: state_json NULL (workspaces table gained the column in migration v9)
    const p0 = parseWorkspaceState(null)
    expect(p0.version).toBe(0)
    expect(p0.tabs.scripture).toEqual([])
    useAppStore.getState().openWorkspaceSession({ id: 'old', name: 'Old' }, p0)
    expect(useAppStore.getState().currentSessionId).toBe(workspaceSessionId('old'))
    expect(useAppStore.getState().tabs.scripture).toEqual([])

    // garbage
    for (const junk of ['{not json', '[]', '"str"', JSON.stringify({ tabs: { scripture: [{ id: 1 }, null, { id: 'ok', spaceId: 'scripture', type: 'bible', title: 't', state: {} }] } })]) {
      const p = parseWorkspaceState(junk)
      expect(Array.isArray(p.tabs.scripture)).toBe(true)
    }
    expect(parseWorkspaceState(JSON.stringify({ tabs: { scripture: [{ id: 'ok', spaceId: 'scripture', type: 'bible', title: 't', state: {} }] } })).tabs.scripture.map((t) => t.id)).toEqual(['ok'])
  })

  it('the saved v2 snapshot is the same plain Tab[] JSON the iPhone reads (no desktop-only fields required)', () => {
    const s = useAppStore.getState()
    s.addTab(bibleTab('t1', 1), 'end')
    const snap = JSON.parse(snapshotFromStore().stateJson) as { v: number; tabs: Record<string, unknown[]>; displayOrder: string[] }
    expect(snap.v).toBe(2)
    expect(Object.keys(snap.tabs).sort()).toEqual(['lexicon', 'notes', 'scripture', 'search', 'youtube'])
    expect(snap.displayOrder).toEqual(['t1'])
    // round-trips through the parser unchanged
    expect(parseWorkspaceState(JSON.stringify(snap)).tabs.scripture).toEqual(snap.tabs.scripture)
  })
})
