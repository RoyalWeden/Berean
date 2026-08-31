import { type Command } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { bereanSchema as schema, MAX_INDENT } from './schema'

/**
 * Increase (delta = 1) or decrease (delta = -1) the left-indent level of every plain
 * paragraph touched by the current selection. Returns false (so the caller's command
 * chain can fall through to a no-op — never to a text-replacing fallback) when there is
 * no eligible paragraph in range, or every one is already at the min/max level. Used by
 * both the Tab / Shift-Tab keymap and the toolbar Indent / Outdent buttons.
 *
 * Paragraphs inside a list item are DELIBERATELY excluded — list nesting is owned entirely
 * by sinkListItem / liftListItem (chained ahead of this in keymap.ts / editorCommands.ts),
 * and stamping a margin on the inner paragraph there just detaches the text from its bullet.
 */
export function changeIndent(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const para = schema.nodes.paragraph
    const listItem = schema.nodes.list_item
    const targets: Array<{ pos: number; node: PMNode }> = []
    const { from, to, empty, $from } = state.selection

    if (empty) {
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === para) {
          if ($from.node(d - 1)?.type !== listItem) targets.push({ pos: $from.before(d), node: $from.node(d) })
          break
        }
      }
    } else {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === para && state.doc.resolve(pos).parent.type !== listItem) targets.push({ pos, node })
      })
    }

    const applicable = targets.filter(({ node }) => {
      const next = ((node.attrs.indent as number) || 0) + delta
      return next >= 0 && next <= MAX_INDENT
    })
    if (!applicable.length) return false

    if (dispatch) {
      let tr = state.tr
      // setNodeMarkup keeps node size constant, so earlier positions stay valid for the
      // later ones within the same transaction — no position mapping needed.
      for (const { pos, node } of applicable) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: ((node.attrs.indent as number) || 0) + delta })
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}
