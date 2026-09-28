// @vitest-environment jsdom
/**
 * NAV-001/002 — the navigation contract: 'current-tab' never creates a tab (a different type
 * changes the tab in place, ‹ returns), 'new-tab' creates exactly one, 'existing-tab' keeps the
 * desktop semantics; duplicated histories stay independent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { openDestination, currentTab } from '../destination'
import { historyDestination } from '../historyDestination'

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const bible = (id = 'b1', bookId = 'MAT', chapter = 10): Tab => ({ id, spaceId: 'scripture', type: 'bible', title: `${bookId} ${chapter}`, state: { bookId, chapter, translation: 'KJVA', showStrongs: false, scrollPosition: 0 } } as Tab)
const note = (id = 'n1'): Tab => ({ id, spaceId: 'notes', type: 'note', title: 'A note', state: { noteId: 'note-a', isNew: false } } as Tab)
const search = (id = 's1'): Tab => ({ id, spaceId: 'search', type: 'search', title: 'Search', state: { query: 'grace', results: [], scope: 'all' } } as Tab)
const calendar = (id = 'c1'): Tab => ({ id, spaceId: 'notes', type: 'calendar', title: 'Calendar', state: { month: '2026-09' } } as Tab)

function reset(tabs: Tab[], activeId: string) {
  const by = (sp: SpaceId) => tabs.filter((t) => t.spaceId === sp)
  const active = tabs.find((t) => t.id === activeId)!
  const activeTabId = Object.fromEntries(SPACES.map((sp) => [sp, by(sp)[0]?.id ?? null])) as Record<SpaceId, string | null>
  activeTabId[active.spaceId] = active.id
  useAppStore.setState({
    tabs: Object.fromEntries(SPACES.map((sp) => [sp, by(sp)])) as Record<SpaceId, Tab[]>,
    activeTabId, activeSpace: active.spaceId, currentSessionId: 's', sessionDisplayOrders: { s: tabs.map((t) => t.id) },
    tabMRUList: [], tabNavStacks: {}, isNavJumping: false, pendingNoteId: null, pendingLexiconEntry: null,
  })
}
const count = () => SPACES.reduce((n, sp) => n + useAppStore.getState().tabs[sp].length, 0)
const cur = () => currentTab()!

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })

describe("'current-tab'", () => {
  it('Scripture → another chapter / book: the same tab, no new tab', () => {
    reset([bible()], 'b1')
    openDestination({ kind: 'passage', bookId: 'MAT', chapter: 11 }, 'current-tab')
    openDestination({ kind: 'passage', bookId: 'MRK', chapter: 3 }, 'current-tab')
    expect(count()).toBe(1)
    expect(cur()).toMatchObject({ id: 'b1', state: { bookId: 'MRK', chapter: 3 } })
  })

  it('from a Notes tab a verse changes THAT tab (not another Scripture tab); ‹ returns to the note', () => {
    reset([bible('b1', 'GEN', 1), note()], 'n1')
    openDestination({ kind: 'passage', bookId: 'JHN', chapter: 3, verse: 16 }, 'current-tab')
    expect(count()).toBe(2)
    expect(cur()).toMatchObject({ type: 'bible', state: { bookId: 'JHN', chapter: 3, targetVerse: 16 } })
    // the other Scripture tab is untouched
    expect(useAppStore.getState().tabs.scripture.find((t) => t.id === 'b1')!.state).toMatchObject({ bookId: 'GEN', chapter: 1 })
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    expect(cur().type).toBe('note')
  })

  it('from a Search tab a result changes the Search tab; ‹ returns to the results', () => {
    reset([bible('b1', 'GEN', 1), search()], 's1')
    openDestination({ kind: 'passage', bookId: 'ROM', chapter: 5, verse: 1, highlight: { query: 'grace' } }, 'current-tab')
    expect(count()).toBe(2)
    expect(cur()).toMatchObject({ type: 'bible', state: { bookId: 'ROM', chapter: 5, targetVerseQuery: 'grace' } })
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    expect(cur()).toMatchObject({ type: 'search', state: { query: 'grace' } })
  })

  it('a search from Scripture turns THIS tab into a Search tab (no Search tab is created or reused)', () => {
    reset([bible(), search('s-other')], 'b1')
    openDestination({ kind: 'search', query: 'clean animals' }, 'current-tab')
    expect(count()).toBe(2)
    expect(cur()).toMatchObject({ type: 'search', state: { query: 'clean animals', scope: 'all' } })
    expect(useAppStore.getState().tabs.search.find((t) => t.id === 's-other')!.state).toMatchObject({ query: 'grace' })
    expect(useAppStore.getState().recentSearchQueries[0]).toBe('clean animals')
  })

  it('a note / Strong\'s entry from Scripture changes this tab', () => {
    reset([bible()], 'b1')
    openDestination({ kind: 'note', noteId: 'note-x' }, 'current-tab')
    expect(count()).toBe(1)
    expect(cur()).toMatchObject({ type: 'note', state: { noteId: 'note-x' } })
    expect(useAppStore.getState().pendingNoteId).toBe('note-x')
    openDestination({ kind: 'strongs', num: 'H430' }, 'current-tab')
    expect(count()).toBe(1)
    expect(cur()).toMatchObject({ type: 'lexicon', state: { strongsNum: 'H430' } })
    expect(useAppStore.getState().pendingLexiconEntry).toBe('H430')
  })

  it('from the Calendar tab a passage changes the Calendar tab', () => {
    reset([calendar()], 'c1')
    openDestination({ kind: 'passage', bookId: 'GEN', chapter: 1 }, 'current-tab')
    expect(count()).toBe(1)
    expect(cur().type).toBe('bible')
  })

  it('a search in a Search tab stays in it and is a history step', () => {
    reset([search()], 's1')
    openDestination({ kind: 'search', query: 'mercy', scope: 'scripture' }, 'current-tab')
    expect(count()).toBe(1)
    expect(cur()).toMatchObject({ id: 's1', state: { query: 'mercy', scope: 'scripture' } })
  })

  it('creates a tab only when there is none at all', () => {
    reset([bible()], 'b1')
    useAppStore.setState({ tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }, activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null } })
    openDestination({ kind: 'passage', bookId: 'GEN', chapter: 1 }, 'current-tab')
    expect(count()).toBe(1)
  })
})

describe("'new-tab' and 'existing-tab'", () => {
  it("'new-tab' creates exactly one tab and leaves the current one", () => {
    reset([bible()], 'b1')
    openDestination({ kind: 'passage', bookId: 'JHN', chapter: 1 }, 'new-tab')
    expect(count()).toBe(2)
    expect(cur()).toMatchObject({ type: 'bible', state: { bookId: 'JHN', chapter: 1 } })
    expect(useAppStore.getState().tabs.scripture.find((t) => t.id === 'b1')!.state).toMatchObject({ bookId: 'MAT', chapter: 10 })
    openDestination({ kind: 'search', query: 'grace' }, 'new-tab')
    expect(count()).toBe(3)
  })

  it("'existing-tab' (deep links, Spotlight) keeps the desktop semantics: the space's tab", () => {
    reset([bible('b1', 'GEN', 1), note()], 'n1')
    openDestination({ kind: 'passage', bookId: 'EXO', chapter: 20 }, 'existing-tab')
    expect(count()).toBe(2)
    expect(cur()).toMatchObject({ id: 'b1', state: { bookId: 'EXO', chapter: 20 } })
  })
})

describe('duplication keeps independent histories (search → result → duplicate)', () => {
  it('navigating the duplicate never moves the original, and vice versa', () => {
    reset([search()], 's1')
    const landed = openDestination({ kind: 'passage', bookId: 'ROM', chapter: 5 }, 'current-tab')!
    const s = useAppStore.getState()
    s.duplicateTab('scripture', landed)
    const dup = cur()
    expect(dup.id).not.toBe(landed)
    openDestination({ kind: 'passage', bookId: 'ROM', chapter: 8 }, 'current-tab')
    const orig = useAppStore.getState().tabs.scripture.find((t) => t.id === landed)!
    expect(orig.state).toMatchObject({ chapter: 5 })
    expect(cur().state).toMatchObject({ chapter: 8 })
    const stacks = useAppStore.getState().tabNavStacks
    expect(stacks[dup.id]).not.toBe(stacks[landed])
    // back in the duplicate returns to Romans 5, not into the original's search
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    expect(cur().state).toMatchObject({ chapter: 5 })
    expect(useAppStore.getState().tabs.scripture.find((t) => t.id === landed)!.state).toMatchObject({ chapter: 5 })
  })
})

describe('historyDestination', () => {
  it('maps entries to destinations', () => {
    expect(historyDestination({ id: 'h', timestamp: 0, type: 'bible', title: 'x', bookId: 'GEN', chapter: 2, translation: 'LXX' })).toEqual({ kind: 'passage', bookId: 'GEN', chapter: 2, verse: undefined, textId: 'lxx' })
    expect(historyDestination({ id: 'h', timestamp: 0, type: 'search', title: 'x', query: 'grace' })).toEqual({ kind: 'search', query: 'grace' })
    expect(historyDestination({ id: 'h', timestamp: 0, type: 'import', title: 'x' })).toBeNull()
  })
})
