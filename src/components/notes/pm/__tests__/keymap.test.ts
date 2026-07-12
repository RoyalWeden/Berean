import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { bereanKeymap } from '../keymap'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(content: string) {
  const state = EditorState.create({ schema, doc: parseMarkdown(content), plugins: [bereanKeymap] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

function press(view: EditorView, key: string, opts: Partial<KeyboardEventInit> = {}) {
  return bereanKeymap.props.handleKeyDown?.call(bereanKeymap, view, new KeyboardEvent('keydown', { key, ...opts }))
}

describe('bereanKeymap', () => {
  it('Tab in a plain paragraph inserts spaces instead of escaping the editor (regression: used to fall through to the browser default of moving focus elsewhere)', () => {
    const view = makeView('hello')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 6))) // end of "hello"
    const handled = press(view, 'Tab')
    expect(handled).toBe(true)
    expect(serializeToMarkdown(view.state.doc)).toBe('hello    ')
    view.destroy()
  })

  it('Shift-Tab outside a list is a safe no-op (still reports handled, so focus never escapes)', () => {
    const view = makeView('hello')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3)))
    const before = serializeToMarkdown(view.state.doc)
    const handled = press(view, 'Tab', { shiftKey: true })
    expect(handled).toBe(true)
    expect(serializeToMarkdown(view.state.doc)).toBe(before)
    view.destroy()
  })

  it('Mod-b toggles bold on and back off', () => {
    const view = makeView('hello world')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)))
    press(view, 'b', { ctrlKey: true })
    expect(serializeToMarkdown(view.state.doc)).toBe('**hello** world')
    press(view, 'b', { ctrlKey: true })
    expect(serializeToMarkdown(view.state.doc)).toBe('hello world')
    view.destroy()
  })

  it('Mod-Shift-h toggles the highlight mark on and back off', () => {
    const view = makeView('hello world')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)))
    press(view, 'h', { ctrlKey: true, shiftKey: true })
    expect(serializeToMarkdown(view.state.doc)).toBe('==hello== world')
    press(view, 'h', { ctrlKey: true, shiftKey: true })
    expect(serializeToMarkdown(view.state.doc)).toBe('hello world')
    view.destroy()
  })

  it('Shift-Enter inserts a hard line break within the same paragraph (not a new paragraph)', () => {
    const view = makeView('hello')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 6)))
    const handled = press(view, 'Enter', { shiftKey: true })
    expect(handled).toBe(true)
    view.dispatch(view.state.tr.insertText('world'))
    // A literal '\n' round-trips as an escaped hard break (matching the
    // markdown-it `breaks: true` line-break convention, markdownIt.ts) —
    // and critically, this is still ONE paragraph (hello+world joined by a
    // hard break), not two separate paragraphs (which plain Enter would
    // have produced instead).
    expect(serializeToMarkdown(view.state.doc)).toBe('hello\\\nworld')
    expect(view.state.doc.childCount).toBe(1)
    view.destroy()
  })
})
