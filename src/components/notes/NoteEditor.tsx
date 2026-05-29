import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap, ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { EditorState, EditorSelection, RangeSetBuilder, StateField, StateEffect, Compartment } from '@codemirror/state'
import type { ChangeSpec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { tags } from '@lezer/highlight'
import { marked } from 'marked'
import { Undo2, Redo2, Bold, Italic, Underline, Code, Link2, Link2Off, Strikethrough, List, ListOrdered, Quote, ChevronDown, X, AlignLeft, AlignCenter, AlignRight, AlignJustify, Highlighter, MoreHorizontal, Table2 } from 'lucide-react'
import type { Note } from '@/types'
import { parseRef } from '@/lib/parseRef'
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
  '.cm-live-callout-header': { borderLeft: '3px solid rgba(168,85,247,0.7)', paddingLeft: '0.75em', color: 'rgba(192,132,252,0.9) !important', fontWeight: '600' },
  '.cm-live-underline': { textDecoration: 'underline' },
  '.cm-live-hr-line': { borderBottom: '1px solid rgba(100,116,139,0.4)', lineHeight: '1.2' },
  '.cm-live-hr-mark': { color: 'transparent', userSelect: 'none' as const },
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

function toggleWith(open: string, close: string) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main
    if (!sel.empty) {
      const doc = view.state.doc
      const before = doc.sliceString(Math.max(0, sel.from - open.length), sel.from)
      const after = doc.sliceString(sel.to, Math.min(doc.length, sel.to + close.length))
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
    }
    return wrapWith(open, close)(view)
  }
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

  // Alignment — check current line for <div align="X">
  const currentLine = doc.lineAt(sel.from)
  const alignMatch = currentLine.text.match(/^<div align="(left|center|right|justify)">/)
  if (alignMatch) fmts.add(`align-${alignMatch[1]}`)

  // New list types — check line prefix
  const lineText = currentLine.text
  if (/^- \[[ xX]\] /.test(lineText)) fmts.add('task')
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
    // Paste URL as markdown link
    const text = e.clipboardData?.getData('text/plain')
    if (text && /^https?:\/\/\S+$/.test(text.trim())) {
      e.preventDefault()
      const sel = view.state.selection.main
      if (!sel.empty) {
        const selectedText = view.state.sliceDoc(sel.from, sel.to)
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: `[${selectedText}](${text.trim()})` },
          selection: { anchor: sel.from + selectedText.length + text.trim().length + 4 },
        })
      } else {
        view.dispatch({
          changes: { from: sel.from, insert: `[](${text.trim()})` },
          selection: { anchor: sel.from + 1 },
        })
      }
      return true
    }
    return false
  },
})

function openEditorLink(url: string, noteId?: string, noteTitle?: string) {
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
      body.textContent = this.bodyText
      el.appendChild(body)
    }
    return el
  }

  ignoreEvent() { return false }
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
  const col = (nodeFrom: number) => cursorOnLine(state, nodeFrom, focused)

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
            decos.push({ from: ln.from, to: ln.from, deco: Decoration.line({ class: `cm-live-h${lv}` }), kind: 'line' })
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
            const bullet = markText === '*' ? '• ' : markText === '-' ? '– ' : `${markText} `
            decos.push({ from, to: Math.min(end, vpTo), deco: Decoration.replace({ widget: new InlineWidget(bullet, 'cm-live-list-bullet') }), kind: 'replace' })
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

  // Settings from store (safe to call outside React — reads current snapshot)
  const storeSnapshot = useAppStore.getState()
  const noteVerseRefsEnabled = storeSnapshot.noteVerseRefsEnabled
  const noteLexiconRefsEnabled = storeSnapshot.noteLexiconRefsEnabled
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

  // Use mark + hide for underline (so it stays editable-looking)
  const addMarkRegex = (re: RegExp, markClass: string) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const from = vpFrom + m.index
      const to = from + m[0].length
      if (col(from)) continue
      const inner = m[1]
      const prefixLen = m[0].indexOf(inner)
      const suffixLen = m[0].length - prefixLen - inner.length
      decos.push({ from, to: from + prefixLen, deco: hide, kind: 'replace' })
      decos.push({ from: from + prefixLen, to: to - suffixLen, deco: Decoration.mark({ class: markClass }), kind: 'mark' })
      decos.push({ from: to - suffixLen, to, deco: hide, kind: 'replace' })
    }
  }

  addWidgetRegex(/~~([^~\n]+?)~~/g, 'cm-live-strike')
  addWidgetRegex(/\[\[([^\]\n]+?)\]\]/g, 'cm-live-wikilink')
  addMarkRegex(/<u>([^<\n]+?)<\/u>/g, 'cm-live-underline')
  addMarkRegex(/==([^=\n]+?)==/g, 'cm-live-highlight')
  // Colored highlight marks: <mark class="hl-COLOR">text</mark>
  for (const { id } of NOTE_HL_COLORS) {
    addMarkRegex(new RegExp(`<mark class="hl-${id}">([^<\\n]*?)<\\/mark>`, 'g'), `cm-live-hl-${id}`)
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

  // Bible verse refs
  if (noteVerseRefsEnabled) {
    // LXX-suffix refs first: "Book ch:v LXX" — collect ranges so the regular verse-ref
    // pass can skip them (avoids double-decorating the ref portion of a suffix match)
    const lxxSuffixRanges: Array<{ from: number; to: number }> = []
    const lxxSuffixRefRe = /\b((?:[1-3][ \t]*)?[A-Za-z][a-z]+(?:[ \t]+(?:of[ \t]+)?[A-Za-z][a-z]+)?[ \t]+\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?)[ \t]+LXX\b/gi
    lxxSuffixRefRe.lastIndex = 0
    let sm: RegExpExecArray | null
    while ((sm = lxxSuffixRefRe.exec(text)) !== null) {
      const from = vpFrom + sm.index
      const to = from + sm[0].length
      if (!parseRef(sm[1])) continue
      if (isInSuppressedRange(from, to)) continue
      lxxSuffixRanges.push({ from, to })
      decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-lxx-ref' }), kind: 'mark' })
    }

    // Regular verse refs — lowercase first char supported; ranges already matched as LXX
    // suffix are excluded to prevent double-decoration.
    // Use `?` (zero or one) for the optional second word so we don't greedily consume
    // preceding words like "hello hosea 13" — only "hosea 13" should match.
    const verseRefRe = /\b(?:[1-3][ \t]*)?[A-Za-z][a-z]+(?:[ \t]+(?:of[ \t]+)?[A-Za-z][a-z]+)?[ \t]+\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?\b/g
    verseRefRe.lastIndex = 0
    let vm: RegExpExecArray | null
    while ((vm = verseRefRe.exec(text)) !== null) {
      const from = vpFrom + vm.index
      const to = from + vm[0].length
      if (!parseRef(vm[0])) continue
      if (isInSuppressedRange(from, to)) continue
      if (lxxSuffixRanges.some(r => r.from < to && r.to > from)) continue
      decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-verse-ref' }), kind: 'mark' })
    }

    // LXX-prefixed refs: lxx: or LXX: prefix — renders in violet to distinguish from KJVA refs
    const lxxRefRe = /\b(?:lxx|LXX):(?:[1-3][ \t]*)?[A-Za-z][a-z]+(?:[ \t]+(?:of[ \t]+)?[A-Za-z][a-z]+)?[ \t]+\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?\b/g
    lxxRefRe.lastIndex = 0
    let lm: RegExpExecArray | null
    while ((lm = lxxRefRe.exec(text)) !== null) {
      const from = vpFrom + lm.index
      const to = from + lm[0].length
      if (!parseRef(lm[0].replace(/^(?:lxx|LXX):/i, ''))) continue
      if (isInSuppressedRange(from, to)) continue
      decos.push({ from, to, deco: Decoration.mark({ class: 'cm-live-lxx-ref' }), kind: 'mark' })
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
        tr.effects.some(e => e.is(refreshDecorationsEffect) || e.is(setSuppressedEffect))
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

class TableBlockWidget extends WidgetType {
  constructor(
    readonly headers: string[],
    readonly alignments: ('left' | 'center' | 'right')[],
    readonly rows: string[][],
    readonly rawText: string,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof TableBlockWidget && other.rawText === this.rawText
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'overflow-x:auto;margin:4px 0;cursor:text;user-select:none;'

    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;width:100%;font-size:0.8rem;font-family:inherit;'

    // Header
    const thead = table.createTHead()
    const headerRow = thead.insertRow()
    this.headers.forEach((h, i) => {
      const th = document.createElement('th')
      th.style.cssText = `border:1px solid rgba(var(--color-surface-4),0.8);padding:4px 10px;background:rgba(var(--color-surface-3),0.6);font-weight:600;text-align:${this.alignments[i] ?? 'left'};`
      th.innerHTML = marked.parseInline(h) as string
      headerRow.appendChild(th)
    })

    // Body
    const tbody = table.createTBody()
    this.rows.forEach((row, ri) => {
      const tr = tbody.insertRow()
      if (ri % 2 === 1) tr.style.background = 'rgba(var(--color-surface-3),0.3)'
      this.headers.forEach((_, i) => {
        const td = document.createElement('td')
        td.style.cssText = `border:1px solid rgba(var(--color-surface-4),0.8);padding:4px 10px;text-align:${this.alignments[i] ?? 'left'};`
        td.innerHTML = marked.parseInline(row[i] ?? '') as string
        tr.appendChild(td)
      })
    })

    wrap.appendChild(table)
    return wrap
  }

  ignoreEvent() { return false }
}

function buildTableBlockDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc
  let lineNum = 1

  while (lineNum <= doc.lines) {
    const line = doc.line(lineNum)

    // Need at least a header row and a separator row
    if (!isTableRow(line.text) || lineNum + 1 > doc.lines) { lineNum++; continue }
    const sepLine = doc.line(lineNum + 1)
    if (!isTableSep(sepLine.text)) { lineNum++; continue }

    // Collect all body rows following the separator
    let endLineNum = lineNum + 1
    while (endLineNum + 1 <= doc.lines) {
      const next = doc.line(endLineNum + 1)
      if (!isTableRow(next.text)) break
      endLineNum++
    }
    const endLine = doc.line(endLineNum)

    // Show raw if cursor is anywhere in the block
    const cursorInBlock = state.selection.ranges.some(
      r => r.head >= line.from && r.head <= endLine.to
    )
    if (!cursorInBlock) {
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
        Decoration.replace({ widget: new TableBlockWidget(headerCells, alignments, rows, rawText), block: true })
      )
    }

    lineNum = endLineNum + 1
  }

  return builder.finish()
}

const tableBlockField = StateField.define<DecorationSet>({
  create(state) { return buildTableBlockDecos(state) },
  update(decos, tr) {
    if (tr.docChanged || !tr.startState.selection.eq(tr.state.selection)) return buildTableBlockDecos(tr.state)
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
  // Group 1: ref part (Book ch:v), Group 2: optional " LXX" / " lxx" suffix
  // The `i` flag allows lowercase book names and case-insensitive LXX suffix
  const verseRefRe = /\b((?:[1-3]\s+)?[A-Za-z][a-z]+(?:\s+(?:of\s+)?[A-Za-z][a-z]+)?\s+\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?)(\s+LXX\b)?/gi
  let inSkip = 0
  return html.replace(/(<\/?(?:a|code|pre)[^>]*>)|([^<>]+)/gi, (match, tag, text) => {
    if (tag) {
      const lower = tag.toLowerCase()
      if (/^<(a|code|pre)[\s>]/.test(lower)) inSkip++
      else if (/^<\/(a|code|pre)>/.test(lower)) inSkip = Math.max(0, inSkip - 1)
      return tag
    }
    if (inSkip > 0 || !text) return text ?? match
    return text.replace(verseRefRe, (m: string, refPart: string, lxxSuffix: string | undefined) => {
      if (!parseRef(refPart)) return m
      if (lxxSuffix) {
        return `<a href="#lxx-verse-ref-${encodeURIComponent(refPart)}" class="berean-verse-ref berean-lxx-ref">${m}</a>`
      }
      return `<a href="#verse-ref-${encodeURIComponent(refPart)}" class="berean-verse-ref">${m}</a>`
    })
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

export function renderPreviewContent(content: string): string {
  // Preserve intentional extra blank lines as explicit <br> elements
  const withSpacing = content.replace(/\n(\n{2,})/g, (_, extra) => '\n' + '<br>\n'.repeat(extra.length - 1) + '\n')
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

export default function NoteEditor({ content, onChange, placeholder, onFocusRef, onCommandsRef, onScrollRef, onScrollPosition, onCursorPosition, initialScrollTop, initialCursorPos, autoFocus, previewMode, notes, onWikilinkClick, onVerseRefClick, noteId, noteTitle, findQuery = '', importSource, importedAt }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const findHighlightCompartment = useRef(new Compartment())
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

  const [backlinkInfo, setBacklinkInfo] = useState<{ x: number; y: number; query: string; from: number; to: number } | null>(null)
  const [backlinkIdx, setBacklinkIdx] = useState(0)
  // Hover preview for existing [[wikilinks]]
  const [wikiHover, setWikiHover] = useState<{ note: Note; x: number; y: number } | null>(null)
  const wikiHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number } | null>(null)
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

  // Re-decorate when note ref settings change so the live plugin picks up new values
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorationsEffect.of(null) })
  }, [noteVerseRefsEnabled, noteLexiconRefsEnabled])

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
  const previewRef = useRef<HTMLDivElement>(null)
  const previewModeRef = useRef(previewMode)
  useEffect(() => { previewModeRef.current = previewMode }, [previewMode])

  useEffect(() => {
    function handler(e: Event) {
      const { headingText } = (e as CustomEvent<{ headingText: string }>).detail
      if (previewModeRef.current) {
        // Preview mode: find matching h1-h6 element in the rendered HTML
        const container = previewRef.current
        if (!container) return
        const headings = container.querySelectorAll('h1,h2,h3,h4,h5,h6')
        for (const el of Array.from(headings)) {
          if ((el.textContent ?? '').trim() === headingText) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return
          }
        }
      } else {
        // Edit mode: find the heading line in the CM document and scroll to it
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
          view.focus()
        }
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

    const state = EditorState.create({
      doc: content,
      extensions: [
        suppressedRangesField,
        tableBlockField,
        calloutBlockField,
        history(),
        keymap.of([
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
        markdown(),
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
          if (update.selectionSet) {
            const sel = update.state.selection.main
            // Report cursor head position to parent so it can persist it
            onCursorPositionRef.current?.(sel.head)
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
        findHighlightCompartment.current.of([]),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Restore scroll position. Runs whenever initialScrollTop changes (the parent's restore
  // effect sets it asynchronously after mount, so this must be a separate effect with the
  // dep — not baked into the editor-creation effect which only runs once).
  useEffect(() => {
    if (!initialScrollTop || initialScrollTop <= 0) return
    // Double RAF: first lets CM finish layout, second applies after that paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const view = viewRef.current
        if (view) view.scrollDOM.scrollTop = initialScrollTop
      })
    })
  }, [initialScrollTop])

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

          {/* Heading type dropdown */}
          <div ref={pHeadingRef} className="relative">
            <TBtn
              title="Text style"
              onMouseDown={() => setPHeadingOpen((v) => !v)}
              className="text-[10px] font-mono px-1.5 gap-0.5"
            >
              <span>¶</span>
              <ChevronDown size={9} />
            </TBtn>
            {pHeadingOpen && (
              <div className="absolute top-full left-0 mt-0.5 z-50 rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1 min-w-[130px]">
                {([
                  ['Paragraph', ''],
                  ['Heading 1', '# '],
                  ['Heading 2', '## '],
                  ['Heading 3', '### '],
                  ['Heading 4', '#### '],
                  ['Heading 5', '##### '],
                ] as const).map(([label, prefix]) => (
                  <button
                    key={label}
                    onMouseDown={(e) => { e.preventDefault(); applyHeading(prefix); setPHeadingOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-xs text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
                  >
                    {label}
                  </button>
                ))}
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
            <TBtn title="Highlight color" active={pHlOpen} onMouseDown={() => setPHlOpen(v => !v)}>
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
          <TBtn title="Blockquote" onMouseDown={() => toggleLinePrefix('> ')}>
            <Quote size={13} />
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

      {/* Preview div — shown when previewMode, hidden (not unmounted) when editing */}
      {previewMode && (
        <div
          ref={previewRef}
          className="flex-1 overflow-y-auto px-5 py-4 text-[rgb(var(--color-text-primary))] text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3 [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:mb-1 [&_h5]:mt-2 [&_p]:mb-3 [&_p:empty]:min-h-[1.4em] [&_a]:text-[rgb(var(--color-accent))] [&_a]:underline [&_a]:cursor-pointer [&_strong]:font-bold [&_em]:italic [&_del]:line-through [&_del]:opacity-70 [&_code]:bg-[rgb(var(--color-surface-4))] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-[rgb(var(--color-surface-4))] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-[rgb(var(--color-accent))] [&_blockquote]:pl-3 [&_blockquote]:opacity-80 [&_blockquote]:mb-3 [&_hr]:border-[rgb(var(--color-surface-4))] [&_hr]:my-4 [&_ul:not(.berean-dash-list)]:list-disc [&_ul:not(.berean-dash-list)]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:mb-1 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:mb-3 [&_table]:text-xs [&_th]:border [&_th]:border-[rgb(var(--color-surface-4))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-[rgb(var(--color-surface-3))] [&_th]:font-semibold [&_th]:text-left [&_td]:border [&_td]:border-[rgb(var(--color-surface-4))] [&_td]:px-3 [&_td]:py-1.5 [&_tr:nth-child(even)]:bg-[rgb(var(--color-surface-3))/50]"
          dangerouslySetInnerHTML={{ __html: injectFindMarks(renderPreviewContent(content), findQuery) }}
          onClick={(e) => {
            const target = e.target as HTMLElement
            const anchor = target.closest('a') as HTMLAnchorElement | null
            if (anchor) {
              e.preventDefault()
              const href = anchor.getAttribute('href') ?? ''
              if (href.startsWith('#note-')) {
                onWikilinkClickRef.current?.(anchor.textContent ?? '')
              } else if (href.startsWith('#lxx-verse-ref-')) {
                const refText = decodeURIComponent(href.replace('#lxx-verse-ref-', ''))
                const ref = parseRef(refText)
                if (ref) onVerseRefClickRef.current?.({ ...ref, forcedTranslation: 'LXX' })
              } else if (href.startsWith('#verse-ref-')) {
                const refText = decodeURIComponent(href.replace('#verse-ref-', ''))
                const ref = parseRef(refText)
                if (ref) onVerseRefClickRef.current?.(ref)
              } else if (/^https?:\/\//.test(href)) {
                openEditorLink(href, noteIdRef.current, noteTitleRef.current)
              }
            }
          }}
        />
      )}

      {/* Editor container — ALWAYS in DOM, hidden with CSS when previewMode.
           We use onMouseDownCapture (React capture phase) so this fires BEFORE
           CodeMirror's own capture-phase mousedown listener on contentDOM. This
           is the only reliable way to intercept clicks on decorated spans
           (.cm-live-verse-ref, .cm-live-wikilink, .cm-live-link) before CM
           re-renders them away during its cursor-placement logic. */}
      <div
        ref={containerRef}
        className={`overflow-hidden ${previewMode ? 'hidden' : 'flex-1'}`}
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
        onMouseDownCapture={(e) => {
          const target = e.target as HTMLElement

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
          const linkRe = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
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
              const allLinks = [...line.text.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)]
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
    </div>
  )
}
