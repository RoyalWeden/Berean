// @vitest-environment jsdom
/** A desktop Advanced Scripture Search tab (Scripture tab, searchMode) synced to the iPhone opens
 *  in Search — with the desktop's query and filters — and edits made on the phone are written
 *  back in the desktop's own fields, so the search is the same one when it syncs back. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../primitives/Sheet', () => ({ useSheets: () => ({ open: vi.fn(), close: vi.fn(), isOpen: () => false }) }))
vi.mock('../primitives/ActionSheet', () => ({ useActionSheet: () => vi.fn(), ChoiceList: () => null }))
vi.mock('../commands/caretRegistry', () => ({ useCaretCommands: () => {} }))
vi.mock('../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
vi.mock('../history/HistoryPage', () => ({ HistoryView: () => null }))
import { SearchPage } from '../search/SearchPage'
import { _popoverState, closePopoverMenu } from '../primitives/PopoverMenu'
import { readSearchState, writeSearchState, scriptureFiltersOf, isScriptureSearchTab } from '../search/searchTabBinding'
import { experienceOfTab } from '../navigation/experiences'
import { tabKind } from '../tabs/TabCardsSheet'
import { splitTabState } from '@/platform/sync/tabFields'
import { useAppStore } from '@/store'
import type { BibleTabState, Tab } from '@/types'

const desktopSearch = (state: Partial<BibleTabState> = {}): Tab => ({
  id: 'scripture-search-1', spaceId: 'scripture', type: 'bible', title: '"love"',
  state: { bookId: 'GEN', chapter: 1, translation: 'KJVA', showStrongs: false, searchMode: true, scriptureSearchQuery: 'love',
    searchTextId: 'kjva', searchWordMode: 'phrase', searchBookFilter: 'JHN,1JN', searchSortMode: 'bookOrder', searchTagFilter: 't1', ...state } as BibleTabState,
})
const putInStore = (tab: Tab) => {
  const st = useAppStore.getState()
  useAppStore.setState({ tabs: { ...st.tabs, scripture: [tab] }, activeTabId: { ...st.activeTabId, scripture: tab.id }, activeSpace: 'scripture' })
}
const live = () => useAppStore.getState().tabs.scripture[0].state as BibleTabState

describe('desktop Advanced Scripture Search tab ↔ iPhone Search', () => {
  it('reads the desktop fields as a Scripture-scoped search', () => {
    const st = readSearchState(desktopSearch())!
    expect(st.query).toBe('love')
    expect(st.scope).toBe('scripture')
    expect(st.filters).toMatchObject({ textId: 'kjva', wordMode: 'phrase', books: ['JHN', '1JN'], tagIds: ['t1'], sort: 'bookOrder', direction: 'asc' })
  })
  it('maps a desktop testament filter (no individual books) to that section\'s books', () => {
    const f = scriptureFiltersOf({ ...desktopSearch().state as BibleTabState, searchBookFilter: 'all', searchTestamentFilter: 'NT' })
    expect(f.books).toContain('MAT')
    expect(f.books).toContain('REV')
    expect(f.books).not.toContain('GEN')
  })
  it('writes phone edits back into the desktop fields — and only what changed', () => {
    putInStore(desktopSearch({ searchTestamentFilter: 'OT', searchBookFilter: 'all' }))
    writeSearchState('scripture-search-1', { query: 'charity' })
    expect(live().scriptureSearchQuery).toBe('charity')
    const cur = readSearchState(useAppStore.getState().tabs.scripture[0])!.filters as Record<string, unknown>
    writeSearchState('scripture-search-1', { filters: { ...cur, wordMode: 'any' } })
    expect(live().searchWordMode).toBe('any')
    // The untouched testament filter is NOT rewritten as a book list.
    expect(live().searchTestamentFilter).toBe('OT')
    expect(live().searchBookFilter).toBe('all')
    writeSearchState('scripture-search-1', { filters: { ...cur, books: ['PSA'] } })
    expect(live().searchBookFilter).toBe('PSA')
    expect(live().searchTestamentFilter).toBe('all')
    // Still a desktop search tab (never converted into a phone Search tab).
    expect(useAppStore.getState().tabs.scripture[0].type).toBe('bible')
    expect(live().searchMode).toBe(true)
  })
  it('the edited fields sync; the phone-only extras stay on the device', () => {
    const { sync, local } = splitTabState('bible', { ...desktopSearch().state, searchSortDirection: 'desc', searchPreview: { q: 'x' } } as BibleTabState)
    expect(sync).toMatchObject({ searchMode: true, scriptureSearchQuery: 'love', searchWordMode: 'phrase', searchBookFilter: 'JHN,1JN' })
    expect(sync).not.toHaveProperty('searchSortDirection')
    expect(local).toMatchObject({ searchSortDirection: 'desc', searchPreview: { q: 'x' } })
  })
  it('is a Search experience with a Search tab card', () => {
    const tab = desktopSearch()
    expect(isScriptureSearchTab(tab)).toBe(true)
    expect(experienceOfTab(tab)).toBe('search')
    expect(tabKind(tab).label).toBe('Scripture Search')
    expect(isScriptureSearchTab({ ...tab, state: { ...tab.state, searchMode: false } })).toBe(false)
  })
})

describe('SearchPage on a desktop Advanced Scripture Search tab', () => {
  let root: Root; let host: HTMLDivElement
  beforeEach(() => {
    const w = window as unknown as Record<string, unknown>
    w.bible = { searchText: async () => [], getBooks: async () => [] }
    w.notes = { searchNotes: async () => [], getNotes: async () => [] }
    w.verseTags = { getMembers: async () => [] }
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('shows the desktop query and filters, Scripture only (no scope switch)', () => {
    const tab = desktopSearch()
    putInStore(tab)
    act(() => root.render(<SearchPage tab={tab} />))
    expect((host.querySelector('.mobile-search-input') as HTMLInputElement).value).toBe('love')
    expect(host.querySelector('.mobile-search-scope')).toBeNull()
    const chips = [...host.querySelectorAll('.mobile-search-chip')].map((c) => c.getAttribute('aria-label'))
    expect(chips).toEqual(['Match: Exact phrase', expect.stringMatching(/^Text: /), expect.stringMatching(/^Books: /), 'Tags: 1 tag', 'Sort: Bible order', 'Reset filters'])
  })
  it('a filter picked on the phone lands in the desktop tab state', () => {
    const tab = desktopSearch()
    putInStore(tab)
    act(() => root.render(<SearchPage tab={tab} />))
    act(() => (host.querySelector('[aria-label="Sort: Bible order"]') as HTMLButtonElement).click())
    const best = _popoverState()!.actions.find((a) => a.id === 'relevance')!
    act(() => best.onSelect())
    closePopoverMenu()
    expect(live().searchSortMode).toBe('relevance')
    expect(live().searchMode).toBe(true)
  })
})

describe('opening a result from a desktop search tab on the phone', () => {
  it('records the search as the back step and leaves search mode (as the desktop does)', async () => {
    const { leaveScriptureSearch } = await import('../search/searchTabBinding')
    putInStore(desktopSearch())
    leaveScriptureSearch('scripture-search-1')
    expect(live().searchMode).toBe(false)
    expect(live().searchBack).toEqual({ query: 'love' })
    const nav = useAppStore.getState().tabNavStacks['scripture-search-1']
    const top = nav.stack[nav.idx] as { query?: string; state?: Record<string, unknown> }
    expect(top.query).toBe('love')
    expect(top.state).toMatchObject({ searchWordMode: 'phrase', searchBookFilter: 'JHN,1JN' })
  })
})

describe('SearchPage runs the synced desktop search', () => {
  it('searches with the desktop query and filters (debounce settles across re-renders)', async () => {
    vi.useFakeTimers()
    const searchText = vi.fn(async () => [])
    const w = window as unknown as Record<string, unknown>
    w.bible = { searchText, getBooks: async () => [] }
    w.verseTags = { getMembers: async () => [] }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    const tab = desktopSearch({ searchTagFilter: undefined })
    putInStore(tab)
    act(() => root.render(<SearchPage tab={tab} />))
    // Re-render with an equal-but-new tab object (what every store update does) before the debounce fires.
    for (let i = 0; i < 3; i++) { act(() => root.render(<SearchPage tab={{ ...tab, state: { ...tab.state } }} />)); await act(async () => { vi.advanceTimersByTime(100) }) }
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(searchText).toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
    vi.useRealTimers()
  })
})
