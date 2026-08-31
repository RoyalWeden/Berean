import { MarkdownSerializer, defaultMarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'
import { bereanSchema as schema, INDENT_NBSP, INDENT_NBSP_PER_LEVEL } from './schema'
import { EXTRA_BLANK_MARKER } from './parser'

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

// ─── Side-by-side columns (2.4) ─────────────────────────────────────────────
// See schema.ts's column_list/column comment and parser.ts's matching
// section for the full round-trip design. Each column is serialized by
// recursively calling `serializeToMarkdown` (defined further down this same
// file — safe to reference here despite being declared later, since this
// function body only runs at CALL time, well after module init has finished
// assigning it) on a throwaway `doc` wrapping just that column's own
// content, reusing every existing serializer rule (marks, lists, tables,
// nested column_lists, the extra-blank-line/trailing-blank recovery, all of
// it) with zero duplication — exactly parser.ts's own "recurse through the
// same top-level function" strategy, mirrored on the write side.
//
// Each column's 3-line shape (`<!-- berean:col -->`, its own markdown
// (possibly empty), `<!-- /berean:col -->`) is emitted UNCONDITIONALLY, even
// when a column's markdown is the empty string — omitting the middle line
// entirely for an empty column would collapse the required "one newline
// after the open marker, one newline before the close marker" gap that
// parser.ts's splitColumns depends on to find the boundary at all, which
// would silently fail to round-trip an empty column back into a real node.
function columnList(state: MarkdownSerializerState, node: PMNode) {
  const lines: string[] = ['<!-- berean:columns -->']
  node.forEach((col) => {
    const colDoc = schema.nodes.doc.create(null, col.content)
    lines.push('<!-- berean:col -->', serializeToMarkdown(colDoc), '<!-- /berean:col -->')
  })
  lines.push('<!-- /berean:columns -->')
  state.write(lines.join('\n'))
  state.closeBlock(node)
}

// ─── Threads ────────────────────────────────────────────────────────────────
// See schema.ts's thread/thread_entry comment and parser.ts's matching "Threads" section for
// the full round-trip design. Same recursive-`serializeToMarkdown`-per-child strategy as
// columnList() above, just with an attribute-bearing open marker: `id` is always present
// (schema.ts's thread.attrs.threadId is only ever null for a not-yet-inserted node, which never
// reaches the serializer), `title` is omitted entirely rather than written as `title=""` when
// unset (per the task brief) so a title-less thread's markdown stays minimal and later edits
// that add a title don't leave a stale empty attribute behind.
function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function thread(state: MarkdownSerializerState, node: PMNode) {
  const titleAttr = node.attrs.title ? ` title="${escapeAttr(node.attrs.title)}"` : ''
  const lines: string[] = [`<!-- berean:thread id="${node.attrs.threadId}"${titleAttr} -->`]
  node.forEach((entry) => {
    const entryDoc = schema.nodes.doc.create(null, entry.content)
    lines.push(
      `<!-- berean:thread-entry id="${entry.attrs.entryId}" created="${entry.attrs.createdAt}" -->`,
      serializeToMarkdown(entryDoc),
      '<!-- /berean:thread-entry -->',
    )
  })
  lines.push('<!-- /berean:thread -->')
  state.write(lines.join('\n'))
  state.closeBlock(node)
}

// ─── Study Trail embed ──────────────────────────────────────────────────────
// See schema.ts's study_trail_embed comment and parser.ts's matching "Study Trail embed"
// section. A single self-closing line — unlike thread() above, there's no nested content to
// recurse into, so this is just one `state.write` + `closeBlock`.
function studyTrailEmbed(state: MarkdownSerializerState, node: PMNode) {
  const titleAttr = node.attrs.title ? ` title="${escapeAttr(node.attrs.title)}"` : ''
  state.write(
    `<!-- berean:study-trail id="${node.attrs.trailSessionId}"${titleAttr} ` +
    `connections="${node.attrs.connectionCount}" needsInput="${node.attrs.needsInputCount}" -->`,
  )
  state.closeBlock(node)
}

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
  // Left-indent (schema.ts's `paragraph.indent`) → a leading NBSP run. NBSP is not
  // markdown indentation whitespace, so it round-trips as literal leading text (parser.ts
  // reads it back into the attr) instead of turning the line into an indented code block.
  const indent = (node.attrs.indent as number) || 0
  if (indent > 0) state.text(INDENT_NBSP.repeat(indent * INDENT_NBSP_PER_LEVEL), false)
  state.renderInline(node)
  state.closeBlock(node)
}

// A resized image's width round-trips as a `|wNNN` suffix appended to the alt text — see
// parser.ts's `image.getAttrs` for the matching read side and why (keeps the whole image
// round-trip on the plain `![alt](src)` CommonMark path, no new HTML-token handling needed).
// Otherwise identical to prosemirror-markdown's own default `image` serializer.
function image(state: MarkdownSerializerState, node: PMNode) {
  const alt = (node.attrs.alt || '') + (node.attrs.width ? `|w${node.attrs.width}` : '')
  state.write(
    '![' + state.esc(alt) + '](' + node.attrs.src.replace(/[()]/g, '\\$&') +
    (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')'
  )
}

export const bereanMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    paragraph,
    image,
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
    column_list: columnList,
    // column is only ever rendered manually from inside columnList() above (via
    // node.forEach/col.content), never through the normal state.render() dispatch — same
    // "satisfies strict:true's per-type-handler check, never actually invoked" role as the
    // table_row/table_header/table_cell noops above.
    column: noop,
    thread,
    // thread_entry is only ever rendered manually from inside thread() above — same
    // never-invoked-through-normal-dispatch role as column/table_row/etc. above.
    thread_entry: noop,
    study_trail_embed: studyTrailEmbed,
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

// A trailing empty paragraph (the user's last action was Enter, leaving a blank line at the
// very end of the note) is otherwise lost on the next save/restore round trip: the custom
// `paragraph` handler above recovers 2+ CONSECUTIVE empty paragraphs anywhere in the doc by
// chaining extra flushes, but that chain only produces visible output when a later sibling's
// own write() forces the flush — the doc's very LAST node has no such sibling, so its own
// "extra" blank-line unit is silently dropped regardless of how many trailing empty paragraphs
// preceded it. Sidestepped here by swapping just that final trailing empty paragraph for one
// containing the marker sentinel directly (verified: this round-trips correctly through
// parser.ts's existing marker-paragraph detection, which doesn't care whether the marker
// arrived via expandExtraBlankLines' synthesis or as literal source content).
function withTrailingBlankMarker(doc: PMNode): PMNode {
  // childCount > 1 guard: an entirely blank note (just one empty paragraph, nothing before it)
  // must stay a genuinely empty string on save, not turn into a lone marker character forever.
  const last = doc.lastChild
  if (doc.childCount <= 1 || !last || last.type.name !== 'paragraph' || last.content.size !== 0) return doc
  const markerPara = schema.nodes.paragraph.create(null, schema.text(EXTRA_BLANK_MARKER))
  return doc.copy(doc.content.cut(0, doc.content.size - last.nodeSize).append(schema.nodes.doc.create(null, markerPara).content))
}

export function serializeToMarkdown(doc: PMNode): string {
  return bereanMarkdownSerializer.serialize(withTrailingBlankMarker(doc), { tightLists: true })
}
