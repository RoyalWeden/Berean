import { DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import type { Decoration, DecorationSet } from 'prosemirror-view'
import { bereanSchema as schema } from './schema'
import { parseMarkdown } from './parser'
import { buildBlockDecorations } from './blockDecorations'
import { buildRefDecorationsForDoc } from './refDecorations'
import { CALLOUT_META, BULLET_STYLE_DEFS } from '@/lib/noteTextBlocks'
import { useAppStore } from '@/store'

// ─── Static markdown → HTML renderer ───────────────────────────────────────
// Read-only counterpart to NoteEditorPM.tsx's live EditorView, used by every
// surface that displays note content without letting the user edit it:
// NoteVersionHistory.tsx, ContinuousDailyScroll.tsx, ViewerApp.tsx
// (Presenter), and buildPrintHTML (print/PDF export). Those surfaces used to
// go through NoteEditor.tsx's `renderPreviewContent` — a completely
// separate `marked`-based pipeline with its own hardcoded inline styles that
// never tracked the live PM editor's visual language (bordered verse/
// lexicon blocks, boosted-alpha highlights, the dash/glyph bullet system,
// callout headers, inline verse-ref/Strong's-number styling). This renderer
// instead parses through the SAME schema/parser the live editor uses
// (parser.ts) and reuses the SAME detection logic the live editor's own
// decoration plugins use (blockDecorations.ts's buildBlockDecorations for
// verse/lexicon block rectangles, refDecorations.ts's
// buildRefDecorationsForDoc for inline verse-ref/lxx-ref/Strong's-number
// styling) and the same class names pmEditor.css already styles, so
// wrapping the output in a ".berean-pm-editor .ProseMirror" container makes
// it look identical to the editor with zero separate stylesheet to
// maintain.
//
// This intentionally does NOT reuse nodeViews.ts's calloutNodeView/
// listItemNodeView functions directly — both are written against a live
// EditorView (dispatch/getPos) for the editable case, which doesn't exist
// here. Instead the callout-header and bullet-marker DOM those functions
// build is reproduced directly (same classes/structure, no interactivity —
// task checkboxes render as plain disabled checkboxes, matching a read-only
// context).
//
// Scope note: table cell content (GFM tables) is rendered via a plain
// DOMSerializer pass with no ref-decoration support inside cells — verse-
// refs/Strong's numbers typed inside a table cell won't get their inline
// styling here. Everything else (paragraphs, headings, lists, blockquotes,
// callouts, task items, at any nesting depth) does.

const domSerializer = DOMSerializer.fromSchema(schema)

interface InlineRange { from: number; to: number; className: string; title?: string }

// `Decoration.node(from, to, attrs)`/`Decoration.inline(from, to, attrs)`'s
// third argument is `attrs` (real DOM attributes like `class`, applied
// automatically by a live EditorView's own rendering) — NOT `.spec` (a
// separate, here-unused 4th constructor param for arbitrary metadata).
// `.spec` is the only one exposed by prosemirror-view's public/documented
// API; `attrs` is only reachable via the internal `.type.attrs` field. A
// live EditorView never needs to read this itself (it applies attrs
// automatically), but this static renderer has no EditorView and must pull
// the class out manually.
function decorationClass(d: Decoration): string {
  return ((d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class) ?? ''
}

function decorationAttr(d: Decoration, attr: string): string | undefined {
  return (d as unknown as { type: { attrs?: Record<string, string> } }).type.attrs?.[attr]
}

/** Render a textblock node's inline content (marks intact), wrapping any
 * decoration ranges that fall inside it in extra `<span class="...">`s —
 * the read-only equivalent of a live EditorView combining marks with
 * `Decoration.inline`. Positions in `ranges` are in whole-document
 * coordinates; `contentStart` is this node's content start position. */
function renderInlineWithRanges(node: PMNode, contentStart: number, ranges: InlineRange[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  if (ranges.length === 0) {
    frag.appendChild(domSerializer.serializeFragment(node.content))
    return frag
  }
  const size = node.content.size
  const bounds = new Set<number>([0, size])
  for (const r of ranges) {
    bounds.add(Math.max(0, Math.min(size, r.from - contentStart)))
    bounds.add(Math.max(0, Math.min(size, r.to - contentStart)))
  }
  const points = Array.from(bounds).sort((a, b) => a - b)
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (from >= to) continue
    const slice = node.content.cut(from, to)
    const covering = ranges.filter((r) => Math.max(0, r.from - contentStart) <= from && Math.min(size, r.to - contentStart) >= to)
    const classes = covering.map((r) => r.className)
    const title = covering.find((r) => r.title)?.title
    const inner = domSerializer.serializeFragment(slice)
    if (classes.length) {
      const span = document.createElement('span')
      span.className = Array.from(new Set(classes)).join(' ')
      if (title) span.title = title
      span.appendChild(inner)
      frag.appendChild(span)
    } else {
      frag.appendChild(inner)
    }
  }
  return frag
}

interface Decos { block: DecorationSet; ref: DecorationSet }

/** paragraph/heading — the only two node types with `inline*` content
 * directly. `isTopLevel` gates whether the whole-node verse/lexicon block
 * box class applies (blockDecorations.ts's collectLineRuns only ever
 * considers doc's own top-level paragraph runs — a nested paragraph inside
 * a blockquote/list/callout is never boxed in the live editor either).
 * Inline ref decorations (verse-ref/lxx-ref/Strong's-number) apply
 * regardless of nesting depth, matching refDecorations.ts's `doc.descendants`
 * walk. */
function renderTextblock(node: PMNode, pos: number, decos: Decos, isTopLevel: boolean): HTMLElement {
  const nodeEnd = pos + node.nodeSize
  const contentStart = pos + 1
  const ranges: InlineRange[] = []
  let boxClass = ''

  if (isTopLevel) {
    const found = decos.block.find(pos, nodeEnd)
    const nodeBox = found.find((d) => d.from === pos && d.to === nodeEnd)
    if (nodeBox) boxClass = decorationClass(nodeBox)
    for (const d of found) {
      if (d === nodeBox) continue
      const className = decorationClass(d)
      if (className) ranges.push({ from: d.from, to: d.to, className })
    }
  }

  for (const d of decos.ref.find(contentStart, contentStart + node.content.size)) {
    const className = decorationClass(d)
    if (!className) continue
    // Strong's-number spans get a native `title` tooltip in read-only
    // contexts (live-DOM ones like version history/daily scroll, at least
    // — meaningless in a PDF, but harmless there) since there's no
    // interactive React hover-popup here the way the live editor has one.
    const strongsId = className === 'pm-lexicon-ref' ? decorationAttr(d, 'data-strongs-id') : undefined
    ranges.push({ from: d.from, to: d.to, className, title: strongsId ? `Strong's ${strongsId}` : undefined })
  }

  const tag = node.type.name === 'heading' ? `h${node.attrs.level}` : 'p'
  const el = document.createElement(tag)
  if (boxClass) el.className = boxClass
  el.appendChild(renderInlineWithRanges(node, contentStart, ranges))
  return el
}

function renderCallout(node: PMNode, pos: number, decos: Decos): HTMLElement {
  const meta = CALLOUT_META[node.attrs.calloutType] ?? CALLOUT_META.NOTE
  const dom = document.createElement('div')
  dom.className = `pm-callout pm-callout-${String(node.attrs.calloutType).toLowerCase()}`
  dom.style.borderLeft = `3px solid ${meta.border}`
  dom.style.backgroundColor = meta.bg
  dom.style.borderRadius = '0 6px 6px 0'
  dom.style.padding = '0.4em 0.7em'
  dom.style.margin = '0.6em 0'
  dom.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.06)'

  const header = document.createElement('div')
  header.className = 'pm-callout-header'
  header.style.color = meta.color
  header.style.fontWeight = '700'
  header.style.fontSize = '0.78em'
  header.style.textTransform = 'uppercase'
  header.style.letterSpacing = '0.04em'
  header.style.display = 'flex'
  header.style.alignItems = 'center'
  header.style.gap = '0.35em'
  header.textContent = `${meta.icon} ${meta.label}`
  dom.appendChild(header)

  const content = document.createElement('div')
  content.className = 'pm-callout-content'
  content.style.fontSize = '0.92em'
  content.style.marginTop = '0.3em'
  let childPos = pos + 1
  node.forEach((child) => {
    content.appendChild(renderNodeAt(child, childPos, decos, false))
    childPos += child.nodeSize
  })
  dom.appendChild(content)
  return dom
}

function renderBulletMarker(marker: string, depth: number): HTMLElement {
  const span = document.createElement('span')
  span.className = 'pm-bullet-marker'
  span.style.userSelect = 'none'
  span.style.flexShrink = '0'
  span.style.lineHeight = '1'
  span.style.fontSize = '1.35em'
  // Same rule as nodeViews.ts's listItemNodeView: a literal "-" always
  // renders as a dash, distinct from the glyph set used for "*"/"+".
  if (marker === '-') {
    span.textContent = '–'
  } else {
    const styleName = useAppStore.getState().noteBulletStyle ?? 'classic'
    const styleDef = BULLET_STYLE_DEFS[styleName] ?? BULLET_STYLE_DEFS.classic
    span.textContent = styleDef.symbols[Math.min(depth, styleDef.symbols.length - 1)]
  }
  return span
}

function renderList(node: PMNode, pos: number, decos: Decos, bulletDepth: number): HTMLElement {
  const isBullet = node.type.name === 'bullet_list'
  const listEl = document.createElement(isBullet ? 'ul' : 'ol')
  if (!isBullet && node.attrs.order !== 1) listEl.setAttribute('start', String(node.attrs.order))
  const nextDepth = isBullet ? bulletDepth + 1 : bulletDepth

  let itemPos = pos + 1
  node.forEach((item) => {
    const li = document.createElement('li')
    let childPos = itemPos + 1
    const renderChildren = (container: HTMLElement) => {
      item.forEach((child) => {
        container.appendChild(renderNodeAt(child, childPos, decos, false, nextDepth))
        childPos += child.nodeSize
      })
    }

    if (item.attrs.checked !== null) {
      li.className = 'pm-task-item'
      li.style.listStyle = 'none'
      li.style.display = 'flex'
      li.style.alignItems = 'flex-start'
      li.style.gap = '0.4em'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = !!item.attrs.checked
      checkbox.disabled = true
      checkbox.className = 'pm-task-checkbox'
      checkbox.style.marginTop = '0.3em'
      checkbox.style.width = '15px'
      checkbox.style.height = '15px'
      const contentDiv = document.createElement('div')
      contentDiv.className = 'pm-task-content'
      contentDiv.style.flex = '1'
      if (item.attrs.checked) { contentDiv.style.textDecoration = 'line-through'; contentDiv.style.opacity = '0.7' }
      renderChildren(contentDiv)
      li.appendChild(checkbox)
      li.appendChild(contentDiv)
    } else if (isBullet) {
      li.className = 'pm-bullet-item'
      li.style.listStyle = 'none'
      li.style.display = 'flex'
      li.style.alignItems = 'flex-start'
      li.style.gap = '0.4em'
      li.appendChild(renderBulletMarker((node.attrs.marker as string) || '-', bulletDepth))
      const contentDiv = document.createElement('div')
      contentDiv.className = 'pm-bullet-content'
      contentDiv.style.flex = '1'
      renderChildren(contentDiv)
      li.appendChild(contentDiv)
    } else {
      renderChildren(li)
    }
    listEl.appendChild(li)
    itemPos += item.nodeSize
  })
  return listEl
}

function renderNodeAt(node: PMNode, pos: number, decos: Decos, isTopLevel: boolean, bulletDepth = 0): HTMLElement {
  switch (node.type.name) {
    case 'paragraph':
    case 'heading':
      return renderTextblock(node, pos, decos, isTopLevel)
    case 'callout':
      return renderCallout(node, pos, decos)
    case 'bullet_list':
    case 'ordered_list':
      return renderList(node, pos, decos, bulletDepth)
    case 'blockquote': {
      const el = document.createElement('blockquote')
      let childPos = pos + 1
      node.forEach((child) => {
        el.appendChild(renderNodeAt(child, childPos, decos, false))
        childPos += child.nodeSize
      })
      return el
    }
    // code_block, horizontal_rule, table — no ref-decoration support inside
    // (see the module-level scope note above for tables specifically).
    default:
      return domSerializer.serializeNode(node) as HTMLElement
  }
}

export function renderMarkdownToHTML(content: string): string {
  const doc = parseMarkdown(content)
  const decos: Decos = {
    block: buildBlockDecorations(doc, () => {}),
    ref: buildRefDecorationsForDoc(doc),
  }

  const root = document.createElement('div')
  root.className = 'berean-pm-editor'
  const pm = document.createElement('div')
  pm.className = 'ProseMirror'
  root.appendChild(pm)

  let pos = 0
  doc.forEach((node) => {
    pm.appendChild(renderNodeAt(node, pos, decos, true))
    pos += node.nodeSize
  })

  return root.outerHTML
}
