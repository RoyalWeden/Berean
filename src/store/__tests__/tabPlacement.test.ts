import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'

// Universal new-tab placement rule (computeInsertOrder in store/index.ts): createTab and addTab
// used to place new tabs inconsistently — createTab always inserted after the active tab,
// addTab always appended at the end, regardless of the calling gesture's actual intent. Both
// now share the same 'top' (default — top of the whole cross-space tab list) / 'after-active'
// (opt-in) / 'end' (double-click empty tab-bar space only) placement logic.

function makeBibleTab(id: string): Tab {
  return {
    id, spaceId: 'scripture' as SpaceId, type: 'bible', title: id,
    state: { bookId: 'GEN', chapter: 1, translation: 'KJV', showStrongs: false, scrollPosition: 0 },
  } as Tab
}

function resetStore() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    currentSessionId: 'default',
    sessionDisplayOrders: {},
    tabMRUList: [],
  })
}

describe('universal new-tab placement (createTab / addTab)', () => {
  beforeEach(resetStore)

  it('createTab defaults to inserting at the top of the whole tab list, not after the active tab', () => {
    const a = makeBibleTab('a'); const b = makeBibleTab('b'); const c = makeBibleTab('c')
    useAppStore.getState().addTab(a)
    useAppStore.getState().addTab(b)
    useAppStore.getState().addTab(c)
    // Active tab is whichever was added last (c) — activate 'a' instead, then createTab.
    useAppStore.getState().activateTab(a)
    useAppStore.getState().createTab('lexicon')
    const order = useAppStore.getState().sessionDisplayOrders.default
    const newTabId = useAppStore.getState().tabs.lexicon[0].id
    expect(order[0]).toBe(newTabId)
  })

  it('createTab(type, "after-active") opts back into inserting directly after the active tab', () => {
    const a = makeBibleTab('a'); const b = makeBibleTab('b'); const c = makeBibleTab('c')
    useAppStore.getState().addTab(a, 'end')
    useAppStore.getState().addTab(b, 'end')
    useAppStore.getState().addTab(c, 'end')
    useAppStore.getState().activateTab(a)
    useAppStore.getState().createTab('lexicon', 'after-active')
    const order = useAppStore.getState().sessionDisplayOrders.default
    const newTabId = useAppStore.getState().tabs.lexicon[0].id
    expect(order.indexOf(newTabId)).toBe(order.indexOf('a') + 1)
  })

  it('createTab(type, "end") appends at the very end regardless of the active tab', () => {
    const a = makeBibleTab('a'); const b = makeBibleTab('b')
    useAppStore.getState().addTab(a, 'end')
    useAppStore.getState().addTab(b, 'end')
    useAppStore.getState().activateTab(a)
    useAppStore.getState().createTab('lexicon', 'end')
    const order = useAppStore.getState().sessionDisplayOrders.default
    const newTabId = useAppStore.getState().tabs.lexicon[0].id
    expect(order[order.length - 1]).toBe(newTabId)
  })

  it('addTab defaults to inserting at the top of the whole tab list', () => {
    const a = makeBibleTab('a'); const b = makeBibleTab('b')
    useAppStore.getState().addTab(a)
    useAppStore.getState().addTab(b)
    useAppStore.getState().activateTab(a)
    const c = makeBibleTab('c')
    useAppStore.getState().addTab(c)
    const order = useAppStore.getState().sessionDisplayOrders.default
    expect(order[0]).toBe('c')
  })

  it('addTab(tab, "after-active") matches the old always-after-active behavior when opted into', () => {
    const a = makeBibleTab('a'); const b = makeBibleTab('b')
    useAppStore.getState().addTab(a, 'end')
    useAppStore.getState().addTab(b, 'end')
    useAppStore.getState().activateTab(a)
    const c = makeBibleTab('c')
    useAppStore.getState().addTab(c, 'after-active')
    const order = useAppStore.getState().sessionDisplayOrders.default
    expect(order.indexOf('c')).toBe(order.indexOf('a') + 1)
    expect(order[order.length - 1]).not.toBe('c') // not appended at the end — 'b' is still last
  })

  it('addTab(tab, "end") appends at the very end — the double-click-empty-space case', () => {
    const a = makeBibleTab('a'); const b = makeBibleTab('b')
    useAppStore.getState().addTab(a, 'end')
    useAppStore.getState().addTab(b, 'end')
    useAppStore.getState().activateTab(a)
    const c = makeBibleTab('c')
    useAppStore.getState().addTab(c, 'end')
    const order = useAppStore.getState().sessionDisplayOrders.default
    expect(order[order.length - 1]).toBe('c')
  })
})
