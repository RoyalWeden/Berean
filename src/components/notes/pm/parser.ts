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
    getAttrs: (tok: Token) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: (tok.children?.[0] && tok.children[0].content) || null,
    }),
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
const EXTRA_BLANK_MARKER = '​'

function expandExtraBlankLines(source: string): string {
  const parts = source.split(CODE_FENCE_RE)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // odd indices are the matched code-fence blocks — untouched
      return part.replace(/\n{3,}/g, (run) => '\n\n' + `${EXTRA_BLANK_MARKER}\n\n`.repeat(run.length - 2))
    })
    .join('')
}

/**
 * Parse markdown source into a ProseMirror document, then run structural
 * post-processing that isn't expressible as a token→node ParseSpec mapping:
 * callout detection, i.e. a `blockquote` whose first paragraph starts with
 * `[!TYPE]` becomes a `callout` node with that leading marker stripped, and
 * extra-blank-line marker paragraphs becoming genuinely empty paragraphs.
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
  const preprocessed = expandExtraBlankLines(source ?? '')
  return convertCallouts(bereanMarkdownParser.parse(preprocessed) as PMNode)
}

const CALLOUT_RE = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s?/i

function convertCallouts(doc: PMNode): PMNode {
  return mapBlockChildren(doc)
}

function mapBlockChildren(node: PMNode): PMNode {
  if (!node.isBlock || node.content.size === 0) return node
  const mapped: PMNode[] = []
  node.forEach((child) => mapped.push(maybeConvertNode(child)))
  return node.copy(Fragment.fromArray(mapped))
}

function maybeConvertNode(node: PMNode): PMNode {
  // Extra-blank-line marker paragraph (see expandExtraBlankLines above) —
  // a paragraph whose sole content is the zero-width-space marker becomes
  // a genuinely empty paragraph, which serializer.ts's custom paragraph
  // handler re-expands back into an extra blank line on save.
  if (node.type.name === 'paragraph' && node.childCount === 1) {
    const only = node.firstChild
    if (only && only.isText && only.text === EXTRA_BLANK_MARKER) {
      return schema.nodes.paragraph.create()
    }
  }
  if (node.type.name !== 'blockquote') return mapBlockChildren(node)

  const firstPara = node.firstChild
  const firstText = firstPara && firstPara.type.name === 'paragraph' ? firstPara.firstChild : null
  const m = firstText && firstText.isText ? CALLOUT_RE.exec(firstText.text || '') : null
  if (!m) return mapBlockChildren(node)

  const calloutType = m[1].toUpperCase()
  if (!CALLOUT_META[calloutType]) return mapBlockChildren(node)

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
  return mapBlockChildren(converted)
}
