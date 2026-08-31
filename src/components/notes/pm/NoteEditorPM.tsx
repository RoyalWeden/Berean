import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { gapCursor } from 'prosemirror-gapcursor'
import { dropCursor } from 'prosemirror-dropcursor'
import { bereanSchema as schema } from './schema'
import { parseMarkdown } from './parser'
import { serializeToMarkdown } from './serializer'
import { bereanKeymap, createBlockMovementKeymap } from './keymap'
import { bereanInputRules } from './inputRules'
import { bereanPastePlugin } from './pastePlugin'
import { createRefDecorationsPlugin, createRefClickPlugin } from './refDecorations'
import { createPlaceholderPlugin } from './placeholderPlugin'
import {
  createAutocompletePlugin, replaceRangeWithText, replaceRangeWithBlock, replaceRangeWithWikilink,
  type WikilinkTrigger, type StrongsTrigger, type VerseSuggestTrigger, type SlashCommandTrigger,
} from './autocomplete'
import { calloutNodeView, listItemNodeView, codeBlockNodeView, imageNodeView, studyTrailEmbedNodeView } from './nodeViews'
import { createHeadingCollapsePlugin, headingNodeView, computeHeadingKey, headingPositionsForKeys, setCollapsedHeadingPositions } from './headingCollapse'
import { createThreadCollapsePlugin, threadIdsPresentInDoc, setCollapsedThreadIds } from './threadCollapse'
import { threadNodeView, threadEntryNodeView } from './threadNodeView'
import { createBlockDecorationsPlugin } from './blockDecorations'
import { createCodeBlockHighlightPlugin } from './codeBlockHighlight'
import { createBlockHandlesPlugin, blockGripSelectMeta, type BlockMenuTarget } from './blockHandles'
import { createColumnControlsPlugin } from './columnControls'
import BlockMenu from './BlockMenu'
import { bereanTablePlugins } from './tablePlugins'
import { createSuppressRangesPlugin, suppressRangesKeymap } from './suppressRanges'
import { createFindHighlightPlugin, setFindQuery } from './findHighlight'
import { createSelectionToolbarPlugin, type SelectionToolbarState } from './selectionToolbarPlugin'
import { createTableStatusPlugin } from './tableStatusPlugin'
import { createThreadSelectionPlugin } from './threadSelectionPlugin'
import SelectionToolbar from './SelectionToolbar'
import Toolbar from './Toolbar'
import { StrongsSuggestPopup, VerseSuggestPopup, WikilinkPopup, SlashCommandPopup, RefHoverPreview } from './AutocompletePopups'
import { filterSlashCommands, type SlashCommand } from './slashCommands'
import { parseRef, getTranslationForBook, bookChapterVerseLabel, type ParsedRef } from '@/lib/parseRef'
import { stripLxxMarker } from '@/lib/noteTextBlocks'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { computeCaretScrollDelta } from '@/lib/caretScroll'
import { buildLexiconCopyText } from '@/components/lexicon/LexiconPanel'
import { useAppStore } from '@/store'
import type { Note } from '@/types'
import { VerseCopyMenu, type VerseCopyTarget } from '@/components/bible/VerseCopyMenu'
import { StrongsContextMenu, type StrongsContextTarget } from '@/components/lexicon/StrongsContextMenu'
import { dispatchCloseContextMenus, CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'
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
  noteId?: string
  // The tab this editor instance belongs to — scopes Focus mode (Toolbar.tsx) to just this
  // tab, so toggling it on doesn't leave chrome hidden after switching to a different tab.
  tabId?: string
  onChange: (content: string) => void
  placeholder?: string
  onFocusRef?: (focusFn: () => void) => void
  onCommandsRef?: (cmds: { undo: () => void; redo: () => void }) => void
  onScrollPosition?: (pos: number) => void
  onCursorPosition?: (pos: number) => void
  // Fluid-feel polish #2.3 — timestamp of the most recent successful autosave completion
  // (NotesPanel.tsx's handleContentChange/handleTitleChange, chained onto the real save
  // IPC promise). Forwarded to Toolbar, which shows/fades a brief "Saved" confirmation off
  // of it. Optional/undefined in contexts with no autosave signal to report (e.g. none
  // currently, but keeps this editor usable standalone without one).
  lastSavedAt?: number | null
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
  // Curated visual "look" while typing (see pmEditor.css's .pm-look-* rules) —
  // a quick-access preset next to the Edit/View toggle, separate from the
  // fuller font-family picker in Settings. 'default' needs no extra class.
  typingLook?: string
  // Idiom notes already have dedicated structured fields (IdiomHeader) for everything a
  // reference entry needs — the persistent formatting toolbar docked above THIS body
  // editor (for headings/tables/callouts etc.) has no real use there and was adding to
  // the note reading as cluttered. Selecting text still gets the on-selection bubble
  // toolbar (SelectionToolbar) either way — this only hides the always-visible docked bar.
  hideFormattingToolbar?: boolean
}

/** Verse text for the ref hover-preview / verse-block insertion, run through the same word
 *  replacer the reader uses (LORD→Yehovah, Jesus→Yeshua, LXX/Strong's restoration) so these
 *  popups don't show raw KJV wording the rest of the app never displays. */
function wrVerseText(row: { text?: string | null; text_tagged?: string | null } | null | undefined, textId: string): string {
  if (!row?.text) return ''
  const s = useAppStore.getState()
  return buildVerseDisplayText(row.text, row.text_tagged ?? null, textId, s.wordReplacerEnabled, s.wordReplacerRules)
}

export default function NoteEditorPM({
  content,
  noteId,
  tabId,
  onChange,
  placeholder,
  onFocusRef,
  onCommandsRef,
  onScrollPosition,
  onCursorPosition,
  lastSavedAt,
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
  hideFormattingToolbar,
  findQuery = '',
  importSource,
  importedAt,
  typingLook = 'default',
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
  // Read by createSuppressRangesPlugin's getNoteId — the plugin instance is
  // built once at mount and reused across every note switch (plugins are
  // baked into EditorState, see the mount effect below), so it can't take
  // noteId as a one-time constructor argument; it reads this ref instead,
  // which is kept current on every render, ahead of the note-switch effect
  // that rebuilds EditorState with the new note's content.
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId
  // Read by the note-switch effect below when it detects a genuinely different note opened
  // (not just an external content update to the same note) — kept current every render so the
  // effect always sees the latest restore target, since it can't depend on these directly
  // without re-running on every keystroke-driven position update.
  const initialScrollTopRef = useRef(initialScrollTop)
  initialScrollTopRef.current = initialScrollTop
  const initialCursorPosRef = useRef(initialCursorPos)
  initialCursorPosRef.current = initialCursorPos
  const autoFocusRef = useRef(autoFocus)
  autoFocusRef.current = autoFocus

  const [wikilinkTrigger, setWikilinkTrigger] = useState<WikilinkTrigger | null>(null)
  const [strongsTrigger, setStrongsTrigger] = useState<StrongsTrigger | null>(null)
  const [verseSuggestTrigger, setVerseSuggestTrigger] = useState<VerseSuggestTrigger | null>(null)
  const [slashTrigger, setSlashTrigger] = useState<SlashCommandTrigger | null>(null)
  const [tagTrigger, setTagTrigger] = useState<import('./autocomplete').TagTrigger | null>(null)
  const [tagIdx, setTagIdx] = useState(0)
  const verseTags = useAppStore((s) => s.verseTags)
  const setVerseTags = useAppStore((s) => s.setVerseTags)
  // Tell the store a note editor is on screen so the bottom-right Study Trail arrival toast
  // lifts clear of this editor's word-count / reading-time footer (same corner).
  const bumpNoteEditorOpen = useAppStore((s) => s.bumpNoteEditorOpen)
  useEffect(() => {
    bumpNoteEditorOpen(1)
    return () => bumpNoteEditorOpen(-1)
  }, [bumpNoteEditorOpen])
  // Hover-preview popup (RefHoverPreview, AutocompletePopups.tsx) — verse refs show real verse
  // text, Strong's refs show the short definition, wikilinks show the target note's own preview
  // (WikilinkPopup's single-pane content, reused rather than building a second preview format).
  // Implemented locally rather than only through the onWikilinkHoverStart/End props (kept below
  // for any external consumer that wants to observe hover too) — those props existed already but
  // had no actual popup behind them anywhere in the app; verse/Strong's refs had neither the
  // props nor a popup. `seq` guards against a slow verse/lexicon fetch from a PREVIOUS hover
  // resolving after the user has already moved to (or off of) a different ref.
  const [refHoverPreview, setRefHoverPreview] = useState<{ x: number; y: number; refLabel: string; text: string; loading: boolean } | null>(null)
  const refHoverSeqRef = useRef(0)
  const [wikilinkIdx, setWikilinkIdx] = useState(0)
  const [slashIdx, setSlashIdx] = useState(0)
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null)
  const [inTable, setInTable] = useState(false)

  // Dismiss the floating "select text to format" toolbar on: any right-click
  // anywhere in the app (App.tsx's capture-phase contextmenu listener already
  // dispatches CLOSE_CONTEXT_MENUS_EVENT for every right-click, not just ones
  // that open a menu), the floating search bar opening (openSearch() already
  // dispatches berean:closeMenus), or a click anywhere outside the editor
  // entirely. Previously this toolbar only reacted to its own internal
  // dropdown state and to the ProseMirror selection collapsing via a
  // transaction — clicking somewhere that fires no PM transaction at all
  // (the sidebar, a different panel) left it stranded on screen even though
  // focus had moved away, since neither global dismiss event nor an outside-
  // editor click were wired up at all.
  useEffect(() => {
    if (!selectionToolbar) return
    const onGlobalClose = () => setSelectionToolbar(null)
    window.addEventListener('berean:closeMenus', onGlobalClose)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onGlobalClose)
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement
      // Clicking inside the editor is left to ProseMirror's own selection-
      // change handling (already correct); clicking the toolbar itself (or
      // one of its dropdown popovers, all sharing the .pm-toolbar-solid
      // class — SelectionToolbar isn't portaled, but also isn't a DOM
      // descendant of hostRef, so it needs its own class-based exclusion)
      // must not dismiss it either.
      if (hostRef.current?.contains(target)) return
      if (target.closest('.pm-toolbar-solid')) return
      setSelectionToolbar(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      window.removeEventListener('berean:closeMenus', onGlobalClose)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onGlobalClose)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [selectionToolbar])

  const [verseCtxTarget, setVerseCtxTarget] = useState<VerseCopyTarget | null>(null)
  const [strongsCtxTarget, setStrongsCtxTarget] = useState<StrongsContextTarget | null>(null)
  const [blockMenuTarget, setBlockMenuTarget] = useState<BlockMenuTarget | null>(null)
  // Read by createBlockMovementKeymap's Escape binding (keymap.ts) — kept current every
  // render, same stable-ref pattern as refCallbacksRef, since the keymap plugin is built
  // once at mount and can't take these as one-time constructor values. Escape must only
  // select the enclosing block when NOTHING else is already claiming it: any autocomplete
  // popup, the block-menu, either right-click context menu, or the app-wide floating
  // search (Cmd+K) — matching the task brief's explicit "do not break those" call-out.
  const popupsOpenRef = useRef(false)
  popupsOpenRef.current = !!(
    wikilinkTrigger || strongsTrigger || verseSuggestTrigger || slashTrigger || tagTrigger
    || blockMenuTarget || verseCtxTarget || strongsCtxTarget || useAppStore.getState().searchOpen
  )
  const notesRef = useRef(notes)
  notesRef.current = notes

  // Click/hover callbacks are wrapped in a stable ref object so the plugin
  // instance (built once at mount, since plugins are baked into EditorState)
  // always calls the LATEST callback identity without needing to rebuild the
  // whole plugin/state on every render.
  const refCallbacksRef = useRef({ onWikilinkClick, onVerseRefClick, onLexiconRefClick, onWikilinkHoverStart, onWikilinkHoverEnd })
  refCallbacksRef.current = { onWikilinkClick, onVerseRefClick, onLexiconRefClick, onWikilinkHoverStart, onWikilinkHoverEnd }

  // Verse-ref/Strong's-ref right-click menus are handled entirely inside this
  // component (unlike the click callbacks above, which the parent supplies) —
  // kept in a ref for the same reason: the plugin instance is built once at
  // mount, so it must always call through to the LATEST handler identity.
  const ctxMenuHandlersRef = useRef({
    onVerseRefContextMenu: (_ref: ParsedRef & { forcedTranslation?: string }, _x: number, _y: number) => {},
    onLexiconRefContextMenu: (_id: string, _x: number, _y: number) => {},
  })

  // Same "local handler, plugin built once at mount" reasoning as ctxMenuHandlersRef above,
  // for the hover-preview popup's handlers (defined further down, near handleVerseRefContextMenu).
  const hoverHandlersRef = useRef({
    onWikilinkHoverStart: (_title: string, _rect: DOMRect) => {},
    onVerseRefHoverStart: (_ref: ParsedRef & { forcedTranslation?: string }, _rect: DOMRect) => {},
    onLexiconRefHoverStart: (_id: string, _rect: DOMRect) => {},
    onTagRefHoverStart: (_name: string, _rect: DOMRect) => {},
    onRefHoverEnd: () => {},
  })

  // Cursor-follow scroll while typing (fluid-feel polish #2.1) — keeps the caret comfortably
  // inside the scrollable viewport instead of letting it drift toward the very edge before the
  // browser's own native caret-follow (which only guarantees the caret is SOMEWHERE on screen,
  // not comfortably clear of the edge) catches up. Pure threshold math lives in
  // src/lib/caretScroll.ts (unit-tested there); this just supplies the two real DOM
  // measurements (caret coords via view.coordsAtPos, viewport rect via the scroll container)
  // and applies the resulting delta. `scroll-behavior: smooth` on .berean-pm-editor
  // (pmEditor.css) turns this scrollTop nudge into an actual animated scroll rather than a
  // jump. Deliberately reuses the same "only scroll when actually out of the comfortable
  // zone" shape as ChapterView.tsx's Read Aloud auto-follow effect, rather than centering or
  // scrolling unconditionally on every keystroke.
  function scrollCaretIntoComfortableView(view: EditorView) {
    const scrollEl = view.dom.parentElement
    if (!scrollEl) return
    let coords: { top: number; bottom: number }
    try {
      coords = view.coordsAtPos(view.state.selection.head)
    } catch {
      // coordsAtPos can throw for a position that isn't currently rendered/measurable
      // (e.g. mid-transaction on a doc shape ProseMirror hasn't painted yet) — skip this
      // pass rather than let a rare edge case break typing.
      return
    }
    const viewportRect = scrollEl.getBoundingClientRect()
    const delta = computeCaretScrollDelta(coords, viewportRect)
    if (delta !== 0) scrollEl.scrollTop += delta
  }

  // Fired by headingNodeView on a real user click (never by the hydration path below) —
  // persists the toggle to berean.db via IPC. Fire-and-forget: a failed write (DB busy,
  // note deleted mid-toggle) just means the collapse doesn't survive to the next session,
  // never something worth surfacing to the user over — matches the "degrade silently"
  // framing the whole feature was scoped under.
  function persistHeadingCollapse(view: EditorView, pos: number, collapsed: boolean) {
    const noteId = noteIdRef.current
    // `window.notes?.setHeadingCollapsed` (not just `!noteId`) — guards test/Storybook-style
    // mounts with no `window.notes` bridge at all (this app's IPC preload is only present
    // inside the real Electron renderer), not just the "no note id yet" case.
    if (!noteId || !window.notes?.setHeadingCollapsed) return
    const key = computeHeadingKey(view.state.doc, pos)
    if (!key) return
    window.notes.setHeadingCollapsed(noteId, key, collapsed).catch(() => {})
  }

  // Hydrates persisted collapse state onto a freshly-opened note — called once right after
  // the view exists (mount) and again on every genuine note switch (not on same-note content
  // refreshes, which would otherwise re-collapse whatever the user is actively expanding/
  // collapsing right now). `view` is passed explicitly and re-checked against `viewRef.current`
  // once the async IPC round-trip resolves, so a note switched away from again mid-flight (or
  // an unmounted editor) never applies a stale hydration onto whatever's open by then.
  function loadCollapsedHeadings(view: EditorView, noteId: string | undefined) {
    if (!noteId || !window.notes?.getCollapsedHeadings) return
    window.notes.getCollapsedHeadings(noteId).then((keys) => {
      if (viewRef.current !== view || keys.length === 0) return
      const positions = headingPositionsForKeys(view.state.doc, keys)
      if (positions.length > 0) setCollapsedHeadingPositions(view, positions)
    }).catch(() => {})
  }

  // Thread-collapse counterpart of persistHeadingCollapse above — fired by threadNodeView on a
  // real user click, never by the hydration path below. Fire-and-forget for the same reason.
  function persistThreadCollapse(view: EditorView, threadId: string, collapsed: boolean) {
    const noteId = noteIdRef.current
    if (!noteId || !window.notes?.setThreadCollapsed) return
    window.notes.setThreadCollapsed(noteId, threadId, collapsed).catch(() => {})
  }

  // Thread-collapse counterpart of loadCollapsedHeadings above. threadIdsPresentInDoc is the
  // simpler analogue of headingPositionsForKeys here — a thread's id is its own stable attr
  // (schema.ts), not a key that has to be resolved back to a live position.
  function loadCollapsedThreads(view: EditorView, noteId: string | undefined) {
    if (!noteId || !window.notes?.getCollapsedThreads) return
    window.notes.getCollapsedThreads(noteId).then((ids) => {
      if (viewRef.current !== view || ids.length === 0) return
      const present = threadIdsPresentInDoc(view.state.doc, ids)
      if (present.length > 0) setCollapsedThreadIds(view, present)
    }).catch(() => {})
  }

  // Restores a saved scroll position as an instant jump, bypassing the `scroll-behavior:
  // smooth` #2.1 sets on .berean-pm-editor (pmEditor.css) for the caret-follow nudge —
  // opening a note or switching notes should land you exactly where you left off
  // immediately, not visibly animate to it.
  function snapScrollTop(el: HTMLElement | null, top: number) {
    if (!el) return
    const prevBehavior = el.style.scrollBehavior
    el.style.scrollBehavior = 'auto'
    el.scrollTop = top
    el.style.scrollBehavior = prevBehavior
  }

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
        // Own plugin (not folded into the shared bereanKeymap above) — its Escape/Mod-Shift-
        // Arrow bindings need to close over per-instance popup state via popupsOpenRef, unlike
        // bereanKeymap, which is one module-scope plugin object reused by every editor.
        createBlockMovementKeymap(() => popupsOpenRef.current),
        suppressRangesKeymap,
        gapCursor(),
        dropCursor(),
        bereanPastePlugin,
        createSuppressRangesPlugin(() => noteIdRef.current),
        // createBlockDecorationsPlugin MUST be registered before createRefDecorationsPlugin —
        // refDecorations.ts's own buildDecorations() reads blockDecorations.ts's cached
        // DecorationSet (via blockDecorationsKey.getState) instead of recomputing the same
        // full-document verse/lexicon-block detection walk a second time on every keystroke.
        // ProseMirror computes each plugin's new state in array order for a given transaction,
        // so the reader must come AFTER the plugin whose state it reads, or it sees last
        // transaction's stale value instead of the current one. createPlaceholderPlugin/
        // createAutocompletePlugin/createHeadingCollapsePlugin moved down with it only to keep
        // this move minimal — none of them compete for keymaps/click handling with what's now
        // ahead of them, and their own relative order to EACH OTHER and to createBlockHandlesPlugin/
        // createColumnControlsPlugin/etc. below is unchanged.
        createBlockDecorationsPlugin(),
        createCodeBlockHighlightPlugin(),
        createRefDecorationsPlugin(),
        createRefClickPlugin({
          onWikilinkClick: (title) => refCallbacksRef.current.onWikilinkClick?.(title),
          onVerseRefClick: (ref) => refCallbacksRef.current.onVerseRefClick?.(ref),
          onLexiconRefClick: (id) => refCallbacksRef.current.onLexiconRefClick?.(id),
          onWikilinkHoverStart: (title, rect) => hoverHandlersRef.current.onWikilinkHoverStart(title, rect),
          onVerseRefHoverStart: (ref, rect) => hoverHandlersRef.current.onVerseRefHoverStart(ref, rect),
          onLexiconRefHoverStart: (id, rect) => hoverHandlersRef.current.onLexiconRefHoverStart(id, rect),
          onRefHoverEnd: () => hoverHandlersRef.current.onRefHoverEnd(),
          onTagRefClick: (name) => {
            const s = useAppStore.getState()
            s.openScriptureSearchTab(undefined, { tagNames: [name] })
            s.setActiveSpace('scripture')
          },
          onTagRefHoverStart: (name, rect) => hoverHandlersRef.current.onTagRefHoverStart(name, rect),
          onVerseRefContextMenu: (ref, x, y) => ctxMenuHandlersRef.current.onVerseRefContextMenu(ref, x, y),
          onLexiconRefContextMenu: (id, x, y) => ctxMenuHandlersRef.current.onLexiconRefContextMenu(id, x, y),
        }),
        createPlaceholderPlugin(),
        createAutocompletePlugin({
          onWikilinkTrigger: (t) => { setWikilinkTrigger(t); setWikilinkIdx(0) },
          onStrongsTrigger: setStrongsTrigger,
          onVerseSuggestTrigger: setVerseSuggestTrigger,
          onSlashCommandTrigger: (t) => { setSlashTrigger(t); setSlashIdx(0) },
          onTagTrigger: (t) => { setTagTrigger(t); setTagIdx(0) },
          enableStrongsSuggest: () => (isSidePanel ? useAppStore.getState().sidePanelScriptureBlock : useAppStore.getState().noteStrongsBlockSuggest) !== false,
          enableVerseSuggest: () => (isSidePanel ? useAppStore.getState().sidePanelScriptureBlock : useAppStore.getState().noteVerseBlockSuggest) !== false,
        }),
        createHeadingCollapsePlugin(),
        createThreadCollapsePlugin(),
        createBlockHandlesPlugin(
          (target) => {
            dispatchCloseContextMenus()
            setBlockMenuTarget(target)
          },
          (v, pos) => {
            const coords = v.coordsAtPos(pos)
            setSlashIdx(0)
            setSlashTrigger({ query: '', from: pos, to: pos, coords: { left: coords.left, bottom: coords.bottom } })
          },
        ),
        createColumnControlsPlugin(),
        createFindHighlightPlugin(),
        createSelectionToolbarPlugin(setSelectionToolbar),
        createTableStatusPlugin(setInTable),
        createThreadSelectionPlugin(),
      ],
    })

    const view = new EditorView(hostRef.current, {
      state,
      editable: () => mode === 'edit',
      attributes: placeholder ? { 'data-placeholder': placeholder } : {},
      nodeViews: {
        callout: (node) => calloutNodeView(node),
        list_item: (node, editorView, getPos) => listItemNodeView(getPos)(node, editorView),
        heading: (node, editorView, getPos) => headingNodeView(getPos, persistHeadingCollapse)(node, editorView),
        code_block: (node, editorView, getPos) => codeBlockNodeView(getPos)(node, editorView),
        image: (node, editorView, getPos) => imageNodeView(getPos)(node, editorView),
        thread: (node, editorView, getPos) => threadNodeView(getPos, persistThreadCollapse)(node, editorView),
        thread_entry: (node) => threadEntryNodeView(node),
        study_trail_embed: (node) => studyTrailEmbedNodeView(node),
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
          // Same trigger condition as the cursor-position callback above (typing or an
          // explicit selection change) — not a timer, not every redraw.
          //
          // Exception: the block-gutter grip stages a NodeSelection on MOUSEDOWN, before the
          // native drag gesture starts (blockHandles.ts — PM's own dragstart reads what to
          // drag out of view.state.selection, so it has to happen there). Scrolling the
          // container while a mousedown is still pending cancels Chromium's HTML5 drag
          // outright, which read as dragging intermittently doing nothing at all —
          // intermittently, because it only bites when the grabbed block happens to sit
          // outside the comfort zone. The same meta rides the post-drop selection collapse,
          // which likewise must not yank the viewport around.
          if (!tr.getMeta(blockGripSelectMeta)) scrollCaretIntoComfortableView(view)
        }
      },
      handleDOMEvents: {
        // OS-level text-replacement tools (macOS text substitution, Raycast snippet
        // expansion, etc.) can eat an extra character next to what they're actually
        // replacing/erasing. ProseMirror's default handling infers the changed range from its
        // DOM-mutation observer (readDOMChange), which can miscompute the range by one
        // character when multiple synthetic mutations land in the same observer flush — these
        // tools fire their edits far faster than a real user's keystrokes ever would.
        // getTargetRanges() is the DOM's own authoritative signal for exactly which range a
        // given beforeinput event affects, computed synchronously at dispatch time rather than
        // inferred after the fact by diffing — so applying it directly as one explicit
        // transaction sidesteps the ambiguity entirely, regardless of how many other synthetic
        // events are queued up around it.
        //
        // Originally only covered `insertReplacementText` (macOS text substitution's own single
        // "replace this range" event). Raycast doesn't use that — it expands a snippet by
        // simulating discrete OS-level keystrokes instead: some number of `deleteContentBackward`
        // events erasing the trigger text, then `insertText` events typing the replacement —
        // which the original condition let fall straight through to the same diffing path,
        // reported as deleting the character BEFORE the trigger during that backspace burst.
        // `deleteContentBackward`/`deleteContentForward` are now handled too, but ONLY when
        // `getTargetRanges()` reports a deletion fully within a single text node — i.e. never a
        // delete that would join/merge across a node or block boundary (backspacing an empty
        // paragraph into the one above, outdenting a list item, etc.), which needs PM's own
        // structural Backspace command from baseKeymap, not a blind range delete. Erasing a
        // plain-text snippet trigger is always an intra-text-node deletion, so this still covers
        // the actual failure mode without touching structural backspace behavior at all.
        beforeinput(view, event) {
          const ie = event as InputEvent & { getTargetRanges?: () => StaticRange[] }
          const isReplacement = ie.inputType === 'insertReplacementText'
          const isDelete = ie.inputType === 'deleteContentBackward' || ie.inputType === 'deleteContentForward'
          if (!isReplacement && !isDelete) return false
          const ranges = ie.getTargetRanges?.()
          if (!ranges || ranges.length !== 1) return false
          const [range] = ranges
          if (isDelete && (range.startContainer !== range.endContainer || range.startContainer.nodeType !== Node.TEXT_NODE)) return false
          const from = view.posAtDOM(range.startContainer, range.startOffset)
          const to = view.posAtDOM(range.endContainer, range.endOffset)
          if (from < 0 || to < 0 || from > to) return false
          if (isDelete && from === to) return false // nothing to delete — let default handling run
          view.dispatch(isReplacement ? view.state.tr.insertText(ie.data ?? '', from, to) : view.state.tr.delete(from, to))
          event.preventDefault()
          return true
        },
        // Clicking in the empty space below the note's actual content (very common — a short
        // note leaves most of `.ProseMirror`'s own `min-height: 100%` box empty) needs to place
        // the cursor at the end and, when the last block is something other than a plain
        // textblock (an image, or a thread/callout/table/column_list container), append a fresh
        // empty paragraph to land in — reported as "click below a thread and it keeps scrolling
        // up." Root cause: for a plain trailing paragraph, PM's own default
        // coordsAtPos-based click resolution already lands close to where the user actually
        // clicked, so nothing here needs to run. For a non-textblock last node (an image is a
        // leaf atom; a thread's own chrome is contentEditable=false DOM that doesn't map 1:1 to
        // real cursor positions), that same default resolution can land the selection somewhere
        // visually far from the click — often near the TOP of that node — and
        // dispatchTransaction's scrollCaretIntoComfortableView() above then "corrects" the
        // scroll position toward that wrongly-resolved caret, which is what actually produces
        // the scroll-up jump. Only firing when `event.target === view.dom` (the empty
        // `.ProseMirror` background itself, not any real child node) keeps this from ever
        // intercepting a legitimate click on real content.
        mousedown(view, event) {
          if (event.target !== view.dom || mode !== 'edit') return false
          const { doc } = view.state
          const last = doc.lastChild
          if (last && last.isTextblock) return false // default resolution already lands correctly here
          event.preventDefault()
          const endPos = doc.content.size
          const tr = view.state.tr.insert(endPos, schema.nodes.paragraph.create())
          tr.setSelection(TextSelection.near(tr.doc.resolve(endPos + 1)))
          view.dispatch(tr)
          view.focus()
          return true
        },
      },
    })
    viewRef.current = view
    setViewReady(true)
    loadCollapsedHeadings(view, noteIdRef.current)
    loadCollapsedThreads(view, noteIdRef.current)

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
      // Was double-nested rAF (wait two frames before the scroll restore fires) with no comment
      // explaining why two specifically — flagged in the notes-feel pass as adding a visible
      // "paint at scroll-top-0, then jump" delay on a previously-scrolled note. ProseMirror
      // applies its DOM mutations synchronously (unlike React), so there's no real second commit
      // to wait out here; one frame is enough margin for the browser to finish the layout pass
      // from those mutations before reading/writing scrollTop. Revert to double if this turns
      // out to occasionally restore against a not-yet-settled layout in practice.
      requestAnimationFrame(() => {
        // Restoring a saved position should snap instantly, not animate — #2.1's
        // `scroll-behavior: smooth` on .berean-pm-editor (pmEditor.css) is meant for the
        // caret-follow nudge only. Toggle it off for this one instant jump, matching the
        // note-switch effect's own restore below.
        snapScrollTop(view.dom.parentElement, initialScrollTop)
      })
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
  // Tracks the noteId this effect last actually applied — separate from `noteIdRef` (that one
  // is overwritten to the LATEST prop value on every render, before this effect even runs, so
  // it can't be compared against itself to detect "did noteId change since last time").
  const prevSwapNoteIdRef = useRef(noteId)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const isDifferentNote = noteId !== prevSwapNoteIdRef.current
    prevSwapNoteIdRef.current = noteId
    const current = serializeToMarkdown(view.state.doc)
    if (current === content) {
      lastContentPropRef.current = content
      return
    }
    lastContentPropRef.current = content
    // Defensive: preserve the cursor's rough position across this reset instead of leaving it
    // at EditorState.create's document-start default — but only for a same-note external
    // content update (e.g. the noteChangeToken refetch effect in NotesPanel). A genuinely
    // different note has its OWN saved scroll/cursor position to restore instead (applied
    // below) — this component now stays mounted across note switches (ActivePanel no longer
    // remounts NotesPanel for same-type tab switches), so unlike before, this effect is the
    // only place that restore can happen; the mount effect further down only ever runs once.
    const oldPos = view.state.selection.from
    const newDoc = parseMarkdown(content)
    const newState = EditorState.create({
      schema,
      doc: newDoc,
      selection: isDifferentNote && typeof initialCursorPosRef.current === 'number'
        ? TextSelection.near(newDoc.resolve(Math.min(initialCursorPosRef.current, newDoc.content.size)))
        : TextSelection.near(newDoc.resolve(Math.min(oldPos, newDoc.content.size))),
      plugins: view.state.plugins,
    })
    view.updateState(newState)
    if (isDifferentNote) {
      loadCollapsedHeadings(view, noteId)
      loadCollapsedThreads(view, noteId)
      if (autoFocusRef.current) view.focus()
      if (typeof initialScrollTopRef.current === 'number') {
        const top = initialScrollTopRef.current
        // Single rAF — see the identical mount-time restore above for why this dropped the
        // second nested frame.
        requestAnimationFrame(() => {
          snapScrollTop(view.dom.parentElement, top)
        })
      }
    }
  }, [content, noteId])

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => mode === 'edit' })
  }, [mode])

  useEffect(() => {
    if (viewRef.current) setFindQuery(viewRef.current, findQuery)
  }, [findQuery])

  // Scroll to a heading when NoteSidePanel's Contents list fires
  // berean:scrollToHeading — the ProseMirror-migration equivalent of the
  // legacy CM6 editor's own handler (NoteEditor.tsx). That legacy handler is
  // dead code (NotesPanel.tsx renders NoteEditorPM, not NoteEditor, as the
  // live editor), so the event fired but nothing was listening — the side
  // panel's Contents clicks silently did nothing.
  useEffect(() => {
    function handler(e: Event) {
      const { headingText } = (e as CustomEvent<{ headingText: string }>).detail
      const view = viewRef.current
      if (!view) return
      let targetPos: number | null = null
      view.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false
        if (node.type.name === 'heading' && node.textContent.trim() === headingText.trim()) {
          targetPos = pos
          return false
        }
        return true
      })
      if (targetPos === null) return
      const dom = view.nodeDOM(targetPos)
      const el = dom instanceof HTMLElement ? dom : (dom as ChildNode | null)?.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const selection = TextSelection.near(view.state.doc.resolve(Math.min(targetPos + 1, view.state.doc.content.size)))
      view.dispatch(view.state.tr.setSelection(selection))
      if (mode === 'edit') view.focus()
    }
    window.addEventListener('berean:scrollToHeading', handler)
    return () => window.removeEventListener('berean:scrollToHeading', handler)
  }, [mode])

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

  // #tag autocomplete: existing verse tags matching the typed query, plus a "create" option.
  const tagQ = (tagTrigger?.query ?? '').toLowerCase()
  const filteredTags = tagTrigger
    ? verseTags.filter((t) => !tagQ || t.name.toLowerCase().includes(tagQ))
    : []
  const tagExactExists = verseTags.some((t) => t.name.toLowerCase() === tagQ)
  const tagOptionCount = filteredTags.length + (tagQ && !tagExactExists ? 1 : 0)

  async function chooseTag(idx: number) {
    const view = viewRef.current
    if (!view || !tagTrigger) return
    let name: string
    if (idx < filteredTags.length) {
      name = filteredTags[idx].name
    } else {
      name = tagTrigger.query.trim()
      if (!name) return
      try { setVerseTags(await window.verseTags.create(name)) } catch { /* keep going, insert text anyway */ }
    }
    replaceRangeWithText(view, tagTrigger.from, tagTrigger.to, `#${name} `)
    setTagTrigger(null)
  }

  async function insertStrongsBlock(num: string, from: number, to: number) {
    const view = viewRef.current
    if (!view) return
    setStrongsTrigger(null)
    const entry = await window.lexicon.getEntry(num).catch(() => null)
    // Re-check after the await: if the user switched notes/closed this editor while the
    // lookup was in flight, cleanup already ran view.destroy() and cleared viewRef.current —
    // dispatching a transaction against that stale, destroyed `view` crashes deep inside
    // ProseMirror's DOM diffing ("Cannot read properties of null (reading 'matchesNode')"),
    // since the destroyed view's DOM is gone. viewRef.current !== view also covers the (rarer)
    // case where a NEW view was mounted in the meantime.
    if (viewRef.current !== view) return
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
      // Re-check after the await(s): if the user switched notes/closed this editor while the
      // range fetch was in flight, cleanup already ran view.destroy() and cleared
      // viewRef.current — dispatching against that stale, destroyed `view` crashes deep inside
      // ProseMirror's DOM diffing ("Cannot read properties of null (reading 'matchesNode')"),
      // since the destroyed view's DOM is gone.
      if (viewRef.current !== view) return
      const bodyLines = rows.map((v, i) => (v?.text ? `${nums[i]} ${wrVerseText(v, tid)}` : null)).filter(Boolean) as string[]
      if (bodyLines.length === 0) { view.focus(); return }
      // Real separate paragraphs (one per verse line), not a joined string
      // through insertText — see autocomplete.ts's replaceRangeWithBlock
      // comment for why a single '\n'-joined text node fails block
      // detection/rendering entirely.
      replaceRangeWithBlock(view, from, to, [label, ...bodyLines])
    } else {
      const v = await window.bible.queryVerse(parsed.bookId, parsed.chapter, parsed.verse, tid).catch(() => null)
      if (viewRef.current !== view) return // see the range branch's comment above
      if (!v?.text) { view.focus(); return }
      replaceRangeWithText(view, from, to, `${label} ${wrVerseText(v, tid)}`)
    }
  }

  async function handleVerseRefContextMenu(ref: ParsedRef & { forcedTranslation?: string }, x: number, y: number) {
    if (!ref.verse) return
    dispatchCloseContextMenus()
    const tid = ref.forcedTranslation === 'LXX' ? 'lxx' : (getTranslationForBook(ref.bookId) ?? 'kjva')
    const v = await window.bible.queryVerse(ref.bookId, ref.chapter, ref.verse, tid).catch(() => null)
    setVerseCtxTarget({
      bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, text: wrVerseText(v, tid),
      lxx: ref.forcedTranslation === 'LXX', x, y,
    })
  }

  function handleLexiconRefContextMenu(strongsId: string, x: number, y: number) {
    dispatchCloseContextMenus()
    setStrongsCtxTarget({ strongsNum: strongsId, x, y })
  }

  // ── Hover-preview popup (RefHoverPreview) ────────────────────────────────────
  // See refHoverPreview's own state comment above for why this exists as real local behavior
  // now instead of only the pass-through onWikilinkHoverStart/End props. `seq` is bumped on
  // every hover start/end so a slow fetch from an ABANDONED hover (mouse already moved to a
  // different ref, or off any ref) can't land after the fact and show stale content under the
  // wrong ref, or resurrect the popup after handleRefHoverEnd already dismissed it.
  async function handleVerseRefHoverStart(ref: ParsedRef & { forcedTranslation?: string }, rect: DOMRect) {
    if (!ref.verse) return
    const seq = ++refHoverSeqRef.current
    // A range ref ("Deuteronomy 18:15-19") carries endVerse — fold it into both the label
    // ("18:15-19", not just "18:15") and the fetched text (every verse in the range, not
    // only the start verse), same-chapter ranges only (endChapter ranges aren't produced by
    // the hover-trigger regex here).
    const endVerse = ref.endVerse != null && ref.endVerse > ref.verse ? ref.endVerse : undefined
    // A comma-grouped ref ("Deuteronomy 32:3,6,9-13") arrives with verseGroups (>1 entry) —
    // preview every group's verse(s), not just the first.
    const groups = ref.verseGroups && ref.verseGroups.length > 1 ? ref.verseGroups : null
    const groupLabel = groups
      ? groups.map((g) => (g.endVerse && g.endVerse > g.verse ? `${g.verse}-${g.endVerse}` : `${g.verse}`)).join(',')
      : null
    const refLabel = groupLabel
      ? `${bookChapterVerseLabel(ref.bookId, ref.chapter)}:${groupLabel}${ref.forcedTranslation === 'LXX' ? ' LXX' : ''}`
      : `${bookChapterVerseLabel(ref.bookId, ref.chapter, ref.verse)}${endVerse ? `-${endVerse}` : ''}${ref.forcedTranslation === 'LXX' ? ' LXX' : ''}`
    setRefHoverPreview({ x: rect.left, y: rect.bottom + 4, refLabel, text: '', loading: true })
    const tid = ref.forcedTranslation === 'LXX' ? 'lxx' : (getTranslationForBook(ref.bookId) ?? 'kjva')
    let text = ''
    if (groups) {
      const verses = await window.bible.queryChapter(ref.bookId, ref.chapter, tid).catch(() => null)
      if (Array.isArray(verses)) {
        const inGroups = (n: number) => groups.some((g) => n >= g.verse && n <= (g.endVerse && g.endVerse > g.verse ? g.endVerse : g.verse))
        text = verses.filter((v) => inGroups(v.verse_num)).map((v) => `${v.verse_num} ${wrVerseText(v, tid)}`).join('  ')
      }
    } else if (endVerse) {
      const verses = await window.bible.queryChapter(ref.bookId, ref.chapter, tid).catch(() => null)
      if (Array.isArray(verses)) {
        text = verses
          .filter((v) => v.verse_num >= ref.verse! && v.verse_num <= endVerse)
          .map((v) => wrVerseText(v, tid))
          .join(' ')
      }
    } else {
      const v = await window.bible.queryVerse(ref.bookId, ref.chapter, ref.verse, tid).catch(() => null)
      text = wrVerseText(v, tid)
    }
    if (seq !== refHoverSeqRef.current) return
    setRefHoverPreview({ x: rect.left, y: rect.bottom + 4, refLabel, text, loading: false })
  }

  async function handleLexiconRefHoverStart(strongsId: string, rect: DOMRect) {
    const seq = ++refHoverSeqRef.current
    setRefHoverPreview({ x: rect.left, y: rect.bottom + 4, refLabel: strongsId, text: '', loading: true })
    const entry = await window.lexicon.getEntry(strongsId).catch(() => null)
    if (seq !== refHoverSeqRef.current) return
    setRefHoverPreview({
      x: rect.left, y: rect.bottom + 4, refLabel: strongsId,
      text: entry ? buildLexiconCopyText(entry).split('\n').slice(1).join(' ') : '',
      loading: false,
    })
  }

  async function handleTagRefHoverStart(name: string, rect: DOMRect) {
    const seq = ++refHoverSeqRef.current
    const tag = useAppStore.getState().verseTags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (!tag) {
      setRefHoverPreview({ x: rect.left, y: rect.bottom + 4, refLabel: `#${name}`, text: 'No such tag', loading: false })
      return
    }
    setRefHoverPreview({ x: rect.left, y: rect.bottom + 4, refLabel: `#${tag.name}`, text: '', loading: true })
    const members = await window.verseTags.getMembers([tag.id]).catch(() => [])
    if (seq !== refHoverSeqRef.current) return
    const labels = members.slice(0, 8).map((m) => m.label)
    const more = members.length > 8 ? `  …+${members.length - 8} more` : ''
    setRefHoverPreview({
      x: rect.left, y: rect.bottom + 4, refLabel: `#${tag.name}`,
      text: labels.length ? labels.join(' · ') + more : 'No verses tagged yet',
      loading: false,
    })
  }

  function handleWikilinkHoverStart(title: string, rect: DOMRect) {
    refCallbacksRef.current.onWikilinkHoverStart?.(title, rect)
    refHoverSeqRef.current++ // no async fetch of our own — just invalidate any in-flight verse/lexicon one
    const note = (notesRef.current ?? []).find((n) => (n.title || 'Untitled').toLowerCase() === title.toLowerCase())
    const snippet = (note?.content || '')
      .replace(/^---[\s\S]*?---\n?/, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/[*_`~]/g, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim()
      .slice(0, 300)
    setRefHoverPreview({ x: rect.left, y: rect.bottom + 4, refLabel: title, text: snippet || 'No content', loading: false })
  }

  function handleRefHoverEnd() {
    refCallbacksRef.current.onWikilinkHoverEnd?.()
    refHoverSeqRef.current++
    setRefHoverPreview(null)
  }

  function openStrongsEntry(strongsId: string) {
    const store = useAppStore.getState()
    if (store.tabs['lexicon'].length === 0) store.createTab('lexicon')
    useAppStore.getState().setActiveSpace('lexicon')
    useAppStore.getState().openLexiconEntry(strongsId)
  }

  function openStrongsEntryInNewTab(strongsId: string) {
    const store = useAppStore.getState()
    store.createTab('lexicon')
    useAppStore.getState().openLexiconEntry(strongsId)
    useAppStore.getState().setActiveSpace('lexicon')
  }

  ctxMenuHandlersRef.current = { onVerseRefContextMenu: handleVerseRefContextMenu, onLexiconRefContextMenu: handleLexiconRefContextMenu }
  hoverHandlersRef.current = {
    onWikilinkHoverStart: handleWikilinkHoverStart,
    onVerseRefHoverStart: handleVerseRefHoverStart,
    onLexiconRefHoverStart: handleLexiconRefHoverStart,
    onTagRefHoverStart: handleTagRefHoverStart,
    onRefHoverEnd: handleRefHoverEnd,
  }

  // Keyboard nav for whichever popup is open — mirrors NoteEditor.tsx's
  // document-level capture-phase keydown listener (arrow keys move the
  // wikilink list selection, Enter accepts the active item/block, Escape
  // dismisses and refocuses the editor).
  useEffect(() => {
    if (!wikilinkTrigger && !strongsTrigger && !verseSuggestTrigger && !slashTrigger && !tagTrigger) return
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
      if (tagTrigger && tagOptionCount > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setTagIdx((i) => Math.min(i + 1, tagOptionCount - 1)); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setTagIdx((i) => Math.max(i - 1, 0)); return }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); void chooseTag(Math.min(tagIdx, tagOptionCount - 1)); return }
      }
      if (strongsTrigger && e.key === 'Enter') { e.preventDefault(); insertStrongsBlock(strongsTrigger.num, strongsTrigger.from, strongsTrigger.to); return }
      if (verseSuggestTrigger && e.key === 'Enter') { e.preventDefault(); insertVerseBlock(verseSuggestTrigger.ref, verseSuggestTrigger.from, verseSuggestTrigger.to); return }
      if (e.key === 'Escape') {
        e.preventDefault()
        setWikilinkTrigger(null); setStrongsTrigger(null); setVerseSuggestTrigger(null); setSlashTrigger(null); setTagTrigger(null)
        viewRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikilinkTrigger, strongsTrigger, verseSuggestTrigger, slashTrigger, tagTrigger, wikilinkIdx, slashIdx, tagIdx, tagOptionCount, filteredNotes.length, filteredSlashCommands.length])

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
    <div className="relative flex flex-col h-full min-h-0">
      {/* Persistent toolbar — not shown in the compact side-panel editor (BibleRightPanel's
          quick note view) or in read-only 'view' mode, matching SelectionToolbar.tsx's own
          edit-mode gating. Floats over the editor (this wrapper is `relative` so its own
          `absolute` positioning docks against it) rather than sitting in normal flow, so it
          never changes the editor's available height. */}
      {!isSidePanel && !hideFormattingToolbar && mode === 'edit' && viewReady && (
        <Toolbar view={viewRef.current} tabId={tabId} inTable={inTable} lastSavedAt={lastSavedAt} />
      )}
      <div
        ref={hostRef}
        onMouseDown={handleHostMouseDown}
        className={`berean-pm-editor flex-1 min-h-0 overflow-y-auto ${!isSidePanel && !hideFormattingToolbar && mode === 'edit' ? 'pm-has-floating-toolbar' : ''} ${isSidePanel ? 'pm-side-panel-note' : ''} ${typingLook !== 'default' ? `pm-look-${typingLook}` : ''} ${className}`}
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
      {tagTrigger && tagOptionCount > 0 && createPortal(
        <div
          className="fixed z-[60] min-w-[180px] max-h-[240px] overflow-y-auto rounded-shell context-menu py-1 animate-radix-popup-in"
          style={{ left: tagTrigger.coords.left, top: tagTrigger.coords.bottom + 4, backgroundColor: 'rgb(var(--color-surface-2) / 0.98)' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {filteredTags.map((t, i) => (
            <button
              key={t.id}
              onMouseEnter={() => setTagIdx(i)}
              onClick={() => void chooseTag(i)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer ${i === tagIdx ? 'bg-[rgb(var(--color-surface-4))]' : ''} text-[rgb(var(--color-text-primary))]`}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color ? `rgb(var(--highlight-${t.color}))` : 'rgb(var(--color-text-muted))' }} />
              <span className="truncate">{t.name}</span>
              <span className="ml-auto text-[10px] text-[rgb(var(--color-text-muted))]">{t.verseCount + t.chapterCount}</span>
            </button>
          ))}
          {tagQ && !tagExactExists && (
            <button
              onMouseEnter={() => setTagIdx(filteredTags.length)}
              onClick={() => void chooseTag(filteredTags.length)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer ${tagIdx === filteredTags.length ? 'bg-[rgb(var(--color-surface-4))]' : ''} text-[rgb(var(--color-accent))]`}
            >
              + Create “{tagTrigger.query.trim()}”
            </button>
          )}
        </div>,
        document.body,
      )}
      {selectionToolbar && mode === 'edit' && viewRef.current && (
        <SelectionToolbar view={viewRef.current} toolbarState={selectionToolbar} />
      )}
      <BlockMenu target={blockMenuTarget} view={viewRef.current} noteId={noteId} onClose={() => setBlockMenuTarget(null)} />
      <VerseCopyMenu target={verseCtxTarget} onClose={() => setVerseCtxTarget(null)} />
      <StrongsContextMenu
        target={strongsCtxTarget}
        onClose={() => setStrongsCtxTarget(null)}
        onOpen={openStrongsEntry}
        onOpenNewTab={openStrongsEntryInNewTab}
      />
      {refHoverPreview && (
        <RefHoverPreview
          x={refHoverPreview.x} y={refHoverPreview.y}
          refLabel={refHoverPreview.refLabel} text={refHoverPreview.text} loading={refHoverPreview.loading}
        />
      )}
    </div>
  )
}
