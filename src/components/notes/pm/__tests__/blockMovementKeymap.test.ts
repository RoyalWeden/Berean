import { describe, it, expect } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo } from 'prosemirror-history'
import { bereanSchema as schema } from '../schema'
import { createBlockMovementKeymap } from '../keymap'

// Round 12 item 5: Cmd+Shift+Up/Down block reorder, Escape-to-select-block. Mirrors
// blockHandles.test.ts's own docFromParagraphs helper rather than importing it (test files
// intentionally don't share fixtures across suites in this codebase).

function docFromParagraphs(...lines: string[]) {
  return schema.nodes.doc.create(null, lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : undefined)))
}

// Mirrors keymap.test.ts's own `press` helper: calls the plugin's `handleKeyDown` prop
// directly rather than dispatching a real DOM KeyboardEvent — prosemirror-keymap's own
// "Mod" normalization is platform-sniffed (Cmd on Mac, Ctrl elsewhere), which jsdom doesn't
// reliably report either way; calling the handler directly sidesteps that entirely. Returns
// both the live view and its plugin instance (createBlockMovementKeymap is a factory, unlike
// bereanKeymap's single shared module-scope instance) since `press` needs the latter.
function makeView(doc: ReturnType<typeof docFromParagraphs>, isPopupOpen: () => boolean = () => false) {
  const plugin = createBlockMovementKeymap(isPopupOpen)
  const state = EditorState.create({ schema, doc, plugins: [history(), plugin] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  const view = new EditorView(dom, { state })
  return { view, plugin }
}

function press(view: EditorView, plugin: ReturnType<typeof createBlockMovementKeymap>, key: string, opts: Partial<KeyboardEventInit> = {}) {
  return plugin.props.handleKeyDown?.call(plugin, view, new KeyboardEvent('keydown', { key, ...opts }))
}

describe('Mod-Shift-ArrowUp/Down — top-level block reorder', () => {
  it('moves the block containing the cursor down one position, as one undo step', () => {
    const doc = docFromParagraphs('AAA', 'BBB', 'CCC')
    const { view, plugin } = makeView(doc)
    const before = view.state.doc.toString()
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1)))) // inside "AAA"
    press(view, plugin, 'ArrowDown', { ctrlKey: true, shiftKey: true })

    expect(view.state.doc.child(0).textContent).toBe('BBB')
    expect(view.state.doc.child(1).textContent).toBe('AAA')
    expect(view.state.doc.child(2).textContent).toBe('CCC')
    // Lands as a NodeSelection over the moved block, same as a drag-drop.
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect((view.state.selection as NodeSelection).node.textContent).toBe('AAA')

    undo(view.state, view.dispatch)
    expect(view.state.doc.toString()).toBe(before)
    view.destroy()
  })

  it('moves the block containing the cursor up one position', () => {
    const doc = docFromParagraphs('AAA', 'BBB', 'CCC')
    const { view, plugin } = makeView(doc)
    const ccc = doc.child(0).nodeSize + doc.child(1).nodeSize + 1
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(ccc))))
    press(view, plugin, 'ArrowUp', { ctrlKey: true, shiftKey: true })

    expect(view.state.doc.child(0).textContent).toBe('AAA')
    expect(view.state.doc.child(1).textContent).toBe('CCC')
    expect(view.state.doc.child(2).textContent).toBe('BBB')
    view.destroy()
  })

  it('is a no-op at the top edge (ArrowUp on the first block) and bottom edge (ArrowDown on the last block)', () => {
    const doc = docFromParagraphs('AAA', 'BBB')
    const { view, plugin } = makeView(doc)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1))))
    press(view, plugin, 'ArrowUp', { ctrlKey: true, shiftKey: true })
    expect(view.state.doc.child(0).textContent).toBe('AAA')
    expect(view.state.doc.child(1).textContent).toBe('BBB')

    const bbbStart = doc.child(0).nodeSize + 1
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(bbbStart))))
    press(view, plugin, 'ArrowDown', { ctrlKey: true, shiftKey: true })
    expect(view.state.doc.child(0).textContent).toBe('AAA')
    expect(view.state.doc.child(1).textContent).toBe('BBB')
    view.destroy()
  })

  it('also moves a block already selected as a NodeSelection (e.g. a prior Escape select)', () => {
    const doc = docFromParagraphs('AAA', 'BBB', 'CCC')
    const { view, plugin } = makeView(doc)
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
    press(view, plugin, 'ArrowDown', { ctrlKey: true, shiftKey: true })
    expect(view.state.doc.child(0).textContent).toBe('BBB')
    expect(view.state.doc.child(1).textContent).toBe('AAA')
    view.destroy()
  })
})

describe('Escape — select the enclosing top-level block', () => {
  it('turns a plain caret selection into a NodeSelection over its enclosing top-level block', () => {
    const doc = docFromParagraphs('AAA', 'BBB')
    const { view, plugin } = makeView(doc)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(2))))
    press(view, plugin, 'Escape')
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect((view.state.selection as NodeSelection).node.textContent).toBe('AAA')
    view.destroy()
  })

  it('selects the enclosing block even when the cursor is nested inside a list item', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bullet_list.create({ marker: '-' }, [
        schema.nodes.list_item.create(null, [schema.nodes.paragraph.create(null, schema.text('nested'))]),
      ]),
    ])
    const { view, plugin } = makeView(doc as unknown as ReturnType<typeof docFromParagraphs>)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(3))))
    press(view, plugin, 'Escape')
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect((view.state.selection as NodeSelection).node.type.name).toBe('bullet_list')
    view.destroy()
  })

  it('does nothing when a popup is reported open — leaves the text caret exactly as it was', () => {
    const doc = docFromParagraphs('AAA')
    const { view, plugin } = makeView(doc, () => true)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1))))
    press(view, plugin, 'Escape')
    expect(view.state.selection).not.toBeInstanceOf(NodeSelection)
    view.destroy()
  })

  it('is a no-op when the selection is already a NodeSelection', () => {
    const doc = docFromParagraphs('AAA', 'BBB')
    const { view, plugin } = makeView(doc)
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
    press(view, plugin, 'Escape')
    // Still selecting the same block — nothing changed.
    expect((view.state.selection as NodeSelection).from).toBe(0)
    view.destroy()
  })
})
