import { MarkdownSerializer, defaultMarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'
import { bereanSchema as schema } from './schema'

// ─── list_item / task checkboxes ───────────────────────────────────────────
// `checked: null` -> plain list item (default renderContent). `checked: true
// | false` -> prefix the item's first line with `[x] `/`[ ] `, reproducing
// standard GFM task-list markdown with zero extra syntax beyond that.
function listItem(state: MarkdownSerializerState, node: PMNode) {
  if (node.attrs.checked === null) {
    state.renderContent(node)
    return
  }
  const marker = node.attrs.checked ? '[x] ' : '[ ] '
  // Inject the marker at the start of rendered output for this item by
  // writing it before delegating to renderContent — MarkdownSerializerState
  // has no direct "prefix next write" hook, so we temporarily wrap via
  // wrapBlock with an empty continuation delim (marker only affects line 1,
  // matching how bullet markers themselves are only applied to line 1 by
  // renderList's firstDelim).
  state.write(marker)
  state.renderContent(node)
}

// ─── Tables ─────────────────────────────────────────────────────────────────
// GFM pipe tables. Matches today's `buildTableMarkdown` normalizer: always
// single-space cell padding, alignment row derived from cell `alignment`
// attrs — this is a deliberate, pre-existing lossy-but-consistent round-trip
// (hand-aligned table spacing is not preserved), Phase 0's confirmed decision.
function table(state: MarkdownSerializerState, node: PMNode) {
  const rows: string[][] = []
  let alignments: string[] = []
  node.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => {
      cells.push(cell.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '))
      if (alignments.length < row.childCount) alignments.push(cell.attrs.alignment || 'left')
    })
    rows.push(cells)
  })
  if (rows.length === 0) { state.closeBlock(node); return }

  const colCount = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: colCount }, (_, i) => r[i] ?? '')
  const sepFor = (align: string) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : '---')

  const lines: string[] = []
  lines.push('| ' + pad(rows[0]).join(' | ') + ' |')
  lines.push('| ' + Array.from({ length: colCount }, (_, i) => sepFor(alignments[i] || 'left')).join(' | ') + ' |')
  for (let i = 1; i < rows.length; i++) lines.push('| ' + pad(rows[i]).join(' | ') + ' |')

  state.write(lines.join('\n'))
  state.closeBlock(node)
}

// table_row/table_header/table_cell are only ever rendered from inside
// `table()` above (via node.forEach/textContent), never independently — but
// MarkdownSerializer.render() dispatches based on the top-level node passed
// to `serialize()`, which always starts at `doc`, so these entries exist
// purely to satisfy `strict: true`'s "every node type must have a serializer"
// check and are never actually invoked in isolation.
const noop = () => {}

// ─── Callouts ───────────────────────────────────────────────────────────────
// Reconstructs the `> [!TYPE] ...` blockquote form: prepend the marker to
// the callout's first paragraph, then reuse blockquote's own wrapBlock
// quoting logic.
function callout(state: MarkdownSerializerState, node: PMNode) {
  state.wrapBlock('> ', null, node, () => {
    state.write(`[!${node.attrs.calloutType}] `)
    state.renderContent(node)
  })
}

// ─── Extra blank lines (multiple consecutive Enters) ───────────────────────
// Standard CommonMark collapses ANY run of blank lines into a single
// paragraph separator — by default an empty ProseMirror paragraph (from the
// user pressing Enter more than once, or a `​`-marker paragraph
// produced by parser.ts's preprocessing of existing markdown, see
// parser.ts's `expandExtraBlankLines`) would silently lose that extra
// vertical spacing on every save, since `defaultMarkdownSerializer`'s
// paragraph handler renders nothing for empty content and the surrounding
// close/flush cycle only ever produces the standard single-blank-line gap.
// This override forces one additional blank line into the output for each
// empty paragraph that has real content before it (skipped at the very
// start of the document, where a leading blank line isn't preservable
// through plain markdown source text anyway — standard parsers strip
// leading/trailing blank lines around the whole document regardless).
function paragraph(state: MarkdownSerializerState, node: PMNode) {
  if (node.content.size === 0) {
    // A single no-op `write()` call is sufficient and exact: it forces an
    // intermediate flush of whatever preceded this paragraph (closing that
    // gap at the standard single-blank-line size), then `closeBlock` marks
    // THIS empty paragraph as the new "closed" node so the NEXT sibling's
    // own first write() triggers a SECOND, independent flush — two
    // standard gaps stacked back to back is exactly one extra blank line.
    // (An earlier version of this also manually appended a raw '\n' on top
    // of this — that double-counted, since the write() call alone already
    // produces the correct gap; verified empirically against exact
    // blank-line counts before landing this version.)
    if ((state as unknown as { closed: PMNode | null }).closed) state.write()
    state.closeBlock(node)
    return
  }
  state.renderInline(node)
  state.closeBlock(node)
}

export const bereanMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    paragraph,
    bullet_list(state, node) {
      const marker = (node.attrs.marker as string) || '-'
      state.renderList(node, '  ', () => `${marker} `)
    },
    list_item: listItem,
    callout,
    table,
    table_row: noop,
    table_header: noop,
    table_cell: noop,
  },
  {
    ...defaultMarkdownSerializer.marks,
    underline: { open: '<u>', close: '</u>', mixable: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    // Plain highlights (no color attr) round-trip as `==text==`; colored
    // highlights use the CM6 editor's own `<mark class="hl-COLOR">` markup —
    // matches markdownIt.ts's two parser rules exactly.
    highlight: {
      open: (_state, mark) => (mark.attrs.color ? `<mark class="hl-${mark.attrs.color}">` : '=='),
      close: (_state, mark) => (mark.attrs.color ? '</mark>' : '=='),
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    // The mark's text content IS the title (set verbatim by the tokenizer in
    // markdownIt.ts), so serialization is a trivial bracket-wrap — no need to
    // consult `mark.attrs.title` here, it exists only for click-handling.
    wikilink: { open: '[[', close: ']]', mixable: false },
  },
)

export function serializeToMarkdown(doc: PMNode): string {
  return bereanMarkdownSerializer.serialize(doc, { tightLists: true })
}
