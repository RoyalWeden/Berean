import { Plugin, PluginKey } from 'prosemirror-state'
import { isInTable } from 'prosemirror-tables'

// Reports whether the cursor is currently inside a table so the toolbar can
// hide its table row/column controls otherwise — same "plugin reports via
// callback, React owns the derived state" pattern as selectionToolbarPlugin.ts.
// Kept as its own plugin rather than folded into selectionToolbarPlugin.ts since
// that one's SelectionToolbarState is specifically about non-empty selections
// (it goes null while the cursor merely sits inside a table with nothing
// selected), which isn't the question this needs answered.
export const tableStatusKey = new PluginKey('berean-table-status')

export function createTableStatusPlugin(onChange: (inTable: boolean) => void) {
  let last: boolean | null = null
  return new Plugin({
    key: tableStatusKey,
    view() {
      return {
        update(view, prevState) {
          if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) return
          const inTable = isInTable(view.state)
          if (inTable === last) return
          last = inTable
          onChange(inTable)
        },
      }
    },
  })
}
