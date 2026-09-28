// @vitest-environment jsdom
/**
 * SRCH-003/005, NAV-002/003 — the ONE search surface behind the caret (current tab) and the plus
 * (new tab): global results whatever the tab, picks land per the entry point, the Filters view
 * keeps the query, recent searches are shared, capitalization is never forced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { SheetHost, useSheets } from '../primitives/Sheet'
import { SearchSurface } from '../search/SearchSurface'
import { useSearchSurface } from '../search/searchSurfaceState'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const bible: Tab = { id: 'b1', spaceId: 'scripture', type: 'bible', title: 'Matthew 10', state: { bookId: 'MAT', chapter: 10, translation: 'KJVA', showStrongs: false, scrollPosition: 0 } } as Tab
const noteTab: Tab = { id: 'n1', spaceId: 'notes', type: 'note', title: 'Note', state: { noteId: 'x', isNew: false } } as Tab
function reset(tabs: Tab[], activeId: string) {
  const by = (sp: SpaceId) => tabs.filter((t) => t.spaceId === sp)
  const active = tabs.find((t) => t.id === activeId)!
  const activeTabId = Object.fromEntries(SPACES.map((sp) => [sp, by(sp)[0]?.id ?? null])) as Record<SpaceId, string | null>
  useAppStore.setState({ tabs: Object.fromEntries(SPACES.map((sp) => [sp, by(sp)])) as Record<SpaceId, Tab[]>, activeTabId, activeSpace: active.spaceId, currentSessionId: 's', sessionDisplayOrders: { s: tabs.map((t) => t.id) }, tabMRUList: [], tabNavStacks: {}, isNavJumping: false, recentSearchQueries: [] })
}
const count = () => SPACES.reduce((n, sp) => n + useAppStore.getState().tabs[sp].length, 0)
const current = () => { const s = useAppStore.getState(); return s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace])! }

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).bible = {
    searchText: async (_q: string, textId: string) => (textId === 'kjva' ? [{ book_id: 'JHN', chapter: 3, verse_num: 16, text: 'For God so loved the world' }] : textId === 'enoch' ? [{ book_id: 'ENO', chapter: 5, verse_num: 1, text: 'love in Enoch' }] : []),
    getBooks: async () => [],
  }
  ;(window as unknown as Record<string, unknown>).notes = { searchNotes: async () => [{ id: 'note-love', title: 'Love study', content: 'about love', type: 'general' }] }
  ;(window as unknown as Record<string, unknown>).lexicon = { search: async () => [{ strongsNum: 'G26', lemma: 'ἀγάπη', transliteration: 'agapē', gloss: 'love' }], getEntry: async () => null, getOccurrences: async () => [] }
  // Study Trail records side stops through its bridge — inert here.
  ;(window as unknown as Record<string, unknown>).studyTrail = new Proxy({}, { get: () => async () => ({ id: 'trail', stops: [], nodes: [] }) })
  if (!(window as unknown as { app?: unknown }).app) (window as unknown as Record<string, unknown>).app = {}
  useSearchSurface.setState({ query: '', scope: 'all' })
  useSearchSurface.getState().resetFilters()
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 260)) })

async function openSurface(target: 'current-tab' | 'new-tab') {
  let open = () => {}
  function Opener() { const sheets = useSheets(); open = () => sheets.open({ id: 'search', render: (api) => <SearchSurface api={api} target={target} /> }); return null }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SheetHost><Opener /></SheetHost>))
  act(() => open())
  await flush()
}
async function type(text: string) {
  const input = document.querySelector('.m-usurface .mobile-search-input') as HTMLInputElement
  act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await flush(); await flush()
}
const groups = () => [...document.querySelectorAll('.m-usearch .mobile-newtab-section-head h3')].map((h) => h.textContent?.replace(/ ·.*/, ''))

describe('caret search (current tab)', () => {
  it('from a Scripture tab it searches EVERYTHING: verses (KJV + Enoch), Strong\'s and notes', async () => {
    reset([bible], 'b1')
    await openSurface('current-tab')
    await type('love')
    expect(groups()).toEqual(['Verses', 'Lexicon', 'Notes'])
    expect(document.body.textContent).toContain('1 Enoch')
    expect(document.body.textContent).toContain('Love study')
  })

  it('from a Notes tab it still searches Scripture and Strong\'s (the tab type never narrows it)', async () => {
    reset([bible, noteTab], 'n1')
    await openSurface('current-tab')
    await type('love')
    expect(groups()).toEqual(['Verses', 'Lexicon', 'Notes'])
  })

  it('a result changes THIS tab — no tab is created', async () => {
    reset([bible, noteTab], 'n1')
    await openSurface('current-tab')
    await type('love')
    const verse = [...document.querySelectorAll('.m-usearch .mobile-newtab-row')].find((b) => /John 3:16/.test(b.textContent ?? '')) as HTMLButtonElement
    act(() => verse.click()); await flush()
    expect(count()).toBe(2)
    expect(current()).toMatchObject({ type: 'bible', state: { bookId: 'JHN', chapter: 3, targetVerse: 16 } })
    expect(useAppStore.getState().tabs.scripture.find((t) => t.id === 'b1')!.state).toMatchObject({ bookId: 'MAT', chapter: 10 })
    expect(useAppStore.getState().recentSearchQueries[0]).toBe('love')
  })

  it('a scope narrows the results', async () => {
    reset([bible], 'b1')
    await openSurface('current-tab')
    act(() => useSearchSurface.getState().setScope('notes'))
    await type('love')
    expect(groups()).toEqual(['Notes'])
  })
})

describe('plus search (new tab)', () => {
  it('a result opens a NEW tab and leaves the current one', async () => {
    reset([bible], 'b1')
    await openSurface('new-tab')
    await type('love')
    const note = [...document.querySelectorAll('.m-usearch .mobile-newtab-row')].find((b) => /Love study/.test(b.textContent ?? '')) as HTMLButtonElement
    act(() => note.click()); await flush()
    expect(count()).toBe(2)
    expect(current().type).toBe('note')
    expect(useAppStore.getState().pendingNoteId).toBe('note-love')
    expect(useAppStore.getState().tabs.scripture[0].state).toMatchObject({ bookId: 'MAT', chapter: 10 })
  })
})

describe('surface state and input', () => {
  it('Filters is a view in the same sheet and the query survives it', async () => {
    reset([bible], 'b1')
    await openSurface('current-tab')
    await type('grace')
    act(() => (document.querySelector('.m-usurface .m-usearch-filters') as HTMLButtonElement).click()); await flush()
    expect(document.querySelector('.m-usearch-filter-view')).toBeTruthy()
    act(() => useSearchSurface.getState().setFilters({ textId: 'lxx' }))
    expect(useSearchSurface.getState().query).toBe('grace')
  })

  it('recent searches are the shared list and can be cleared; capitalization is not forced', async () => {
    reset([bible], 'b1')
    useAppStore.setState({ recentSearchQueries: ['mercy', 'grace'] })
    await openSurface('new-tab')
    const input = document.querySelector('.m-usurface .mobile-search-input') as HTMLInputElement
    expect(input.hasAttribute('autocapitalize')).toBe(false)
    expect(document.body.textContent).toContain('Recent searches')
    const clear = [...document.querySelectorAll('.mobile-newtab-more')].find((b) => b.textContent === 'Clear') as HTMLButtonElement
    act(() => clear.click())
    expect(useAppStore.getState().recentSearchQueries).toEqual([])
  })
})
