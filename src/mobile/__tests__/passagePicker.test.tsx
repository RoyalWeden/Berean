// @vitest-environment jsdom
/**
 * NEW-11: the hierarchical PassagePicker (collections → books → chapters → verses) — local-stack
 * mode (no sheet) and in-sheet navigation through the real SheetHost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PassagePicker, type PassagePick } from '../reader/PassagePicker'
import { SheetHost, useSheets } from '../primitives/Sheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

const BOOKS: Record<string, Array<{ id: string; name: string; short_name: string; testament: string; chapters_count: number }>> = {
  kjva: [
    { id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT', chapters_count: 50 },
    { id: '1MA', name: 'I Maccabees', short_name: '1Ma', testament: 'Apocrypha', chapters_count: 16 },
    { id: 'JHN', name: 'John', short_name: 'Jhn', testament: 'NT', chapters_count: 21 },
    { id: '1JN', name: 'I John', short_name: '1Jn', testament: 'NT', chapters_count: 5 },
    { id: '3JN', name: 'III John', short_name: '3Jn', testament: 'NT', chapters_count: 1 },
  ],
  lxx: [{ id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT', chapters_count: 50 }, { id: '1MA', name: '1 Maccabees', short_name: '1Ma', testament: 'Apocrypha', chapters_count: 16 }],
  enoch: [{ id: 'ENO', name: '1 Enoch', short_name: '1En', testament: 'Pseudepigrapha', chapters_count: 108 }],
}

beforeEach(() => {
  ;(window as unknown as { bible: unknown }).bible = {
    getBooks: (t: string) => Promise.resolve(BOOKS[t] ?? []),
    queryChapter: () => Promise.resolve([1, 2, 3, 4, 5, 6, 7].map((n) => ({ verse_num: n, text: 'x', book_id: 'JHN', chapter: 3 }))),
  }
})

async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 5)) }) }
function mount(el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, unmount: () => act(() => root.unmount()) }
}
const click = (el: Element | undefined) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const byText = (host: Element, sel: string, text: string) => [...host.querySelectorAll(sel)].find((b) => b.querySelector('.m-pp-row-title')?.textContent === text || b.textContent === text)
const titles = (host: Element) => [...host.querySelectorAll('.m-pp-row-title')].map((e) => e.textContent)

describe('PassagePicker (NEW-11)', () => {
  it('opens at the current text’s books (arabic names, current marked), goes up to collections, then down to chapters', async () => {
    const picked: PassagePick[] = []
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="1JN" chapter={2} onPick={(d) => picked.push(d)} />)
    await flush()
    expect(titles(host)).toEqual(['Genesis', '1 Maccabees', 'John', '1 John', '3 John'])
    expect([...host.querySelectorAll('.m-pp-section-title')].map((e) => e.textContent)).toEqual(['Old Testament', 'Apocrypha', 'New Testament'])
    expect(host.querySelector('[aria-current="true"] .m-pp-row-title')?.textContent).toBe('1 John')
    expect(host.textContent).not.toMatch(/\bI+ (John|Maccabees)/)
    // Tap 1 John → chapters, current chapter marked; tapping a chapter navigates.
    click(byText(host, '.m-pp-row', '1 John'))
    await flush()
    expect(host.querySelectorAll('.m-pp-cell').length).toBe(5)
    expect(host.querySelector('.m-pp-cell.is-current')?.textContent).toBe('2')
    click(byText(host, '.m-pp-cell', '4'))
    expect(picked.at(-1)).toEqual({ textId: 'kjva', bookId: '1JN', chapter: 4 })
    // Choose verse → verse grid → pick verse 6
    click([...host.querySelectorAll('.m-pp-mode button')][1])
    click(byText(host, '.m-pp-cell', '3'))
    await flush()
    expect(host.querySelectorAll('.m-pp-cell').length).toBe(7)
    click(byText(host, '.m-pp-cell', '6'))
    expect(picked.at(-1)).toEqual({ textId: 'kjva', bookId: '1JN', chapter: 3, verse: 6 })
    // Back up to the collections root.
    for (let i = 0; i < 3; i++) click(host.querySelector('.m-pp-back')!)
    expect(host.querySelector('input[type="search"]')).not.toBeNull()
    expect(titles(host)).toEqual(expect.arrayContaining(['King James Version', 'Apocrypha', 'Septuagint (Brenton)', '1 Enoch', 'Jubilees']))
    // Single-book collection skips the book list.
    click(byText(host, '.m-pp-row', '1 Enoch'))
    await flush()
    expect(host.querySelectorAll('.m-pp-cell').length).toBe(108)
    unmount()
  })

  it('search resolves to destinations: collection, passage, book', async () => {
    const picked: PassagePick[] = []
    const { host, unmount } = mount(<PassagePicker textId="kjva" bookId="GEN" chapter={1} onPick={(d) => picked.push(d)} />)
    await flush()
    click(host.querySelector('.m-pp-back')!)
    const input = host.querySelector('input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const type = (v: string) => act(() => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const submit = () => act(() => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    type('gen 3:5'); submit()
    expect(picked.at(-1)).toEqual({ textId: 'kjva', bookId: 'GEN', chapter: 3, verse: 5, endVerse: undefined })
    type('LXX'); submit()
    await flush()
    expect(titles(host)).toEqual(['Genesis', '1 Maccabees'])
    unmount()
  })

  it('in a sheet: pre-navigates with an in-sheet push, and the back control returns to collections', async () => {
    const picked: PassagePick[] = []
    function Opener() {
      const sheets = useSheets()
      React.useEffect(() => {
        sheets.open({ id: 'reference', title: 'Library', detents: [0.92], render: (api) => <PassagePicker textId="kjva" bookId="JHN" chapter={3} onPick={(d) => { picked.push(d); api.close() }} /> })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return null
    }
    const { unmount } = mount(<SheetHost><Opener /></SheetHost>)
    await flush(); await flush()
    const sheet = document.querySelector('.mobile-sheet')!
    const view = () => [...sheet.querySelectorAll('.mobile-sheet-view')].at(-1)!
    expect(sheet.querySelector('.mobile-sheet-back')?.textContent).toContain('Library')
    expect(view().querySelector('[aria-current="true"] .m-pp-row-title')?.textContent).toBe('John')
    click(sheet.querySelector('.mobile-sheet-back')!)
    await flush(); await flush()
    expect(document.querySelector('.mobile-sheet input[type="search"]')).not.toBeNull()
    expect(document.querySelector('.mobile-sheet .mobile-sheet-back')).toBeNull() // stayed at the root
    unmount()
  })
})
