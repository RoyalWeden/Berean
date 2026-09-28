// @vitest-environment jsdom
/** SEP27-CAL-001…006 — the reusable calendar, its note dots, and date → daily note in the current tab. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { CalendarView } from '../calendar/CalendarView'
import { SheetHost } from '../primitives/Sheet'
import { useCalendarOverlay } from '../calendar/CalendarOverlay'
import { openDailyNoteInCurrentTab, resolveDailyNoteId } from '@/lib/dailyNotes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

const createNote = vi.fn(async (d: { title: string }) => ({ success: true, note: { id: `new-${d.title}`, title: d.title, type: 'daily' } }))
beforeEach(() => {
  createNote.mockClear()
  ;(window as unknown as { notes: unknown }).notes = {
    getDailyDates: async () => [{ dateKey: '2026-09-10', noteId: 'd10', length: 40 }, { dateKey: '2026-09-26', noteId: 'd26', length: 5 }],
    searchNotes: async () => [],
    createNote,
    getVerseNotes: async () => [],
  }
  useAppStore.setState({ noteChangeToken: (useAppStore.getState().noteChangeToken ?? 0) + 1, dailyNoteLocation: null })
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
function mount(node: React.ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('CalendarView', () => {
  it('marks every date that has a daily note with ONE dot; navigates months; picks a day', async () => {
    const onMonth = vi.fn(), onPick = vi.fn()
    mount(<CalendarView month={new Date(2026, 8, 1)} onMonth={onMonth} onPick={onPick} selectedKey="2026-09-10" />)
    await flush()
    expect(host!.querySelector('.m-cal-title')?.textContent).toBe('September 2026')
    const dotted = [...host!.querySelectorAll('.m-cal-day')].filter((b) => b.querySelector('.m-cal-dot.is-on')).map((b) => b.getAttribute('aria-label'))
    expect(dotted).toHaveLength(2)
    expect(dotted[0]).toMatch(/September 10, 2026.*has a daily note/)
    expect(host!.querySelector('.m-cal-day.is-selected')?.getAttribute('aria-label')).toMatch(/September 10/)
    act(() => { (host!.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click() })
    expect(onMonth.mock.calls[0][0].getMonth()).toBe(9)
    const d15 = [...host!.querySelectorAll('.m-cal-day')].find((b) => /September 15, 2026/.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement
    act(() => { d15.click() })
    expect(onPick.mock.calls[0][0].getDate()).toBe(15)
  })
})

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const bible: Tab = { id: 'b1', spaceId: 'scripture', type: 'bible', title: 'John 3', state: { bookId: 'JHN', chapter: 3, translation: 'KJVA', showStrongs: false, scrollPosition: 0 } } as Tab
function reset(tabs: Tab[], space: SpaceId) {
  const by = (sp: SpaceId) => tabs.filter((t) => t.spaceId === sp)
  useAppStore.setState({
    tabs: { scripture: by('scripture'), notes: by('notes'), lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: by('scripture')[0]?.id ?? null, notes: by('notes')[0]?.id ?? null, lexicon: null, youtube: null, search: null },
    activeSpace: space, currentSessionId: 's1', sessionDisplayOrders: { s1: tabs.map((t) => t.id) },
    tabMRUList: [], tabNavStacks: {}, isNavJumping: false, pendingNoteId: null,
  })
}
const count = () => SPACES.reduce((n, sp) => n + useAppStore.getState().tabs[sp].length, 0)
const active = () => { const s = useAppStore.getState(); return s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace])! }

describe('date → daily note', () => {
  it('uses the existing note for a date with a note, creates one for a date without', async () => {
    expect(await resolveDailyNoteId(new Date(2026, 8, 10))).toBe('d10')
    expect(createNote).not.toHaveBeenCalled()
    expect(await resolveDailyNoteId(new Date(2026, 8, 11))).toBe('new-Daily — 2026-09-11')
    expect(createNote).toHaveBeenCalledWith({ title: 'Daily — 2026-09-11', content: '', type: 'daily' })
  })

  it('opens in the CURRENT tab: Scripture becomes the note (no new tab); ‹ returns to Scripture', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    reset([bible], 'scripture')
    await openDailyNoteInCurrentTab(new Date(2026, 8, 26))
    expect(count()).toBe(1)
    expect(active().type).toBe('note')
    expect(useAppStore.getState().pendingNoteId).toBe('d26')
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    expect(active().type).toBe('bible')
    vi.useRealTimers()
  })

  it('from the persistent Calendar tab, ‹ comes back to the calendar on its month', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const cal = { id: 'c1', spaceId: 'notes', type: 'calendar', title: 'Calendar', state: { month: '2026-09', selected: '2026-09-10' } } as Tab
    reset([cal], 'notes')
    await openDailyNoteInCurrentTab(new Date(2026, 8, 10))
    expect(active().type).toBe('note')
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    expect(active().type).toBe('calendar')
    expect(active().state).toMatchObject({ month: '2026-09', selected: '2026-09-10' })
    vi.useRealTimers()
  })
})

describe('Calendar overlay', () => {
  it('is contextual: presenting and dismissing it records no history and changes no tab', async () => {
    reset([bible], 'scripture')
    let open: () => void = () => {}
    function Opener() { open = useCalendarOverlay(); return null }
    mount(<SheetHost><Opener /></SheetHost>)
    act(() => open())
    await flush()
    expect(document.querySelector('.m-cal')).toBeTruthy()
    expect(useAppStore.getState().tabNavStacks).toEqual({})
    expect(active().id).toBe('b1')
  })
})
