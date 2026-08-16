import { MarkdownParser } from 'prosemirror-markdown'
import { Fragment, type Node as PMNode } from 'prosemirror-model'
import type Token from 'markdown-it/lib/token.mjs'
import { md } from './markdownIt'
import { bereanSchema as schema } from './schema'
import { CALLOUT_META } from '@/lib/noteTextBlocks'

// ─── Token → node/mark spec table ──────────────────────────────────────────
// Mirrors prosemirror-markdown's defaultMarkdownParser.tokens, plus our
// additions: `wikilink` (mark, from markdownIt.ts's wikilink_open/_close
// tokens), list_item's `checked` attr (from markdownIt.ts's task_list core
// rule), and GFM table tokens (emitted by the 'default' markdown-it preset).

function alignFromStyle(tok: Token): string {
  const style = tok.attrGet('style') || ''
  const m = /text-align:\s*(left|center|right)/.exec(style)
  return m ? m[1] : 'left'
}

// Verbatim port of prosemirror-markdown's own `listIsTight` helper: a list is
// "tight" (no blank line between item paragraphs) when markdown-it's tokenizer
// marks the first non-list_item_open token after it `hidden` (its paragraph
// wrapper was suppressed because there was no blank line in the source).
function listIsTight(tokenStream: Token[], i: number): boolean {
  while (++i < tokenStream.length) {
    if (tokenStream[i].type !== 'list_item_open') return tokenStream[i].hidden
  }
  return false
}

const tokens: ConstructorParameters<typeof MarkdownParser>[2] = {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: {
    block: 'list_item',
    getAttrs: (tok: Token) => ({ checked: tok.meta?.checked ?? null }),
  },
  bullet_list: {
    block: 'bullet_list',
    getAttrs: (tok: Token, tokenStream: Token[], i: number) => ({
      tight: listIsTight(tokenStream, i),
      marker: tok.markup || '-',
    }),
  },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok: Token, tokenStream: Token[], i: number) => ({
      order: +(tok.attrGet('start') || 1),
      tight: listIsTight(tokenStream, i),
    }),
  },
  heading: { block: 'heading', getAttrs: (tok: Token) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok: Token) => ({ params: tok.info || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok: Token) => {
      const rawAlt = (tok.children?.[0] && tok.children[0].content) || ''
      // A resized image's width round-trips as a `|wNNN` suffix on the alt text (see
      // serializer.ts's `image` entry for the write side) — kept inside plain `![alt](src)`
      // CommonMark rather than switching to an HTML `<img width>` tag so the whole image
      // round-trip stays on the same simple token path every other image already uses,
      // with no new markdown-it/HTML-token handling needed. A note opened in Obsidian/
      // Octarine still displays the image fine; the suffix just shows up as part of its alt
      // text there, a cosmetic-only cross-app tradeoff.
      const m = /^(.*)\|w(\d+)$/.exec(rawAlt)
      return {
        src: tok.attrGet('src'),
        title: tok.attrGet('title') || null,
        alt: m ? m[1] || null : rawAlt || null,
        width: m ? Number(m[2]) : null,
      }
    },
  },
  hardbreak: { node: 'hard_break' },
  // markdown-it's `breaks: true` option (see markdownIt.ts) only changes how
  // its own HTML renderer treats a bare '\n' — the TOKEN TYPE is always
  // `softbreak` regardless of that option (confirmed in markdown-it's
  // rules_inline/newline.js), so it must be mapped here explicitly; without
  // this line every literal '\n' inside a paragraph would silently vanish
  // (unhandled token) rather than becoming a real line break in the doc.
  softbreak: { node: 'hard_break' },

  em: { mark: 'em' },
  strong: { mark: 'strong' },
  link: {
    mark: 'link',
    getAttrs: (tok: Token) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
  wikilink: { mark: 'wikilink', getAttrs: (tok: Token) => ({ title: tok.meta?.title ?? '' }) },
  s: { mark: 'strike' }, // ~~strike~~, natively tokenized by markdown-it's 'default' preset
  highlight: { mark: 'highlight', getAttrs: (tok: Token) => ({ color: tok.meta?.color ?? null }) },
  u: { mark: 'underline' }, // <u>text</u>, custom rule in markdownIt.ts

  // GFM tables (from the 'default' markdown-it preset)
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (tok: Token) => ({ alignment: alignFromStyle(tok) }) },
  td: { block: 'table_cell', getAttrs: (tok: Token) => ({ alignment: alignFromStyle(tok) }) },
}

export const bereanMarkdownParser = new MarkdownParser(schema, md, tokens)

// ─── Extra blank lines (multiple consecutive Enters) ───────────────────────
// Standard CommonMark collapses ANY run of blank lines into a single
// paragraph separator, so "A\n\n\n\nB" (two blank lines) and "A\n\nB" (one
// blank line) would otherwise parse identically — silently losing
// intentional extra vertical spacing every time a note is reopened. Since
// there's no token-level way to represent "N blank lines" as anything but
// a single block boundary, each EXTRA blank line is pre-converted into its
// own placeholder paragraph (a zero-width space, `​` — a real,
// non-blank character so the line survives tokenization as a genuine
// paragraph) before parsing, then converted to a truly EMPTY paragraph
// node in the post-process pass below. serializer.ts's custom `paragraph`
// handler does the reverse on save: an empty paragraph re-expands into an
// extra blank line. Skips fenced code blocks entirely — blank lines inside
// a code fence are literal content, never a paragraph separator.
const CODE_FENCE_RE = /(^```[\s\S]*?^```[ \t]*$|^~~~[\s\S]*?^~~~[ \t]*$)/gm
// Exported so serializer.ts can emit this same sentinel directly for a TRAILING empty
// paragraph (the one case expandExtraBlankLines' newline-run counting can't recover — see
// serializer.ts's serializeToMarkdown for why).
export const EXTRA_BLANK_MARKER = '​'

function expandExtraBlankLines(source: string): string {
  const parts = source.split(CODE_FENCE_RE)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // odd indices are the matched code-fence blocks — untouched
      return part.replace(/\n{3,}/g, (run) => '\n\n' + `${EXTRA_BLANK_MARKER}\n\n`.repeat(run.length - 2))
    })
    .join('')
}

// ─── Side-by-side columns (2.4) ─────────────────────────────────────────────
// `<!-- berean:columns -->` / `<!-- berean:col -->` / closing counterparts —
// see schema.ts's column_list/column node comment for why this is HTML
// comments, not a GFM table. Recognized via a regex pre-split BEFORE the
// source reaches markdown-it (rather than a custom markdown-it block-rule
// plugin): each columns region is swapped out for a unique placeholder
// paragraph, the REST of the document goes through the completely
// unmodified parse pipeline, then convertCallouts' own post-process walk
// (below) replaces each placeholder paragraph with a real column_list node
// built by recursively calling THIS SAME parseMarkdown function on each
// column's own raw markdown text — reusing 100% of the existing parsing
// logic (marks, lists, callouts, tables, nested fences, even nested
// column_lists, for free) with zero duplication.
//
// Extraction is done with a line-by-line scan (not a single regex over the
// whole string) specifically so it can stay fence-aware: a fenced code
// block's OWN lines are skipped over without ever testing them against the
// marker patterns, so literal "<!-- berean:col -->" example text pasted
// inside a code fence (even one nested inside a column's own content) is
// never mistaken for a real marker. A naive "mask code fences by string
// substitution first" approach was considered and rejected — collapsing a
// multi-line fence to a single-line placeholder token shifts character
// offsets, which breaks re-extracting the ORIGINAL (unmasked) column text
// afterward; the line-based scan sidesteps that class of bug entirely by
// never needing offset bookkeeping.
//
// Malformed input (an unmatched columns/col marker, or a columns block with
// fewer than 2 <!-- berean:col --> pairs — column_list's own schema.ts
// content model, `column{2,}`, forbids fewer) is a deliberate no-op: the
// marker lines are put back verbatim into the parsed stream rather than
// dropped, so a malformed block round-trips as plain (readable) paragraph
// text instead of silently losing content.
//
// KNOWN LIMITATION: this only recognizes markers that sit on their OWN
// line with nothing else on it (exactly what the serializer always
// produces) — hand-edited markdown that puts a marker mid-line won't be
// recognized as a column boundary. That's a deliberate, safe fallback (see
// above), not data loss.

const FENCE_LINE_RE = /^(```|~~~)/
const COLUMNS_OPEN_RE = /^<!--\s*berean:columns\s*-->\s*$/
const COLUMNS_CLOSE_RE = /^<!--\s*\/berean:columns\s*-->\s*$/
const COL_OPEN_RE = /^<!--\s*berean:col\s*-->\s*$/
const COL_CLOSE_RE = /^<!--\s*\/berean:col\s*-->\s*$/

// U+2063 INVISIBLE SEPARATOR bookends — practically invisible and never something a user
// would type by hand, so a real note's own text can never collide with this placeholder,
// mirroring EXTRA_BLANK_MARKER's own zero-width-space sentinel above.
function columnsPlaceholder(id: number): string {
  return `⁣berean-columns-${id}⁣`
}
const COLUMNS_PLACEHOLDER_RE = /^⁣berean-columns-(\d+)⁣$/

/** Splits `blockLines` (the raw lines strictly between a `<!-- berean:columns -->` /
 * `<!-- /berean:columns -->` pair) into each column's own raw markdown text, honoring
 * fenced code blocks so a marker-lookalike line inside one is never treated as a real
 * `<!-- berean:col -->` boundary. Returns null on any structural mismatch (a stray line
 * outside a col/…/col pair, or fewer than 2 columns found) — the caller falls back to
 * leaving the whole block as literal text rather than guessing.
 *
 * DEPTH-TRACKED, not nearest-match: a column may itself contain a full nested
 * `<!-- berean:columns -->…<!-- /berean:columns -->` block (see the "nesting" section of
 * extractColumnBlocks' own doc comment) — which means that column's raw text also contains
 * its OWN `<!-- berean:col -->`/`<!-- /berean:col -->` pairs, nested one level deeper. A
 * naive scan that stops at the FIRST `<!-- /berean:col -->` it sees would close the outer
 * column early, right after the nested list's first inner column. Counting nested opens
 * against closes (depth, below) finds the TRUE matching close at the correct depth instead. */
function splitColumns(blockLines: string[]): string[] | null {
  const cols: string[] = []
  let i = 0
  while (i < blockLines.length) {
    const line = blockLines[i]
    if (!COL_OPEN_RE.test(line)) {
      if (line.trim() !== '') return null // stray non-blank content outside a col pair
      i++
      continue
    }
    i++
    const colLines: string[] = []
    let inFence = false
    let fenceMarker = ''
    let depth = 1
    let closed = false
    while (i < blockLines.length) {
      const l = blockLines[i]
      if (!inFence && FENCE_LINE_RE.test(l.trim())) { inFence = true; fenceMarker = FENCE_LINE_RE.exec(l.trim())![1] }
      else if (inFence && l.trim().startsWith(fenceMarker)) inFence = false
      if (!inFence && COL_OPEN_RE.test(l)) depth++
      else if (!inFence && COL_CLOSE_RE.test(l)) {
        depth--
        if (depth === 0) { i++; closed = true; break }
      }
      colLines.push(l)
      i++
    }
    if (!closed) return null // unterminated <!-- berean:col -->
    cols.push(colLines.join('\n'))
  }
  return cols.length >= 2 ? cols : null
}

/** Scans `source` line-by-line, replacing every well-formed top-level
 * `<!-- berean:columns -->…<!-- /berean:columns -->` region with a unique placeholder line
 * (fence-aware — see the module comment above), collecting each region's per-column raw
 * markdown into `columnLists` keyed by that placeholder's id. Everything else (including
 * ordinary fenced code blocks outside any columns region) passes through completely
 * untouched. */
function extractColumnBlocks(source: string): { text: string; columnLists: Map<number, string[]> } {
  const columnLists = new Map<number, string[]>()
  const lines = source.split('\n')
  const out: string[] = []
  let counter = 0
  let i = 0
  let inFence = false
  let fenceMarker = ''
  while (i < lines.length) {
    const line = lines[i]
    if (!inFence && FENCE_LINE_RE.test(line.trim())) { inFence = true; fenceMarker = FENCE_LINE_RE.exec(line.trim())![1]; out.push(line); i++; continue }
    if (inFence) {
      if (line.trim().startsWith(fenceMarker)) inFence = false
      out.push(line)
      i++
      continue
    }
    if (COLUMNS_OPEN_RE.test(line)) {
      const blockLines: string[] = []
      i++
      let innerFence = false
      let innerFenceMarker = ''
      // Depth-tracked (not nearest-match) for the same reason splitColumns tracks `<!--
      // berean:col -->` depth: a column may contain its own nested columns block, whose
      // closing marker must NOT be mistaken for this (outer) block's own close.
      let depth = 1
      let closed = false
      while (i < lines.length) {
        const l = lines[i]
        if (!innerFence && FENCE_LINE_RE.test(l.trim())) { innerFence = true; innerFenceMarker = FENCE_LINE_RE.exec(l.trim())![1] }
        else if (innerFence && l.trim().startsWith(innerFenceMarker)) innerFence = false
        if (!innerFence && COLUMNS_OPEN_RE.test(l)) depth++
        else if (!innerFence && COLUMNS_CLOSE_RE.test(l)) {
          depth--
          if (depth === 0) { i++; closed = true; break }
        }
        blockLines.push(l)
        i++
      }
      const cols = closed ? splitColumns(blockLines) : null
      if (cols) {
        const id = counter++
        columnLists.set(id, cols)
        out.push(columnsPlaceholder(id))
      } else {
        // Malformed — restore verbatim (readable plain text, not data loss).
        out.push('<!-- berean:columns -->', ...blockLines)
        if (closed) out.push('<!-- /berean:columns -->')
      }
      continue
    }
    out.push(line)
    i++
  }
  return { text: out.join('\n'), columnLists }
}

/**
 * Parse markdown source into a ProseMirror document, then run structural
 * post-processing that isn't expressible as a token→node ParseSpec mapping:
 * callout detection, i.e. a `blockquote` whose first paragraph starts with
 * `[!TYPE]` becomes a `callout` node with that leading marker stripped;
 * extra-blank-line marker paragraphs becoming genuinely empty paragraphs;
 * and columns-placeholder paragraphs becoming real column_list nodes (see
 * the "Side-by-side columns" section above).
 * (Verse/lexicon blocks are deliberately NOT handled here — see schema.ts;
 * they stay plain paragraphs and are decorated live in Phase 5.)
 */
export function parseMarkdown(source: string): PMNode {
  // Defensive: markdown-it throws on null/undefined input ("Input data
  // should be a String"). A note's `content` should always be a string by
  // contract, but a nullable DB column or an unexpected caller can still
  // hand this a null/undefined value — coercing here means the EditorView
  // never fails to construct over it (which otherwise silently leaves the
  // note completely non-editable, with no visible error at all).
  const { text: columnsStripped, columnLists } = extractColumnBlocks(source ?? '')
  const preprocessed = expandExtraBlankLines(columnsStripped)
  return convertCallouts(bereanMarkdownParser.parse(preprocessed) as PMNode, columnLists)
}

const CALLOUT_RE = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s?/i

function convertCallouts(doc: PMNode, columnLists: Map<number, string[]>): PMNode {
  return mapBlockChildren(doc, columnLists)
}

function mapBlockChildren(node: PMNode, columnLists: Map<number, string[]>): PMNode {
  if (!node.isBlock || node.content.size === 0) return node
  const mapped: PMNode[] = []
  node.forEach((child) => mapped.push(maybeConvertNode(child, columnLists)))
  return node.copy(Fragment.fromArray(mapped))
}

function maybeConvertNode(node: PMNode, columnLists: Map<number, string[]>): PMNode {
  // Extra-blank-line marker paragraph (see expandExtraBlankLines above) —
  // a paragraph whose sole content is the zero-width-space marker becomes
  // a genuinely empty paragraph, which serializer.ts's custom paragraph
  // handler re-expands back into an extra blank line on save.
  if (node.type.name === 'paragraph' && node.childCount === 1) {
    const only = node.firstChild
    if (only && only.isText && only.text === EXTRA_BLANK_MARKER) {
      return schema.nodes.paragraph.create()
    }
    // Columns placeholder paragraph (see extractColumnBlocks above) — becomes a real
    // column_list, with each column's raw markdown parsed independently through THIS SAME
    // parseMarkdown function (recursive — also transparently handles a column that itself
    // contains a nested <!-- berean:columns --> block).
    if (only && only.isText) {
      const m = COLUMNS_PLACEHOLDER_RE.exec(only.text || '')
      if (m) {
        const cols = columnLists.get(Number(m[1]))
        if (cols) {
          const columnNodes = cols.map((colMd) => schema.nodes.column.create(null, parseMarkdown(colMd).content))
          return schema.nodes.column_list.create(null, columnNodes)
        }
      }
    }
  }
  if (node.type.name !== 'blockquote') return mapBlockChildren(node, columnLists)

  const firstPara = node.firstChild
  const firstText = firstPara && firstPara.type.name === 'paragraph' ? firstPara.firstChild : null
  const m = firstText && firstText.isText ? CALLOUT_RE.exec(firstText.text || '') : null
  if (!m) return mapBlockChildren(node, columnLists)

  const calloutType = m[1].toUpperCase()
  if (!CALLOUT_META[calloutType]) return mapBlockChildren(node, columnLists)

  // Strip the "[!TYPE] " marker from the start of the first paragraph's text.
  const strippedFirstPara = firstPara!.cut(m[0].length)
  const restChildren: PMNode[] = []
  node.forEach((child, _offset, index) => {
    if (index === 0) {
      if (strippedFirstPara.content.size > 0) restChildren.push(strippedFirstPara)
    } else {
      restChildren.push(child)
    }
  })
  if (restChildren.length === 0) restChildren.push(schema.nodes.paragraph.create())

  const converted = schema.nodes.callout.create({ calloutType }, Fragment.fromArray(restChildren))
  return mapBlockChildren(converted, columnLists)
}
