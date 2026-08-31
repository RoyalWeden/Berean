import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, chainCommands } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { sinkListItem, liftListItem, splitListItem } from 'prosemirror-schema-list'
import { NodeSelection, type Command } from 'prosemirror-state'
import { bereanSchema as schema } from './schema'
import { changeIndent } from './indent'
import { blockEnterAnimMeta } from './blockHandles'

const insertHardBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView())
  return true
}

// Tab / Shift-Tab in a plain paragraph — adjust its left-indent level (see schema.ts's
// `paragraph.indent` attr + changeIndent()). NOT a blockquote wrap (reads as a quote, not
// an indent) and NOT `insertText('    ')` (ProseMirror collapses leading whitespace at
// render, so it showed as a single space and never round-tripped).

// Last-resort Tab fallback: inside a code block a literal tab is what you want; ANYWHERE
// else just swallow the key (return true) so it never escapes to the browser's default of
// moving focus out of the editor — and never replaces a selection with a tab character.
const codeBlockTabOrNoop: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type === schema.nodes.code_block) {
    if (dispatch) dispatch(state.tr.insertText('\t'))
  }
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
  // Priority order: list indent (only inside a list) → paragraph left-indent → code-block
  // tab / swallow, so the key is always claimed and never escapes to the browser's
  // focus-change behavior.
  Tab: chainCommands(sinkListItem(schema.nodes.list_item), changeIndent(1), codeBlockTabOrNoop),
  'Shift-Tab': chainCommands(liftListItem(schema.nodes.list_item), changeIndent(-1), noopTrue),
  Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
  'Shift-Enter': insertHardBreak,
  // Reserved by the app shell (scripture search, tab-nav history) — NOT
  // bound here, matching the CM6 keymap's explicit filtering of Mod-/,
  // Mod-[, Mod-] out of its own defaultKeymap spread.
})

// ─── Keyboard block movement + Escape-to-select (round 12 item 5) ──────────
//
// A separate, per-instance keymap plugin (unlike `bereanKeymap` above, which is a single
// module-scope plugin instance reused by every editor) — `isPopupOpen` has to close over
// THIS editor's own React popup state (autocomplete triggers, the block menu, the floating
// search dialog), so it needs a factory the same way createAutocompletePlugin/
// createBlockHandlesPlugin already are.

// Resolves the top-level `block+` child (doc's own content model, schema.ts) that CONTAINS
// the given position — used by both moveTopLevelBlock and the Escape command below so
// "which block does this apply to" is answered identically regardless of how deep inside
// that block (a table cell, a list item, a nested blockquote) the cursor actually sits.
function topLevelBlockAt(doc: Parameters<Command>[0]['doc'], pos: number): { pos: number; node: import('prosemirror-model').Node } | null {
  const $pos = doc.resolve(pos)
  if ($pos.depth === 0) {
    // A NodeSelection already sitting on a top-level node resolves at depth 0 with
    // nodeAfter being that exact node — $pos.before(1) would throw (no depth-1 ancestor).
    const node = doc.nodeAt(pos)
    return node ? { pos, node } : null
  }
  const blockPos = $pos.before(1)
  const node = doc.nodeAt(blockPos)
  return node ? { pos: blockPos, node } : null
}

// Moves the top-level block containing the selection one position up/down among its
// siblings — reusing the exact "delete the source, then insert the SAME node at the
// mapped target position, in one transaction" shape blockHandles.ts's native-drag path
// produces (see blockHandles.test.ts:199-256, which this mirrors), so undo reverts the
// whole move in one step just like a drag-drop does. Selection lands as a NodeSelection
// over the block at its new position — same "just landed, still picked up" feel the
// drop path leaves behind (blockHandles.ts's own post-drop NodeSelection, before its
// collapse-to-caret timer fires).
function moveTopLevelBlock(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const current = topLevelBlockAt(state.doc, state.selection.from)
    if (!current) return false

    // One pass over every top-level child, recording position+node — then look up the
    // current block's own index in that list and the sibling `direction` away from it.
    // Bounds-checked BEFORE building any transaction, so an out-of-range move (already
    // first/last) is a clean no-op (returns false) rather than a malformed transaction.
    const children: Array<{ pos: number; node: import('prosemirror-model').Node }> = []
    state.doc.forEach((node, offset) => children.push({ pos: offset, node }))
    const currentIndex = children.findIndex((c) => c.pos === current.pos)
    const siblingIndex = currentIndex + direction
    if (currentIndex === -1 || siblingIndex < 0 || siblingIndex >= children.length) return false
    const sibling = children[siblingIndex]

    if (dispatch) {
      const tr = state.tr
      const { pos: fromPos, node } = current
      const fromEnd = fromPos + node.nodeSize
      // Target boundary is the OTHER side of the sibling being swapped past — moving up,
      // insert BEFORE the sibling; moving down, insert AFTER it.
      const targetPos = direction === -1 ? sibling.pos : sibling.pos + sibling.node.nodeSize
      tr.delete(fromPos, fromEnd)
      const mappedTarget = tr.mapping.map(targetPos)
      // `insert(pos, node)` places the node's own start exactly at `pos` — no further
      // mapping/guessing needed to know where it landed for the NodeSelection below.
      tr.insert(mappedTarget, node)
      tr.setSelection(NodeSelection.create(tr.doc, mappedTarget))
      tr.setMeta(blockEnterAnimMeta, mappedTarget)
      dispatch(tr)
    }
    return true
  }
}

// Escape, with the cursor inside a block and nothing else claiming the key (no autocomplete
// popup, no block menu, no floating search — see `isPopupOpen`'s doc comment at the call
// site), selects the enclosing top-level block as a NodeSelection — the same selection state
// blockHandles.ts's grip stages on mousedown, so it immediately gets the exact same "lifted
// card" visual treatment (pmEditor.css's `.ProseMirror-selectednode`) via keyboard alone.
// Deliberately a no-op (returns false, letting the key fall through) when the selection is
// ALREADY a NodeSelection — nothing further for THIS command to do; prosemirror-view's own
// baseKeymap has no competing Escape binding, so falling through here is safe.
function escapeSelectBlock(isPopupOpen: () => boolean): Command {
  return (state, dispatch) => {
    if (isPopupOpen()) return false
    if (state.selection instanceof NodeSelection) return false
    const current = topLevelBlockAt(state.doc, state.selection.from)
    if (!current) return false
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, current.pos)))
    return true
  }
}

export function createBlockMovementKeymap(isPopupOpen: () => boolean) {
  return keymap({
    'Mod-Shift-ArrowUp': moveTopLevelBlock(-1),
    'Mod-Shift-ArrowDown': moveTopLevelBlock(1),
    Escape: escapeSelectBlock(isPopupOpen),
  })
}
