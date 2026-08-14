import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

// ─── Nodes ──────────────────────────────────────────────────────────────────
// Base nodes mirror prosemirror-markdown's default schema (doc/paragraph/
// blockquote/heading/code_block/text/hard_break, bullet_list/ordered_list/
// list_item) plus our own additions. We don't import prosemirror-markdown's
// `schema` directly because we need to splice in `verse_block`, `lexicon_block`,
// `callout`, and task-list attrs — easier to declare the full node set here and
// keep MarkdownParser/Serializer (parser.ts/serializer.ts) in sync by hand.

const pDOM = ['p', 0] as const

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => pDOM,
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  // GFM `> [!NOTE] Title` — a real markdown-backed node (unlike verse/lexicon
  // blocks, which are unmarked plain text recognized live). calloutType is one
  // of NOTE|TIP|WARNING|IMPORTANT|CAUTION (case preserved from source, upper-
  // cased at parse time to match today's CALLOUT_META table keys).
  callout: {
    content: 'block+',
    group: 'block',
    attrs: { calloutType: { default: 'NOTE' } },
    parseDOM: [{ tag: 'div[data-callout]', getAttrs: (dom) => ({ calloutType: (dom as HTMLElement).getAttribute('data-callout') || 'NOTE' }) }],
    toDOM: (node) => ['div', { 'data-callout': node.attrs.calloutType, class: `pm-callout pm-callout-${String(node.attrs.calloutType).toLowerCase()}` }, 0],
  },

  // Side-by-side layout (2.4 of the notes-editor migration plan). `column_list`'s content
  // model requires 2+ columns (a "layout" of fewer would be meaningless); `column` is
  // deliberately NOT a member of the `block` group, so it can only ever appear as a direct
  // child of `column_list` — never a bare top-level doc block, never nested inside a list
  // item/blockquote/table cell/etc. Same "narrowly-scoped node" shape as prosemirror-tables'
  // own table_row/table_cell (tableNodes() below), just declared by hand since there's no
  // off-the-shelf helper for a flex-column layout. Markdown representation (parser.ts/
  // serializer.ts) is HTML-comment-delimited (`<!-- berean:columns -->` /
  // `<!-- berean:col -->`), NOT a GFM table — table cells in THIS schema are `inline*`-only
  // (see the cellContent comment below), which can't hold a heading/list/callout inside a
  // column, and that block-content requirement is the whole reason columns exist.
  column_list: {
    content: 'column{2,}',
    group: 'block',
    parseDOM: [{ tag: 'div[data-column-list]' }],
    toDOM: () => ['div', { 'data-column-list': 'true', class: 'pm-column-list' }, 0],
  },

  column: {
    content: 'block+',
    parseDOM: [{ tag: 'div[data-column]' }],
    toDOM: () => ['div', { 'data-column': 'true', class: 'pm-column' }, 0],
  },

  // NOTE: verse blocks and lexicon blocks are intentionally NOT modeled as
  // schema nodes. In the original CM6 editor, detection of these is
  // data-dependent (verse text is verified against the real Bible DB via an
  // async threshold check) and purely a decoration layer over ordinary
  // paragraph text — the underlying markdown is always plain, unmarked lines.
  // Giving them a real node type would force async DB lookups during
  // synchronous markdown parsing, which is both unnecessary and a behavior
  // change. Instead they stay plain `paragraph` nodes, and Phase 5 adds a
  // decoration Plugin (mirroring buildLiveDecorations in NoteEditor.tsx) that
  // styles matching paragraphs once the async verify resolves. This keeps
  // the "zero markdown markers" round-trip trivially true.

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  heading: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },

  code_block: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    attrs: { params: { default: '' } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (dom) => ({ params: (dom as HTMLElement).getAttribute('data-params') || '' }) }],
    toDOM: (node) => ['pre', node.attrs.params ? { 'data-params': node.attrs.params } : {}, ['code', 0]],
  },

  text: { group: 'inline' },

  image: {
    inline: true,
    attrs: { src: {}, alt: { default: null }, title: { default: null } },
    group: 'inline',
    draggable: true,
    parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => ({ src: (dom as HTMLElement).getAttribute('src'), title: (dom as HTMLElement).getAttribute('title'), alt: (dom as HTMLElement).getAttribute('alt') }) }],
    toDOM: (node) => ['img', node.attrs],
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  // `tight` mirrors prosemirror-markdown's own default schema exactly:
  // whether adjacent list-item paragraphs render with a blank line between
  // them. Without tracking this, the serializer's tightLists option default
  // (false = always loose) inserts blank lines into originally-tight lists,
  // which was confirmed during Phase 1 round-trip testing to cascade into a
  // large character-offset drift through the rest of the document.
  // `marker` (the literal "-"/"*"/"+" character used in the source)
  // preserves the "-" vs "*" distinction the user can now see reflected as
  // a different bullet glyph (nodeViews.ts) — previously both collapsed
  // into the exact same bullet_list with no memory of which was typed, so
  // there was no way to visually tell them apart. Markdown always
  // round-trips using the ORIGINAL marker (serializer.ts), never
  // normalizing to one or the other.
  bullet_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { tight: { default: false }, marker: { default: '-' } },
    parseDOM: [{ tag: 'ul', getAttrs: (dom) => ({
      tight: (dom as HTMLElement).hasAttribute('data-tight'),
      marker: (dom as HTMLElement).getAttribute('data-marker') || '-',
    }) }],
    toDOM: (node) => ['ul', { 'data-tight': node.attrs.tight ? 'true' : null, 'data-marker': node.attrs.marker }, 0],
  },

  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { order: { default: 1 }, tight: { default: false } },
    parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ order: Number((dom as HTMLElement).getAttribute('start')) || 1, tight: (dom as HTMLElement).hasAttribute('data-tight') }) }],
    toDOM: (node) => ['ol', { start: node.attrs.order === 1 ? null : node.attrs.order, 'data-tight': node.attrs.tight ? 'true' : null }, 0],
  },

  // list_item doubles as a task item: `checked: null` means "plain list item",
  // `checked: true/false` means "- [x]"/"- [ ]" task line. This mirrors the
  // current architecture (task checkboxes are plain GFM `- [ ]`, no separate
  // node type) while giving us a real, clickable checkbox via a NodeView.
  list_item: {
    content: 'paragraph block*',
    attrs: { checked: { default: null } },
    parseDOM: [{ tag: 'li', getAttrs: (dom) => {
      const el = dom as HTMLElement
      const v = el.getAttribute('data-checked')
      return { checked: v === null ? null : v === 'true' }
    } }],
    toDOM: (node) => ['li', node.attrs.checked === null ? {} : { 'data-checked': String(node.attrs.checked) }, 0],
    defining: true,
  },

  // cellContent: 'inline*' (not the more common 'block+') deliberately
  // matches today's existing table behavior — the CM6 `TableBlockWidget`
  // treats cells as plain trimmed text with no block content (no lists/
  // images inside a cell), and markdown-it's GFM table tokens (th/td) emit
  // raw inline content directly with no wrapping paragraph, so 'inline*'
  // avoids a parse-time content-model mismatch (which silently produced
  // empty cells during Phase 1 round-trip testing — block+ was auto-filled
  // with an empty paragraph since there was no paragraph_open/close token to
  // map inline content into).
  ...tableNodes({
    tableGroup: 'block',
    cellContent: 'inline*',
    cellAttributes: {
      alignment: { default: 'left', getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || 'left', setDOMAttr: (value, attrs) => { attrs.style = (attrs.style || '') + `text-align: ${value};` } },
    },
  }),
}

// ─── Marks ──────────────────────────────────────────────────────────────────

const marks: Record<string, MarkSpec> = {
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strong: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: (v) => (/^(bold(er)?|[5-9]\d{2,})$/.test(v as string) ? null : false) }],
    toDOM: () => ['strong', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
    excludes: '_',
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'strike' }, { tag: 'del' }],
    toDOM: () => ['s', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }],
    toDOM: () => ['u', 0],
  },
  // `color: null` -> plain `==text==` (generic yellow-ish highlight).
  // `color: 'amber'|'red'|...` -> `<mark class="hl-{color}">text</mark>`,
  // matching the CM6 editor's colored-highlight convention exactly (reuses
  // the same `mark.hl-*` global CSS rules, global.css:569-583 — no new
  // styling needed).
  highlight: {
    attrs: { color: { default: null } },
    parseDOM: [{ tag: 'mark', getAttrs: (dom) => {
      const cls = (dom as HTMLElement).className.match(/^hl-(\w+)$/)
      return { color: cls ? cls[1] : null }
    } }],
    toDOM: (node) => node.attrs.color
      ? ['mark', { class: `hl-${node.attrs.color}` }, 0]
      : ['mark', { class: 'pm-highlight-plain' }, 0],
  },
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM: (node) => ['a', { href: node.attrs.href, title: node.attrs.title }, 0],
  },

  // [[Title]] — parsed via a custom markdown-it inline rule (see parser.ts),
  // rendered as a pill via toDOM. Unlike CM6's "hide raw brackets with a
  // widget" trick, PM marks never show delimiter syntax in the editable view
  // at all — the `[[`/`]]` only exist in the serialized markdown string.
  wikilink: {
    attrs: { title: {} },
    inclusive: false,
    parseDOM: [{ tag: 'span[data-wikilink]', getAttrs: (dom) => ({ title: (dom as HTMLElement).getAttribute('data-wikilink') }) }],
    toDOM: (node) => ['span', { 'data-wikilink': node.attrs.title, class: 'pm-wikilink' }, 0],
  },
}

export const bereanSchema = new Schema({ nodes, marks })

export type BereanSchema = typeof bereanSchema
