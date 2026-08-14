import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { setBlockType, wrapIn } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { bereanSchema as schema } from './schema'
import { useAppStore } from '@/store'

// ─── Slash-command menu ─────────────────────────────────────────────────────
// Typing "/" (at the start of a line, OR right after existing text on that
// line — see autocomplete.ts's lookbehind-based trigger regex) opens a
// Notion/Octarine-style menu of block types to insert/convert to — trigger
// detection lives in autocomplete.ts (createAutocompletePlugin's
// onSlashCommandTrigger, alongside the existing "[[", "H1234", and
// verse-ref triggers). This file is just the command list + how each one
// actually transforms the doc.

export interface SlashCommand {
  id: string
  label: string
  description: string
  keywords: string[]
  group: 'Basic blocks' | 'Callouts'
  run: (view: EditorView, from: number, to: number) => void
}

// Deletes just the "/query" trigger text first, THEN runs a block command
// against the resulting (now-current) state — setBlockType/wrapIn/
// wrapInList all act on the live selection, not an arbitrary [from,to)
// range, so the delete has to be dispatched and settled before the command
// runs against the fresh view.state. Any text before the "/" on the same
// line is left untouched by the delete and ends up carried along by
// whichever command runs (setBlockType/wrapIn/wrapInList all act on the
// WHOLE enclosing textblock, not just the selection point, so "Existing
// text /h2" correctly becomes a level-2 heading containing "Existing text",
// not just an empty heading).
function applyBlockCommand(view: EditorView, from: number, to: number, apply: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) {
  view.dispatch(view.state.tr.delete(from, to))
  apply(view.state, view.dispatch)
  view.focus()
}

function toParagraph(view: EditorView, from: number, to: number) {
  applyBlockCommand(view, from, to, setBlockType(schema.nodes.paragraph))
}

function toHeading(level: number) {
  return (view: EditorView, from: number, to: number) => {
    applyBlockCommand(view, from, to, setBlockType(schema.nodes.heading, { level }))
  }
}

function toBulletList(marker: string) {
  return (view: EditorView, from: number, to: number) => {
    applyBlockCommand(view, from, to, wrapInList(schema.nodes.bullet_list, { marker }))
  }
}

function toOrderedList(view: EditorView, from: number, to: number) {
  applyBlockCommand(view, from, to, wrapInList(schema.nodes.ordered_list))
}

// Task lists are plain bullet lists whose list_item has `checked` set —
// same two-step relationship SelectionToolbar.tsx's toggleTaskList already
// uses: wrap in a bullet_list, then stamp `checked: false` onto the
// resulting list_item (there's no single schema node for "task item", it's
// bullet_list + an attr, matching inputRules.ts's taskCheckboxRule design).
function toTaskList(view: EditorView, from: number, to: number) {
  view.dispatch(view.state.tr.delete(from, to))
  const cmd = wrapInList(schema.nodes.bullet_list)
  cmd(view.state, (tr) => {
    view.dispatch(tr)
    const { from: selFrom, to: selTo } = view.state.selection
    const stampTr = view.state.tr
    view.state.doc.nodesBetween(selFrom, selTo, (node, pos) => {
      if (node.type.name === 'list_item' && node.attrs.checked === null) stampTr.setNodeAttribute(pos, 'checked', false)
    })
    if (stampTr.docChanged) view.dispatch(stampTr)
  })
  view.focus()
}

function toBlockquote(view: EditorView, from: number, to: number) {
  applyBlockCommand(view, from, to, wrapIn(schema.nodes.blockquote))
}

function toCodeBlock(view: EditorView, from: number, to: number) {
  applyBlockCommand(view, from, to, setBlockType(schema.nodes.code_block))
}

function toCallout(calloutType: string) {
  return (view: EditorView, from: number, to: number) => {
    applyBlockCommand(view, from, to, wrapIn(schema.nodes.callout, { calloutType }))
  }
}

// The slash trigger's [from, to) range is always INSIDE the enclosing
// paragraph, not spanning its actual node boundaries — replaceWith(from,
// to, blockNode) at an inline position doesn't fit a block-level node the
// way it needs to (PM's slice-fitting silently fails to insert it at all,
// leaving the paragraph untouched). Same fix as autocomplete.ts's
// replaceRangeWithBlock: widen the range to the paragraph's own start/end
// first when it exactly spans that paragraph's full content (the common
// case — an otherwise-empty line). When the "/" comes after existing text
// instead, the (unwidened) range still correctly splits the paragraph at
// that point via PM's normal fitting behavior — "Existing text /table"
// becomes "Existing text" as its own paragraph, followed by the table.
export function insertBlockNode(view: EditorView, from: number, to: number, node: PMNode) {
  const { doc } = view.state
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  const spansWholeParagraph =
    $from.parent.type.name === 'paragraph' && $from.sameParent($to) &&
    $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size
  const rangeFrom = spansWholeParagraph ? $from.before() : from
  const rangeTo = spansWholeParagraph ? $to.after() : to
  view.dispatch(view.state.tr.replaceWith(rangeFrom, rangeTo, node))
  view.focus()
}

function insertHorizontalRule(view: EditorView, from: number, to: number) {
  insertBlockNode(view, from, to, schema.nodes.horizontal_rule.create())
}

// prosemirror-tables ships no "build a default table" helper — table_cell/
// table_header hold `inline*` content directly (schema.ts's cellContent
// config), so an empty cell is just `create()` with no child paragraph.
export function buildEmptyTable(): PMNode {
  const cell = () => schema.nodes.table_cell.create()
  const header = () => schema.nodes.table_header.create()
  const headerRow = schema.nodes.table_row.create(null, [header(), header()])
  const bodyRow = schema.nodes.table_row.create(null, [cell(), cell()])
  return schema.nodes.table.create(null, [headerRow, bodyRow])
}

function insertTable(view: EditorView, from: number, to: number) {
  insertBlockNode(view, from, to, buildEmptyTable())
}

// Side-by-side columns (2.4). This is the actual editor-UX ENTRY POINT for creating a
// column_list — the plan's originally-specified "drag a block onto another's left/right
// edge" interaction was evaluated against blockHandles.ts's existing native-HTML5-drag
// mechanism and found to have no clean hook point: PM's own `handleDrop` resolves ONE
// target position from the drop coordinate with no secondary "which side of this block"
// signal, so a second drop-zone mode would need a hand-rolled dragover interceptor fighting
// that native path rather than extending it. Given round-trip correctness (not this specific
// UX flourish) is the priority on this piece, this slash command — plus the add/remove-
// column buttons rendered by columnControls.ts — is the simpler, explicitly-sanctioned
// fallback entry point instead.
export function buildColumnList(count = 2): PMNode {
  const columns = Array.from({ length: count }, () => schema.nodes.column.create(null, schema.nodes.paragraph.create()))
  return schema.nodes.column_list.create(null, columns)
}

function insertColumns(view: EditorView, from: number, to: number) {
  insertBlockNode(view, from, to, buildColumnList(2))
}

// Verse blocks are deliberately NOT a schema node (see schema.ts's NOTE comment) — they're
// plain paragraph text that blockDecorations.ts recognizes and boxes once it matches a real
// verse in the DB (async-verified). This command doesn't insert a verse itself; it clears the
// way for the SAME live-typing flow that already exists (autocomplete.ts's verse-suggest
// trigger, NoteEditorPM.tsx's insertVerseBlock) by (a) turning on the noteScriptureBlock
// setting if it's off — that flow is gated behind it, and a user reaching for "/verse"
// explicitly wants it — and (b) leaving the cursor on a fresh empty line ready to type a
// reference, since that's what actually drives detection+fetch, not this command itself.
function startVerseBlock(view: EditorView, from: number, to: number) {
  if (!useAppStore.getState().noteScriptureBlock) useAppStore.getState().setNoteScriptureBlock(true)
  // Deleting just the "/verse" trigger text and stopping there left an empty line with no
  // visible feedback that anything happened. Replace it with selected placeholder text
  // instead, so typing over it is obvious — the existing verse-suggest autocomplete
  // (NoteEditorPM.tsx's insertVerseBlock) takes over once what's typed matches a real ref.
  const placeholder = 'Book chapter:verse'
  const tr = view.state.tr.insertText(placeholder, from, to)
  tr.setSelection(TextSelection.create(tr.doc, from, from + placeholder.length))
  view.dispatch(tr)
  view.focus()
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'text', label: 'Text', description: 'Plain paragraph', keywords: ['paragraph', 'plain'], group: 'Basic blocks', run: toParagraph },
  { id: 'verse', label: 'Scripture verse', description: 'Type a reference (e.g. Romans 14:3) to auto-fetch and box it', keywords: ['verse', 'scripture', 'bible', 'quote', 'kjv', 'lxx'], group: 'Basic blocks', run: startVerseBlock },
  { id: 'h1', label: 'Heading 1', description: 'Large section heading', keywords: ['h1', 'title'], group: 'Basic blocks', run: toHeading(1) },
  { id: 'h2', label: 'Heading 2', description: 'Medium section heading', keywords: ['h2', 'subtitle'], group: 'Basic blocks', run: toHeading(2) },
  { id: 'h3', label: 'Heading 3', description: 'Small section heading', keywords: ['h3'], group: 'Basic blocks', run: toHeading(3) },
  { id: 'bullet', label: 'Bulleted list', description: 'Simple bullet list', keywords: ['ul', 'unordered', 'bullet', 'dash'], group: 'Basic blocks', run: toBulletList('*') },
  { id: 'numbered', label: 'Numbered list', description: 'List with numbers', keywords: ['ol', 'ordered', 'numbered'], group: 'Basic blocks', run: toOrderedList },
  { id: 'task', label: 'Task list', description: 'Checkboxes to track to-dos', keywords: ['todo', 'checkbox', 'checklist', 'task'], group: 'Basic blocks', run: toTaskList },
  { id: 'quote', label: 'Quote', description: 'Blockquote for citations', keywords: ['blockquote', 'citation'], group: 'Basic blocks', run: toBlockquote },
  { id: 'code', label: 'Code block', description: 'Monospaced code with no formatting', keywords: ['fence', 'pre', 'monospace'], group: 'Basic blocks', run: toCodeBlock },
  { id: 'table', label: 'Table', description: '2×2 table to start from', keywords: ['grid', 'spreadsheet'], group: 'Basic blocks', run: insertTable },
  { id: 'columns', label: 'Columns', description: '2-column side-by-side layout', keywords: ['column', 'layout', 'side-by-side', 'split'], group: 'Basic blocks', run: insertColumns },
  { id: 'divider', label: 'Divider', description: 'Horizontal rule', keywords: ['hr', 'rule', 'separator', 'line'], group: 'Basic blocks', run: insertHorizontalRule },
  { id: 'callout-note', label: 'Note', description: 'Blue callout for general notes', keywords: ['callout', 'info', 'blue'], group: 'Callouts', run: toCallout('NOTE') },
  { id: 'callout-tip', label: 'Tip', description: 'Green callout for helpful tips', keywords: ['callout', 'green', 'hint'], group: 'Callouts', run: toCallout('TIP') },
  { id: 'callout-warning', label: 'Warning', description: 'Amber callout for warnings', keywords: ['callout', 'amber', 'caution-lite'], group: 'Callouts', run: toCallout('WARNING') },
  { id: 'callout-important', label: 'Important', description: 'Purple callout to call out key points', keywords: ['callout', 'purple', 'key'], group: 'Callouts', run: toCallout('IMPORTANT') },
  { id: 'callout-caution', label: 'Caution', description: 'Red callout for critical warnings', keywords: ['callout', 'red', 'danger'], group: 'Callouts', run: toCallout('CAUTION') },
]

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q))
  )
}
