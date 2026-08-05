// Markdown → HTML preview/print rendering pipeline for notes.
//
// Extracted from the legacy CodeMirror 6 note editor (NoteEditor.tsx), which
// was fully superseded by the ProseMirror editor (src/components/notes/pm/)
// but couldn't be deleted outright because it also housed this CM6-free
// rendering pipeline — used by the Presenter/Viewer window, print/PDF export,
// the daily continuous-scroll view, and version history. This module is that
// pipeline on its own, with zero CodeMirror dependency.
import { marked } from 'marked'
import pmEditorCss from '@/components/notes/pm/pmEditor.css?raw'
import { renderMarkdownToHTML } from '@/components/notes/pm/staticRender'
import { parseRef, AMBIGUOUS_PATTERNS, isExactBookToken } from '@/lib/parseRef'
import { useAppStore } from '@/store'

// Configure marked for safe HTML output — gfm:true enables GitHub-Flavored Markdown tables
marked.setOptions({ breaks: true, gfm: true })

// Disable setext headings so a line of text directly above "---" (or "===") is NOT
// turned into a heading. "---" should always render as a horizontal-rule divider.
marked.use({ tokenizer: { lheading() { return undefined } } })

// ─── Verse block detector ─────────────────────────────────────────────────────
// When enabled in Notes settings, a verse reference + its text is *visually*
// formatted (styled left border, bold reference) WITHOUT changing the underlying
// text. The text stays plain — copying copies the plain text only, exactly like
// how an inline verse reference is decorated. See buildLiveDecorations.
//
// Recognised patterns (the reference must be verse-level, i.e. contain ":"):
//   A) Multi-line: "Luke 16:29-31\n29 text\n30 text\n31 text"
//   B) Single-line: "1 John 2:4 He that saith…"
//
// NOT triggered: a bare reference like "Luke 16:29-31" (no verse text follows).

// Single-line "Book c:v rest" — verse-level ref (colon) then text.
// Book name may be 1–3 words ("Song of Songs", "Testament of Levi", "1 John").
// Optional ", Book N" subdivision (+ optional comma before chapter:verse) for multi-book
// editions like Recognitions of Clement — kept in sync with noteTextBlocks.ts's copy of
// this same regex (this file, still used for print/export/version-history rendering,
// duplicates rather than imports it — see that file's comment for the full "the app
// generates this exact comma'd shape via bookChapterVerseLabel" round-trip-bug reasoning).
// Each book-name word may also carry a trailing comma (Hermas's bookName() label is
// "Hermas, Similitudes" etc. — see noteTextBlocks.ts's copy of this regex for the full
// reasoning) — kept in sync with that copy.
export const SINGLE_VERSE_LINE_RE =
  /^(\s*)((?:[1-3][ \t]+)?[A-Za-z][a-z]+,?(?:[ \t]+[A-Za-z][a-z]+,?){0,2}(?:,?[ \t]+Book[ \t]+\d{1,3})?,?[ \t]+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?)[ \t]+(\S.*)$/
// A body line in a multi-line block: starts with a verse number then text.
export const VERSE_BODY_LINE_RE = /^\s*\d{1,3}[ \t]+\S/

/**
 * For a single-line block "Book c:v <body>", if the body begins with an "LXX " marker
 * (as produced when copying a Septuagint verse), fold it into the reference label and
 * return the cleaned body. e.g. ("Isaiah 9:12", "LXX But the people…") →
 * { refLabel: "Isaiah 9:12 LXX", body: "But the people…", lxx: true }.
 */
export function splitLeadingLxx(refStr: string, body: string): { refLabel: string; body: string; lxx: boolean } {
  const m = body.match(/^LXX[ \t]+(\S.*)$/i)
  if (m) return { refLabel: `${refStr} LXX`, body: m[1], lxx: true }
  return { refLabel: refStr, body, lxx: false }
}

export interface VerseBlockMatch {
  kind: 'multi' | 'single'
  ref: string         // the reference text, e.g. "Luke 16:29-31"
  refLength: number   // character length of `ref`
  lineCount: number   // total lines in the block (1 for single; ref + verses for multi)
}

export function detectVerseBlock(text: string): VerseBlockMatch | null {
  if (!text.trim()) return null
  const nonEmpty = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  if (nonEmpty.length === 0) return null

  // A) Multi-line: first line is a verse-level ref, following lines are numbered verses
  if (nonEmpty.length >= 2) {
    const refLine = nonEmpty[0].trim()
    if (refLine.includes(':') && parseRef(refLine)) {
      const body = nonEmpty.slice(1)
      if (body.every(l => VERSE_BODY_LINE_RE.test(l))) {
        return { kind: 'multi', ref: refLine, refLength: refLine.length, lineCount: nonEmpty.length }
      }
    }
  }

  // B) Single-line: "Book c:v verse text…"
  const m = SINGLE_VERSE_LINE_RE.exec(nonEmpty[0])
  if (m && parseRef(m[2].trim())) {
    return { kind: 'single', ref: m[2].trim(), refLength: m[2].trim().length, lineCount: 1 }
  }

  return null
}

// ─── Inline verse-reference finder ────────────────────────────────────────────
// Finds EVERY verse reference in a string, so a single line can contain any
// number of references (e.g. "Romans 10:1-2 vs Deuteronomy 18:15-19").
//
// Book names can be 1–3 words ("Song of Songs", "1 John"). The broad regex may
// greedily grab a leading non-book word ("vs Deuteronomy"); we recover by retrying
// parseRef on progressively shorter suffixes until one parses, then adjust the
// match start so only the real reference is decorated.
// Kept in sync with noteTextBlocks.ts's copy of this regex (this file, still used for
// print/export/version-history rendering, duplicates rather than imports it) — that copy
// gained "Book N" subdivision support (multi-book editions like Recognitions of Clement)
// plus the optional comma before chapter:verse that the app's own generated text
// ("Recognitions, Book 1, 1:3") needs; this one had drifted and had neither at all.
// Each ordinary book-name word may also carry a trailing comma (Hermas's bookName() label)
// — see noteTextBlocks.ts's copy of this regex for the full reasoning; kept in sync.
const VERSE_REF_SCAN_RE =
  /((?:[1-3][ \t]+)?(?:(?!Book[ \t]+\d)[A-Za-z][a-z]*\.?,?[ \t]+){0,2}(?!Book[ \t]+\d)[A-Za-z][a-z]+\d*\.?,?)(?:,?[ \t]*(Book[ \t]+\d{1,3}))?,?[ \t]+(\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?)([ \t]+LXX\b)?/gi

export interface VerseRefMatch {
  index: number      // start offset of the recognised reference within `text`
  length: number     // length of the matched reference (incl. LXX suffix)
  refText: string    // the parseable reference, e.g. "Deuteronomy 18:15-19"
  lxx: boolean       // whether a trailing " LXX" suffix was present
}

export function findVerseRefMatches(text: string): VerseRefMatch[] {
  const out: VerseRefMatch[] = []
  VERSE_REF_SCAN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = VERSE_REF_SCAN_RE.exec(text)) !== null) {
    const bookPhrase = m[1]
    const bookSub = m[2]
    const numPart = m[3]
    const lxx = !!m[4]
    const words = bookPhrase.split(/[ \t]+/).filter(Boolean)
    // Precompute each word's offset within bookPhrase
    const wordStarts: number[] = []
    let search = 0
    for (const w of words) {
      const i = bookPhrase.indexOf(w, search)
      wordStarts.push(i)
      search = i + w.length
    }
    // Try the full phrase, then drop leading words until parseRef succeeds.
    let matched = false
    for (let start = 0; start < words.length; start++) {
      const candidateRef = words.slice(start).join(' ') + (bookSub ? ' ' + bookSub : '') + ' ' + numPart
      if (parseRef(candidateRef)) {
        // ── Ambiguous-pattern guard ────────────────────────────────────────────
        // If the last word of the book portion is a common English word/abbrev
        // that also matches a Bible book (e.g. "is", "col", "her", "job", "re"),
        // require the book token to be capitalised in the source text OR the ref
        // to include a chapter:verse colon — otherwise skip this start position
        // and keep trying with the next word dropped. This prevents false links
        // on phrases like "is 99% fulfilled" or "her 3 children".
        const bookWords = words.slice(start)
        const lastBookWord = bookWords[bookWords.length - 1].toLowerCase().replace(/\.$/, '')
        const fullBookPhrase = bookWords.join(' ')
        if (AMBIGUOUS_PATTERNS.has(lastBookWord) || !isExactBookToken(fullBookPhrase)) {
          const hasColon = numPart.includes(':')
          const firstCharOfBook = bookPhrase[wordStarts[start]] ?? ''
          const isCapitalised = /[A-Z]/.test(firstCharOfBook)
          if (!hasColon && !isCapitalised) continue
        }
        const refStart = m.index + wordStarts[start]
        const fullEnd = m.index + m[0].length
        out.push({ index: refStart, length: fullEnd - refStart, refText: candidateRef, lxx })
        matched = true
        break
      }
    }
    // If nothing parsed, the regex may have swallowed a digit that actually
    // belongs to a following numbered book, e.g. "vs 1 Samuel 2:2" matches
    // "vs 1" and eats the "1". Rewind lastIndex to just past the first word so
    // the numbered book ("1 Samuel 2:2") gets a fresh chance to match.
    if (!matched && words.length > 0) {
      const rewind = m.index + wordStarts[0] + words[0].length
      if (rewind > m.index) VERSE_REF_SCAN_RE.lastIndex = rewind
    }
  }
  return out
}

// ─── Verse-text match ratio (for the "actually contains the verse text" check) ──
// Returns the fraction (0..1) of candidate words that appear in the actual verse
// text (multiset overlap). Used to avoid formatting a line where the user is just
// commenting on a verse (e.g. "Genesis 5:4 my thoughts here").
export function verseTextMatchRatio(candidate: string, actual: string): number {
  // Normalise to word tokens. Drop Strong's-number tokens (h1234 / g3056) that
  // leak in when the source verse text is tagged (e.g. "word{H1234}"); otherwise
  // a tagged verse would have ~2× the word count and even an exact paste would
  // score far below the threshold.
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w && !/^[hg]\d+$/.test(w))
  const cand = norm(candidate)
  const act = norm(actual)
  if (cand.length === 0) return 0
  const counts = new Map<string, number>()
  for (const w of act) counts.set(w, (counts.get(w) ?? 0) + 1)
  let hit = 0
  for (const w of cand) {
    const c = counts.get(w) ?? 0
    if (c > 0) { hit++; counts.set(w, c - 1) }
  }
  return hit / cand.length
}

// Cache of verse-text match ratios, keyed by (ref + candidate text). Populated
// by consumers that resolve verse text asynchronously; verseTextAcceptedSync
// below only reads from it, defaulting to "accept" on a cache miss.
const verseRatioCache = new Map<string, number>()

function verseCacheKey(refText: string, candidate: string): string {
  return refText + ' ' + candidate.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Strip an LXX marker (trailing " LXX" suffix or leading "lxx:"/"LXX:" prefix) from a
 * reference string. Returns the bare reference for parseRef plus whether LXX was present.
 */
export function stripLxxMarker(refText: string): { ref: string; lxx: boolean } {
  const suffix = refText.match(/^(.*?)[ \t]+LXX\s*$/i)
  if (suffix) return { ref: suffix[1].trim(), lxx: true }
  const prefix = refText.match(/^(?:lxx|LXX):\s*(.*)$/)
  if (prefix) return { ref: prefix[1].trim(), lxx: true }
  return { ref: refText, lxx: false }
}

// Synchronous variant for preview/print — reads cache, falls back to structural.
export function verseTextAcceptedSync(refText: string, candidate: string, threshold: number): boolean {
  const key = verseCacheKey(refText, candidate)
  if (verseRatioCache.has(key)) return verseRatioCache.get(key)! >= threshold
  return true
}

// ─── Preview helpers (exported so YouTubeTab can reuse them) ───────────────────

export function addVerseLinksToHtml(html: string): string {
  // Uses findVerseRefMatches so a single text node can contain any number of
  // references (e.g. "Romans 10:1-2 vs Deuteronomy 18:15-19"). Skips content
  // inside <a>/<code>/<pre> so existing links and code aren't re-wrapped.
  let inSkip = 0
  return html.replace(/(<\/?(?:a|code|pre)[^>]*>)|([^<>]+)/gi, (match, tag, text) => {
    if (tag) {
      const lower = tag.toLowerCase()
      if (/^<(a|code|pre)[\s>]/.test(lower)) inSkip++
      else if (/^<\/(a|code|pre)>/.test(lower)) inSkip = Math.max(0, inSkip - 1)
      return tag
    }
    if (inSkip > 0 || !text) return text ?? match
    const matches = findVerseRefMatches(text)
    if (matches.length === 0) return text
    let result = ''
    let pos = 0
    for (const ma of matches) {
      result += text.slice(pos, ma.index)
      const seg = text.slice(ma.index, ma.index + ma.length)
      result += ma.lxx
        ? `<a href="#lxx-verse-ref-${encodeURIComponent(ma.refText)}" class="berean-verse-ref berean-lxx-ref">${seg}</a>`
        : `<a href="#verse-ref-${encodeURIComponent(ma.refText)}" class="berean-verse-ref">${seg}</a>`
      pos = ma.index + ma.length
    }
    result += text.slice(pos)
    return result
  })
}

// Callout metadata for > [!TYPE] blocks
export const CALLOUT_META: Record<string, { icon: string; label: string; bg: string; border: string; color: string }> = {
  NOTE:      { icon: 'ℹ', label: 'Note',      bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.6)',  color: '#60a5fa' },
  TIP:       { icon: '💡', label: 'Tip',       bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.6)',   color: '#4ade80' },
  WARNING:   { icon: '⚠', label: 'Warning',   bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.6)',  color: '#fbbf24' },
  IMPORTANT: { icon: '★', label: 'Important', bg: 'rgba(168,85,247,0.08)',  border: 'rgba(168,85,247,0.6)',  color: '#c084fc' },
  CAUTION:   { icon: '✕', label: 'Caution',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.6)',   color: '#f87171' },
}

// Escape HTML special chars for safe inclusion in generated markup.
function escapeHtmlBasic(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Wrap detected verse blocks in styled HTML divs so the "view"/preview and the
// printed/PDF output show the same scripture-block styling as the editor. Gated
// on the noteScriptureBlock setting and the verse-text match threshold.
// Detects a lexicon block header line (defined here so buildLiveDecorations can use it)
export const LEXICON_BLOCK_HEADER_RE = /^([HG]\d{1,5})\s+\S/

const VERSE_BLOCK_STYLE = 'border-left:3px solid rgb(99,102,241);background:rgba(100,116,139,0.08);padding:6px 12px;border-radius:8px;margin:8px 0'
const VERSE_BLOCK_REF_STYLE = 'font-weight:700'

/**
 * Render a verse-body line: strip nothing, but run inline markdown so **bold**,
 * *italic*, <u>underline</u>, ==highlight== etc. inside scripture blocks are
 * formatted instead of showing raw markers. marked.parseInline passes raw HTML
 * (like <u>) through and renders markdown emphasis correctly.
 */
function renderVerseBodyLine(line: string): string {
  // Convert ==highlight== first (marked doesn't know it), then inline-render.
  const withMarks = line.replace(/==([^=\n]+?)==/g, '<mark style="background:rgba(234,179,8,0.38);border-radius:2px;padding:0 1px">$1</mark>')
  return marked.parseInline(withMarks) as string
}

/**
 * Wrap detected verse blocks into styled HTML.
 *
 * @param stash  Optional callback. When provided, each emitted block is handed to
 *   stash() which returns a placeholder token; this keeps the raw HTML out of the
 *   markdown string so marked() can't absorb following headings/paragraphs into it.
 *   When omitted (standalone/legacy calls), blocks are emitted inline, padded with
 *   blank lines so marked treats each as an isolated HTML block.
 */
export function wrapVerseBlocksForPreview(content: string, stash?: (html: string) => string): string {
  const st = (typeof useAppStore?.getState === 'function') ? useAppStore.getState() : null
  if (!st?.noteScriptureBlock) return content
  const threshold = st.noteScriptureBlockThreshold ?? 0.9
  const lines = content.split('\n')
  const out: string[] = []
  const emit = (blockHtml: string) => {
    if (stash) { out.push(stash(blockHtml)); return }
    // Pad with blank lines so marked isolates this HTML block (prevents the next
    // heading/paragraph from being swallowed into the raw-HTML block).
    out.push('', blockHtml, '')
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    // A) Multi-line block (ref line may carry an " LXX" marker)
    if (trimmed.includes(':') && parseRef(stripLxxMarker(trimmed).ref) &&
        i + 1 < lines.length && VERSE_BODY_LINE_RE.test(lines[i + 1])) {
      let j = i + 1
      while (j + 1 < lines.length && VERSE_BODY_LINE_RE.test(lines[j + 1])) j++
      const bodyLines = lines.slice(i + 1, j + 1)
      const candidate = bodyLines.map(l => l.replace(/^\s*\d{1,3}[ \t]+/, '')).join(' ')
      if (verseTextAcceptedSync(trimmed, candidate, threshold)) {
        const ref = `<a href="#verse-ref-${encodeURIComponent(trimmed)}" class="berean-verse-ref" style="${VERSE_BLOCK_REF_STYLE}">${escapeHtmlBasic(trimmed)}</a>`
        const body = bodyLines.map(l => renderVerseBodyLine(l)).join('<br>')
        emit(`<div class="berean-verse-block" style="${VERSE_BLOCK_STYLE}"><div>${ref}</div>${body}</div>`)
        i = j + 1
        continue
      }
    }
    // B) Single-line block ("Book c:v <text>" or "Book c:v LXX <text>")
    const m = SINGLE_VERSE_LINE_RE.exec(line)
    if (m) {
      const { refLabel, body } = splitLeadingLxx(m[2], m[3])
      if (parseRef(stripLxxMarker(refLabel).ref) && verseTextAcceptedSync(refLabel, body, threshold)) {
        const ref = `<a href="#verse-ref-${encodeURIComponent(refLabel)}" class="berean-verse-ref" style="${VERSE_BLOCK_REF_STYLE}">${escapeHtmlBasic(refLabel)}</a>`
        emit(`<div class="berean-verse-block" style="${VERSE_BLOCK_STYLE}">${ref} ${renderVerseBodyLine(body)}</div>`)
        i++
        continue
      }
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

// Regex matching standalone Strong's numbers — H or G followed by 1–5 digits,
// surrounded by word boundaries (not embedded mid-word).
export const STRONGS_REF_RE = /(?<![A-Za-z])([HG]\d{1,5})(?![A-Za-z0-9])/g

// Inline style for a Strong's reference in preview / print HTML — matches the
// note editor's cm-live-lexicon-ref color but without the box (no background/border).
const STRONGS_CHIP_STYLE =
  'font-family:monospace;font-size:1em;font-weight:700;color:rgb(99,102,241)'

/** Replace inline Strong's numbers (H1234 / G5678) with styled chips for preview & print. */
export function wrapStrongsRefsForPreview(content: string): string {
  return content.replace(STRONGS_REF_RE, (_, num: string) =>
    `<span class="berean-strongs-chip" style="${STRONGS_CHIP_STYLE}" title="Strong's ${num}">${num}</span>`)
}

// Detects a lexicon block header line: starts with H/G number then at least one
// non-digit/non-space character (the lemma or transliteration). Semicolon optional
// so blocks without pronunciation data still render correctly.
const LEXICON_BLOCK_STYLE =
  'border-left:3px solid rgb(99,102,241);background:rgba(100,116,139,0.08);' +
  'padding:6px 12px;border-radius:8px;margin:8px 0'

const LEXICON_BLOCK_DEF_STYLE =
  'font-size:0.9em;margin-top:4px;padding-left:0.8em'

/**
 * Detect two-line lexicon blocks in notes (pasted from the copy button):
 *   G5485 χάρις cháris, khar'-ece;
 *   from G5463; graciousness (as gratifying)...
 *
 * Renders them as a styled block where the definition line is visually indented.
 * Stashes the HTML so marked doesn't interfere.
 */
export function wrapLexiconBlocksForPreview(content: string, stash?: (html: string) => string): string {
  const lines = content.split('\n')
  const out: string[] = []
  const emit = (html: string) => {
    if (stash) { out.push(stash(html)); return }
    out.push('', html, '')
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (LEXICON_BLOCK_HEADER_RE.test(line.trim()) && i + 1 < lines.length) {
      const defLine = lines[i + 1]
      if (defLine.trim().length > 0 && !defLine.trim().startsWith('#')) {
        // Strong's numbers in the header and definition lines will be colored by
        // wrapStrongsRefsForPreview after the stash is restored — no extra span needed.
        const block =
          `<div class="berean-lexicon-block" style="${LEXICON_BLOCK_STYLE}">` +
          `<div style="font-size:1em;font-weight:600">${escapeHtmlBasic(line.trim())}</div>` +
          `<div class="berean-lexicon-def" style="${LEXICON_BLOCK_DEF_STYLE}">${escapeHtmlBasic(defLine.trim())}</div>` +
          `</div>`
        emit(block)
        i += 2
        continue
      }
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

export function renderPreviewContent(content: string): string {
  // ── Stash mechanism ───────────────────────────────────────────────────────
  // Complex HTML blocks (verse blocks, callouts) are pre-rendered to final HTML
  // and replaced with an inert alphanumeric placeholder token BEFORE marked runs.
  // This prevents two classes of bug:
  //   1. marked HTML-escaping / mangling the raw HTML we emit.
  //   2. marked's HTML-block rule absorbing following headings/paragraphs into the
  //      raw <div> (which made "# Abraham" render as literal text in PDFs).
  // After marked finishes, the placeholders are swapped back for the real HTML.
  const stashed: string[] = []
  const stash = (htmlBlock: string): string => {
    const token = `BEREANSTASHBLOCK${stashed.length}ENDSTASH`
    stashed.push(htmlBlock)
    // Surround with blank lines so marked treats the token as its own paragraph.
    return `\n\n${token}\n\n`
  }

  // Wrap verse blocks first (when enabled). Bodies are inline-markdown-rendered
  // Lexicon blocks (pasted from copy button) are stashed before verse blocks
  // so their Strong's number chips don't get double-processed.
  content = wrapLexiconBlocksForPreview(content, stash)

  // inside wrapVerseBlocksForPreview; the whole block is stashed.
  content = wrapVerseBlocksForPreview(content, stash)

  // Normalise blank lines hugging a stash token to exactly one on each side, so the
  // <br>-spacing step below doesn't add spurious <br> runs around scripture blocks.
  content = content.replace(/\n{2,}(BEREANSTASHBLOCK\d+ENDSTASH)\n{2,}/g, '\n\n$1\n\n')

  // Preserve intentional extra blank lines as explicit <br> elements.
  const withSpacing = content.replace(/\n(\n{2,})/g, (_, extra: string) => {
    const count = extra.length - 1
    return '\n\n' + Array(count).fill('<br>').join('\n\n') + '\n\n'
  })
  // Convert [[Note Title]] to markdown links
  let processed = withSpacing.replace(/\[\[([^\]\n]+?)\]\]/g, (_, title) => `[${title}](#note-${title.replace(/\s+/g, '-').toLowerCase()})`)
  // ==highlight== → <mark>
  processed = processed.replace(/==([^=\n]+?)==/g, '<mark style="background:rgba(234,179,8,0.38);border-radius:2px;padding:0 1px">$1</mark>')
  // Callout boxes: > [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT], > [!CAUTION]
  // Stashed so marked can't absorb following content into the raw <div>.
  processed = processed.replace(
    /^> \[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]([^\n]*)\n((?:> ?[^\n]*(?:\n|$))*)/gim,
    (_, type: string, titleExtra: string, body: string) => {
      const key = type.toUpperCase()
      const meta = CALLOUT_META[key] ?? CALLOUT_META.NOTE
      const customTitle = titleExtra.trim()
      const title = customTitle || meta.label
      const bodyLines = body
        .split('\n')
        .map(l => l.replace(/^> ?/, ''))
        .join('\n')
        .trim()
      // Render body markdown (bold, italic, links, lists, etc.)
      const bodyHtml = bodyLines ? marked.parse(bodyLines) as string : ''
      const calloutHtml =
        `<div style="border-left:3px solid ${meta.border};background:${meta.bg};border-radius:0 6px 6px 0;` +
        `padding:10px 14px;margin:12px 0">` +
        `<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;` +
        `color:${meta.color};margin-bottom:5px;display:flex;align-items:center;gap:5px">${meta.icon} ${title}</div>` +
        `<div style="font-size:0.875rem">${bodyHtml}</div>` +
        `</div>`
      return stash(calloutHtml)
    }
  )
  // Task lists — convert consecutive - [ ] and - [x] lines into a proper <ul>.
  // Group contiguous task-list lines so they share one <ul> wrapper (browsers need
  // the wrapper to render list-item bullets / indentation correctly in print).
  processed = processed.replace(
    /(?:^- \[[ xX]\] [^\n]*(?:\n|$))+/gm,
    (block) => {
      const items = block.trimEnd().split('\n').map((line) => {
        const isChecked = /^- \[[xX]\]/.test(line)
        const text = line.replace(/^- \[[ xX]\] /, '')
        const style = isChecked
          ? 'list-style:none;text-decoration:line-through;opacity:0.55'
          : 'list-style:none'
        const checkedAttr = isChecked ? ' checked' : ''
        return `<li style="${style}"><input type="checkbox" disabled${checkedAttr}> ${marked.parseInline(text) as string}</li>`
      })
      return `\n<ul style="list-style:none;padding-left:1.2em;margin:0.5em 0">${items.join('')}</ul>\n`
    }
  )
  // Convert `- item` dash lists to a distinct class BEFORE marked processes them.
  // Use marked.parseInline on each item so bold/italic/code renders correctly inside <li>.
  processed = processed.replace(/(?:(?:^|\n)- .+)+/g, (block) => {
    // Don't double-process task list items already converted
    if (block.includes('<input')) return block
    const items = block.trim().split('\n').filter(l => l.startsWith('- ')).map(l => {
      const inline = marked.parseInline(l.slice(2)) as string
      return `<li>${inline}</li>`
    })
    return `\n<ul class="berean-dash-list">${items.join('')}</ul>\n`
  })
  let html = marked(processed) as string
  // Restore stashed blocks — handle both the <p>-wrapped and bare token forms.
  html = html.replace(/<p>\s*BEREANSTASHBLOCK(\d+)ENDSTASH\s*<\/p>/g, (_, n) => stashed[+n] ?? '')
  html = html.replace(/BEREANSTASHBLOCK(\d+)ENDSTASH/g, (_, n) => stashed[+n] ?? '')
  html = wrapStrongsRefsForPreview(html)
  return addVerseLinksToHtml(html)
}

export type PrintThemeId =
  | 'classic' | 'manuscript' | 'minimal' | 'ocean' | 'night'
  | 'parchment' | 'forest' | 'royal' | 'ember' | 'arctic'
  | 'slate' | 'rose' | 'dawn' | 'midnight' | 'ivory'

export interface PrintExportOptions {
  marginPreset?: 'none' | 'narrow' | 'normal' | 'wide' | 'custom'
  /** Per-side margins in inches; used only when marginPreset === 'custom'. */
  customMargins?: { top: number; right: number; bottom: number; left: number }
  fontSize?: number
  fontFamily?: 'system' | 'serif' | 'sansserif'
  includeTitle?: boolean
  colorMode?: 'color' | 'grayscale'
  theme?: PrintThemeId
  /** Additional notes to append after the main note (for linked-notes inclusion). */
  linkedNotes?: Array<{ title: string; content: string }>
  /**
   * Skip the markdown parse step and treat `content` as already-rendered
   * HTML — for callers (e.g. idioms export) that build their own markup
   * rather than markdown source. Without this, `content` gets run through
   * `renderMarkdownToHTML`, whose underlying markdown-it instance has
   * `html: false` (see markdownIt.ts) — literal `<div style="...">` tags in
   * the input get HTML-escaped and printed as visible tag soup instead of
   * being rendered, since markdown-it never treats them as real markup.
   */
  rawHtml?: boolean
}

export const MARGIN_INCHES: Record<string, number> = { none: 0, narrow: 0.5, normal: 1, wide: 1.5 }

/** Expand a preset margin to per-side inches (used to seed custom margins). */
export function presetToSides(preset: string): { top: number; right: number; bottom: number; left: number } {
  const v = MARGIN_INCHES[preset] ?? 1
  return { top: v, right: v, bottom: v, left: v }
}
const FONT_STACK: Record<string, string> = {
  system:    "-apple-system, system-ui, 'Segoe UI', sans-serif",
  serif:     "Georgia, 'Times New Roman', Times, serif",
  sansserif: "Inter, 'Helvetica Neue', Arial, sans-serif",
}

// Visual themes for printed / exported notes. Each restyles colors, verse blocks,
// headings, links and rules. Verse-block colors use !important to override the inline
// styles that renderPreviewContent emits (kept so the in-app preview also looks right).
export interface PrintTheme {
  id: PrintThemeId
  label: string
  desc: string
  bg: string
  text: string
  heading: string
  accent: string          // links
  h2Border: string
  verseBg: string
  verseBorder: string
  verseRef: string
  mark: string            // highlight background
  codeBg: string
  thBg: string
  suggestedFont: 'system' | 'serif' | 'sansserif'
}

export const PRINT_THEMES: Record<PrintThemeId, PrintTheme> = {
  classic: {
    id: 'classic', label: 'Classic', desc: 'Indigo accents, soft lavender scripture blocks',
    bg: '#ffffff', text: '#111111', heading: '#0f172a', accent: '#2563eb', h2Border: '#e5e7eb',
    verseBg: '#f5f4fb', verseBorder: '#6366f1', verseRef: '#312e81',
    mark: 'rgba(234,179,8,0.35)', codeBg: '#f3f4f6', thBg: '#f9fafb', suggestedFont: 'system',
  },
  manuscript: {
    id: 'manuscript', label: 'Manuscript', desc: 'Warm cream, serif — like a study printout',
    bg: '#fffdf8', text: '#1c1917', heading: '#1c1917', accent: '#b45309', h2Border: '#ece3d2',
    verseBg: '#fbf3e4', verseBorder: '#b45309', verseRef: '#78350f',
    mark: 'rgba(217,119,6,0.28)', codeBg: '#f5efe2', thBg: '#f7f1e3', suggestedFont: 'serif',
  },
  minimal: {
    id: 'minimal', label: 'Minimal', desc: 'Black & white, thin borders, no fills',
    bg: '#ffffff', text: '#000000', heading: '#000000', accent: '#000000', h2Border: '#000000',
    verseBg: 'transparent', verseBorder: '#000000', verseRef: '#000000',
    mark: 'rgba(0,0,0,0.10)', codeBg: '#f4f4f4', thBg: '#ffffff', suggestedFont: 'system',
  },
  ocean: {
    id: 'ocean', label: 'Ocean', desc: 'Teal accents, sans-serif, fresh look',
    bg: '#ffffff', text: '#0f172a', heading: '#0f766e', accent: '#0d9488', h2Border: '#ccfbf1',
    verseBg: '#f0fdfa', verseBorder: '#14b8a6', verseRef: '#0f766e',
    mark: 'rgba(20,184,166,0.22)', codeBg: '#f0fdfa', thBg: '#f0fdfa', suggestedFont: 'sansserif',
  },
  night: {
    id: 'night', label: 'Night', desc: 'Dark background, light text — screen reading',
    bg: '#1a1d21', text: '#e6e8eb', heading: '#f8fafc', accent: '#7dd3fc', h2Border: '#334155',
    verseBg: '#22272e', verseBorder: '#6366f1', verseRef: '#c7d2fe',
    mark: 'rgba(234,179,8,0.30)', codeBg: '#2a2f36', thBg: '#22272e', suggestedFont: 'system',
  },
  // ── 10 additional themes ──────────────────────────────────────────────────
  parchment: {
    id: 'parchment', label: 'Parchment', desc: 'Antique sepia paper, timeless study feel',
    bg: '#f9f3e8', text: '#3b2f1a', heading: '#2c1f0e', accent: '#8b5e2a', h2Border: '#d4b896',
    verseBg: '#f3e9d0', verseBorder: '#a07840', verseRef: '#6b4315',
    mark: 'rgba(160,120,64,0.28)', codeBg: '#ede3d0', thBg: '#f0e4cc', suggestedFont: 'serif',
  },
  forest: {
    id: 'forest', label: 'Forest', desc: 'Deep green tones, earthy and grounded',
    bg: '#f7faf7', text: '#1a2e1a', heading: '#163d1a', accent: '#2d6a4f', h2Border: '#b7d9c0',
    verseBg: '#eaf4ec', verseBorder: '#2d7d4e', verseRef: '#1a5c35',
    mark: 'rgba(45,125,78,0.22)', codeBg: '#e8f5ec', thBg: '#dff0e4', suggestedFont: 'system',
  },
  royal: {
    id: 'royal', label: 'Royal', desc: 'Rich purple accents, regal and dignified',
    bg: '#fdfcff', text: '#1a0a2e', heading: '#150824', accent: '#6d28d9', h2Border: '#ddd6fe',
    verseBg: '#f3eeff', verseBorder: '#7c3aed', verseRef: '#4c1d95',
    mark: 'rgba(109,40,217,0.20)', codeBg: '#f5f3ff', thBg: '#ede9fe', suggestedFont: 'system',
  },
  ember: {
    id: 'ember', label: 'Ember', desc: 'Warm red-orange tones, bold and striking',
    bg: '#fff8f5', text: '#1c0f08', heading: '#7c2d12', accent: '#c2410c', h2Border: '#fed7aa',
    verseBg: '#fff0e8', verseBorder: '#ea580c', verseRef: '#9a3412',
    mark: 'rgba(194,65,12,0.20)', codeBg: '#fff1eb', thBg: '#ffe4cc', suggestedFont: 'system',
  },
  arctic: {
    id: 'arctic', label: 'Arctic', desc: 'Icy cool blue-white, crisp and clear',
    bg: '#f5faff', text: '#0a1929', heading: '#0c2340', accent: '#0369a1', h2Border: '#bae6fd',
    verseBg: '#e8f4fd', verseBorder: '#0284c7', verseRef: '#075985',
    mark: 'rgba(3,105,161,0.18)', codeBg: '#e0f2fe', thBg: '#dbeafe', suggestedFont: 'sansserif',
  },
  slate: {
    id: 'slate', label: 'Slate', desc: 'Modern cool gray, professional and clean',
    bg: '#f8f9fa', text: '#1e2433', heading: '#0f172a', accent: '#3b4f6b', h2Border: '#cbd5e1',
    verseBg: '#f1f5f9', verseBorder: '#64748b', verseRef: '#334155',
    mark: 'rgba(71,85,105,0.18)', codeBg: '#e2e8f0', thBg: '#e8edf4', suggestedFont: 'system',
  },
  rose: {
    id: 'rose', label: 'Rose', desc: 'Soft rose and mauve, warm and gentle',
    bg: '#fff5f7', text: '#2d0a14', heading: '#4a0820', accent: '#be185d', h2Border: '#fce7f3',
    verseBg: '#ffe4ed', verseBorder: '#db2777', verseRef: '#9d174d',
    mark: 'rgba(190,24,93,0.18)', codeBg: '#ffe8f0', thBg: '#fce7f3', suggestedFont: 'system',
  },
  dawn: {
    id: 'dawn', label: 'Dawn', desc: 'Warm gold sunrise, hopeful and bright',
    bg: '#fffbf0', text: '#1c1205', heading: '#451a03', accent: '#b45309', h2Border: '#fde68a',
    verseBg: '#fef3c7', verseBorder: '#d97706', verseRef: '#92400e',
    mark: 'rgba(217,119,6,0.25)', codeBg: '#fef9e8', thBg: '#fef3c7', suggestedFont: 'system',
  },
  midnight: {
    id: 'midnight', label: 'Midnight', desc: 'Deep navy dark mode, focused and immersive',
    bg: '#0d1117', text: '#c9d1d9', heading: '#e6edf3', accent: '#58a6ff', h2Border: '#21262d',
    verseBg: '#161b22', verseBorder: '#3b82f6', verseRef: '#79b8ff',
    mark: 'rgba(88,166,255,0.22)', codeBg: '#161b22', thBg: '#161b22', suggestedFont: 'system',
  },
  ivory: {
    id: 'ivory', label: 'Ivory', desc: 'Soft off-white, gentle and easy on the eyes',
    bg: '#fafaf8', text: '#1a1a1a', heading: '#111111', accent: '#555577', h2Border: '#ddddd8',
    verseBg: '#f2f2ee', verseBorder: '#9ca3af', verseRef: '#4b5563',
    mark: 'rgba(107,114,128,0.18)', codeBg: '#f0f0ec', thBg: '#ededea', suggestedFont: 'serif',
  },
}

// Converts a PrintTheme color (hex "#rrggbb" or "rgba(r,g,b,a)") into the
// bare "r g b" triple format pmEditor.css's variables use (consumed via
// `rgb(var(--x))`, alpha applied separately by each rule that needs it).
function colorToTriple(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
  }
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color)
  if (rgba) return `${rgba[1]} ${rgba[2]} ${rgba[3]}`
  return '0 0 0'
}

// Builds a `:root { --var: ... }` block that drives pmEditor.css's existing
// theme-token CSS variables from a PrintTheme's (much smaller) color set —
// print themes never defined a full palette (no separate surface/highlight-
// per-color/link-per-type tokens the way the live app's light/dark themes
// do), so several pmEditor.css variables intentionally collapse onto one
// PrintTheme field each: every `--highlight-*` reuses `mark` (print themes
// only ever offered one highlight tint, not 15), and both `--link-lxx-ref`/
// `--link-lexicon-ref` reuse `verseRef` (print never distinguished them
// either). This keeps buildPrintHTML using pmEditor.css itself as the one
// stylesheet, rather than hand-duplicating the block/list/mark rules a
// second time the way this function used to.
function printThemeToCssVars(t: PrintTheme): string {
  const bg = colorToTriple(t.bg)
  const text = colorToTriple(t.text)
  const heading = colorToTriple(t.heading)
  const accent = colorToTriple(t.accent)
  const border = colorToTriple(t.h2Border)
  const verseBgIsTransparent = t.verseBg === 'transparent'
  const verseBg = colorToTriple(verseBgIsTransparent ? t.bg : t.verseBg)
  const verseRef = colorToTriple(t.verseRef)
  const mark = colorToTriple(t.mark)
  const codeBg = colorToTriple(t.codeBg)
  const thBg = colorToTriple(t.thBg)
  const highlightVars = ['yellow', 'orange', 'amber', 'red', 'rose', 'pink', 'violet', 'purple', 'indigo', 'blue', 'sky', 'cyan', 'teal', 'green', 'lime']
    .map((c) => `--highlight-${c}: ${mark};`).join(' ')
  return `:root {
    --color-surface-1: ${bg}; --color-surface-2: ${thBg}; --color-surface-3: ${codeBg}; --color-surface-4: ${border};
    --color-text-primary: ${text}; --color-text-secondary: ${heading}; --color-text-muted: ${text};
    --color-accent: ${accent};
    --link-wikilink: ${accent}; --link-lxx-ref: ${verseRef}; --link-lexicon-ref: ${verseRef};
    ${highlightVars}
    /* pm-verse-block/-lexicon-block read --color-accent/--link-lexicon-ref directly
       via pmEditor.css, but verseBg needs its own override since print themes tune
       block backgrounds independently of the general accent color. */
    --print-verse-bg: ${verseBg};
  }
  .pm-verse-block, .pm-lexicon-block { background: ${verseBgIsTransparent ? 'transparent' : 'rgb(var(--print-verse-bg))'} !important; }
  /* pmEditor.css styles the verse/Strong's reference as a small rounded, tinted BADGE
     (background/padding/border-radius) for the live editor — a "button" look that reads as
     an interactive UI chip, appropriate on-screen but wrong on a printed/exported page where
     nothing is clickable. Reset to plain bold colored text here, print-only. */
  .pm-verse-block-ref, .pm-lexicon-block-ref {
    display: inline !important;
    background: transparent !important;
    padding: 0 !important;
    border-radius: 0 !important;
    font-size: inherit !important;
  }
  `
}

// Build a standalone, print-ready HTML document for a note (used by print + PDF export).
export function buildPrintHTML(title: string, content: string, opts: PrintExportOptions = {}): string {
  const {
    marginPreset = 'normal',
    customMargins,
    fontSize = 12,
    fontFamily = 'system',
    includeTitle = true,
    colorMode = 'color',
    theme: themeId = 'classic',
  } = opts
  const t = PRINT_THEMES[themeId] ?? PRINT_THEMES.classic
  // Resolve body padding: a custom preset uses per-side values; otherwise a uniform preset.
  let bodyPadding: string
  if (marginPreset === 'custom' && customMargins) {
    const cl = (n: number) => Math.max(0, n)
    bodyPadding = `${cl(customMargins.top)}in ${cl(customMargins.right)}in ${cl(customMargins.bottom)}in ${cl(customMargins.left)}in`
  } else {
    bodyPadding = `${MARGIN_INCHES[marginPreset] ?? 1}in`
  }
  const grayscaleFilter = colorMode === 'grayscale' ? 'filter: grayscale(100%);' : ''
  const isDarkTheme = ['night', 'midnight'].includes(themeId)
  const colorAdjust = isDarkTheme ? `print-color-adjust: exact; -webkit-print-color-adjust: exact;` : ''
  // Margins are controlled ENTIRELY by the body padding (uniform on all four sides),
  // and @page margin is zeroed. This keeps the iframe preview (where @page has no effect)
  // identical to the printed PDF. The Electron print/PDF handlers also pass margin:0 so the
  // body padding is the single source of truth. "none" therefore truly means edge-to-edge.
  // Strip internal anchor hrefs (verse-refs, wikilinks, lexicon refs) that would become
  // broken links in PDF. External http(s) links (YouTube etc.) are left untouched.
  const { linkedNotes, rawHtml } = opts
  let body = rawHtml ? content : renderMarkdownToHTML(content)
  body = body.replace(/(<a\b[^>]*?)\s+href="#[^"]*"([^>]*>)/g, '$1$2')
  // Append linked notes (page-break divider + title + body for each)
  if (linkedNotes && linkedNotes.length > 0) {
    for (const ln of linkedNotes) {
      let lnBody = renderMarkdownToHTML(ln.content)
      lnBody = lnBody.replace(/(<a\b[^>]*?)\s+href="#[^"]*"([^>]*>)/g, '$1$2')
      const safeLnTitle = (ln.title || 'Untitled').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      body += `\n<div style="page-break-before:always;padding-top:0.5em;border-top:1px solid ${t.h2Border};margin-top:2em;">`
      body += `\n<h2 class="note-doc-title">${safeLnTitle}</h2>`
      body += `\n${lnBody}\n</div>`
    }
  }
  const safeTitle = (title || 'Untitled').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
${pmEditorCss}
${printThemeToCssVars(t)}
  /* Print-specific chrome that pmEditor.css (built for the live in-app
     editor pane) doesn't need to know about: page setup, margins, note
     title, and page-break control around blocks. */
  @page { margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  html { background: ${t.bg}; ${colorAdjust} }
  body {
    font-family: ${FONT_STACK[fontFamily] ?? FONT_STACK.system};
    font-size: ${fontSize}pt; color: ${t.text};
    background: ${t.bg};
    margin: 0; padding: ${bodyPadding};
    ${grayscaleFilter}
    position: relative;
  }
  h1.note-doc-title {
    font-size: 2em; font-weight: 800; color: ${t.heading};
    border-bottom: 2px solid ${t.h2Border}; padding-bottom: 0.25em; margin-bottom: 0.6em;
  }
  /* pmEditor.css (built for the live in-app editor pane, which sits inside
     the app's own themed chrome) doesn't set heading/link colors itself —
     a standalone print document has no such surrounding theme to inherit
     from, so these stay explicit per-PrintTheme rules here. */
  h1, h2, h3, h4, h5, h6 { color: ${t.heading}; }
  a { color: ${t.accent}; }
  pre, blockquote, table, .pm-verse-block, .pm-lexicon-block { page-break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  a:not([href]) { color: inherit; text-decoration: none; }
  /* pmEditor.css's .ProseMirror padding (16px sides, 96px bottom) exists for
     the live in-app editor's own scroll affordance — here the page margin is
     already fully controlled by body's padding above, so this padding would
     stack on top of it and produce an asymmetric page (oversized bottom gap,
     content inset further than the chosen margin preset implies). */
  .berean-pm-editor .ProseMirror { padding: 0; }
</style>
</head>
<body>
${includeTitle ? `<h1 class="note-doc-title">${safeTitle}</h1>` : ''}
${body}
</body>
</html>`
}
