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
function makeView(content: string, getNoteId?: () => string | null | undefined) {
  const state = EditorState.create({
    schema,
    doc: parseMarkdown(content),
    plugins: [suppressRangesKeymap, createSuppressRangesPlugin(getNoteId), createRefDecorationsPlugin()],
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

  // The reported bug: unlink (suppress) a verse ref in a note, switch away from
  // its tab (which unmounts/remounts the editor, rebuilding EditorState from
  // scratch via EditorState.create — same as a real note switch), then come
  // back — it must still be suppressed, not silently re-linked.
  it('a suppressed range survives a full EditorState rebuild for the same noteId (leaving and returning to a note)', () => {
    const noteId = 'note-abc'
    const view1 = makeView('See Gen 1:1 for context.', () => noteId)
    const text = view1.state.doc.textContent
    const from = text.indexOf('Gen 1:1') + 1
    const to = from + 'Gen 1:1'.length
    view1.dispatch(view1.state.tr.setSelection(TextSelection.create(view1.state.doc, from, to)))
    suppressRangesKeymap.props.handleKeyDown?.call(suppressRangesKeymap, view1, new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true }))
    expect(suppressRangesKey.getState(view1.state)?.length).toBe(1)
    view1.destroy()

    // Simulate leaving the tab and coming back: a brand-new EditorState/EditorView
    // for the SAME noteId, exactly like NoteEditorPM's note-switch effect does.
    const view2 = makeView('See Gen 1:1 for context.', () => noteId)
    expect(suppressRangesKey.getState(view2.state)?.length).toBe(1)
    expect(view2.dom.querySelector('.pm-verse-ref')).toBeFalsy()
    view2.destroy()
  })

  it('a different noteId does not inherit another note\'s suppressed ranges', () => {
    const view1 = makeView('See Gen 1:1 for context.', () => 'note-one')
    const text = view1.state.doc.textContent
    const from = text.indexOf('Gen 1:1') + 1
    const to = from + 'Gen 1:1'.length
    view1.dispatch(view1.state.tr.setSelection(TextSelection.create(view1.state.doc, from, to)))
    suppressRangesKeymap.props.handleKeyDown?.call(suppressRangesKeymap, view1, new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true }))
    view1.destroy()

    const view2 = makeView('See Gen 1:1 for context.', () => 'note-two')
    expect(suppressRangesKey.getState(view2.state)).toEqual([])
    expect(view2.dom.querySelector('.pm-verse-ref')).toBeTruthy()
    view2.destroy()
  })
})
