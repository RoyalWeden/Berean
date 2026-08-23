import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state'

// When a drag-selection's range exactly spans one whole `thread` node — from just before its
// own opening boundary to just after its closing one — that means the user selected the ENTIRE
// thread as a unit, not just some text inside one of its entries. Convert that plain
// TextSelection into a NodeSelection over the thread, the same "select the whole thing as one
// block" treatment images already get for free from ProseMirror's own default
// node-selection-on-click (schema.ts's `image` spec leaves `selectable` at PM's default `true`
// and is a leaf node — see nodeViews.ts's imageNodeView comment). `thread`/`thread_entry` are
// NOT leaf nodes (real editable content lives inside them), so PM has no built-in equivalent
// for them — this plugin is that equivalent, applied only when the selection's boundaries land
// EXACTLY on the node's own start/end, never for a selection that merely overlaps or extends
// past it (dragging across a thread AND its neighboring paragraph stays a normal multi-block
// TextSelection, as it should).
//
// Also covers a sub-thread nested inside another thread's entry for free: the check is on
// `nodeAfter.type.name === 'thread'` alone, with no assumption about nesting depth — selecting
// a nested thread's own full range converts it exactly the same way.
export const threadSelectionKey = new PluginKey('berean-thread-selection')

export function createThreadSelectionPlugin() {
  return new Plugin({
    key: threadSelectionKey,
    view() {
      return {
        update(view, prevState) {
          const { selection, doc } = view.state
          if (selection.eq(prevState.selection) && doc.eq(prevState.doc)) return
          if (!(selection instanceof TextSelection) || selection.empty) return
          const $from = doc.resolve(selection.from)
          const nodeAfter = $from.nodeAfter
          if (!nodeAfter || nodeAfter.type.name !== 'thread') return
          if (selection.to !== selection.from + nodeAfter.nodeSize) return
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, selection.from)))
        },
      }
    },
  })
}
