import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { bereanSchema as schema } from './schema'
import { parseDeepLink, isDeepLink } from '@/lib/deepLinks'
import { normalizeWikiTarget } from '@/lib/noteUtils'
import type { Note } from '@/types'

/**
 * The ONE link model behind every link the notes editor creates or edits — the toolbar's Link
 * button, the selection bubble, and a block's "Link…" action all open the same editor
 * (LinkEditor.tsx), which reads and writes links only through this file.
 *
 * Two representations already existed and both are kept exactly as they are:
 *  - a `link` mark — `[text](href)` — for web / mailto / berean:// links;
 *  - a `wikilink` mark — `[[Title]]` — Obsidian-style, matched to a note BY TITLE (the vault's own
 *    format, typed with the `[[` autocomplete). A wikilink may now carry display text:
 *    `[[Title|text]]` (Obsidian's alias form) — parsed and written by markdownIt.ts/serializer.ts.
 *
 * A NOTE link made here is a `link` mark to `berean://note/<id>` — the app's existing deep link,
 * resolved by the note's stable id, so renaming the note or another note sharing its title can't
 * re-point it. Editing an existing wikilink keeps it a wikilink unless the destination changes.
 */

export type LinkDestination =
  | { kind: 'note'; noteId: string }
  | { kind: 'url'; href: string }
  /** An existing [[wikilink]] (title-addressed) — only ever read from the document. */
  | { kind: 'wikilink'; title: string }

/** What a link editor session edits: a text range (selection / existing link / caret) or one block. */
export type LinkTarget =
  | { kind: 'text'; from: number; to: number }
  | { kind: 'block'; pos: number }

export interface ExistingLink {
  from: number
  to: number
  text: string
  destination: LinkDestination
}

export function noteLinkHref(noteId: string): string {
  return `berean://note/${encodeURIComponent(noteId)}`
}

/** The note a `berean://note/<id>` (or berean-dev://) href points at, else null. */
export function noteIdFromHref(href: string): string | null {
  const route = isDeepLink(href) ? parseDeepLink(href) : null
  return route?.kind === 'note' ? route.noteId : null
}

function destinationOfMark(mark: Mark): LinkDestination | null {
  if (mark.type === schema.marks.wikilink) return { kind: 'wikilink', title: String(mark.attrs.title ?? '') }
  if (mark.type === schema.marks.link) {
    const href = String(mark.attrs.href ?? '')
    const noteId = noteIdFromHref(href)
    return noteId ? { kind: 'note', noteId } : { kind: 'url', href }
  }
  return null
}

function linkMarkIn(marks: readonly Mark[]): Mark | null {
  return marks.find((m) => m.type === schema.marks.link || m.type === schema.marks.wikilink) ?? null
}

/** The full extent of `mark` around position `pos` inside its textblock. */
function markExtent(doc: PMNode, pos: number, mark: Mark): { from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const start = $pos.start()
  // Walk the textblock's children, collecting the contiguous run of children carrying `mark`
  // that contains `pos`.
  let runFrom = -1
  let offset = start
  let result: { from: number; to: number } | null = null
  parent.forEach((child) => {
    const childFrom = offset
    const childTo = offset + child.nodeSize
    if (mark.isInSet(child.marks)) {
      if (runFrom < 0) runFrom = childFrom
      if (pos >= runFrom && pos <= childTo) result = { from: runFrom, to: childTo }
    } else {
      runFrom = -1
    }
    offset = childTo
  })
  return result
}

/**
 * The link (link or wikilink mark) at the caret / covering the selection, expanded to its full
 * extent — so editing a link from a caret inside it, or a partial selection of it, edits the
 * whole link rather than splitting it.
 */
export function readLinkAt(state: { doc: PMNode }, from: number, to: number): ExistingLink | null {
  const doc = state.doc
  let mark: Mark | null = null
  let at = from
  if (from === to) {
    const $pos = doc.resolve(from)
    mark = linkMarkIn($pos.marks()) ?? (($pos.nodeBefore && linkMarkIn($pos.nodeBefore.marks)) || null)
  } else {
    doc.nodesBetween(from, to, (node, pos) => {
      if (mark || !node.isText) return
      const m = linkMarkIn(node.marks)
      if (m) { mark = m; at = Math.max(from, pos) + 0 }
    })
  }
  if (!mark) return null
  // `at` must sit INSIDE the run for markExtent — nudge off a boundary.
  const ext = markExtent(doc, at, mark) ?? markExtent(doc, Math.max(0, at - 1), mark)
  if (!ext) return null
  const destination = destinationOfMark(mark)
  if (!destination) return null
  return { from: ext.from, to: ext.to, text: doc.textBetween(ext.from, ext.to, ' ', ' '), destination }
}

/** The editable text range a block link covers: the block's own text (a list item: its first
 *  paragraph). Null for blocks with no text of their own (a table, a rule, a whole list). */
export function blockTextRange(doc: PMNode, pos: number): { from: number; to: number } | null {
  const node = doc.nodeAt(pos)
  if (!node) return null
  if (node.isTextblock && node.type.spec.code !== true) return { from: pos + 1, to: pos + node.nodeSize - 1 }
  if (node.type === schema.nodes.list_item) {
    const first = node.firstChild
    if (first && first.isTextblock) return { from: pos + 2, to: pos + 2 + first.content.size }
  }
  return null
}

/** Does the range contain a link (either kind) that does NOT cover all of it? Links can't nest, so
 *  linking the whole block would replace those — the block menu won't offer it then. */
export function hasInnerLinks(doc: PMNode, range: { from: number; to: number }): boolean {
  let found = false
  doc.nodesBetween(range.from, range.to, (node) => {
    if (found || !node.isText) return
    if (linkMarkIn(node.marks)) found = true
  })
  if (!found) return false
  const cover = readLinkAt({ doc }, range.from, range.to)
  return !(cover && cover.from <= range.from && cover.to >= range.to)
}

/** Whether a block-level node can be linked (has text of its own the link can cover). */
export function canLinkBlock(doc: PMNode, pos: number): boolean {
  const r = blockTextRange(doc, pos)
  return !!r && r.to > r.from
}

export type UrlCheck = { ok: true; href: string } | { ok: false; reason: string; suggestion?: string }

/**
 * Web-link validation — the same schemes the editor's Link field has always accepted
 * (http/https, mailto:, Berean's own berean:// links), never silently rewritten. A bare domain is
 * rejected with a one-click suggestion instead of having https:// quietly prepended.
 */
export function checkUrl(raw: string): UrlCheck {
  const href = raw.trim()
  if (!href) return { ok: false, reason: 'Enter a web address.' }
  if (isDeepLink(href)) return { ok: true, href }
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return { ok: true, href }
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href)
      if (u.hostname) return { ok: true, href }
    } catch { /* fall through */ }
    return { ok: false, reason: 'That address isn’t valid.' }
  }
  if (/^[^\s/:]+\.[a-z]{2,}(\/\S*)?$/i.test(href)) return { ok: false, reason: 'Web addresses start with https://', suggestion: `https://${href}` }
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(href)) return { ok: false, reason: 'Email links start with mailto:', suggestion: `mailto:${href}` }
  return { ok: false, reason: 'Use a web address (https://…), mailto: or a Berean link.' }
}

/** Does this wikilink title resolve to `note`? (The same matching the click handler uses.) */
export function wikilinkMatchesNote(title: string, note: Note): boolean {
  return normalizeWikiTarget(title) === normalizeWikiTarget(note.title || 'Untitled')
}

function newMarkFor(dest: LinkDestination): Mark {
  if (dest.kind === 'wikilink') return schema.marks.wikilink.create({ title: dest.title })
  if (dest.kind === 'note') return schema.marks.link.create({ href: noteLinkHref(dest.noteId) })
  return schema.marks.link.create({ href: dest.href })
}

/**
 * Applies a link edit as ONE transaction (one undo step). `range` is the text the link covers;
 * when `text` differs from what's there (or the range is empty — a caret), the range's text is
 * replaced by `text`, keeping the formatting marks at its start. Otherwise only the link changes
 * and every other mark on the text is preserved.
 */
export function applyLinkEdit(
  state: EditorState,
  range: { from: number; to: number },
  text: string,
  dest: LinkDestination,
): Transaction | null {
  const { from, to } = range
  const current = state.doc.textBetween(from, to, ' ', ' ')
  const mark = newMarkFor(dest)
  const tr = state.tr
  let end = to
  if (text !== current || from === to) {
    if (!text) return null
    const base = (from === to ? state.doc.resolve(from).marks() : state.doc.resolve(from + 1 > to ? from : from + 1).marks())
      .filter((m) => m.type !== schema.marks.link && m.type !== schema.marks.wikilink)
    tr.replaceWith(from, to, schema.text(text, [...base, mark]))
    end = from + text.length
  } else {
    tr.removeMark(from, to, schema.marks.link)
    tr.removeMark(from, to, schema.marks.wikilink)
    tr.addMark(from, to, mark)
  }
  tr.setSelection(TextSelection.create(tr.doc, end))
  return tr
}

/** Removes the link (either kind) from a range, keeping its text and other formatting. */
export function removeLinkIn(state: EditorState, range: { from: number; to: number }): Transaction {
  const tr = state.tr
  tr.removeMark(range.from, range.to, schema.marks.link)
  tr.removeMark(range.from, range.to, schema.marks.wikilink)
  return tr
}

/** Note search for the link editor — the [[ autocomplete's matching (title contains the query),
 *  best matches first: exact title, then prefix, then most recently edited. */
export function searchNotesForLink(notes: Note[], query: string, limit = 50, excludeId?: string): Note[] {
  const q = query.trim().toLowerCase()
  const scored: Array<{ n: Note; s: number }> = []
  for (const n of notes) {
    if (n.id === excludeId) continue
    const title = (n.title || 'Untitled').toLowerCase()
    if (q && !title.includes(q)) continue
    const s = !q ? 0 : title === q ? 3 : title.startsWith(q) ? 2 : 1
    scored.push({ n, s })
  }
  const ts = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v ?? '')) || 0)
  scored.sort((a, b) => b.s - a.s || ts(b.n.updatedAt) - ts(a.n.updatedAt))
  return scored.slice(0, limit).map((x) => x.n)
}

// ── The text a link editor session is about stays visibly marked ───────────────────────────────
// Focusing the editor's fields takes the browser selection away from the note, so the selected
// words would lose their highlight exactly while you decide what to link them to. This plugin
// paints the target range (mapped through any edits) until the session ends.
export const linkTargetKey = new PluginKey<{ from: number; to: number } | null>('berean-link-target')

export function createLinkTargetPlugin() {
  return new Plugin<{ from: number; to: number } | null>({
    key: linkTargetKey,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(linkTargetKey)
        if (meta !== undefined) return meta as { from: number; to: number } | null
        if (!prev) return null
        return { from: tr.mapping.map(prev.from, 1), to: tr.mapping.map(prev.to, -1) }
      },
    },
    props: {
      decorations(state) {
        const r = linkTargetKey.getState(state)
        if (!r || r.to <= r.from) return null
        return DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: 'pm-link-target' })])
      },
    },
  })
}
