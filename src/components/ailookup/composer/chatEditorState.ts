/**
 * Berean Chat composer — the editor model behind ChatEditor.tsx. A small ProseMirror editor on the
 * notes editor's own schema (`bereanSchema`) whose value in and out is MARKDOWN, the canonical
 * message format (messages, search, AI history and iCloud all read `content` as markdown text):
 *
 *  - markdown → doc: the notes parser (`parseMarkdown`), unchanged.
 *  - doc → markdown: the notes serializer's own node/mark handlers, with two chat-specific
 *    differences: a hard break is written as a bare newline (markdown-it runs with
 *    `breaks: true`, so it parses straight back to a hard break — the notes default `\` + newline
 *    would show up as a stray backslash in previews and search), and a doc with no formatting at
 *    all is sent as its literal text whenever that text parses back to the same doc (so
 *    "2 * 3 * 4" or "snake_case" are never sent as "2 \* 3 \* 4").
 *  - input rules are stricter than the notes editor's (no conversion for `2 * 3 * 4`, snake_case,
 *    `__init__`, URLs or partial syntax) and a few line-start rules also fire after a Shift+Return
 *    line break, so "Notes:⇧↩- item" becomes a list.
 *  - keymap: Return sends (except in a code block), Shift+Return is a new line / list item,
 *    ⌘Return asks Berean, Esc runs the composer's escape chain; formatting shortcuts never send.
 */
import { EditorState, Plugin, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { Fragment, Slice, type MarkType, type Node as PMNode, type NodeType, type Attrs, type Mark } from 'prosemirror-model'
import { InputRule, inputRules, undoInputRule, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, chainCommands, toggleMark, setBlockType, wrapIn, lift, splitBlock } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { wrapInList, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { findWrapping } from 'prosemirror-transform'
import { MarkdownSerializer } from 'prosemirror-markdown'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '@/components/notes/pm/schema'
import { parseMarkdown } from '@/components/notes/pm/parser'
import { bereanMarkdownSerializer } from '@/components/notes/pm/serializer'
import { checkUrl } from '@/components/notes/pm/linkModel'

export { schema as chatSchema }
const { nodes, marks } = schema

// ─── Markdown in / out ──────────────────────────────────────────────────────

const chatSerializer = new MarkdownSerializer(
  {
    ...bereanMarkdownSerializer.nodes,
    // A bare newline (see the header). Trailing breaks are dropped, as in the default handler.
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) { state.write('\n'); return }
      }
    },
  },
  bereanMarkdownSerializer.marks,
)

const emptyDoc = () => nodes.doc.create(null, nodes.paragraph.create())

/** Markdown (a message's `content`, a draft) → editor doc. */
export function markdownToDoc(md: string): PMNode {
  if (!md || !md.trim()) return emptyDoc()
  try {
    const doc = parseMarkdown(md)
    return doc.childCount ? doc : emptyDoc()
  } catch {
    return nodes.doc.create(null, nodes.paragraph.create(null, schema.text(md)))
  }
}

const isEmptyPara = (n: PMNode) => n.type === nodes.paragraph && n.content.size === 0

/** Plain paragraphs of unformatted text (hard breaks allowed) → their literal text, else null. */
function plainText(doc: PMNode): string | null {
  const paras: string[] = []
  let ok = true
  doc.forEach((block) => {
    if (!ok) return
    if (block.type !== nodes.paragraph || block.attrs.indent) { ok = false; return }
    let s = ''
    block.forEach((inline) => {
      if (inline.isText && inline.marks.length === 0) s += inline.text
      else if (inline.type === nodes.hard_break) s += '\n'
      else ok = false
    })
    paras.push(s)
  })
  return ok ? paras.join('\n\n') : null
}

/** Editor doc → the message's markdown (trimmed; '' for an empty doc). */
export function docToMarkdown(doc: PMNode): string {
  // Blank paragraphs carry nothing in a chat message (the notes serializer would write them as
  // zero-width-space "extra blank line" markers).
  const kept: PMNode[] = []
  doc.forEach((n) => { if (!isEmptyPara(n)) kept.push(n) })
  if (!kept.length) return ''
  const clean = nodes.doc.create(null, kept)
  const plain = plainText(clean)
  if (plain != null) {
    const trimmed = plain.replace(/\s+$/, '')
    try { if (parseMarkdown(trimmed).eq(clean)) return trimmed } catch { /* fall through */ }
  }
  return chatSerializer.serialize(clean, { tightLists: true }).replace(/\s+$/, '').replace(/^\n+/, '')
}

export const isDocEmpty = (doc: PMNode) => doc.childCount === 1 && isEmptyPara(doc.firstChild!)

// ─── Input rules ────────────────────────────────────────────────────────────

/** A delimiter may open only at a line start, after whitespace or after opening punctuation —
 *  never inside a word (snake_case, 2*3, a/b_c URLs). */
const OPEN = String.raw`(?<=^|[\s([{"'“‘￼])`

/** Double delimiters (**, ~~, ==) may also open inside a word — "gre**ger**" bolds "ger", as
 *  CommonMark does — just not right after another delimiter character or a backslash escape. */
const OPEN_INTRAWORD = (c: string) => String.raw`(?<=^|[^${c}\\])`

function markRule(delim: string, mark: MarkType, attrs?: Attrs) {
  const d = delim.replace(/[*~`=_]/g, '\\$&')
  const c = delim[0].replace(/[*~`=_]/g, '\\$&')
  const open = delim.length > 1 ? OPEN_INTRAWORD(c) : OPEN
  // Inner text: no leading/trailing whitespace, no delimiter character, no line break.
  const re = new RegExp(`${open}${d}([^\\s${c}](?:[^${c}\\n\\uFFFC]*[^\\s${c}])?)${d}$`)
  return new InputRule(re, (state, match, start, end) => {
    // A run of more delimiters right before ("***x**") is ambiguous — leave it literal.
    if (start > 0 && state.doc.textBetween(Math.max(0, start - 1), start) === delim[0]) return null
    const inner = match[1]
    const tr = state.tr
    // `end` is the position BEFORE the final typed character (it is not in the doc yet).
    tr.delete(end - (delim.length - 1), end)
    tr.delete(start, start + delim.length)
    const from = start
    const to = start + inner.length
    tr.addMark(from, to, mark.create(attrs ?? undefined))
    tr.removeStoredMark(mark)
    return tr
  }, { inCodeMark: false })
}

const boldRule = markRule('**', marks.strong)
const italicStarRule = markRule('*', marks.em)
const italicUnderscoreRule = markRule('_', marks.em)
const strikeRule = markRule('~~', marks.strike)
const codeRule = markRule('`', marks.code)
const highlightRule = markRule('==', marks.highlight, { color: null })

/**
 * A line-start rule that also fires after a Shift+Return hard break (U+FFFC is how a hard break
 * reads in the rule's text window): the line is split off into its own block first.
 */
function lineStartRule(pattern: string, apply: (tr: Transaction, blockStart: number, match: RegExpMatchArray) => boolean) {
  return new InputRule(new RegExp(`\\uFFFC${pattern}$`), (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    if ($start.parent.type !== nodes.paragraph) return null
    const tr = state.tr.delete(start, end) // the hard break + the typed marker
    tr.split(start)
    const blockStart = start + 2 // inside the new (second) paragraph
    return apply(tr, blockStart, match) ? tr : null
  })
}
function wrapAt(type: NodeType, attrs?: Attrs) {
  return (tr: Transaction, pos: number) => {
    const range = tr.doc.resolve(pos).blockRange()
    const wrapping = range && findWrapping(range, type, attrs)
    if (!range || !wrapping) return false
    tr.wrap(range, wrapping)
    return true
  }
}
function typeAt(type: NodeType, attrs?: Attrs) {
  return (tr: Transaction, pos: number) => {
    tr.setBlockType(pos, pos, type, attrs)
    return true
  }
}

const headingRule = textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (m) => ({ level: m[1].length }))
const codeFenceRule = textblockTypeInputRule(/^```$/, nodes.code_block)
const blockquoteRule = wrappingInputRule(/^>\s$/, nodes.blockquote)
const bulletListRule = wrappingInputRule(/^([-+*])\s$/, nodes.bullet_list, (m) => ({ marker: m[1], tight: true }))
const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/, nodes.ordered_list, (m) => ({ order: +m[1], tight: true }),
  (m, node) => node.childCount + node.attrs.order === +m[1],
)
const afterBreakRules = [
  lineStartRule('>\\s', wrapAt(nodes.blockquote)),
  lineStartRule('([-+*])\\s', (tr, pos, m) => wrapAt(nodes.bullet_list, { marker: m[1], tight: true })(tr, pos)),
  lineStartRule('(\\d+)\\.\\s', (tr, pos, m) => wrapAt(nodes.ordered_list, { order: +m[1], tight: true })(tr, pos)),
  lineStartRule('(#{1,3})\\s', (tr, pos, m) => typeAt(nodes.heading, { level: m[1].length })(tr, pos)),
  lineStartRule('```', typeAt(nodes.code_block)),
]

export const chatInputRules = inputRules({
  rules: [
    headingRule, codeFenceRule, blockquoteRule, bulletListRule, orderedListRule, ...afterBreakRules,
    boldRule, italicStarRule, italicUnderscoreRule, strikeRule, codeRule, highlightRule,
  ],
})

// ─── Commands ───────────────────────────────────────────────────────────────

const inNode = (state: EditorState, type: NodeType): number | null => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return d
  return null
}
const inCodeBlock = (state: EditorState) => state.selection.$from.parent.type === nodes.code_block

const insertHardBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView())
  return true
}
const codeNewline: Command = (state, dispatch) => {
  if (!inCodeBlock(state)) return false
  if (dispatch) dispatch(state.tr.insertText('\n').scrollIntoView())
  return true
}
/** Return on an empty last line of a code block leaves it (the trailing newline is dropped). */
const exitCodeOnEmptyLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type !== nodes.code_block) return false
  const text = $from.parent.textContent
  if ($from.parentOffset !== text.length || !text.endsWith('\n')) return false
  if (dispatch) {
    const after = $from.after()
    const tr = state.tr.delete($from.pos - 1, $from.pos)
    const at = tr.mapping.map(after)
    tr.insert(at, nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView()
    dispatch(tr)
  }
  return true
}
const liftEmptyListItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.content.size || inNode(state, nodes.list_item) == null) return false
  return liftListItem(nodes.list_item)(state, dispatch)
}
/** In a quote: a new paragraph, or out of the quote from an empty one. */
const quoteNewline: Command = (state, dispatch) => {
  if (inNode(state, nodes.blockquote) == null || inNode(state, nodes.list_item) != null) return false
  const { $from } = state.selection
  if ($from.parent.type === nodes.paragraph && $from.parent.content.size === 0) return lift(state, dispatch)
  return splitBlock(state, dispatch)
}
const headingNewline: Command = (state, dispatch) =>
  state.selection.$from.parent.type === nodes.heading ? splitBlock(state, dispatch) : false

/** Shift+Return (and iPhone Return): a new line that keeps the block's structure. */
export const newlineCommand: Command = chainCommands(
  exitCodeOnEmptyLine, codeNewline, splitListItem(nodes.list_item), liftEmptyListItem, quoteNewline, headingNewline, insertHardBreak,
)

/** Hard breaks ⇄ newlines when switching a paragraph to / from a code block (each textblock in
 *  the selection is rebuilt, so no line is lost to the transform's whitespace clean-up). */
function setCodeBlock(on: boolean): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const blocks: Array<{ pos: number; node: PMNode }> = []
    state.doc.nodesBetween($from.start(), $to.end(), (n, pos) => {
      if (!n.isTextblock) return true
      if (on ? n.type !== nodes.code_block : n.type === nodes.code_block) blocks.push({ pos, node: n })
      return false
    })
    if (!blocks.length) return false
    if (!dispatch) return true
    const tr = state.tr
    for (const { pos, node } of blocks.reverse()) {
      let next: PMNode
      if (on) {
        let text = ''
        node.forEach((c) => { text += c.isText ? c.text : c.type === nodes.hard_break ? '\n' : '' })
        next = nodes.code_block.create(null, text ? schema.text(text) : null)
      } else {
        const parts: PMNode[] = []
        node.textContent.split('\n').forEach((line, i) => {
          if (i > 0) parts.push(nodes.hard_break.create())
          if (line) parts.push(schema.text(line))
        })
        next = nodes.paragraph.create(null, parts)
      }
      tr.replaceWith(pos, pos + node.nodeSize, next)
    }
    const sel = TextSelection.between(tr.doc.resolve(tr.mapping.map(state.selection.from, -1)), tr.doc.resolve(tr.mapping.map(state.selection.to, 1)))
    dispatch(tr.setSelection(sel).scrollIntoView())
    return true
  }
}

export type BlockFormat = 'bullet_list' | 'ordered_list' | 'blockquote' | 'heading' | 'code_block'
export type MarkFormat = 'strong' | 'em' | 'underline' | 'strike' | 'code' | 'link'

export function toggleBlock(kind: BlockFormat): Command {
  return (state, dispatch, view) => {
    if (kind === 'code_block') return setCodeBlock(!inCodeBlock(state))(state, dispatch)
    // Lists and quotes hold paragraphs: leave a code block / heading first, then apply (two
    // transactions, one undo step — history groups them).
    const leave = inCodeBlock(state) ? setCodeBlock(false)
      : kind !== 'heading' && state.selection.$from.parent.type === nodes.heading ? setBlockType(nodes.paragraph) : null
    if (leave) {
      if (!dispatch || !view) return leave(state)
      leave(state, dispatch)
      return toggleBlock(kind)(view.state, dispatch, view)
    }
    if (kind === 'heading') {
      return state.selection.$from.parent.type === nodes.heading
        ? setBlockType(nodes.paragraph)(state, dispatch)
        : setBlockType(nodes.heading, { level: 2 })(state, dispatch)
    }
    if (kind === 'blockquote') {
      return inNode(state, nodes.blockquote) != null ? lift(state, dispatch) : wrapIn(nodes.blockquote)(state, dispatch)
    }
    const type = nodes[kind]
    const { $from } = state.selection
    for (let d = $from.depth; d > 0; d--) {
      const t = $from.node(d).type
      if (t !== nodes.bullet_list && t !== nodes.ordered_list) continue
      if (t === type) return liftListItem(nodes.list_item)(state, dispatch)
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(d), type, { tight: true }))
      return true
    }
    return wrapInList(type, { tight: true })(state, dispatch)
  }
}

export function toggleFormatMark(kind: Exclude<MarkFormat, 'link'>): Command {
  return (state, dispatch) => {
    if (inCodeBlock(state)) return false
    return toggleMark(marks[kind])(state, dispatch)
  }
}

/** Link the selection (or insert the address itself) — `href` already validated. */
export function setLink(href: string | null): Command {
  return (state, dispatch) => {
    if (inCodeBlock(state)) return false
    const range = linkRangeAt(state)
    if (!dispatch) return true
    const tr = state.tr
    if (range) tr.removeMark(range.from, range.to, marks.link)
    if (href) {
      const { from, to, empty } = state.selection
      if (range) tr.addMark(range.from, range.to, marks.link.create({ href }))
      else if (!empty) tr.addMark(from, to, marks.link.create({ href }))
      else {
        tr.insert(from, schema.text(href, [marks.link.create({ href })]))
        tr.setSelection(TextSelection.create(tr.doc, from + href.length))
      }
    }
    tr.removeStoredMark(marks.link)
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** The whole link around the cursor / selection start, if any. */
export function linkRangeAt(state: EditorState): { from: number; to: number; href: string } | null {
  const { $from } = state.selection
  const parent = $from.parent
  const offset = $from.parentOffset
  const start = $from.start()
  let segFrom = -1
  let segMark: Mark | null = null
  let pos = 0
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    const end = pos + child.nodeSize
    const mark = child.marks.find((m) => m.type === marks.link) ?? null
    if (mark && segMark && mark.eq(segMark)) { /* the link continues */ }
    else if (mark) { segFrom = pos; segMark = mark }
    else { segFrom = -1; segMark = null }
    const next = i + 1 < parent.childCount ? parent.child(i + 1).marks.find((m) => m.type === marks.link) : undefined
    const segEnds = !segMark || !next || !next.eq(segMark)
    if (segMark && segEnds && segFrom <= offset && offset <= end && (offset > segFrom || offset < end)) {
      return { from: start + segFrom, to: start + end, href: String(segMark.attrs.href ?? '') }
    }
    pos = end
  }
  return null
}

/** Validate a typed / selected address. A bare domain gets https:// (prompt-free chat). */
export function normalizeHref(raw: string): string | null {
  const check = checkUrl(raw)
  if (check.ok) return check.href
  if (check.suggestion) {
    const again = checkUrl(check.suggestion)
    return again.ok ? again.href : null
  }
  return null
}

/** ⌘K: a selected address becomes a link at once; otherwise the caller opens the link field. */
export function linkSelectionIfUrl(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { from, to, empty } = state.selection
  if (empty) return false
  const text = state.doc.textBetween(from, to).trim()
  if (!/^(https?:\/\/|mailto:)\S+$/i.test(text)) return false
  const href = normalizeHref(text)
  if (!href) return false
  return setLink(href)(state, dispatch)
}

// ─── Active formats (toolbar state) ─────────────────────────────────────────

export interface ActiveFormats {
  strong: boolean; em: boolean; underline: boolean; strike: boolean; code: boolean; link: boolean
  bullet_list: boolean; ordered_list: boolean; blockquote: boolean; heading: boolean; code_block: boolean
}

export const NO_FORMATS: ActiveFormats = {
  strong: false, em: false, underline: false, strike: false, code: false, link: false,
  bullet_list: false, ordered_list: false, blockquote: false, heading: false, code_block: false,
}
export const sameFormats = (a: ActiveFormats, b: ActiveFormats) =>
  (Object.keys(b) as Array<keyof ActiveFormats>).every((k) => a[k] === b[k])

export function activeFormats(state: EditorState): ActiveFormats {
  const { from, to, empty, $from } = state.selection
  const has = (type: MarkType) => empty
    ? !!type.isInSet(state.storedMarks ?? $from.marks())
    : state.doc.rangeHasMark(from, to, type)
  let list: string | null = null
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type
    if (t === nodes.bullet_list || t === nodes.ordered_list) { list = t.name; break }
  }
  return {
    strong: has(marks.strong), em: has(marks.em), underline: has(marks.underline), strike: has(marks.strike),
    code: has(marks.code), link: has(marks.link) || !!linkRangeAt(state),
    bullet_list: list === 'bullet_list', ordered_list: list === 'ordered_list',
    blockquote: inNode(state, nodes.blockquote) != null,
    heading: $from.parent.type === nodes.heading,
    code_block: $from.parent.type === nodes.code_block,
  }
}

// ─── Paste ──────────────────────────────────────────────────────────────────

/** Plain text that reads as markdown structure / formatting (not just a stray `*`). */
export function looksLikeMarkdown(text: string): boolean {
  return /^(?:\s{0,3}(?:#{1,6}\s|[-*+]\s+\S|\d+[.)]\s+\S|>\s?\S|```|~~~)|\|.+\|\s*$)/m.test(text)
    || /(?:^|[\s(])(?:\*\*[^*\s][^*\n]*\*\*|~~[^~\s][^~\n]*~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/.test(text)
}

/** Plain text → paragraphs (blank-line separated) with hard breaks for single newlines. */
export function plainTextSlice(text: string): Slice {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => {
    const parts: PMNode[] = []
    p.split('\n').forEach((line, i) => {
      if (i > 0) parts.push(nodes.hard_break.create())
      if (line) parts.push(schema.text(line))
    })
    return nodes.paragraph.create(null, parts)
  })
  return new Slice(Fragment.fromArray(paras), 1, 1)
}

const ALLOWED_BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'code_block', 'bullet_list', 'ordered_list', 'list_item', 'horizontal_rule', 'table', 'table_row', 'table_header', 'table_cell'])
const ALLOWED_MARKS = new Set(['em', 'strong', 'code', 'strike', 'underline', 'link', 'highlight'])

/** Keep only what a chat message can hold: unsupported blocks (callouts, columns, threads,
 *  embeds) become their paragraphs; images are dropped; note-only marks (wikilinks) become text. */
export function sanitizeFragment(fragment: Fragment): Fragment {
  const out: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      out.push(node.mark(node.marks.filter((m) => ALLOWED_MARKS.has(m.type.name))))
    } else if (node.type === nodes.hard_break) {
      out.push(node)
    } else if (node.isInline) {
      // images and other inline atoms: dropped
    } else if (ALLOWED_BLOCKS.has(node.type.name)) {
      const inner = node.type === nodes.code_block ? node.content : sanitizeFragment(node.content)
      const attrs = node.type === nodes.paragraph ? { ...node.attrs, indent: 0 } : node.attrs
      try { out.push(node.type.createChecked(attrs, inner, node.marks)) } catch {
        const filled = node.type.createAndFill(attrs, inner, node.marks)
        if (filled) out.push(filled)
      }
    } else if (node.isTextblock) {
      out.push(nodes.paragraph.create(null, sanitizeFragment(node.content)))
    } else {
      sanitizeFragment(node.content).forEach((n) => out.push(n))
    }
  })
  return Fragment.fromArray(out)
}

function pasteHandler(view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData
  if (!data) return false
  const text = data.getData('text/plain')
  const html = data.getData('text/html')
  // Files / images only: chat has no attachments — ignore the paste.
  if (!text && !html) {
    if (data.files?.length || Array.from(data.items ?? []).some((it) => it.kind === 'file')) return true
    return false
  }
  const { state } = view
  if (inCodeBlock(state)) {
    if (text) view.dispatch(state.tr.insertText(text.replace(/\r\n?/g, '\n')).scrollIntoView())
    return !!text
  }
  // An address pasted over a selection links it.
  if (text && !state.selection.empty && /^(https?:\/\/|mailto:)\S+$/i.test(text.trim())) {
    const href = normalizeHref(text.trim())
    if (href) return setLink(href)(state, view.dispatch)
  }
  if (html) return false // ProseMirror's clipboard parser, limited to the schema (transformPasted)
  const slice = looksLikeMarkdown(text)
    ? new Slice(sanitizeFragment(markdownToDoc(text).content), 1, 1)
    : plainTextSlice(text)
  view.dispatch(state.tr.replaceSelection(slice).scrollIntoView())
  return true
}

export const chatPastePlugin = new Plugin({
  props: {
    handlePaste: (view, event) => pasteHandler(view, event),
    transformPasted: (slice) => new Slice(sanitizeFragment(slice.content), slice.openStart, slice.openEnd),
    handleDrop: (_view, event) => !!(event as DragEvent).dataTransfer?.files?.length,
  },
})

// ─── Placeholder ────────────────────────────────────────────────────────────

export function placeholderPlugin(get: () => string) {
  return new Plugin({
    props: {
      decorations(state) {
        if (!isDocEmpty(state.doc)) return null
        const only = state.doc.firstChild!
        return DecorationSet.create(state.doc, [Decoration.node(0, only.nodeSize, { class: 'is-empty', 'data-placeholder': get() })])
      },
    },
  })
}

// ─── Keymap ─────────────────────────────────────────────────────────────────

export interface ChatKeyHandlers {
  /** Return / ⌘Return: send (or save an edit). `asAi` = ⌘Return. Returns true when handled. */
  submit: (asAi: boolean) => void
  /** Return sends (desktop) vs. inserts a new line (iPhone, like Messages). */
  returnSends: () => boolean
  /** Esc: the composer's chain (close link field → cancel edit → disarm → collapse). */
  escape: () => boolean
  /** ⌘K without a selected address: open the link field. */
  openLink: () => void
}

/** Liftout at the very start of a list item / quote / heading / code block on Backspace. */
const backspaceAtBlockStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset > 0) return false
  if ($from.parent.type === nodes.heading || $from.parent.type === nodes.code_block) {
    return $from.parent.type === nodes.code_block ? setCodeBlock(false)(state, dispatch) : setBlockType(nodes.paragraph)(state, dispatch)
  }
  if (inNode(state, nodes.list_item) != null && $from.index(-1) === 0) return liftListItem(nodes.list_item)(state, dispatch)
  if (inNode(state, nodes.blockquote) != null && $from.index(-1) === 0) return lift(state, dispatch)
  return false
}

export function chatKeymap(h: ChatKeyHandlers) {
  const submit = (asAi: boolean): Command => (_state, dispatch, view) => {
    if (view?.composing) return false
    if (dispatch) h.submit(asAi)
    return true
  }
  const enter: Command = (state, dispatch, view) => {
    if (view?.composing) return false
    if (inCodeBlock(state)) return chainCommands(exitCodeOnEmptyLine, codeNewline)(state, dispatch, view)
    if (!h.returnSends()) return newlineCommand(state, dispatch, view)
    return submit(false)(state, dispatch, view)
  }
  return keymap({
    Enter: enter,
    'Shift-Enter': newlineCommand,
    'Mod-Enter': submit(true),
    'Mod-b': toggleFormatMark('strong'),
    'Mod-i': toggleFormatMark('em'),
    'Mod-u': toggleFormatMark('underline'),
    'Mod-Shift-x': toggleFormatMark('strike'),
    'Mod-e': toggleFormatMark('code'),
    'Mod-k': (state, dispatch) => {
      if (linkSelectionIfUrl(state, dispatch)) return true
      if (dispatch) h.openLink()
      return true
    },
    'Mod-z': chainCommands(undoInputRule, undo),
    'Mod-Shift-z': redo,
    'Mod-y': redo,
    Backspace: chainCommands(undoInputRule, backspaceAtBlockStart),
    Tab: (state, dispatch) => inNode(state, nodes.list_item) != null ? (sinkListItem(nodes.list_item)(state, dispatch), true) : false,
    'Shift-Tab': (state, dispatch) => inNode(state, nodes.list_item) != null ? (liftListItem(nodes.list_item)(state, dispatch), true) : false,
  })
}

/** IME: a keydown that belongs to a composition is never a shortcut (or a send). */
export const imeGuardPlugin = new Plugin({
  props: {
    handleDOMEvents: {
      keydown: (view, event) => event.isComposing || event.keyCode === 229 || view.composing,
    },
  },
})

/**
 * Esc runs the composer's chain before ProseMirror sees the key (ProseMirror always cancels Esc).
 * A dismissed thing stops the event there; an unused Esc goes on untouched, so the surface still
 * gets it (closing the panel / the window's sidebar overlay).
 */
function escapePlugin(h: ChatKeyHandlers) {
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.key !== 'Escape' || event.isComposing || view.composing) return false
          if (h.escape()) { event.preventDefault(); event.stopPropagation() }
          return true
        },
      },
    },
  })
}

/** ProseMirror's base keys without Esc (selectParentNode) — an Esc the composer doesn't use
 *  belongs to the surface (it closes the panel). */
const chatBaseKeymap = Object.fromEntries(Object.entries(baseKeymap).filter(([k]) => k !== 'Escape'))

export function createChatEditorState(md: string, h: ChatKeyHandlers, placeholder: () => string): EditorState {
  return EditorState.create({
    schema,
    doc: markdownToDoc(md),
    plugins: [
      imeGuardPlugin,
      escapePlugin(h),
      chatInputRules,
      chatKeymap(h),
      keymap(chatBaseKeymap),
      history(),
      chatPastePlugin,
      placeholderPlugin(placeholder),
    ],
  })
}
