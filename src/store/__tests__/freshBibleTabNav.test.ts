import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'

// Regression test for a real bug: clicking a Lexicon occurrence (or anything else that calls
// ensureTab('bible') then immediately navigates a freshly-created Bible tab) used to fabricate
// TWO tabNavStacks entries from one navigation — createTab() seeds a brand-new Bible tab with a
// hardcoded GEN/1 placeholder state, and updateTabState()'s "seed the stack with the current
// position if it's empty" logic treated that placeholder as a real prior visit, pushing it as an
// origin entry before pushing the actual destination. Back/forward then walked between the
// fabricated GEN/1 stop and the real destination instead of the tab having the single, correct
// history entry a genuine first navigation should produce. See freshlyCreatedBibleTabIds and its
// consumption in updateTabState (src/store/index.ts) for the fix.

function resetStore() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    tabNavStacks: {},
    tabMRUList: [],
  })
}

describe('a freshly-created Bible tab does not fabricate a phantom nav-stack origin', () => {
  beforeEach(resetStore)

  it('ensureTab("bible") + immediate updateTabState produces exactly one nav-stack entry', () => {
    const store = useAppStore.getState()
    // Mirrors LexiconPanel.tsx's navToVerse: ensureTab creates the tab (scripture space starts
    // empty), then the caller navigates it to a real destination in the same tick.
    store.ensureTab('bible')
    const tabId = useAppStore.getState().activeTabId.scripture
    expect(tabId).toBeTruthy()

    useAppStore.getState().updateTabState('scripture', tabId!, {
      bookId: 'MAT', chapter: 12, targetVerse: 3, scrollPosition: 0, translation: 'LXX',
    })

    const stack = useAppStore.getState().tabNavStacks[tabId!]
    expect(stack).toBeTruthy()
    expect(stack.stack).toHaveLength(1)
    expect(stack.stack[0].bookId).toBe('MAT')
    expect(stack.stack[0].chapter).toBe(12)
  })

  it('a SECOND navigation on the same tab still seeds a real origin (the fix only skips the first, placeholder one)', () => {
    const store = useAppStore.getState()
    store.ensureTab('bible')
    const tabId = useAppStore.getState().activeTabId.scripture!

    useAppStore.getState().updateTabState('scripture', tabId, { bookId: 'MAT', chapter: 12, scrollPosition: 0 })
    useAppStore.getState().updateTabState('scripture', tabId, { bookId: 'JHN', chapter: 3, scrollPosition: 0 })

    const stack = useAppStore.getState().tabNavStacks[tabId].stack
    expect(stack).toHaveLength(2)
    expect(stack[0].bookId).toBe('MAT')
    expect(stack[0].chapter).toBe(12)
    expect(stack[1].bookId).toBe('JHN')
    expect(stack[1].chapter).toBe(3)
  })

  it('a scrollPosition-only update right after creation does not burn the "fresh" flag before the real navigation arrives', () => {
    const store = useAppStore.getState()
    store.ensureTab('bible')
    const tabId = useAppStore.getState().activeTabId.scripture!

    // Simulates a scroll-restore/target-verse effect ticking scrollPosition before the actual
    // book/chapter navigation call runs — must not itself be treated as "the first real update"
    // (it changes neither book nor chapter nor translation, so it isn't a navigation at all).
    useAppStore.getState().updateTabState('scripture', tabId, { scrollPosition: 42 })
    expect(useAppStore.getState().tabNavStacks[tabId]).toBeUndefined()

    useAppStore.getState().updateTabState('scripture', tabId, { bookId: 'MAT', chapter: 12, scrollPosition: 0 })
    const stack = useAppStore.getState().tabNavStacks[tabId].stack
    expect(stack).toHaveLength(1)
    expect(stack[0].bookId).toBe('MAT')
  })

  it('reusing an EXISTING Bible tab (ensureTab finds one, does not create a second) is unaffected', () => {
    const store = useAppStore.getState()
    store.ensureTab('bible') // creates the first tab, lands it on the GEN/1 placeholder
    const tabId = useAppStore.getState().activeTabId.scripture!
    useAppStore.getState().updateTabState('scripture', tabId, { bookId: 'MAT', chapter: 12, scrollPosition: 0 })

    useAppStore.getState().ensureTab('bible')
    expect(useAppStore.getState().tabs.scripture).toHaveLength(1)

    useAppStore.getState().updateTabState('scripture', tabId, { bookId: 'JHN', chapter: 3, scrollPosition: 0 })
    const stack = useAppStore.getState().tabNavStacks[tabId].stack
    expect(stack).toHaveLength(2)
    expect(stack[0].bookId).toBe('MAT')
    expect(stack[1].bookId).toBe('JHN')
  })
})
