import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from './schema'

// ─── Column add/remove controls (2.4 of the notes-editor migration plan) ───
//
// Decoration-based (recomputed fresh on every state update — the same
// approach blockHandles.ts already uses for the block drag-handle gutter),
// NOT a NodeView. A NodeView's `update()` lifecycle only reliably fires for
// changes to that node's OWN identity/attrs/content — not for a SIBLING
// column being added/removed elsewhere in the same column_list, which is
// exactly the signal that decides whether removing is even allowed
// (column_list's own schema.ts content model, `column{2,}`, forbids ever
// going below 2 columns). Decorations sidestep that: `decorations(state)`
// reruns from scratch on every transaction, so this is always computed
// against the CURRENT live child count, never a stale snapshot.
//
// UX note (deliberate simplification, not the plan's literal ask): controls
// are a single small toolbar rendered once per column_list (add a column /
// remove the LAST column), not a per-column overlay button in each column's
// own corner. A true per-column overlay would need the widget positioned
// as a DESCENDANT of that specific column's own DOM box, but a
// `Decoration.widget` at a column boundary position renders as a SIBLING of
// the column divs (inside column_list), not nested inside one — achieving
// a real per-corner overlay would need a NodeView after all, reintroducing
// the update() staleness problem above. One small toolbar is simpler and
// safer, at the cost of "remove exactly this column" — acceptable given
// point 4 of the task brief explicitly sanctions a simpler fallback UX here,
// and round-trip data correctness (not this affordance) is the priority.
export const columnControlsKey = new PluginKey('berean-column-controls')

function buildControls(listPos: number, listEndPos: number, childCount: number, view: EditorView) {
  return () => {
    const wrap = document.createElement('div')
    wrap.className = 'pm-column-controls'
    wrap.contentEditable = 'false'

    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.title = 'Add a column'
    addBtn.textContent = '+ Column'
    addBtn.addEventListener('mousedown', (e) => e.preventDefault())
    addBtn.addEventListener('click', (e) => {
      e.preventDefault()
      const tr = view.state.tr.insert(listEndPos, schema.nodes.column.create(null, schema.nodes.paragraph.create()))
      view.dispatch(tr)
      view.focus()
    })
    wrap.appendChild(addBtn)

    if (childCount > 2) {
      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.title = 'Remove the last column'
      removeBtn.textContent = '− Column'
      removeBtn.addEventListener('mousedown', (e) => e.preventDefault())
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault()
        const listNode = view.state.doc.nodeAt(listPos)
        if (!listNode || listNode.childCount <= 2) return
        const lastCol = listNode.lastChild!
        const lastColPos = listEndPos - lastCol.nodeSize
        view.dispatch(view.state.tr.delete(lastColPos, listEndPos))
        view.focus()
      })
      wrap.appendChild(removeBtn)
    }

    return wrap
  }
}

export function createColumnControlsPlugin() {
  // Same `liveView`-captured-via-view() pattern as blockHandles.ts, and for the identical
  // reason: `decorations(state)` receives only `state`, but hiding controls in read-only
  // 'view' mode needs the LIVE `editable` flag, which is flipped outside any transaction
  // (NoteEditorPM.tsx's `setProps({ editable })` on mode change).
  let liveView: EditorView | null = null

  return new Plugin({
    key: columnControlsKey,
    view(editorView) {
      liveView = editorView
      // Mirrors blockHandles.ts's own first-paint guard — decorations(state) runs once
      // during EditorView construction, before this view() hook (and thus before liveView is
      // set); forcing one extra redraw here lets a note that starts in read-only 'view' mode
      // correctly suppress controls from the very first paint instead of only after the next
      // edit-triggered redraw.
      if (!editorView.editable) editorView.updateState(editorView.state)
      return { destroy() { liveView = null } }
    },
    props: {
      decorations(state) {
        if (!liveView || !liveView.editable) return null
        const view = liveView
        const decorations: Decoration[] = []
        // Same defect shape blockHandles.ts's widget keys had (round 12 fix): keying on the raw
        // document `pos` meant any edit BEFORE a column_list — anywhere else in the note —
        // shifted that position, changing the key and forcing prosemirror-view to tear down and
        // rebuild this widget's DOM on every such keystroke. Track "the Nth column_list
        // encountered in this doc-order walk" instead — a stable identity that only changes when
        // a column_list itself is added/removed/reordered before this one, not on unrelated
        // typing. `childCount` stays IN the key deliberately: the remove button's presence
        // depends on it, so a genuine child-count change should still rebuild this widget.
        let columnListIndex = 0
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'column_list') return true
          const index = columnListIndex++
          const endPos = pos + node.nodeSize - 1
          decorations.push(Decoration.widget(endPos, buildControls(pos, endPos, node.childCount, view), {
            side: 1,
            key: `pm-col-controls-${index}-${node.childCount}`,
            ignoreSelection: true,
            // Narrowed from an unconditional `() => true` for the same reason
            // blockHandles.ts's own widget was (round 11.15): a stopEvent that
            // swallows EVERY event type means drag events originating on or
            // passing through this widget never reach prosemirror-view's
            // `eventBelongsToView` check, so PM's native drop handling — the
            // thing that actually performs a block move — silently never runs.
            // That breaks dragging a block over or into a column_list. Only the
            // mouse events these buttons genuinely need to own.
            stopEvent: (event) => event.type === 'mousedown' || event.type === 'click' || event.type === 'mouseup',
          }))
          return true
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
