import MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'

// 'default' preset (not 'commonmark') enables GFM-style pipe tables, which
// prosemirror-tables' node types (parsed via schema.ts's tableNodes()) need.
//
// `breaks: true` is deliberate and load-bearing: strict CommonMark collapses
// a single '\n' inside a paragraph into a plain space (a "soft break"), but
// the CM6 editor being replaced never does this — it's a flat-text editor
// where every literal '\n' in stored content renders as-is. Obsidian (the
// vault this app syncs notes to, see CLAUDE.md §18) has the same
// single-newline-is-a-line-break convention. Without `breaks: true`, this
// migration would silently join every soft-wrapped multi-line note paragraph
// into one run-on line the first time it's opened and re-saved — the
// majority of the 448/3325 structural round-trip mismatches found in Phase 1
// testing against real note content showed the exact 1-newline-per-line-
// became-1-space signature of this issue (confirmed via structural
// fingerprinting, never by reading note content) before this option was
// enabled.
export const md = MarkdownIt('default', { html: false, breaks: true })

// Disable indented (4-space / tab) code blocks. Fenced ``` blocks stay on
// (separate 'fence' rule) — and the serializer only ever WRITES code blocks
// fenced (defaultMarkdownSerializer.nodes.code_block), so nothing round-trips
// through the indented form. Leaving it enabled silently turns any
// tab-indented paragraph into a monospace code block that swallows its inline
// formatting. This bites imported content in particular: e-Sword's stripRtf
// (electron/ipc/eSwordImport.ts) maps RTF \tab -> '\t' and \par -> '\n', and
// RTF study notes routinely start a paragraph with a first-line \tab indent,
// producing '\n\n\t…' — which markdown-it's 'default' preset would otherwise
// parse as an indented code block.
md.disable('code')

// ─── [[Title]] wikilinks ────────────────────────────────────────────────────
// A custom inline rule, modeled on markdown-it's own `link` rule shape.
// Emits an open/close token pair (`wikilink_open`/`wikilink_close`) wrapping
// a single text token, so prosemirror-markdown's standard `mark`-type
// ParseSpec (which expects `_open`/`_close` tokens, see parser.ts) applies
// unmodified — no custom token-stream handling needed downstream. Titles are
// NOT run through nested inline parsing (no bold/italic inside `[[ ]]`),
// matching today's CM6 behavior where wikilink titles are plain text only.
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  if (state.src.slice(start, start + 2) !== '[[') return false
  const end = state.src.indexOf(']]', start + 2)
  if (end === -1) return false
  const title = state.src.slice(start + 2, end)
  if (!title || title.includes('\n')) return false

  if (!silent) {
    const open = state.push('wikilink_open', 'span', 1)
    open.meta = { title }
    const text = state.push('text', '', 0)
    text.content = title
    state.push('wikilink_close', 'span', -1)
  }
  state.pos = end + 2
  return true
}

md.inline.ruler.before('link', 'wikilink', wikilinkRule)

// ─── Task list checkboxes ───────────────────────────────────────────────────
// markdown-it doesn't parse `- [ ]`/`- [x]` specially; it's plain text at the
// start of the list item's first paragraph. This core rule runs after normal
// block parsing and, for each list_item whose first inline token's content
// starts with a checkbox marker, strips the marker text and stamps a
// `checked` flag onto the enclosing list_item_open token's meta (read by
// parser.ts's getAttrs for list_item).
const TASK_RE = /^\[([ xX])\]\s+/

function taskListRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open') continue
    // First child block should be paragraph_open -> inline -> paragraph_close
    const inlineIdx = i + 2
    const inline = tokens[inlineIdx]
    if (!inline || inline.type !== 'inline') continue
    const m = TASK_RE.exec(inline.content)
    if (!m) continue
    const checked = m[1].toLowerCase() === 'x'
    tokens[i].meta = { ...(tokens[i].meta || {}), checked }
    inline.content = inline.content.slice(m[0].length)
    if (inline.children && inline.children[0] && inline.children[0].type === 'text') {
      inline.children[0].content = inline.children[0].content.replace(TASK_RE, '')
    }
  }
}

md.core.ruler.push('task_list', taskListRule)

// ─── Highlights: ==text== (plain) and <mark class="hl-COLOR">text</mark> ────
// `~~strike~~` is natively supported by markdown-it's 'default' preset
// (emits s_open/s_close, wired in parser.ts) — no custom rule needed there.
// `==text==` is NOT natively supported by any markdown-it preset, and was
// previously missing entirely: the CM6-ported serializer (serializer.ts)
// could already WRITE `==text==`, but nothing could READ it back — every
// note containing a plain highlight would show the literal `==` characters
// as plain text on reopen instead of styled highlighting. Colored
// highlights use the CM6 editor's own exact `<mark class="hl-COLOR">`
// convention (matching its reused global CSS, global.css:569-583) — parsed
// here as a narrowly-scoped custom rule rather than enabling markdown-it's
// general `html: true` (which would open up arbitrary HTML parsing).
// Both rules below tokenize their captured inner span through markdown-it's
// own inline tokenizer (state.md.inline.tokenize(state), bounded by a
// temporary state.pos/posMax window) rather than pushing one flat text
// token — the same pattern markdown-it's own `link` rule uses for link text
// (rules_inline/link.mjs). An earlier version pushed a single raw text
// token, which meant nested formatting (e.g. **bold** inside a highlight)
// was captured as literal unparsed text: it round-tripped fine the first
// time (serializer.ts emits `==**bold**==` correctly) but the moment that
// markdown was re-parsed — reopening the note, autosave, vault export/
// reimport — the inner `**bold**` showed up as literal asterisks instead of
// bold text, since nothing had re-tokenized it.
function highlightPlainRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  if (state.src.slice(start, start + 2) !== '==') return false
  const end = state.src.indexOf('==', start + 2)
  if (end === -1 || end === start + 2) return false // no empty highlights
  if (!silent) {
    const max = state.posMax
    state.push('highlight_open', 'mark', 1).meta = { color: null }
    state.pos = start + 2
    state.posMax = end
    state.md.inline.tokenize(state)
    state.pos = end
    state.posMax = max
    state.push('highlight_close', 'mark', -1)
  }
  state.pos = end + 2
  return true
}

const MARK_OPEN_RE = /^<mark class="hl-(\w+)">/
function highlightColorRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  const openMatch = MARK_OPEN_RE.exec(state.src.slice(start))
  if (!openMatch) return false
  const closeIdx = state.src.indexOf('</mark>', start + openMatch[0].length)
  if (closeIdx === -1) return false
  if (!silent) {
    const max = state.posMax
    state.push('highlight_open', 'mark', 1).meta = { color: openMatch[1] }
    state.pos = start + openMatch[0].length
    state.posMax = closeIdx
    state.md.inline.tokenize(state)
    state.pos = closeIdx
    state.posMax = max
    state.push('highlight_close', 'mark', -1)
  }
  state.pos = closeIdx + '</mark>'.length
  return true
}

md.inline.ruler.before('emphasis', 'highlight_color', highlightColorRule)
md.inline.ruler.before('emphasis', 'highlight_plain', highlightPlainRule)

// ─── Underline: <u>text</u> ─────────────────────────────────────────────────
// There's no native markdown syntax for underline, so serializer.ts writes
// the `underline` mark as literal `<u>...</u>` HTML (the only sane choice) —
// but with `html: false` that HTML was never readable back on parse: nothing
// mapped it to a token, so it round-tripped as escaped, visibly-broken
// `&lt;u&gt;...&lt;/u&gt;` text instead of underlined text every time a note
// with underlined text was reopened. Same narrowly-scoped custom-tag
// approach as highlightColorRule above, not general `html: true`.
function underlineRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  if (state.src.slice(start, start + 3) !== '<u>') return false
  const end = state.src.indexOf('</u>', start + 3)
  if (end === -1 || end === start + 3) return false
  if (!silent) {
    const max = state.posMax
    state.push('u_open', 'u', 1)
    state.pos = start + 3
    state.posMax = end
    state.md.inline.tokenize(state)
    state.pos = end
    state.posMax = max
    state.push('u_close', 'u', -1)
  }
  state.pos = end + 4
  return true
}

md.inline.ruler.before('emphasis', 'underline', underlineRule)

// ─── Widen the data: image whitelist to include SVG ────────────────────────
// markdown-it's built-in `validateLink` (used for both links and image `src`)
// rejects `javascript:`/`vbscript:`/`file:`/`data:` outright, then re-allows
// `data:` only for a short image-MIME whitelist — gif/png/jpeg/webp. It does
// NOT include `image/svg+xml`, so any SVG pasted/dropped/inserted through
// this app's own image-insert path (imageInsert.ts, pastePlugin.ts — both
// accept any `image/*`) gets its src silently reset to `""` the very next
// time the note is re-parsed (reopening it, switching tabs, vault export/
// reimport round trip) — the image just vanishes with no error. This
// re-implements the same shape (still rejecting the dangerous protocols
// exactly as strictly as the default), only widening the data-URL image
// whitelist to also accept `image/svg+xml` and the `image/jpg` alias some
// tools/OSes emit instead of the canonical `image/jpeg`.
const BAD_PROTO_RE = /^(vbscript|javascript|file|data):/
const GOOD_DATA_RE = /^data:image\/(gif|png|jpe?g|webp|svg\+xml);/
md.validateLink = (url: string): boolean => {
  const str = url.trim().toLowerCase()
  return BAD_PROTO_RE.test(str) ? GOOD_DATA_RE.test(str) : true
}

export { TASK_RE }
