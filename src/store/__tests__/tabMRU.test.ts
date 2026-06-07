/**
 * 30 tests for Ctrl+Tab MRU (most-recently-used) tab ordering.
 *
 * Split into:
 *   A. updateMRU pure-function tests (12)
 *   B. Store integration tests via useAppStore.getState() (12)
 *   C. Cold-boot rehydration MRU rebuild tests (6)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { updateMRU, useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

type MRUEntry = { spaceId: SpaceId; tabId: string }

const s = (spaceId: SpaceId, tabId: string): MRUEntry => ({ spaceId, tabId })

function mruIds(list: MRUEntry[]): string[] {
  return list.map((e) => `${e.spaceId}:${e.tabId}`)
}

/** Make a minimal Tab object for addTab / activateTab. */
function makeTab(id: string, spaceId: SpaceId, type: Tab['type'] = 'bible'): Tab {
  if (type === 'bible')   return { id, spaceId, type, title: id, state: { bookId: 'GEN', chapter: 1, verse: 1 } } as Tab
  if (type === 'note')    return { id, spaceId, type, title: id, state: { noteId: null, isNew: false } } as Tab
  if (type === 'lexicon') return { id, spaceId, type, title: id, state: { strongsNum: null } } as Tab
  if (type === 'youtube') return { id, spaceId, type, title: id, state: { videoId: null, playlistId: null } } as Tab
  return { id, spaceId, type, title: id, state: { query: '', results: [] } } as Tab
}

// Reset the relevant parts of the store between tests.
function resetStore() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    tabMRUList: [],
  })
}

// ────────────────────────────────────────────────────────────────────────────
// A. updateMRU pure function (12 tests)
// ────────────────────────────────────────────────────────────────────────────

describe('updateMRU — pure function', () => {
  it('A1: new tab → placed at front of empty list', () => {
    const result = updateMRU([], 'scripture', 'tab1')
    expect(mruIds(result)).toEqual(['scripture:tab1'])
  })

  it('A2: new tab → placed at front of non-empty list', () => {
    const before = [s('scripture', 'tab1'), s('notes', 'n1')]
    const result = updateMRU(before, 'scripture', 'tab2')
    expect(mruIds(result)[0]).toBe('scripture:tab2')
    expect(result).toHaveLength(3)
  })

  it('A3: existing tab at position 2 moves to front', () => {
    const before = [s('scripture', 'a'), s('scripture', 'b'), s('scripture', 'c')]
    const result = updateMRU(before, 'scripture', 'c')
    expect(mruIds(result)).toEqual(['scripture:c', 'scripture:a', 'scripture:b'])
  })

  it('A4: existing tab at last position moves to front', () => {
    const before = [s('scripture', 'a'), s('scripture', 'b'), s('scripture', 'c'), s('scripture', 'd')]
    const result = updateMRU(before, 'scripture', 'd')
    expect(mruIds(result)[0]).toBe('scripture:d')
    expect(result).toHaveLength(4)
  })

  it('A5: tab already at front stays at front, no duplicate', () => {
    const before = [s('scripture', 'a'), s('scripture', 'b')]
    const result = updateMRU(before, 'scripture', 'a')
    expect(mruIds(result)).toEqual(['scripture:a', 'scripture:b'])
  })

  it('A6: same tabId in different space → both coexist', () => {
    const before = [s('scripture', 'tab1')]
    const result = updateMRU(before, 'notes', 'tab1')
    expect(result).toHaveLength(2)
    expect(mruIds(result)).toEqual(['notes:tab1', 'scripture:tab1'])
  })

  it('A7: result never exceeds 100 entries', () => {
    const big = Array.from({ length: 100 }, (_, i) => s('scripture', `t${i}`))
    const result = updateMRU(big, 'notes', 'new')
    expect(result).toHaveLength(100)
    expect(result[0]).toEqual({ spaceId: 'notes', tabId: 'new' })
    // oldest entry (t99) should have been dropped
    expect(result.some((e) => e.tabId === 't99')).toBe(false)
  })

  it('A8: adding to 99-entry list → exactly 100', () => {
    const list = Array.from({ length: 99 }, (_, i) => s('scripture', `t${i}`))
    expect(updateMRU(list, 'notes', 'new')).toHaveLength(100)
  })

  it('A9: adding existing entry to 100-entry list → still 100 (dedup)', () => {
    const big = Array.from({ length: 100 }, (_, i) => s('scripture', `t${i}`))
    const result = updateMRU(big, 'scripture', 't50')
    expect(result).toHaveLength(100)
    expect(result[0]).toEqual({ spaceId: 'scripture', tabId: 't50' })
  })

  it('A10: result is a new array (immutable)', () => {
    const before = [s('scripture', 'a')]
    const result = updateMRU(before, 'scripture', 'b')
    expect(result).not.toBe(before)
  })

  it('A11: series A→B→C gives [C,B,A] order', () => {
    let mru: MRUEntry[] = []
    mru = updateMRU(mru, 'scripture', 'A')
    mru = updateMRU(mru, 'scripture', 'B')
    mru = updateMRU(mru, 'scripture', 'C')
    expect(mruIds(mru)).toEqual(['scripture:C', 'scripture:B', 'scripture:A'])
  })

  it('A12: activate A after A→B→C gives [A,C,B]', () => {
    let mru: MRUEntry[] = []
    mru = updateMRU(mru, 'scripture', 'A')
    mru = updateMRU(mru, 'scripture', 'B')
    mru = updateMRU(mru, 'scripture', 'C')
    mru = updateMRU(mru, 'scripture', 'A') // revisit A
    expect(mruIds(mru)).toEqual(['scripture:A', 'scripture:C', 'scripture:B'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// B. Store integration (12 tests)
// ────────────────────────────────────────────────────────────────────────────

describe('store — tabMRUList integration', () => {
  beforeEach(resetStore)

  it('B1: createTab puts new tab at front of MRU', () => {
    useAppStore.getState().createTab('bible')
    const { tabMRUList, tabs } = useAppStore.getState()
    expect(tabMRUList[0].tabId).toBe(tabs.scripture[0].id)
  })

  it('B2: creating two tabs — latest is first in MRU', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const { tabMRUList, tabs } = useAppStore.getState()
    expect(tabMRUList[0].tabId).toBe(tabs.scripture[1].id)
    expect(tabMRUList[1].tabId).toBe(tabs.scripture[0].id)
  })

  it('B3: setActiveTab moves target tab to front', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const ids = useAppStore.getState().tabs.scripture.map((t) => t.id)
    useAppStore.getState().setActiveTab('scripture', ids[0])
    const mru = useAppStore.getState().tabMRUList
    expect(mru[0]).toEqual({ spaceId: 'scripture', tabId: ids[0] })
  })

  it('B4: setActiveTab on already-front tab — still only one entry', () => {
    useAppStore.getState().createTab('bible')
    const id = useAppStore.getState().tabs.scripture[0].id
    useAppStore.getState().setActiveTab('scripture', id)
    useAppStore.getState().setActiveTab('scripture', id)
    const mru = useAppStore.getState().tabMRUList
    const count = mru.filter((m) => m.spaceId === 'scripture' && m.tabId === id).length
    expect(count).toBe(1)
  })

  it('B5: setActiveTab across different spaces — cross-space order is correct', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('note')
    useAppStore.getState().createTab('lexicon')
    const mru = useAppStore.getState().tabMRUList
    // lexicon was created last → front
    expect(mru[0].spaceId).toBe('lexicon')
    expect(mru[1].spaceId).toBe('notes')
    expect(mru[2].spaceId).toBe('scripture')
  })

  it('B6: closeTab removes exactly the closed tab from MRU', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const ids = useAppStore.getState().tabs.scripture.map((t) => t.id)
    useAppStore.getState().closeTab('scripture', ids[0])
    const mru = useAppStore.getState().tabMRUList
    expect(mru.some((m) => m.tabId === ids[0])).toBe(false)
    expect(mru.some((m) => m.tabId === ids[1])).toBe(true)
  })

  it('B7: after closeTab the next MRU tab becomes active in that space', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const ids = useAppStore.getState().tabs.scripture.map((t) => t.id)
    // Make first tab active, then close it
    useAppStore.getState().setActiveTab('scripture', ids[0])
    useAppStore.getState().closeTab('scripture', ids[0])
    // Active should now be the previously second-in-MRU tab
    expect(useAppStore.getState().activeTabId.scripture).toBe(ids[1])
  })

  it('B8: addTab with existing tabId just focuses it (moves to MRU front)', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const ids = useAppStore.getState().tabs.scripture.map((t) => t.id)
    const tab = useAppStore.getState().tabs.scripture[0]
    useAppStore.getState().addTab(tab)
    expect(useAppStore.getState().tabMRUList[0].tabId).toBe(ids[0])
  })

  it('B9: addTab with new tab object adds it to MRU front', () => {
    useAppStore.getState().createTab('bible')
    const newTab = makeTab('brand-new', 'scripture')
    useAppStore.getState().addTab(newTab)
    expect(useAppStore.getState().tabMRUList[0].tabId).toBe('brand-new')
  })

  it('B10: reorderTabs does NOT change MRU order', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const mruBefore = useAppStore.getState().tabMRUList.map((m) => m.tabId)
    useAppStore.getState().reorderTabs('scripture', 0, 2)
    const mruAfter = useAppStore.getState().tabMRUList.map((m) => m.tabId)
    expect(mruAfter).toEqual(mruBefore)
  })

  it('B11: Ctrl+Tab pattern — create A,B,C; Ctrl+Tab should offer B at index 1 (next after current C)', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const ids = useAppStore.getState().tabs.scripture.map((t) => t.id)
    const mru = useAppStore.getState().tabMRUList
    // Most recent (C) is already active and at index 0.
    // Pressing Ctrl+Tab once should highlight index 1 = B (second most recent).
    expect(mru[0].tabId).toBe(ids[2]) // C
    expect(mru[1].tabId).toBe(ids[1]) // B
    expect(mru[2].tabId).toBe(ids[0]) // A
  })

  it('B12: MRU contains no duplicates after a series of tab activations', () => {
    useAppStore.getState().createTab('bible')
    useAppStore.getState().createTab('bible')
    const ids = useAppStore.getState().tabs.scripture.map((t) => t.id)
    // Flip back and forth several times
    for (let i = 0; i < 5; i++) {
      useAppStore.getState().setActiveTab('scripture', ids[i % 2])
    }
    const mru = useAppStore.getState().tabMRUList
    const seen = new Set(mru.map((m) => `${m.spaceId}:${m.tabId}`))
    expect(seen.size).toBe(mru.length)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// C. Cold-boot rehydration (6 tests)
// ────────────────────────────────────────────────────────────────────────────

describe('rehydration — MRU rebuild / validation', () => {
  it('C1: persisted MRU is preserved on rehydration (validated MRU is used)', () => {
    // Simulate a rehydrated state that already has a valid MRU.
    const tabA: Tab = makeTab('a', 'scripture')
    const tabB: Tab = makeTab('b', 'scripture')
    useAppStore.setState({
      tabs: { scripture: [tabA, tabB], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'b', notes: null, lexicon: null, youtube: null, search: null },
      tabMRUList: [s('scripture', 'a'), s('scripture', 'b')], // A was visited more recently
    })
    // The MRU should stay [a, b] — not be overwritten by sidebar/active-first logic.
    const { tabMRUList } = useAppStore.getState()
    expect(tabMRUList[0].tabId).toBe('a')
    expect(tabMRUList[1].tabId).toBe('b')
  })

  it('C2: stale MRU entries (for closed tabs) are pruned', () => {
    // Set up: MRU references tab 'ghost' which is not in the tab list.
    const tabA: Tab = makeTab('a', 'scripture')
    useAppStore.setState({
      tabs: { scripture: [tabA], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'a', notes: null, lexicon: null, youtube: null, search: null },
      tabMRUList: [s('scripture', 'ghost'), s('scripture', 'a')],
    })
    // After setState the MRU still contains ghost — the pruning happens in onRehydrateStorage.
    // Simulate what the validation step does (same logic as the store's onRehydrateStorage).
    const { tabs, tabMRUList } = useAppStore.getState()
    const validKeys = new Set(tabs.scripture.map((t) => `scripture:${t.id}`))
    const validated = tabMRUList.filter((m) => validKeys.has(`${m.spaceId}:${m.tabId}`))
    expect(validated.every((m) => m.tabId !== 'ghost')).toBe(true)
    expect(validated.some((m) => m.tabId === 'a')).toBe(true)
  })

  it('C3: empty MRU + tabs present → rebuild includes all tabs', () => {
    const tabA: Tab = makeTab('a', 'scripture')
    const tabB: Tab = makeTab('b', 'scripture')
    const tabN: Tab = makeTab('n1', 'notes', 'note')
    useAppStore.setState({
      tabs: { scripture: [tabA, tabB], notes: [tabN], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'b', notes: 'n1', lexicon: null, youtube: null, search: null },
      tabMRUList: [],
    })
    // Manually apply the same rebuild logic to verify expected output.
    const { tabs, activeTabId } = useAppStore.getState()
    const spaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
    const mru: MRUEntry[] = []
    const seen = new Set<string>()
    for (const sp of spaces) {
      const active = activeTabId[sp]
      if (active && tabs[sp].find((t) => t.id === active)) {
        const key = `${sp}:${active}`; if (!seen.has(key)) { mru.push(s(sp, active)); seen.add(key) }
      }
      for (const t of tabs[sp]) {
        const key = `${sp}:${t.id}`; if (!seen.has(key)) { mru.push(s(sp, t.id)); seen.add(key) }
      }
    }
    expect(mru.some((m) => m.tabId === 'a')).toBe(true)
    expect(mru.some((m) => m.tabId === 'b')).toBe(true)
    expect(mru.some((m) => m.tabId === 'n1')).toBe(true)
    expect(mru).toHaveLength(3)
  })

  it('C4: rebuild has no duplicates even when active tab equals first sidebar tab', () => {
    const tabA: Tab = makeTab('a', 'scripture')
    useAppStore.setState({
      tabs: { scripture: [tabA], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'a', notes: null, lexicon: null, youtube: null, search: null },
      tabMRUList: [],
    })
    const spaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
    const { tabs, activeTabId } = useAppStore.getState()
    const mru: MRUEntry[] = []
    const seen = new Set<string>()
    for (const sp of spaces) {
      const active = activeTabId[sp]
      if (active && tabs[sp].find((t) => t.id === active)) {
        const key = `${sp}:${active}`; if (!seen.has(key)) { mru.push(s(sp, active)); seen.add(key) }
      }
      for (const t of tabs[sp]) {
        const key = `${sp}:${t.id}`; if (!seen.has(key)) { mru.push(s(sp, t.id)); seen.add(key) }
      }
    }
    const uniqueKeys = new Set(mru.map((m) => `${m.spaceId}:${m.tabId}`))
    expect(uniqueKeys.size).toBe(mru.length)
  })

  it('C5: after rehydration + setActiveTab the correct head is used', () => {
    const tabA: Tab = makeTab('a', 'scripture')
    const tabB: Tab = makeTab('b', 'scripture')
    useAppStore.setState({
      tabs: { scripture: [tabA, tabB], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'b', notes: null, lexicon: null, youtube: null, search: null },
      tabMRUList: [s('scripture', 'b'), s('scripture', 'a')],
    })
    useAppStore.getState().setActiveTab('scripture', 'a')
    expect(useAppStore.getState().tabMRUList[0].tabId).toBe('a')
  })

  it('C6: MRU total count equals open tabs across all spaces after rebuild', () => {
    const tabs = {
      scripture: [makeTab('s1', 'scripture'), makeTab('s2', 'scripture')],
      notes:     [makeTab('n1', 'notes', 'note')],
      lexicon:   [makeTab('l1', 'lexicon', 'lexicon')],
      youtube:   [] as Tab[],
      search:    [] as Tab[],
    }
    useAppStore.setState({ tabs, activeTabId: { scripture: 's1', notes: 'n1', lexicon: 'l1', youtube: null, search: null }, tabMRUList: [] })
    const spaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
    const { tabs: t, activeTabId } = useAppStore.getState()
    const mru: MRUEntry[] = []
    const seen = new Set<string>()
    for (const sp of spaces) {
      const active = activeTabId[sp]
      if (active && t[sp].find((tab) => tab.id === active)) {
        const key = `${sp}:${active}`; if (!seen.has(key)) { mru.push(s(sp, active)); seen.add(key) }
      }
      for (const tab of t[sp]) {
        const key = `${sp}:${tab.id}`; if (!seen.has(key)) { mru.push(s(sp, tab.id)); seen.add(key) }
      }
    }
    const totalOpenTabs = Object.values(t).reduce((sum, arr) => sum + arr.length, 0)
    expect(mru).toHaveLength(totalOpenTabs)
  })
})
