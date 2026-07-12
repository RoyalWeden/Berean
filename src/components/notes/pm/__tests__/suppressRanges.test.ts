import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { createSuppressRangesPlugin, suppressRangesKeymap, suppressRangesKey } from '../suppressRanges'
import { createRefDecorationsPlugin } from '../refDecorations'

// Direct unit test of the suppress-range plugin against a standalone
// EditorState/EditorView — more reliable than simulating the browser
// Selection API through jsdom (which doesn't reliably sync into PM's own
// selection tracking), and verifies the actual behavior instead of just
// "doesn't crash."
function makeView(content: string) {
  const state = EditorState.create({
    schema,
    doc: parseMarkdown(content),
    plugins: [suppressRangesKeymap, createSuppressRangesPlugin(), createRefDecorationsPlugin()],
  })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  const view = new EditorView(dom, { state })
  return view
}

describe('suppress-range plugin', () => {
  it('starts with no suppressed ranges and full ref decoration', () => {
    const view = makeView('See Gen 1:1 for context.')
    expect(suppressRangesKey.getState(view.state)).toEqual([])
    expect(view.dom.querySelector('.pm-verse-ref')).toBeTruthy()
    view.destroy()
  })

  it('Mod-Shift-r over a selection suppresses ref decoration in that range, and toggling again re-enables it', () => {
    const view = makeView('See Gen 1:1 for context.')
    const text = view.state.doc.textContent
    const from = text.indexOf('Gen 1:1') + 1 // +1 for the paragraph's opening position offset
    const to = from + 'Gen 1:1'.length

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))

    const handled = suppressRangesKeymap.props.handleKeyDown?.call(suppressRangesKeymap, view, new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true }))
    expect(handled).toBe(true)
    expect(suppressRangesKey.getState(view.state)?.length).toBe(1)
    expect(view.dom.querySelector('.pm-verse-ref')).toBeFalsy()

    // Toggle again over the same (now-mapped) selection → re-enable.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    suppressRangesKeymap.props.handleKeyDown?.call(suppressRangesKeymap, view, new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true }))
    expect(suppressRangesKey.getState(view.state)?.length).toBe(0)
    expect(view.dom.querySelector('.pm-verse-ref')).toBeTruthy()

    view.destroy()
  })

  it('does nothing when the selection is empty (matches CM6: toggle requires a non-empty selection)', () => {
    const view = makeView('See Gen 1:1 for context.')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)))
    const handled = suppressRangesKeymap.props.handleKeyDown?.call(suppressRangesKeymap, view, new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true }))
    expect(handled).toBe(false)
    expect(suppressRangesKey.getState(view.state)).toEqual([])
    view.destroy()
  })
})
