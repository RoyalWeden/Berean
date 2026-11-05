// @vitest-environment jsdom
/**
 * QO-003 — the iPhone tab switcher's compact list view (default): rows, current marker, tab
 * search (≥6 tabs) with other-session matches, close, select mode, "used … ago", view toggle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore, type Session } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { SheetHost, useSheets } from '../primitives/Sheet'
import { TabCardsSheet } from '../tabs/TabCardsSheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const psalm = (n: number, extra: Partial<Tab> = {}): Tab =>
  ({ id: `p${n}`, spaceId: 'scripture', type: 'bible', title: `Psalm ${n}`, state: { bookId: 'PSA', chapter: n, translation: 'KJVA', showStrongs: false, scrollPosition: 0 }, ...extra } as Tab)
const byspace = (tabs: Tab[]) => Object.fromEntries(SPACES.map((sp) => [sp, tabs.filter((t) => t.spaceId === sp)])) as Record<SpaceId, Tab[]>
const activeIds = (tabs: Tab[]) => Object.fromEntries(SPACES.map((sp) => [sp, tabs.find((t) => t.spaceId === sp)?.id ?? null])) as Record<SpaceId, string | null>

function reset(tabs: Tab[], activeId: string, others: Array<{ id: string; name: string; tabs: Tab[] }> = [], extra: Record<string, unknown> = {}) {
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
    tabLastAccessed: {}, mobileTabView: 'list', mobileTabSort: 'custom', ...extra,
  })
}
const st = () => useAppStore.getState()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// jsdom has no layout: scrollIntoView (the list scrolls the current row into view) is absent.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // The cards view previews each tab's chapter text.
  ;(window as unknown as Record<string, unknown>).bible = { queryChapter: async () => [], getBooks: async () => [] }
})

let root: Root | null = null
let host: HTMLDivElement | null = null
let closed = 0
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })

async function openSwitcher() {
  closed = 0
  let open = () => {}
  function Opener() {
    const sheets = useSheets()
    open = () => sheets.open({ id: 'tabs', onClose: () => { closed++ }, render: (api) => <TabCardsSheet api={api} openMore={() => {}} /> })
    return null
  }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SheetHost><Opener /></SheetHost>))
  act(() => open())
  await act(async () => { await sleep(50) })
}
const tick = () => act(async () => { await sleep(30) })
const rows = () => [...document.querySelectorAll('.m-tabrow')] as HTMLElement[]
const mainOf = (title: string) => document.querySelector(`.m-tabrow-main[aria-label*="${title}"]`) as HTMLButtonElement
const btn = (label: string) => document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const searchInput = () => document.querySelector('input[aria-label="Search open tabs"]') as HTMLInputElement
function typeIn(el: HTMLInputElement, text: string) {
  act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const many = (n: number) => Array.from({ length: n }, (_, i) => psalm(i + 1))

describe('list rows', () => {
  it('renders 60 tabs as rows; only the active one is marked and says "Current"', async () => {
    reset(many(60), 'p7')
    await openSwitcher()
    expect(rows()).toHaveLength(60)
    expect(document.querySelector('.mobile-tab-cards')).toBeNull()
    const cur = document.querySelectorAll('.m-tabrow-main[aria-current="true"]')
    expect(cur).toHaveLength(1)
    expect(cur[0].getAttribute('aria-label')).toContain('Psalm 7')
    expect(cur[0].textContent).toContain('Current')
    expect(document.querySelectorAll('.m-tabrow-current')).toHaveLength(1)
    expect(rows().filter((r) => r.classList.contains('is-active'))).toHaveLength(1)
  })

  it('tapping a row activates that tab and closes the sheet', async () => {
    reset(many(8), 'p1')
    await openSwitcher()
    act(() => mainOf('Psalm 5').click()); await tick()
    expect(st().activeTabId.scripture).toBe('p5')
    expect(closed).toBe(1)
  })
})

describe('tab search', () => {
  it('appears only from 6 tabs', async () => {
    reset(many(5), 'p1')
    await openSwitcher()
    expect(searchInput()).toBeNull()
    act(() => root!.unmount()); host!.remove(); document.body.innerHTML = ''
    reset(many(6), 'p1')
    await openSwitcher()
    expect(searchInput()).toBeTruthy()
  })

  it('filters rows by title; other sessions\' matches appear under "In other sessions" and switch session', async () => {
    const other = [{ id: 'B', name: 'Study B', tabs: [{ ...psalm(23), id: 'bB' } as Tab, { ...psalm(99), id: 'bB2' } as Tab] }]
    reset(many(8), 'p1', other)
    await openSwitcher()
    typeIn(searchInput(), 'Psalm 2'); await tick()
    expect(rows().filter((r) => !r.closest('.m-tablist-other')).map((r) => r.querySelector('.m-tabrow-title')!.textContent)).toEqual(['Psalm 2'])
    const sec = document.querySelector('section[aria-label="In other sessions"]')!
    expect(sec.textContent).toContain('Psalm 23')
    expect(sec.textContent).toContain('Study B')
    expect(sec.textContent).not.toContain('Psalm 99')
    typeIn(searchInput(), 'nomatchxyz'); await tick()
    expect(document.body.textContent).toContain('No open tab matches “nomatchxyz”')

    typeIn(searchInput(), 'Psalm 23'); await tick()
    act(() => (document.querySelector('section[aria-label="In other sessions"] .m-tabrow-main') as HTMLButtonElement).click()); await tick()
    expect(st().currentSessionId).toBe('B')
    expect(st().activeTabId.scripture).toBe('bB')
    expect(closed).toBe(1)
  })
})

describe('closing', () => {
  it('the hidden "Close <title>" button closes that tab', async () => {
    reset(many(7), 'p1')
    await openSwitcher()
    act(() => btn('Close Psalm 4').click()); await tick()
    expect(st().tabs.scripture.map((t) => t.id)).not.toContain('p4')
    expect(rows()).toHaveLength(6)
  })

  it('closing the active tab leaves a valid active tab', async () => {
    reset(many(7), 'p3')
    await openSwitcher()
    act(() => btn('Close Psalm 3').click()); await tick()
    const s = st()
    expect(s.tabs.scripture.map((t) => t.id)).not.toContain('p3')
    const id = s.activeTabId.scripture
    expect(id).toBeTruthy()
    expect(s.tabs.scripture.some((t) => t.id === id)).toBe(true)
    expect(document.querySelectorAll('.m-tabrow-main[aria-current="true"]')).toHaveLength(1)
  })
})

describe('select mode', () => {
  it('Select → tap rows toggles aria-pressed; "Close N Tabs" closes exactly those; pinned stay', async () => {
    const tabs = many(8).map((t) => (t.id === 'p6' ? { ...t, isPinned: true } : t))
    reset(tabs, 'p1')
    await openSwitcher()
    const select = [...document.querySelectorAll('button.m-tab-select')][0] as HTMLButtonElement
    expect(select.textContent).toBe('Select')
    act(() => select.click())
    expect(select.textContent).toBe('Done')
    act(() => mainOf('Psalm 2').click())
    act(() => mainOf('Psalm 3').click())
    act(() => mainOf('Psalm 6').click()) // pinned
    expect(mainOf('Psalm 2').getAttribute('aria-pressed')).toBe('true')
    act(() => mainOf('Psalm 3').click()) // toggle off
    expect(mainOf('Psalm 3').getAttribute('aria-pressed')).toBe('false')
    act(() => mainOf('Psalm 4').click())
    // tapping rows in select mode never navigates
    expect(closed).toBe(0)
    const closeBtn = [...document.querySelectorAll('.m-tab-select-bar button')].find((b) => /^Close/.test(b.textContent ?? '')) as HTMLButtonElement
    expect(closeBtn.textContent).toBe('Close 2 Tabs')
    act(() => closeBtn.click()); await tick()
    const ids = st().tabs.scripture.map((t) => t.id)
    expect(ids).not.toContain('p2')
    expect(ids).not.toContain('p4')
    expect(ids).toEqual(expect.arrayContaining(['p1', 'p3', 'p5', 'p6', 'p7', 'p8']))
    expect(ids).toHaveLength(6)
    expect(document.querySelector('.m-tab-select-bar')).toBeNull()
  })
})

describe('recent sort', () => {
  it('shows "ago" when tabLastAccessed has entries', async () => {
    reset(many(3), 'p1', [], { mobileTabSort: 'recent', tabLastAccessed: { 'scripture:p2': Date.now() - 5 * 60_000 } })
    await openSwitcher()
    expect(document.body.textContent).toContain('5m ago')
    const sub = (document.querySelector('.m-tabrow-main[aria-label*="Psalm 2"] .m-tabrow-sub') as HTMLElement).textContent
    expect(sub).toContain('Scripture · 5m ago')
    expect(document.querySelector('.m-tabrow-main[aria-label*="Psalm 3"] .m-tabrow-sub')!.textContent).not.toContain('ago')
  })

  it('custom sort does not show "ago"', async () => {
    reset(many(3), 'p1', [], { mobileTabSort: 'custom', tabLastAccessed: { 'scripture:p2': Date.now() - 5 * 60_000 } })
    await openSwitcher()
    expect(document.body.textContent).not.toContain('ago')
  })
})

describe('view toggle', () => {
  it('"Show tabs as cards" sets mobileTabView to cards and renders the card grid', async () => {
    reset(many(4), 'p1')
    await openSwitcher()
    act(() => btn('Show tabs as cards').click()); await tick()
    expect(st().mobileTabView).toBe('cards')
    expect(document.querySelector('.mobile-tab-cards')).toBeTruthy()
    expect(document.querySelector('.m-tablist')).toBeNull()
    act(() => btn('Show tabs as a list').click()); await tick()
    expect(st().mobileTabView).toBe('list')
    expect(rows()).toHaveLength(4)
  })
})
