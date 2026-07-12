import { tableEditing, columnResizing, goToNextCell, addRowAfter, deleteRow, deleteColumn } from 'prosemirror-tables'
import { keymap } from 'prosemirror-keymap'
import type { Command } from 'prosemirror-state'

// prosemirror-tables' own editing plugin (cell selection, merge/split
// commands, backspace-in-empty-cell handling) + column resizing (mouse-drag
// column-width handles — a genuine UX upgrade over CM6's hand-rolled
// TableBlockWidget, which only supported +/- row/col buttons, not drag
// resize). Replaces the CM6 architecture's module-level `_tableView`
// mutable-view-reference hack (NoteEditor.tsx:1805/3346, needed because a
// WidgetType has no view handle otherwise) — PM table nodes are first-class,
// so no such workaround is needed here.
export const bereanTableEditingPlugin = tableEditing()
export const bereanColumnResizingPlugin = columnResizing()

// Tab/Shift-Tab inside a table moves between cells (standard spreadsheet-
// style navigation); falls through to the regular list-indent keymap
// (keymap.ts) when the selection isn't inside a table, since `goToNextCell`
// returns false there.
const tableNavKeymap = keymap({
  Tab: goToNextCell(1) as Command,
  'Shift-Tab': goToNextCell(-1) as Command,
})

export const bereanTablePlugins = [bereanColumnResizingPlugin, bereanTableEditingPlugin, tableNavKeymap]

export { addRowAfter, deleteRow, deleteColumn }
