// @vitest-environment jsdom
/**
 * PICKER-SEARCH: the PassagePicker's one search field also runs a free-text verse search and a
 * Strong's-number search (alongside the existing passage/book/collection resolution), and a
 * History button switches the sheet into Scripture-only recent activity (visits + picker
 * searches) — never Notes/YouTube/Lexicon search or other app history. Reuses the harness from
 * passagePicker.test.tsx (same BOOKS fixture, same haptics mock, same mount/flush helpers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PassagePicker, type PassagePick } from '../reader/PassagePicker'
import { useAppStore } from '@/store'
import { _resetPickerSearchHistory } from '../reader/scriptureHistory'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

const BOOKS: Record<string, Array<{ id: string; name: string; short_name: string; testament: string; chapters_count: number }>> = {
  kjva: [
    { id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT', chapters_count: 50 },
    { id: 'JHN', name: 'John', short_name: 'Jhn', testament: 'NT', chapters_count: 21 },
  ],
}

let strongsCalls: string[] = []
let textSearchCalls: Array<{ query: string; textId: string }> = []

beforeEach(() => {
  strongsCalls = []
  textSearchCalls = []
  _resetPickerSearchHistory()
  ;(window as unknown as { bible: unknown }).bible = {
    getBooks: (t: string) => Promise.resolve(BOOKS[t] ?? []),
    queryChapter: () => Promise.resolve([1, 2, 3].map((n) => ({ verse_num: n, text: 'x', book_id: 'GEN', chapter: 1 }))),
    searchText: (query: string, textId: string) => {
      textSearchCalls.push({ query, textId })
      if (query.toLowerCase() === 'beginning' && textId === 'kjva') {
        return Promise.resolve([{ book_id: 'GEN', chapter: 1, verse_num: 1, text: 'In the beginning God created the heaven and the earth.' }])
      }
      if (query.toLowerCase().startsWith('go') && textId === 'kjva') {
        return Promise.resolve([{ book_id: 'ISA', chapter: 52, verse_num: 7, text: 'How beautiful upon the mountains are the feet of him that bringeth good tidings' }])
      }
      return Promise.resolve([])
    },
  }
  ;(window as unknown as { lexicon: unknown }).lexicon = {
    getOccurrences: (strongsNum: string) => {
      strongsCalls.push(strongsNum)
      if (strongsNum === 'H7225') return Promise.resolve([{ book_id: 'GEN', chapter: 1, verse_num: 1, text: 'In the beginning God created the heaven and the earth.', matchWordIndices: [2] }])
      return Promise.resolve([])
    },
  }
  useAppStore.setState({
    wordReplacerEnabled: false,
    wordReplacerRules: [],
    history: [
      { id: 'h-bible', timestamp: 1000, type: 'bible', title: 'John 3:16', bookId: 'JHN', chapter: 3, verse: 16, translation: 'KJVA' },
      { id: 'h-note', timestamp: 2000, type: 'note', title: 'Notes: "grace"', query: 'grace' },
      { id: 'h-search', timestamp: 3000, type: 'search', title: 'Notes: "faith"', query: 'faith' },
    ] as unknown as never,
  } as never)
})

async function flush(ms = 360) { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
function mount(el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, unmount: () => act(() => root.unmount()) }
}
function type(host: Element, v: string) {
  const input = host.querySelector('input[type="search"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = (el: Element | null | undefined) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('PassagePicker search + history (PICKER-SEARCH)', () => {
  it('opens on the current book’s chapters with the current chapter marked', async () => {
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={() => {}} onChapter={() => {}} />)
    await flush(10)
    expect(host.querySelector('.m-pp-local-title')?.textContent).toBe('Genesis')
    expect(host.querySelector('.m-pp-cell.is-current')?.textContent).toBe('1')
    unmount()
  })

  it('a reference ("Genesis 1:1") shows a Passages result', async () => {
    const picked: PassagePick[] = []
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={(d) => picked.push(d)} onChapter={() => {}} />)
    await flush(10)
    type(host, 'Genesis 1:1')
    await flush()
    const row = host.querySelector('.m-pp-row[aria-label*="Go to Genesis 1:1"]')
    expect(row).toBeTruthy()
    click(row)
    expect(picked).toEqual([{ textId: 'kjva', bookId: 'GEN', chapter: 1, verse: 1, endVerse: undefined }])
    unmount()
  })

  it('free text ("beginning") runs a scripture text search and renders a full-name verse row', async () => {
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={() => {}} onChapter={() => {}} />)
    await flush(10)
    type(host, 'beginning')
    await flush()
    expect(textSearchCalls.some((c) => c.query === 'beginning' && c.textId === 'kjva')).toBe(true)
    expect(host.textContent).toContain('Genesis 1:1')
    expect(host.textContent).toContain('beginning')
    unmount()
  })

  it('a Strong’s number ("H7225") runs the Strong’s occurrence search, not a text search', async () => {
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={() => {}} onChapter={() => {}} />)
    await flush(10)
    type(host, 'H7225')
    await flush()
    expect(strongsCalls).toContain('H7225')
    expect(textSearchCalls.some((c) => c.query === 'H7225')).toBe(false)
    expect(host.textContent).toContain('Genesis 1:1')
    unmount()
  })

  it('tapping a text-search result picks that verse', async () => {
    const picked: PassagePick[] = []
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={(d) => picked.push(d)} onChapter={() => {}} />)
    await flush(10)
    type(host, 'beginning')
    await flush()
    click(host.querySelector('.m-pp-verse-row'))
    expect(picked).toEqual([{ textId: 'kjva', bookId: 'GEN', chapter: 1, verse: 1 }])
    unmount()
  })

  it('history shows Scripture visits and picker searches, most recent first, and excludes Notes/general search', async () => {
    const picked: PassagePick[] = []
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={(d) => picked.push(d)} onChapter={() => {}} />)
    await flush(10)
    // Run a text search and a Strong's search so they land in the picker's own search log.
    type(host, 'beginning')
    await flush(2000) // typing has really paused → recorded (typingHistory TYPING_SETTLE_MS)
    type(host, 'H7225')
    await flush(2000)
    const toggle = host.querySelector('.m-pp-history-toggle') as HTMLButtonElement
    click(toggle)
    expect(host.textContent).not.toContain('faith') // the Notes/general "search" entry
    expect(host.textContent).not.toContain('grace') // the "note" entry
    expect(host.textContent).toContain('John 3:16') // the Scripture (bible) visit
    expect(host.textContent).toContain('H7225')
    expect(host.textContent).toContain('beginning')
    // Most recent first: H7225 was searched after "beginning".
    const titles = [...host.querySelectorAll('.m-pp-history-row .m-pp-row-title')].map((e) => e.textContent)
    expect(titles.indexOf('H7225')).toBeLessThan(titles.indexOf('beginning'))
    // Tapping a visit navigates (closes/picks) straight away.
    const visitRow = [...host.querySelectorAll('.m-pp-history-row')].find((r) => r.textContent?.includes('John 3:16'))
    click(visitRow)
    expect(picked).toEqual([{ textId: 'kjva', bookId: 'JHN', chapter: 3, verse: 16 }])
    unmount()
  })

  it('tapping a search history entry re-runs it and returns to the picker', async () => {
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={() => {}} onChapter={() => {}} />)
    await flush(10)
    type(host, 'beginning')
    await flush(2000)
    click(host.querySelector('.m-pp-history-toggle'))
    const searchRow = [...host.querySelectorAll('.m-pp-history-row')].find((r) => r.textContent?.includes('beginning'))
    click(searchRow)
    expect((host.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('beginning')
    expect(host.querySelector('.m-pp-history-toggle')?.classList.contains('is-on')).toBe(false)
    await flush()
    expect(host.textContent).toContain('Genesis 1:1')
    unmount()
  })

  it('typing slowly records ONE search, not every pause (TEST 2026-10-03 "go", "good", …)', async () => {
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={() => {}} onChapter={() => {}} />)
    await flush(10)
    for (const q of ['go', 'good', 'good tiding', 'good tidings']) { type(host, q); await flush(1800) }
    await flush(2000) // let the last query settle even on a loaded machine
    click(host.querySelector('.m-pp-history-toggle'))
    const titles = [...host.querySelectorAll('.m-pp-history-row .m-pp-row-title')].map((e) => e.textContent)
    expect(titles.filter((t) => t && /^go/.test(t))).toEqual(['good tidings'])
    unmount()
  }, 20_000)
})
