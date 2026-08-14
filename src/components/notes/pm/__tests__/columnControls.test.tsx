import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'

// Closes a named test gap (round 12): columnControls.ts's add/remove-column buttons had no
// coverage at all. Mirrors blockMenu.test.tsx's full-mount-through-the-real-DOM approach.

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

function mount(content: string, onChange: (c: string) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM content={content} onChange={onChange} />))
  return container
}

const TWO_COL_MD = [
  '<!-- berean:columns -->',
  '<!-- berean:col -->',
  'Left.',
  '<!-- /berean:col -->',
  '<!-- berean:col -->',
  'Right.',
  '<!-- /berean:col -->',
  '<!-- /berean:columns -->',
].join('\n')

describe('columnControls', () => {
  it('renders a "+ Column" button for a 2-column list, and NO "− Column" button (schema requires 2+ columns)', () => {
    const el = mount(TWO_COL_MD, () => {})
    const buttons = Array.from(el.querySelectorAll('.pm-column-controls button')).map((b) => b.textContent)
    expect(buttons).toContain('+ Column')
    expect(buttons).not.toContain('− Column')
  })

  it('clicking "+ Column" appends a 3rd empty column, and NOW shows a "− Column" button', () => {
    let content = ''
    const el = mount(TWO_COL_MD, (c) => { content = c })
    const addBtn = Array.from(el.querySelectorAll('.pm-column-controls button')).find((b) => b.textContent === '+ Column') as HTMLElement
    act(() => { addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(el.querySelectorAll('.pm-column').length).toBe(3)
    const buttons = Array.from(el.querySelectorAll('.pm-column-controls button')).map((b) => b.textContent)
    expect(buttons).toContain('− Column')
    expect(content).toContain('<!-- berean:col -->\n\n<!-- /berean:col -->') // the new empty 3rd column
  })

  it('clicking "− Column" removes the LAST column, and hides the button again once back to 2', () => {
    let content = ''
    const el = mount(TWO_COL_MD, (c) => { content = c })
    const addBtn = Array.from(el.querySelectorAll('.pm-column-controls button')).find((b) => b.textContent === '+ Column') as HTMLElement
    act(() => { addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(el.querySelectorAll('.pm-column').length).toBe(3)

    const removeBtn = Array.from(el.querySelectorAll('.pm-column-controls button')).find((b) => b.textContent === '− Column') as HTMLElement
    act(() => { removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(el.querySelectorAll('.pm-column').length).toBe(2)
    expect(content).toContain('Left.')
    expect(content).toContain('Right.')
    const buttons = Array.from(el.querySelectorAll('.pm-column-controls button')).map((b) => b.textContent)
    expect(buttons).not.toContain('− Column')
  })

  it('renders no column controls at all when the view is not editable (read-only "view" mode)', () => {
    const el = mount(TWO_COL_MD, () => {})
    act(() => root!.render(<NoteEditorPM content={TWO_COL_MD} onChange={() => {}} mode="view" />))
    expect(el.querySelectorAll('.pm-column-controls').length).toBe(0)
  })
})
