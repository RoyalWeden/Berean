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

  // Threads — a collapsible container living INSIDE a note (verse or general), holding a
  // growing, timestamped log of entries (journal/chat-log shape), not a new note type or a
  // per-verse concept. Modeled directly on column_list/column just above: `thread` is a
  // `block`-group member (insertable at the top level of a note, or nested inside a column/
  // blockquote/etc, same as callout/column_list), `thread_entry` is deliberately NOT a `block`
  // group member so it can only ever appear as a direct child of `thread` — same "narrowly-
  // scoped node" shape `column` itself uses. Markdown round-trip is HTML-comment-delimited
  // (parser.ts/serializer.ts), reusing column_list's own placeholder-swap + depth-tracked
  // extraction algorithm verbatim rather than inventing new parsing logic.
  //
  // `threadId` is a caller-generated uuid stamped once at insertion time (Toolbar.tsx/
  // slashCommands.ts) — this is the thread's stable identity for collapse-state persistence
  // (threadCollapse.ts), deliberately NOT a derived-from-content key the way headingCollapse.ts's
  // computeHeadingKey has to be for headings (headings have no attr slot to carry an id in);
  // threads do, so there's no need for that fallback machinery at all here.
  // `title` is user-set (editable in threadNodeView.ts's header); null means "no title yet" —
  // the collapsed/expanded header then falls back to a truncated preview of the first entry's
  // own text instead (threadNodeView.ts's firstLinePreview), never a literal empty string.
  thread: {
    content: 'thread_entry+',
    group: 'block',
    attrs: { threadId: { default: null }, title: { default: null } },
    parseDOM: [{ tag: 'div[data-thread]', getAttrs: (dom) => ({
      threadId: (dom as HTMLElement).getAttribute('data-thread-id'),
      title: (dom as HTMLElement).getAttribute('data-thread-title') || null,
    }) }],
    toDOM: (node) => ['div', {
      'data-thread': 'true',
      'data-thread-id': node.attrs.threadId,
      ...(node.attrs.title ? { 'data-thread-title': node.attrs.title } : {}),
      class: 'pm-thread',
    }, 0],
  },

  // One entry in a thread's log. `entryId` is a caller-generated uuid (parallel role to
  // `threadId` above, though nothing currently keys persisted state off it — reserved for a
  // future per-entry feature, and cheap to carry now rather than retrofit later). `createdAt`
  // is an ISO-8601 timestamp string stamped once when the entry is created (threadNodeView.ts's
  // "+ Add entry" control) and never edited afterward — it's the entry's permanent timestamp
  // badge, not a "last modified" time.
  thread_entry: {
    content: 'block+',
    attrs: { entryId: { default: null }, createdAt: { default: null } },
    parseDOM: [{ tag: 'div[data-thread-entry]', getAttrs: (dom) => ({
      entryId: (dom as HTMLElement).getAttribute('data-entry-id'),
      createdAt: (dom as HTMLElement).getAttribute('data-created'),
    }) }],
    toDOM: (node) => ['div', {
      'data-thread-entry': 'true',
      'data-entry-id': node.attrs.entryId,
      'data-created': node.attrs.createdAt,
      class: 'pm-thread-entry',
    }, 0],
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
    // `width` is nullable pixel width, unset by default — an unsized image renders at its
    // natural size (capped by the editor's own `max-width: 100%` CSS, pmEditor.css) exactly
    // like before this attr existed. Deliberately no separate `height` attr: the resize
    // NodeView (nodeViews.ts) only ever drags width, letting CSS `height: auto` preserve the
    // image's own aspect ratio — one fewer attr to keep in sync, and no risk of a stretched/
    // squashed image from width and height attrs drifting out of proportion with each other.
    attrs: { src: {}, alt: { default: null }, title: { default: null }, width: { default: null } },
    group: 'inline',
    draggable: true,
    parseDOM: [{
      tag: 'img[src]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        // toDOM (below) now emits width via an inline `style="width:NNNpx;..."` instead of a
        // literal `width` attribute (see that function's own comment) — fall back to reading
        // it from the style so pasting a copy of this node's own rendered output (or any HTML
        // this app itself produced, e.g. from the print/PDF pipeline) back into the editor
        // still recovers the resized width instead of silently losing it.
        const widthAttr = el.getAttribute('width') ?? el.style.width.match(/^(\d+)px$/)?.[1] ?? null
        return {
          src: el.getAttribute('src'),
          title: el.getAttribute('title'),
          alt: el.getAttribute('alt'),
          width: widthAttr ? Number(widthAttr) || null : null,
        }
      },
    }],
    // Built explicitly (not a bare `node.attrs` spread) so a null attr (alt/title/width all
    // default to null) never round-trips into a literal `alt="null"`/`width="null"` DOM
    // attribute — ProseMirror's DOMOutputSpec does not filter null values out on its own.
    toDOM: (node) => {
      const attrs: Record<string, string> = { src: node.attrs.src }
      if (node.attrs.alt) attrs.alt = node.attrs.alt
      if (node.attrs.title) attrs.title = node.attrs.title
      // A literal `width="NNN"` HTML attribute (the previous behavior) has no clamp of its
      // own — every consumer of this raw toDOM output OTHER than the live editor (which uses
      // its own imageNodeView + a `.pm-image-wrap` CSS wrapper, ignoring this toDOM entirely)
      // rendered a resized image at its full literal pixel width with nothing capping it to
      // the container: print/PDF, version history, the daily continuous-scroll view, and the
      // Presenter/viewer window (staticRender.ts's domSerializer fallback for the 'image' node
      // type, and any other raw DOM/clipboard consumer of this schema) could all bleed a
      // resized image straight off the page/container edge. An inline style carries both the
      // intended width AND a `max-width:100%` safety net together, so no consumer can render
      // this node unclamped even if it doesn't define its own width-capping CSS.
      if (node.attrs.width) attrs.style = `width:${node.attrs.width}px;max-width:100%;height:auto`
      return ['img', attrs]
    },
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
