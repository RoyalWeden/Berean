// @vitest-environment jsdom
/** TEST 2026-09-29 — Search tab IA: field + scope, ONE row of contextual filter chips (each shows
 *  its value and opens its own picker), and a "…" overflow for tertiary actions. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const sheetOpen = vi.fn()
const actionSheet = vi.fn()
vi.mock('../primitives/Sheet', () => ({ useSheets: () => ({ open: sheetOpen, close: vi.fn(), isOpen: () => false }) }))
vi.mock('../primitives/ActionSheet', () => ({ useActionSheet: () => actionSheet, ChoiceList: () => null }))
vi.mock('../commands/caretRegistry', () => ({ useCaretCommands: () => {} }))
vi.mock('../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
vi.mock('../history/HistoryPage', () => ({ HistoryView: () => null }))
import { SearchPage } from '../search/SearchPage'
import { _popoverState, closePopoverMenu } from '../primitives/PopoverMenu'
import { useAppStore } from '@/store'

let root: Root; let host: HTMLDivElement
beforeEach(() => {
  sheetOpen.mockClear(); actionSheet.mockClear()
  const w = window as unknown as Record<string, unknown>
  w.bible = { searchText: async () => [], getBooks: async () => [] }
  w.notes = { searchNotes: async () => [], getNotes: async () => [] }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

function renderScope(scope: string) {
  const tab = { id: 's1', spaceId: 'search', type: 'search', title: 'Search', state: { scope, query: '' } } as never
  const st = useAppStore.getState()
  useAppStore.setState({ tabs: { ...st.tabs, search: [tab] }, activeTabId: { ...st.activeTabId, search: 's1' } })
  act(() => root.render(<SearchPage tab={tab} />))
}

describe('Search tab information architecture', () => {
  it('Scripture: chips for match, text, books, tags and sort — no separate Filters button', () => {
    renderScope('scripture')
    const chips = [...host.querySelectorAll('.mobile-search-chip')].map((c) => c.getAttribute('aria-label'))
    expect(chips).toEqual(['Match: All words', 'Text: All texts', expect.stringMatching(/^Books: /), 'Tags: Tags', 'Sort: Best match'])
    expect(host.querySelector('.mobile-search-filters-button')).toBeNull()
    // A quick single choice is an anchored popover menu (TEST 2026-10-03), the current one checked.
    act(() => (host.querySelector('[aria-label="Sort: Best match"]') as HTMLButtonElement).click())
    const menu = _popoverState()!
    expect(menu.actions.map((a) => a.label)).toEqual(['Best match first', 'Bible order', 'Reverse Bible order'])
    expect(menu.actions.find((a) => a.checked)?.id).toBe('relevance')
    expect(sheetOpen).not.toHaveBeenCalled()
    closePopoverMenu()
    // Books (a long multi-select list) stays a sheet.
    act(() => (host.querySelector('[aria-label^="Books:"]') as HTMLButtonElement).click())
    expect(sheetOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Books' }))
  })
  it('Notes: only the match chip; Lexicon: no chips', () => {
    renderScope('notes')
    expect([...host.querySelectorAll('.mobile-search-chip')].map((c) => c.getAttribute('aria-label'))).toEqual(['Match: All words'])
    renderScope('lexicon')
    expect(host.querySelectorAll('.mobile-search-chip').length).toBe(0)
  })
  it('the "…" overflow holds History (tertiary)', () => {
    renderScope('scripture')
    act(() => (host.querySelector('[aria-label="More search options"]') as HTMLButtonElement).click())
    expect(_popoverState()?.actions.map((i) => i.id)).toContain('history')
    closePopoverMenu()
  })
})
