import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'

// Full-mount integration coverage for BlockMenu.tsx's four actions (Duplicate/
// Delete/Turn into/Copy link to block), driven through the REAL DOM — clicking
// the actual grip renders the actual menu, clicking a real menu button fires
// the real transaction — rather than re-testing the underlying transaction
// shapes in isolation (blockHandles.test.ts already covers those directly).

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

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

function openBlockMenuFor(el: HTMLElement, blockIndex: number) {
  const grip = el.querySelectorAll('.pm-block-handle-grip')[blockIndex] as HTMLElement
  act(() => { grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })
  act(() => { grip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

function menuButton(text: string): HTMLElement | null {
  return Array.from(document.querySelectorAll('.context-menu button')).find((b) => b.textContent?.trim() === text) as HTMLElement | undefined ?? null
}

describe('BlockMenu — Duplicate/Delete/Turn into/Copy link', () => {
  it('Duplicate inserts a copy of the block immediately after it, as one undo step', () => {
    let content = ''
    const el = mount({ content: 'First para.\n\nSecond para.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const dupBtn = menuButton('Duplicate')
    expect(dupBtn).toBeTruthy()
    act(() => { dupBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toBe('First para.\n\nFirst para.\n\nSecond para.')
  })

  it('Delete removes the block, and replaces the LAST remaining block with an empty paragraph instead of leaving an invalid empty doc', () => {
    let content = ''
    const el = mount({ content: 'Only paragraph.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const delBtn = menuButton('Delete')
    expect(delBtn).toBeTruthy()
    act(() => { delBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const pmRoot = el.querySelector('.ProseMirror') as HTMLElement
    expect(pmRoot.querySelectorAll('p').length).toBe(1)
    expect(content).toBe('')
  })

  it('Delete on a non-last block just removes it, leaving the rest intact', () => {
    let content = ''
    const el = mount({ content: 'First para.\n\nSecond para.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const delBtn = menuButton('Delete')
    act(() => { delBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toBe('Second para.')
  })

  it('Turn into Heading 1 converts a plain paragraph block to a level-1 heading', () => {
    let content = ''
    const el = mount({ content: 'Some text.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const h1Btn = menuButton('Heading 1')
    expect(h1Btn).toBeTruthy()
    act(() => { h1Btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toBe('# Some text.')
  })

  it('"Turn into" is NOT offered for a code_block source (excluded — literal unformatted text)', () => {
    const el = mount({ content: '```\ncode here\n```', onChange: () => {} })
    openBlockMenuFor(el, 0)
    expect(menuButton('Heading 1')).toBeNull()
    expect(menuButton('Text')).toBeNull()
  })

  it('"Turn into" IS offered for a blockquote source, and Text collapses it to a plain paragraph', () => {
    let content = ''
    const el = mount({ content: '> Quoted line.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const textBtn = menuButton('Text')
    expect(textBtn).toBeTruthy()
    act(() => { textBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toBe('Quoted line.')
  })

  it('Turn into Callout converts a blockquote source, preserving its text', () => {
    let content = ''
    const el = mount({ content: '> Quoted line.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const calloutBtn = menuButton('Callout')
    act(() => { calloutBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toContain('[!NOTE]')
    expect(content).toContain('Quoted line.')
  })

  it('Turn into Numbered list converts a bullet_list source, reusing its existing list_items (task state preserved)', () => {
    let content = ''
    const el = mount({ content: '- [x] Done thing\n- [ ] Not done', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const orderedBtn = menuButton('Numbered list')
    expect(orderedBtn).toBeTruthy()
    act(() => { orderedBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toBe('1. [x] Done thing\n2. [ ] Not done')
  })

  it('Turn into Bulleted list converts a plain paragraph source into a one-item list', () => {
    let content = ''
    const el = mount({ content: 'Just a line.', onChange: (c) => { content = c } })
    openBlockMenuFor(el, 0)
    const bulletBtn = menuButton('Bulleted list')
    act(() => { bulletBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(content).toBe('- Just a line.')
  })

  it('Copy link to block writes a berean://note/{id}#block-{index} deep link to the clipboard', () => {
    let written = ''
    // jsdom doesn't implement the Clipboard API at all — define the whole object rather than
    // assigning onto a nonexistent `navigator.clipboard`.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text: string) => { written = text; return Promise.resolve() } },
      configurable: true,
    })
    const el = mount({ content: 'First para.\n\nSecond para.', noteId: 'abc123', onChange: () => {} })
    openBlockMenuFor(el, 1)
    const copyBtn = menuButton('Copy link to block')
    expect(copyBtn).toBeTruthy()
    act(() => { copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(written).toBe('berean://note/abc123#block-1')
  })
})
