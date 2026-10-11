import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

// Reports the current non-empty selection's screen position so the
// consumer can position a floating formatting toolbar above it — same
// "plugin reports via callback, React owns the popup state" pattern as
// autocomplete.ts's trigger plugins.
export interface SelectionToolbarState {
  coords: { left: number; top: number; right: number; /** Bottom of the selection — the phone bubble sits below it, clear of the iOS callout. */ bottom: number }
  /** The selection is scrolled out of the note's visible area — the bubble hides until it returns. */
  offscreen?: boolean
}

export const selectionToolbarKey = new PluginKey('berean-selection-toolbar')

/** Screen rect of the current text selection — also re-read on scroll/resize (NoteEditorPM) so
 *  the bubble stays with the text instead of hanging where the selection used to be. */
export function selectionToolbarCoords(view: EditorView): SelectionToolbarState['coords'] {
  const { from, to } = view.state.selection
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  return {
    top: Math.min(start.top, end.top),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
    bottom: Math.max(start.bottom, end.bottom),
  }
}

export function createSelectionToolbarPlugin(onChange: (state: SelectionToolbarState | null) => void) {
  return new Plugin({
    key: selectionToolbarKey,
    view() {
      return {
        update(view, prevState) {
          if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection) && view.hasFocus()) {
            // still recompute below in case focus just changed, but skip
            // redundant work when nothing relevant changed at all
          }
          // A whole selected BLOCK (the gutter handle's NodeSelection) is not text to format —
          // it has its own block actions menu.
          if (view.state.selection.empty || !view.hasFocus() || view.state.selection instanceof NodeSelection) {
            onChange(null)
            return
          }
          onChange({ coords: selectionToolbarCoords(view) })
        },
      }
    },
  })
}
