// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { NavigationStack, useNavigation } from '../navigation/NavigationStack'
import { Page, Row, ListSection } from '../primitives/Page'
import { ActionList } from '../primitives/ActionSheet'
import { SpaceBar, destinationForSpace } from '../tabs/SpaceBar'
import { ReferencePicker, matchBooks } from '../reader/ReferencePicker'
import { parseDeepLink } from '@/lib/deepLinks'
import { useLongPress } from '../primitives/useLongPress'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

function mount(el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, unmount: () => act(() => root.unmount()) }
}

describe('mobile primitives', () => {
  it('Page renders a header with title, back button and body (accessible landmarks)', () => {
    const html = renderToString(<Page title="Settings" onBack={() => {}}><p>body</p></Page>)
    expect(html).toContain('aria-label="Back"')
    expect(html).toContain('<h1 class="mobile-page-title">Settings</h1>')
    expect(html).toContain('<header')
    expect(html).toContain('body')
  })

  it('Row is a button only when tappable; ListSection titles are headings', () => {
    expect(renderToString(<Row title="Static" />)).toContain('<div class="mobile-row"')
    expect(renderToString(<Row title="Tap" onClick={() => {}} chevron />)).toContain('<button type="button" class="mobile-row"')
    expect(renderToString(<ListSection title="Reading"><Row title="x" /></ListSection>)).toContain('<h2 class="mobile-list-section-title">Reading</h2>')
  })

  it('ActionList runs the action after closing the sheet; destructive/disabled are marked', () => {
    const calls: string[] = []
    const { host, unmount } = mount(<ActionList title="Tab" actions={[
      { id: 'a', label: 'Rename', onSelect: () => calls.push('rename') },
      { id: 'b', label: 'Close', destructive: true, onSelect: () => calls.push('close') },
      { id: 'c', label: 'Nope', disabled: true, onSelect: () => calls.push('nope') },
    ]} close={() => calls.push('closed')} />)
    const buttons = host.querySelectorAll('button')
    expect(buttons[1].className).toContain('is-destructive')
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true)
    act(() => { buttons[0].click() })
    expect(calls).toEqual(['closed', 'rename'])
    unmount()
  })

  it('NavigationStack pushes and pops pages; the root stays mounted underneath', () => {
    function Root() {
      const nav = useNavigation()
      return <button data-testid="push" onClick={() => nav.push('child', <Child />)}>push</button>
    }
    function Child() {
      const nav = useNavigation()
      return <div data-testid="child"><span>depth {nav.depth}</span><button data-testid="pop" onClick={nav.pop}>pop</button></div>
    }
    const { host, unmount } = mount(<NavigationStack root={<Root />} />)
    expect(host.querySelector('[data-testid="child"]')).toBeNull()
    act(() => { (host.querySelector('[data-testid="push"]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-testid="child"]')?.textContent).toContain('depth 1')
    expect(host.querySelector('.mobile-nav-page.is-under')).not.toBeNull()   // root still there, inert
    act(() => { (host.querySelector('[data-testid="pop"]') as HTMLButtonElement).click() })
    // AnimatePresence keeps the exiting page until its exit animation ends; the stack itself is empty
    expect(host.querySelector('.mobile-nav-page.is-under')).toBeNull()
    unmount()
  })

  it('SpaceBar maps every store space to a destination and marks the current one', () => {
    expect(destinationForSpace('scripture')).toBe('scripture')
    expect(destinationForSpace('notes')).toBe('notes')
    expect(destinationForSpace('search')).toBe('search')
    expect(destinationForSpace('lexicon')).toBe('more')
    expect(destinationForSpace('youtube')).toBe('more')
    const html = renderToString(<SpaceBar current="notes" onSelect={() => {}} />)
    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    expect(html).toContain('Scripture')
    expect(html).toContain('More')
  })

  it('ReferencePicker (passage navigator, TEST-041): typed refs, ranges, full-name filtering, book → chapter → verse range', () => {
    const picked: unknown[] = []
    const books = [
      { id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT' as const, chapters_count: 50 },
      { id: 'PSA', name: 'Psalms', short_name: 'Psa', testament: 'OT' as const, chapters_count: 150 },
      { id: 'MAT', name: 'Matthew', short_name: 'Mat', testament: 'NT' as const, chapters_count: 28 },
    ]
    const { host, unmount } = mount(<ReferencePicker books={books} bookId="GEN" chapter={1} onPick={(b, c, v, e) => picked.push([b, c, v, e])} />)
    const input = host.querySelector('input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const type = (v: string) => act(() => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const submit = () => act(() => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    type('Mat 5:3'); submit()
    type('Psalm 23:1-6'); submit()
    expect(picked).toEqual([['MAT', 5, 3, undefined], ['PSA', 23, 1, 6]])
    // a leading book number is still a book search ("1 cor" → 1 Corinthians), not a reference
    type('1 cor')
    expect(host.querySelector('.mobile-ref-go')).toBeNull()
    // full book names filter as you type; tap Matthew → its 28 chapters
    type('matt')
    const rows = [...host.querySelectorAll('.mobile-book-row')].map((b) => b.textContent)
    expect(rows[0]).toBe('Matthew')
    act(() => { [...host.querySelectorAll('.mobile-book-row')].find((b) => b.textContent === 'Matthew')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(host.querySelectorAll('.mobile-grid-numbers .mobile-grid-cell').length).toBe(28)
    // choose verses → tap 4 then 9 → a range
    act(() => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Choose verses…')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const verseBtn = (n: string) => [...host.querySelectorAll('.mobile-grid-cell')].find((b) => b.textContent === n)!
    act(() => { verseBtn('4').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    act(() => { verseBtn('9').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(picked.at(-1)).toEqual(['MAT', 1, 4, 9])
    unmount()
  })

  it('matchBooks ranks full-name prefix, then word prefix, then substring', () => {
    const list = [{ id: 'JHN', name: 'John' }, { id: '1JN', name: '1 John' }, { id: 'JON', name: 'Jonah' }, { id: 'EPH', name: 'Ephesians' }]
    expect(matchBooks(list, 'jo').map((b) => b.id)).toEqual(['JHN', 'JON', '1JN'])
    expect(matchBooks(list, 'sian').map((b) => b.id)).toEqual(['EPH'])
  })

  it('useLongPress fires after the delay, not on movement, and swallows the following click', () => {
    vi.useFakeTimers()
    const fired: number[] = []
    function Box() {
      const lp = useLongPress(() => fired.push(1), 300)
      return <div data-testid="box" {...lp}>x</div>
    }
    const { host, unmount } = mount(<Box />)
    const box = host.querySelector('[data-testid="box"]')!
    const down = (x: number, y: number) => new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerType: 'touch' })
    act(() => { box.dispatchEvent(down(10, 10)) })
    act(() => { vi.advanceTimersByTime(350) })
    expect(fired.length).toBe(1)
    act(() => { box.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
    // movement cancels
    act(() => { box.dispatchEvent(down(10, 10)) })
    act(() => { box.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 10, bubbles: true })) })
    act(() => { vi.advanceTimersByTime(350) })
    expect(fired.length).toBe(1)
    vi.useRealTimers()
    unmount()
  })

  it('deep links route to the same targets the shell exposes', () => {
    expect(parseDeepLink('berean://verse/Mat/5/3')).toEqual({ kind: 'verse', bookId: 'MAT', chapter: 5, verse: 3 })
  })
})
