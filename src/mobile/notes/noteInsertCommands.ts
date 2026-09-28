import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { BookOpen, Image, Link2, Heading, List, CheckSquare, Quote, Minus, type LucideIcon } from 'lucide-react'
import { SLASH_COMMANDS } from '@/components/notes/pm/slashCommands'
import { bereanSchema as schema } from '@/components/notes/pm/schema'

/**
 * The phone note editor's + menu (TEST25-NOTES-003): a short list of inserts, each one the
 * editor's OWN slash command (slashCommands.ts) run at the cursor — no duplicated command logic.
 * Link is the one exception: it needs a URL, so it has its own small insert below.
 */
export type NoteInsertId = 'verse' | 'image' | 'link' | 'h2' | 'bullet' | 'task' | 'quote' | 'divider'

export const NOTE_INSERT_ITEMS: Array<{ id: NoteInsertId; label: string; icon: LucideIcon }> = [
  { id: 'verse', label: 'Scripture reference', icon: BookOpen },
  { id: 'image', label: 'Image', icon: Image },
  { id: 'link', label: 'Link', icon: Link2 },
  { id: 'h2', label: 'Heading', icon: Heading },
  { id: 'bullet', label: 'Bulleted list', icon: List },
  { id: 'task', label: 'Checklist', icon: CheckSquare },
  { id: 'quote', label: 'Quote', icon: Quote },
  { id: 'divider', label: 'Divider', icon: Minus },
]

/** Move the cursor onto an empty line of its own (after the current block) unless it already is. */
function ensureEmptyLine(view: EditorView) {
  const { $from } = view.state.selection
  if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) return
  const depth = $from.depth > 0 ? 1 : 0
  const after = depth ? $from.after(depth) : view.state.doc.content.size
  const tr = view.state.tr.insert(after, schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  view.dispatch(tr)
}

/** Run one + menu insert at the editor's cursor (an empty range: the slash commands' trigger
 *  delete becomes a no-op). `link` is handled by `insertLink`. */
export function runNoteInsert(view: EditorView, id: Exclude<NoteInsertId, 'link'>): void {
  const cmd = SLASH_COMMANDS.find((c) => c.id === id)
  if (!cmd) return
  // A reference is typed on its own line so the verse-block suggestion can pick it up.
  if (id === 'verse') ensureEmptyLine(view)
  const at = view.state.selection.head
  if (!view.state.selection.empty) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
  cmd.run(view, at, at)
}

/** Link: over a selection → link it (the selection bubble's own path); otherwise insert the label
 *  (or the URL itself) as linked text at the cursor. */
export function insertLink(view: EditorView, url: string, label?: string): void {
  const href = url.trim()
  if (!href) return
  const { from, to, empty } = view.state.selection
  const mark = schema.marks.link.create({ href })
  if (!empty) {
    view.dispatch(view.state.tr.addMark(from, to, mark))
  } else {
    const text = (label ?? '').trim() || href
    const tr = view.state.tr.insert(from, schema.text(text, [mark]))
    tr.setSelection(TextSelection.create(tr.doc, from + text.length))
    tr.removeStoredMark(schema.marks.link)
    view.dispatch(tr)
  }
  view.focus()
}
