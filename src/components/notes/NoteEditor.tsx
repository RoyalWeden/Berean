import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap, ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { EditorState, EditorSelection, RangeSetBuilder, StateField, StateEffect, Compartment } from '@codemirror/state'
import type { ChangeSpec } from '@codemirror/state'
// ─── WYSIWYG mode state ────────────────────────────────────────────────────────
// When active, col() always returns false — ALL markdown syntax markers are hidden
// even when the cursor is on the same line. Text stays fully editable.
export const wysiwygEffect = StateEffect.define<boolean>()
export const wysiwygField = StateField.define<boolean>({
  create: () => false,
  update(val, tr) {
    for (const e of tr.effects) if (e.is(wysiwygEffect)) return e.value
    return val
  },
})
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { tags } from '@lezer/highlight'
import { marked } from 'marked'
import { Undo2, Redo2, Bold, Italic, Underline, Code, Link2, Link2Off, Strikethrough, List, ListOrdered, Quote, ChevronDown, X, AlignLeft, AlignCenter, AlignRight, AlignJustify, Highlighter, MoreHorizontal, Table2, IndentIncrease, IndentDecrease, Copy, Trash2 } from 'lucide-react'
import type { Note } from '@/types'
import { parseRef, getTranslationForBook } from '@/lib/parseRef'
import type { ParsedRef } from '@/lib/parseRef'
import { useAppStore } from '@/store'

const PERSISTENT_TOOLBAR_MIN_WIDTH = 380

// ─── Persistent toolbar helpers ───────────────────────────────────────────────

interface TBtnProps {
  title?: string
  active?: boolean
  className?: string
  onMouseDown: (e: React.MouseEvent) => void
  children: React.ReactNode
}

function TBtn({ title, active, className = '', onMouseDown, children }: TBtnProps) {
  return (
    <button
      title={title}
      onMouseDown={onMouseDown}
      className={`p-1 rounded cursor-pointer transition-colors flex items-center justify-center gap-0.5 flex-shrink-0 ${
        active
          ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
          : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
      } ${className}`}
    >
      {children}
    </button>
  )
}

function TSep() {
  return <div className="w-px h-4 bg-[rgb(var(--color-surface-4))] mx-0.5 flex-shrink-0 self-center" />
}

// ─── Note editor props ────────────────────────────────────────────────────────

interface NoteEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
  onFocusRef?: (focusFn: () => void) => void
  onCommandsRef?: (cmds: { undo: () => void; redo: () => void }) => void
  onScrollRef?: (el: HTMLElement) => void
  onScrollPosition?: (pos: number) => void
  onCursorPosition?: (pos: number) => void
  initialScrollTop?: number
  initialCursorPos?: number
  autoFocus?: boolean
  previewMode?: boolean
  /** When true: all markdown/HTML syntax markers are hidden globally (WYSIWYG clean edit). */
  wysiwyg?: boolean
  notes?: Note[]
  onWikilinkClick?: (title: string) => void
  onVerseRefClick?: (ref: ParsedRef) => void
  noteId?: string
  noteTitle?: string
  /** If provided, all occurrences of this string are wrapped in
   *  <mark class="berean-find-mark"> elements in preview mode so the
   *  parent panel can navigate between them. */
  findQuery?: string
  /** When set, a collapsed non-editable import-source footer is shown at the
   *  bottom of the editor.  Not passed from BibleRightPanel so it never appears
   *  in the scripture side panel. */
  importSource?: 'biblegateway' | 'esword'
  importedAt?: number   // Unix ms timestamp (note.createdAt)
}

/** Injects <mark class="berean-find-mark"> wrappers around every text-node
 *  occurrence of `query` in an HTML string. Skips content inside HTML tags. */
function injectFindMarks(html: string, query: string): string {
  if (!query.trim()) return html
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Split on HTML tags; only replace in text portions (parts that don't start with '<')
  const parts = html.split(/(<[^>]*>)/g)
  const re = new RegExp(`(${escaped})`, 'gi')
  return parts
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(re, '<mark class="berean-find-mark">$1</mark>')
    )
    .join('')
}

// ─── Find-highlight extension ────────────────────────────────────────────────
/** Returns a ViewPlugin that decorates all occurrences of `query` with the
 *  `berean-find-mark` class so the parent panel can query/navigate them. */
function buildFindHighlightPlugin(query: string) {
  if (!query.trim()) return ViewPlugin.fromClass(class { decorations = Decoration.none }, { decorations: v => v.decorations })
  const lowerQ = query.trim().toLowerCase()
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = this.build(view) }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view)
      }
      build(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>()
        const text = view.state.doc.toString().toLowerCase()
        const mark = Decoration.mark({ class: 'berean-find-mark' })
        let pos = 0
        while ((pos = text.indexOf(lowerQ, pos)) !== -1) {
          builder.add(pos, pos + lowerQ.length, mark)
          pos += lowerQ.length
        }
        return builder.finish()
      }
    },
    { decorations: v => v.decorations }
  )
}

// ─── Suppress-refs state field ────────────────────────────────────────────────
// Tracks ranges where auto-detected verse/lexicon refs are suppressed.
// Ranges survive document edits (positions are mapped through changes).

type SuppressedRange = { from: number; to: number }

const setSuppressedEffect = StateEffect.define<SuppressedRange[]>()
const refreshDecorationsEffect = StateEffect.define<null>()

const suppressedRangesField = StateField.define<SuppressedRange[]>({
  create: () => [],
  update(ranges, tr) {
    // Map positions through document changes; drop zero-length ranges
    let mapped: SuppressedRange[] = ranges
      .map(r => ({ from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to, 1) }))
      .filter(r => r.from < r.to)
    for (const effect of tr.effects) {
      if (effect.is(setSuppressedEffect)) mapped = effect.value
    }
    return mapped
  },
})

// Configure marked for safe HTML output — gfm:true enables GitHub-Flavored Markdown tables
marked.setOptions({ breaks: true, gfm: true })

// Disable setext headings so a line of text directly above "---" (or "===") is NOT
// turned into a heading. "---" should always render as a horizontal-rule divider.
marked.use({ tokenizer: { lheading() { return undefined } } })

const headingStyle = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.71em', fontWeight: '700', lineHeight: '1.4', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading2, fontSize: '1.43em', fontWeight: '700', lineHeight: '1.4', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading3, fontSize: '1.29em', fontWeight: '600', lineHeight: '1.4', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading4, fontWeight: '700', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading5, fontWeight: '600', fontStyle: 'italic', color: 'rgb(var(--color-text-primary))' },
]))

// Override oneDark's colored markdown tokens — must come after oneDark in extensions array
const bereanSyntaxOverrides = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, color: 'rgb(var(--color-text-primary))' },
  { tag: [tags.list, tags.meta, tags.quote, tags.name], color: 'rgb(var(--color-text-primary))' },
  { tag: [tags.processingInstruction], color: 'rgb(var(--color-text-secondary))' },
  { tag: [tags.link, tags.url], color: 'rgb(99,102,241)' },
]))

const bereanTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    fontFamily: 'var(--font-body, system-ui, sans-serif)',
    backgroundColor: 'transparent !important',
    color: 'rgb(var(--color-text-primary))',
  },
  '.cm-scroller': { padding: '16px', paddingBottom: '96px', overflowY: 'auto', fontFamily: 'inherit' },
  '.cm-content': { caretColor: 'rgb(var(--color-accent))', padding: '0', lineHeight: '1.625', color: 'rgb(var(--color-text-primary))' },
  '.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0', color: 'rgb(var(--color-text-primary))' },
  '.cm-editor': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(100, 120, 220, 0.05)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--selection-bg) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection-bg) !important' },
  '::selection': { backgroundColor: 'var(--selection-bg) !important' },
  // Live preview line-level markers — font sizes set by headingStyle to avoid double-scaling
  '.cm-live-h1': { fontWeight: '700' },
  '.cm-live-h2': { fontWeight: '700' },
  '.cm-live-h3': { fontWeight: '600' },
  '.cm-live-h4': { fontWeight: '700' },
  '.cm-live-h5': { fontWeight: '600', fontStyle: 'italic' },
  // Force heading spans to use theme color regardless of oneDark syntax highlighting
  '.cm-live-h1 span, .cm-live-h2 span, .cm-live-h3 span, .cm-live-h4 span, .cm-live-h5 span': { color: 'rgb(var(--color-text-primary)) !important' },
  '.cm-live-bold': { fontWeight: 'bold' },
  '.cm-live-italic': { fontStyle: 'italic' },
  '.cm-live-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-live-code': { fontFamily: 'monospace', fontSize: '0.875em', backgroundColor: 'rgb(var(--color-surface-4))', padding: '0 3px', borderRadius: '3px', color: 'rgb(var(--color-text-primary)) !important' },
  '.cm-live-code-block': { backgroundColor: 'rgb(var(--color-surface-4))', fontFamily: 'monospace', fontSize: '0.875em', paddingLeft: '12px', paddingRight: '12px', color: 'rgb(var(--color-text-primary)) !important' },
  // Fence lines (```) — same height/font as code-block, text hidden to avoid layout jumps
  // color on the .cm-line alone is overridden by oneDark's child spans, so target * too
  '.cm-live-code-fence': { backgroundColor: 'rgb(var(--color-surface-4))', fontFamily: 'monospace', fontSize: '0.875em', paddingLeft: '12px', paddingRight: '12px' },
  '.cm-live-code-fence *': { color: 'transparent !important', userSelect: 'none' as const },
  '.cm-code-block-top': { borderRadius: '6px 6px 0 0', paddingTop: '6px' },
  '.cm-code-block-bottom': { borderRadius: '0 0 6px 6px', paddingBottom: '6px' },
  '.cm-code-block-only': { borderRadius: '6px', paddingTop: '6px', paddingBottom: '6px' },
  '.cm-live-list-bullet': { color: 'rgb(var(--color-text-primary))' },
  '.cm-live-highlight': { backgroundColor: 'rgba(234,179,8,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-yellow':  { backgroundColor: 'rgba(234,179,8,0.38)',   borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-orange':  { backgroundColor: 'rgba(251,146,60,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-amber':   { backgroundColor: 'rgba(251,191,36,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-red':     { backgroundColor: 'rgba(248,113,113,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-rose':    { backgroundColor: 'rgba(251,113,133,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-pink':    { backgroundColor: 'rgba(244,114,182,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-violet':  { backgroundColor: 'rgba(167,139,250,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-purple':  { backgroundColor: 'rgba(192,132,252,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-indigo':  { backgroundColor: 'rgba(129,140,248,0.38)', borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-blue':    { backgroundColor: 'rgba(96,165,250,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-sky':     { backgroundColor: 'rgba(56,189,248,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-cyan':    { backgroundColor: 'rgba(34,211,238,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-teal':    { backgroundColor: 'rgba(45,212,191,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-green':   { backgroundColor: 'rgba(74,222,128,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-hl-lime':    { backgroundColor: 'rgba(163,230,53,0.38)',  borderRadius: '2px', padding: '0 1px' },
  '.cm-live-align-center': { textAlign: 'center' as const },
  '.cm-live-align-right': { textAlign: 'right' as const },
  '.cm-live-align-justify': { textAlign: 'justify' as const },
  '.cm-live-task-done': { textDecoration: 'line-through', opacity: '0.55' },
  '.cm-live-link': { color: 'rgb(99,102,241)', textDecoration: 'underline', cursor: 'pointer' },
  '.cm-live-wikilink': { color: 'rgb(139,92,246)', textDecoration: 'underline', cursor: 'pointer' },
  '.cm-live-verse-ref': { color: 'rgb(var(--color-accent))', textDecoration: 'underline', cursor: 'pointer', textUnderlineOffset: '2px' },
  '.cm-live-lxx-ref': { color: 'rgb(167,139,250)', textDecoration: 'underline', cursor: 'pointer', textUnderlineOffset: '2px' },
  '.cm-live-lexicon-ref': { color: 'rgb(52,211,153)', textDecoration: 'underline', textDecorationStyle: 'dashed', cursor: 'pointer', textUnderlineOffset: '2px' },
  '.cm-live-suppressed': { textDecoration: 'none !important', cursor: 'text' },
  '.cm-live-blockquote': { borderLeft: '2px solid rgb(var(--color-accent))', paddingLeft: '0.75em', color: 'rgb(var(--color-text-secondary)) !important' },
  // Verse block — plain text styled like a scripture quote (decoration only)
  '.cm-live-verse-block': { borderLeft: '3px solid rgb(var(--color-accent))', paddingLeft: '0.75em', backgroundColor: 'rgba(100,116,139,0.06)', color: 'rgb(var(--color-text-secondary))' },
  '.cm-live-verse-block-first': { paddingTop: '3px', borderTopLeftRadius: '4px' },
  '.cm-live-verse-block-last': { paddingBottom: '3px', borderBottomLeftRadius: '4px' },
  '.cm-live-verse-block-ref': { fontWeight: '700', color: 'rgb(var(--color-text-primary)) !important' },
  '.cm-live-callout-header': { borderLeft: '3px solid rgba(168,85,247,0.7)', paddingLeft: '0.75em', color: 'rgba(192,132,252,0.9) !important', fontWeight: '600' },
  '.cm-live-underline': { textDecoration: 'underline' },
  // Horizontal rule: draw a centred 1 px line using a background gradient so the
  // divider sits at the vertical mid-point of the line rather than at the bottom.
  '.cm-live-hr-line': {
    background: 'linear-gradient(transparent calc(50% - 0.5px), rgba(100,116,139,0.45) calc(50% - 0.5px), rgba(100,116,139,0.45) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
    lineHeight: '1.6',
  },
  '.cm-live-hr-mark': { color: 'transparent', userSelect: 'none' as const },
  // Heading collapse arrow — font-size and vertical-align set inline per level by CollapseArrowWidget.
  // We deliberately avoid vertical-align:middle here because that aligns to the 14 px PARENT
  // x-height, which sits too low inside a tall heading line box.  Instead the widget uses the
  // same font-size as the heading text so baseline alignment naturally centres both elements.
  '.cm-heading-collapse-arrow': { marginLeft: '5px', cursor: 'pointer', userSelect: 'none' as const, opacity: '0.45' },
  '.cm-heading-collapse-arrow:hover': { opacity: '0.85' },
  // Subtle bottom border drawn below each heading line when "heading divider" setting is on
  '.cm-live-h-divider': { borderBottom: '1px solid rgba(100,116,139,0.15)', paddingBottom: '1px' },
})

const NOTE_HL_COLORS: { id: string; dot: string }[] = [
  { id: 'yellow', dot: '#facc15' }, { id: 'orange', dot: '#fb923c' }, { id: 'amber',  dot: '#fbbf24' },
  { id: 'red',    dot: '#f87171' }, { id: 'rose',   dot: '#fb7185' }, { id: 'pink',   dot: '#f472b6' },
  { id: 'violet', dot: '#a78bfa' }, { id: 'purple', dot: '#c084fc' }, { id: 'indigo', dot: '#818cf8' },
  { id: 'blue',   dot: '#60a5fa' }, { id: 'sky',    dot: '#38bdf8' }, { id: 'cyan',   dot: '#22d3ee' },
  { id: 'teal',   dot: '#2dd4bf' }, { id: 'green',  dot: '#4ade80' }, { id: 'lime',   dot: '#a3e635' },
]

function wrapWith(open: string, close: string) {
  return (view: EditorView): boolean => {
    view.dispatch(view.state.changeByRange((range) => {
      if (range.empty) {
        return {
          changes: { from: range.from, insert: open + close },
          range: EditorSelection.cursor(range.from + open.length),
        }
      }
      return {
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        range: EditorSelection.range(range.from + open.length, range.to + open.length),
      }
    }))
    return true
  }
}

/**
 * Scan outward through HTML tags from a position to find a markdown marker.
 * Skips over `<tag>` or `</tag>` sequences that separate the selection from its marker.
 * Returns the position (from-inclusive) where `marker` starts/ends, or -1 if not found.
 *
 * direction === -1: scan BACKWARD from `pos`, looking for `marker` that ENDS at the
 *   scan target (i.e., marker occupies [result, result+len)).
 * direction === 1:  scan FORWARD from `pos`, looking for `marker` that STARTS at the
 *   scan target (i.e., marker occupies [result, result+len)).
 */
export function scanThroughHtml(
  doc: { sliceString: (f: number, t: number) => string; length: number },
  pos: number,
  marker: string,
  direction: -1 | 1,
): number {
  let cur = pos
  const len = marker.length
  for (let guard = 0; guard < 12; guard++) {
    if (direction === -1) {
      if (cur - len < 0) return -1
      if (doc.sliceString(cur - len, cur) === marker) return cur - len
      // If the character immediately before cur is '>' it's the end of an HTML tag → skip it
      if (cur > 0 && doc.sliceString(cur - 1, cur) === '>') {
        let p = cur - 2
        while (p >= 0 && doc.sliceString(p, p + 1) !== '<') p--
        if (p < 0) return -1
        cur = p
      } else {
        return -1
      }
    } else {
      if (cur + len > doc.length) return -1
      if (doc.sliceString(cur, cur + len) === marker) return cur
      // If the character at cur is '<' it's the start of an HTML tag → skip it
      if (doc.sliceString(cur, cur + 1) === '<') {
        let p = cur + 1
        while (p < doc.length && doc.sliceString(p, p + 1) !== '>') p++
        if (p >= doc.length) return -1
        cur = p + 1
      } else {
        return -1
      }
    }
  }
  return -1
}

// ─── Star-counting helpers for italic/bold toggle ─────────────────────────────
// These are needed so that toggling italic on "**word**" doesn't confuse the inner
// '*' chars of '**' for italic markers. We count ALL adjacent '*' (scanning through
// HTML tags) and use parity: odd = italic present, even = bold only.

/** Count consecutive '*' chars adjacent to `pos` scanning in `dir`, skipping HTML tags. */
export function countStarsBeside(
  doc: { sliceString: (f: number, t: number) => string; length: number },
  pos: number,
  dir: -1 | 1,
): number {
  let count = 0
  let p = dir === -1 ? pos - 1 : pos
  for (let guard = 0; guard < 64; guard++) {
    if (p < 0 || p >= doc.length) break
    const ch = doc.sliceString(p, p + 1)
    if (ch === '*') { count++; p += dir }
    else if (ch === '>' && dir === -1) {
      let q = p - 1
      while (q >= 0 && doc.sliceString(q, q + 1) !== '<') q--
      if (q < 0) break
      p = q - 1
    } else if (ch === '<' && dir === 1) {
      let q = p + 1
      while (q < doc.length && doc.sliceString(q, q + 1) !== '>') q++
      if (q >= doc.length) break
      p = q + 1
    } else break
  }
  return count
}

/** Position of the first '*' when scanning from `pos` in `dir`, skipping HTML. Returns -1 if none. */
export function innermostStarPos(
  doc: { sliceString: (f: number, t: number) => string; length: number },
  pos: number,
  dir: -1 | 1,
): number {
  let p = dir === -1 ? pos - 1 : pos
  for (let guard = 0; guard < 64; guard++) {
    if (p < 0 || p >= doc.length) return -1
    const ch = doc.sliceString(p, p + 1)
    if (ch === '*') return p
    if (ch === '>' && dir === -1) {
      let q = p - 1
      while (q >= 0 && doc.sliceString(q, q + 1) !== '<') q--
      if (q < 0) return -1
      p = q - 1
    } else if (ch === '<' && dir === 1) {
      let q = p + 1
      while (q < doc.length && doc.sliceString(q, q + 1) !== '>') q++
      if (q >= doc.length) return -1
      p = q + 1
    } else return -1
  }
  return -1
}

function toggleWith(open: string, close: string) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main
    if (!sel.empty) {
      const doc = view.state.doc

      // ── Italic ('*'): use star-counting to avoid confusing '*' in '**' ─────
      // "bold then italic" would leave 3 '*' on each side; ordinary bold leaves 2.
      // Counting parity (odd=italic present, even=italic absent) gives the right answer
      // for every nesting combination, even when HTML tags separate the markers.
      if (open === '*' && close === '*') {
        const sb = countStarsBeside(doc, sel.from, -1)
        const sa = countStarsBeside(doc, sel.to, 1)
        if (sb >= 1 && sa >= 1 && sb % 2 === 1 && sa % 2 === 1) {
          // Italic IS applied — remove the innermost '*' on each side
          const fromStar = innermostStarPos(doc, sel.from, -1)
          const toStar   = innermostStarPos(doc, sel.to,   1)
          if (fromStar >= 0 && toStar >= 0) {
            view.dispatch({
              changes: [
                { from: fromStar, to: fromStar + 1 },
                { from: toStar,   to: toStar   + 1 },
              ],
              selection: EditorSelection.range(sel.from - 1, sel.to - 1),
            })
            return true
          }
        }
        return wrapWith('*', '*')(view)
      }

      // ── Bold ('**') and all other markers: fast path + HTML-aware ─────────
      const before = doc.sliceString(Math.max(0, sel.from - open.length), sel.from)
      const after  = doc.sliceString(sel.to, Math.min(doc.length, sel.to + close.length))
      if (before === open && after === close) {
        view.dispatch({
          changes: [
            { from: sel.from - open.length, to: sel.from },
            { from: sel.to, to: sel.to + close.length },
          ],
          selection: EditorSelection.range(sel.from - open.length, sel.to - open.length),
        })
        return true
      }
      // HTML-aware: markers separated from selection by HTML tags.
      // E.g. **<u>word</u>** — toggling bold ('**') finds the markers through <u>…</u>.
      const markerFrom = scanThroughHtml(doc, sel.from, open,  -1)
      const markerTo   = scanThroughHtml(doc, sel.to,   close, 1)
      if (markerFrom >= 0 && markerTo >= 0) {
        view.dispatch({
          changes: [
            { from: markerFrom, to: markerFrom + open.length },
            { from: markerTo,   to: markerTo  + close.length },
          ],
          selection: EditorSelection.range(sel.from - open.length, sel.to - open.length),
        })
        return true
      }
    }
    return wrapWith(open, close)(view)
  }
}

// ── Bullet style definitions ────────────────────────────────────────────────
// Each array has 5 symbols: [level-0, level-1, level-2, level-3, level-4+]

export const BULLET_STYLE_DEFS: Record<string, { label: string; symbols: string[] }> = {
  classic:    { label: 'Classic',    symbols: ['•', '◦', '▸', '◦', '·'] },
  geometric:  { label: 'Geometric',  symbols: ['◆', '◇', '▪', '▫', '·'] },
  arrows:     { label: 'Arrows',     symbols: ['›', '»', '→', '⟩', '·'] },
  dash:       { label: 'Dash',       symbols: ['—', '–', '−', '‒', '·'] },
  star:       { label: 'Star',       symbols: ['★', '☆', '✦', '✧', '·'] },
}

// ── List-aware indent / outdent ──────────────────────────────────────────────
const INDENT_UNIT = '    ' // four spaces per level — wider visual separation

export function indentSelection(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  const startLine = state.doc.lineAt(sel.from).number
  const endLine = state.doc.lineAt(sel.to).number
  const changes: { from: number; insert: string }[] = []
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n)
    // Skip totally empty lines unless it's the only line (so a lone cursor still indents)
    if (line.text.length === 0 && startLine !== endLine) continue
    changes.push({ from: line.from, insert: INDENT_UNIT })
  }
  if (changes.length === 0) { changes.push({ from: sel.from, insert: INDENT_UNIT }) }
  view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.indent' }))
  return true
}

export function outdentSelection(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  const startLine = state.doc.lineAt(sel.from).number
  const endLine = state.doc.lineAt(sel.to).number
  const changes: { from: number; to: number }[] = []
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n)
    const m = line.text.match(/^(\t| {1,2})/)
    if (m) changes.push({ from: line.from, to: line.from + m[0].length })
  }
  if (changes.length === 0) return false
  view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'delete.outdent' }))
  return true
}

function detectFormats(state: EditorState): Set<string> {
  const sel = state.selection.main
  const fmts = new Set<string>()

  // Use syntax tree to detect formats — handles nested formats (e.g. bold+italic)
  syntaxTree(state).iterate({
    from: Math.max(0, sel.from - 3),
    to: Math.min(state.doc.length, sel.to + 4),
    enter(node) {
      if (node.to <= sel.from || node.from >= sel.to) return
      switch (node.name) {
        case 'StrongEmphasis': fmts.add('bold'); break
        case 'Emphasis': fmts.add('italic'); break
        case 'InlineCode': fmts.add('code'); break
        case 'Strikethrough': fmts.add('strike'); break
        case 'Link': fmts.add('link'); break
        case 'BulletList':
        case 'ListItem': {
          // Check if list marker is * or -
          const line = state.doc.lineAt(node.from)
          const marker = line.text.match(/^(\s*)([-*])(\s)/)
          if (marker) fmts.add(marker[2] === '*' ? 'bullet' : 'dash')
          break
        }
        case 'OrderedList': fmts.add('ordered'); break
      }
    },
  })

  // Wikilink detection via regex — not in CM syntax tree
  const lineAt = state.doc.lineAt(sel.from)
  if (/\[\[[^\]]*\]\]/.test(lineAt.text)) {
    const lineOffset = sel.from - lineAt.from
    const beforeCursor = lineAt.text.slice(0, lineOffset)
    const afterCursor = lineAt.text.slice(lineOffset)
    if (beforeCursor.includes('[[') && afterCursor.includes(']]')) fmts.add('wikilink')
  }

  // HTML underline is not parsed by CM markdown — scan current line for <u>...</u> wrapping cursor
  const doc = state.doc
  const uLine = doc.lineAt(sel.from)
  const uLineText = uLine.text
  const uLineOffset = sel.from - uLine.from
  const uOpenIdx = uLineText.lastIndexOf('<u>', uLineOffset)
  const uCloseIdx = uLineText.indexOf('</u>', uLineOffset)
  if (uOpenIdx !== -1 && uCloseIdx !== -1) {
    // Ensure there's no intervening </u> before the cursor
    const betweenOpenAndCursor = uLineText.slice(uOpenIdx, uLineOffset)
    if (!betweenOpenAndCursor.includes('</u>')) fmts.add('underline')
  }

  // Highlight ==text== — check for == before and after selection
  const b2 = doc.sliceString(Math.max(0, sel.from - 2), sel.from)
  const a2 = doc.sliceString(sel.to, Math.min(doc.length, sel.to + 2))
  if (b2 === '==' && a2 === '==') fmts.add('highlight')

  // Colored highlights <mark class="hl-X">...</mark> — check if cursor is inside one
  const hlLine = doc.lineAt(sel.from)
  const hlText = hlLine.text
  const hlOffset = sel.from - hlLine.from
  const HlColors = ['yellow','orange','amber','red','rose','pink','violet','purple','indigo','blue','sky','cyan','teal','green','lime']
  for (const c of HlColors) {
    const open = `<mark class="hl-${c}">`
    const close = `</mark>`
    const openIdx = hlText.lastIndexOf(open, hlOffset)
    if (openIdx !== -1) {
      const closeIdx = hlText.indexOf(close, openIdx + open.length)
      if (closeIdx === -1 || closeIdx >= hlOffset) { fmts.add(`hl-${c}`); break }
    }
  }

  // Heading — check current line for # prefix
  const currentLine = doc.lineAt(sel.from)
  const headingMatch = currentLine.text.match(/^(#{1,6}) /)
  if (headingMatch) fmts.add(`heading-${headingMatch[1].length}`)

  // Alignment — check current line for <div align="X">
  const alignMatch = currentLine.text.match(/^<div align="(left|center|right|justify)">/)
  if (alignMatch) fmts.add(`align-${alignMatch[1]}`)

  // Line-level contexts: blockquote, callout, bullet list (- ), dash list (- ), numbered list
  const lineText = currentLine.text
  if (/^> \[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.test(lineText)) {
    fmts.add('callout')
  } else if (/^> /.test(lineText) || lineText === '>') {
    fmts.add('blockquote')
  }
  // Also detect blockquote/callout from syntax tree (handles nested or multiline)
  syntaxTree(state).iterate({
    from: Math.max(0, sel.from - 1),
    to: Math.min(state.doc.length, sel.from + 1),
    enter(node) {
      if (node.name === 'Blockquote') fmts.has('callout') || fmts.add('blockquote')
    },
  })

  // List types — check line prefix
  if (/^- \[[ xX]\] /.test(lineText)) fmts.add('task')
  else if (/^\* /.test(lineText)) fmts.add('bullet')
  else if (/^- /.test(lineText)) fmts.add('dash')
  else if (/^\d+\. /.test(lineText)) fmts.add('ordered')
  if (/^[a-z]+\. /.test(lineText)) fmts.add('alpha-lower')
  if (/^[A-Z]+\. /.test(lineText)) fmts.add('alpha-upper')
  if (/^[ivxlcdmIVXLCDM]+\. /.test(lineText) && /^[ivxlcdm]+\. /i.test(lineText) && !/^[A-Z]+\. /.test(lineText)) {
    if (/^[a-z]/.test(lineText)) fmts.add('roman-lower')
    else fmts.add('roman-upper')
  }

  return fmts
}

// Wrap selected text when typing *, ~, `, or " with a selection active;
// also handle `* ` and `- ` at start of line to start/continue lists
const wrapOnTypeHandler = EditorView.inputHandler.of((view, from, to, text) => {
  // Auto-list: `* ` or `- ` at start of line (no existing selection)
  if (text === ' ' && from === to) {
    const line = view.state.doc.lineAt(from)
    if (from === line.from + 1 && (line.text === '*' || line.text === '-')) {
      // Already typed the marker, now typing space — let it through normally (markdown will parse it)
      return false
    }
  }
  if (from === to) return false // no selection
  const wrapMap: Record<string, [string, string]> = {
    '*': ['*', '*'],
    '~': ['~~', '~~'],
    '`': ['`', '`'],
    '"': ['"', '"'],
  }
  const pair = wrapMap[text]
  if (!pair) return false
  wrapWith(pair[0], pair[1])(view)
  return true
})

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
const SINGLE_VERSE_LINE_RE =
  /^(\s*)((?:[1-3][ \t]+)?[A-Za-z][a-z]+(?:[ \t]+[A-Za-z][a-z]+){0,2}[ \t]+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?)[ \t]+(\S.*)$/
// A body line in a multi-line block: starts with a verse number then text.
const VERSE_BODY_LINE_RE = /^\s*\d{1,3}[ \t]+\S/

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
const VERSE_REF_SCAN_RE =
  /((?:[1-3][ \t]+)?(?:[A-Za-z][a-z]*\.?[ \t]+){0,2}[A-Za-z][a-z]+\.?)[ \t]+(\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?)([ \t]+LXX\b)?/gi

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
    const numPart = m[2]
    const lxx = !!m[3]
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
      const candidateRef = words.slice(start).join(' ') + ' ' + numPart
      if (parseRef(candidateRef)) {
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

// ─── Async verse-text verification cache ──────────────────────────────────────
// Resolving real verse text requires the Bible DB (async). We cache the computed
// ratio per (ref + candidate-text) so the synchronous decoration builder can read
// it. A miss kicks off a background fetch, then re-decorates when it resolves.
const verseRatioCache = new Map<string, number>()
const versePending = new Set<string>()

function verseCacheKey(refText: string, candidate: string): string {
  return refText + ' ' + candidate.replace(/\s+/g, ' ').trim().toLowerCase()
}

interface BibleQueryWindow {
  bible?: { queryChapter?: (b: string, c: number, t?: string) => Promise<Array<{ verse_num: number; text: string }>> }
}

async function fetchActualVerseText(refText: string): Promise<string | null> {
  const ref = parseRef(refText)
  if (!ref) return null
  const w = (typeof window !== 'undefined' ? (window as unknown as BibleQueryWindow) : null)
  if (!w?.bible?.queryChapter) return null
  const def = useAppStore.getState().defaultBibleTranslation || 'kjva'
  const textId = (getTranslationForBook(ref.bookId) ?? def).toLowerCase()
  const startCh = ref.chapter
  const endCh = ref.endChapter ?? ref.chapter
  const parts: string[] = []
  for (let ch = startCh; ch <= endCh; ch++) {
    const verses = await w.bible.queryChapter(ref.bookId, ch, textId)
    if (!Array.isArray(verses)) continue
    for (const v of verses) {
      if (endCh === startCh && ref.verse != null) {
        const lo = ref.verse
        const hi = ref.endVerse ?? ref.verse
        if (v.verse_num >= lo && v.verse_num <= hi) parts.push(v.text)
      } else {
        parts.push(v.text)
      }
    }
  }
  return parts.length ? parts.join(' ') : null
}

/**
 * Returns true (format it), false (don't), or null (pending — don't format yet).
 * When the Bible DB is unavailable (tests / fallback), returns true (structural).
 * On a cache miss, schedules a background fetch and calls onResolved() afterward.
 */
function verseTextAccepted(
  refText: string, candidate: string, threshold: number, onResolved: () => void,
): boolean | null {
  const w = (typeof window !== 'undefined' ? (window as unknown as BibleQueryWindow) : null)
  if (!w?.bible?.queryChapter) return true
  const key = verseCacheKey(refText, candidate)
  if (verseRatioCache.has(key)) return verseRatioCache.get(key)! >= threshold
  if (versePending.has(key)) return null
  versePending.add(key)
  fetchActualVerseText(refText)
    .then((actual) => {
      // Measure how much of the ACTUAL VERSE is present in the typed text, so that
      // a short comment that merely reuses common words (e.g. "the the") scores low.
      // When the verse can't be resolved (null/empty — DB miss, unusual translation),
      // default to accept (1) so genuine pasted verses still format; only a CONFIRMED
      // low-coverage match is rejected.
      verseRatioCache.set(key, actual ? verseTextMatchRatio(actual, candidate) : 1)
      versePending.delete(key)
      onResolved()
    })
    .catch(() => {
      verseRatioCache.set(key, 1) // on error, don't block formatting
      versePending.delete(key)
      onResolved()
    })
  return null
}

// Synchronous variant for preview/print — reads cache, falls back to structural.
function verseTextAcceptedSync(refText: string, candidate: string, threshold: number): boolean {
  const key = verseCacheKey(refText, candidate)
  if (verseRatioCache.has(key)) return verseRatioCache.get(key)! >= threshold
  return true
}

const pasteHandler = EditorView.domEventHandlers({
  paste(e, view) {
    const items = e.clipboardData?.items
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) return false
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = reader.result as string
            const { from } = view.state.selection.main
            view.dispatch({
              changes: { from, insert: `![](${dataUrl})` },
              selection: { anchor: from + 4 },
            })
          }
          reader.readAsDataURL(file)
          return true
        }
      }
    }
    const text = e.clipboardData?.getData('text/plain')

    // NOTE: verse-block formatting is decoration-only (see buildLiveDecorations).
    // We intentionally do NOT transform pasted text here — it stays plain so that
    // copying it back out yields the original plain text.

    // Paste URL as markdown link
    if (text && /^https?:\/\/\S+$/.test(text.trim())) {
      e.preventDefault()
      const urlSel = view.state.selection.main
      if (!urlSel.empty) {
        const selectedText = view.state.sliceDoc(urlSel.from, urlSel.to)
        view.dispatch({
          changes: { from: urlSel.from, to: urlSel.to, insert: `[${selectedText}](${text.trim()})` },
          selection: { anchor: urlSel.from + selectedText.length + text.trim().length + 4 },
        })
      } else {
        // No selection: use the URL itself as the display text → [url](url)
        const url = text.trim()
        view.dispatch({
          changes: { from: urlSel.from, insert: `[${url}](${url})` },
          selection: { anchor: urlSel.from + url.length * 2 + 4 },
        })
      }
      return true
    }
    return false
  },
})

function openEditorLink(url: string, noteId?: string, noteTitle?: string) {
  // berean-pdf://{pdfId}/{page} — open the PDF tab at that page
  const pdfMatch = url.match(/^berean-pdf:\/\/([^/]+)\/(\d+)/)
  if (pdfMatch) {
    const pdfId = pdfMatch[1]
    const page = parseInt(pdfMatch[2], 10)
    window.pdf?.get?.(pdfId).then((doc) => {
      useAppStore.getState().openPdf(pdfId, doc?.title ?? 'PDF', page)
    }).catch(() => useAppStore.getState().openPdf(pdfId, 'PDF', page))
    return
  }
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/)
  if (ytMatch) {
    const tMatch = url.match(/[?&]t=(\d+)/)
    const fromNote = noteId ? { noteId, title: noteTitle ?? 'Note' } : undefined
    useAppStore.getState().openYouTubeVideo(ytMatch[1], tMatch ? parseInt(tMatch[1], 10) : 0, fromNote)
  } else {
    window.app.openExternal(url)
  }
}

// ─── End of preview helpers ────────────────────────────────────────────────────

// ─── Collapsible headings ─────────────────────────────────────────────────────

export const collapseHeadingEffect = StateEffect.define<{ lineFrom: number; collapsed: boolean }>()

export const collapsedHeadingsField = StateField.define<ReadonlySet<number>>({
  create: () => new Set<number>(),
  update(val, tr) {
    let next: Set<number> | null = null
    for (const e of tr.effects) {
      if (e.is(collapseHeadingEffect)) {
        if (!next) next = new Set(val)
        if (e.value.collapsed) next.add(e.value.lineFrom)
        else next.delete(e.value.lineFrom)
      }
    }
    // Map positions through doc changes so collapsed positions stay valid
    if (tr.docChanged && !next) {
      next = new Set<number>()
      for (const pos of val) next.add(tr.changes.mapPos(pos))
    } else if (tr.docChanged && next) {
      const mapped = new Set<number>()
      for (const pos of next) mapped.add(tr.changes.mapPos(pos))
      next = mapped
    }
    return next ?? val
  },
})

/** Parse heading level (1-6) from a line, or 0 if not a heading. */
function headingLevel(lineText: string): number {
  const m = lineText.match(/^(#{1,6}) /)
  return m ? m[1].length : 0
}

/** Widget shown at the end of a collapsed heading section. */
class CollapsedHeadingWidget extends WidgetType {
  constructor(readonly level: number, readonly lineCount: number) { super() }
  eq(other: WidgetType) {
    return other instanceof CollapsedHeadingWidget &&
      other.level === this.level && other.lineCount === this.lineCount
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-collapsed-heading-pill'
    el.textContent = `  ···  ${this.lineCount} line${this.lineCount !== 1 ? 's' : ''}`
    el.style.cssText = 'display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;font-size:0.75em;opacity:0.55;background:rgba(100,116,139,0.18);cursor:pointer;vertical-align:middle;user-select:none;'
    return el
  }
  ignoreEvent() { return false }
}

// Exact font-sizes from headingStyle — setting the arrow to the same em size as the
// heading text means their baselines (and therefore their optical centres) sit at
// the same vertical position in the line box. No vertical-align trick needed.
const HEADING_FONT_SIZES_EM = [1.71, 1.43, 1.29, 1.0, 1.0, 1.0] // h1 … h6

class CollapseArrowWidget extends WidgetType {
  constructor(readonly isCollapsed: boolean, readonly level: number) { super() }
  eq(other: WidgetType) {
    return other instanceof CollapseArrowWidget &&
      other.isCollapsed === this.isCollapsed && other.level === this.level
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-heading-collapse-arrow'
    el.textContent = this.isCollapsed ? '▸' : '▾'
    // Match the heading's font-size exactly so the arrow sits at the same
    // optical centre as the heading text (baseline-aligned siblings with
    // identical metrics → visually centred on the line).
    const size = HEADING_FONT_SIZES_EM[Math.min(this.level - 1, HEADING_FONT_SIZES_EM.length - 1)]
    el.style.fontSize = `${size}em`
    return el
  }
  ignoreEvent() { return false }
}

/** Build block replace decorations that hide collapsed heading content. */
function buildCollapsedHeadingDecos(state: EditorState): DecorationSet {
  const collapsed = state.field(collapsedHeadingsField, false)
  if (!collapsed || collapsed.size === 0) return Decoration.none
  const doc = state.doc
  const builder = new RangeSetBuilder<Decoration>()
  const entries: Array<{ lineFrom: number; lineNum: number; level: number }> = []
  for (const lineFrom of collapsed) {
    if (lineFrom >= doc.length) continue
    try {
      const ln = doc.lineAt(lineFrom)
      const lvl = headingLevel(ln.text)
      if (lvl > 0) entries.push({ lineFrom, lineNum: ln.number, level: lvl })
    } catch { /* skip */ }
  }
  entries.sort((a, b) => a.lineFrom - b.lineFrom)
  for (const { lineFrom, lineNum, level } of entries) {
    const headLine = doc.line(lineNum)
    let endLineNum = lineNum
    while (endLineNum + 1 <= doc.lines) {
      const nextLine = doc.line(endLineNum + 1)
      const nextLevel = headingLevel(nextLine.text)
      // Stop at next same-or-higher-level heading
      if (nextLevel > 0 && nextLevel <= level) break
      // Stop at a horizontal rule (--- / *** / ___) — text below the divider stays visible
      const trimmedNext = nextLine.text.trim()
      if (trimmedNext === '---' || trimmedNext === '***' || trimmedNext === '___') break
      endLineNum++
    }
    // Trim trailing blank lines so the collapse ends at the last line with actual text
    while (endLineNum > lineNum && doc.line(endLineNum).text.trim() === '') endLineNum--

    if (endLineNum <= lineNum) continue
    const hideFrom = headLine.to         // end of heading line (after text, before newline)
    const hideTo   = doc.line(endLineNum).to
    const lineCount = endLineNum - lineNum
    builder.add(
      hideFrom, hideTo,
      Decoration.replace({
        widget: new CollapsedHeadingWidget(level, lineCount),
        block: false,
        inclusive: false,
      })
    )
  }
  return builder.finish()
}

const collapsedHeadingDecoField = StateField.define<DecorationSet>({
  create(state) { return buildCollapsedHeadingDecos(state) },
  update(decos, tr) {
    const hasEffect = tr.effects.some(e => e.is(collapseHeadingEffect))
    if (tr.docChanged || hasEffect) return buildCollapsedHeadingDecos(tr.state)
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

// --- Live markdown preview plugin ---

function cursorOnLine(state: EditorState, nodeFrom: number, focused: boolean): boolean {
  if (!focused) return false
  const line = state.doc.lineAt(nodeFrom)
  return state.selection.ranges.some(r => r.head >= line.from && r.head <= line.to)
}

type DecoKind = 'line' | 'mark' | 'replace'
interface DecoInfo { from: number; to: number; deco: Decoration; kind: DecoKind }

const hide = Decoration.replace({})

class InlineWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) { super() }
  toDOM() {
    const el = document.createElement('span')
    el.className = this.cls
    el.textContent = this.text
    return el
  }
  eq(other: InlineWidget) { return other.text === this.text && other.cls === this.cls }
}

class CalloutBlockWidget extends WidgetType {
  constructor(
    readonly calloutType: string,
    readonly calloutTitle: string,
    readonly bodyText: string,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof CalloutBlockWidget
      && other.calloutType === this.calloutType
      && other.calloutTitle === this.calloutTitle
      && other.bodyText === this.bodyText
  }

  toDOM() {
    const meta = CALLOUT_META[this.calloutType] ?? CALLOUT_META.NOTE
    const el = document.createElement('div')
    el.style.cssText = `border-left:3px solid ${meta.border};background:${meta.bg};border-radius:4px;padding:6px 10px 6px 10px;margin:2px 0;font-family:inherit;font-size:inherit;line-height:1.5;cursor:text;user-select:none;`
    const header = document.createElement('div')
    header.style.cssText = `display:flex;align-items:center;gap:6px;font-weight:600;color:${meta.color};margin-bottom:${this.bodyText ? '3px' : '0'};`
    header.textContent = `${meta.icon} ${this.calloutTitle}`
    el.appendChild(header)
    if (this.bodyText.trim()) {
      const body = document.createElement('div')
      body.style.cssText = 'opacity:0.85;white-space:pre-wrap;'
      // Render inline markdown per line so links (incl. YouTube timestamp links),
      // bold, and italic stay live even when the callout is not selected. textContent
      // would show them as raw "[label](url)" text — this keeps them clickable.
      try {
        body.innerHTML = this.bodyText
          .split('\n')
          .map((line) => marked.parseInline(line) as string)
          .join('<br>')
        body.querySelectorAll('a').forEach((a) => {
          a.style.color = 'rgb(99,102,241)'
          a.style.textDecoration = 'underline'
          a.style.cursor = 'pointer'
        })
        body.style.userSelect = 'none'
        body.addEventListener('mousedown', (ev) => {
          const anchor = (ev.target as HTMLElement).closest('a')
          if (anchor) {
            ev.preventDefault()
            ev.stopPropagation()
            const href = anchor.getAttribute('href') ?? ''
            if (/^https?:\/\//.test(href)) openEditorLink(href)
          }
        })
      } catch {
        body.textContent = this.bodyText
      }
      el.appendChild(body)
    }
    return el
  }

  ignoreEvent(event: Event) {
    // Let mousedown on links reach our handler; ignore other events (CM default).
    if (event.type === 'mousedown') {
      const t = event.target as HTMLElement | null
      if (t && t.closest('a')) return true
    }
    return false
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super() }
  eq(other: WidgetType) { return other instanceof TaskCheckboxWidget && other.checked === this.checked }
  toDOM() {
    const span = document.createElement('span')
    span.style.cssText = 'display:inline-flex;align-items:center;vertical-align:middle;margin-right:4px;'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.disabled = true
    cb.style.cssText = 'width:13px;height:13px;cursor:default;pointer-events:none;'
    span.appendChild(cb)
    return span
  }
}

function buildLiveDecorations(view: EditorView): DecorationSet {
  const decos: DecoInfo[] = []
  const { from: vpFrom, to: vpTo } = view.viewport
  const state = view.state
  const doc = state.doc
  const focused = view.hasFocus
  const wysiwyg = view.state.field(wysiwygField)
  // In WYSIWYG mode, cursor is never "on" any line for decoration purposes — all
  // syntax markers are hidden globally so the text looks clean while staying editable.
  const col = wysiwyg ? (_: number) => false : (nodeFrom: number) => cursorOnLine(state, nodeFrom, focused)
  const collapsed = state.field(collapsedHeadingsField, false) ?? new Set<number>()

  // Read ALL store settings up front — before syntaxTree.iterate() — so
  // the callback closures can access them without hitting the TDZ for `const`.
  const storeSnapshot = useAppStore.getState()
  const headingDivider = storeSnapshot.noteHeadingDivider
  const noteVerseRefsEnabled = storeSnapshot.noteVerseRefsEnabled
  const noteLexiconRefsEnabled = storeSnapshot.noteLexiconRefsEnabled
  const noteScriptureBlock = storeSnapshot.noteScriptureBlock

  syntaxTree(state).iterate({
    from: vpFrom, to: vpTo,
    enter(node) {
      const { from, to, name } = node
      if (from >= to) return

      switch (name) {
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
        case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          if (!col(from)) {
            const lv = parseInt(name.slice(-1))
            const ln = doc.lineAt(from)
            const hClass = headingDivider ? `cm-live-h${lv} cm-live-h-divider` : `cm-live-h${lv}`
            decos.push({ from: ln.from, to: ln.from, deco: Decoration.line({ class: hClass }), kind: 'line' })
            // Collapse toggle arrow — shown at end of each heading in wysiwyg mode.
            // Uses CollapseArrowWidget (level-aware) so the triangle is proportional
            // to the heading's font size and vertically centred on the line.
            if (wysiwyg) {
              const isCollapsed = collapsed.has(ln.from)
              decos.push({
                from: ln.to, to: ln.to,
                deco: Decoration.widget({
                  widget: new CollapseArrowWidget(isCollapsed, lv),
                  side: 1,
                }),
                kind: 'mark',
              })
            }
          }
          break
        }
        case 'HeaderMark': {
          if (!col(from)) {
            const end = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
            decos.push({ from, to: Math.min(end, vpTo), deco: hide, kind: 'replace' })
          }
          break
        }
        case 'StrongEmphasis': {
          if (!col(from)) decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-bold' }), kind: 'mark' })
          break
        }
        case 'Emphasis': {
          if (!col(from)) decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-italic' }), kind: 'mark' })
          break
        }
        case 'EmphasisMark': {
          if (!col(from)) decos.push({ from, to, deco: hide, kind: 'replace' })
          break
        }
        case 'InlineCode': {
          if (!col(from)) decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-code' }), kind: 'mark' })
          break
        }
        case 'CodeMark': {
          // Only hide inline code marks (`); fenced code marks (```) keep showing
          if (!col(from) && node.node.parent?.name === 'InlineCode') {
            decos.push({ from, to, deco: hide, kind: 'replace' })
          }
          break
        }
        case 'FencedCode': {
          const blkFrom = doc.lineAt(from)
          const blkTo = doc.lineAt(Math.min(to, vpTo))
          const totalLines = blkTo.number - blkFrom.number + 1
          for (let lineNum = blkFrom.number; lineNum <= blkTo.number; lineNum++) {
            const ln = doc.line(lineNum)
            const isFirst = lineNum === blkFrom.number
            const isLast = lineNum === blkTo.number
            const isFenceLine = isFirst || isLast

            if (isFenceLine) {
              // Fence lines (```): show text when cursor is on this line, hide otherwise.
              // Always use the same font/height as code-block to avoid layout jumps.
              const textCls = col(ln.from) ? 'cm-live-code-block' : 'cm-live-code-fence'
              let cornerCls = ''
              if (totalLines === 1) cornerCls = ' cm-code-block-only'
              else if (isFirst) cornerCls = ' cm-code-block-top'
              else cornerCls = ' cm-code-block-bottom'
              decos.push({ from: ln.from, to: ln.from, deco: Decoration.line({ class: textCls + cornerCls }), kind: 'line' })
            } else {
              // Content lines — always visible, no extra rounding (fence handles corners)
              decos.push({ from: ln.from, to: ln.from, deco: Decoration.line({ class: 'cm-live-code-block' }), kind: 'line' })
            }
          }
          break
        }
        case 'Link': {
          if (!col(from)) decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-link' }), kind: 'mark' })
          break
        }
        case 'LinkMark': case 'URL': {
          if (!col(from)) decos.push({ from, to, deco: hide, kind: 'replace' })
          break
        }
        case 'Blockquote': {
          const blkFrom = doc.lineAt(from)
          const blkTo = doc.lineAt(Math.min(to, vpTo))
          const firstLineText = doc.sliceString(blkFrom.from, blkFrom.to)
          const calloutMatch = firstLineText.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i)

          if (calloutMatch) {
            // Check if cursor is inside this callout block
            const cursorInBlock = focused && state.selection.ranges.some(
              r => r.head >= blkFrom.from && r.head <= blkTo.to
            )
            if (!cursorInBlock) {
              // The calloutBlockField StateField renders the block widget.
              // Skip all child-node decorations (QuoteMark, etc.) for this block.
              return false
            }
            // Cursor inside — fall through to per-line styled rendering
          }

          // Regular blockquote OR cursor-inside callout: per-line styling
          for (let lineNum = blkFrom.number; lineNum <= blkTo.number; lineNum++) {
            const ln = doc.line(lineNum)
            if (!col(ln.from)) {
              const lineText = doc.sliceString(ln.from, ln.to)
              const isCalloutHeader = /^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.test(lineText)
              decos.push({
                from: ln.from, to: ln.from,
                deco: Decoration.line({ class: isCalloutHeader ? 'cm-live-callout-header' : 'cm-live-blockquote' }),
                kind: 'line'
              })
            }
          }
          break
        }
        case 'QuoteMark': {
          if (!col(from)) {
            const end = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
            decos.push({ from, to: Math.min(end, vpTo), deco: hide, kind: 'replace' })
          }
          break
        }
        case 'ListMark': {
          if (!col(from)) {
            const markText = doc.sliceString(from, to).trim()
            const afterMark = to < doc.length ? doc.sliceString(to, to + 1) : ''
            const end = afterMark === ' ' ? to + 1 : to
            // Skip bullet widget for task list items — the task renderer replaces the whole prefix
            const lineAfterMark = to < doc.length ? doc.sliceString(end, end + 3) : ''
            if (lineAfterMark === '[ ]' || lineAfterMark === '[x]' || lineAfterMark === '[X]') break
            // Ordered lists keep their numeric marker
            if (/^\d/.test(markText)) {
              decos.push({ from, to: Math.min(end, vpTo), deco: Decoration.replace({ widget: new InlineWidget(`${markText} `, 'cm-live-list-bullet') }), kind: 'replace' })
              break
            }
            // Unordered bullets: pick symbol based on indent level and bullet style setting
            const bulletLine = doc.lineAt(from)
            const leadingSpaces = bulletLine.text.length - bulletLine.text.trimStart().length
            const indentLevel = Math.min(Math.floor(leadingSpaces / 4), 4)
            const styleName = storeSnapshot.noteBulletStyle ?? 'classic'
            const styleDef = BULLET_STYLE_DEFS[styleName] ?? BULLET_STYLE_DEFS.classic
            const bulletChar = styleDef.symbols[indentLevel] ?? styleDef.symbols[0]
            decos.push({ from, to: Math.min(end, vpTo), deco: Decoration.replace({ widget: new InlineWidget(`${bulletChar} `, 'cm-live-list-bullet') }), kind: 'replace' })
          }
          break
        }
        case 'HorizontalRule': {
          if (!col(from)) {
            const ln = doc.lineAt(from)
            // Style the line as HR (mark text invisible + border)
            decos.push({ from: ln.from, to: ln.to, deco: Decoration.mark({ class: 'cm-live-hr-mark' }), kind: 'mark' })
            decos.push({ from: ln.from, to: ln.from, deco: Decoration.line({ class: 'cm-live-hr-line' }), kind: 'line' })
          }
          break
        }
      }
    }
  })

  // Regex-based patterns
  const text = doc.sliceString(vpFrom, vpTo)

  // ── Regex-based heading mark hiding (flash prevention) ────────────────────
  // Hides `# `, `## ` etc. immediately from the raw text, before the syntax tree
  // is fully parsed, preventing the brief flash of '#' chars when opening a note.
  // The syntax-tree path above provides the same decorations once the tree is ready;
  // duplicates are silently skipped by the RangeSetBuilder's lastReplaceEnd guard.
  if (wysiwyg) {
    const headRegex = /^(#{1,6}) /gm
    let hm: RegExpExecArray | null
    while ((hm = headRegex.exec(text)) !== null) {
      const level = hm[1].length
      const markFrom = vpFrom + hm.index
      const markTo   = markFrom + hm[1].length + 1   // '# ' = mark + space
      if (markTo > vpTo) break
      const lineFrom = doc.lineAt(markFrom).from
      const hCls = headingDivider ? `cm-live-h${level} cm-live-h-divider` : `cm-live-h${level}`
      decos.push({ from: lineFrom, to: lineFrom, deco: Decoration.line({ class: hCls }), kind: 'line' })
      decos.push({ from: markFrom, to: markTo,   deco: hide, kind: 'replace' })
    }

    // ── Regex-based horizontal-rule rendering (flash prevention) ────────────
    // A line that is exactly --- / *** / ___ becomes a divider. Without this the
    // raw dashes flash on screen until the syntax tree finishes parsing (the bug
    // seen when returning to a note).
    const hrRegex = /^(-{3,}|\*{3,}|_{3,})$/gm
    let rm: RegExpExecArray | null
    while ((rm = hrRegex.exec(text)) !== null) {
      const lineStart = vpFrom + rm.index
      const lineEnd   = lineStart + rm[0].length
      if (lineEnd > vpTo) break
      decos.push({ from: lineStart, to: lineEnd, deco: Decoration.mark({ class: 'cm-live-hr-mark' }), kind: 'mark' })
      decos.push({ from: lineStart, to: lineStart, deco: Decoration.line({ class: 'cm-live-hr-line' }), kind: 'line' })
    }
  }

  // Suppressed ranges (mapped through edits by the StateField)
  const suppressedRanges = view.state.field(suppressedRangesField)
  function isInSuppressedRange(from: number, to: number): boolean {
    return suppressedRanges.some(r => r.from < to && r.to > from)
  }

  // Use InlineWidget replace for patterns that need prefix/suffix hiding
  const addWidgetRegex = (re: RegExp, widgetClass: string) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const from = vpFrom + m.index
      const to = from + m[0].length
      if (col(from)) continue
      decos.push({ from, to, deco: Decoration.replace({ widget: new InlineWidget(m[1], widgetClass) }), kind: 'replace' })
    }
  }

  // Use mark + hide for underline (so it stays editable-looking).
  // fixedPrefixLen / fixedSuffixLen: explicit byte counts for the opening/closing markers,
  // used when the inner capture group may contain '<' (nested HTML) which would fool indexOf.
  const addMarkRegex = (re: RegExp, markClass: string, fixedPrefixLen?: number, fixedSuffixLen?: number) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const from = vpFrom + m.index
      const to = from + m[0].length
      if (col(from)) continue
      const inner = m[1]
      const prefixLen = fixedPrefixLen ?? m[0].indexOf(inner)
      const suffixLen = fixedSuffixLen ?? (m[0].length - prefixLen - inner.length)
      if (prefixLen < 0 || suffixLen < 0 || prefixLen + suffixLen > m[0].length) continue
      decos.push({ from, to: from + prefixLen, deco: hide, kind: 'replace' })
      decos.push({ from: from + prefixLen, to: to - suffixLen, deco: Decoration.mark({ class: markClass }), kind: 'mark' })
      if (suffixLen > 0) decos.push({ from: to - suffixLen, to, deco: hide, kind: 'replace' })
    }
  }

  addWidgetRegex(/~~([^~\n]+?)~~/g, 'cm-live-strike')
  addWidgetRegex(/\[\[([^\]\n]+?)\]\]/g, 'cm-live-wikilink')
  // Underline: allow nested HTML tags (e.g. <mark> inside <u>) — prefix=3 (<u>), suffix=4 (</u>)
  addMarkRegex(/<u>((?:[^<]|<(?!\/u)[^>]*>)*)<\/u>/g, 'cm-live-underline', 3, 4)
  addMarkRegex(/==([^=\n]+?)==/g, 'cm-live-highlight')
  // Colored highlight marks: allow nested HTML (e.g. <u>, <b> inside <mark class="hl-X">)
  // The inner pattern `((?:[^<]|<(?!\/?mark)[^>]*>)*)` matches any content that isn't
  // a nested <mark> or </mark>, including simple inline tags like <u>, <b>, <i>.
  for (const { id } of NOTE_HL_COLORS) {
    const prefixLen = 18 + id.length  // `<mark class="hl-${id}">` byte count
    addMarkRegex(
      new RegExp(`<mark class="hl-${id}">((?:[^<]|<(?!\\/?mark)[^>]*>)*)<\\/mark>`, 'g'),
      `cm-live-hl-${id}`,
      prefixLen,
      7,  // `</mark>` = 7 bytes
    )
  }

  // Alignment line decorations — apply alignment class and hide the raw HTML div tags
  {
    const alignLineRe = /^(<div align="(center|right|justify|left)">)(.*?)(<\/div>)$/
    const firstLine = doc.lineAt(vpFrom).number
    const lastLine = doc.lineAt(Math.min(vpTo, doc.length > 0 ? doc.length - 1 : 0)).number
    for (let ln = firstLine; ln <= lastLine; ln++) {
      try {
        const line = doc.line(ln)
        const m = alignLineRe.exec(line.text)
        if (!m) continue
        const align = m[2]
        const prefixLen = m[1].length   // length of '<div align="X">'
        const suffixLen = m[4].length   // length of '</div>' = 6
        if (col(line.from)) continue    // cursor on this line — show raw HTML so user can edit
        if (align !== 'left') {
          decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-live-align-${align}` }), kind: 'line' })
        }
        // Hide the opening and closing div tags
        decos.push({ from: line.from, to: line.from + prefixLen, deco: hide, kind: 'replace' })
        decos.push({ from: line.to - suffixLen, to: line.to, deco: hide, kind: 'replace' })
      } catch { break }
    }
  }

  // Task list: render checkbox widget + strike done items
  {
    const taskRe = /^- \[([ xX])\] /gm
    const taskText = doc.sliceString(vpFrom, vpTo)
    taskRe.lastIndex = 0
    let tm: RegExpExecArray | null
    while ((tm = taskRe.exec(taskText)) !== null) {
      const isChecked = tm[1] !== ' '
      const lineFrom = vpFrom + tm.index
      const prefixTo = lineFrom + tm[0].length
      const line = doc.lineAt(lineFrom)
      if (!col(line.from)) {
        // Replace "- [ ] " or "- [x] " with an actual checkbox widget
        decos.push({ from: line.from, to: prefixTo, deco: Decoration.replace({ widget: new TaskCheckboxWidget(isChecked) }), kind: 'replace' })
        if (isChecked) {
          decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-live-task-done' }), kind: 'line' })
        }
      }
    }
  }

  // Verse blocks — plain text styled like a scripture quote (decoration only).
  // The document text is NEVER modified; only line/mark decorations are applied,
  // so copying the text yields the original plain text. The block is only formatted
  // if its text matches the real verse text by at least `threshold` (so commentary
  // like "Genesis 5:4 my thoughts" is left untouched).
  if (noteScriptureBlock) {
    const threshold = storeSnapshot.noteScriptureBlockThreshold ?? 0.9
    const onResolved = () => { try { view.dispatch({ effects: refreshDecorationsEffect.of(null) }) } catch { /* view gone */ } }
    const firstLineNum = doc.lineAt(vpFrom).number
    const lastLineNum = doc.lineAt(Math.min(vpTo, doc.length > 0 ? doc.length - 1 : 0)).number
    let ln = firstLineNum
    while (ln <= lastLineNum) {
      const line = doc.line(ln)
      const trimmed = line.text.trim()
      const leadWs = line.text.length - line.text.trimStart().length

      // A) Multi-line block: verse-level ref line + following numbered verse lines
      if (trimmed.includes(':') && parseRef(trimmed) &&
          ln + 1 <= doc.lines && VERSE_BODY_LINE_RE.test(doc.line(ln + 1).text)) {
        let endLn = ln + 1
        while (endLn + 1 <= doc.lines && VERSE_BODY_LINE_RE.test(doc.line(endLn + 1).text)) endLn++
        // Build candidate text: body lines with leading verse numbers stripped
        const bodyParts: string[] = []
        for (let i = ln + 1; i <= endLn; i++) bodyParts.push(doc.line(i).text.replace(/^\s*\d{1,3}[ \t]+/, ''))
        const accepted = verseTextAccepted(trimmed, bodyParts.join(' '), threshold, onResolved)
        if (accepted !== false) {
          for (let i = ln; i <= endLn; i++) {
            const L = doc.line(i)
            let cls = 'cm-live-verse-block'
            if (i === ln) cls += ' cm-live-verse-block-first'
            if (i === endLn) cls += ' cm-live-verse-block-last'
            decos.push({ from: L.from, to: L.from, deco: Decoration.line({ class: cls }), kind: 'line' })
          }
          decos.push({ from: line.from + leadWs, to: line.to, deco: Decoration.mark({ class: 'cm-live-verse-block-ref' }), kind: 'mark' })
        }
        ln = endLn + 1
        continue
      }

      // B) Single-line block: "Book c:v verse text…"
      const m = SINGLE_VERSE_LINE_RE.exec(line.text)
      if (m && parseRef(m[2])) {
        const accepted = verseTextAccepted(m[2], m[3], threshold, onResolved)
        if (accepted !== false) {
          decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-live-verse-block cm-live-verse-block-first cm-live-verse-block-last' }), kind: 'line' })
          const refFrom = line.from + m[1].length
          const refTo = refFrom + m[2].length
          decos.push({ from: refFrom, to: refTo, deco: Decoration.mark({ class: 'cm-live-verse-block-ref' }), kind: 'mark' })
        }
      }
      ln++
    }
  }

  // Bible verse refs — uses findVerseRefMatches so a single line can hold any
  // number of references (e.g. "Romans 10:1-2 vs Deuteronomy 18:15-19").
  if (noteVerseRefsEnabled) {
    // LXX-prefixed refs (lxx: / LXX:) — handled separately, rendered violet.
    const lxxRefRe = /\b(?:lxx|LXX):(?:[1-3][ \t]*)?[A-Za-z][a-z]+(?:[ \t]+(?:of[ \t]+)?[A-Za-z][a-z]+)?[ \t]+\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?\b/g
    const lxxPrefixRanges: Array<{ from: number; to: number }> = []
    lxxRefRe.lastIndex = 0
    let lm: RegExpExecArray | null
    while ((lm = lxxRefRe.exec(text)) !== null) {
      const from = vpFrom + lm.index
      const to = from + lm[0].length
      if (!parseRef(lm[0].replace(/^(?:lxx|LXX):/i, ''))) continue
      if (isInSuppressedRange(from, to)) continue
      lxxPrefixRanges.push({ from, to })
      decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-lxx-ref' }), kind: 'mark' })
    }

    // All other refs (with " LXX" suffix → violet, otherwise accent)
    for (const ma of findVerseRefMatches(text)) {
      const from = vpFrom + ma.index
      const to = from + ma.length
      if (isInSuppressedRange(from, to)) continue
      if (lxxPrefixRanges.some(r => r.from < to && r.to > from)) continue
      decos.push({
        from, to,
        deco: Decoration.mark({ class: ma.lxx ? 'cm-live-lxx-ref' : 'cm-live-verse-ref' }),
        kind: 'mark',
      })
    }
  }

  // Lexicon refs — Strong's numbers like H7225 or G3056
  if (noteLexiconRefsEnabled) {
    const lexiconRefRe = /\b[HGhg]\d{1,5}\b/g
    lexiconRefRe.lastIndex = 0
    let lm: RegExpExecArray | null
    while ((lm = lexiconRefRe.exec(text)) !== null) {
      const from = vpFrom + lm.index
      const to = from + lm[0].length
      if (isInSuppressedRange(from, to)) continue
      decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-lexicon-ref' }), kind: 'mark' })
    }
  }

  // Sort: by from ASC, then line decos first for same from (from===to)
  decos.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from
    if (a.kind === 'line' && b.kind !== 'line') return -1
    if (a.kind !== 'line' && b.kind === 'line') return 1
    return a.to - b.to
  })

  const builder = new RangeSetBuilder<Decoration>()
  let lastReplaceEnd = -1
  for (const { from, to, deco, kind } of decos) {
    try {
      if (kind === 'replace') {
        if (from >= lastReplaceEnd && from < to) {
          builder.add(from, to, deco)
          lastReplaceEnd = to
        }
      } else {
        builder.add(from, to, deco)
      }
    } catch { /* skip overlapping */ }
  }
  return builder.finish()
}

const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildLiveDecorations(view) }
    update(u: ViewUpdate) {
      const hasSpecialEffect = u.transactions.some(tr =>
        tr.effects.some(e => e.is(refreshDecorationsEffect) || e.is(setSuppressedEffect) || e.is(wysiwygEffect))
      )
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || hasSpecialEffect)
        this.decorations = buildLiveDecorations(u.view)
    }
  },
  { decorations: v => v.decorations }
)

// ─── Callout block StateField ─────────────────────────────────────────────────
// ─── Table block widget (renders GFM tables in raw editor) ───────────────────

function parseTableCells(line: string): string[] {
  // Split on | and trim, skipping empty leading/trailing cells from the outer pipes
  const parts = line.split('|')
  if (parts[0].trim() === '') parts.shift()
  if (parts[parts.length - 1].trim() === '') parts.pop()
  return parts.map(c => c.trim())
}

function isTableSep(line: string): boolean {
  return /^\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?$/.test(line.trim()) && line.includes('-')
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.includes('|', 1)
}

// ─── WYSIWYG table module-level view reference ────────────────────────────────
// The table widget needs to dispatch changes back to the editor. Using a module-
// level reference is pragmatic: only one NoteEditor is interacted-with at a time.
let _tableView: EditorView | null = null

// ─── Markdown table rebuild helpers ──────────────────────────────────────────

function sepFromAlignment(a: 'left' | 'center' | 'right'): string {
  if (a === 'center') return ':---:'
  if (a === 'right') return '---:'
  return '---'
}

function buildTableMarkdown(
  headers: string[],
  alignments: ('left' | 'center' | 'right')[],
  rows: string[][],
): string {
  const hLine = '| ' + headers.join(' | ') + ' |'
  const sLine = '| ' + headers.map((_, i) => sepFromAlignment(alignments[i] ?? 'left')).join(' | ') + ' |'
  const bLines = rows.map(row => '| ' + headers.map((_, i) => row[i] ?? '').join(' | ') + ' |')
  return [hLine, sLine, ...bLines].join('\n')
}

// ─── Table block widget ───────────────────────────────────────────────────────

const BTN_BASE = 'cursor-pointer border-none outline-none font-inherit'

class TableBlockWidget extends WidgetType {
  constructor(
    readonly headers: string[],
    readonly alignments: ('left' | 'center' | 'right')[],
    readonly rows: string[][],
    readonly rawText: string,
    readonly blockFrom: number = 0,
    readonly blockTo: number = 0,
    readonly wysiwyg: boolean = false,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof TableBlockWidget
      && other.rawText === this.rawText
      && other.wysiwyg === this.wysiwyg
  }

  // Dispatch a table replacement. `from`/`to` are the stored block positions;
  // we verify they still contain the expected markdown before dispatching.
  private dispatch(newMarkdown: string) {
    const view = _tableView
    if (!view) return
    const safeFrom = Math.min(this.blockFrom, view.state.doc.length)
    const safeTo   = Math.min(this.blockTo,   view.state.doc.length)
    view.dispatch({ changes: { from: safeFrom, to: safeTo, insert: newMarkdown }, userEvent: 'table.edit' })
  }

  // ── Static (non-editable) rendering ──────────────────────────────────────

  private buildStaticTable(): HTMLTableElement {
    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;width:100%;font-size:0.8rem;font-family:inherit;'

    const thead = table.createTHead()
    const hr = thead.insertRow()
    this.headers.forEach((h, i) => {
      const th = document.createElement('th')
      th.style.cssText = `border:1px solid rgba(100,116,139,0.35);padding:4px 10px;background:rgba(100,116,139,0.1);font-weight:600;text-align:${this.alignments[i] ?? 'left'};`
      th.innerHTML = marked.parseInline(h) as string
      hr.appendChild(th)
    })

    const tbody = table.createTBody()
    this.rows.forEach((row, ri) => {
      const tr = tbody.insertRow()
      if (ri % 2 === 1) tr.style.background = 'rgba(100,116,139,0.07)'
      this.headers.forEach((_, i) => {
        const td = document.createElement('td')
        td.style.cssText = `border:1px solid rgba(100,116,139,0.35);padding:4px 10px;text-align:${this.alignments[i] ?? 'left'};`
        td.innerHTML = marked.parseInline(row[i] ?? '') as string
        tr.appendChild(td)
      })
    })
    return table
  }

  // ── WYSIWYG editable rendering ────────────────────────────────────────────

  private buildWysiwygDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'overflow-x:auto;margin:4px 0;position:relative;'

    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;width:100%;font-size:0.8rem;font-family:inherit;'

    const CELL_BASE = 'border:1px solid rgba(100,116,139,0.35);padding:2px 6px;vertical-align:top;min-width:60px;'
    const HDEL_BTN  = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:3px;font-size:9px;line-height:1;background:rgba(100,116,139,0.15);color:rgba(var(--color-text-muted),0.8);border:none;cursor:pointer;margin-left:4px;flex-shrink:0;vertical-align:middle;padding:0;'
    const RDEL_BTN  = 'display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;font-size:10px;line-height:1;background:rgba(100,116,139,0.15);color:rgba(var(--color-text-muted),0.8);border:none;cursor:pointer;padding:0;'

    // ── Header row ──────────────────────────────────────────────────────────
    const thead = table.createTHead()
    const hr = thead.insertRow()

    this.headers.forEach((h, colIdx) => {
      const th = document.createElement('th')
      th.style.cssText = CELL_BASE + `background:rgba(100,116,139,0.12);text-align:${this.alignments[colIdx] ?? 'left'};`

      // editable header cell — always displays rendered markdown, never raw syntax
      const cell = document.createElement('span')
      cell.contentEditable = 'true'
      cell.style.cssText = 'display:inline;outline:none;min-width:20px;white-space:pre-wrap;'
      cell.dataset.rawValue = h
      cell.innerHTML = marked.parseInline(h) as string
      cell.dataset.col = String(colIdx)
      cell.dataset.row = 'header'
      // Track plain-text edits without switching to raw mode
      cell.addEventListener('input', () => { cell.dataset.rawValue = cell.innerText.trim() })
      cell.addEventListener('blur', () => {
        const raw = cell.dataset.rawValue ?? ''
        cell.innerHTML = marked.parseInline(raw) as string
        this.onCellBlur(wrap)
      })
      cell.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cell.blur() } })
      th.appendChild(cell)

      // delete-column button
      const del = document.createElement('button')
      del.innerHTML = '×'
      del.style.cssText = HDEL_BTN
      del.title = `Delete column "${h}"`
      del.onmousedown = (e) => { e.preventDefault(); this.deleteCol(colIdx) }
      th.appendChild(del)

      hr.appendChild(th)
    })

    // + add column cell in header
    const addColTh = document.createElement('th')
    addColTh.style.cssText = CELL_BASE + 'background:rgba(100,116,139,0.06);width:28px;padding:2px 4px;'
    const addColBtn = document.createElement('button')
    addColBtn.innerHTML = '+'
    addColBtn.title = 'Add column'
    addColBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;font-size:13px;line-height:1;background:rgba(100,116,139,0.15);color:rgba(var(--color-text-muted),1);border:none;cursor:pointer;padding:0;'
    addColBtn.onmousedown = (e) => { e.preventDefault(); this.addCol() }
    addColTh.appendChild(addColBtn)
    hr.appendChild(addColTh)

    // ── Body rows ────────────────────────────────────────────────────────────
    const tbody = table.createTBody()
    this.rows.forEach((row, rowIdx) => {
      const tr = tbody.insertRow()
      if (rowIdx % 2 === 1) tr.style.background = 'rgba(100,116,139,0.05)'

      this.headers.forEach((_, colIdx) => {
        const td = document.createElement('td')
        td.style.cssText = CELL_BASE + `text-align:${this.alignments[colIdx] ?? 'left'};`

        const cell = document.createElement('span')
        cell.contentEditable = 'true'
        cell.style.cssText = 'display:block;outline:none;min-height:1em;white-space:pre-wrap;'
        const cellRaw = row[colIdx] ?? ''
        cell.dataset.rawValue = cellRaw
        cell.innerHTML = marked.parseInline(cellRaw) as string
        cell.dataset.col = String(colIdx)
        cell.dataset.row = String(rowIdx)
        // Track plain-text edits without switching to raw mode
        cell.addEventListener('input', () => { cell.dataset.rawValue = cell.innerText.trim() })
        cell.addEventListener('blur', () => {
          const raw = cell.dataset.rawValue ?? ''
          cell.innerHTML = marked.parseInline(raw) as string
          this.onCellBlur(wrap)
        })
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cell.blur() } })
        td.appendChild(cell)
        tr.appendChild(td)
      })

      // delete-row button column
      const delTd = document.createElement('td')
      delTd.style.cssText = CELL_BASE + 'width:22px;padding:2px 3px;border-left:none;vertical-align:middle;'
      const delBtn = document.createElement('button')
      delBtn.innerHTML = '×'
      delBtn.title = `Delete row ${rowIdx + 1}`
      delBtn.style.cssText = RDEL_BTN
      delBtn.onmousedown = (e) => { e.preventDefault(); this.deleteRow(rowIdx) }
      delTd.appendChild(delBtn)
      tr.appendChild(delTd)
    })

    wrap.appendChild(table)

    // ── "Add row" button ─────────────────────────────────────────────────────
    const addRowBtn = document.createElement('button')
    addRowBtn.textContent = '+ Add row'
    addRowBtn.title = 'Add a row below the last row'
    addRowBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-top:3px;padding:2px 8px;font-size:11px;font-family:inherit;border-radius:4px;border:1px solid rgba(100,116,139,0.3);background:rgba(100,116,139,0.08);color:rgba(var(--color-text-muted),1);cursor:pointer;'
    addRowBtn.onmousedown = (e) => { e.preventDefault(); this.addRow() }
    wrap.appendChild(addRowBtn)

    return wrap
  }

  // Read all contenteditable cell values from the rendered widget and commit
  private onCellBlur(wrap: HTMLElement) {
    const view = _tableView
    if (!view) return
    const headerCells = Array.from(wrap.querySelectorAll<HTMLElement>('span[data-row="header"]'))
      .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col))
    // Use dataset.rawValue (set on blur) so we read the raw markdown,
    // not the rendered HTML text content which strips syntax markers.
    const newHeaders = headerCells.map(c => (c.dataset.rawValue ?? c.textContent ?? '').trim())

    const rowCount = this.rows.length
    const colCount = this.headers.length
    const newRows: string[][] = Array.from({ length: rowCount }, () => Array(colCount).fill(''))
    wrap.querySelectorAll<HTMLElement>('span[data-row]').forEach((cell) => {
      const ri = parseInt(cell.dataset.row ?? '-1')
      const ci = parseInt(cell.dataset.col ?? '-1')
      if (ri >= 0 && ci >= 0 && ri < rowCount && ci < colCount) {
        newRows[ri][ci] = (cell.dataset.rawValue ?? cell.textContent ?? '').trim()
      }
    })
    const newMd = buildTableMarkdown(newHeaders, this.alignments, newRows)
    if (newMd !== this.rawText) this.dispatch(newMd)
  }

  private addRow() {
    const newRows = [...this.rows, Array(this.headers.length).fill('')]
    this.dispatch(buildTableMarkdown(this.headers, this.alignments, newRows))
  }

  private deleteRow(rowIdx: number) {
    if (this.rows.length <= 1) return  // keep at least one row
    const newRows = this.rows.filter((_, i) => i !== rowIdx)
    this.dispatch(buildTableMarkdown(this.headers, this.alignments, newRows))
  }

  private addCol() {
    const newHeaders  = [...this.headers, 'Column']
    const newAligns   = [...this.alignments, 'left' as const]
    const newRows     = this.rows.map(row => [...row, ''])
    this.dispatch(buildTableMarkdown(newHeaders, newAligns, newRows))
  }

  private deleteCol(colIdx: number) {
    if (this.headers.length <= 1) return  // keep at least one column
    const newHeaders = this.headers.filter((_, i) => i !== colIdx)
    const newAligns  = this.alignments.filter((_, i) => i !== colIdx)
    const newRows    = this.rows.map(row => row.filter((_, i) => i !== colIdx))
    this.dispatch(buildTableMarkdown(newHeaders, newAligns, newRows))
  }

  toDOM() {
    if (this.wysiwyg) return this.buildWysiwygDOM()
    const wrap = document.createElement('div')
    wrap.style.cssText = 'overflow-x:auto;margin:4px 0;cursor:text;user-select:none;'
    wrap.appendChild(this.buildStaticTable())
    return wrap
  }

  ignoreEvent(event: Event) {
    // In wysiwyg mode let the DOM handle all events (contenteditable cells, buttons)
    return this.wysiwyg
  }
}

function buildTableBlockDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc
  let lineNum = 1
  // Use wysiwyg mode: tables always visible, cells editable
  const wysiwyg = state.field(wysiwygField, false) ?? false

  while (lineNum <= doc.lines) {
    const line = doc.line(lineNum)

    if (!isTableRow(line.text) || lineNum + 1 > doc.lines) { lineNum++; continue }
    const sepLine = doc.line(lineNum + 1)
    if (!isTableSep(sepLine.text)) { lineNum++; continue }

    let endLineNum = lineNum + 1
    while (endLineNum + 1 <= doc.lines) {
      const next = doc.line(endLineNum + 1)
      if (!isTableRow(next.text)) break
      endLineNum++
    }
    const endLine = doc.line(endLineNum)

    // In wysiwyg mode: always show the widget.
    // In raw/preview mode: only show when cursor is NOT in the block.
    const cursorInBlock = state.selection.ranges.some(
      r => r.head >= line.from && r.head <= endLine.to
    )
    if (!wysiwyg && cursorInBlock) { lineNum = endLineNum + 1; continue }

    const headerCells = parseTableCells(line.text)
    const sepCells = parseTableCells(sepLine.text)
    const alignments = sepCells.map((s): 'left' | 'center' | 'right' => {
      const t = s.trim()
      if (t.startsWith(':') && t.endsWith(':')) return 'center'
      if (t.endsWith(':')) return 'right'
      return 'left'
    })
    const rows: string[][] = []
    for (let r = lineNum + 2; r <= endLineNum; r++) {
      rows.push(parseTableCells(doc.line(r).text))
    }
    const rawText = doc.sliceString(line.from, endLine.to)
    builder.add(
      line.from, endLine.to,
      Decoration.replace({
        widget: new TableBlockWidget(headerCells, alignments, rows, rawText, line.from, endLine.to, wysiwyg),
        block: true,
      })
    )

    lineNum = endLineNum + 1
  }

  return builder.finish()
}

const tableBlockField = StateField.define<DecorationSet>({
  create(state) { return buildTableBlockDecos(state) },
  update(decos, tr) {
    const wysiwygToggled = tr.effects.some(e => e.is(wysiwygEffect))
    if (tr.docChanged || wysiwygToggled || !tr.startState.selection.eq(tr.state.selection))
      return buildTableBlockDecos(tr.state)
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

// Provides block decorations (Decoration.replace with block:true) for callout
// boxes when the cursor is NOT inside them. ViewPlugin cannot provide block
// decorations — only StateField can. The ViewPlugin's Blockquote case returns
// `false` (skips children) when cursor is outside, deferring to this field.

function buildCalloutBlockDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Blockquote') return
      const { from, to } = node

      // Must be within the document
      if (from >= doc.length) return

      const firstLine = doc.lineAt(from)
      const firstLineText = doc.sliceString(firstLine.from, firstLine.to)
      const calloutMatch = firstLineText.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]([^\n]*)/i)
      if (!calloutMatch) return

      const calloutType = calloutMatch[1].toUpperCase()
      const titleExtra = calloutMatch[2].trim()
      const meta = CALLOUT_META[calloutType] ?? CALLOUT_META.NOTE
      const calloutTitle = titleExtra || meta.label

      // Find last line of the block (cap at doc end)
      const lastLine = doc.lineAt(Math.min(to, doc.length))

      // If cursor is inside the block, let ViewPlugin handle it with raw styling
      const cursorInBlock = state.selection.ranges.some(
        r => r.head >= firstLine.from && r.head <= lastLine.to
      )
      if (cursorInBlock) return false // skip children — ViewPlugin handles this

      // Collect body lines (strip leading `> ` prefix)
      const bodyLines: string[] = []
      for (let lineNum = firstLine.number + 1; lineNum <= lastLine.number; lineNum++) {
        try {
          const ln = doc.line(lineNum)
          bodyLines.push(ln.text.replace(/^>\s?/, ''))
        } catch { break }
      }
      const bodyText = bodyLines.join('\n').trim()

      // Block replacement must span entire lines
      builder.add(
        firstLine.from,
        lastLine.to,
        Decoration.replace({ widget: new CalloutBlockWidget(calloutType, calloutTitle, bodyText), block: true })
      )

      return false // don't recurse into children
    },
  })

  return builder.finish()
}

const calloutBlockField = StateField.define<DecorationSet>({
  create(state) { return buildCalloutBlockDecos(state) },
  update(decos, tr) {
    if (tr.docChanged || !tr.startState.selection.eq(tr.state.selection)) return buildCalloutBlockDecos(tr.state)
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

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
const CALLOUT_META: Record<string, { icon: string; label: string; bg: string; border: string; color: string }> = {
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
const VERSE_BLOCK_STYLE = 'border-left:3px solid rgb(99,102,241);background:rgba(100,116,139,0.08);padding:6px 12px;border-radius:0 4px 4px 0;margin:8px 0'
const VERSE_BLOCK_REF_STYLE = 'font-weight:700'

export function wrapVerseBlocksForPreview(content: string): string {
  const st = (typeof useAppStore?.getState === 'function') ? useAppStore.getState() : null
  if (!st?.noteScriptureBlock) return content
  const threshold = st.noteScriptureBlockThreshold ?? 0.9
  const lines = content.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    // A) Multi-line block
    if (trimmed.includes(':') && parseRef(trimmed) &&
        i + 1 < lines.length && VERSE_BODY_LINE_RE.test(lines[i + 1])) {
      let j = i + 1
      while (j + 1 < lines.length && VERSE_BODY_LINE_RE.test(lines[j + 1])) j++
      const bodyLines = lines.slice(i + 1, j + 1)
      const candidate = bodyLines.map(l => l.replace(/^\s*\d{1,3}[ \t]+/, '')).join(' ')
      if (verseTextAcceptedSync(trimmed, candidate, threshold)) {
        const ref = `<a href="#verse-ref-${encodeURIComponent(trimmed)}" class="berean-verse-ref" style="${VERSE_BLOCK_REF_STYLE}">${escapeHtmlBasic(trimmed)}</a>`
        const body = bodyLines.map(l => escapeHtmlBasic(l)).join('<br>')
        out.push(`<div class="berean-verse-block" style="${VERSE_BLOCK_STYLE}"><div>${ref}</div>${body}</div>`)
        i = j + 1
        continue
      }
    }
    // B) Single-line block
    const m = SINGLE_VERSE_LINE_RE.exec(line)
    if (m && parseRef(m[2]) && verseTextAcceptedSync(m[2], m[3], threshold)) {
      const ref = `<a href="#verse-ref-${encodeURIComponent(m[2])}" class="berean-verse-ref" style="${VERSE_BLOCK_REF_STYLE}">${escapeHtmlBasic(m[2])}</a>`
      out.push(`<div class="berean-verse-block" style="${VERSE_BLOCK_STYLE}">${ref} ${escapeHtmlBasic(m[3])}</div>`)
      i++
      continue
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

export function renderPreviewContent(content: string): string {
  // Wrap verse blocks first (when enabled) so subsequent markdown passes leave them intact.
  content = wrapVerseBlocksForPreview(content)
  // Preserve intentional extra blank lines as explicit <br> elements.
  // Each <br> is surrounded by blank lines so it forms its own block — otherwise
  // a <br> placed on the line directly after a blockquote/list would be absorbed
  // into it via markdown's lazy continuation (making the blockquote span the blanks).
  const withSpacing = content.replace(/\n(\n{2,})/g, (_, extra: string) => {
    const count = extra.length - 1
    return '\n\n' + Array(count).fill('<br>').join('\n\n') + '\n\n'
  })
  // Convert [[Note Title]] to markdown links
  let processed = withSpacing.replace(/\[\[([^\]\n]+?)\]\]/g, (_, title) => `[${title}](#note-${title.replace(/\s+/g, '-').toLowerCase()})`)
  // ==highlight== → <mark>
  processed = processed.replace(/==([^=\n]+?)==/g, '<mark style="background:rgba(234,179,8,0.38);border-radius:2px;padding:0 1px">$1</mark>')
  // Callout boxes: > [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT], > [!CAUTION]
  // Must run before task-list / dash-list processing so the `>` lines are still intact.
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
      // Render body markdown inline (bold, italic, links, etc.)
      const bodyHtml = bodyLines ? marked.parse(bodyLines) as string : ''
      return (
        `\n<div style="border-left:3px solid ${meta.border};background:${meta.bg};border-radius:0 6px 6px 0;` +
        `padding:10px 14px;margin:12px 0">` +
        `<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;` +
        `color:${meta.color};margin-bottom:5px;display:flex;align-items:center;gap:5px">${meta.icon} ${title}</div>` +
        `<div style="font-size:0.875rem">${bodyHtml}</div>` +
        `</div>\n`
      )
    }
  )
  // Task lists — convert - [ ] and - [x]
  // Use marked.parseInline so bold/italic/code inside task text is rendered correctly.
  processed = processed.replace(/^- \[[ ]\] (.*)/gm, (_, text) =>
    `<li style="list-style:none"><input type="checkbox" disabled> ${marked.parseInline(text) as string}</li>`)
  processed = processed.replace(/^- \[[xX]\] (.*)/gm, (_, text) =>
    `<li style="list-style:none;text-decoration:line-through;opacity:0.55"><input type="checkbox" disabled checked> ${marked.parseInline(text) as string}</li>`)
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
  const html = marked(processed) as string
  return addVerseLinksToHtml(html)
}

// Build a standalone, print-ready HTML document for a note (used by print + PDF export).
export function buildPrintHTML(title: string, content: string): string {
  const body = renderPreviewContent(content)
  const safeTitle = (title || 'Untitled').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>
    @page { margin: 1in; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, 'Segoe UI', sans-serif; font-size: 12pt; line-height: 1.6; color: #111; max-width: 7in; margin: 0 auto; padding: 0.5in 0; }
    h1 { font-size: 1.9em; margin: 0.6em 0 0.3em; } h2 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
    h3 { font-size: 1.25em; } h4,h5,h6 { font-size: 1.05em; }
    p { margin: 0.5em 0; } ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
    blockquote { border-left: 3px solid #ccc; margin: 0.6em 0; padding: 0.2em 0 0.2em 1em; color: #444; }
    code { background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; }
    pre { background: #f6f6f6; padding: 0.8em; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; margin: 0.6em 0; } th, td { border: 1px solid #ccc; padding: 0.3em 0.6em; text-align: left; }
    hr { border: none; border-top: 1px solid #ccc; margin: 1em 0; }
    a { color: #1a4ed8; } img { max-width: 100%; }
    a.berean-verse-ref { color: #4f46e5; text-decoration: underline; }
    .berean-verse-block { border-left: 3px solid #6366f1; background: #f4f5fb; padding: 0.4em 0.8em; border-radius: 0 4px 4px 0; margin: 0.6em 0; }
    .berean-verse-block a.berean-verse-ref { font-weight: 700; color: #312e81; text-decoration: none; }
    h1.note-doc-title { font-size: 2.1em; border-bottom: 2px solid #eee; padding-bottom: 0.2em; margin-bottom: 0.5em; }
  </style></head><body><h1 class="note-doc-title">${safeTitle}</h1>${body}</body></html>`
}

export default function NoteEditor({ content, onChange, placeholder, onFocusRef, onCommandsRef, onScrollRef, onScrollPosition, onCursorPosition, initialScrollTop, initialCursorPos, autoFocus, previewMode, wysiwyg, notes, onWikilinkClick, onVerseRefClick, noteId, noteTitle, findQuery = '', importSource, importedAt }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const findHighlightCompartment = useRef(new Compartment())
  const editableCompartment = useRef(new Compartment())
  const [importFooterOpen, setImportFooterOpen] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onWikilinkClickRef = useRef(onWikilinkClick)
  onWikilinkClickRef.current = onWikilinkClick
  const onVerseRefClickRef = useRef(onVerseRefClick)
  onVerseRefClickRef.current = onVerseRefClick
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId
  const noteTitleRef = useRef(noteTitle)
  noteTitleRef.current = noteTitle
  const onScrollPositionRef = useRef(onScrollPosition)
  onScrollPositionRef.current = onScrollPosition
  const onCursorPositionRef = useRef(onCursorPosition)
  onCursorPositionRef.current = onCursorPosition

  const noteVerseRefsEnabled = useAppStore((s) => s.noteVerseRefsEnabled)
  const noteLexiconRefsEnabled = useAppStore((s) => s.noteLexiconRefsEnabled)
  const noteHeadingDividerProp = useAppStore((s) => s.noteHeadingDivider)

  const [backlinkInfo, setBacklinkInfo] = useState<{ x: number; y: number; query: string; from: number; to: number } | null>(null)
  const [backlinkIdx, setBacklinkIdx] = useState(0)
  // Hover preview for existing [[wikilinks]]
  const [wikiHover, setWikiHover] = useState<{ note: Note; x: number; y: number } | null>(null)
  const wikiHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number } | null>(null)
  // Right-click link editor popup (raw markdown + WYSIWYG edit views)
  const [linkEditMenu, setLinkEditMenu] = useState<{ x: number; y: number; from: number; to: number; text: string; url: string } | null>(null)
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set())
  const [headingMode, setHeadingMode] = useState(false)
  const [listMode, setListMode] = useState(false)
  const [isSelectionSuppressed, setIsSelectionSuppressed] = useState(false)
  // Persistent toolbar
  const [editorWidth, setEditorWidth] = useState(0)
  const outerRef = useRef<HTMLDivElement>(null)
  const [pHeadingOpen, setPHeadingOpen] = useState(false)
  const [pListOpen, setPListOpen] = useState(false)
  const [pHlOpen, setPHlOpen] = useState(false)
  const [pCalloutOpen, setPCalloutOpen] = useState(false)
  const [selHlOpen, setSelHlOpen] = useState(false)
  const [selCalloutOpen, setSelCalloutOpen] = useState(false)
  const [isInTable, setIsInTable] = useState(false)
  const pHeadingRef = useRef<HTMLDivElement>(null)
  const pListRef = useRef<HTMLDivElement>(null)
  const pHlRef = useRef<HTMLDivElement>(null)
  const pCalloutRef = useRef<HTMLDivElement>(null)

  const filteredNotes = backlinkInfo
    ? (notes ?? []).filter(n => (n.title || 'Untitled').toLowerCase().includes(backlinkInfo.query.toLowerCase())).slice(0, 8)
    : []

  function insertBacklink(note: Note) {
    const view = viewRef.current
    if (!view || !backlinkInfo) return
    const title = note.title || 'Untitled'
    view.dispatch({
      changes: { from: backlinkInfo.from, to: backlinkInfo.to, insert: `[[${title}]]` },
      selection: EditorSelection.cursor(backlinkInfo.from + title.length + 4),
    })
    setBacklinkInfo(null)
    view.focus()
  }

  // Keyboard handler for backlink popup
  useEffect(() => {
    if (!backlinkInfo) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setBacklinkIdx(i => Math.min(i + 1, filteredNotes.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setBacklinkIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); if (filteredNotes[backlinkIdx]) insertBacklink(filteredNotes[backlinkIdx]) }
      else if (e.key === 'Escape') { e.preventDefault(); setBacklinkInfo(null); viewRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => document.removeEventListener('keydown', onKey, { capture: true })
  }, [backlinkInfo, backlinkIdx, filteredNotes]) // eslint-disable-line

  // Clear popups when previewMode changes
  useEffect(() => {
    if (previewMode) { setBacklinkInfo(null); setSelToolbar(null) }
  }, [previewMode])

  // Re-decorate when note display settings change so the live plugin picks up new values
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorationsEffect.of(null) })
  }, [noteVerseRefsEnabled, noteLexiconRefsEnabled, noteHeadingDividerProp])

  // Reset heading/list mode when toolbar closes
  useEffect(() => { if (!selToolbar) { setHeadingMode(false); setListMode(false) } }, [selToolbar])

  // Measure editor width for persistent toolbar visibility
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setEditorWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Close persistent heading dropdown on outside click
  useEffect(() => {
    if (!pHeadingOpen) return
    function onDown(e: MouseEvent) {
      if (pHeadingRef.current && !pHeadingRef.current.contains(e.target as Node)) setPHeadingOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pHeadingOpen])

  // Close persistent list dropdown on outside click
  useEffect(() => {
    if (!pListOpen) return
    function onDown(e: MouseEvent) {
      if (pListRef.current && !pListRef.current.contains(e.target as Node)) setPListOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pListOpen])

  // Close persistent highlight picker on outside click
  useEffect(() => {
    if (!pHlOpen) return
    function onDown(e: MouseEvent) {
      if (pHlRef.current && !pHlRef.current.contains(e.target as Node)) setPHlOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pHlOpen])

  // Close persistent callout picker on outside click
  useEffect(() => {
    if (!pCalloutOpen) return
    function onDown(e: MouseEvent) {
      if (pCalloutRef.current && !pCalloutRef.current.contains(e.target as Node)) setPCalloutOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pCalloutOpen])

  // Scroll to a heading when the TOC side panel fires berean:scrollToHeading
  const previewModeRef = useRef(previewMode)
  useEffect(() => { previewModeRef.current = previewMode }, [previewMode])

  useEffect(() => {
    function handler(e: Event) {
      const { headingText } = (e as CustomEvent<{ headingText: string }>).detail
      // Both edit and view mode: scroll the CM editor to the matching heading line
      const view = viewRef.current
      if (!view) return
      const doc = view.state.doc.toString()
      const escaped = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'm')
      const match = re.exec(doc)
      if (match) {
        const pos = match.index
        view.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
        })
        if (!previewModeRef.current) view.focus()
      }
    }
    window.addEventListener('berean:scrollToHeading', handler)
    return () => window.removeEventListener('berean:scrollToHeading', handler)
  }, [])

  // Insert YouTube timestamp text at the cursor. When the editor has focus (e.g. Cmd+Shift+L),
  // inserts directly. When triggered from a panel button (editor may not have focus), still inserts
  // since there is only one active NoteEditor at a time.
  useEffect(() => {
    function handler(e: Event) {
      const text = (e as CustomEvent<{ text: string }>).detail.text
      const view = viewRef.current
      if (!view) return
      // Ensure the view is focused so the insertion is visible
      view.focus()
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      })
    }
    window.addEventListener('berean:insertTimestamp', handler)
    return () => window.removeEventListener('berean:insertTimestamp', handler)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    // Capture props at creation time so the initial editor state matches exactly
    // what will be dispatched by the wysiwyg/editable useEffect. Without this,
    // the editor first paints in raw mode (wysiwygField defaults to false), then
    // the effect fires and hides syntax — causing a visible flash of markdown
    // syntax when a note is opened or re-entered.
    const initialWysiwyg = previewMode ? true : (wysiwyg ?? false)
    const initialEditable = !(previewMode ?? false)

    const rawState = EditorState.create({
      doc: content,
      extensions: [
        wysiwygField,
        suppressedRangesField,
        collapsedHeadingsField,
        collapsedHeadingDecoField,
        tableBlockField,
        calloutBlockField,
        history(),
        keymap.of([
          { key: 'Tab', preventDefault: true, run: indentSelection },
          { key: 'Shift-Tab', preventDefault: true, run: outdentSelection },
          { key: 'Mod-b', run: toggleWith('**', '**') },
          { key: 'Mod-i', run: toggleWith('*', '*') },
          { key: 'Mod-`', run: toggleWith('`', '`') },
          { key: 'Mod-u', run: toggleWith('<u>', '</u>') },
          { key: 'Mod-Shift-h', run: toggleWith('==', '==') },
          {
            key: 'Mod-Shift-r',
            run: (v) => {
              const sel = v.state.selection.main
              if (sel.empty) return false
              const current = v.state.field(suppressedRangesField)
              const overlapping = current.filter(r => r.from < sel.to && r.to > sel.from)
              const next = overlapping.length > 0
                ? current.filter(r => !(r.from < sel.to && r.to > sel.from))
                : [...current, { from: sel.from, to: sel.to }]
              v.dispatch({ effects: setSuppressedEffect.of(next) })
              return true
            },
          },
          // Strip bindings that conflict with Berean-level shortcuts:
          //   Mod-/  → toggleComment  (we use Cmd+/ for scripture search)
          //   Mod-[  → indentLess     (we use Cmd+[ for history back)
          //   Mod-]  → indentMore     (we use Cmd+] for history forward)
          ...defaultKeymap.filter((b) => b.key !== 'Mod-/' && b.key !== 'Mod-[' && b.key !== 'Mod-]'),
          ...historyKeymap,
        ]),
        wrapOnTypeHandler,
        pasteHandler,
        markdown({ extensions: { remove: ['SetextHeading'] } }),
        liveMarkdownPlugin,
        oneDark,
        headingStyle,
        bereanSyntaxOverrides,
        bereanTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
            // Signal meaningful note edit for task detection (> 20 chars of actual content)
            if (update.state.doc.length > 20) {
              useAppStore.getState().bumpNoteEditToken()
            }
          }

          // Detect [[ for backlink autocomplete + table context
          if (update.docChanged || update.selectionSet) {
            const cursor = update.state.selection.main
            const line = update.state.doc.lineAt(cursor.head)
            const textBefore = update.state.doc.sliceString(line.from, cursor.head)
            const lastBracket = textBefore.lastIndexOf('[[')
            if (lastBracket >= 0 && !textBefore.slice(lastBracket).includes(']]')) {
              const query = textBefore.slice(lastBracket + 2)
              const coords = update.view.coordsAtPos(line.from + lastBracket)
              if (coords) {
                setBacklinkInfo(() => ({ x: coords.left, y: coords.bottom + 4, query, from: line.from + lastBracket, to: cursor.head }))
                setBacklinkIdx(0)
              }
            } else {
              setBacklinkInfo(null)
            }
            // Table context — show table toolbar when cursor is on a table row
            setIsInTable(line.text.trim().startsWith('|'))
          }

          // Detect selection for toolbar + active formats
          // In view/preview mode: selection is allowed for copy but no toolbar appears
          // and no formatting shortcuts should apply.
          if (update.selectionSet) {
            const sel = update.state.selection.main
            // Report cursor head position to parent so it can persist it
            onCursorPositionRef.current?.(sel.head)
            if (previewModeRef.current) {
              // View mode — suppress toolbar entirely; still track cursor for TOC scroll
              setSelToolbar(null)
              setIsSelectionSuppressed(false)
              setActiveFormats(new Set())
            } else {
              // Always update active formats (drives both persistent toolbar and selection toolbar)
              setActiveFormats(detectFormats(update.state))
              if (!sel.empty) {
                const suppressed = update.state.field(suppressedRangesField)
                setIsSelectionSuppressed(suppressed.some(r => r.from < sel.to && r.to > sel.from))
                const fc = update.view.coordsAtPos(sel.from)
                const tc = update.view.coordsAtPos(sel.to)
                if (fc && tc) {
                  const TOOLBAR_H = 36
                  const pad = 8
                  const rawY = Math.min(fc.top, tc.top) - TOOLBAR_H - pad
                  const finalY = rawY < pad ? Math.max(fc.bottom, tc.bottom) + pad : rawY
                  setSelToolbar({ x: (fc.left + tc.right) / 2, y: finalY })
                }
              } else {
                setSelToolbar(null)
                setIsSelectionSuppressed(false)
              }
            }
          }
          // Also refresh suppress state when ranges change (e.g. ⌘⇧R was pressed)
          if (update.transactions.some(tr => tr.effects.some(e => e.is(setSuppressedEffect)))) {
            const sel = update.state.selection.main
            if (!sel.empty) {
              const suppressed = update.state.field(suppressedRangesField)
              setIsSelectionSuppressed(suppressed.some(r => r.from < sel.to && r.to > sel.from))
            }
          }
        }),
        EditorView.contentAttributes.of({
          'aria-label': placeholder ?? 'Start writing...',
          spellcheck: 'true',
        }),
        editableCompartment.current.of(EditorView.editable.of(initialEditable)),
        findHighlightCompartment.current.of([]),
      ],
    })

    // Apply the correct initial wysiwyg value synchronously before the first paint
    // so decorations are computed with the right mode from the very first render.
    const state = rawState.update({ effects: [wysiwygEffect.of(initialWysiwyg)] }).state

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    _tableView = view  // allow TableBlockWidget to dispatch changes back
    onFocusRef?.(() => view.focus())
    onCommandsRef?.({
      undo: () => { undo(view); view.focus() },
      redo: () => { redo(view); view.focus() },
    })
    onScrollRef?.(view.scrollDOM as HTMLElement)

    // Fire onScrollPosition on every scroll so callers can track position without
    // needing to hold a ref to the DOM element (which may be detached on unmount).
    const scrollListener = () => { onScrollPositionRef.current?.(view.scrollDOM.scrollTop) }
    view.scrollDOM.addEventListener('scroll', scrollListener, { passive: true })

    return () => {
      view.scrollDOM.removeEventListener('scroll', scrollListener)
      view.destroy()
      viewRef.current = null
      if (_tableView === view) _tableView = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync WYSIWYG mode and editability whenever previewMode or wysiwyg changes.
  // In preview (view) mode: force WYSIWYG decorations ON and make editor read-only
  // so the visual appearance is identical to edit mode, just non-editable.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        wysiwygEffect.of(previewMode ? true : (wysiwyg ?? false)),
        editableCompartment.current.reconfigure(EditorView.editable.of(!previewMode)),
      ],
    })
  }, [previewMode, wysiwyg])

  // Reconfigure find-highlight decorations whenever findQuery changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: findHighlightCompartment.current.reconfigure(
        findQuery.trim() ? buildFindHighlightPlugin(findQuery) : []
      ),
    })
  }, [findQuery])

  // Restore (or reset) scroll position. Fires when the note ID changes (navigating
  // to a different note on the same tab) OR when initialScrollTop changes (back-nav
  // scroll restore). When initialScrollTop is 0, scrolls to the top of the new note.
  useEffect(() => {
    const top = initialScrollTop ?? 0
    // Double RAF: first lets CM finish layout, second applies after that paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const view = viewRef.current
        if (view) view.scrollDOM.scrollTop = top
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, initialScrollTop])

  // Restore cursor position. Uses double RAF for same timing reason as scroll restore.
  useEffect(() => {
    if (!initialCursorPos || initialCursorPos <= 0) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const view = viewRef.current
        if (!view) return
        const safePos = Math.min(initialCursorPos, view.state.doc.length)
        view.dispatch({ selection: EditorSelection.cursor(safePos) })
      })
    })
  }, [initialCursorPos])

  // Auto-focus the editor when the parent requests it (e.g. returning to a notes tab).
  // Focus happens after cursor restore so the cursor position is already set.
  useEffect(() => {
    if (!autoFocus) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        viewRef.current?.focus()
      })
    })
  }, [autoFocus])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } })
    }
  }, [content])

  const showPersistentToolbar = !previewMode && editorWidth >= PERSISTENT_TOOLBAR_MIN_WIDTH

  // Shared alignment handler (used by both toolbars)
  function applyAlignment(align: string) {
    const view = viewRef.current
    if (!view) return
    const ln = view.state.doc.lineAt(view.state.selection.main.head)
    const existing = ln.text.match(/^<div align="(left|center|right|justify)">(.*)<\/div>$/)
    let newText: string
    if (existing && existing[1] === align) {
      newText = existing[2]  // toggle off
    } else if (existing) {
      newText = align === 'left' ? existing[2] : `<div align="${align}">${existing[2]}</div>`
    } else {
      newText = align === 'left' ? ln.text : `<div align="${align}">${ln.text}</div>`
    }
    view.dispatch({ changes: { from: ln.from, to: ln.to, insert: newText } })
    view.focus()
  }

  // Shared heading handler
  function applyHeading(prefix: string) {
    const view = viewRef.current
    if (!view) return
    const ln = view.state.doc.lineAt(view.state.selection.main.head)
    const stripped = ln.text.replace(/^#{1,6}\s/, '')
    view.dispatch({ changes: { from: ln.from, to: ln.to, insert: prefix + stripped } })
    view.focus()
  }

  // Shared list prefix toggle handler
  function toggleLinePrefix(prefix: string) {
    const view = viewRef.current
    if (!view) return
    const ln = view.state.doc.lineAt(view.state.selection.main.head)
    const stripped = ln.text.replace(/^(\*\s|-\s|\d+\.\s|>\s|[a-zA-Z]+\.\s|- \[[ xX]\] )/, '')
    const newText = ln.text.startsWith(prefix) ? stripped : prefix + stripped
    view.dispatch({ changes: { from: ln.from, to: ln.to, insert: newText } })
    view.focus()
  }

  // Apply colored highlight to current selection
  function insertCallout(type: string) {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    const ln = view.state.doc.lineAt(sel.head)
    // If line is empty, insert at start of current line; else insert after
    const insertAt = ln.text.trim() === '' ? ln.from : ln.to
    const prefix = ln.text.trim() === '' ? '' : '\n'
    const calloutText = `${prefix}> [!${type}]\n> `
    view.dispatch({
      changes: { from: insertAt, to: insertAt, insert: calloutText },
      selection: EditorSelection.cursor(insertAt + calloutText.length),
    })
    view.focus()
    setPCalloutOpen(false)
    setSelCalloutOpen(false)
  }

  function insertTable() {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    const ln = view.state.doc.lineAt(sel.head)
    const insertAt = ln.text.trim() === '' ? ln.from : ln.to
    const prefix = ln.text.trim() === '' ? '' : '\n'
    const tableText = `${prefix}| Header | Header | Header |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n`
    view.dispatch({
      changes: { from: insertAt, to: insertAt, insert: tableText },
      selection: EditorSelection.cursor(insertAt + prefix.length + 2),
    })
    view.focus()
    useAppStore.getState().bumpTableInsertToken()
  }

  // ── Table manipulation helpers ──────────────────────────────────────────────

  /** Find the extent (start/end line numbers) of the table the cursor is in. */
  function getTableExtent(view: EditorView) {
    const doc = view.state.doc
    const sel = view.state.selection.main
    const cur = doc.lineAt(sel.head)
    if (!cur.text.trim().startsWith('|')) return null
    let startNum = cur.number
    while (startNum > 1 && doc.line(startNum - 1).text.trim().startsWith('|')) startNum--
    let endNum = cur.number
    while (endNum < doc.lines && doc.line(endNum + 1).text.trim().startsWith('|')) endNum++
    return { startNum, endNum, curLine: cur }
  }

  function addTableRowBelow() {
    const view = viewRef.current
    if (!view) return
    const extent = getTableExtent(view)
    if (!extent) return
    const line = extent.curLine
    const cells = line.text.split('|').slice(1, -1)
    const numCols = cells.length || 2
    const newRow = '\n| ' + Array(numCols).fill('Cell').join(' | ') + ' |'
    view.dispatch({
      changes: { from: line.to, to: line.to, insert: newRow },
      selection: EditorSelection.cursor(line.to + 3),
    })
    view.focus()
  }

  function addTableColumnRight() {
    const view = viewRef.current
    if (!view) return
    const extent = getTableExtent(view)
    if (!extent) return
    const doc = view.state.doc
    const { startNum, endNum, curLine } = extent

    // Determine which column the cursor is in (0-based)
    const cursorOffset = view.state.selection.main.head - curLine.from
    let colIdx = 0
    let pipeCount = 0
    for (let i = 0; i < curLine.text.length && i <= cursorOffset; i++) {
      if (curLine.text[i] === '|') { pipeCount++; colIdx = pipeCount - 1 }
    }

    // Build changes: insert new cell in each row after the target column
    const changes: ChangeSpec[] = []
    for (let ln = startNum; ln <= endNum; ln++) {
      const l = doc.line(ln)
      const isSep = l.text.includes('---')
      let pipes = 0
      let insertPos = l.to // default: append at end
      for (let i = 0; i < l.text.length; i++) {
        if (l.text[i] === '|') {
          pipes++
          if (pipes === colIdx + 2) { // insert after target column's closing pipe
            insertPos = l.from + i
            break
          }
        }
      }
      const cellText = isSep ? ' --- |' : ' Cell |'
      changes.push({ from: insertPos, to: insertPos, insert: cellText })
    }
    // Apply bottom-to-top to avoid position drift
    view.dispatch({ changes: [...changes].sort((a, b) => (b as { from: number }).from - (a as { from: number }).from) })
    view.focus()
  }

  function deleteTableRow() {
    const view = viewRef.current
    if (!view) return
    const extent = getTableExtent(view)
    if (!extent) return
    const { curLine, startNum, endNum } = extent
    // Don't delete the separator row or the header row if it's the only row
    if (curLine.text.includes('---')) return
    if (startNum === endNum) return // only one row, don't delete
    // Delete from line start to beginning of next line (includes newline)
    const from = curLine.number > startNum ? curLine.from - 1 : curLine.from
    const to = curLine.number > startNum ? curLine.to : curLine.to + 1
    view.dispatch({ changes: { from, to, insert: '' } })
    view.focus()
  }

  function deleteTableColumn() {
    const view = viewRef.current
    if (!view) return
    const extent = getTableExtent(view)
    if (!extent) return
    const doc = view.state.doc
    const { startNum, endNum, curLine } = extent

    // Determine which column cursor is in (0-based content column)
    const cursorOffset = view.state.selection.main.head - curLine.from
    let colIdx = 0
    let pipeCount = 0
    for (let i = 0; i < curLine.text.length && i <= cursorOffset; i++) {
      if (curLine.text[i] === '|') { pipeCount++; colIdx = Math.max(0, pipeCount - 2) }
    }

    // Check that we have enough columns to delete one
    const headerCols = curLine.text.split('|').slice(1, -1).length
    if (headerCols <= 1) return // can't delete the only column

    // For each row, remove the colIdx-th content cell (between pipe colIdx+1 and pipe colIdx+2)
    const changes: ChangeSpec[] = []
    for (let ln = startNum; ln <= endNum; ln++) {
      const l = doc.line(ln)
      const pipes: number[] = []
      for (let i = 0; i < l.text.length; i++) {
        if (l.text[i] === '|') pipes.push(l.from + i)
      }
      if (pipes.length < colIdx + 3) continue
      changes.push({ from: pipes[colIdx + 1], to: pipes[colIdx + 2], insert: '' })
    }
    // Apply bottom-to-top
    view.dispatch({ changes: [...changes].sort((a, b) => (b as { from: number }).from - (a as { from: number }).from) })
    view.focus()
  }

  function applyNoteHighlight(colorId: string) {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    if (sel.empty) return
    const selected = view.state.sliceDoc(sel.from, sel.to)
    const open = `<mark class="hl-${colorId}">`
    const close = `</mark>`
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: open + selected + close },
      selection: EditorSelection.cursor(sel.from + open.length + selected.length + close.length),
    })
    view.focus()
    setPHlOpen(false)
    setSelHlOpen(false)
  }

  return (
    <div ref={outerRef} className="berean-notes-text h-full w-full flex flex-col relative">

      {/* ── Persistent toolbar (Word / Docs-style, shown when editor is wide enough) ── */}
      {showPersistentToolbar && (
        <div
          className="flex items-center gap-px px-2 py-0.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 bg-[rgb(var(--color-surface-2))] overflow-visible"
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Undo / Redo */}
          <TBtn title="Undo (⌘Z)" onMouseDown={() => { undo(viewRef.current!); viewRef.current?.focus() }}>
            <Undo2 size={13} />
          </TBtn>
          <TBtn title="Redo (⌘⇧Z)" onMouseDown={() => { redo(viewRef.current!); viewRef.current?.focus() }}>
            <Redo2 size={13} />
          </TBtn>

          <TSep />

          {/* Heading type dropdown — label shows current heading level */}
          <div ref={pHeadingRef} className="relative">
            <TBtn
              title="Text style"
              onMouseDown={() => setPHeadingOpen((v) => !v)}
              className="text-[10px] font-mono px-1.5 gap-0.5"
            >
              <span>
                {[1,2,3,4,5].find(i => activeFormats.has(`heading-${i}`))
                  ? `H${[1,2,3,4,5].find(i => activeFormats.has(`heading-${i}`))}`
                  : '¶'}
              </span>
              <ChevronDown size={9} />
            </TBtn>
            {pHeadingOpen && (
              <div className="absolute top-full left-0 mt-0.5 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1 min-w-[130px]">
                {([
                  ['Paragraph', '',      'heading-0'],
                  ['Heading 1', '# ',    'heading-1'],
                  ['Heading 2', '## ',   'heading-2'],
                  ['Heading 3', '### ',  'heading-3'],
                  ['Heading 4', '#### ', 'heading-4'],
                  ['Heading 5', '#####', 'heading-5'],
                ] as const).map(([label, prefix, fmt]) => {
                  const isActive = fmt === 'heading-0'
                    ? ![1,2,3,4,5].some(i => activeFormats.has(`heading-${i}`))
                    : activeFormats.has(fmt)
                  return (
                    <button
                      key={label}
                      onMouseDown={(e) => { e.preventDefault(); applyHeading(prefix.trimEnd()); setPHeadingOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2 ${
                        isActive
                          ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-3))] font-semibold'
                          : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'
                      }`}
                    >
                      {isActive && <span className="w-1 h-1 rounded-full bg-[rgb(var(--color-accent))] flex-shrink-0" />}
                      {!isActive && <span className="w-1 h-1 flex-shrink-0" />}
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <TSep />

          {/* Alignment */}
          {([
            [AlignLeft,    'left',    'Align left'],
            [AlignCenter,  'center',  'Align center'],
            [AlignRight,   'right',   'Align right'],
            [AlignJustify, 'justify', 'Justify'],
          ] as const).map(([Icon, align, title]) => (
            <TBtn key={align} title={title} active={activeFormats.has(`align-${align}`)} onMouseDown={() => applyAlignment(align)}>
              <Icon size={13} />
            </TBtn>
          ))}

          <TSep />

          {/* Inline formats */}
          {([
            [Bold,          'bold',      'Bold (⌘B)',        '**',  '**'  ],
            [Italic,        'italic',    'Italic (⌘I)',      '*',   '*'   ],
            [Underline,     'underline', 'Underline (⌘U)',   '<u>', '</u>'],
            [Strikethrough, 'strike',    'Strikethrough',    '~~',  '~~'  ],
            [Code,          'code',      'Code',             '`',   '`'   ],
          ] as const).map(([Icon, fmt, title, open, close]) => (
            <TBtn
              key={fmt}
              title={title}
              active={activeFormats.has(fmt)}
              onMouseDown={() => { toggleWith(open, close)(viewRef.current!); viewRef.current?.focus() }}
            >
              <Icon size={13} />
            </TBtn>
          ))}
          {/* Highlight color picker */}
          <div ref={pHlRef} className="relative">
            <TBtn title="Highlight color" active={pHlOpen || NOTE_HL_COLORS.some(c => activeFormats.has(`hl-${c.id}`))} onMouseDown={() => setPHlOpen(v => !v)}>
              <Highlighter size={13} />
            </TBtn>
            {pHlOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] p-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-1 mb-1 last:mb-0">
                    {NOTE_HL_COLORS.slice(row * 5, row * 5 + 5).map((c) => (
                      <button
                        key={c.id}
                        title={c.id}
                        onMouseDown={(e) => { e.preventDefault(); applyNoteHighlight(c.id) }}
                        className="w-5 h-5 rounded-full cursor-pointer hover:scale-110 transition-transform border border-white/20"
                        style={{ backgroundColor: c.dot }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <TSep />

          {/* Primary block formats */}
          <TBtn title="Bullet list (* )" active={activeFormats.has('bullet')} onMouseDown={() => toggleLinePrefix('* ')}>
            <List size={13} />
          </TBtn>
          <TBtn title="Numbered list" active={activeFormats.has('ordered')} onMouseDown={() => toggleLinePrefix('1. ')}>
            <ListOrdered size={13} />
          </TBtn>
          <TBtn title="Blockquote" active={activeFormats.has('blockquote') || activeFormats.has('callout')} onMouseDown={() => toggleLinePrefix('> ')}>
            <Quote size={13} />
          </TBtn>
          <TBtn title="Outdent (⇧Tab)" onMouseDown={() => { if (viewRef.current) { outdentSelection(viewRef.current); viewRef.current.focus() } }}>
            <IndentDecrease size={13} />
          </TBtn>
          <TBtn title="Indent (Tab)" onMouseDown={() => { if (viewRef.current) { indentSelection(viewRef.current); viewRef.current.focus() } }}>
            <IndentIncrease size={13} />
          </TBtn>

          {/* Callout box picker */}
          <div ref={pCalloutRef} className="relative">
            <TBtn title="Insert callout box" active={pCalloutOpen} onMouseDown={() => setPCalloutOpen(v => !v)}>
              <span className="text-[11px] font-bold leading-none">!</span>
            </TBtn>
            {pCalloutOpen && (
              <div className="absolute top-full left-0 mt-0.5 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1 min-w-[150px]">
                {Object.entries(CALLOUT_META).map(([type, meta]) => (
                  <button
                    key={type}
                    title={`Insert ${meta.label} callout`}
                    onMouseDown={(e) => { e.preventDefault(); insertCallout(type) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                  >
                    <span style={{ color: meta.color }}>{meta.icon}</span>
                    <span>{meta.label}</span>
                    <span className="ml-auto text-[10px] font-mono opacity-40">[!{type}]</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Insert table */}
          <TBtn title="Insert table" onMouseDown={() => insertTable()}>
            <Table2 size={13} />
          </TBtn>

          {/* More list types */}
          <div ref={pListRef} className="relative">
            <TBtn
              title="More list types"
              active={activeFormats.has('task') || activeFormats.has('alpha-lower') || activeFormats.has('alpha-upper') || activeFormats.has('roman-lower') || activeFormats.has('roman-upper')}
              onMouseDown={() => setPListOpen((v) => !v)}
            >
              <MoreHorizontal size={13} />
            </TBtn>
            {pListOpen && (
              <div className="absolute top-full right-0 mt-0.5 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1">
                <div className="flex items-center gap-px px-2 py-1">
                  {([
                    ['a.', 'a. ',    'alpha-lower', 'Lettered (a.)'],
                    ['A.', 'A. ',    'alpha-upper', 'Lettered (A.)'],
                    ['i.', 'i. ',    'roman-lower', 'Roman lower (i.)'],
                    ['I.', 'I. ',    'roman-upper', 'Roman upper (I.)'],
                    ['☑',  '- [ ] ', 'task',        'Task list'],
                  ] as const).map(([label, prefix, fmt, title]) => (
                    <button
                      key={label}
                      title={title}
                      onMouseDown={(e) => { e.preventDefault(); toggleLinePrefix(prefix); setPListOpen(false) }}
                      className={`px-2 py-1 text-xs font-mono rounded cursor-pointer transition-colors ${
                        activeFormats.has(fmt)
                          ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                          : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <TSep />

          {/* Backlink insert */}
          <TBtn
            title="Insert backlink ([[…]])"
            onMouseDown={() => {
              const view = viewRef.current
              if (!view) return
              const { from, to } = view.state.selection.main
              view.dispatch({ changes: { from, to, insert: '[[' }, selection: { anchor: from + 2 } })
              view.focus()
            }}
          >
            <span className="text-[11px] font-mono font-bold leading-none">{'[['}</span>
          </TBtn>

          {/* Suppress refs toggle */}
          <TBtn
            title="Suppress / re-enable refs for selection (⌘⇧R)"
            onMouseDown={() => {
              const view = viewRef.current
              if (!view) return
              const sel = view.state.selection.main
              if (sel.empty) { view.focus(); return }
              const current = view.state.field(suppressedRangesField)
              const overlapping = current.filter(r => r.from < sel.to && r.to > sel.from)
              const next = overlapping.length > 0
                ? current.filter(r => !(r.from < sel.to && r.to > sel.from))
                : [...current, { from: sel.from, to: sel.to }]
              view.dispatch({ effects: setSuppressedEffect.of(next) })
              view.focus()
            }}
          >
            <Link2Off size={13} />
          </TBtn>

        </div>
      )}

      {/* Backlink popup — list on left, content preview on right */}
      {backlinkInfo && filteredNotes.length > 0 && (
        <div
          style={{ position: 'fixed', left: backlinkInfo.x, top: backlinkInfo.y, zIndex: 60 }}
          className="flex shadow-2xl border border-[rgb(var(--color-surface-4))] rounded-lg overflow-hidden"
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Options list */}
          <div className="w-56 max-h-64 overflow-y-auto bg-[rgb(var(--color-surface-1))] py-1 flex-shrink-0">
            {filteredNotes.map((note, i) => (
              <button
                key={note.id}
                onMouseDown={() => insertBacklink(note)}
                onMouseEnter={() => setBacklinkIdx(i)}
                className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                  i === backlinkIdx
                    ? 'bg-[rgb(var(--color-accent))/18] text-[rgb(var(--color-text-primary))] border-l-2 border-[rgb(var(--color-accent))]'
                    : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] border-l-2 border-transparent'
                }`}
              >
                <span className="truncate">{note.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
          {/* Note preview panel */}
          {filteredNotes[backlinkIdx] && (
            <div className="w-64 max-h-64 overflow-y-auto bg-[rgb(var(--color-surface-2))] border-l border-[rgb(var(--color-surface-4))] p-3 flex-shrink-0">
              <p className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))] mb-1.5 truncate">
                {filteredNotes[backlinkIdx].title || 'Untitled'}
              </p>
              {filteredNotes[backlinkIdx].verseRef && (
                <p className="text-[9px] text-[rgb(var(--color-accent))] mb-1.5 font-mono">{filteredNotes[backlinkIdx].verseRef}</p>
              )}
              <p className="text-[10px] text-[rgb(var(--color-text-secondary))] leading-relaxed whitespace-pre-wrap line-clamp-[10] break-words">
                {/* Strip markdown syntax for a clean preview */}
                {(filteredNotes[backlinkIdx].content || '').replace(/^---[\s\S]*?---\n?/, '').replace(/#{1,6}\s/g, '').replace(/[*_`~]/g, '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim().slice(0, 400) || 'No content'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Wikilink hover preview — shown when hovering over [[Note Title]] in the editor */}
      {wikiHover && (
        <div
          style={{ position: 'fixed', left: wikiHover.x, top: wikiHover.y, zIndex: 70 }}
          className="w-72 max-h-64 overflow-y-auto rounded-lg shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] p-3 pointer-events-none"
        >
          <p className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))] mb-1.5 truncate">
            {wikiHover.note.title || 'Untitled'}
          </p>
          {wikiHover.note.verseRef && (
            <p className="text-[9px] text-[rgb(var(--color-accent))] mb-1.5 font-mono">{wikiHover.note.verseRef}</p>
          )}
          <p className="text-[10px] text-[rgb(var(--color-text-secondary))] leading-relaxed whitespace-pre-wrap line-clamp-[10] break-words">
            {(wikiHover.note.content || '').replace(/^---[\s\S]*?---\n?/, '').replace(/#{1,6}\s/g, '').replace(/[*_`~]/g, '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim().slice(0, 400) || 'No content'}
          </p>
        </div>
      )}

      {/* Selection formatting toolbar */}
      {selToolbar && !backlinkInfo && (
        <div
          style={{ position: 'fixed', left: selToolbar.x, top: selToolbar.y, transform: 'translateX(-50%)', zIndex: 60 }}
          className="flex items-center gap-0 rounded-lg shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
          onMouseDown={(e) => e.preventDefault()}
        >
          {headingMode ? (
            /* Text type + alignment picker */
            <>
              {/* Heading presets */}
              {[
                { label: '¶', prefix: '', title: 'Paragraph' },
                { label: 'H1', prefix: '# ', title: 'Heading 1' },
                { label: 'H2', prefix: '## ', title: 'Heading 2' },
                { label: 'H3', prefix: '### ', title: 'Heading 3' },
                { label: 'H4', prefix: '#### ', title: 'Heading 4' },
                { label: 'H5', prefix: '##### ', title: 'Heading 5' },
              ].map(({ label, prefix, title }, i) => (
                <button
                  key={label}
                  title={title}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    const view = viewRef.current
                    if (!view) return
                    const sel = view.state.selection.main
                    const ln = view.state.doc.lineAt(sel.head)
                    const stripped = ln.text.replace(/^#{1,6}\s/, '')
                    view.dispatch({ changes: { from: ln.from, to: ln.to, insert: prefix + stripped } })
                    setHeadingMode(false)
                    view.focus()
                  }}
                  className={`px-2 py-1.5 text-xs cursor-pointer font-mono transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] ${i === 0 ? 'rounded-l-lg' : ''}`}
                >
                  {label}
                </button>
              ))}
              <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              {/* Alignment */}
              {([
                { icon: AlignLeft,    align: 'left',    title: 'Align left' },
                { icon: AlignCenter,  align: 'center',  title: 'Align center' },
                { icon: AlignRight,   align: 'right',   title: 'Align right' },
                { icon: AlignJustify, align: 'justify', title: 'Justify' },
              ] as const).map(({ icon: Icon, align, title }) => {
                const isActive = activeFormats.has(`align-${align}`)
                return (
                  <button
                    key={align}
                    title={title}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const view = viewRef.current
                      if (!view) return
                      const sel = view.state.selection.main
                      const ln = view.state.doc.lineAt(sel.head)
                      const existingAlign = ln.text.match(/^<div align="(left|center|right|justify)">(.*)<\/div>$/)
                      let newText: string
                      if (existingAlign && existingAlign[1] === align) {
                        newText = existingAlign[2]
                      } else if (existingAlign) {
                        newText = `<div align="${align}">${existingAlign[2]}</div>`
                      } else {
                        newText = align === 'left' ? ln.text : `<div align="${align}">${ln.text}</div>`
                      }
                      view.dispatch({ changes: { from: ln.from, to: ln.to, insert: newText } })
                      setHeadingMode(false)
                      view.focus()
                    }}
                    className={`p-1.5 cursor-pointer transition-colors ${
                      isActive ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                               : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                    }`}
                  >
                    <Icon size={13} />
                  </button>
                )
              })}
              <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <button
                title="Close"
                onMouseDown={(e) => { e.preventDefault(); setHeadingMode(false) }}
                className="p-1.5 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors rounded-r-lg"
              >
                <X size={12} />
              </button>
            </>
          ) : listMode ? (
            /* List type picker */
            <>
              {([
                { label: '•',  prefix: '* ',     fmt: 'bullet',      title: 'Bullet list' },
                { label: '–',  prefix: '- ',     fmt: 'dash',        title: 'Dash list' },
                { label: '1.', prefix: '1. ',    fmt: 'ordered',     title: 'Numbered list' },
                { label: 'a.', prefix: 'a. ',    fmt: 'alpha-lower', title: 'Lettered (a.)' },
                { label: 'A.', prefix: 'A. ',    fmt: 'alpha-upper', title: 'Lettered (A.)' },
                { label: 'i.', prefix: 'i. ',    fmt: 'roman-lower', title: 'Roman lower (i.)' },
                { label: 'I.', prefix: 'I. ',    fmt: 'roman-upper', title: 'Roman upper (I.)' },
                { label: '☑',  prefix: '- [ ] ', fmt: 'task',        title: 'Task list' },
                { label: '>',  prefix: '> ',     fmt: null,          title: 'Blockquote' },
              ] as const).map(({ label, prefix, fmt, title }, i, arr) => {
                const isActive = fmt ? activeFormats.has(fmt) : false
                return (
                  <button
                    key={label}
                    title={title}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const view = viewRef.current
                      if (!view) return
                      const sel = view.state.selection.main
                      const line = view.state.doc.lineAt(sel.head)
                      // Strip any existing list/block prefix
                      const stripped = line.text.replace(/^(\*\s|-\s|\d+\.\s|>\s|[a-zA-Z]+\.\s|- \[[ xX]\] )/, '')
                      const newText = isActive ? stripped : prefix + stripped
                      view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } })
                      setListMode(false)
                      view.focus()
                    }}
                    className={`px-2 py-1.5 text-xs cursor-pointer font-mono transition-colors ${i === 0 ? 'rounded-l-lg' : ''} ${i === arr.length - 1 ? 'rounded-r-lg' : ''} ${
                      isActive ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                               : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
              <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <button
                title="Close"
                onMouseDown={(e) => { e.preventDefault(); setListMode(false) }}
                className="p-1.5 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors rounded-r-lg"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            /* Normal toolbar */
            <>
              {/* ¶ button — opens text type + alignment picker */}
              <button
                title="Text type & alignment"
                onMouseDown={(e) => { e.preventDefault(); setHeadingMode(true) }}
                className={`flex items-center gap-0.5 px-2 py-1.5 text-xs cursor-pointer transition-colors rounded-l-lg font-mono ${
                  activeFormats.has('align-center') || activeFormats.has('align-right') || activeFormats.has('align-justify')
                    ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                }`}
              >
                ¶ <ChevronDown size={10} />
              </button>
              <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />

              {/* Inline formatting */}
              {([
                { icon: Bold,          label: 'Bold (⌘B)',            fmt: 'bold',      open: '**',  close: '**'   },
                { icon: Italic,        label: 'Italic (⌘I)',          fmt: 'italic',    open: '*',   close: '*'    },
                { icon: Underline,     label: 'Underline (⌘U)',       fmt: 'underline', open: '<u>', close: '</u>' },
                { icon: Strikethrough, label: 'Strikethrough',        fmt: 'strike',    open: '~~',  close: '~~'   },
                { icon: Code,          label: 'Code',                 fmt: 'code',      open: '`',   close: '`'    },
              ] as const).map(({ icon: Icon, label, fmt, open, close }) => {
                const isActive = activeFormats.has(fmt)
                return (
                  <button
                    key={label}
                    title={label}
                    onMouseDown={(e) => { e.preventDefault(); toggleWith(open, close)(viewRef.current!); viewRef.current?.focus() }}
                    className={`p-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                        : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                    }`}
                  >
                    <Icon size={13} />
                  </button>
                )
              })}
              {/* Highlight color picker */}
              <div className="relative">
                <button
                  title="Highlight color"
                  onMouseDown={(e) => { e.preventDefault(); setSelHlOpen(v => !v) }}
                  className={`p-1.5 cursor-pointer transition-colors ${selHlOpen ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'}`}
                >
                  <Highlighter size={13} />
                </button>
                {selHlOpen && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] p-2">
                    {[0, 1, 2].map((row) => (
                      <div key={row} className="flex items-center gap-1 mb-1 last:mb-0">
                        {NOTE_HL_COLORS.slice(row * 5, row * 5 + 5).map((c) => (
                          <button
                            key={c.id}
                            title={c.id}
                            onMouseDown={(e) => { e.preventDefault(); applyNoteHighlight(c.id) }}
                            className="w-5 h-5 rounded-full cursor-pointer hover:scale-110 transition-transform border border-white/20"
                            style={{ backgroundColor: c.dot }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />

              {/* Link */}
              <button
                title="Link"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const view = viewRef.current
                  if (!view) return
                  const sel = view.state.selection.main
                  const selected = view.state.sliceDoc(sel.from, sel.to)
                  view.dispatch({
                    changes: { from: sel.from, to: sel.to, insert: `[${selected}](url)` },
                    selection: EditorSelection.cursor(sel.from + selected.length + 3),
                  })
                  view.focus()
                }}
                className="p-1.5 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
              >
                <Link2 size={13} />
              </button>

              {/* Backlink */}
              <button
                title="Backlink [[ ]]"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const view = viewRef.current
                  if (!view) return
                  const sel = view.state.selection.main
                  const selected = view.state.sliceDoc(sel.from, sel.to)
                  view.dispatch({
                    changes: { from: sel.from, to: sel.to, insert: `[[${selected}]]` },
                    selection: EditorSelection.cursor(sel.from + selected.length + 4),
                  })
                  view.focus()
                }}
                className="px-1.5 py-1.5 text-xs text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors font-mono"
              >
                {'[['}
              </button>

              {/* Suppress verse/lexicon refs for selection */}
              <button
                title={isSelectionSuppressed ? 'Re-enable refs for selection (⌘⇧R)' : 'Suppress refs for selection (⌘⇧R)'}
                onMouseDown={(e) => {
                  e.preventDefault()
                  const view = viewRef.current
                  if (!view) return
                  const sel = view.state.selection.main
                  if (sel.empty) return
                  const current = view.state.field(suppressedRangesField)
                  const overlapping = current.filter(r => r.from < sel.to && r.to > sel.from)
                  const next = overlapping.length > 0
                    ? current.filter(r => !(r.from < sel.to && r.to > sel.from))
                    : [...current, { from: sel.from, to: sel.to }]
                  view.dispatch({ effects: setSuppressedEffect.of(next) })
                  view.focus()
                }}
                className={`p-1.5 cursor-pointer transition-colors ${
                  isSelectionSuppressed
                    ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                }`}
              >
                <Link2Off size={13} />
              </button>

              <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />

              {/* Callout picker in selection toolbar */}
              <div className="relative">
                <button
                  title="Insert callout box"
                  onMouseDown={(e) => { e.preventDefault(); setSelCalloutOpen(v => !v) }}
                  className={`p-1.5 cursor-pointer transition-colors ${selCalloutOpen ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'}`}
                >
                  <span className="text-[11px] font-bold leading-none">!</span>
                </button>
                {selCalloutOpen && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1 min-w-[150px]">
                    {Object.entries(CALLOUT_META).map(([type, meta]) => (
                      <button
                        key={type}
                        title={`Insert ${meta.label} callout`}
                        onMouseDown={(e) => { e.preventDefault(); insertCallout(type) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                      >
                        <span style={{ color: meta.color }}>{meta.icon}</span>
                        <span>{meta.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Insert table */}
              <button
                title="Insert table"
                onMouseDown={(e) => { e.preventDefault(); insertTable() }}
                className="p-1.5 cursor-pointer transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]"
              >
                <Table2 size={13} />
              </button>

              {/* Primary block formats + list type picker trigger */}
              {[
                { icon: List,        label: 'Bullet list (* )', prefix: '* ',  fmt: 'bullet'  },
                { icon: ListOrdered, label: 'Numbered list',    prefix: '1. ', fmt: 'ordered' },
                { icon: Quote,       label: 'Blockquote',       prefix: '> ',  fmt: null      },
              ].map(({ icon: Icon, label, prefix, fmt }) => {
                const isActive = fmt ? activeFormats.has(fmt) : false
                return (
                  <button
                    key={label}
                    title={label}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const view = viewRef.current
                      if (!view) return
                      const sel = view.state.selection.main
                      const line = view.state.doc.lineAt(sel.head)
                      const stripped = line.text.replace(/^(\*\s|-\s|\d+\.\s|>\s)/, '')
                      const newText = line.text.startsWith(prefix) ? stripped : prefix + stripped
                      view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } })
                      view.focus()
                    }}
                    className={`p-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                        : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                    }`}
                  >
                    <Icon size={13} />
                  </button>
                )
              })}
              {/* More list types */}
              <button
                title="More list types"
                onMouseDown={(e) => { e.preventDefault(); setListMode(true) }}
                className={`p-1.5 cursor-pointer transition-colors rounded-r-lg ${
                  activeFormats.has('task') || activeFormats.has('alpha-lower') || activeFormats.has('alpha-upper') || activeFormats.has('roman-lower') || activeFormats.has('roman-upper')
                    ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                }`}
              >
                <MoreHorizontal size={13} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Table context toolbar — appears when cursor is inside a markdown table */}
      {isInTable && !previewMode && (
        <div
          className="flex items-center gap-0.5 px-2 py-0.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))/60] flex-shrink-0"
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="text-[9px] text-[rgb(var(--color-text-muted))] font-semibold uppercase tracking-wide mr-1 opacity-70">Table</span>
          {([
            { label: '+ Row',  title: 'Add row below',    action: addTableRowBelow },
            { label: '+ Col',  title: 'Add column right', action: addTableColumnRight },
            { label: '− Row',  title: 'Delete current row (not separator)', action: deleteTableRow },
            { label: '− Col',  title: 'Delete current column', action: deleteTableColumn },
          ] as const).map(({ label, title, action }) => (
            <button
              key={label}
              title={title}
              onMouseDown={() => action()}
              className="px-2 py-0.5 text-[10px] rounded font-mono text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Editor container — ALWAYS in DOM in all modes (raw / wysiwyg / view).
           In view mode the editor is made read-only via editableCompartment so
           the visual appearance (decorations, colors, fonts) is identical to
           wysiwyg edit mode — only text input is disabled.
           We use onMouseDownCapture (React capture phase) so this fires BEFORE
           CodeMirror's own capture-phase mousedown listener on contentDOM. This
           is the only reliable way to intercept clicks on decorated spans
           (.cm-live-verse-ref, .cm-live-wikilink, .cm-live-link) before CM
           re-renders them away during its cursor-placement logic. */}
      <div
        ref={containerRef}
        className="overflow-hidden flex-1"
        onMouseMove={(e) => {
          const target = e.target as HTMLElement
          const wikiEl = target.closest('.cm-live-wikilink') as HTMLElement | null
          if (wikiEl) {
            if (wikiHoverTimerRef.current) clearTimeout(wikiHoverTimerRef.current)
            wikiHoverTimerRef.current = setTimeout(() => {
              const title = wikiEl.textContent?.replace(/\[\[|\]\]/g, '').trim() ?? ''
              const match = (notes ?? []).find(n => (n.title || 'Untitled').toLowerCase() === title.toLowerCase())
              if (match) {
                const rect = wikiEl.getBoundingClientRect()
                setWikiHover({ note: match, x: rect.left, y: rect.bottom + 6 })
              }
            }, 350)
          } else {
            if (wikiHoverTimerRef.current) { clearTimeout(wikiHoverTimerRef.current); wikiHoverTimerRef.current = null }
            if (wikiHover) setWikiHover(null)
          }
        }}
        onMouseLeave={() => {
          if (wikiHoverTimerRef.current) { clearTimeout(wikiHoverTimerRef.current); wikiHoverTimerRef.current = null }
          setWikiHover(null)
        }}
        onContextMenu={(e) => {
          // Right-click a markdown link → open the link editor popup. Works in both
          // raw markdown and WYSIWYG edit views (the editor container is shown in both).
          const view = viewRef.current
          if (!view) return
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos === null) return
          const line = view.state.doc.lineAt(pos)
          const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g
          let m: RegExpExecArray | null
          while ((m = linkRe.exec(line.text)) !== null) {
            const start = line.from + m.index
            const end = start + m[0].length
            if (pos >= start && pos <= end) {
              e.preventDefault()
              e.stopPropagation()
              setLinkEditMenu({ x: e.clientX, y: e.clientY, from: start, to: end, text: m[1], url: m[2] })
              return
            }
          }
        }}
        onMouseDownCapture={(e) => {
          // Only left-click opens links/refs. Right-click is handled by onContextMenu
          // (link editor popup) and must not navigate/open the link.
          if (e.button !== 0) return
          const target = e.target as HTMLElement

          // ── Heading collapse arrow ───────────────────────────────────────
          if (target.classList.contains('cm-heading-collapse-arrow')) {
            e.stopPropagation()
            e.preventDefault()
            const view = viewRef.current
            if (view) {
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? 0
              const line = view.state.doc.lineAt(pos)
              const lineFrom = line.from
              const isCollapsed = (view.state.field(collapsedHeadingsField, false) ?? new Set()).has(lineFrom)
              view.dispatch({ effects: collapseHeadingEffect.of({ lineFrom, collapsed: !isCollapsed }) })
            }
            return
          }

          // ── Verse reference ──────────────────────────────────────────────
          const verseEl = target.closest('.cm-live-verse-ref') as HTMLElement | null
          if (verseEl) {
            e.stopPropagation()
            e.preventDefault()
            const parsed = parseRef(verseEl.textContent?.trim() ?? '')
            if (parsed) onVerseRefClickRef.current?.(parsed)
            return
          }

          // ── LXX verse reference (prefix: lxx:/LXX: or suffix: …LXX) ───────
          const lxxEl = target.closest('.cm-live-lxx-ref') as HTMLElement | null
          if (lxxEl) {
            e.stopPropagation()
            e.preventDefault()
            const raw = lxxEl.textContent?.trim() ?? ''
            // Strip lxx:/LXX: prefix OR trailing …LXX suffix
            const refText = raw.replace(/^(?:lxx|LXX):/i, '').replace(/\s+LXX$/i, '').trim()
            const parsed = parseRef(refText)
            if (parsed) onVerseRefClickRef.current?.({ ...parsed, forcedTranslation: 'LXX' })
            return
          }

          // ── Lexicon reference (Strong's number) ──────────────────────────
          const lexiconEl = target.closest('.cm-live-lexicon-ref') as HTMLElement | null
          if (lexiconEl) {
            e.stopPropagation()
            e.preventDefault()
            const raw = lexiconEl.textContent?.trim() ?? ''
            const normalized = raw.toUpperCase()
            const store = useAppStore.getState()
            const fromNote = noteIdRef.current
              ? { noteId: noteIdRef.current, title: noteTitleRef.current ?? 'Note' }
              : undefined
            store.openLexiconEntry(normalized, fromNote)
            store.createTab('lexicon')
            return
          }

          // ── Wikilink ─────────────────────────────────────────────────────
          const wikiEl = target.closest('.cm-live-wikilink') as HTMLElement | null
          if (wikiEl) {
            e.stopPropagation()
            e.preventDefault()
            onWikilinkClickRef.current?.(wikiEl.textContent?.trim() ?? '')
            return
          }

          // ── Markdown link (.cm-live-link) or Cmd+click anywhere ──────────
          const isLiveLink = !!target.closest('.cm-live-link')
          if (!isLiveLink && !e.metaKey) return

          const view = viewRef.current
          if (!view) return
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos === null) return
          const line = view.state.doc.lineAt(pos)

          let handled = false
          const linkRe = /\[([^\]]*)\]\(((?:https?|berean-pdf):\/\/[^)]+)\)/g
          let m: RegExpExecArray | null
          while ((m = linkRe.exec(line.text)) !== null) {
            const start = line.from + m.index
            const end = start + m[0].length
            if (pos >= start && pos <= end) {
              handled = true
              openEditorLink(m[2], noteIdRef.current, noteTitleRef.current)
              break
            }
          }

          if (!handled && isLiveLink) {
            const liveEl = target.closest('.cm-live-link') as HTMLElement | null
            const label = liveEl?.textContent?.trim()
            if (label) {
              const allLinks = [...line.text.matchAll(/\[([^\]]*)\]\(((?:https?|berean-pdf):\/\/[^)]+)\)/g)]
              const hit = allLinks.find(x => x[1] === label) ?? allLinks[0]
              if (hit) { handled = true; openEditorLink(hit[2], noteIdRef.current, noteTitleRef.current) }
            }
          }

          if (handled) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      />

      {/* ── Import source footer ─────────────────────────────────────────────
          Only rendered when importSource is passed (i.e. from NotesPanel /
          NoteTab, never from BibleRightPanel).  Collapsed by default. */}
      {importSource && (
        <div className="flex-shrink-0 border-t border-[rgb(var(--color-surface-4))] select-none">
          <button
            onClick={() => setImportFooterOpen((v) => !v)}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left cursor-pointer group"
          >
            <span className={`text-[9px] transition-transform ${importFooterOpen ? 'rotate-90' : ''} text-[rgb(var(--color-text-muted))]`}>▶</span>
            <span className="text-[10px] text-[rgb(var(--color-text-muted))] group-hover:text-[rgb(var(--color-text-secondary))] transition-colors">
              {importSource === 'biblegateway' ? 'BibleGateway import' : 'e-Sword import'}
            </span>
          </button>
          {importFooterOpen && (
            <div className="px-5 pb-2 text-[10px] text-[rgb(var(--color-text-muted))] italic">
              Imported from {importSource === 'biblegateway' ? 'BibleGateway' : 'e-Sword'}
              {importedAt ? ` on ${new Date(importedAt).toLocaleString()}` : ''}
            </div>
          )}
        </div>
      )}

      {/* ── Link editor popup (right-click a markdown link) ─────────────────── */}
      {linkEditMenu && (
        <>
          {/* Backdrop — click anywhere to dismiss */}
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setLinkEditMenu(null)} onContextMenu={(e) => { e.preventDefault(); setLinkEditMenu(null) }} />
          <div
            className="fixed z-[9999] w-72 rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-2xl p-3"
            style={{
              left: Math.min(linkEditMenu.x, window.innerWidth - 300),
              top: Math.min(linkEditMenu.y, window.innerHeight - 200),
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setLinkEditMenu(null); viewRef.current?.focus() }
            }}
          >
            <div className="flex items-center gap-1.5 mb-2 text-[rgb(var(--color-text-secondary))]">
              <Link2 size={13} />
              <span className="text-xs font-semibold">Edit link</span>
            </div>

            <label className="block text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-muted))] mb-0.5">Text</label>
            <input
              autoFocus
              value={linkEditMenu.text}
              onChange={(e) => setLinkEditMenu(m => m ? { ...m, text: e.target.value } : m)}
              className="w-full mb-2 px-2 py-1 text-xs rounded border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/60]"
            />

            <label className="block text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-muted))] mb-0.5">Link</label>
            <input
              value={linkEditMenu.url}
              onChange={(e) => setLinkEditMenu(m => m ? { ...m, url: e.target.value } : m)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const view = viewRef.current
                  if (view && linkEditMenu) {
                    view.dispatch({ changes: { from: linkEditMenu.from, to: linkEditMenu.to, insert: `[${linkEditMenu.text}](${linkEditMenu.url})` } })
                  }
                  setLinkEditMenu(null)
                  viewRef.current?.focus()
                }
              }}
              className="w-full mb-3 px-2 py-1 text-xs rounded border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/60] font-mono"
            />

            <div className="flex items-center gap-1.5">
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  const view = viewRef.current
                  if (view && linkEditMenu) {
                    view.dispatch({ changes: { from: linkEditMenu.from, to: linkEditMenu.to, insert: `[${linkEditMenu.text}](${linkEditMenu.url})` } })
                  }
                  setLinkEditMenu(null)
                  viewRef.current?.focus()
                }}
                className="flex-1 px-2 py-1 text-xs rounded bg-[rgb(var(--color-accent))] text-white font-medium hover:opacity-90 cursor-pointer transition-opacity"
              >
                Save
              </button>
              <button
                title="Copy link"
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (linkEditMenu) navigator.clipboard?.writeText(linkEditMenu.url).catch(() => {})
                  setLinkEditMenu(null)
                }}
                className="p-1.5 rounded border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
              >
                <Copy size={13} />
              </button>
              <button
                title="Remove link (keep text)"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const view = viewRef.current
                  if (view && linkEditMenu) {
                    view.dispatch({ changes: { from: linkEditMenu.from, to: linkEditMenu.to, insert: linkEditMenu.text } })
                  }
                  setLinkEditMenu(null)
                  viewRef.current?.focus()
                }}
                className="p-1.5 rounded border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
