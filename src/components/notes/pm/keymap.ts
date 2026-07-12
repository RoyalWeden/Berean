import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, chainCommands } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { sinkListItem, liftListItem, splitListItem } from 'prosemirror-schema-list'
import type { Command } from 'prosemirror-state'
import { bereanSchema as schema } from './schema'

const insertHardBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView())
  return true
}

// Fallback for Tab/Shift-Tab when nothing else claims it (not in a list,
// not in a table — those are handled by sinkListItem/liftListItem and
// tablePlugins.ts's goToNextCell respectively, both bound with higher
// priority). Without this, an unclaimed Tab keypress falls through to the
// BROWSER's default behavior: moving focus to the next focusable element
// on the page — silently kicking the user's cursor entirely out of the
// note editor. Insert 4 spaces instead, matching CM6's INDENT_UNIT.
const insertTabSpaces: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.insertText('    '))
  return true
}

// Cmd+B/I/`/U/Shift+H — direct prosemirror-commands `toggleMark`. Unlike the
// CM6 version (NoteEditor.tsx's `toggleWith`/`countStarsBeside`/
// `innermostStarPos`/`scanThroughHtml`, ~90 lines of star-parity-counting and
// HTML-tag-scanning to work out "am I inside a bold span" over flat text),
// this needs none of that: PM's document is a real mark/node tree, so
// `toggleMark` already knows exact mark boundaries. That whole subsystem is
// intentionally NOT ported — a real simplification, not a missing feature.
const marks = schema.marks

const noopTrue: Command = () => true

export const bereanKeymap = keymap({
  ...baseKeymap,
  'Mod-b': toggleMark(marks.strong),
  'Mod-i': toggleMark(marks.em),
  'Mod-`': toggleMark(marks.code),
  'Mod-u': toggleMark(marks.underline),
  'Mod-Shift-h': toggleMark(marks.highlight),
  'Mod-z': undo,
  'Mod-y': redo,
  'Mod-Shift-z': redo,
  // sinkListItem/liftListItem only apply inside a list; insertTabSpaces (Tab)
  // and noopTrue (Shift-Tab) are the guaranteed-to-handle-it fallbacks that
  // stop the key from escaping to the browser's default focus-change
  // behavior — see insertTabSpaces's comment above for why that matters.
  Tab: chainCommands(sinkListItem(schema.nodes.list_item), insertTabSpaces),
  'Shift-Tab': chainCommands(liftListItem(schema.nodes.list_item), noopTrue),
  Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
  'Shift-Enter': insertHardBreak,
  // Reserved by the app shell (scripture search, tab-nav history) — NOT
  // bound here, matching the CM6 keymap's explicit filtering of Mod-/,
  // Mod-[, Mod-] out of its own defaultKeymap spread.
})
