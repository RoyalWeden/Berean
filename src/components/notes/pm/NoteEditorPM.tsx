import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { gapCursor } from 'prosemirror-gapcursor'
import { dropCursor } from 'prosemirror-dropcursor'
import { bereanSchema as schema } from './schema'
import { parseMarkdown } from './parser'
import { serializeToMarkdown } from './serializer'
import { bereanKeymap } from './keymap'
import { bereanInputRules } from './inputRules'
import { bereanPastePlugin } from './pastePlugin'
import { createRefDecorationsPlugin, createRefClickPlugin } from './refDecorations'
import { createPlaceholderPlugin } from './placeholderPlugin'
import {
  createAutocompletePlugin, replaceRangeWithText, replaceRangeWithBlock, replaceRangeWithWikilink,
  type WikilinkTrigger, type StrongsTrigger, type VerseSuggestTrigger, type SlashCommandTrigger,
} from './autocomplete'
import { calloutNodeView, listItemNodeView } from './nodeViews'
import { createHeadingCollapsePlugin, headingNodeView } from './headingCollapse'
import { createBlockDecorationsPlugin } from './blockDecorations'
import { bereanTablePlugins } from './tablePlugins'
import { createSuppressRangesPlugin, suppressRangesKeymap } from './suppressRanges'
import { createFindHighlightPlugin, setFindQuery } from './findHighlight'
import { createSelectionToolbarPlugin, type SelectionToolbarState } from './selectionToolbarPlugin'
import SelectionToolbar from './SelectionToolbar'
import Toolbar from './Toolbar'
import { StrongsSuggestPopup, VerseSuggestPopup, WikilinkPopup, SlashCommandPopup } from './AutocompletePopups'
import { filterSlashCommands, type SlashCommand } from './slashCommands'
import { parseRef, getTranslationForBook, type ParsedRef } from '@/lib/parseRef'
import { stripLxxMarker } from '@/lib/noteTextBlocks'
import { buildLexiconCopyText } from '@/components/lexicon/LexiconPanel'
import { useAppStore } from '@/store'
import type { Note } from '@/types'
import './pmEditor.css'

// Phase 2+3+4 scope: mount/unmount lifecycle, content/onChange wiring,
// keymap, history, mark toggling, paste, input rules, inline ref
// decorations + click-nav + wikilink hover preview, autocomplete popups
// (wikilink `[[`, Strong's/verse block-suggest). NOT yet included (later
// phases, see the migration plan): callouts/tasks/collapsible headings/
// bullet-style/verse-block decoration (Phase 5), suppress-detection +
// refined cursor/scroll position restore (Phase 7).
export interface NoteEditorPMProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
  onFocusRef?: (focusFn: () => void) => void
  onCommandsRef?: (cmds: { undo: () => void; redo: () => void }) => void
  onScrollPosition?: (pos: number) => void
  onCursorPosition?: (pos: number) => void
  initialScrollTop?: number
  initialCursorPos?: number
  autoFocus?: boolean
  mode?: 'edit' | 'view' // replaces previewMode + wysiwyg (raw mode dropped)
  className?: string
  notes?: Note[]
  onWikilinkClick?: (title: string) => void
  onVerseRefClick?: (ref: ParsedRef & { forcedTranslation?: string }) => void
  onLexiconRefClick?: (strongsId: string) => void
  onWikilinkHoverStart?: (title: string, rect: DOMRect) => void
  onWikilinkHoverEnd?: () => void
  // Side-panel quick editor (BibleRightPanel) uses a separate block-suggest
  // enable setting (sidePanelScriptureBlock) instead of the main editor's
  // noteStrongsBlockSuggest/noteVerseBlockSuggest — port of NoteEditor.tsx's
  // isSidePanel prop (NoteEditor.tsx:2826-2827).
  isSidePanel?: boolean
  findQuery?: string
  importSource?: 'biblegateway' | 'esword'
  importedAt?: number
}

export default function NoteEditorPM({
  content,
  onChange,
  placeholder,
  onFocusRef,
  onCommandsRef,
  onScrollPosition,
  onCursorPosition,
  initialScrollTop,
  initialCursorPos,
  autoFocus,
  mode = 'edit',
  className = '',
  notes,
  onWikilinkClick,
  onVerseRefClick,
  onLexiconRefClick,
  onWikilinkHoverStart,
  onWikilinkHoverEnd,
  isSidePanel,
  findQuery = '',
  importSource,
  importedAt,
}: NoteEditorPMProps) {
  const [importFooterOpen, setImportFooterOpen] = useState(false)
  // Flips true right after viewRef.current is set in the mount effect below — viewRef is a
  // plain ref (not state), so nothing re-renders once the EditorView actually exists unless
  // something else does; the persistent Toolbar (unlike SelectionToolbar, which is naturally
  // gated behind selectionToolbar state that can't go non-null before the view exists) needs
  // its own explicit signal to know when it's safe to render with a real view.
  const [viewReady, setViewReady] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onScrollPositionRef = useRef(onScrollPosition)
  onScrollPositionRef.current = onScrollPosition
  const onCursorPositionRef = useRef(onCursorPosition)
  onCursorPositionRef.current = onCursorPosition
  const lastContentPropRef = useRef(content)

  const [wikilinkTrigger, setWikilinkTrigger] = useState<WikilinkTrigger | null>(null)
  const [strongsTrigger, setStrongsTrigger] = useState<StrongsTrigger | null>(null)
  const [verseSuggestTrigger, setVerseSuggestTrigger] = useState<VerseSuggestTrigger | null>(null)
  const [slashTrigger, setSlashTrigger] = useState<SlashCommandTrigger | null>(null)
  const [wikilinkIdx, setWikilinkIdx] = useState(0)
  const [slashIdx, setSlashIdx] = useState(0)
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes

  // Click/hover callbacks are wrapped in a stable ref object so the plugin
  // instance (built once at mount, since plugins are baked into EditorState)
  // always calls the LATEST callback identity without needing to rebuild the
  // whole plugin/state on every render.
  const refCallbacksRef = useRef({ onWikilinkClick, onVerseRefClick, onLexiconRefClick, onWikilinkHoverStart, onWikilinkHoverEnd })
  refCallbacksRef.current = { onWikilinkClick, onVerseRefClick, onLexiconRefClick, onWikilinkHoverStart, onWikilinkHoverEnd }

  // ── Mount: build the EditorView once ──────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current) return

    const state = EditorState.create({
      schema,
      doc: parseMarkdown(content),
      plugins: [
        history(),
        bereanInputRules,
        // Table-cell Tab/Shift-Tab nav must be checked BEFORE the generic
        // list-indent keymap (bereanKeymap) — prosemirror-keymap resolves a
        // key by trying plugins in array order, first handler to return
        // true wins; goToNextCell returns false outside a table, correctly
        // falling through to list-indent.
        ...bereanTablePlugins,
        bereanKeymap,
        suppressRangesKeymap,
        gapCursor(),
        dropCursor(),
        bereanPastePlugin,
        createSuppressRangesPlugin(),
        createRefDecorationsPlugin(),
        createRefClickPlugin({
          onWikilinkClick: (title) => refCallbacksRef.current.onWikilinkClick?.(title),
          onVerseRefClick: (ref) => refCallbacksRef.current.onVerseRefClick?.(ref),
          onLexiconRefClick: (id) => refCallbacksRef.current.onLexiconRefClick?.(id),
          onWikilinkHoverStart: (title, rect) => refCallbacksRef.current.onWikilinkHoverStart?.(title, rect),
          onWikilinkHoverEnd: () => refCallbacksRef.current.onWikilinkHoverEnd?.(),
        }),
        createPlaceholderPlugin(),
        createAutocompletePlugin({
          onWikilinkTrigger: (t) => { setWikilinkTrigger(t); setWikilinkIdx(0) },
          onStrongsTrigger: setStrongsTrigger,
          onVerseSuggestTrigger: setVerseSuggestTrigger,
          onSlashCommandTrigger: (t) => { setSlashTrigger(t); setSlashIdx(0) },
          enableStrongsSuggest: () => (isSidePanel ? useAppStore.getState().sidePanelScriptureBlock : useAppStore.getState().noteStrongsBlockSuggest) !== false,
          enableVerseSuggest: () => (isSidePanel ? useAppStore.getState().sidePanelScriptureBlock : useAppStore.getState().noteVerseBlockSuggest) !== false,
        }),
        createHeadingCollapsePlugin(),
        createBlockDecorationsPlugin(),
        createFindHighlightPlugin(),
        createSelectionToolbarPlugin(setSelectionToolbar),
      ],
    })

    const view = new EditorView(hostRef.current, {
      state,
      editable: () => mode === 'edit',
      attributes: placeholder ? { 'data-placeholder': placeholder } : {},
      nodeViews: {
        callout: (node) => calloutNodeView(node),
        list_item: (node, editorView, getPos) => listItemNodeView(getPos)(node, editorView),
        heading: (node, editorView, getPos) => headingNodeView(getPos)(node, editorView),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (tr.docChanged) {
          lastContentPropRef.current = serializeToMarkdown(newState.doc)
          onChangeRef.current(lastContentPropRef.current)
        }
        if (tr.selectionSet || tr.docChanged) {
          onCursorPositionRef.current?.(newState.selection.head)
        }
      },
    })
    viewRef.current = view
    setViewReady(true)

    if (typeof initialCursorPos === 'number') {
      // Persisted cursor positions are PM document positions (see the
      // migration plan's "Cursor/scroll position persistence" section) —
      // positions saved by the old CM6 editor (raw markdown character
      // offsets) will land near-but-not-exactly the same spot on first
      // load post-migration; this defensive clamp (matching CM6's own
      // Math.min(pos, doc.length) guard) makes that a harmless one-time
      // imprecision rather than an out-of-range error.
      const pos = Math.min(initialCursorPos, view.state.doc.content.size)
      const selection = TextSelection.near(view.state.doc.resolve(pos))
      view.dispatch(view.state.tr.setSelection(selection))
    }
    if (autoFocus) view.focus()
    if (typeof initialScrollTop === 'number') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (view.dom.parentElement) view.dom.parentElement.scrollTop = initialScrollTop
      }))
    }

    onFocusRef?.(() => view.focus())
    onCommandsRef?.({
      undo: () => { undo(view.state, view.dispatch); view.focus() },
      redo: () => { redo(view.state, view.dispatch); view.focus() },
    })

    const scrollEl = view.dom.parentElement
    const onScroll = () => onScrollPositionRef.current?.(scrollEl?.scrollTop ?? 0)
    scrollEl?.addEventListener('scroll', onScroll)

    return () => {
      scrollEl?.removeEventListener('scroll', onScroll)
      view.destroy()
      viewRef.current = null
      setViewReady(false)
    }
    // Mount-only: note switching is handled by the effect below via
    // view.updateState with a freshly-parsed doc (mirrors the CM6 editor's
    // full-document-replace-on-switch behavior), not by remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Note switching: replace the document when `content` changes from
  // outside (a different note was opened) — but NOT on every keystroke.
  //
  // Compares against the LIVE DOCUMENT's current serialization, not a
  // separately-tracked "last emitted" ref (matching the CM6 editor's own
  // guard: `view.state.doc.toString() !== content`, NoteEditor.tsx:3475).
  // This was a real bug: comparing against a ref that's updated inside
  // dispatchTransaction can go stale relative to the live document whenever
  // a content-prop update arrives from an async source (e.g. the
  // noteChangeToken-driven refetch effect in NotesPanel, which runs on a
  // timer independent of the editor) while the user kept typing in the
  // meantime — the stale ref would then read as "this content is new to
  // us" even though the document already reflects the user's latest
  // keystrokes, wiping their most recent edits and resetting the cursor.
  // Comparing against the live doc means a same-content update is always
  // correctly recognized as a no-op regardless of the ref's timing.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = serializeToMarkdown(view.state.doc)
    if (current === content) {
      lastContentPropRef.current = content
      return
    }
    lastContentPropRef.current = content
    // Defensive: preserve the cursor's rough position across this reset
    // instead of leaving it at EditorState.create's document-start default.
    // A mismatch here is SUPPOSED to mean "a different note was opened",
    // where landing at the top is fine — but if it's ever triggered by
    // anything else (e.g. some not-yet-found round-trip edge case), a full
    // jump to position 0 while the user is mid-sentence is a much worse
    // failure mode than a same-note reparse that merely lands the cursor a
    // few characters off from where it was. Clamped to the new doc's size,
    // same guard as the initialCursorPos restore above.
    const oldPos = view.state.selection.from
    const newDoc = parseMarkdown(content)
    const newState = EditorState.create({
      schema,
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(Math.min(oldPos, newDoc.content.size))),
      plugins: view.state.plugins,
    })
    view.updateState(newState)
  }, [content])

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => mode === 'edit' })
  }, [mode])

  useEffect(() => {
    if (viewRef.current) setFindQuery(viewRef.current, findQuery)
  }, [findQuery])

  const filteredNotes = wikilinkTrigger
    ? (notesRef.current ?? [])
        .filter((n) => (n.title || 'Untitled').toLowerCase().includes(wikilinkTrigger.query.toLowerCase()))
        .slice(0, 8)
    : []

  function insertWikilink(note: Note) {
    const view = viewRef.current
    if (!view || !wikilinkTrigger) return
    const title = note.title || 'Untitled'
    replaceRangeWithWikilink(view, wikilinkTrigger.from, wikilinkTrigger.to, title)
    setWikilinkTrigger(null)
  }

  const filteredSlashCommands = slashTrigger ? filterSlashCommands(slashTrigger.query) : []

  function runSlashCommand(cmd: SlashCommand) {
    const view = viewRef.current
    if (!view || !slashTrigger) return
    cmd.run(view, slashTrigger.from, slashTrigger.to)
    setSlashTrigger(null)
  }

  async function insertStrongsBlock(num: string, from: number, to: number) {
    const view = viewRef.current
    if (!view) return
    setStrongsTrigger(null)
    const entry = await window.lexicon.getEntry(num).catch(() => null)
    if (!entry) { view.focus(); return }
    // buildLexiconCopyText returns "H1234 word;\ndefinition..." (1-2 lines
    // joined by '\n') — split back into real lines so replaceRangeWithBlock
    // creates genuine separate paragraphs, not a single text node with a
    // literal newline character buried in it (see autocomplete.ts's comment
    // on replaceRangeWithBlock for why that matters for block detection).
    replaceRangeWithBlock(view, from, to, buildLexiconCopyText(entry).split('\n'))
  }

  async function insertVerseBlock(ref: string, from: number, to: number) {
    const view = viewRef.current
    if (!view) return
    setVerseSuggestTrigger(null)
    const { ref: bareRef, lxx } = stripLxxMarker(ref)
    const parsed = parseRef(bareRef)
    if (!parsed?.verse) { view.focus(); return }
    const tid = lxx ? 'lxx' : (getTranslationForBook(parsed.bookId) ?? 'kjva')
    const label = lxx ? `${bareRef} LXX` : ref
    const isRange = parsed.endVerse && parsed.endVerse > parsed.verse
    if (isRange) {
      const nums = Array.from({ length: Math.min(parsed.endVerse! - parsed.verse + 1, 20) }, (_, i) => parsed.verse! + i)
      const rows = await Promise.all(nums.map((vn) => window.bible.queryVerse(parsed.bookId, parsed.chapter, vn, tid).catch(() => null)))
      const bodyLines = rows.map((v, i) => (v?.text ? `${nums[i]} ${v.text}` : null)).filter(Boolean) as string[]
      if (bodyLines.length === 0) { view.focus(); return }
      // Real separate paragraphs (one per verse line), not a joined string
      // through insertText — see autocomplete.ts's replaceRangeWithBlock
      // comment for why a single '\n'-joined text node fails block
      // detection/rendering entirely.
      replaceRangeWithBlock(view, from, to, [label, ...bodyLines])
    } else {
      const v = await window.bible.queryVerse(parsed.bookId, parsed.chapter, parsed.verse, tid).catch(() => null)
      if (!v?.text) { view.focus(); return }
      replaceRangeWithText(view, from, to, `${label} ${v.text}`)
    }
  }

  // Keyboard nav for whichever popup is open — mirrors NoteEditor.tsx's
  // document-level capture-phase keydown listener (arrow keys move the
  // wikilink list selection, Enter accepts the active item/block, Escape
  // dismisses and refocuses the editor).
  useEffect(() => {
    if (!wikilinkTrigger && !strongsTrigger && !verseSuggestTrigger && !slashTrigger) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (wikilinkTrigger && filteredNotes.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setWikilinkIdx((i) => Math.min(i + 1, filteredNotes.length - 1)); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setWikilinkIdx((i) => Math.max(i - 1, 0)); return }
        if (e.key === 'Enter') { e.preventDefault(); insertWikilink(filteredNotes[wikilinkIdx] ?? filteredNotes[0]); return }
      }
      if (slashTrigger && filteredSlashCommands.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, filteredSlashCommands.length - 1)); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlashCommand(filteredSlashCommands[slashIdx] ?? filteredSlashCommands[0]); return }
      }
      if (strongsTrigger && e.key === 'Enter') { e.preventDefault(); insertStrongsBlock(strongsTrigger.num, strongsTrigger.from, strongsTrigger.to); return }
      if (verseSuggestTrigger && e.key === 'Enter') { e.preventDefault(); insertVerseBlock(verseSuggestTrigger.ref, verseSuggestTrigger.from, verseSuggestTrigger.to); return }
      if (e.key === 'Escape') {
        e.preventDefault()
        setWikilinkTrigger(null); setStrongsTrigger(null); setVerseSuggestTrigger(null); setSlashTrigger(null)
        viewRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikilinkTrigger, strongsTrigger, verseSuggestTrigger, slashTrigger, wikilinkIdx, slashIdx, filteredNotes.length, filteredSlashCommands.length])

  // Clicking below/around the actual note content (very common — e.g. a
  // short note with lots of empty space beneath it) should still focus the
  // editor and place the cursor at the end, matching standard note-editor
  // UX. `.ProseMirror`'s own `min-height: 100%` (pmEditor.css) should
  // already make it fill this container, but this is a cheap, safe
  // fallback for any layout case where a click lands on the host div
  // itself rather than inside `.ProseMirror`.
  function handleHostMouseDown(e: ReactMouseEvent) {
    if (e.target !== hostRef.current) return
    const view = viewRef.current
    if (!view || mode !== 'edit') return
    e.preventDefault()
    view.focus()
    const endPos = view.state.doc.content.size
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(endPos), -1)))
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Persistent toolbar — not shown in the compact side-panel editor (BibleRightPanel's
          quick note view) or in read-only 'view' mode, matching SelectionToolbar.tsx's own
          edit-mode gating. */}
      {!isSidePanel && mode === 'edit' && viewReady && <Toolbar view={viewRef.current} />}
      <div
        ref={hostRef}
        onMouseDown={handleHostMouseDown}
        className={`berean-pm-editor flex-1 min-h-0 overflow-y-auto ${className}`}
      />
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
      {wikilinkTrigger && filteredNotes.length > 0 && (
        <WikilinkPopup
          notes={filteredNotes}
          x={wikilinkTrigger.coords.left}
          y={wikilinkTrigger.coords.bottom + 4}
          activeIdx={wikilinkIdx}
          onHoverIdx={setWikilinkIdx}
          onInsert={insertWikilink}
        />
      )}
      {strongsTrigger && (
        <StrongsSuggestPopup
          num={strongsTrigger.num}
          x={strongsTrigger.coords.left}
          y={strongsTrigger.coords.bottom + 4}
          onInsert={() => insertStrongsBlock(strongsTrigger.num, strongsTrigger.from, strongsTrigger.to)}
          onDismiss={() => setStrongsTrigger(null)}
        />
      )}
      {verseSuggestTrigger && (
        <VerseSuggestPopup
          refText={verseSuggestTrigger.ref}
          x={verseSuggestTrigger.coords.left}
          y={verseSuggestTrigger.coords.bottom + 4}
          onInsert={() => insertVerseBlock(verseSuggestTrigger.ref, verseSuggestTrigger.from, verseSuggestTrigger.to)}
          onDismiss={() => setVerseSuggestTrigger(null)}
        />
      )}
      {slashTrigger && filteredSlashCommands.length > 0 && (
        <SlashCommandPopup
          commands={filteredSlashCommands}
          x={slashTrigger.coords.left}
          y={slashTrigger.coords.bottom + 4}
          activeIdx={slashIdx}
          onHoverIdx={setSlashIdx}
          onSelect={runSlashCommand}
        />
      )}
      {selectionToolbar && mode === 'edit' && viewRef.current && (
        <SelectionToolbar view={viewRef.current} toolbarState={selectionToolbar} />
      )}
    </div>
  )
}
