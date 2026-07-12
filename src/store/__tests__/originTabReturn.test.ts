import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'

// "Open in new tab" actions (cross-reference verses, idiom notes, wikilinked
// notes, search results) now stamp originTabId/originSpaceId onto the new
// tab. TopBar's back button, once a tab's own nav stack is exhausted, reads
// those fields to close the detour tab and refocus whatever tab it came
// from — this covers the store-level half of that (closeTab + activateTab
// composing correctly), independent of TopBar's own canGoBack/onClick wiring.

function makeBibleTab(id: string, extra: Partial<Tab> = {}): Tab {
  return {
    id, spaceId: 'scripture' as SpaceId, type: 'bible', title: id,
    state: { bookId: 'GEN', chapter: 1, translation: 'KJV', showStrongs: false, scrollPosition: 0 },
    ...extra,
  } as Tab
}

function resetStore() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    tabNavStacks: {},
    tabMRUList: [],
  })
}

describe('origin-tab tracking for "open in new tab" actions', () => {
  beforeEach(resetStore)

  it('addTab preserves originTabId/originSpaceId passed on the tab object', () => {
    const origin = makeBibleTab('origin')
    useAppStore.getState().addTab(origin)
    const detour = makeBibleTab('detour', { originTabId: 'origin', originSpaceId: 'scripture' })
    useAppStore.getState().addTab(detour)

    const stored = useAppStore.getState().tabs.scripture.find((t) => t.id === 'detour')
    expect(stored?.originTabId).toBe('origin')
    expect(stored?.originSpaceId).toBe('scripture')
  })

  it('closing the detour tab and activating its origin returns focus there', () => {
    const origin = makeBibleTab('origin')
    useAppStore.getState().addTab(origin)
    const detour = makeBibleTab('detour', { originTabId: 'origin', originSpaceId: 'scripture' })
    useAppStore.getState().addTab(detour)
    expect(useAppStore.getState().activeTabId.scripture).toBe('detour')

    // Same sequence TopBar's back button runs once canNavBack is false but
    // an originTab was resolved.
    useAppStore.getState().closeTab('scripture', 'detour')
    useAppStore.getState().activateTab(origin)

    const state = useAppStore.getState()
    expect(state.activeTabId.scripture).toBe('origin')
    expect(state.tabs.scripture.some((t) => t.id === 'detour')).toBe(false)
    expect(state.tabs.scripture.some((t) => t.id === 'origin')).toBe(true)
  })

  it('a plain "new tab" with no origin fields has none set', () => {
    const plain = makeBibleTab('plain')
    useAppStore.getState().addTab(plain)
    const stored = useAppStore.getState().tabs.scripture.find((t) => t.id === 'plain')
    expect(stored?.originTabId).toBeUndefined()
    expect(stored?.originSpaceId).toBeUndefined()
  })
})
