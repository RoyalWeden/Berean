/**
 * Per-tab history (SEP25): generic `state` snapshots, recorded `home` (list) steps, dedupe,
 * back / forward restoring each tab type's meaningful state without new tabs.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore } from '@/store'
import type { Tab } from '@/types'

function reset(tabs: Tab[], space: 'notes' | 'search' | 'scripture') {
  useAppStore.setState({
    tabs: { scripture: tabs.filter((t) => t.spaceId === 'scripture'), notes: tabs.filter((t) => t.spaceId === 'notes'), lexicon: [], youtube: [], search: tabs.filter((t) => t.spaceId === 'search') },
    activeTabId: { scripture: tabs.find((t) => t.spaceId === 'scripture')?.id ?? null, notes: tabs.find((t) => t.spaceId === 'notes')?.id ?? null, lexicon: null, youtube: null, search: tabs.find((t) => t.spaceId === 'search')?.id ?? null },
    activeSpace: space,
    tabNavStacks: {},
    isNavJumping: false,
    pendingNoteId: null,
  })
}
const flushJump = () => { vi.advanceTimersByTime(60) }
const tabState = (space: 'notes' | 'search', id: string) => useAppStore.getState().tabs[space].find((t) => t.id === id)!.state as Record<string, unknown>

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('per-tab history — Notes', () => {
  const note: Tab = { id: 'n1', spaceId: 'notes', type: 'note', title: 'Notes', state: { noteId: null, isNew: false } } as Tab
  beforeEach(() => reset([note], 'notes'))

  it('list → note A → note B: back returns to A, then to the list (home step), forward returns', () => {
    const s = useAppStore.getState()
    s.pushTabNav('n1', { type: 'note', title: 'Notes', home: true, state: { listFilter: 'all', listFolderId: null, noteId: null } })
    s.pushTabNav('n1', { type: 'note', title: 'A', noteId: 'A' })
    s.pushTabNav('n1', { type: 'note', title: 'B', noteId: 'B' })
    const home0 = useAppStore.getState().notesHomeToken

    useAppStore.getState().navTabBack(); flushJump()
    expect(useAppStore.getState().pendingNoteId).toBe('A')
    useAppStore.setState({ pendingNoteId: null })

    useAppStore.getState().navTabBack(); flushJump()
    expect(useAppStore.getState().notesHomeToken).toBe(home0 + 1)
    expect(tabState('notes', 'n1').noteId).toBeNull()
    // The recorded list is the floor: no further step back.
    const idx = useAppStore.getState().tabNavStacks.n1.idx
    useAppStore.getState().navTabBack(); flushJump()
    expect(useAppStore.getState().tabNavStacks.n1.idx).toBe(idx)

    useAppStore.getState().navTabForward(); flushJump()
    expect(useAppStore.getState().pendingNoteId).toBe('A')
  })

  it('a folder step restores the folder and filter through the state snapshot', () => {
    const s = useAppStore.getState()
    s.pushTabNav('n1', { type: 'note', title: 'Notes', home: true, state: { listFilter: 'all', listFolderId: null, noteId: null } })
    s.pushTabNav('n1', { type: 'note', title: 'Notes · Sermons', home: true, state: { listFilter: 'topic', listFolderId: 'f1', noteId: null } })
    s.pushTabNav('n1', { type: 'note', title: 'A', noteId: 'A' })
    useAppStore.getState().navTabBack(); flushJump()
    expect(tabState('notes', 'n1')).toMatchObject({ listFilter: 'topic', listFolderId: 'f1' })
    useAppStore.getState().navTabBack(); flushJump()
    expect(tabState('notes', 'n1')).toMatchObject({ listFilter: 'all', listFolderId: null })
  })

  it('does not record while back / forward is restoring', () => {
    const s = useAppStore.getState()
    s.pushTabNav('n1', { type: 'note', title: 'A', noteId: 'A' })
    s.pushTabNav('n1', { type: 'note', title: 'B', noteId: 'B' })
    useAppStore.getState().navTabBack()
    // The restored view re-opening note A must not truncate the forward history.
    useAppStore.getState().pushTabNav('n1', { type: 'note', title: 'A', noteId: 'A' })
    flushJump()
    const st = useAppStore.getState().tabNavStacks.n1
    expect(st.stack.map((e) => e.noteId)).toEqual(['A', 'B'])
    expect(st.idx).toBe(0)
  })

  it('retitles entries once the real note title is known', () => {
    useAppStore.getState().pushTabNav('n1', { type: 'note', title: 'Note', noteId: 'A' })
    useAppStore.getState().retitleTabNav('n1', { noteId: 'A' }, 'Creation study')
    expect(useAppStore.getState().tabNavStacks.n1.stack[0].title).toBe('Creation study')
  })
})

describe('per-tab history — Search (state snapshots)', () => {
  const search: Tab = { id: 's1', spaceId: 'search', type: 'search', title: 'Search', state: { query: '', scope: 'scripture' } } as unknown as Tab
  beforeEach(() => reset([search], 'search'))

  it('restores query and scope on back / forward, and dedupes identical snapshots', () => {
    const s = useAppStore.getState()
    s.pushTabNav('s1', { type: 'search', title: '“love”', state: { query: 'love', scope: 'scripture' } })
    s.pushTabNav('s1', { type: 'search', title: '“love”', state: { query: 'love', scope: 'scripture' } })
    s.pushTabNav('s1', { type: 'search', title: '“H7225”', state: { query: 'H7225', scope: 'lexicon' } })
    expect(useAppStore.getState().tabNavStacks.s1.stack).toHaveLength(2)
    useAppStore.getState().navTabBack(); flushJump()
    expect(tabState('search', 's1')).toMatchObject({ query: 'love', scope: 'scripture' })
    useAppStore.getState().navTabForward(); flushJump()
    expect(tabState('search', 's1')).toMatchObject({ query: 'H7225', scope: 'lexicon' })
    // Never a new tab.
    expect(useAppStore.getState().tabs.search).toHaveLength(1)
  })
})
