import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Trash2, Link2 } from 'lucide-react'
import { BLOCK_TYPE_META, TEXT_TYPE_LEVELS } from '@/lib/blockTypeIcons'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import { bereanSchema as schema } from './schema'
import { blockEnterAnimMeta } from './blockHandles'
import type { BlockMenuTarget } from './blockHandles'

// Block-level menu opened by clicking (not dragging) a block's drag-handle grip
// (blockHandles.ts) — Duplicate / Delete / Turn into / Copy link to block.
//
// Every action here reads `view.state.selection` fresh at click time rather
// than trusting a `[from, to]` captured when the menu opened: blockHandles.ts's
// grip already set the document selection to a NodeSelection over this exact
// block on mousedown, immediately before this menu opens, so re-reading it here
// is both simpler than threading a stashed range through and automatically
// correct even if something else nudged positions in between (nothing normally
// would, since the editor isn't focused for typing while this menu is open, but
// it costs nothing to not assume that).
//
// SOURCES: paragraph/heading (the original set) plus blockquote/callout/
// bullet_list/ordered_list — every container whose content can be sensibly
// re-shaped into another block type. code_block/table/image stay excluded
// entirely, as both source and target: a code block's content is
// meaningful only as literal unformatted text, a table's is a 2-D grid, and
// an image is a leaf atom — none of those have a lossless mapping into
// "some flowing content, differently wrapped," which is what every
// conversion below actually does.
const TURN_INTO_SOURCE_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'callout', 'bullet_list', 'ordered_list'])

// ─── Turn-into content reshaping ────────────────────────────────────────────
// Every target is built by first reducing the SOURCE node down to a flat
// array of its constituent "content blocks" (extractBlocks), then re-wrapping
// that array into whatever the target needs. This one shared reduction step
// is what lets blockquote<->callout<->list<->paragraph/heading all interop
// through the same code path instead of N*N special-cased conversions.
function extractBlocks(node: PMNode): PMNode[] {
  if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
    // A list's real content lives one level down, inside each list_item
    // (schema.ts: `list_item: { content: 'paragraph block*' }`) — flatten
    // every item's own children into one sequence, losing the "these were
    // separate items" grouping (acceptable: the SAME loss any block editor
    // takes converting "list of things" into "one blockquote of things").
    const blocks: PMNode[] = []
    node.forEach((item) => item.forEach((child) => blocks.push(child)))
    return blocks
  }
  if (node.type.name === 'blockquote' || node.type.name === 'callout') {
    const blocks: PMNode[] = []
    node.forEach((child) => blocks.push(child))
    return blocks
  }
  // A bare paragraph/heading source IS its own one-block content.
  return [node]
}

// Coerces an arbitrary block into something valid as a list_item's REQUIRED
// leading child (schema.ts: `list_item: { content: 'paragraph block*' }` —
// the first child must specifically be a paragraph, not just any textblock).
// A paragraph passes through untouched (marks intact); any other textblock
// (a heading, most often) is rebuilt as a paragraph reusing its exact inline
// content (marks intact); anything else falls back to its own plain
// textContent — a real but rare loss (e.g. a nested sub-list flattened to
// text), scoped to exactly the one case ProseMirror's content model leaves
// no lossless option for.
function asParagraph(node: PMNode): PMNode {
  if (node.type.name === 'paragraph') return node
  if (node.isTextblock) return schema.nodes.paragraph.create(null, node.content)
  return schema.nodes.paragraph.create(null, node.textContent ? schema.text(node.textContent) : undefined)
}

// paragraph/heading target: reuses the ORIGINAL inline content (marks
// intact) whenever there's exactly one textblock's worth to carry over —
// the common case (a single-paragraph blockquote/callout, or a single-item
// list). Multiple source blocks collapse into ONE textblock of plain text
// (marks lost across the merge, mirroring BlockMenu's own "Copy link"
// action, which already reads a block's plain textContent) — every
// distinguishable piece of the source content survives, just no longer
// individually formatted, which is the behavior most block editors settle
// on for a genuine "collapse N blocks into 1" conversion.
function buildTextblock(kind: 'paragraph' | 'heading', level: number | undefined, source: PMNode): PMNode {
  const blocks = extractBlocks(source)
  if (blocks.length === 1 && blocks[0].isTextblock) {
    return kind === 'paragraph'
      ? schema.nodes.paragraph.create(null, blocks[0].content)
      : schema.nodes.heading.create({ level }, blocks[0].content)
  }
  const text = blocks.map((b) => b.textContent).filter(Boolean).join(' ')
  const content = text ? schema.text(text) : undefined
  return kind === 'paragraph' ? schema.nodes.paragraph.create(null, content) : schema.nodes.heading.create({ level }, content)
}

// bullet_list/ordered_list target. list<->list (bullet_list source going to
// ordered_list, or vice versa) is special-cased to reuse the EXACT existing
// list_items unchanged — preserves nested content (a sub-list, a multi-
// paragraph item) and task-checkbox state perfectly, since only the
// container node itself (and bullet's `marker` attr, reset to the default
// "-") actually changes. Every other source wraps each extracted block in
// its own fresh list_item via asParagraph.
function buildList(target: 'bullet_list' | 'ordered_list', source: PMNode): PMNode {
  if (source.type.name === 'bullet_list' || source.type.name === 'ordered_list') {
    const items: PMNode[] = []
    source.forEach((item) => items.push(item))
    // `tight` carries over unchanged — it's a pure rendering/serialization spacing flag
    // (schema.ts's bullet_list/ordered_list comment), orthogonal to which list type this is.
    const tight = !!source.attrs.tight
    return target === 'bullet_list'
      ? schema.nodes.bullet_list.create({ marker: '-', tight }, items)
      : schema.nodes.ordered_list.create({ tight }, items)
  }
  const blocks = extractBlocks(source)
  const items = (blocks.length ? blocks : [schema.nodes.paragraph.create()]).map((b) => schema.nodes.list_item.create(null, asParagraph(b)))
  return target === 'bullet_list'
    ? schema.nodes.bullet_list.create({ marker: '-' }, items)
    : schema.nodes.ordered_list.create(null, items)
}

// blockquote/callout target. Unlike buildList, extractBlocks' output is
// already valid content for these (both have `content: 'block+'`, same as
// what extractBlocks returns) — no asParagraph coercion needed, so nested
// content (a list inside a blockquote, a multi-paragraph callout) survives
// a blockquote<->callout round trip exactly.
function buildContainer(target: 'blockquote' | 'callout', source: PMNode): PMNode {
  const blocks = extractBlocks(source)
  const content = blocks.length ? blocks : [schema.nodes.paragraph.create()]
  return target === 'blockquote'
    ? schema.nodes.blockquote.create(null, content)
    : schema.nodes.callout.create({ calloutType: 'NOTE' }, content)
}

// Non-heading "Turn into" targets, pulled from the shared config (src/lib/blockTypeIcons.ts)
// so this menu, both toolbars and the slash menu can't drift apart on which glyph means what.
const BulletListIcon = BLOCK_TYPE_META.bullet.icon
const OrderedListIcon = BLOCK_TYPE_META.numbered.icon
const QuoteIcon = BLOCK_TYPE_META.quote.icon
const CalloutIcon = BLOCK_TYPE_META['callout-note'].icon

const ITEM = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left cursor-pointer text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors'
const HEADER = 'px-3 pt-1.5 pb-1 text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider'
const SEP = <div className="mx-2 my-1 h-px bg-[rgb(var(--color-surface-4))]" />

export default function BlockMenu({
  target, view, noteId, onClose,
}: {
  target: BlockMenuTarget | null
  view: EditorView | null
  noteId?: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!target) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('berean:closeContextMenus', close)
    window.addEventListener('berean:closeMenus', close)
    const t = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('berean:closeContextMenus', close)
      window.removeEventListener('berean:closeMenus', close)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  if (!target || !view) return null
  const sel = view.state.selection
  if (!(sel instanceof NodeSelection)) return null
  const sourceType = sel.node.type.name
  const canTurnInto = TURN_INTO_SOURCE_TYPES.has(sourceType)

  function currentSelection(): NodeSelection | null {
    const s = view!.state.selection
    return s instanceof NodeSelection ? s : null
  }

  function duplicate() {
    const s = currentSelection()
    if (s) {
      const tr = view!.state.tr.insert(s.to, s.node.copy(s.node.content))
      tr.setMeta(blockEnterAnimMeta, s.to)
      view!.dispatch(tr)
      view!.focus()
    }
    onClose()
  }

  function remove() {
    const s = currentSelection()
    if (s) {
      const tr = view!.state.tr
      // A doc needs at least one block (schema.ts's `doc: { content: 'block+' }`)
      // — deleting the ONLY top-level block would leave an invalid document, so
      // replace it with an empty paragraph instead of deleting outright.
      if (view!.state.doc.childCount <= 1) {
        tr.replaceWith(s.from, s.to, schema.nodes.paragraph.create())
        tr.setSelection(TextSelection.near(tr.doc.resolve(s.from + 1)))
      } else {
        tr.delete(s.from, s.to)
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(s.from, tr.doc.content.size))))
      }
      view!.dispatch(tr)
      view!.focus()
    }
    onClose()
  }

  // `build` receives the CURRENT source node (read fresh off the live selection, same as
  // every other action in this file) and returns the whole replacement node — a single
  // replaceWith over the NodeSelection's exact range, one transaction, one undo step.
  function turnInto(build: (source: PMNode) => PMNode) {
    const s = currentSelection()
    if (s) {
      const tr = view!.state.tr.replaceWith(s.from, s.to, build(s.node))
      view!.dispatch(tr)
      view!.focus()
    }
    onClose()
  }

  // Best-effort, non-durable deep link — deliberately NOT a persisted block ID
  // written into the markdown (that would add a new markup concept to a vault
  // format this whole rollout has kept deliberately clean). Just the block's
  // current 0-based top-level index, which Berean can resolve at open time on
  // a best-effort basis; it silently drifts if blocks are reordered/added
  // above it afterward — that's the accepted tradeoff, not a bug.
  function copyLink() {
    const s = currentSelection()
    if (s) {
      let index = 0
      let found = -1
      view!.state.doc.forEach((_n, offset) => {
        if (offset === s.from) found = index
        index++
      })
      const link = noteId ? `berean://note/${noteId}#block-${Math.max(found, 0)}` : `berean://note#block-${Math.max(found, 0)}`
      navigator.clipboard.writeText(link).catch(() => {})
    }
    onClose()
  }

  return createPortal(
    <MenuPositioner
      x={target.rect.right + 6}
      y={target.rect.top}
      className="native-buttons min-w-[190px] rounded-shell context-menu py-1 overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className={ITEM} onClick={duplicate}><Copy size={13} className="flex-shrink-0" /> Duplicate</button>
      <button className={ITEM} onClick={copyLink}><Link2 size={13} className="flex-shrink-0" /> Copy link to block</button>

      {canTurnInto && (
        <>
          {SEP}
          <div className={HEADER}>Turn into</div>
          {/* Paragraph + the FULL H1-H6 range — this menu used to stop at H3 while both
              toolbars offered all six, so three heading levels were unreachable from a
              block's own menu. Icons/labels come from the shared config so all four
              surfaces show the same glyph for the same level. */}
          {TEXT_TYPE_LEVELS.map(({ level, meta }) => {
            const Icon = meta.icon
            return (
              <button
                key={level}
                className={ITEM}
                onClick={() => turnInto((n) => (level === 0
                  ? buildTextblock('paragraph', undefined, n)
                  : buildTextblock('heading', level, n)))}
              >
                <Icon size={13} className="flex-shrink-0" /> {meta.label}
              </button>
            )
          })}
          <button className={ITEM} onClick={() => turnInto((n) => buildList('bullet_list', n))}>
            <BulletListIcon size={13} className="flex-shrink-0" /> Bulleted list
          </button>
          <button className={ITEM} onClick={() => turnInto((n) => buildList('ordered_list', n))}>
            <OrderedListIcon size={13} className="flex-shrink-0" /> Numbered list
          </button>
          <button className={ITEM} onClick={() => turnInto((n) => buildContainer('blockquote', n))}>
            <QuoteIcon size={13} className="flex-shrink-0" /> Quote
          </button>
          {/* buildContainer always produces a NOTE callout (its calloutType attr is
              hardcoded), so this shows the NOTE variant's own icon rather than a generic
              "some kind of callout" glyph — what you pick is exactly what you get. */}
          <button className={ITEM} onClick={() => turnInto((n) => buildContainer('callout', n))}>
            <CalloutIcon size={13} className="flex-shrink-0" /> Callout
          </button>
        </>
      )}

      {SEP}
      <button className={`${ITEM} text-red-400 hover:text-red-300 hover:bg-red-500/10`} onClick={remove}>
        <Trash2 size={13} className="flex-shrink-0" /> Delete
      </button>
    </MenuPositioner>,
    document.body,
  )
}
