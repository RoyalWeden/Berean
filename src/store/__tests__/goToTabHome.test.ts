import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'

// goToTabHome (Round 5's "home button on Notes/Lexicon tabs" feature) repeats
// navTabBack() enough times to land on the synthetic idx-(-1) "home" entry —
// this covers the extracted store action directly, independent of the
// TabHeaderPortal UI that now calls it.

function makeNoteTab(id: string): Tab {
  return { id, spaceId: 'notes' as SpaceId, type: 'note', title: id, state: { noteId: null, isNew: false } } as Tab
}

function resetStore() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [makeNoteTab('n1')], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: null, notes: 'n1', lexicon: null, youtube: null, search: null },
    activeSpace: 'notes',
    tabNavStacks: {},
    notesHomeToken: 0,
  })
}

describe('goToTabHome', () => {
  beforeEach(resetStore)

  it('no-op when the active tab has no nav stack at all', () => {
    useAppStore.getState().goToTabHome()
    expect(useAppStore.getState().notesHomeToken).toBe(0)
  })

  it('walks a note tab back to idx -1 and bumps notesHomeToken', () => {
    useAppStore.setState({
      tabNavStacks: {
        n1: {
          stack: [
            { id: 'a', type: 'note', title: 'A', noteId: 'a' },
            { id: 'b', type: 'note', title: 'B', noteId: 'b' },
          ],
          idx: 1,
        },
      },
    })
    useAppStore.getState().goToTabHome()
    expect(useAppStore.getState().tabNavStacks.n1.idx).toBe(-1)
    expect(useAppStore.getState().notesHomeToken).toBe(1)
  })

  it('already at idx -1 is a no-op (does not bump the token again)', () => {
    useAppStore.setState({
      tabNavStacks: { n1: { stack: [{ id: 'a', type: 'note', title: 'A', noteId: 'a' }], idx: -1 } },
    })
    useAppStore.getState().goToTabHome()
    expect(useAppStore.getState().notesHomeToken).toBe(0)
  })

  it('a tab type with no home support (e.g. bible) is a total no-op — idx unchanged, no home token bumped', () => {
    useAppStore.setState({
      activeSpace: 'scripture',
      tabs: { scripture: [{ id: 'b1', spaceId: 'scripture', type: 'bible', title: 'Gen 1', state: { bookId: 'GEN', chapter: 1, verse: 1 } } as Tab], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'b1', notes: null, lexicon: null, youtube: null, search: null },
      tabNavStacks: {
        b1: { stack: [{ id: 'a', type: 'bible', title: 'Gen 1', bookId: 'GEN', chapter: 1 }, { id: 'c', type: 'bible', title: 'Gen 2', bookId: 'GEN', chapter: 2 }], idx: 1 },
      },
    })
    useAppStore.getState().goToTabHome()
    expect(useAppStore.getState().tabNavStacks.b1.idx).toBe(1)
    expect(useAppStore.getState().notesHomeToken).toBe(0)
  })

  it('jumps directly to idx -1 in one step, WITHOUT setting pendingNoteId for any intermediate entry (the race that caused "random note" instead of home)', () => {
    useAppStore.setState({
      pendingNoteId: null,
      tabNavStacks: {
        n1: {
          stack: [
            { id: 'a', type: 'note', title: 'A', noteId: 'a' },
            { id: 'b', type: 'note', title: 'B', noteId: 'b' },
            { id: 'c', type: 'note', title: 'C', noteId: 'c' },
          ],
          idx: 2,
        },
      },
    })
    useAppStore.getState().goToTabHome()
    expect(useAppStore.getState().tabNavStacks.n1.idx).toBe(-1)
    expect(useAppStore.getState().notesHomeToken).toBe(1)
    expect(useAppStore.getState().pendingNoteId).toBeNull()
  })
})

describe('resetTabNavHome', () => {
  beforeEach(resetStore)

  // Deleting the currently-open note (NotesPanel.tsx's deleteNote) sets
  // activeNote to null locally but has no reason to know about the nav
  // stack — without this re-sync, idx stayed stale (still pointing at the
  // deleted note), so the home icon kept showing and did nothing when
  // clicked (goBack() early-returns on `!activeNote`, which is already
  // true by then).
  it('resets a stale idx back to -1 after the active item was invalidated by something other than the home button', () => {
    useAppStore.setState({
      tabNavStacks: {
        n1: {
          stack: [
            { id: 'a', type: 'note', title: 'A', noteId: 'a' },
            { id: 'b', type: 'note', title: 'B', noteId: 'b' },
          ],
          idx: 1,
        },
      },
    })
    useAppStore.getState().resetTabNavHome('n1')
    expect(useAppStore.getState().tabNavStacks.n1.idx).toBe(-1)
    // Unlike goToTabHome, this does NOT bump the home token — the caller
    // already updated its own local "active item" state directly.
    expect(useAppStore.getState().notesHomeToken).toBe(0)
  })

  it('no-op when already at idx -1', () => {
    useAppStore.setState({ tabNavStacks: { n1: { stack: [{ id: 'a', type: 'note', title: 'A', noteId: 'a' }], idx: -1 } } })
    useAppStore.getState().resetTabNavHome('n1')
    expect(useAppStore.getState().tabNavStacks.n1.idx).toBe(-1)
  })

  it('no-op for a tab with no nav stack at all', () => {
    expect(() => useAppStore.getState().resetTabNavHome('nonexistent')).not.toThrow()
  })
})
