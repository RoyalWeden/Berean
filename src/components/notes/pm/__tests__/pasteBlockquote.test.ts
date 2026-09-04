import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Slice } from 'prosemirror-model'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { reclosePastedWrapperBlock } from '../pastePlugin'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

// Build the OPEN slice a real "copy the whole blockquote" produces: select from
// inside the blockquote's first paragraph to inside its last, so the cut goes
// through both the paragraph and the blockquote on each side (matches the
// `data-pm-slice="2 2 []"` clipboard payload seen in the wild).
function openBlockquoteSlice(): Slice {
  const doc = parseMarkdown('> first line\n> second line')
  expect(doc.firstChild?.type.name).toBe('blockquote')
  // first non-zero text position .. last text position, both inside the blockquote
  const state = EditorState.create({ schema, doc })
  const from = 3 // inside "first line"
  const to = doc.content.size - 3 // inside "second line"
  return state.apply(state.tr.setSelection(TextSelection.create(doc, from, to))).selection.content()
}

describe('reclosePastedWrapperBlock', () => {
  it('the raw copied blockquote slice is open on both sides (the bug precondition)', () => {
    const s = openBlockquoteSlice()
    expect(s.openStart).toBeGreaterThan(0)
    expect(s.openEnd).toBeGreaterThan(0)
    expect(s.content.firstChild?.type.name).toBe('blockquote')
  })

  it('re-closes a lone blockquote slice so it pastes as a blockquote', () => {
    const out = reclosePastedWrapperBlock(openBlockquoteSlice())
    expect(out.openStart).toBe(0)
    expect(out.openEnd).toBe(0)
    expect(out.content.firstChild?.type.name).toBe('blockquote')
  })

  it('leaves a plain-text slice untouched', () => {
    const doc = parseMarkdown('just a sentence here')
    const s = doc.slice(3, 10)
    expect(reclosePastedWrapperBlock(s)).toBe(s)
  })

  it('leaves a mixed slice (paragraph + blockquote) untouched', () => {
    const doc = parseMarkdown('intro para\n\n> a quote')
    const s = doc.slice(2, doc.content.size - 2)
    expect(s.content.childCount).toBeGreaterThan(1)
    expect(reclosePastedWrapperBlock(s)).toBe(s)
  })

  it('end to end: pasting the re-closed slice into an empty note yields a blockquote', () => {
    const src = parseMarkdown('> first line\n> second line')
    const srcState = EditorState.create({ schema, doc: src })
    // select the blockquote's entire inner content (whole words)
    const full = srcState.apply(
      srcState.tr.setSelection(TextSelection.create(src, 2, src.content.size - 2)),
    ).selection.content()

    const dom = document.createElement('div')
    document.body.appendChild(dom)
    const view = new EditorView(dom, { state: EditorState.create({ schema, doc: parseMarkdown('') }) })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)))
    view.dispatch(view.state.tr.replaceSelection(reclosePastedWrapperBlock(full)))
    const md = serializeToMarkdown(view.state.doc)
    expect(md).toContain('> first line')
    expect(md).toContain('> second line')
    view.destroy()
  })
})
