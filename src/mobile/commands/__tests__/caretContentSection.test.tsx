/** XREF-003 — the caret's Cross References: a collapsible section, collapsed by default, whose body
 *  is inline content in the caret's own scroll. NOTES-REF-001 — note tab cards show "Book C:V". */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { GitFork } from 'lucide-react'
vi.mock('../../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
import { CaretSheet } from '../CaretSheet'
import { tabTitle } from '../../tabs/TabCardsSheet'
import type { SheetApi } from '../../primitives/Sheet'

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('caret content section', () => {
  it('is collapsed by default with its summary, and expands into the content (no nested scroller)', () => {
    const api = { close: vi.fn(), push: vi.fn(), pop: vi.fn(), depth: 0 } as unknown as SheetApi
    const render = vi.fn(() => <div className="probe-xrefs">cards</div>)
    act(() => {
      root.render(<CaretSheet api={api} scope={() => ({ title: 'Matthew 5', sections: [
        { id: 'xrefs', collapsible: { label: 'Cross References', icon: GitFork, summary: 'Chapter' }, commands: [{ kind: 'content', id: 'list', label: 'Cross references', render }] },
      ] })} />)
    })
    const row = container.querySelector('.mobile-caret-disclosure') as HTMLButtonElement
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(row.textContent).toContain('Chapter')
    expect(container.querySelector('.probe-xrefs')).toBeNull()
    expect(render).not.toHaveBeenCalled()
    act(() => { row.click() })
    expect(container.querySelector('.mobile-caret-content .probe-xrefs')).not.toBeNull()
    expect(render).toHaveBeenCalledWith(api)
  })
})

describe('note tab title', () => {
  it('a vault verse-note title reads with a colon; other tabs are untouched', () => {
    expect(tabTitle({ id: 't', spaceId: 'notes', type: 'note', title: 'Matthew 5.3', state: {} } as never)).toBe('Matthew 5:3')
    expect(tabTitle({ id: 't', spaceId: 'notes', type: 'note', title: 'Budget 2026.5', state: {} } as never)).toBe('Budget 2026.5')
  })
})
