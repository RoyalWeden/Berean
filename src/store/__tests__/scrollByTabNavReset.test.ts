/**
 * A scripture nav that resets scrollPosition to 0 (navigate(), cross-ref jump, verse jump,
 * translation switch — they all pass `scrollPosition: 0` through updateTabState) must also
 * drop the tab's live scrollByTab entry. Otherwise scrollByTab keeps the PREVIOUS chapter's
 * pixel offset and, since the restore paths now prefer scrollByTab over the canonical value,
 * the freshly-opened chapter would be restored to the old chapter's offset on the next
 * tab switch.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { Tab } from '@/types'

function bibleTab(id: string): Tab {
  return { id, spaceId: 'scripture', type: 'bible', title: id, state: { bookId: 'GEN', chapter: 1 } } as Tab
}

beforeEach(() => {
  useAppStore.setState({
    tabs: { scripture: [bibleTab('a')], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: 'a', notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture',
    scrollByTab: {},
    tabNavStacks: {},
  })
})

describe('scrollByTab cleared on scripture nav reset', () => {
  it('drops the live offset when a navigation writes scrollPosition: 0', () => {
    useAppStore.setState((s) => ({ scrollByTab: { ...s.scrollByTab, a: 1400 } }))

    useAppStore.getState().updateTabState('scripture', 'a', {
      bookId: 'EXO', chapter: 20, scrollPosition: 0, targetVerse: undefined,
    })

    expect(useAppStore.getState().scrollByTab.a).toBeUndefined()
    expect((useAppStore.getState().tabs.scripture[0].state as { scrollPosition?: number }).scrollPosition).toBe(0)
  })

  it('leaves the live offset untouched for a non-zero / scroll-only update', () => {
    useAppStore.setState((s) => ({ scrollByTab: { ...s.scrollByTab, a: 1400 } }))

    useAppStore.getState().updateTabState('scripture', 'a', { showStrongs: true })
    expect(useAppStore.getState().scrollByTab.a).toBe(1400)

    useAppStore.getState().updateTabState('scripture', 'a', { scrollPosition: 900 })
    expect(useAppStore.getState().scrollByTab.a).toBe(1400)
  })

  it('does not touch scrollByTab for non-scripture spaces', () => {
    useAppStore.setState((s) => ({
      tabs: { ...s.tabs, notes: [{ id: 'n', spaceId: 'notes', type: 'note', title: 'n', state: { noteId: null } } as Tab] },
      activeTabId: { ...s.activeTabId, notes: 'n' },
      scrollByTab: { ...s.scrollByTab, n: 500 },
    }))

    useAppStore.getState().updateTabState('notes', 'n', { scrollTop: 0 } as never)
    expect(useAppStore.getState().scrollByTab.n).toBe(500)
  })
})
