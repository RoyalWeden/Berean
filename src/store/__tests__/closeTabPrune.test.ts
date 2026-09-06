/**
 * Closing a tab must drop every per-tab-keyed slice of store state for that tab id —
 * otherwise a long session with heavy tab churn slowly accretes orphaned nav stacks,
 * verse selections, scroll offsets and last-accessed timestamps.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'

function makeBibleTab(id: string, spaceId: SpaceId = 'scripture'): Tab {
  return { id, spaceId, type: 'bible', title: id, state: { bookId: 'GEN', chapter: 1, verse: 1 } } as Tab
}

function seedPerTabState(tabId: string, spaceId: SpaceId = 'scripture') {
  useAppStore.setState((s) => ({
    tabNavStacks: { ...s.tabNavStacks, [tabId]: { stack: [], idx: -1 } },
    selectedVersesByTab: { ...s.selectedVersesByTab, [tabId]: [{ bookId: 'GEN', chapter: 1, verse: 1 }] as never },
    scrollByTab: { ...s.scrollByTab, [tabId]: 123 },
    tabLastAccessed: { ...s.tabLastAccessed, [`${spaceId}:${tabId}`]: Date.now() },
  }))
}

beforeEach(() => {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    tabMRUList: [],
    tabNavStacks: {},
    selectedVersesByTab: {},
    scrollByTab: {},
    tabLastAccessed: {},
    noteFocusModeTabId: null,
  })
})

describe('closeTab per-tab state pruning', () => {
  it('drops nav stack, selection, scroll and last-accessed for an inactive closed tab', () => {
    useAppStore.setState({
      tabs: { scripture: [makeBibleTab('a'), makeBibleTab('b')], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'a', notes: null, lexicon: null, youtube: null, search: null },
    })
    seedPerTabState('a'); seedPerTabState('b')

    useAppStore.getState().closeTab('scripture', 'b') // 'b' is not active

    const st = useAppStore.getState()
    expect(st.tabNavStacks.b).toBeUndefined()
    expect(st.selectedVersesByTab.b).toBeUndefined()
    expect(st.scrollByTab.b).toBeUndefined()
    expect(st.tabLastAccessed['scripture:b']).toBeUndefined()
    // untouched for the surviving tab
    expect(st.scrollByTab.a).toBe(123)
    expect(st.tabLastAccessed['scripture:a']).toBeDefined()
  })

  it('drops per-tab state when closing the ACTIVE tab', () => {
    useAppStore.setState({
      tabs: { scripture: [makeBibleTab('a'), makeBibleTab('b')], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'b', notes: null, lexicon: null, youtube: null, search: null },
    })
    seedPerTabState('a'); seedPerTabState('b')

    useAppStore.getState().closeTab('scripture', 'b') // active

    const st = useAppStore.getState()
    expect(st.tabNavStacks.b).toBeUndefined()
    expect(st.selectedVersesByTab.b).toBeUndefined()
    expect(st.scrollByTab.b).toBeUndefined()
    expect(st.tabLastAccessed['scripture:b']).toBeUndefined()
  })

  it('closeActiveTab also prunes per-tab state', () => {
    useAppStore.setState({
      tabs: { scripture: [makeBibleTab('a'), makeBibleTab('b')], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'b', notes: null, lexicon: null, youtube: null, search: null },
      activeSpace: 'scripture',
    })
    seedPerTabState('a'); seedPerTabState('b')

    useAppStore.getState().closeActiveTab()

    const st = useAppStore.getState()
    expect(st.tabNavStacks.b).toBeUndefined()
    expect(st.selectedVersesByTab.b).toBeUndefined()
    expect(st.scrollByTab.b).toBeUndefined()
    expect(st.tabLastAccessed['scripture:b']).toBeUndefined()
  })

  it('clears noteFocusModeTabId when its tab is closed', () => {
    useAppStore.setState({
      tabs: { scripture: [], notes: [makeBibleTab('n1', 'notes')], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: 'n1', lexicon: null, youtube: null, search: null },
      activeSpace: 'notes',
      noteFocusModeTabId: 'n1',
    })

    useAppStore.getState().closeTab('notes', 'n1')

    expect(useAppStore.getState().noteFocusModeTabId).toBeNull()
  })
})
