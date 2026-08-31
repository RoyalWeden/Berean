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
  const NBSP = '\u00A0'

  it('Tab in a plain paragraph increases its left-indent level (and still reports handled, so focus never escapes the editor)', () => {
    const view = makeView('hello')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 6))) // end of "hello"
    const handled = press(view, 'Tab')
    expect(handled).toBe(true)
    expect(view.state.doc.firstChild?.attrs.indent).toBe(1)
    expect(serializeToMarkdown(view.state.doc)).toBe(`${NBSP.repeat(4)}hello`)
    press(view, 'Tab')
    expect(view.state.doc.firstChild?.attrs.indent).toBe(2)
    expect(serializeToMarkdown(view.state.doc)).toBe(`${NBSP.repeat(8)}hello`)
    view.destroy()
  })

  it('Shift-Tab decreases the indent one level, bottoms out at 0, and never deletes text', () => {
    const view = makeView(`${NBSP.repeat(8)}hello`)
    expect(view.state.doc.firstChild?.attrs.indent).toBe(2) // parsed back from the NBSP run
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3)))
    expect(press(view, 'Tab', { shiftKey: true })).toBe(true)
    expect(view.state.doc.firstChild?.attrs.indent).toBe(1)
    expect(press(view, 'Tab', { shiftKey: true })).toBe(true)
    expect(view.state.doc.firstChild?.attrs.indent).toBe(0)
    expect(serializeToMarkdown(view.state.doc)).toBe('hello')
    // Still handled (never escapes focus, never mutates) with nothing left to outdent.
    expect(press(view, 'Tab', { shiftKey: true })).toBe(true)
    expect(serializeToMarkdown(view.state.doc)).toBe('hello')
    view.destroy()
  })

  it('Tab inside a list nests the item (sinkListItem) — bullets are preserved, never indented as a bare paragraph', () => {
    const view = makeView('- one\n- two')
    // cursor inside the second item's text ("two")
    let twoPos = -1
    view.state.doc.descendants((n, pos) => { if (n.isText && n.text === 'two') twoPos = pos + 1 })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, twoPos)))
    expect(press(view, 'Tab')).toBe(true)
    const md = serializeToMarkdown(view.state.doc)
    expect(md).toContain('- one')
    expect(md).toMatch(/\n {2,}- two/) // second item now nested
    let sawIndentedPara = false
    view.state.doc.descendants((n) => { if (n.type.name === 'paragraph' && n.attrs.indent) sawIndentedPara = true })
    expect(sawIndentedPara).toBe(false) // no paragraph got a bare indent attr
    view.destroy()
  })

  it('Tab on the first/only bullet is a safe no-op — the bullet is not removed or turned into an indented paragraph', () => {
    const view = makeView('- solo')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 4)))
    const before = serializeToMarkdown(view.state.doc)
    expect(press(view, 'Tab')).toBe(true)
    expect(serializeToMarkdown(view.state.doc)).toBe(before) // still "- solo"
    view.destroy()
  })

  it('Tab with a text selection indents the paragraph instead of replacing the selection with a tab', () => {
    const view = makeView('hello world')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))) // select "hello"
    expect(press(view, 'Tab')).toBe(true)
    expect(view.state.doc.firstChild?.attrs.indent).toBe(1)
    expect(view.state.doc.textContent).toBe('hello world')
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
