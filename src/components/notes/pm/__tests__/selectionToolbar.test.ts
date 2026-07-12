import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { createSelectionToolbarPlugin } from '../selectionToolbarPlugin'

// jsdom doesn't implement Range.getClientRects()/getBoundingClientRect() at
// all (throws), unlike real Chromium — polyfill a degenerate zero-rect so
// prosemirror-view's `coordsAtPos` (which the toolbar plugin calls) doesn't
// throw in this test environment. Not needed in the real app (Electron's
// Chromium fully supports these).
beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(content: string, onToolbarChange: (s: unknown) => void) {
  const state = EditorState.create({
    schema,
    doc: parseMarkdown(content),
    plugins: [createSelectionToolbarPlugin(onToolbarChange)],
  })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

describe('selection toolbar plugin + mark application', () => {
  it('reports null while the selection is empty, and a coords object once a real selection is made', () => {
    const reports: unknown[] = []
    const view = makeView('Hello world', (s) => reports.push(s))
    expect(reports.length).toBe(0) // no report yet — no selection change dispatched
    view.focus() // the plugin only reports a toolbar for a focused view

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)))
    expect(reports.length).toBe(1)
    expect(reports[0]).toMatchObject({ coords: expect.any(Object) })

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3)))
    expect(reports[reports.length - 1]).toBe(null)

    view.destroy()
  })

  it('toggling bold on a selection actually applies the strong mark (verified via serialized markdown)', () => {
    const view = makeView('Hello world', () => {})
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)))
    toggleMark(schema.marks.strong)(view.state, view.dispatch)
    const out = serializeToMarkdown(view.state.doc)
    expect(out).toBe('**Hello** world')
    view.destroy()
  })

  it('applying a colored highlight mark directly (as SelectionToolbar.applyHighlight does) round-trips to <mark class="hl-COLOR">', () => {
    const view = makeView('Hello world', () => {})
    const { from, to } = { from: 1, to: 6 }
    view.dispatch(view.state.tr.addMark(from, to, schema.marks.highlight.create({ color: 'teal' })))
    const out = serializeToMarkdown(view.state.doc)
    expect(out).toBe('<mark class="hl-teal">Hello</mark> world')
    view.destroy()
  })
})
