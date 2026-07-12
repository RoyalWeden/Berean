import { Plugin, PluginKey } from 'prosemirror-state'

// Reports the current non-empty selection's screen position so the
// consumer can position a floating formatting toolbar above it — same
// "plugin reports via callback, React owns the popup state" pattern as
// autocomplete.ts's trigger plugins.
export interface SelectionToolbarState {
  coords: { left: number; top: number; right: number }
}

export const selectionToolbarKey = new PluginKey('berean-selection-toolbar')

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
          if (view.state.selection.empty || !view.hasFocus()) {
            onChange(null)
            return
          }
          const { from, to } = view.state.selection
          const start = view.coordsAtPos(from)
          const end = view.coordsAtPos(to)
          const top = Math.min(start.top, end.top)
          const left = Math.min(start.left, end.left)
          const right = Math.max(start.right, end.right)
          onChange({ coords: { left, top, right } })
        },
      }
    },
  })
}
