/** XREF-002 — the shared cross-reference card: reference + full text, tap navigates THIS tab,
 *  text / chevron expand, long press → Open · Open in New Tab · Copy Reference · Copy Verse. */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { XRefItem } from '@/lib/crossRefs/xrefModel'

const sheetCalls: Array<{ id: string; title: string | undefined; actions: Array<{ id: string; label: string; onSelect: () => void }> }> = []
vi.mock('../../primitives/ActionSheet', () => ({
  useActionSheet: () => (id: string, title: string | undefined, actions: Array<{ id: string; label: string; onSelect: () => void }>) => { sheetCalls.push({ id, title, actions }) },
}))
vi.mock('../../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))

import { XRefCard, XRefList } from '../XRefList'

let container: HTMLDivElement
let root: Root
const item = (p: Partial<XRefItem> = {}): XRefItem => ({ key: 'ROM.5.8', bookId: 'ROM', chapter: 5, verse: 8, source: 'tske', fromVerses: [5], text: 'But God commendeth his love toward us', ...p })
const render = (el: React.ReactElement) => act(() => { root.render(el) })

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); sheetCalls.length = 0 })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

describe('XRefCard', () => {
  it('reads "Romans 5:8 — full text" as one paragraph', () => {
    render(<XRefCard item={item()} onOpen={() => {}} />)
    expect(container.querySelector('.m-xref-body')!.textContent).toBe('Romans 5:8 — But God commendeth his love toward us')
    expect(container.textContent).not.toMatch(/Show full verse/i)
  })
  it('tapping the reference opens it in the current tab', () => {
    const onOpen = vi.fn()
    render(<XRefCard item={item()} onOpen={onOpen} />)
    act(() => { (container.querySelector('.m-xref-ref') as HTMLButtonElement).click() })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'ROM.5.8' }), 'current-tab')
  })
  it('a long passage or range is clamped and expands in place from the text or the chevron', () => {
    const onOpen = vi.fn()
    render(<XRefCard item={item({ key: 'ROM.5.6-8', verse: 6, endVerse: 8, text: 'For when we were yet without strength… sinners, Christ died for us.' })} onOpen={onOpen} />)
    expect(container.querySelector('.m-xref-ref')!.textContent).toBe('Romans 5:6–8')
    expect(container.querySelector('.m-xref-body.is-clamped')).not.toBeNull()
    act(() => { (container.querySelector('.m-xref-text') as HTMLElement).click() })
    expect(container.querySelector('.m-xref-body.is-clamped')).toBeNull()
    act(() => { (container.querySelector('.m-xref-toggle') as HTMLButtonElement).click() })
    expect(container.querySelector('.m-xref-body.is-clamped')).not.toBeNull()
    expect(onOpen).not.toHaveBeenCalled()
  })
  it('long press offers Open · Open in New Tab · Copy Reference · Copy Verse; new tab passes the intent', () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    render(<XRefCard item={item()} onOpen={onOpen} />)
    const card = container.querySelector('.m-xref') as HTMLElement
    act(() => { card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerType: 'touch' } as PointerEventInit)) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(sheetCalls).toHaveLength(1)
    expect(sheetCalls[0].actions.map((a) => a.label)).toEqual(['Open', 'Open in New Tab', 'Copy Reference', 'Copy Verse'])
    sheetCalls[0].actions[1].onSelect()
    expect(onOpen).toHaveBeenCalledWith(expect.anything(), 'new-tab')
  })
  it('the current verse stays, marked subtly; the source label shows only when asked', () => {
    render(<XRefCard item={item({ isCurrent: true })} onOpen={() => {}} showSource />)
    expect(container.querySelector('.m-xref.is-current')).not.toBeNull()
    expect(container.querySelector('.m-xref-meta')!.textContent).toBe('This verse · TSK/e')
  })
})

describe('XRefList', () => {
  it('renders sections without a nested scroller, and the empty text', () => {
    render(<XRefList onOpen={() => {}} result={{ total: 2, mentions: ['Beatitudes study'], sections: [{ id: 's', heading: 'v. 3', items: [item(), item({ key: 'JHN.3.16', bookId: 'JHN', chapter: 3, verse: 16, text: 'For God so loved' })] }] }} />)
    expect(container.querySelectorAll('.m-xref')).toHaveLength(2)
    expect(container.querySelector('.m-xref-heading')!.textContent).toBe('v. 3')
    expect(container.textContent).toContain('Beatitudes study')
    render(<XRefList onOpen={() => {}} empty="Nothing here." result={{ total: 0, mentions: [], sections: [] }} />)
    expect(container.textContent).toBe('Nothing here.')
  })
})
