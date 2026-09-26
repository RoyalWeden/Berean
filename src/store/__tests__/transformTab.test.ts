/**
 * transformTab (TEST25-NAV-001): change the current tab into another kind of tab without creating
 * another tab — same place in the session's order, same history; Back returns to the old type.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
function reset(tabs: Tab[], active: Tab, order: string[]) {
  const by = (sp: SpaceId) => tabs.filter((t) => t.spaceId === sp)
  useAppStore.setState({
    tabs: { scripture: by('scripture'), notes: by('notes'), lexicon: by('lexicon'), youtube: by('youtube'), search: by('search') },
    activeTabId: { scripture: by('scripture')[0]?.id ?? null, notes: by('notes')[0]?.id ?? null, lexicon: null, youtube: null, search: by('search')[0]?.id ?? null, [active.spaceId]: active.id },
    activeSpace: active.spaceId,
    currentSessionId: 's1',
    sessionDisplayOrders: { s1: order },
    tabMRUList: [],
    tabNavStacks: {},
    isNavJumping: false,
    pendingNoteId: null,
  })
}
const flushJump = () => { vi.advanceTimersByTime(60) }
const allTabs = () => SPACES.flatMap((sp) => useAppStore.getState().tabs[sp])
const activeTab = () => { const s = useAppStore.getState(); return s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace])! }
const order = () => useAppStore.getState().sessionDisplayOrders.s1

const bibleA: Tab = { id: 'b1', spaceId: 'scripture', type: 'bible', title: 'John 3', state: { bookId: 'JHN', chapter: 3, translation: 'KJVA', showStrongs: false, scrollPosition: 0 } }
const noteX: Tab = { id: 'n1', spaceId: 'notes', type: 'note', title: 'Notes', state: { noteId: null, isNew: false } } as Tab
const searchS: Tab = { id: 's1t', spaceId: 'search', type: 'search', title: 'Search', state: { query: 'grace', results: [] } } as Tab

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('transformTab', () => {
  beforeEach(() => {
    reset([bibleA, noteX, searchS], bibleA, ['n1', 'b1', 's1t'])
    useAppStore.getState().pushTabNav('b1', { type: 'bible', title: 'John 3', bookId: 'JHN', chapter: 3, translation: 'KJVA' })
  })

  it('keeps the tab count and its place in the session order, and activates the new type', () => {
    const before = allTabs().length
    const id = useAppStore.getState().transformTab('b1', 'note')!
    expect(allTabs().length).toBe(before)
    expect(allTabs().some((t) => t.id === 'b1')).toBe(false)
    expect(order()).toEqual(['n1', id, 's1t'])
    expect(useAppStore.getState().activeSpace).toBe('notes')
    expect(activeTab().id).toBe(id)
    expect(activeTab().type).toBe('note')
    // The old space no longer points at the removed tab.
    expect(useAppStore.getState().activeTabId.scripture).toBeNull()
  })

  it('carries the history: old step, then the new destination; the old id is pruned', () => {
    const id = useAppStore.getState().transformTab('b1', 'note')!
    const st = useAppStore.getState().tabNavStacks
    expect(st.b1).toBeUndefined()
    expect(st[id].stack.map((e) => e.type)).toEqual(['bible', 'note'])
    expect(st[id].idx).toBe(1)
    // The bible step was merged (no duplicate John 3 step) and snapshots the tab.
    expect(st[id].stack[0]).toMatchObject({ bookId: 'JHN', chapter: 3, switchType: true })
    expect(st[id].stack[0].state).toMatchObject({ bookId: 'JHN', chapter: 3 })
  })

  it('Back returns to the old type and state in the same place; Forward returns to the new type', () => {
    const id = useAppStore.getState().transformTab('b1', 'note')!
    useAppStore.getState().navTabBack(); flushJump()
    const back = activeTab()
    expect(back.type).toBe('bible')
    expect(back.state).toMatchObject({ bookId: 'JHN', chapter: 3, translation: 'KJVA' })
    expect(useAppStore.getState().activeSpace).toBe('scripture')
    expect(order()).toEqual(['n1', back.id, 's1t'])
    expect(allTabs().length).toBe(3)
    expect(allTabs().some((t) => t.id === id)).toBe(false)
    // History travelled with it.
    expect(useAppStore.getState().tabNavStacks[back.id].idx).toBe(0)

    useAppStore.getState().navTabForward(); flushJump()
    expect(activeTab().type).toBe('note')
    expect(order()[1]).toBe(activeTab().id)
    expect(allTabs().length).toBe(3)
  })

  it('same space (Search → Settings) keeps the per-space index too', () => {
    reset([bibleA, searchS, { ...searchS, id: 's2t' }], searchS, ['b1', 's1t', 's2t'])
    const id = useAppStore.getState().transformTab('s1t', 'settings')!
    expect(useAppStore.getState().tabs.search.map((t) => t.id)).toEqual([id, 's2t'])
    expect(order()).toEqual(['b1', id, 's2t'])
    useAppStore.getState().navTabBack(); flushJump()
    expect(activeTab()).toMatchObject({ type: 'search' })
    expect(activeTab().state).toMatchObject({ query: 'grace' })
  })

  it('same type is a no-op (activates, no new tab, no history step)', () => {
    expect(useAppStore.getState().transformTab('b1', 'bible')).toBe('b1')
    expect(allTabs().length).toBe(3)
    expect(useAppStore.getState().tabNavStacks.b1.stack).toHaveLength(1)
  })

  it('a fresh tab with no history still gets a Back step to its old type', () => {
    const id = useAppStore.getState().transformTab('s1t', 'lexicon')!
    expect(useAppStore.getState().tabNavStacks[id].stack.map((e) => e.type)).toEqual(['search', 'lexicon'])
    useAppStore.getState().navTabBack(); flushJump()
    expect(activeTab().type).toBe('search')
  })

  it('seeds state (Compare) into the new tab and its history step', () => {
    reset([bibleA, searchS], searchS, ['b1', 's1t'])
    const id = useAppStore.getState().transformTab('s1t', 'bible', { state: { compareMode: true } })!
    const t = useAppStore.getState().tabs.scripture.find((x) => x.id === id)!
    expect(t.state).toMatchObject({ compareMode: true, bookId: 'JHN', chapter: 3 })
    expect(useAppStore.getState().tabNavStacks[id].stack[1].state).toMatchObject({ compareMode: true })
  })

  it('unknown tab → null', () => {
    expect(useAppStore.getState().transformTab('nope', 'note')).toBeNull()
  })
})
