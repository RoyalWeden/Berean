// @vitest-environment jsdom
/** Berean Chat history list (window sidebar + panel switcher): date groups, quiet selection,
 *  the hover "…" row menu (Open / Rename… / Delete Conversation…), inline rename, the delete
 *  confirmation, and ↑/↓ between rows. */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AiLookupChatSummary } from '@/types/electron'
import type { ChatController } from '../useChatController'
import { ChatHistoryList, groupConversationsByDate, formatHistoryTime } from '../ChatHistoryList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

// Saturday 18 Oct 2026, 15:00 local.
const NOW = new Date(2026, 9, 18, 15, 0).getTime()
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).toISOString()
const sum = (id: string, title: string, when: string, preview = `${title} preview`): AiLookupChatSummary =>
  ({ id, title, created_at: when, updated_at: when, lastMessageAt: when, preview })

const SUMMARIES = [
  sum('older-month', 'August study', at(2026, 7, 2)),
  sum('today', 'Feast notes', at(2026, 9, 18, 9)),
  sum('yesterday', 'Sabbath', at(2026, 9, 17)),
  sum('week', 'Isaiah 58', at(2026, 9, 13)),
  sum('month', 'Jubilees calendar', at(2026, 9, 1)),
  sum('last-year', 'Enoch', at(2025, 11, 30)),
]

function fakeController(over: Partial<ChatController> = {}): ChatController {
  return {
    summaries: SUMMARIES, summariesLoaded: true, days: [], view: { kind: 'conversation' }, activeChatId: 'today',
    search: '', searchResults: null,
    setSearch: vi.fn(), openConversation: vi.fn(), renameChat: vi.fn(async () => {}), deleteChat: vi.fn(async () => {}),
    folders: [], pinChat: vi.fn(async () => {}), moveToFolder: vi.fn(async () => {}), renameFolder: vi.fn(async () => {}),
    refreshDays: vi.fn(async () => {}), setView: vi.fn(),
    ...over,
  } as unknown as ChatController
}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = ''; localStorage.clear() })
function mount(c: ChatController) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<ChatHistoryList c={c} now={NOW} />))
  return host
}
const row = (id: string) => host!.querySelector<HTMLButtonElement>(`button[data-chat-id="${id}"]`)!
const monthLabel = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
/** A date group's heading (the collapse toggle). */
const groupHeading = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>('button.chat-group-toggle')].find((b) => b.textContent?.startsWith(label))!

describe('groupConversationsByDate', () => {
  it('groups by last activity: Today, Yesterday, Previous 7 Days, Previous 30 Days, then month + year', () => {
    const groups = groupConversationsByDate(SUMMARIES, NOW)
    expect(groups.map((g) => g.label)).toEqual([
      'Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days',
      new Date(2026, 7, 2).toLocaleDateString([], { month: 'long', year: 'numeric' }),
      new Date(2025, 11, 30).toLocaleDateString([], { month: 'long', year: 'numeric' }),
    ])
    expect(groups.map((g) => g.items.map((s) => s.id))).toEqual([['today'], ['yesterday'], ['week'], ['month'], ['older-month'], ['last-year']])
  })

  it('orders newest first inside a group and falls back to updated_at', () => {
    const a = { ...sum('a', 'A', at(2026, 9, 18, 8)), lastMessageAt: undefined }
    const b = sum('b', 'B', at(2026, 9, 18, 12))
    expect(groupConversationsByDate([a, b], NOW)[0].items.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('formats row times: time today, Yesterday, weekday, short date, numeric date for other years', () => {
    expect(formatHistoryTime(at(2026, 9, 17), NOW)).toBe('Yesterday')
    expect(formatHistoryTime(at(2026, 9, 14), NOW)).toBe(new Date(2026, 9, 14).toLocaleDateString([], { weekday: 'short' }))
    expect(formatHistoryTime(at(2026, 9, 1), NOW)).toBe(new Date(2026, 9, 1).toLocaleDateString([], { month: 'short', day: 'numeric' }))
    expect(formatHistoryTime(at(2025, 11, 30), NOW)).toBe(new Date(2025, 11, 30).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }))
    expect(formatHistoryTime(undefined, NOW)).toBe('')
  })
})

describe('ChatHistoryList', () => {
  it('renders grouped two-line rows with a quiet selection, and opens a row on click', () => {
    const c = fakeController()
    const h = mount(c)
    expect([...h.querySelectorAll('section')].map((s) => s.getAttribute('aria-label')).slice(0, 2)).toEqual(['Today', 'Yesterday'])
    expect(row('today').getAttribute('aria-current')).toBe('true')
    expect(row('today').className).not.toMatch(/\bbg-accent\b/)
    expect(row('yesterday').getAttribute('aria-current')).toBeNull()
    expect(row('yesterday').querySelector('.chat-hist-title')!.textContent).toBe('Sabbath')
    expect(row('yesterday').querySelector('.chat-hist-preview')!.textContent).toBe('Sabbath preview')
    expect(row('yesterday').querySelector('.chat-hist-time')!.textContent).toBe('Yesterday')
    act(() => row('yesterday').click())
    expect(c.openConversation).toHaveBeenCalledWith('yesterday')
  })

  it('shows a loading state until summaries load, and an empty state after', () => {
    let h = mount(fakeController({ summariesLoaded: false, summaries: [] }))
    expect(h.querySelector('[aria-busy="true"]')).not.toBeNull()
    act(() => root!.unmount()); host!.remove(); root = null
    h = mount(fakeController({ summaries: [] }))
    expect(h.textContent).toContain('No Conversations Yet')
  })

  it('the hover "…" button (no tooltip) opens Open / Pin / Move to Folder / Rename… / Delete Conversation…', () => {
    const c = fakeController()
    const h = mount(c)
    const more = h.querySelector<HTMLButtonElement>('button[aria-label="Actions for Sabbath"]')!
    expect(more).not.toBeNull()
    expect(more.closest('.chat-hist-item')!.querySelector('.chat-hist-time')).not.toBeNull()
    act(() => more.click())
    const items = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map((el) => el.textContent)
    expect(items).toEqual(['Open', 'Pin', 'Move to Folder', 'Rename…', 'Delete Conversation…'])
    expect(more.closest('.chat-hist-item')!.hasAttribute('data-menu-open')).toBe(true)
  })

  it('double-click renames inline; Return saves', () => {
    const c = fakeController()
    const h = mount(c)
    act(() => { row('week').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = h.querySelector<HTMLInputElement>('input[aria-label="Conversation name"]')!
    expect(input.value).toBe('Isaiah 58')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'Isaiah 58 — the true fast'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(c.renameChat).toHaveBeenCalledWith('week', 'Isaiah 58 — the true fast')
    expect(h.querySelector('input[aria-label="Conversation name"]')).toBeNull()
  })

  it('Delete Conversation… asks first (AlertSheet); Cancel keeps it, Delete removes it', async () => {
    const c = fakeController()
    const h = mount(c)
    act(() => groupHeading(monthLabel(2025, 11)).click()) // a month group starts collapsed
    const openDelete = () => {
      act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Actions for Enoch"]')!.click())
      const del = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role^="menuitem"]')].find((b) => b.textContent === 'Delete Conversation…')!
      act(() => del.click())
    }
    openDelete()
    expect(document.body.textContent).toContain('Delete “Enoch”?')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel')!.click())
    expect(c.deleteChat).not.toHaveBeenCalled()
    openDelete()
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === 'Delete')!.click())
    expect(c.deleteChat).toHaveBeenCalledWith('last-year')
  })

  it('↑/↓ move between rows (from the search field into the list too)', () => {
    const h = mount(fakeController())
    const search = h.querySelector<HTMLInputElement>('input[role="searchbox"]')!
    search.focus()
    act(() => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(row('today')) // the selected row first
    act(() => { row('today').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(row('yesterday'))
    act(() => { row('yesterday').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(document.activeElement).toBe(row('today'))
    // End: the last VISIBLE row — month groups start collapsed, and headings are not in the ↑/↓ order.
    act(() => { row('today').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(document.activeElement).toBe(row('month'))
  })

  it('date groups collapse: month groups start collapsed (with their count), and the choice is remembered', () => {
    const h = mount(fakeController())
    const dec = groupHeading(monthLabel(2025, 11))
    expect(dec.getAttribute('aria-expanded')).toBe('false')
    expect(dec.textContent).toContain('1') // count shown only while collapsed
    expect(row('last-year')).toBeNull()
    expect(groupHeading('Today').getAttribute('aria-expanded')).toBe('true')
    act(() => dec.click())
    expect(row('last-year')).not.toBeNull()
    act(() => groupHeading('Yesterday').click())
    expect(row('yesterday')).toBeNull()
    // Remounted (relaunch): the same groups open / closed.
    act(() => root!.unmount()); host!.remove()
    const h2 = mount(fakeController())
    expect(row('last-year')).not.toBeNull()
    expect(row('yesterday')).toBeNull()
    void h; void h2
  })

  it('the open conversation is never hidden inside a collapsed group', () => {
    mount(fakeController({ activeChatId: 'last-year' }))
    expect(row('last-year')).not.toBeNull()
    expect(groupHeading(monthLabel(2025, 11)).getAttribute('aria-expanded')).toBe('true')
  })

  it('All Messages folds its days under it (collapsed); a day opens that day, its count labelled as messages', () => {
    const c = fakeController({ days: [{ dayKey: '2026-10-18', count: 3 }, { dayKey: '2026-10-17', count: 2 }] as never })
    const h = mount(c)
    expect(h.textContent).toContain('All Messages')
    const toggle = h.querySelector<HTMLButtonElement>('button[aria-label="Show Days"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(h.querySelector('[aria-label="Days"]')).toBeNull()
    act(() => toggle.click())
    expect(h.querySelector('button[aria-label="Hide Days"]')!.getAttribute('aria-expanded')).toBe('true')
    const today = [...h.querySelectorAll<HTMLButtonElement>('[aria-label="Days"] button')].find((b) => b.textContent === 'Today3')!
    expect(today.querySelector('[aria-label="3 messages"]')).not.toBeNull()
    act(() => today.click())
    expect(c.setView).toHaveBeenCalledWith({ kind: 'day', dayKey: '2026-10-18' })
  })
})
