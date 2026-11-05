// @vitest-environment jsdom
/**
 * QO-002 — Quick Open (the plus sheet): the field alone with scope + Filters behind the options
 * button, recent searches / places, search-as-you-type with stale-result protection, open-tab
 * awareness (reuse, other sessions), and the full-search escape hatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore, type Session } from '@/store'
import type { SpaceId, Tab, HistoryEntry } from '@/types'
import { SheetHost, useSheets } from '../primitives/Sheet'
import { NewTabSheet } from '../navigation/NewTabSheet'
import { useSearchSurface } from '../search/searchSurfaceState'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const bible = (id: string, bookId = 'ROM', chapter = 13, title = 'Romans 13'): Tab =>
  ({ id, spaceId: 'scripture', type: 'bible', title, state: { bookId, chapter, translation: 'KJVA', showStrongs: false, scrollPosition: 0 } } as Tab)
const byspace = (tabs: Tab[]) => Object.fromEntries(SPACES.map((sp) => [sp, tabs.filter((t) => t.spaceId === sp)])) as Record<SpaceId, Tab[]>
const activeIds = (tabs: Tab[]) => Object.fromEntries(SPACES.map((sp) => [sp, tabs.find((t) => t.spaceId === sp)?.id ?? null])) as Record<SpaceId, string | null>

function reset(tabs: Tab[], activeId: string, others: Array<{ id: string; name: string; tabs: Tab[] }> = [], history: HistoryEntry[] = []) {
  const active = tabs.find((t) => t.id === activeId)!
  const activeTabId = activeIds(tabs)
  activeTabId[active.spaceId] = active.id
  const sessions: Session[] = [
    { id: 'A', name: 'Study A', tabs: byspace(tabs), activeTabId },
    ...others.map((o) => ({ id: o.id, name: o.name, tabs: byspace(o.tabs), activeTabId: activeIds(o.tabs) })),
  ]
  useAppStore.setState({
    tabs: byspace(tabs), activeTabId, activeSpace: active.spaceId, currentSessionId: 'A', sessions,
    sessionDisplayOrders: { A: tabs.map((t) => t.id) }, tabMRUList: [], tabNavStacks: {}, isNavJumping: false,
    pendingNoteId: null, pendingLexiconEntry: null, defaultBibleTranslation: 'kjva', recentSearchQueries: [], history,
  })
}
const count = () => SPACES.reduce((n, sp) => n + useAppStore.getState().tabs[sp].length, 0)
const st = () => useAppStore.getState()
const current = () => { const s = st(); return s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace])! }

type SearchFn = (q: string, textId: string) => Promise<unknown[]>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function stubWindow(searchText?: SearchFn, notes: unknown[] = [{ id: 'note-love', title: 'Love study', content: 'about love', type: 'general' }]) {
  const w = window as unknown as Record<string, unknown>
  w.bible = {
    searchText: searchText ?? (async (_q: string, textId: string) => (textId === 'kjva' ? [{ book_id: 'JHN', chapter: 3, verse_num: 16, text: 'For God so loved the world' }] : [])),
    getBooks: async () => [],
  }
  w.notes = { searchNotes: async () => notes }
  w.lexicon = { search: async () => [], getEntry: async () => null, getOccurrences: async () => [] }
  w.studyTrail = new Proxy({}, { get: () => async () => ({ id: 'trail', stops: [], nodes: [] }) })
  if (!w.app) w.app = {}
}

beforeEach(() => {
  stubWindow()
  useSearchSurface.setState({ query: '', scope: 'all', advanced: false })
  useSearchSurface.getState().resetFilters()
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const flush = (ms = 260) => act(async () => { await sleep(ms) })

async function openQuickOpen() {
  let open = () => {}
  function Opener() {
    const sheets = useSheets()
    open = () => sheets.open({ id: 'new-tab-q', render: (api) => <NewTabSheet api={api} openMore={() => {}} /> })
    return null
  }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SheetHost><Opener /></SheetHost>))
  act(() => open())
  await flush(200)
}
const input = () => document.querySelector('.m-usurface .mobile-search-input') as HTMLInputElement
async function type(text: string, wait = 260) {
  act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input(), text); input().dispatchEvent(new Event('input', { bubbles: true })) })
  if (wait) await flush(wait)
}
const rows = () => [...document.querySelectorAll('.m-usearch .mobile-newtab-row')] as HTMLButtonElement[]
const rowWith = (re: RegExp) => rows().find((b) => re.test(b.textContent ?? ''))!
const optionsBtn = () => document.querySelector('button[aria-label^="Search options"]') as HTMLButtonElement
const sectionHeads = () => [...document.querySelectorAll('section.mobile-newtab-section .mobile-newtab-section-head h3')].map((h) => h.textContent?.replace(/ ·.*/, ''))

describe('opening Quick Open', () => {
  it('shows the field alone, focused; scope + Filters are behind the options button', async () => {
    reset([bible('b1')], 'b1')
    await openQuickOpen()
    expect(input()).toBeTruthy()
    expect(document.activeElement).toBe(input())
    expect(document.querySelector('[aria-label="Search in"]')).toBeNull()
    expect(document.querySelector('.m-usearch-filters')).toBeNull()
    expect(optionsBtn().getAttribute('aria-expanded')).toBe('false')

    act(() => optionsBtn().click())
    expect(optionsBtn().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[aria-label="Search in"]')).toBeTruthy()
    expect(document.querySelector('.m-usearch-filters')).toBeTruthy()
    expect(useSearchSurface.getState().advanced).toBe(true)

    act(() => optionsBtn().click())
    expect(document.querySelector('[aria-label="Search in"]')).toBeNull()
    expect(useSearchSurface.getState().advanced).toBe(false)
  })

  it('the disclosed state persists when the sheet is reopened', async () => {
    reset([bible('b1')], 'b1')
    useSearchSurface.setState({ advanced: true })
    await openQuickOpen()
    expect(document.querySelector('[aria-label="Search in"]')).toBeTruthy()
  })
})

describe('empty query', () => {
  it('shows recent searches as chips, recent places (with "Open" for an open tab) and the New tab section', async () => {
    const hist: HistoryEntry[] = [
      { id: 'h1', timestamp: 3, type: 'bible', title: 'Romans 13', bookId: 'ROM', chapter: 13, translation: 'KJVA' },
      { id: 'h2', timestamp: 2, type: 'bible', title: 'Psalm 23', bookId: 'PSA', chapter: 23, translation: 'KJVA' },
    ]
    reset([bible('b1')], 'b1', [], hist)
    st().addRecentSearchQuery('mercy')
    await openQuickOpen()
    const chips = document.querySelector('[role="group"][aria-label="Recent searches"]')!
    expect(chips.textContent).toContain('mercy')
    const recent = document.querySelector('section[aria-label="Recent"]')!
    expect(recent.textContent).toContain('Romans 13')
    expect(recent.textContent).toContain('Psalm 23')
    const rom = [...recent.querySelectorAll('.mobile-newtab-row')].find((b) => /Romans 13/.test(b.textContent ?? ''))!
    expect(rom.querySelector('.mobile-newtab-row-meta')!.textContent).toBe('Open')
    const psa = [...recent.querySelectorAll('.mobile-newtab-row')].find((b) => /Psalm 23/.test(b.textContent ?? ''))!
    expect(psa.querySelector('.mobile-newtab-row-meta')!.textContent).not.toBe('Open')
    expect(document.querySelector('section[aria-label="New tab"]')).toBeTruthy()
    // a recent-search chip fills the field
    act(() => (chips.querySelector('button') as HTMLButtonElement).click())
    expect(useSearchSurface.getState().query).toBe('mercy')
  })
})

describe('search as you type', () => {
  it('typing "love" shows results after the debounce', async () => {
    reset([bible('b1')], 'b1')
    await openQuickOpen()
    await type('love', 0)
    await flush(60)
    expect(document.body.textContent).not.toContain('Love study') // still inside the 180ms debounce
    await flush(300)
    expect(sectionHeads()).toEqual(expect.arrayContaining(['Verses', 'Notes']))
    expect(document.body.textContent).toContain('Love study')
    expect(rowWith(/John 3:16/)).toBeTruthy()
  })

  it('ignores stale results: only the last query\'s results are shown', async () => {
    reset([bible('b1')], 'b1')
    stubWindow(async (q, textId) => {
      if (textId !== 'kjva') return []
      if (q === 'grac') { await sleep(700); return [{ book_id: 'GEN', chapter: 1, verse_num: 1, text: 'stale grac verse' }] }
      return [{ book_id: 'JHN', chapter: 3, verse_num: 16, text: 'fresh grace verse' }]
    }, [])
    await openQuickOpen()
    await type('grac', 0)
    await flush(250) // first search is now in flight
    await type('grace', 0)
    await flush(300) // second search lands
    expect(document.body.textContent).toContain('John 3:16')
    await flush(700) // the stale one resolves late
    expect(document.body.textContent).toContain('John 3:16')
    expect(document.body.textContent).not.toContain('Genesis 1:1')
  })

  it('no results shows "Nothing matches"', async () => {
    reset([bible('b1')], 'b1')
    stubWindow(async () => [], [])
    await openQuickOpen()
    await type('zzzzqq')
    expect(document.body.textContent).toContain('Nothing matches “zzzzqq”')
  })

  it('a failing search does not crash and shows no results', async () => {
    reset([bible('b1')], 'b1')
    stubWindow(async () => { throw new Error('boom') }, [])
    ;(window as unknown as { notes: unknown }).notes = { searchNotes: async () => { throw new Error('boom') } }
    await openQuickOpen()
    await type('love')
    expect(input()).toBeTruthy()
    expect(document.querySelector('.m-usearch .mobile-newtab-row.is-primary')).toBeNull()
    expect(document.body.textContent).not.toContain('John 3:16')
  })
})

describe('open-tab awareness', () => {
  it('a reference whose chapter is open lists the tab under "Open tabs" and switches to it', async () => {
    reset([bible('b0', 'GEN', 1, 'Genesis 1'), bible('b1'), bible('b2', 'PSA', 23, 'Psalm 23')], 'b0')
    await openQuickOpen()
    await type('Romans 13')
    const sec = document.querySelector('section[aria-label="Open tabs"]')!
    expect(sec).toBeTruthy()
    expect(sec.textContent).toContain('Romans 13')
    expect(sec.textContent).toContain('Switch to Tab')
    // the Go-to row also says it is open
    expect(rowWith(/Romans 13/).textContent).toBeTruthy()
    const before = count()
    act(() => (sec.querySelector('.m-qo-tab') as HTMLButtonElement).click()); await flush()
    expect(count()).toBe(before)
    expect(st().activeTabId.scripture).toBe('b1')
  })

  it('tapping the Go-to result reuses the existing tab (no new tab)', async () => {
    reset([bible('b0', 'GEN', 1, 'Genesis 1'), bible('b1')], 'b0')
    await openQuickOpen()
    await type('Romans 13')
    const goto = document.querySelector('section[aria-label="Go to"] .mobile-newtab-row') as HTMLButtonElement
    expect(goto.querySelector('.mobile-newtab-row-meta')!.textContent).toBe('Open')
    act(() => goto.click()); await flush()
    expect(count()).toBe(2)
    expect(st().activeTabId.scripture).toBe('b1')
  })

  it('picking a result that is not open creates exactly one new tab', async () => {
    reset([bible('b0', 'GEN', 1, 'Genesis 1')], 'b0')
    await openQuickOpen()
    await type('love')
    act(() => rowWith(/Love study/).click()); await flush()
    expect(count()).toBe(2)
    expect(current().type).toBe('note')
    expect(st().pendingNoteId).toBe('note-love')
    expect(st().tabs.scripture[0].id).toBe('b0')
  })

  it('a tab in ANOTHER session shows the session name; only tapping it switches session', async () => {
    reset([bible('b0', 'GEN', 1, 'Genesis 1')], 'b0', [{ id: 'B', name: 'Study B', tabs: [bible('bB')] }])
    await openQuickOpen()
    await type('Romans 13')
    expect(st().currentSessionId).toBe('A') // typing never switches
    const sec = document.querySelector('section[aria-label="Open tabs"]')!
    expect(sec.textContent).toContain('Study B')
    expect(sec.textContent).not.toContain('Switch to Tab')
    act(() => (sec.querySelector('.m-qo-tab') as HTMLButtonElement).click()); await flush()
    expect(st().currentSessionId).toBe('B')
    expect(st().activeTabId.scripture).toBe('bB')
  })

  it('a Go-to pick for a chapter open only in another session opens a copy here (no silent switch)', async () => {
    reset([bible('b0', 'GEN', 1, 'Genesis 1')], 'b0', [{ id: 'B', name: 'Study B', tabs: [bible('bB')] }])
    await openQuickOpen()
    await type('Romans 13')
    const goto = document.querySelector('section[aria-label="Go to"] .mobile-newtab-row') as HTMLButtonElement
    expect(goto.querySelector('.mobile-newtab-row-meta')!.textContent).toBe('Study B')
    act(() => goto.click()); await flush()
    expect(st().currentSessionId).toBe('A')
    expect(st().tabs.scripture).toHaveLength(2)
  })
})

describe('full search', () => {
  it('"Full search for “q”" opens a Search tab', async () => {
    reset([bible('b0', 'GEN', 1, 'Genesis 1')], 'b0')
    await openQuickOpen()
    await type('love')
    const full = document.querySelector('.m-qo-full') as HTMLButtonElement
    expect(full.textContent).toContain('Full search for “love”')
    act(() => full.click()); await flush()
    expect(count()).toBe(2)
    expect(current().type).toBe('search')
    expect(st().recentSearchQueries[0]).toBe('love')
  })
})
