import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import { findVerseRefMatches } from '@/lib/noteTextBlocks'
import { STRONGS_REF_RE } from '@/lib/notePreviewRender'
import { parseRef, getTranslationForBook, bookName } from '@/lib/parseRef'

/**
 * Berean Chat's markdown pipeline: message text → a small, cached node tree that ChatMarkdown
 * turns into React elements (never HTML strings).
 *
 * A chat-local markdown-it rather than the notes editor's `md` (notes/pm/markdownIt.ts): that one
 * also parses [[wikilinks]], `<mark class="hl-…">` and SVG data: images for the editor, none of
 * which a chat message should act on. Same core options (default preset → GFM tables, html off,
 * `breaks: true` — one newline is one line, as every chat message has always been shown), plus
 * the two notes-editor inline rules a copied note relies on: `<u>underline</u>` and `==highlight==`.
 * Link safety is decided when rendering (http(s)/mailto only), so an unsafe link shows as its
 * plain text instead of literal `[x](…)` source.
 */

// No indented code blocks or setext ("text\n---") headings: in chat (and in older plain-text
// messages) leading spaces and a line of dashes are just typing, not structure. Fences and "# "
// headings — what the composer writes — still work.
export const chatMd = MarkdownIt('default', { html: false, breaks: true, linkify: true }).disable(['code', 'lheading'])
// Bare links only with an explicit scheme ("https://…", "mailto:…") — never "example.com" or a
// bare email, which would light up ordinary prose.
chatMd.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })
chatMd.validateLink = () => true

function wrapRule(open: string, close: string, type: string, tag: string) {
  return (state: StateInline, silent: boolean): boolean => {
    const start = state.pos
    if (state.src.slice(start, start + open.length) !== open) return false
    const end = state.src.indexOf(close, start + open.length)
    if (end === -1 || end === start + open.length) return false
    if (!silent) {
      const max = state.posMax
      state.push(`${type}_open`, tag, 1)
      state.pos = start + open.length
      state.posMax = end
      state.md.inline.tokenize(state)
      state.pos = end
      state.posMax = max
      state.push(`${type}_close`, tag, -1)
    }
    state.pos = end + close.length
    return true
  }
}
chatMd.inline.ruler.before('emphasis', 'underline', wrapRule('<u>', '</u>', 'u', 'u'))
chatMd.inline.ruler.before('emphasis', 'highlight', wrapRule('==', '==', 'mark', 'mark'))

// `- [ ] task` / `- [x] done` → a read-only check on the list item (markdown-it has no task lists).
const TASK_RE = /^\[([ xX])\]\s+/
chatMd.core.ruler.push('chat_task_list', (state: StateCore) => {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open') continue
    const inline = tokens[i + 2]
    if (!inline || inline.type !== 'inline') continue
    const m = TASK_RE.exec(inline.content)
    if (!m) continue
    tokens[i].meta = { ...(tokens[i].meta || {}), task: true, checked: m[1].toLowerCase() === 'x' }
    inline.content = inline.content.slice(m[0].length)
    const first = inline.children?.[0]
    if (first?.type === 'text') first.content = first.content.replace(TASK_RE, '')
  }
})

// ─── Verse references + Strong's numbers in plain text ──────────────────────────────────────

export interface VerseRefResult {
  textId: string; bookId: string; bookName: string; chapter: number; verse: number; endVerse?: number
  text: string; source: 'keyword'
}
export type TextSeg =
  | { kind: 'text'; text: string }
  | { kind: 'verse'; text: string; result: VerseRefResult }
  | { kind: 'strongs'; text: string; num: string }

function refResult(refText: string, lxx: boolean): VerseRefResult | null {
  const p = parseRef(refText)
  if (!p) return null
  const textId = lxx ? 'lxx' : (getTranslationForBook(p.bookId) ?? 'kjva')
  return { textId, bookId: p.bookId, bookName: bookName(p.bookId), chapter: p.chapter, verse: p.verse ?? 1, endVerse: p.endVerse, text: '', source: 'keyword' }
}

/** Book "names" that are everyday English words — without a chapter:verse they are prose
 *  ("I am 3 years", "Is 1 enough?", "my ex 2 years ago", "Song 2 is on repeat"). */
const CHAT_ENGLISH_BOOKS = new Set([
  'is', 'am', 're', 'her', 'ho', 'la', 'le', 'ex', 'ep', 'sir', 'bar', 'hag', 'gad', 'mic', 'nah',
  'rev', 'jam', 'joe', 'col', 'num', 'sol', 'mal', 'amo', 'song', 'at',
])
/** Full book names that are also common words — linked bare only when written capitalised. */
const CHAT_WORD_BOOKS = new Set(['mark', 'job', 'acts', 'numbers', 'judges', 'kings', 'ruth', 'wisdom', 'lamentations'])

/**
 * Chat is conversational prose, so it is stricter than the notes editor's matcher
 * (findVerseRefMatches): a reference WITHOUT chapter:verse needs a real book name — not an
 * English word ("is 1", "Song 2"), and when lowercase not a short abbreviation or word-book
 * ("mark 4 times"). Anything with a colon ("Song 2:4", "is 5:1") is unambiguous.
 */
export function acceptChatRef(label: string, refText: string): boolean {
  if (/\d\s*:\s*\d/.test(refText)) return true
  const book = refText.replace(/\s+LXX$/i, '').replace(/\s+\d[\s\S]*$/, '').trim()
  const single = !/\s/.test(book)
  const last = (book.split(/\s+/).pop() ?? '').toLowerCase().replace(/\.$/, '')
  if (single && CHAT_ENGLISH_BOOKS.has(last)) return false
  if (/^[a-z]/.test(label) && single && (CHAT_WORD_BOOKS.has(last) || last.length < 5)) return false
  return true
}

/** Plain text → text / verse-ref / Strong's segments. */
export function linkifyRefs(text: string): TextSeg[] {
  type Hit = { index: number; length: number; seg: TextSeg }
  const hits: Hit[] = []
  for (const m of findVerseRefMatches(text)) {
    const label = text.slice(m.index, m.index + m.length)
    if (!acceptChatRef(label, m.refText)) continue
    const result = refResult(m.refText, m.lxx)
    if (!result) continue
    hits.push({ index: m.index, length: m.length, seg: { kind: 'verse', text: label, result } })
  }
  STRONGS_REF_RE.lastIndex = 0
  let s: RegExpExecArray | null
  while ((s = STRONGS_REF_RE.exec(text)) !== null) {
    const at = s.index, num = s[1]
    if (hits.some((h) => at < h.index + h.length && at + num.length > h.index)) continue
    hits.push({ index: at, length: num.length, seg: { kind: 'strongs', text: num, num } })
  }
  if (!hits.length) return [{ kind: 'text', text }]
  hits.sort((a, b) => a.index - b.index)
  const out: TextSeg[] = []
  let pos = 0
  for (const h of hits) {
    if (h.index < pos) continue
    if (h.index > pos) out.push({ kind: 'text', text: text.slice(pos, h.index) })
    out.push(h.seg)
    pos = h.index + h.length
  }
  if (pos < text.length) out.push({ kind: 'text', text: text.slice(pos) })
  return out
}

// ─── Link safety ─────────────────────────────────────────────────────────────────────────────

/** Only web and mail links open; everything else (javascript:, data:, file:, vbscript:, relative,
 *  protocol-relative, app schemes) renders as plain text. */
export function safeHref(href: string | undefined): string | null {
  const h = (href ?? '').trim()
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null
}

// ─── Streaming tolerance ─────────────────────────────────────────────────────────────────────

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/**
 * A partial (still-streaming) answer, made displayable: an unclosed ``` fence is closed and a
 * dangling `**` / `*` / `` ` `` at the end is dropped, so half-written syntax never flashes raw.
 * Display only — the stored text is untouched.
 */
export function prepareStreamingMarkdown(text: string): string {
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const m = FENCE_RE.exec(line)
    if (!m) continue
    if (fence === null) fence = m[1]
    else if (m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
  }
  if (fence !== null) return `${text}\n${fence}`
  const blockStart = text.lastIndexOf('\n\n') + 1
  let head = text.slice(0, blockStart)
  let block = text.slice(blockStart)
  const dropLast = (s: string, token: string) => {
    const i = s.lastIndexOf(token)
    return i < 0 ? s : s.slice(0, i) + s.slice(i + token.length)
  }
  if ((block.match(/`/g) ?? []).length % 2 === 1) block = dropLast(block, '`')
  if ((block.match(/\*\*/g) ?? []).length % 2 === 1) block = dropLast(block, '**')
  // Lone `*` (italic), not counting list markers ("* item") or the pairs handled above.
  const lone = block.replace(/^\s*\*\s/gm, '').replace(/\*\*/g, '')
  if ((lone.match(/\*/g) ?? []).length % 2 === 1) {
    const i = block.search(/\*(?!\*)[^*]*$/)
    if (i >= 0 && !/^\s*$/.test(block.slice(block.lastIndexOf('\n', i) + 1, i))) block = block.slice(0, i) + block.slice(i + 1)
  }
  head += block
  return head
}

// ─── Token stream → node tree (cached) ───────────────────────────────────────────────────────

export interface MdNode {
  type: string
  tag: string
  attrs: Record<string, string>
  content: string
  info: string
  hidden: boolean
  meta?: { task?: boolean; checked?: boolean }
  children: MdNode[]
  /** Text nodes outside links: the text split into verse / Strong's links. */
  segs?: TextSeg[]
}

function toTree(tokens: Token[]): MdNode[] {
  const root: MdNode[] = []
  const stack: MdNode[][] = [root]
  for (const t of tokens) {
    const top = stack[stack.length - 1]
    if (t.nesting === -1) { stack.pop(); continue }
    const node: MdNode = {
      type: t.nesting === 1 ? t.type.replace(/_open$/, '') : t.type,
      tag: t.tag,
      attrs: Object.fromEntries(t.attrs ?? []),
      content: t.content,
      info: t.info,
      hidden: t.hidden,
      meta: t.meta ?? undefined,
      children: t.children ? toTree(t.children) : [],
    }
    if (t.type === 'image') node.content = t.content || (t.children ?? []).map((c) => c.content).join('')
    top.push(node)
    if (t.nesting === 1) stack.push(node.children)
  }
  return root
}

function annotate(nodes: MdNode[], inLink: boolean): void {
  for (const n of nodes) {
    if (n.type === 'text' && !inLink) n.segs = linkifyRefs(n.content)
    else if (n.children.length) annotate(n.children, inLink || n.type === 'link')
  }
}

const CACHE_MAX = 200
const cache = new Map<string, MdNode[]>()

/** Legacy chat bullets ("• item") become markdown list items; code fences are left alone. */
function normalizeLegacy(text: string): string {
  if (!text.includes('•')) return text
  let inFence = false
  return text.split('\n').map((line) => {
    if (FENCE_RE.test(line)) inFence = !inFence
    return inFence ? line : line.replace(/^(\s*)•\s+/, '$1- ')
  }).join('\n')
}

/** Parse (memoized, LRU) message markdown into the node tree ChatMarkdown renders. */
export function parseChatMarkdown(text: string, streaming = false): MdNode[] {
  const key = (streaming ? '1' : '0') + text
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return hit }
  const src = normalizeLegacy(streaming ? prepareStreamingMarkdown(text) : text)
  const tree = toTree(chatMd.parse(src, {}))
  annotate(tree, false)
  cache.set(key, tree)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return tree
}
