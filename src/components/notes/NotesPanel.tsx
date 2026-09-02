import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MenuPositioner, CLOSE_CONTEXT_MENUS_EVENT, usePositionedMenu } from '@/lib/usePositionedMenu'
import NoteIconPicker from './NoteIconPicker'
import { Plus, Home, Trash2, HelpCircle, X, Search, Eye, EyeOff, Paperclip, CheckSquare, SortAsc, Filter, AlignJustify, BookOpen, BookText, Printer, FolderTree, NotepadText, FolderPlus, FolderInput, ExternalLink, PenLine, History, SlidersHorizontal, Columns3, List, Undo2, Redo2 } from 'lucide-react'
import NoteVersionHistory from './NoteVersionHistory'
import ContinuousDailyScroll from './ContinuousDailyScroll'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import HeaderOverflowMenu from '@/components/shell/HeaderOverflowMenu'
import HeaderSegmentedToggle from '@/components/shell/HeaderSegmentedToggle'
import NotesList from './NotesList'
import NoteEditor from './pm/NoteEditorPM'
import PrintPreviewModal from './PrintPreviewModal'
import { extractRefsFromNote, type NoteVerseRef } from '@/lib/noteRefs'
import NoteSidePanel from './NoteSidePanel'
import NoteLookDropdown from './NoteLookDropdown'
import NoteStatusDropdown from './NoteStatusDropdown'
import NotesBoardView from './NotesBoardView'
import FindBar from '@/components/shell/FindBar'
import { useAppStore } from '@/store'
import { recordNavigation } from '@/lib/verseNavigation'
import { bookChapterVerseLabel, getTranslationForBook, resolveBookToken } from '@/lib/parseRef'
import type { ParsedRef } from '@/lib/parseRef'
import type { Note, NoteTabState, Tab, NoteFolder, NoteStatus } from '@/types'
import { NOTE_STATUSES, noteStatusMeta } from '@/lib/noteStatus'
import NotesFolderView, { folderPathFor, noteIsMovable } from './NotesFolderView'
import { orderedFolders } from './NoteContextMenu'
import { isSystemNote, isDailyNote, dailyNoteDateKey, parseVerseRef, normalizeWikiTarget } from '@/lib/noteUtils'
import { getAllNotes, getWarmStartNotes } from '@/lib/notesCache'
import { getCachedNote, setCachedNote } from '@/lib/noteCache'
import { toDateKey, dailyNoteTitle, dailyNoteDisplayTitle, dailyNoteToday } from '@/lib/dailyNoteUtils'
import { readingRegionScale } from '@/lib/zoom'

type NoteFilter = 'all' | 'scripture' | 'topic' | 'daily' | 'youtube' | 'biblegateway' | 'esword' | 'idiom'
type StatusFilter = 'all' | 'no-status' | NoteStatus
type NoteSort = 'modified' | 'created' | 'name'
type NotesViewMode = 'list' | 'folder' | 'board'

// Session-level warm cache for the notes-home view state. NotesPanel remounts every time
// you switch INTO the Notes space from another space (ActivePanel keys it 'panel:note'),
// and its view-mode / folder list were previously seeded from async IPC (window.settings /
// window.notes.getFolders) — so for one painted frame the home view showed the default
// 'list' with no folders, then snapped to the real state once IPC resolved. Caching both
// here (populated the first time they load, updated on every change) lets the useState
// initializers below read them synchronously on every subsequent mount → no flash.
// Pre-warmed once at module load so even the first switch into Notes is usually instant.
let cachedNotesViewMode: NotesViewMode | null = null
let cachedFolders: NoteFolder[] | null = null
try {
  window.settings?.get('notesViewMode').then((v) => {
    if (v === 'folder' || v === 'board' || v === 'list') cachedNotesViewMode = v
    else if (v == null) {
      window.settings?.get('notesFolderView').then((legacy) => {
        if (legacy === true) cachedNotesViewMode = 'folder'
      }).catch(() => {})
    }
  }).catch(() => {})
  window.notes?.getFolders().then((f) => { cachedFolders = f }).catch(() => {})
} catch { /* window.* not ready at module eval in some contexts — the mount effect still loads */ }

// Days begin at dawn, not midnight (see dailyNoteUtils.ts's getDailyNoteAnchorDate) —
// dailyNoteToday() returns the sunrise-shifted "today" wherever that matters.
function todayKey(): string { return toDateKey(dailyNoteToday()) }


function formatVerseRef(ref: string): string {
  const [bookId, chapter, verse] = ref.split('.')
  if (!bookId) return ref
  return bookChapterVerseLabel(bookId, Number(chapter), verse ? Number(verse) : undefined)
}

// Top-bar-only display form of a note's title — for daily notes, "Tuesday, August 5,
// 2026" instead of the raw "Daily — 2026-08-05" stored/used everywhere else (DB, tab
// bar, sidebar). Falls back to the raw title for non-daily notes or an unparseable date.
function headerDisplayTitle(note: Note): string {
  if (isDailyNote(note)) {
    const dateKey = dailyNoteDateKey(note)
    if (dateKey) return dailyNoteDisplayTitle(dateKey)
  }
  return note.title || 'Untitled'
}

// A brand-new note previously showed just a blank editor with zero hint text — only idiom notes
// (below, still handled separately since its body is explicitly optional scratch space) got a
// real placeholder. Kept short and genuinely useful (a concrete first move, not just "start
// typing") rather than a generic filler line.
function noteEditorPlaceholder(note: Note): string | undefined {
  if (note.type === 'idiom') return undefined // handled by its own dedicated placeholder below
  if (isDailyNote(note)) return "What happened today? Type a verse reference (e.g. Gen 1:1) to pull it in, or just write…"
  if (note.verseRef) return 'Your thoughts on this verse…'
  return "Start writing — type / for blocks, [[ to link another note, or a verse reference (e.g. Rom 8:28) to pull it in…"
}

export default function NotesPanel({ floating = false }: { floating?: boolean }) {
  const pendingNoteId = useAppStore((s) => s.pendingNoteId)
  const clearPendingNote = useAppStore((s) => s.clearPendingNote)
  const pendingNotesSearchTab = useAppStore((s) => s.pendingNotesSearchTab)
  const clearNotesSearchTab = useAppStore((s) => s.clearNotesSearchTab)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpNoteEditToken = useAppStore((s) => s.bumpNoteEditToken)
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const noteTypingLook = useAppStore((s) => s.noteTypingLook)
  const setNoteTypingLook = useAppStore((s) => s.setNoteTypingLook)
  const activeTabId = useAppStore((s) => s.activeTabId.notes)
  // Narrowed to this panel's own space — see BiblePanel.tsx's identical comment for why.
  const tabs = useAppStore((s) => s.tabs.notes)
  const renameTab = useAppStore((s) => s.renameTab)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const youtubeIsPlaying = useAppStore((s) => s.youtubeIsPlaying)
  const notesTabId = activeTabId
  const pushTabNav = useAppStore((s) => s.pushTabNav)
  const resetTabNavHome = useAppStore((s) => s.resetTabNavHome)
  const notesHomeToken = useAppStore((s) => s.notesHomeToken)

  const sessions = useAppStore((s) => s.sessions)
  const addTab = useAppStore((s) => s.addTab)
  const switchSession = useAppStore((s) => s.switchSession)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const noteTransformLayout = useAppStore((s) => s.noteTransformLayout)
  const setIdiomCache = useAppStore((s) => s.setIdiomCache)
  const continuousDailyScroll = useAppStore((s) => s.continuousDailyScroll)

  // Lazy-seed from notesCache's token-independent warm start (this session's last fetch, or —
  // via localStorage — a previous session's) so the notes list renders with real data on the
  // very first frame instead of empty. The effect below still does the real, token-matched
  // fetch and corrects this shortly after if anything actually changed — see
  // notesCache.ts's getWarmStartNotes for why a token-exact cache read doesn't work here.
  const [notes, setNotes] = useState<Note[]>(() => getWarmStartNotes() ?? [])
  // Scroll container for the list-view NotesList — read by its virtualizer so
  // only visible rows are mounted regardless of total note count.
  const notesListScrollRef = useRef<HTMLDivElement>(null)
  // Lazy initializer reads the previously-viewed day for THIS tab, since ActivePanel fully
  // remounts NotesPanel on every tab switch — without this, returning to a tab in
  // continuous-daily-scroll mode always snapped back to today, discarding wherever the user
  // had scrolled to.
  const [continuousDailyDate, setContinuousDailyDate] = useState(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    const saved = (tab?.state as NoteTabState | undefined)?.continuousDailyDate
    return saved ? new Date(saved) : dailyNoteToday()
  })
  // Resync when notesTabId changes WITHOUT a remount (ActivePanel no longer remounts
  // NotesPanel for same-type tab switches — see its own comment) — the lazy initializer above
  // only runs once per true mount, so without this, switching to a different tab while in
  // continuous-daily-scroll mode would keep showing whichever day the FIRST tab was on.
  const prevContinuousDailyTabIdRef = useRef(notesTabId)
  useEffect(() => {
    if (notesTabId === prevContinuousDailyTabIdRef.current) return
    prevContinuousDailyTabIdRef.current = notesTabId
    const tab = tabs.find((t) => t.id === notesTabId)
    const saved = (tab?.state as NoteTabState | undefined)?.continuousDailyDate
    setContinuousDailyDate(saved ? new Date(saved) : dailyNoteToday())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesTabId])
  // Persist the in-view day whenever it changes (continuous-daily-scroll mode).
  useEffect(() => {
    if (!notesTabId) return
    updateTabState('notes', notesTabId, { continuousDailyDate: continuousDailyDate.getTime() })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousDailyDate, notesTabId])
  // Idioms → single PDF export: opens the print preview directly (options live in the modal).
  const [idiomsModalOpen, setIdiomsModalOpen] = useState(false)
  // A note queued for print/PDF export from the right-click menu (without opening it).
  const [printNote, setPrintNote] = useState<Note | null>(null)
  // Lazy initializer seeds from a warm noteCache entry (if this note was seen before this
  // session) so the editor renders immediately on tab-switch remount instead of starting at
  // null and showing the list view until the async restore fetch below resolves — see
  // src/lib/noteCache.ts for why.
  const [activeNote, setActiveNote] = useState<Note | null>(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    const tabState = tab?.state as NoteTabState | undefined
    if (tabState?.isNew || !tabState?.noteId) return null
    return getCachedNote(tabState.noteId)
  })
  // Keep noteCache warm for every note this panel ever shows, regardless of which of the
  // many setActiveNote() call sites produced it.
  useEffect(() => {
    if (activeNote) setCachedNote(activeNote)
  }, [activeNote])

  // Render-phase reset when switching TO a tab whose home view is the notes list (a fresh
  // tab, or one with no open note). The tab-switch restore effect below also does this, but
  // effects run after paint — so for one frame the panel would still show the PREVIOUS tab's
  // note before the effect clears it, reading as "it flashes something else then shows the
  // list." Clearing here, during render, removes that frame. (Same idea as BiblePanel's
  // prevBibleTabIdForResetRef.) Only the home case: a tab that DOES have a note gets the
  // async restore path, which the warm-cache lazy initializer above already covers.
  const prevNotesTabIdForResetRef = useRef(notesTabId)
  if (notesTabId !== prevNotesTabIdForResetRef.current) {
    prevNotesTabIdForResetRef.current = notesTabId
    const nextTab = tabs.find((t) => t.id === notesTabId)
    const nextState = nextTab?.state as NoteTabState | undefined
    if ((nextState?.isNew || !nextState?.noteId) && activeNote !== null) {
      setActiveNote(null)
    }
  }
  // True while we're still trying to restore the previously-open note for this tab
  // (async IPC lookup). Prevents the tab-title effect below from briefly renaming
  // the tab to the generic "Notes" fallback before the real title has loaded — that
  // flash was visible every time you switched to an existing Notes tab. NotesPanel is
  // actually a single shared instance reused across every Notes tab (PanelLayout.tsx
  // renders one, not one keyed per tab, despite what an earlier version of this comment
  // claimed) — the restore effect below now re-arms this to true at the start of every
  // tab switch, not just once via this initializer, so the guard actually covers repeat
  // switches and not just the very first mount.
  const [noteRestorePending, setNoteRestorePending] = useState(() => {
    const tab = useAppStore.getState().tabs['notes'].find((t) => t.id === useAppStore.getState().activeTabId['notes'])
    const tabState = tab?.state as NoteTabState | undefined
    return !tabState?.isNew && !!tabState?.noteId
  })
  const openMarkdownReference = useAppStore((s) => s.openMarkdownReference)

  // ── Find bar — local to the notes panel, per-panel routing ────────────────
  // App.tsx dispatches 'berean:openNotesFindBar' when Cmd+F is pressed while this
  // panel was the last-focused panel (tracked via activePanelId in the store).
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)
  // Print preview modal
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  // Version snapshot cadence: consolidate rapid edits into one version on idle / note switch.
  const lastSnapshotContentRef = useRef<string | null>(null)
  const snapshotIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const SNAPSHOT_IDLE_MS = 2 * 60 * 1000
  const notesContentRef = useRef<HTMLDivElement>(null)
  const activeNoteRef = useRef<Note | null>(null)
  // Snapshot of exactly what THIS panel last told the DB to persist (set at the
  // moment handleContentChange/handleTitleChange's debounced save actually
  // fires) — used by the noteChangeToken reconciliation effect below to tell
  // "this token bump was our own save echoing back" apart from a real external
  // edit, without racing against the user having typed further in the
  // meantime. See that effect's comment for the full race it closes.
  const lastSelfSaveRef = useRef<{ content: string; title: string } | null>(null)
  // Fluid-feel polish #2.3 (quiet autosave "Saved" indicator, Toolbar.tsx) — a timestamp
  // bumped only when the debounced autosave's OWN save IPC call actually resolves (chained
  // onto the same window.notes.updateNote(...) promise handleContentChange/handleTitleChange
  // already fire, not a new save-tracking mechanism or a timer of its own). Passed down
  // through NoteEditorPM to Toolbar, which shows/fades a small confirmation off of it.
  const [lastAutosaveAt, setLastAutosaveAt] = useState<number | null>(null)
  // NotesPanel is a single shared instance reused across every Notes tab (PanelLayout.tsx
  // renders one, not one per tab). Right after switching tabs, `activeNote` still holds the
  // PREVIOUS tab's note for one render until the restore effect below catches up — the persist
  // effect further down also depends on notesTabId, so it fires in that same window and would
  // write the old tab's note id into the tab you just switched to. This flag, set synchronously
  // at the top of the restore effect and consumed by exactly one persist-effect run, skips just
  // that one stale write without needing to touch every one of the many setActiveNote() call
  // sites elsewhere in this file (which persist correctly on their own once the tab has settled).
  const skipNextPersistRef = useRef(false)
  // Same-tick guard for the title-sync effect below. Re-arming noteRestorePending to true
  // (a STATE update) inside the restore effect doesn't take effect until the NEXT render —
  // but the title-sync effect also depends on notesTabId, so it fires in the very SAME commit
  // as the restore effect, still reading the OLD (stale, not-yet-applied) noteRestorePending
  // and the OLD activeNote. That one-pass race is exactly what caused the tab title to flicker
  // to the previous tab's title before correcting itself — re-arming noteRestorePending fixed
  // every pass EXCEPT this first one. A ref, unlike state, is visible synchronously to a later
  // effect in the same commit, so it closes that specific gap.
  const tabSwitchInFlightRef = useRef(false)
  // "Latest request wins" guard shared by the tab-restore effect and the explicit
  // pendingNoteId open effect below — both can end up racing to set activeNote when a
  // Cmd+K search jump reactivates an existing (stale) notes tab via ensureTab() while also
  // requesting a different note via requestOpenNote(): if the restore effect's async
  // window.notes.getNote() for the OLD note resolves after the pendingNoteId effect's fetch
  // for the intended note, it would silently clobber the correct note back to the wrong one.
  // Each effect stamps its own sequence number before starting async work and only applies
  // the result if no newer request has started in the meantime.
  const openSeqRef = useRef(0)
  // The guard above only works if it's already true by the time the title-sync effect RUNS —
  // but that effect is declared earlier in this file than the restore effect that used to be
  // the only place setting it, and React fires a component's effects in declaration order
  // within a commit. So on the very commit notesTabId changes, title-sync fired FIRST (reading
  // the previous tab's still-current activeNote and renaming the NEW tab to the OLD tab's
  // title), and only THEN did the restore effect run and set the guard — one render too late.
  // Setting the guard here, directly in the render body the instant notesTabId is seen to
  // differ from the last-seen value, makes it true before ANY effect in that commit runs,
  // regardless of declaration order — this is React's documented pattern for "adjusting state
  // when a prop changes" during render rather than in an effect.
  const prevNotesTabIdForGuardRef = useRef<string | null>(null)
  if (prevNotesTabIdForGuardRef.current !== notesTabId) {
    prevNotesTabIdForGuardRef.current = notesTabId
    tabSwitchInFlightRef.current = true
  }
  const [localFindOpen, setLocalFindOpen] = useState(false)
  const [localFindQuery, setLocalFindQuery] = useState('')
  const [findMatchIdx, setFindMatchIdx] = useState(0)
  const [noteSearch, setNoteSearch] = useState('')
  const [noteSearchWordMode, setNoteSearchWordMode] = useState<'all' | 'any' | 'phrase'>('all')
  // Real FTS5 results for the current noteSearch/noteSearchWordMode — replaces the
  // plain substring `.includes()` filter this used to be. `null` means "no search
  // active" (visibleNotes then falls back to the full locally-loaded `notes` list,
  // as before); an empty array means "searched, found nothing." Debounced so fast
  // typing doesn't fire a query per keystroke.
  const [noteSearchResults, setNoteSearchResults] = useState<Note[] | null>(null)
  useEffect(() => {
    const q = noteSearch.trim()
    if (!q) { setNoteSearchResults(null); return }
    const timer = setTimeout(() => {
      window.notes.searchNotes(q, 500, noteSearchWordMode)
        .then(setNoteSearchResults)
        .catch(() => setNoteSearchResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [noteSearch, noteSearchWordMode])

  // Keep ref in sync so the event handler always sees the latest activeNote
  useEffect(() => { activeNoteRef.current = activeNote }, [activeNote])

  // Pick up a query pushed in from the floating search bar's "Notes" button —
  // reveal the list view (the search box lives there) and seed its search input.
  useEffect(() => {
    if (!pendingNotesSearchTab) return
    const term = pendingNotesSearchTab
    clearNotesSearchTab()
    setActiveNote(null)
    setNoteSearch(term)
  }, [pendingNotesSearchTab, clearNotesSearchTab])

  // Listen for App.tsx's routed find-bar open event (also handles type-anywhere seed char)
  useEffect(() => {
    function onOpenNotesFindBar(e: Event) {
      const seedChar = (e as CustomEvent).detail?.seedChar ?? ''
      if (localFindOpen) {
        // Already open — re-focus the input and select its text (don't close).
        window.dispatchEvent(new CustomEvent('berean:findBarSelectAll'))
        return
      }
      // Only one overlay open at a time — opening this find bar closes any
      // open "More" menu/other overlay via the shared broadcast.
      window.dispatchEvent(new CustomEvent('berean:closeMenus'))
      setLocalFindOpen(true)
      setLocalFindQuery(seedChar)
      setFindMatchIdx(0)
    }
    window.addEventListener('berean:openNotesFindBar', onOpenNotesFindBar)
    return () => window.removeEventListener('berean:openNotesFindBar', onOpenNotesFindBar)
  }, [localFindOpen])

  // Rail's Presenter button (Ribbon.tsx) dispatches this after ensuring the
  // viewer window is open — mirrors the find-bar routing pattern above since
  // pushing content depends on activeNoteRef, which only this panel has.
  useEffect(() => {
    function onPresenterPush() {
      if (activeNoteRef.current) window.app.pushViewerContent?.({ kind: 'note', noteId: activeNoteRef.current.id })
    }
    window.addEventListener('berean:presenterPushNote', onPresenterPush)
    return () => window.removeEventListener('berean:presenterPushNote', onPresenterPush)
  }, [])

  // ...and the reverse: an open "More" menu / Settings closes this find bar.
  useEffect(() => {
    function onCloseMenus() { setLocalFindOpen(false) }
    window.addEventListener('berean:closeMenus', onCloseMenus)
    return () => window.removeEventListener('berean:closeMenus', onCloseMenus)
  }, [])

  // Only one context menu app-wide: close the +/move menus when any other opens.
  useEffect(() => {
    function onClose() { setPlusMenu(null); setMoveMenu(null) }
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
  }, [])

  // Cmd+P (App.tsx) — same routing pattern as berean:openNotesFindBar/presenterPushNote
  // above, since printPreviewOpen/activeNote are local state only this panel has.
  useEffect(() => {
    function onOpenPrintPreview() {
      if (activeNoteRef.current) setPrintPreviewOpen(true)
    }
    window.addEventListener('berean:openPrintPreview', onOpenPrintPreview)
    return () => window.removeEventListener('berean:openPrintPreview', onOpenPrintPreview)
  }, [])

  // Find bar is visible only when a note is open (note view, not the notes list)
  const findBarVisible = localFindOpen && activeNote !== null
  const activeListFindQuery = ''  // notes list search uses the dedicated search bar, not the findbar

  // Count matches in the open note's content
  const findMatchCount = useMemo(() => {
    if (!findBarVisible || !localFindQuery.trim() || !activeNote) return 0
    const q = localFindQuery.trim().toLowerCase()
    const text = ((activeNote.title || '') + ' ' + activeNote.content).toLowerCase()
    let count = 0
    let i = 0
    while ((i = text.indexOf(q, i)) !== -1) { count++; i += q.length }
    return count
  }, [findBarVisible, localFindQuery, activeNote])

  // Reset active-mark index when query or context changes
  useEffect(() => { setFindMatchIdx(0) }, [localFindQuery, findBarVisible])

  // Navigate to the active .berean-find-mark in the DOM after React paints
  useEffect(() => {
    document.querySelectorAll('.berean-find-mark-active').forEach((el) => el.classList.remove('berean-find-mark-active'))
    if (!findBarVisible) return
    const container = notesContentRef.current
    if (!container) return
    const marks = container.querySelectorAll<HTMLElement>('.berean-find-mark')
    if (marks[findMatchIdx]) {
      marks[findMatchIdx].classList.add('berean-find-mark-active')
      marks[findMatchIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [findMatchIdx, findMatchCount, findBarVisible])

  function findPrev() {
    if (!findMatchCount) return
    setFindMatchIdx((prev) => (prev - 1 + findMatchCount) % findMatchCount)
  }

  function findNext() {
    if (!findMatchCount) return
    setFindMatchIdx((prev) => (prev + 1) % findMatchCount)
  }

  function closeFindBarLocal() {
    setLocalFindOpen(false)
    setLocalFindQuery('')
    setFindMatchIdx(0)
  }

  // ── Filter / sort / select state ─────────────────────────────────────────
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('all')
  // Independent of noteFilter (type-based) — combinable (AND) with it. 'no-status' is a
  // distinct option from 'all' so notes with no status can be isolated too.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [noteSort, setNoteSort] = useState<NoteSort>('modified')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null)
  const [expandAll, setExpandAll] = useState(false)
  // Exactly one of list/folder/board is active at any time — a single tri-state selector
  // (rather than two independent booleans) so switching to one view always leaves the others
  // off, and the toggle control is available no matter which view you're currently on.
  const [viewMode, setViewMode] = useState<NotesViewMode>(() => cachedNotesViewMode ?? 'list')
  const folderView = viewMode === 'folder'
  const boardView = viewMode === 'board'
  const [folders, setFolders] = useState<NoteFolder[]>(() => cachedFolders ?? [])
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number } | null>(null)
  const iconPicker = usePositionedMenu<{ _tag?: 'icon' }>()
  const [idiomModal, setIdiomModal] = useState<{ term: string; meaning: string; folderId?: string | null } | null>(null)
  const [convertIdiomModal, setConvertIdiomModal] = useState<{ note: Note; term: string; meaning: string; keepContent: boolean } | null>(null)
  // One-time "click a note to open it" hint above the notes list — dismissed
  // permanently (localStorage) the first time the user closes it or opens any note.
  const OPEN_NOTE_HINT_KEY = 'berean:hint:clickNoteToOpen'
  const [openNoteHintDismissed, setOpenNoteHintDismissed] = useState(() => {
    try { return localStorage.getItem(OPEN_NOTE_HINT_KEY) === '1' } catch { return false }
  })
  const dismissOpenNoteHint = useCallback(() => {
    setOpenNoteHintDismissed(true)
    try { localStorage.setItem(OPEN_NOTE_HINT_KEY, '1') } catch { /* ignore */ }
  }, [])

  const loadFolders = useCallback(() => {
    return window.notes.getFolders().then((f) => { cachedFolders = f; setFolders(f) }).catch(() => {})
  }, [])

  // Load folders + persisted view-mode preference on mount. Falls back to the legacy
  // 'notesFolderView' boolean setting (pre-dating the board view / unified selector) so
  // existing users who had folder view on keep opening into it after the update.
  useEffect(() => {
    loadFolders()
    window.settings?.get('notesViewMode').then((v) => {
      if (v === 'folder' || v === 'board' || v === 'list') {
        cachedNotesViewMode = v
        setViewMode(v)
        if (v === 'folder') setNoteFilter('all')
        return
      }
      window.settings?.get('notesFolderView').then((legacy) => {
        if (legacy === true) { cachedNotesViewMode = 'folder'; setViewMode('folder'); setNoteFilter('all') }
      }).catch(() => {})
    }).catch(() => {})
  }, [loadFolders])

  const changeViewMode = useCallback((next: NotesViewMode) => {
    cachedNotesViewMode = next
    setViewMode(next)
    window.settings?.set('notesViewMode', next).catch(() => {})
    // Entering folder view: a stale non-'all' filter left over from list view (its chip UI
    // is hidden here) would silently keep narrowing folder-view search results with no
    // visible indication a filter is active.
    if (next === 'folder') setNoteFilter('all')
  }, [])

  /** Map idiom notes to export entries, auto-detecting the scripture references each cites. */
  function idiomExportEntries() {
    const fmt = (r: NoteVerseRef): string => {
      if (r.isChapter || r.verse === 0) return bookChapterVerseLabel(r.bookId, r.chapter)
      return `${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${r.endVerse ? `-${r.endVerse}` : ''}`
    }
    return notes.filter((n) => n.type === 'idiom').map((n) => {
      const d = n.idiomData ?? {}
      // Examples aren't part of the export output, but they're still useful text to mine
      // for scripture references the idiom note otherwise doesn't list explicitly.
      const textForRefs = [...(d.examples ?? []), d.explanation ?? '', n.content ?? ''].join('\n')
      const seen = new Set<string>()
      const autoVerse = extractRefsFromNote(textForRefs, n.idiomTerm || n.title || '').map(fmt)
      const verses = [...new Set([...(d.verses ?? []), ...autoVerse])].filter((v) => { const ok = !seen.has(v); seen.add(v); return ok })
      return { term: n.idiomTerm || n.title || '', meaning: n.idiomMeaning, aliases: n.idiomAliases, explanation: d.explanation, compare: d.compare, verses }
    })
  }

  /** Idioms → single PDF export control (button + options popover). Rendered in the notes
   *  header so it's reachable from both list and folder view; only shown when idioms exist. */
  function renderIdiomsExport() {
    if (!notes.some((n) => n.type === 'idiom')) return null
    return (
      <button
        onClick={() => setIdiomsModalOpen(true)}
        title="Export all idioms to a single PDF"
        className="flex-shrink-0 p-1 rounded cursor-pointer transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
      >
        <BookText size={15} />
      </button>
    )
  }

  // Folder operation handlers — call IPC then reload folders + notes
  const reloadNotes = useCallback(() => {
    window.notes.getNotes(100000, 0).then(setNotes).catch(() => {})
    window.notes.listIdioms?.().then(setIdiomCache).catch(() => {})
  }, [setIdiomCache])
  // Auto-focus-rename right after creating a folder, instead of leaving it named "New Folder"
  // until the user separately hovers/right-clicks → Rename. NotesFolderView already has the
  // full rename UI (inline input, auto-focus-and-select, Enter/Escape/blur) wired to its own
  // renamingId/renameVal state for the existing pencil-button rename — this just captures the
  // new folder's real id (previously discarded) and hands it down so that same UI opens itself.
  const [autoRenameFolderId, setAutoRenameFolderId] = useState<string | null>(null)
  const handleCreateFolder = useCallback(async (parentId: string | null) => {
    const result = await window.notes.createFolder('New Folder', parentId)
    // Awaited (not fire-and-forget) — `folders` must already include the new row before
    // autoRenameFolderId is set below, or NotesFolderView's rename input would try to open on
    // a folder that isn't in the tree yet (the auto-focus effect only fires once per id change,
    // so a row that appears a render later would never get focused).
    await loadFolders()
    if (result?.id) setAutoRenameFolderId(result.id)
  }, [loadFolders])
  const handleRenameFolder = useCallback(async (id: string, name: string) => {
    await window.notes.renameFolder(id, name); loadFolders()
  }, [loadFolders])
  const handleDeleteFolder = useCallback(async (id: string) => {
    await window.notes.deleteFolder(id); loadFolders(); reloadNotes()
  }, [loadFolders, reloadNotes])
  const handleDeleteFolderDeep = useCallback(async (id: string) => {
    await window.notes.deleteFolderDeep(id); loadFolders(); reloadNotes(); bumpNoteToken()
  }, [loadFolders, reloadNotes, bumpNoteToken])
  const handleSetFolderParent = useCallback(async (id: string, parentId: string | null) => {
    await window.notes.setFolderParent(id, parentId); loadFolders()
  }, [loadFolders])
  const handleSetNoteFolder = useCallback(async (noteId: string, folderId: string | null) => {
    await window.notes.setNoteFolder(noteId, folderId)
    setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, folderId } : n))
  }, [])

  function toggleSelectNote(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleSelectFolder(id: string) {
    setSelectedFolderIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function exitSelectMode() {
    setSelectMode(false); setSelectedIds([]); setSelectedFolderIds([]); setMoveMenu(null)
  }

  async function deleteSelected() {
    for (const id of selectedIds) await window.notes.deleteNote(id)
    for (const fid of selectedFolderIds) await window.notes.deleteFolderDeep(fid)
    loadFolders()
    reloadNotes()
    bumpNoteToken()
    exitSelectMode()
  }

  async function moveSelectedToFolder(folderId: string | null) {
    for (const id of selectedIds) {
      const note = notes.find(n => n.id === id)
      if (note && noteIsMovable(note)) await window.notes.setNoteFolder(id, folderId)
    }
    for (const fid of selectedFolderIds) {
      if (fid !== folderId) await window.notes.setFolderParent(fid, folderId)
    }
    loadFolders()
    reloadNotes()
    exitSelectMode()
  }

  // Keep the ref pointing at the latest version so the event listener always uses current notes
  useEffect(() => { openDailyNoteRef.current = openDailyNote }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Optional detail.date (ISO "YYYY-MM-DD") lets callers other than "jump
    // to today" — e.g. the sidebar's own calendar picker — reuse this same
    // create-if-missing flow for an arbitrary date, instead of duplicating it.
    function onOpen(e: Event) {
      const iso = (e as CustomEvent<{ date?: string }>).detail?.date
      openDailyNoteRef.current(iso ? new Date(`${iso}T00:00:00`) : dailyNoteToday())
    }
    window.addEventListener('berean:openDailyNote', onOpen)
    return () => window.removeEventListener('berean:openDailyNote', onOpen)
  }, [])

  async function openDailyNote(date: Date) {
    const title = dailyNoteTitle(date)
    // 1. Check in-memory list first (fast path)
    const inMemory = notes.find(n => n.title === title && n.type === 'daily')
    if (inMemory) {
      setActiveNote(inMemory)
      return
    }
    // 2. Always query the DB before creating — guards against race conditions
    //    or notes loaded in another session not yet reflected in local state.
    try {
      const candidates = await window.notes.searchNotes(title, 5)
      const dbExisting = candidates.find(n => n.title === title && n.type === 'daily')
      if (dbExisting) {
        // Merge into local list so subsequent opens are fast
        setNotes(prev => prev.some(n => n.id === dbExisting.id) ? prev : [dbExisting, ...prev])
        setActiveNote(dbExisting)
        return
      }
    } catch { /* ignore search errors, fall through to create */ }
    // 3. Truly doesn't exist — create it
    const result = await window.notes.createNote({ title, content: '', type: 'daily' })
    if (result.success && result.note) {
      setNotes(prev => [result.note!, ...prev])
      setActiveNote(result.note!)
      bumpNoteToken()
    }
  }

  // Allow sidebar's daily-note button (berean:openDailyNote) to work when notes panel is mounted
  const openDailyNoteRef = useRef<(d: Date) => void>(() => {})

  // ProseMirror migration dropped the 3-mode Raw/Edit/Preview picker for a
  // 2-mode Edit/View one — ProseMirror has no way to show literal markdown
  // syntax as editable text (it's a structured-document model, not a text
  // editor), so "Raw" mode no longer has an equivalent.
  type EditorMode = 'edit' | 'view'
  const NEXT_MODE: Record<EditorMode, EditorMode> = { edit: 'view', view: 'edit' }
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')

  // Cmd+Shift+M → toggle Edit/View
  useEffect(() => {
    function onToggle() { setEditorMode((prev) => NEXT_MODE[prev]) }
    window.addEventListener('berean:toggleMarkdown', onToggle)
    return () => window.removeEventListener('berean:toggleMarkdown', onToggle)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteScrollRAF = useRef<number | null>(null)
  const editorFocusRef = useRef<(() => void) | null>(null)
  const editorCommandsRef = useRef<{ undo: () => void; redo: () => void } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  // The title sits in the shared drag-region header bar. While it's a plain <input>, a
  // mousedown-drag on it can't also move the window (Electron/Chromium can't treat the
  // same element as both an app-drag-region and a text field taking its own mousedown for
  // cursor placement). Default to a static span showing the title; clicking it swaps in
  // the actual (`no-drag`) input for editing. The static span itself is ALSO `no-drag` —
  // an earlier version made it a drag region on the assumption that Chromium reliably
  // tells a real click apart from a drag-start on such elements, but in practice any
  // perceptible mouse movement mid-click got swallowed as a window-drag attempt instead of
  // firing onClick, making rename unreliable (reported: "it thinks I'm trying to drag the
  // topbar"). Losing this one small strip of drag surface is the trade for renaming
  // actually working — the rest of the header bar stays draggable.
  const [titleFocused, setTitleFocused] = useState(false)
  useEffect(() => { setTitleFocused(false) }, [activeNote?.id])
  // Close note-scoped modals/local UI on a tab switch (ActivePanel no longer remounts
  // NotesPanel for same-type tab switches, so these no longer close "for free" via unmount) —
  // without this, a modal left open for the previous tab's note (print preview, version
  // history, the idiom-conversion prompt, local find-in-note) would stay open floating over
  // whatever note you just switched to, showing/acting on the WRONG note.
  useEffect(() => {
    setPrintPreviewOpen(false)
    setVersionHistoryOpen(false)
    setPrintNote(null)
    setConvertIdiomModal(null)
    setLocalFindOpen(false)
    setLocalFindQuery('')
    setEditorMode('edit')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesTabId])
  // Track latest scroll position via scroll events (more reliable than reading DOM on unmount)
  const lastScrollTopRef = useRef(0)
  // Track latest cursor position so it can be persisted on tab switch
  const lastCursorPosRef = useRef(0)
  // Track latest notes-list/browsing view scroll position (distinct from the open-note editor's
  // own scroll above) so it can be persisted on tab switch and restored on remount.
  const lastListScrollTopRef = useRef(0)

  // Keep tab title in sync with the open note — re-runs whenever the note id
  // OR title changes so that renaming a note immediately updates the tab label.
  useEffect(() => {
    if (!notesTabId) return
    if (noteRestorePending) return // avoid a flash of "Notes" while the saved note is still loading
    if (tabSwitchInFlightRef.current) return // same-tick race guard — see its comment above
    const title = activeNote ? (activeNote.title?.trim() || 'Untitled') : 'Notes'
    renameTab('notes', notesTabId, title)
    // Record note view in history (only on note change, not on every title keystroke)
    if (activeNote) {
      useAppStore.getState().addHistoryEntry({
        type: 'note',
        title,
        noteId: activeNote.id,
        verseRef: activeNote.verseRef ?? undefined,
      })
    }
  }, [activeNote?.id, activeNote?.title, notesTabId, noteRestorePending, renameTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Shared cache (notesCache.ts) — Sidebar/ShellHeader/HistoryModal all fetch "all notes" on
    // the same noteChangeToken bump; without sharing the fetch, a single note autosave fanned
    // out into 5+ independent IPC round-trips each holding their own copy of the full table.
    getAllNotes(noteChangeToken).then(setNotes).catch(() => {})
  }, [noteChangeToken])

  // If the currently-open note was changed externally (vault watcher wrote a
  // new version into the DB and bumped noteChangeToken), refetch it so the
  // editor doesn't keep showing stale content until the user reopens it.
  //
  // noteChangeToken also gets bumped by THIS panel's own debounced save
  // (handleContentChange/handleTitleChange call bumpNoteToken() after
  // window.notes.updateNote() so the presenter window refetches). An earlier
  // version of this effect compared the fetch against `cur.updatedAt` alone,
  // which practically never matched (the main process stamps its own
  // updatedAt at write time, different from the client's optimistic
  // Date.now()) — treating literally every autosave as "external" and
  // forcing NoteEditorPM's full EditorState-replace-and-reposition-cursor
  // path (see its note-switch effect) after every single save, which read to
  // the user as the cursor jumping/entering a new line right after saving.
  //
  // Comparing content/title too (not just updatedAt) mostly fixed that, but
  // left a real race: this fetch is an async IPC round-trip against
  // `current.id` — if the user RESUMES typing while it's in flight (a common
  // "brief pause then keep typing" pattern), `activeNoteRef.current` (`cur`)
  // has advanced past the DB snapshot the fetch returns by the time it
  // resolves. The comparison then sees a real difference and wrongly
  // concludes "changed externally," overwriting activeNote with the STALE,
  // pre-resume content — dropping whatever was typed during the race window
  // (confirmed root cause of frequent dropped letters / undone Enter presses
  // / cursor jumps while typing).
  //
  // Fix: compare the fetch against a stable snapshot of what THIS panel
  // itself last told the DB to persist (`lastSelfSaveRef`, set at save time
  // in handleContentChange/handleTitleChange) instead of the live, still-
  // advancing `activeNoteRef`. If the fetched note matches our own last
  // save, this bump is that save echoing back — a no-op — regardless of how
  // far the user has typed since. Only a fetch that differs from BOTH our
  // last save AND the live ref is a genuine external edit.
  useEffect(() => {
    const current = activeNoteRef.current
    if (!current) return
    window.notes.getNote(current.id).then((note) => {
      const cur = activeNoteRef.current
      if (!note || !cur) return
      // Identity guard — this fetch was kicked off for whatever note was active WHEN THE EFFECT
      // FIRED, but noteChangeToken bumps for ANY note anywhere in the app (saves, creates,
      // deletes, status changes elsewhere), and NotesPanel is a single shared instance reused
      // across every open Notes tab. If the user switches tabs before this IPC round-trip
      // resolves, `cur` (re-read live above) is now a DIFFERENT note than the one we fetched.
      // Content/updatedAt will almost always differ between two unrelated notes, so without this
      // check the comparison below would look like a legitimate "changed externally" edit and
      // clobber the newly-active, correct note with stale data from whatever was open earlier —
      // the root cause of Notes tabs intermittently showing another note's content.
      if (note.id !== cur.id) return
      const lastSave = lastSelfSaveRef.current
      const isOwnSaveEcho = lastSave !== null && note.content === lastSave.content && note.title === lastSave.title
      if (isOwnSaveEcho) return
      const changedExternally = note.updatedAt !== cur.updatedAt && (note.content !== cur.content || note.title !== cur.title)
      if (changedExternally) setActiveNote(note)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteChangeToken])

  // Restore the note that was open when this tab was last active. Re-runs on every
  // notesTabId change (not just mount) — NotesPanel is a single shared instance across all
  // Notes tabs, so switching tabs needs this to re-sync activeNote to the NEW tab's own saved
  // noteId; an earlier version ran this once on mount only, so activeNote just kept whatever
  // note the last-focused tab had open, and the persist effect below then wrote that stale
  // note id into whichever tab you switched to — corrupting its stored state, not just the
  // visible UI, so simply switching away and back didn't self-heal it.
  useEffect(() => {
    if (!notesTabId) return
    const seq = ++openSeqRef.current
    skipNextPersistRef.current = true
    tabSwitchInFlightRef.current = true
    setNoteRestorePending(true)
    // Deferred (not synchronous) clear of tabSwitchInFlightRef. The synchronous branches below
    // call setNoteRestorePending(true) then immediately setNoteRestorePending(false) in the same
    // effect pass — React batches same-tick state updates, so if the state was already false
    // beforehand this nets to NO change at all, meaning an effect keyed on noteRestorePending
    // transitioning to false would never re-fire and the ref would stay stuck true forever after
    // the first switch to a new/empty-note tab, permanently blocking the title-sync effect below
    // (this was the actual cause of tab titles "not saving"/never updating again). setTimeout(0)
    // runs unconditionally after this render's effects have flushed, regardless of whether state
    // actually changed, so the ref reliably clears exactly one pass later either way.
    function deferClear() { setTimeout(() => { tabSwitchInFlightRef.current = false }, 0) }
    const tab = tabs.find((t) => t.id === notesTabId)
    const tabState = tab?.state as NoteTabState | undefined
    if (tabState?.isNew) { setActiveNote(null); setNoteRestorePending(false); deferClear(); return } // fresh tab → show list
    const savedNoteId = tabState?.noteId ?? null
    const savedScrollTop = tabState?.scrollTop ?? 0
    const savedCursorPos = tabState?.cursorPos ?? 0
    if (!savedNoteId) { setActiveNote(null); setNoteRestorePending(false); deferClear(); return }
    // Synchronous fast path: if this note is already warm (noteCache, or notesCache's
    // token-independent warm start), apply everything in THIS render pass — no IPC round trip,
    // no intermediate "restoringSpecificNote" blank frame. The separate noteChangeToken effect
    // above already reconciles external edits in the background, so skipping a redundant
    // re-fetch here doesn't risk staleness. Falls through to the real async fetch only on a
    // genuine cache miss (a note never seen this session, and not in the last session's warm
    // start either).
    const cached = getCachedNote(savedNoteId)
    if (cached) {
      setActiveNote(cached)
      setRestoredScrollTop(savedScrollTop)
      setRestoredCursorPos(savedCursorPos)
      setAutoFocusEditor(true)
      setNoteRestorePending(false)
      deferClear()
      return
    }
    window.notes.getNote(savedNoteId)
      .then((note) => {
        // A newer open request (another tab switch, or an explicit pendingNoteId open from
        // e.g. a Cmd+K search jump) has started since — don't clobber it with this stale one.
        if (note && openSeqRef.current === seq) {
          setActiveNote(note)
          setRestoredScrollTop(savedScrollTop)
          setRestoredCursorPos(savedCursorPos)
          setAutoFocusEditor(true)
        }
      })
      .catch(() => {})
      .finally(() => {
        // Same "latest request wins" guard as the .then() above. Without it, rapid A→B→A tab
        // switching lets a stale request's .finally() clear these guards out from under a newer,
        // still-in-flight request for the same effect — e.g. seq 1 (tab A) resolves after seq 2
        // (tab B) has already started, clearing tabSwitchInFlightRef/noteRestorePending that seq
        // 2 is still relying on. Self-resolving: every branch of this effect (isNew, no
        // savedNoteId, cache hit, or this async fetch) either clears these flags synchronously
        // for its own seq, or clears them here guarded by its own seq — so whichever run is
        // actually current always ends up clearing them itself; a suppressed stale .finally()
        // never leaves them stuck true.
        if (openSeqRef.current !== seq) return
        setNoteRestorePending(false)
        tabSwitchInFlightRef.current = false
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesTabId])

  // Seeded synchronously from the tab's own persisted state (not from the async
  // window.notes.getNote() restore below) — that data is already available locally at mount
  // time, no fetch needed. Without this, NoteEditorPM's `initialScrollTop`/`initialCursorPos`
  // props were always 0 at the moment it actually mounts (its mount effect only reads them
  // once, deps []), so every reopened note tab silently reset to the top and lost the cursor
  // position, reading as a visible jump/flash on every tab switch even for a note whose
  // content was already warm from noteCache.
  const [restoredScrollTop, setRestoredScrollTop] = useState(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    return (tab?.state as NoteTabState | undefined)?.scrollTop ?? 0
  })
  const [restoredCursorPos, setRestoredCursorPos] = useState(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    return (tab?.state as NoteTabState | undefined)?.cursorPos ?? 0
  })
  const [autoFocusEditor, setAutoFocusEditor] = useState(false)

  // Restore the notes-list/browsing view's own scroll position whenever it (re)mounts — it's
  // conditionally unmounted while a note is open (`editing` true), so a plain DOM ref alone
  // doesn't survive the round trip; re-apply from tab state once the list is back on screen.
  useEffect(() => {
    if (activeNote !== null || !notesTabId) return
    const tab = tabs.find((t) => t.id === notesTabId)
    const saved = (tab?.state as NoteTabState | undefined)?.listScrollTop ?? 0
    const raf = requestAnimationFrame(() => {
      if (notesListScrollRef.current) notesListScrollRef.current.scrollTop = saved
    })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote, notesTabId])

  // Save scroll + cursor when notesTabId changes (switching between notes tabs within the space).
  useEffect(() => {
    const id = notesTabId
    return () => {
      if (!id) return
      useAppStore.getState().updateTabState('notes', id, {
        scrollTop: lastScrollTopRef.current,
        cursorPos: lastCursorPosRef.current,
        listScrollTop: lastListScrollTopRef.current,
      })
    }
  }, [notesTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save scroll + cursor position when this panel unmounts (space switch).
  // Empty notes are NOT deleted here — only goBack() deletes them so that switching
  // tabs or spaces preserves the note for the user to return to.
  useEffect(() => {
    return () => {
      // Consolidate a final version of whatever note is open when the panel unmounts.
      if (snapshotIdleTimer.current) clearTimeout(snapshotIdleTimer.current)
      const note = activeNoteRef.current
      if (note && note.content.trim() && lastSnapshotContentRef.current !== note.content) {
        window.notes.createNoteVersion(note.id, note.title || '', note.content, 'auto').catch(() => {})
      }
      const id = notesTabId
      if (!id) return
      useAppStore.getState().updateTabState('notes', id, {
        scrollTop: lastScrollTopRef.current,
        cursorPos: lastCursorPosRef.current,
        listScrollTop: lastListScrollTopRef.current,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Synchronously save scroll + cursor when Sidebar fires berean:saveScrollBeforeTabChange.
  useEffect(() => {
    function onSave() {
      const id = notesTabId
      if (!id) return
      useAppStore.getState().updateTabState('notes', id, {
        scrollTop: lastScrollTopRef.current,
        cursorPos: lastCursorPosRef.current,
        listScrollTop: lastListScrollTopRef.current,
      })
    }
    window.addEventListener('berean:saveScrollBeforeTabChange', onSave)
    return () => window.removeEventListener('berean:saveScrollBeforeTabChange', onSave)
  }, [notesTabId])

  // Persist open note id to tab state. Skips exactly one run right after a tab switch — see
  // skipNextPersistRef's comment — since this effect also depends on notesTabId and would
  // otherwise fire immediately with the previous tab's still-stale activeNote before the
  // restore effect above has replaced it.
  useEffect(() => {
    if (!notesTabId) return
    if (skipNextPersistRef.current) { skipNextPersistRef.current = false; return }
    updateTabState('notes', notesTabId, { noteId: activeNote?.id ?? null, isNew: false })
  }, [activeNote?.id, notesTabId, updateTabState])

  // Open a specific note (only from explicit requests like full tab opens)
  useEffect(() => {
    if (!pendingNoteId) return
    const seq = ++openSeqRef.current
    clearPendingNote()
    window.notes.getNote(pendingNoteId)
      .then((note) => {
        if (!note || openSeqRef.current !== seq) return
        setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)])
        setActiveNote(note)
        lastScrollTopRef.current = 0
        setRestoredScrollTop(0)
      })
      .catch(() => {})
  }, [pendingNoteId, clearPendingNote])

  async function createNote() {
    const result = await window.notes.createNote({ content: '' })
    if (result.success && result.note) {
      setNotes((prev) => [result.note!, ...prev])
      setActiveNote(result.note!)
      bumpNoteToken()
    }
  }

  async function submitIdiomModal() {
    if (!idiomModal) return
    const term = idiomModal.term.trim()
    const meaning = idiomModal.meaning.trim()
    if (!term) return
    setIdiomModal(null)
    const res = await window.notes.createNote({
      type: 'idiom',
      title: term,
      idiomTerm: term.toLowerCase(),
      idiomMeaning: meaning,
      content: '',
      folderId: idiomModal.folderId ?? null,
    })
    if (res.success && res.note) {
      setNotes(prev => [res.note!, ...prev])
      setIdiomCache(await window.notes.listIdioms?.() ?? [])
      setActiveNote(res.note)
    }
  }

  async function deleteNote(note?: Note) {
    const target = note ?? activeNote
    if (!target) return
    await window.notes.deleteNote(target.id)
    setNotes((prev) => prev.filter((n) => n.id !== target.id))
    bumpNoteToken()
    if (target.type === 'idiom') window.notes.listIdioms?.().then(setIdiomCache).catch(() => {})
    if (target.id === activeNote?.id) {
      setActiveNote(null)
      setEditorMode('edit')
      // Deleting the active note leaves the tab's global nav-stack idx
      // stale (still pointing at the now-deleted note) unless re-synced —
      // see resetTabNavHome's comment for the bug this causes (home icon
      // stays visible and does nothing when clicked).
      if (notesTabId) resetTabNavHome(notesTabId)
    }
  }

  // Leaving a note back to the list — called by the global top-bar back button
  // reaching the list/home position (notesHomeToken), not a local button anymore.
  async function goBack() {
    if (!activeNote) return
    // Keep notes with a title even if the body is empty, and keep idiom notes
    // that have term/meaning data — only truly blank notes get pruned on leave.
    const hasTitle = activeNote.title?.trim()
    const hasIdiomData = activeNote.type === 'idiom' && (activeNote.idiomTerm || activeNote.idiomMeaning)
    if (activeNote.content.trim() === '' && !hasTitle && !hasIdiomData) {
      await deleteNote(activeNote)
    } else {
      snapshotVersion(activeNote, 'auto')   // consolidate a version on leaving the note
    }
    setActiveNote(null)
    setEditorMode('edit')
  }

  function navigateToNote(note: Note) {
    dismissOpenNoteHint()
    if (activeNote && activeNote.id !== note.id) {
      snapshotVersion(activeNote, 'auto')   // snapshot the outgoing note
      // Reset scroll for the new note
      lastScrollTopRef.current = 0
      setRestoredScrollTop(0)
    }
    // Baseline the snapshot tracker to the newly-opened content (don't snapshot on open).
    lastSnapshotContentRef.current = note.content
    setActiveNote(note)
    // Track in the global back/forward stack — this is what lets the top bar's
    // nav pill retrace note-to-note navigation (and back to the list) instead of
    // each panel keeping its own separate, redundant history.
    if (notesTabId) pushTabNav(notesTabId, { type: 'note', noteId: note.id, title: note.title || 'Untitled' })
  }

  // Global top bar's back button reached the list/home position for this tab.
  //
  // Tracks the last SEEN token value, not a "have I run before" boolean — React 18
  // StrictMode (dev only) double-invokes every effect on a genuine mount: run the effect,
  // simulate a cleanup (none here), run it again. A boolean ref survives that unchanged
  // (refs aren't reset between the two invocations, since it's the same fiber), so the OLD
  // "if (!mountedRef.current) { mountedRef.current = true; return }" guard only protected the
  // FIRST of the two StrictMode passes — the second pass saw the guard already consumed and
  // called goBack() regardless, wiping activeNote back to the list on every genuine remount
  // of NotesPanel even though notesHomeToken never actually changed. Since ActivePanel.tsx
  // remounts NotesPanel fresh every time you switch into the Notes space from a different
  // tab (its key swaps 'panel:note' in), this fired on essentially every such switch in dev,
  // reading as "switching to a tab with a note open goes to the home page instead." Comparing
  // against the last-seen VALUE instead is idempotent across StrictMode's replay: the second
  // pass sees the same token it just recorded and is correctly a no-op.
  const lastSeenNotesHomeTokenRef = useRef(notesHomeToken)
  useEffect(() => {
    if (notesHomeToken === lastSeenNotesHomeTokenRef.current) return
    lastSeenNotesHomeTokenRef.current = notesHomeToken
    goBack()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesHomeToken])

  function openNoteInNewTab(note: Note) {
    const tab: Tab = {
      id: `note-${note.id}-${Date.now()}`,
      spaceId: 'notes',
      type: 'note',
      title: note.title || 'Untitled',
      state: { noteId: note.id, isNew: false },
      ...(notesTabId ? { originTabId: notesTabId, originSpaceId: 'notes' as const } : {}),
    }
    addTab(tab)
  }

  async function renameNoteCommit(noteId: string, newTitle: string) {
    await window.notes.updateNote(noteId, { title: newTitle }).catch(() => {})
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, title: newTitle, updatedAt: Date.now() } : n))
    if (activeNote?.id === noteId) setActiveNote(prev => prev ? { ...prev, title: newTitle } : prev)
    bumpNoteToken()
  }

  function openNoteInFloatingTab(note: Note) {
    window.app.openFloatingTab('notes', { noteId: note.id })
  }

  function openNoteInSession(note: Note, sessionId: string) {
    // Set pending note BEFORE switching so the panel picks it up after remount
    requestOpenNote(note.id)
    switchSession(sessionId)
    setActiveSpace('notes')
  }

  function openNoteAsScripture(note?: Note) {
    const target = note ?? activeNote
    if (!target) return

    // Ensure a scripture tab exists, then thread the note into its side panel
    const store = useAppStore.getState()
    store.ensureTab('bible')
    const fresh = useAppStore.getState()
    const scriptureTabId = fresh.activeTabId['scripture']
    if (!scriptureTabId) return

    // If the note is anchored to a verse, navigate there
    const parts = (target.verseRef ?? '').split('.')
    const hasRef = parts.length >= 2 && parts[0] && parts[1]

    const stateUpdate: Record<string, unknown> = {
      rightPanelOpen: true,
      rightPanelTab: 'notes',
      rightPanelNoteId: target.id,
      scrollPosition: 0,
      // Back button in scripture toolbar → returns to this note as a note tab
      noteBack: { noteId: target.id, title: target.title || 'Untitled' },
    }

    if (hasRef) {
      stateUpdate.bookId = parts[0]
      stateUpdate.chapter = parseInt(parts[1])
      if (parts[2]) stateUpdate.targetVerse = parseInt(parts[2])
      const translation = getTranslationForBook(parts[0]) ?? fresh.defaultBibleTranslation
      stateUpdate.translation = translation.toUpperCase()
    }

    if (noteTransformLayout === 'bottom') {
      stateUpdate.scriptureLayout = 'notes-bottom'
    } else if (noteTransformLayout === 'left') {
      stateUpdate.scriptureLayout = 'panel-left'
    } else {
      stateUpdate.scriptureLayout = 'standard'
    }

    fresh.updateTabState('scripture', scriptureTabId, stateUpdate)
    fresh.setActiveSpace('scripture')
  }

  function openVerseFromNote(verseRef: string) {
    const parsed = parseVerseRef(verseRef)
    if (!parsed) return
    const store = useAppStore.getState()
    store.createTab('bible')
    const fresh = useAppStore.getState()
    const scriptureTabId = fresh.activeTabId['scripture']
    if (!scriptureTabId) return
    const translation = (getTranslationForBook(parsed.bookId) ?? fresh.defaultBibleTranslation).toUpperCase()
    fresh.updateTabState('scripture', scriptureTabId, {
      bookId: parsed.bookId, chapter: parsed.chapter,
      targetVerse: parsed.verse, scrollPosition: 0, translation,
      noteBack: activeNote ? { noteId: activeNote.id, title: activeNote.title || 'Untitled' } : null,
    })
    fresh.setActiveSpace('scripture')
  }

  async function maybeSyncNote(noteId: string) {
    try {
      const vaultSyncEnabled = await window.settings.get('vaultSync')
      if (vaultSyncEnabled) window.vault.syncNote(noteId).catch(() => {})
    } catch { /* ignore */ }
  }

  // Snapshot the given note's content as a version if it changed since the last snapshot.
  // Consolidates rapid edits — called on editing idle, note switch, and unmount.
  function snapshotVersion(note: { id: string; title: string; content: string } | null, kind = 'auto') {
    if (!note) return
    if (lastSnapshotContentRef.current === note.content) return
    lastSnapshotContentRef.current = note.content
    window.notes.createNoteVersion(note.id, note.title || '', note.content, kind).catch(() => {})
  }

  function handleContentChange(content: string) {
    if (!activeNote) return
    const updated = { ...activeNote, content, updatedAt: Date.now() }
    setActiveNote(updated)
    // Signal meaningful edit (more than 20 chars means the user is actually writing)
    if (content.trim().length > 20) bumpNoteEditToken()
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const id = activeNote.id
      lastSelfSaveRef.current = { content: updated.content, title: updated.title }
      window.notes.updateNote(id, { content })
        .then(() => setLastAutosaveAt(Date.now())) // fires the "Saved" flash only on an actual completed save
        .catch(() => {})
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)))
      maybeSyncNote(id)
      bumpNoteToken() // so the presenter window (if open) refetches the updated note
    }, 500)
    // Restart the idle timer; when editing pauses for SNAPSHOT_IDLE_MS, consolidate a version.
    if (snapshotIdleTimer.current) clearTimeout(snapshotIdleTimer.current)
    snapshotIdleTimer.current = setTimeout(() => snapshotVersion({ ...updated }, 'auto'), SNAPSHOT_IDLE_MS)
  }

  function handleTitleChange(title: string) {
    if (!activeNote) return
    const updated = { ...activeNote, title, updatedAt: Date.now() }
    setActiveNote(updated)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      lastSelfSaveRef.current = { content: updated.content, title: updated.title }
      window.notes.updateNote(activeNote.id, { title })
        .then(() => setLastAutosaveAt(Date.now()))
        .catch(() => {})
      setNotes((prev) => prev.map((n) => (n.id === activeNote.id ? updated : n)))
      bumpNoteToken()
    }, 500)
  }

  // Set/clear a note's status from the list/folder-view context menu (parity with the
  // NoteStatusDropdown in the editor header, reachable without opening the note first).
  async function handleSetStatus(note: Note, status: import('@/types').NoteStatus | null) {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, status: status ?? undefined } : n)))
    if (activeNote?.id === note.id) setActiveNote({ ...activeNote, status: status ?? undefined })
    await window.notes.updateNote(note.id, { status }).catch(() => {})
    bumpNoteToken() // so the sidebar/board/other windows pick up the new status
  }

  // Pin/unpin — same optimistic-update-then-persist shape as handleSetStatus above.
  async function handleTogglePinned(note: Note) {
    const pinned = !note.pinned
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, pinned } : n)))
    if (activeNote?.id === note.id) setActiveNote({ ...activeNote, pinned })
    await window.notes.setNotePinned(note.id, pinned).catch(() => {})
    bumpNoteToken()
  }

  // Set/clear the active note's page icon (editor header — see the input rendered next to the
  // title below). Saved immediately (not debounced) — icon changes are infrequent, discrete
  // "pick one emoji" actions, not continuous typing, so there's no autosave-style burst to
  // coalesce, matching NoteStatusDropdown's onChange right above in the header. `raw` is
  // capped at a small length rather than fully grapheme-cluster-segmented — good enough for
  // "one emoji, possibly a multi-codepoint ZWJ sequence" without building real Unicode
  // segmentation for a decorative field (see NoteIcon.tsx).
  async function handleIconChange(raw: string) {
    if (!activeNote) return
    const icon = raw.slice(0, 8).trim()
    const patched = { ...activeNote, icon: icon || undefined }
    setNotes((prev) => prev.map((n) => (n.id === activeNote.id ? patched : n)))
    setActiveNote(patched)
    await window.notes.updateNote(activeNote.id, { icon: icon || null }).catch(() => {})
    bumpNoteToken() // so the sidebar/board/other windows pick up the new icon
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      editorFocusRef.current?.()
    }
  }

  function handleWikilinkClick(title: string) {
    const target = normalizeWikiTarget(title)

    // Try verse reference first (e.g., "Genesis 1:1", "GEN.1.1", "Verse Notes/Genesis 1:1")
    // Support formats: "Genesis 1:1" (colon), "GEN.1.1" (canonical), or full path "Verse Notes/Genesis 1:1"
    const verseMatch = target.match(/^(?:verse\s+notes[\/\s]+)?([A-Za-z0-9\s]+)\s*[:.](\d+)(?:[:.](\d+))?/i)
    if (verseMatch) {
      const [, bookStr, chapterStr, verseStr] = verseMatch
      const bookId = resolveBookToken(bookStr.trim())
      if (bookId) {
        const verse = verseStr ? parseInt(verseStr) : undefined
        return handleVerseRefClick({ bookId, chapter: parseInt(chapterStr), verse })
      }
    }

    // Fall back to note title matching
    const note = notes.find(n => normalizeWikiTarget(n.title || 'Untitled') === target)
    if (note) navigateToNote(note)
  }

  function handleVerseRefClick(ref: ParsedRef) {
    // Always open in a brand-new scripture tab so the existing reading position is never clobbered.
    const store = useAppStore.getState()
    store.createTab('bible')
    const fresh = useAppStore.getState()
    const scriptureTabId = fresh.activeTabId['scripture']
    if (!scriptureTabId) return
    // Determine which translation to use:
    //   forcedTranslation (e.g. LXX suffix)  > book-required translation (e.g. hermas)
    //   > defaultBibleTranslation (kjva) for canonical books.
    // Always setting translation ensures clicking a plain "Gen 1:1" ref switches
    // away from LXX back to the default bible translation.
    const translationOverride =
      ref.forcedTranslation ??
      getTranslationForBook(ref.bookId) ??
      fresh.defaultBibleTranslation
    const noteBack = activeNote ? { noteId: activeNote.id, title: activeNote.title || 'Untitled' } : null
    fresh.updateTabState('scripture', scriptureTabId, {
      bookId: ref.bookId,
      chapter: ref.chapter,
      endChapter: ref.endChapter,
      targetVerse: ref.verse,
      endVerse: ref.endVerse,
      scrollPosition: 0,
      noteBack,
      translation: translationOverride.toUpperCase(),
    })
    // Tier 2 — a wikilink/verse-ref inside a note is soft-inferred (the reason is the note's
    // own text/title, not a certainty like a cross-ref table row).
    recordNavigation(
      {},
      { bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse },
      { kind: 'note-wikilink', noteId: activeNote?.id ?? '', noteTitle: activeNote?.title || 'Untitled' },
    )
  }

  // Port of the CM6 editor's lexicon-ref click handling, which used to
  // bypass the prop-callback pattern and call the store directly
  // (NoteEditor.tsx:4545-4557). Now a normal callback like the other ref
  // types, wired here where noteId/title for the breadcrumb are in scope.
  function handleLexiconRefClick(strongsId: string) {
    const store = useAppStore.getState()
    const fromNote = activeNote ? { noteId: activeNote.id, title: activeNote.title || 'Untitled' } : undefined
    // createTab first — openLexiconEntry's pending value is picked up by
    // whichever Lexicon tab is active at that moment.
    store.createTab('lexicon')
    store.openLexiconEntry(strongsId, fromNote)
  }

  const editing = activeNote !== null
  // True only when a specific note is expected to load (this tab has a saved noteId) but hasn't
  // resolved yet — i.e. a genuine cache-cold restore (see noteCache.ts: it's an in-memory Map,
  // empty on every app launch, so the very first time a given note tab is visited each session
  // there's no way around this async gap). Distinguishing it from "browsing, no note open" lets
  // the render below show a blank placeholder here instead of the full notes list — showing the
  // list was reading as "raw html flashing" (its search-result snippets embed literal
  // highlight/underline markup like `<mark class="hlcyan">`, unstripped) for a brief moment
  // before the real note took over.
  const restoringSpecificNote = !editing && noteRestorePending

  const visibleNotes = useMemo(() => {
    // Text search — real FTS5 (via noteSearchResults, see the debounced effect above)
    // instead of a plain substring filter, so word-mode (all/any/phrase) actually
    // changes matching behavior. Falls back to the full locally-loaded `notes` list
    // when no search is active, exactly as before.
    let filtered = noteSearch.trim() ? [...(noteSearchResults ?? [])] : [...notes]
    // Type filter
    const isDailyLike = (n: Note) =>
      n.type === 'daily' || n.type === 'journal' ||
      (n.type === 'general' && !!(n.title?.startsWith('Daily — ') || n.title?.startsWith('Journal — ')))
    if (noteFilter === 'scripture') filtered = filtered.filter(n => !!(n.verseRef || n.type === 'verse'))
    else if (noteFilter === 'topic') filtered = filtered.filter(n => !n.verseRef && !isDailyLike(n) && n.type !== 'youtube' && n.type !== 'verse')
    else if (noteFilter === 'daily') filtered = filtered.filter(n => isDailyLike(n))
    else if (noteFilter === 'youtube') filtered = filtered.filter(n => n.type === 'youtube')
    else if (noteFilter === 'biblegateway') filtered = filtered.filter(n => n.tags?.includes('biblegateway'))
    else if (noteFilter === 'esword') filtered = filtered.filter(n => n.tags?.includes('esword'))
    else if (noteFilter === 'idiom') filtered = filtered.filter(n => n.type === 'idiom')
    // Status filter — independent of/combinable with the type filter above.
    if (statusFilter === 'no-status') filtered = filtered.filter(n => !n.status)
    else if (statusFilter !== 'all') filtered = filtered.filter(n => n.status === statusFilter)
    // Sort
    if (noteSort === 'modified') filtered.sort((a, b) => b.updatedAt - a.updatedAt)
    else if (noteSort === 'created') filtered.sort((a, b) => b.createdAt - a.createdAt)
    else if (noteSort === 'name') filtered.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'))
    return filtered
  }, [notes, noteSearch, noteSearchResults, noteFilter, statusFilter, noteSort])

  return (
    <div
      ref={notesContentRef}
      className="native-buttons flex flex-col h-full bg-[rgb(var(--color-surface-3))] relative"
      onMouseDown={() => setActivePanelId('notes')}
    >
      <FindBar
        visible={findBarVisible}
        query={localFindQuery}
        onQueryChange={(q) => { setLocalFindQuery(q); setFindMatchIdx(0) }}
        onClose={closeFindBarLocal}
        matchCount={findMatchCount}
        currentMatch={findMatchIdx}
        onPrev={findPrev}
        onNext={findNext}
        placeholder="Find in note…"
      />
      {/* Header */}
      <TabHeaderPortal floating={floating}>
        {editing ? (
          <>
            {/* Page icon — a single emoji shown before the title. Click opens an in-app
                emoji picker (NoteIconPicker) rather than relying on the user knowing to
                paste one or invoke the OS-level picker — that was the previous approach
                and read as "there's no picker, it just lets me type". */}
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                iconPicker.openMenu({ x: r.left, y: r.bottom + 4 })
              }}
              title="Page icon — click to choose an emoji"
              className="no-drag flex-shrink-0 w-6 h-6 flex items-center justify-center text-center text-sm rounded-md bg-transparent hover:bg-[rgb(var(--color-surface-4))] outline-none text-[rgb(var(--color-text-primary))] transition-colors"
            >
              {activeNote.icon || <Plus size={14} className="text-[rgb(var(--color-text-muted))]/50" />}
            </button>
            {iconPicker.menu && (
              <NoteIconPicker
                x={iconPicker.menu.x}
                y={iconPicker.menu.y}
                currentIcon={activeNote.icon}
                onSelect={(emoji) => handleIconChange(emoji)}
                onRemove={() => handleIconChange('')}
                onClose={iconPicker.closeMenu}
                menuRef={iconPicker.menuRef}
              />
            )}
            {isSystemNote(activeNote) || activeNote.type === 'idiom' ? (
              /* System notes (daily, verse, esword, biblegateway) — title is read-only.
                 Idiom notes too: IdiomHeader below already owns an editable Term field
                 that writes straight to this same `title`, so having a SECOND live
                 title input right here (same value, different box) was confusing —
                 two places to rename the same thing, visible at once. */
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {activeNote.verseRef && parseVerseRef(activeNote.verseRef) ? (
                  <button
                    onClick={() => openVerseFromNote(activeNote.verseRef!)}
                    title="Open scripture reference"
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left group"
                  >
                    <span className="flex-1 text-sm font-medium truncate text-[rgb(var(--color-text-primary))] group-hover:text-[rgb(var(--color-accent))] transition-colors">
                      {headerDisplayTitle(activeNote)}
                    </span>
                    <ExternalLink size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))] group-hover:text-[rgb(var(--color-accent))] transition-colors" />
                  </button>
                ) : (
                  <span className="flex-1 text-sm font-medium truncate text-[rgb(var(--color-text-primary))] opacity-75 select-none">
                    {headerDisplayTitle(activeNote)}
                  </span>
                )}
              </div>
            ) : !titleFocused ? (
              // `no-drag`, not `app-drag-region` — this WAS marked as a drag region on the
              // theory that clicking it would still fire onClick and enter edit mode below.
              // In practice Electron's drag-region hit-testing treats any perceptible mouse
              // movement between mousedown and mouseup as the start of a window drag, not a
              // click — so a slightly-imprecise click here (extremely common on a small text
              // target) got silently swallowed as a drag attempt instead of renaming the note
              // (reported: "it thinks I'm trying to drag the topbar"). `no-drag` trades away
              // this one small strip of window-drag surface for reliable click-to-rename —
              // the rest of the header bar remains draggable.
              <span
                onClick={() => setTitleFocused(true)}
                className="no-drag flex-1 text-sm font-medium truncate cursor-text text-[rgb(var(--color-text-primary))]"
              >
                {activeNote.title || <span className="text-[rgb(var(--color-text-muted))]">Untitled</span>}
              </span>
            ) : (
              <input
                ref={titleInputRef}
                autoFocus
                value={activeNote.title ?? ''}
                onChange={(e) => handleTitleChange(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={() => setTitleFocused(false)}
                placeholder="Untitled"
                className="no-drag flex-1 text-sm font-medium bg-transparent outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
              />
            )}
            {/* Lifecycle status (Started/In Progress/Complete/Make Video/Archive) — most notes
                have none; also settable from the right-click context menu in the list. */}
            <NoteStatusDropdown
              value={activeNote.status ?? null}
              onChange={async (status) => {
                const updates = { status }
                const patched = { ...activeNote, status: status ?? undefined }
                setNotes((prev) => prev.map((n) => (n.id === activeNote.id ? patched : n)))
                setActiveNote(patched)
                await window.notes.updateNote(activeNote.id, updates).catch(() => {})
                bumpNoteToken() // so the sidebar/board/other windows pick up the new status
              }}
              compact
            />
            {/* Undo/redo — mirrors ⌘Z/⌘⇧Z (keymap.ts), exposed here too since a mouse-driven
                editing action (a toolbar formatting click, a drag-reorder, a paste) is just as
                likely to need undoing as a typed one. Only meaningful while actually editing —
                hidden in read-only 'view' mode. No disabled state: prosemirror-history's
                undo()/redo() are harmless no-ops with nothing to undo/redo, and tracking
                undoDepth()/redoDepth() reactively would mean re-rendering this header on every
                single transaction just to grey out two buttons. */}
            {editorMode === 'edit' && (
              <div className="flex items-center">
                <button
                  onClick={() => editorCommandsRef.current?.undo()}
                  title="Undo (⌘Z)"
                  className="no-drag flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-transparent hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors"
                >
                  <Undo2 size={13} />
                </button>
                <button
                  onClick={() => editorCommandsRef.current?.redo()}
                  title="Redo (⌘⇧Z)"
                  className="no-drag flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-transparent hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors"
                >
                  <Redo2 size={13} />
                </button>
              </div>
            )}
            {/* Quick "look" preset for the note editor while typing — separate,
                curated shortcut next to the mode toggle; the fuller font-family
                picker stays in Settings → Display. */}
            <NoteLookDropdown value={noteTypingLook} onChange={setNoteTypingLook} />
            {/* ── Editor mode segmented toggle ── */}
            <HeaderSegmentedToggle
              value={editorMode}
              onChange={setEditorMode}
              title="Editor mode (⌘⇧M to toggle)"
              options={[
                { value: 'edit', label: 'Edit', icon: PenLine, title: 'Edit — rich editing' },
                { value: 'view', label: 'View', icon: Eye,     title: 'View — rendered read-only output' },
              ]}
            />
            {/* Everything below is occasional, not per-edit frequency like
                the mode toggle or find-in-note — collected behind the More
                menu instead of growing the inline icon row further. Zoom
                moved here from its own always-visible hover icon — that
                popover's 350ms hover-close timing read as unreliable; this
                row is plain click + a real typeable percentage input. */}
            <HeaderOverflowMenu
              items={[
                {
                  key: 'history',
                  label: 'Version history',
                  icon: <History />,
                  onClick: () => { if (activeNote) setVersionHistoryOpen(true) },
                },
                {
                  key: 'markdown-help',
                  label: 'Markdown reference guide',
                  icon: <HelpCircle />,
                  onClick: openMarkdownReference,
                },
                {
                  key: 'print',
                  label: 'Print / export note',
                  icon: <Printer />,
                  onClick: () => { if (activeNote) setPrintPreviewOpen(true) },
                },
                ...(!floating ? [{
                  key: 'open-scripture',
                  label: 'Open alongside scripture',
                  icon: <BookOpen />,
                  onClick: () => openNoteAsScripture(),
                }] : []),
                {
                  key: 'delete',
                  label: 'Delete note',
                  icon: <Trash2 />,
                  onClick: () => deleteNote(),
                  danger: true,
                  divider: true,
                },
              ]}
            />
            {youtubeIsPlaying && (
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  window.dispatchEvent(new CustomEvent('berean:requestTimestamp'))
                }}
                title="Insert YouTube timestamp at cursor"
                className="p-1 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))] transition-colors"
              >
                <Paperclip size={14} />
              </button>
            )}
          </>
        ) : restoringSpecificNote ? (
          <span className="text-sm font-medium text-[rgb(var(--color-text-muted))] flex-1 opacity-60">Notes</span>
        ) : (
          <>
            <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] flex-1">Notes</span>
            {/* View mode: list / folder / board — exactly one active, switchable from any of
                the three at any time. */}
            <div className="flex items-center gap-0.5 bg-[rgb(var(--color-surface-4))] rounded-shell p-0.5">
              {([
                ['list',   List,       'List view',                'rounded-l-[11px] rounded-r-[6px]'],
                ['folder', FolderTree, 'Folder view',               'rounded-[6px]'],
                ['board',  Columns3,   'Board view (by status)',    'rounded-l-[6px] rounded-r-[11px]'],
              ] as const).map(([mode, Icon, label, edgeRounding]) => (
                <button
                  key={mode}
                  onClick={() => changeViewMode(mode)}
                  title={label}
                  className={`p-1 cursor-pointer transition-colors ${edgeRounding}
                    ${viewMode === mode
                      ? 'bg-[rgb(var(--color-surface-2))] text-[rgb(var(--color-accent))] shadow-sm'
                      : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
                    }`}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
            {/* Idioms → single PDF export (reachable from list and folder view) */}
            {renderIdiomsExport()}
            {/* Select mode toggle */}
            <button
              onClick={() => { if (selectMode) { exitSelectMode() } else { setSelectMode(true) } }}
              title="Select notes"
              className={`p-1 rounded-shell cursor-pointer transition-colors ${selectMode ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}
            >
              <CheckSquare size={15} />
            </button>
            <button
              onClick={createNote}
              onContextMenu={(e) => {
                e.preventDefault()
                setPlusMenu({ x: e.clientX, y: e.clientY })
              }}
              title="New note (⌘⇧N) · right-click for more"
              className="p-1 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <Plus size={16} />
            </button>
          </>
        )}
      </TabHeaderPortal>

      {/* Plus-button context menu: new note / new folder */}
      {plusMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setPlusMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPlusMenu(null) }} />
          <MenuPositioner x={plusMenu.x} y={plusMenu.y}
            className="min-w-[160px] bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1 overflow-hidden"
          >
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => { setPlusMenu(null); createNote() }}
            >
              <NotepadText size={13} className="flex-shrink-0" /> New note
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => {
                setPlusMenu(null)
                if (!folderView) changeViewMode('folder')
                handleCreateFolder(null)
              }}
            >
              <FolderPlus size={13} className="flex-shrink-0" /> New folder
            </button>
          </MenuPositioner>
        </>
      )}

      {/* Move-selected-to-folder menu (multi-select, folder view) */}
      {moveMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setMoveMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMoveMenu(null) }} />
          <div
            className="fixed z-[9999] min-w-[180px] max-h-72 overflow-y-auto bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1"
            style={{ left: Math.min(moveMenu.x, window.innerWidth - 200), top: Math.min(moveMenu.y, window.innerHeight - 320) }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => moveSelectedToFolder(null)}
            >
              <Home size={12} className="flex-shrink-0" /> No folder (root)
            </button>
            <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
            {orderedFolders(folders).map(({ folder, depth }) => (
              <button
                key={folder.id}
                className="w-full text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer py-1.5"
                style={{ paddingLeft: 12 + depth * 12, paddingRight: 12 }}
                onClick={() => moveSelectedToFolder(folder.id)}
              >
                {folder.name}
              </button>
            ))}
            {folders.length === 0 && (
              <div className="px-3 py-1.5 text-[11px] text-[rgb(var(--color-text-muted))] italic">No folders yet — create one first</div>
            )}
          </div>
        </>
      )}


      {/* Content */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        // Mirror note scroll to the presenter (scroll doesn't bubble → capture phase).
        onScrollCapture={(e) => {
          const st = useAppStore.getState()
          if (!st.viewerWindowOpen || st.viewerPaused || st.viewerBlank || st.activeSpace !== 'notes' || !activeNote) return
          const el = e.target as HTMLElement
          const max = el.scrollHeight - el.clientHeight
          if (max <= 0) return
          const pct = el.scrollTop / max
          if (noteScrollRAF.current) cancelAnimationFrame(noteScrollRAF.current)
          noteScrollRAF.current = requestAnimationFrame(() => {
            window.app.pushViewerContent?.({ kind: 'note', noteId: activeNote.id, scrollPercent: pct })
          })
        }}
      >
        {restoringSpecificNote ? (
          <div className="flex-1" />
        ) : editing ? (
          // `relative` here (not a flex-row split with NoteSidePanel as a sibling
          // taking its own docked width) — NoteSidePanel is now a floating
          // trigger pill + portaled card, positioned against THIS wrapper, same
          // treatment as ScriptureSearchView's "jump to book" rail. The editor
          // gets the full width always; the panel only ever overlays on top of
          // it, never resizes it.
          <div className="flex-1 overflow-hidden flex flex-col relative">
            {/* Idiom header strip — shown when editing an idiom note */}
            {activeNote.type === 'idiom' && (
              <IdiomHeader
                note={activeNote}
                onUpdate={async (updates) => {
                  await window.notes.updateNote(activeNote.id, updates)
                  const patched = { ...activeNote, ...updates, updatedAt: Date.now() } as Note
                  setNotes(prev => prev.map(n => n.id === activeNote.id ? patched : n))
                  setActiveNote(patched)
                  window.notes.listIdioms?.().then(setIdiomCache).catch(() => {})
                }}
              />
            )}
            <NoteEditor
              content={activeNote.content}
              noteId={activeNote.id}
              tabId={notesTabId ?? undefined}
              onChange={handleContentChange}
              lastSavedAt={lastAutosaveAt}
              onFocusRef={(fn) => { editorFocusRef.current = fn }}
              onCommandsRef={(cmds) => { editorCommandsRef.current = cmds }}
              onScrollPosition={(pos) => { lastScrollTopRef.current = pos }}
              onCursorPosition={(pos) => { lastCursorPosRef.current = pos }}
              initialScrollTop={restoredScrollTop}
              initialCursorPos={restoredCursorPos}
              autoFocus={autoFocusEditor}
              mode={editorMode}
              typingLook={noteTypingLook}
              notes={notes}
              onWikilinkClick={handleWikilinkClick}
              onVerseRefClick={handleVerseRefClick}
              onLexiconRefClick={handleLexiconRefClick}
              findQuery={findBarVisible ? localFindQuery : ''}
              // Term/Aliases/Meaning/Explanation/Compare/References already live in
              // IdiomHeader above — this body is genuinely optional scratch space, so it
              // gets a real visible placeholder explaining that (rather than sitting
              // blank with no explanation) and loses the persistent formatting toolbar,
              // which was adding a wall of buttons over an area with no stated purpose.
              placeholder={activeNote.type === 'idiom' ? 'Additional notes (optional) — anything else about this idiom that doesn\'t fit above…' : noteEditorPlaceholder(activeNote)}
              hideFormattingToolbar={activeNote.type === 'idiom'}
              importSource={
                activeNote.tags?.includes('biblegateway') ? 'biblegateway'
                : activeNote.tags?.includes('esword') ? 'esword'
                : undefined
              }
              importedAt={
                (activeNote.tags?.includes('biblegateway') || activeNote.tags?.includes('esword'))
                  ? activeNote.importedAt
                  : undefined
              }
            />
            {/* Stays visible in Focus mode too — it's a floating trigger pill the user
                summons on demand (outline/folder path/backlinks stay tucked away until
                clicked), not persistent chrome Focus mode needs to clear away. */}
            <NoteSidePanel
              content={activeNote.content}
              noteTitle={activeNote.title || 'Untitled'}
              noteId={activeNote.id}
              noteType={activeNote.type}
              tabId={notesTabId ?? undefined}
              allNotes={notes}
              onNoteClick={navigateToNote}
              onOpenNewTab={openNoteInNewTab}
              onOpenInFloatingTab={openNoteInFloatingTab}
              folderPath={folderPathFor(activeNote, folders)}
            />
          </div>
        ) : (
          // Notes-home region is bumped to ~reading size (and still tracks app zoom) — see
          // READING_REGION_ZOOM. The inner layer is scaled up and counter-sized (absolute +
          // inset-0 in this relative box) so the magnified content fills this pane exactly,
          // never overflowing or clipping the bottom of the list.
          <div className="relative flex-1 min-h-0 overflow-hidden">
          <div className="absolute inset-0 flex flex-col min-h-0 overflow-hidden" style={readingRegionScale}>
            {/* Search bar — with sort selector inline on the right */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
              <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
              <input
                type="text"
                value={noteSearch}
                onChange={(e) => setNoteSearch(e.target.value)}
                placeholder="Search notes…"
                className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none min-w-0"
              />
              {noteSearch && (
                <button onClick={() => setNoteSearch('')} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer flex-shrink-0">
                  <X size={13} />
                </button>
              )}
              {/* Word mode — only meaningful while actively searching; matches the same
                  all/any/phrase pills used in the floating search bar. */}
              {noteSearch.trim() && (
                <div className="flex items-center gap-0.5 bg-[rgb(var(--color-surface-4))] rounded p-0.5 flex-shrink-0">
                  {(['all', 'any', 'phrase'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setNoteSearchWordMode(m)}
                      className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors capitalize
                        ${noteSearchWordMode === m ? 'bg-[rgb(var(--color-surface-2))] text-[rgb(var(--color-text-primary))] shadow-sm' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <div className="w-px h-3 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <select
                value={noteSort}
                onChange={e => setNoteSort(e.target.value as NoteSort)}
                className="text-[10px] bg-transparent text-[rgb(var(--color-text-muted))] outline-none cursor-pointer hover:text-[rgb(var(--color-text-primary))] flex-shrink-0"
                title="Sort notes"
              >
                <option value="modified">Modified</option>
                <option value="created">Created</option>
                <option value="name">A-Z</option>
              </select>
              {/* Expand all toggle — only meaningful in list view (folder view has no
                  snippets, board view cards are already fixed-height). */}
              {viewMode === 'list' && (
                <>
                  <div className="w-px h-3 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
                  <button
                    onClick={() => setExpandAll(v => !v)}
                    title={expandAll ? 'Collapse notes' : 'Expand all notes'}
                    className={`p-1 rounded-shell cursor-pointer transition-colors flex-shrink-0 ${expandAll ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}
                  >
                    <AlignJustify size={13} />
                  </button>
                </>
              )}
            </div>

            {/* Filter chips bar (list view only) */}
            {!folderView && (
            <div className="flex items-center gap-1 px-2 py-1 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 overflow-x-auto">
              {([
                ['all',          'All'],
                ['scripture',    'Scripture'],
                ['topic',        'Topic'],
                ['daily',        'Daily'],
                ['youtube',      'Video'],
                ['biblegateway', 'BG'],
                ['esword',       'eSword'],
                ['idiom',        'Idioms'],
              ] as [NoteFilter, string][]).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setNoteFilter(f)}
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors
                    ${noteFilter === f
                      ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                      : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-secondary))]'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
            )}

            {/* Status filter chips — independent axis from the type chips above, combinable */}
            {!folderView && (
            <div className="flex items-center gap-1 px-2 py-1 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 overflow-x-auto">
              <button
                onClick={() => setStatusFilter('all')}
                className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors
                  ${statusFilter === 'all'
                    ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-secondary))]'
                  }`}
              >
                All statuses
              </button>
              {NOTE_STATUSES.map((s) => {
                const Icon = s.icon
                return (
                  <button
                    key={s.id}
                    onClick={() => setStatusFilter(s.id)}
                    className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors
                      ${statusFilter === s.id
                        ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                        : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-secondary))]'
                      }`}
                  >
                    <Icon size={10} style={{ color: statusFilter === s.id ? undefined : s.color }} /> {s.label}
                  </button>
                )
              })}
              <button
                onClick={() => setStatusFilter('no-status')}
                className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors
                  ${statusFilter === 'no-status'
                    ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-secondary))]'
                  }`}
              >
                No status
              </button>
            </div>
            )}

            {/* Multi-select action bar */}
            {selectMode && (
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 bg-[rgb(var(--color-surface-4))/50]">
                <span className="text-xs text-[rgb(var(--color-text-muted))] flex-1">
                  {selectedIds.length + selectedFolderIds.length} selected
                </span>
                {folderView && (selectedIds.length + selectedFolderIds.length) > 0 && (
                  <button
                    onClick={(e) => setMoveMenu({ x: e.clientX, y: e.clientY })}
                    className="flex items-center gap-1 text-xs text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer px-2 py-0.5 rounded hover:bg-[rgb(var(--color-surface-4))] transition-colors"
                  >
                    <FolderInput size={11} /> Move to folder
                  </button>
                )}
                {(selectedIds.length + selectedFolderIds.length) > 0 && (
                  <button
                    onClick={deleteSelected}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 cursor-pointer px-2 py-0.5 rounded hover:bg-red-500/15 transition-colors"
                  >
                    <Trash2 size={11} /> Delete selected
                  </button>
                )}
                <button
                  onClick={exitSelectMode}
                  className="text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Continuous daily scroll mode — replaces the list when toggled on the 'daily' filter */}
            {continuousDailyScroll && !folderView ? (
              <ContinuousDailyScroll
                targetDate={continuousDailyDate}
                notes={notes}
                onDateChange={setContinuousDailyDate}
                onDayOpen={openDailyNote}
              />
            ) : (
            <div
              ref={notesListScrollRef}
              className="flex-1 overflow-y-auto"
              style={{ transform: 'translateZ(0)', contain: 'paint' }}
              onScroll={(e) => { lastListScrollTopRef.current = (e.currentTarget as HTMLDivElement).scrollTop }}
            >
              {folderView ? (
                <NotesFolderView
                  notes={visibleNotes}
                  folders={folders}
                  activeNoteId={(activeNote as Note | null)?.id ?? null}
                  onSelect={navigateToNote}
                  onDelete={(note) => deleteNote(note)}
                  onSetNoteFolder={handleSetNoteFolder}
                  onCreateNote={createNote}
                  onCreateNoteInFolder={async (folderId) => {
                    const result = await window.notes.createNote({ content: '', folderId })
                    if (result.success && result.note) {
                      setNotes((prev) => [result.note!, ...prev])
                      setActiveNote(result.note!)
                      bumpNoteToken()
                    }
                  }}
                  onCreateIdiom={() => setIdiomModal({ term: '', meaning: '' })}
                  onCreateIdiomInFolder={(folderId) => setIdiomModal({ term: '', meaning: '', folderId })}
                  onCreateFolder={handleCreateFolder}
                  autoRenameFolderId={autoRenameFolderId}
                  onAutoRenameHandled={() => setAutoRenameFolderId(null)}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onDeleteFolderDeep={handleDeleteFolderDeep}
                  onSetFolderParent={handleSetFolderParent}
                  onRenameNote={renameNoteCommit}
                  onOpenNewTab={openNoteInNewTab}
                  onOpenInFloatingTab={openNoteInFloatingTab}
                  onOpenInSession={openNoteInSession}
                  onExportPdf={(note) => setPrintNote(note)}
                  onSetStatus={handleSetStatus}
                  sessions={sessions}
                  selectMode={selectMode}
                  selectedNoteIds={selectedIds}
                  selectedFolderIds={selectedFolderIds}
                  onToggleSelectNote={toggleSelectNote}
                  onToggleSelectFolder={toggleSelectFolder}
                  searchQuery={noteSearch || undefined}
                />
              ) : boardView ? (
                <NotesBoardView
                  notes={visibleNotes}
                  onSelect={navigateToNote}
                  onSetStatus={handleSetStatus}
                />
              ) : (
                <NotesList
                  scrollParentRef={notesListScrollRef}
                  notes={visibleNotes}
                  onSelect={navigateToNote}
                  onDelete={(note) => deleteNote(note)}
                  onConvertToIdiom={(note) => setConvertIdiomModal({ note, term: note.title || '', meaning: '', keepContent: true })}
                  findQuery={activeListFindQuery}
                  searchQuery={noteSearch}
                  selectMode={selectMode}
                  selected={selectedIds}
                  onToggleSelect={toggleSelectNote}
                  expandAll={expandAll}
                  onOpenNewTab={openNoteInNewTab}
                  onRenameCommit={renameNoteCommit}
                  onOpenInFloatingTab={openNoteInFloatingTab}
                  onOpenInSession={openNoteInSession}
                  onExportPdf={(note) => setPrintNote(note)}
                  onSetStatus={handleSetStatus}
                  onTogglePinned={handleTogglePinned}
                  sessions={sessions}
                />
              )}
            </div>
            )}
          </div>
          </div>
        )}
      </div>

      {printPreviewOpen && activeNote && (
        <PrintPreviewModal
          title={activeNote.title || 'Untitled'}
          content={activeNote.content}
          notes={notes}
          onClose={() => setPrintPreviewOpen(false)}
        />
      )}
      {idiomsModalOpen && (
        <PrintPreviewModal
          title="Idioms"
          content=""
          idiomEntries={idiomExportEntries()}
          onClose={() => setIdiomsModalOpen(false)}
        />
      )}
      {printNote && (
        <PrintPreviewModal
          title={printNote.title || 'Untitled'}
          content={printNote.content}
          notes={notes}
          onClose={() => setPrintNote(null)}
        />
      )}
      {/* Idiom creation modal */}
      {idiomModal && (
        <>
          <div className="fixed inset-0 z-[9998] bg-black/40" onClick={() => setIdiomModal(null)} />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto w-80 bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl p-5 flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">New Idiom Note</div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-[rgb(var(--color-text-muted))]">Term</label>
                <input
                  autoFocus
                  value={idiomModal.term}
                  onChange={e => setIdiomModal(m => m ? { ...m, term: e.target.value } : m)}
                  placeholder="e.g. fox"
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/60]"
                  onKeyDown={e => { if (e.key === 'Escape') setIdiomModal(null) }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-[rgb(var(--color-text-muted))]">Meaning</label>
                <input
                  value={idiomModal.meaning}
                  onChange={e => setIdiomModal(m => m ? { ...m, meaning: e.target.value } : m)}
                  placeholder="e.g. cunning, deception, false teachers"
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/60]"
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      await submitIdiomModal()
                    } else if (e.key === 'Escape') { setIdiomModal(null) }
                  }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setIdiomModal(null)} className="px-3 py-1.5 text-xs rounded-lg text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer">Cancel</button>
                <button
                  disabled={!idiomModal.term.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white disabled:opacity-40 hover:opacity-90 transition-opacity cursor-pointer"
                  onClick={submitIdiomModal}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Convert note to idiom modal */}
      {convertIdiomModal && (
        <>
          <div className="fixed inset-0 z-[9998] bg-black/40" onClick={() => setConvertIdiomModal(null)} />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto w-96 bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl p-5 flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div>
                <div className="text-sm font-semibold text-[rgb(var(--color-text-primary))] mb-0.5">Convert to Idiom Note</div>
                <div className="text-xs text-[rgb(var(--color-text-muted))]">This note will become an idiom entry. Words matching the term will be underlined in verse text.</div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-[rgb(var(--color-text-muted))]">Term</label>
                <input
                  autoFocus
                  value={convertIdiomModal.term}
                  onChange={e => setConvertIdiomModal(m => m ? { ...m, term: e.target.value } : m)}
                  placeholder="e.g. fox"
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/60]"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-[rgb(var(--color-text-muted))]">Meaning <span className="opacity-60">(optional)</span></label>
                <input
                  value={convertIdiomModal.meaning}
                  onChange={e => setConvertIdiomModal(m => m ? { ...m, meaning: e.target.value } : m)}
                  placeholder="e.g. cunning, deception, false teachers"
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/60]"
                />
              </div>
              {convertIdiomModal.note.content.trim() && (
                <div className="flex flex-col gap-2 pt-2 border-t border-[rgb(var(--color-surface-4))]">
                  <div className="text-xs text-[rgb(var(--color-text-muted))]">This note has existing content. What should happen to it?</div>
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-[rgb(var(--color-text-secondary))]">
                      <input
                        type="radio"
                        checked={convertIdiomModal.keepContent}
                        onChange={() => setConvertIdiomModal(m => m ? { ...m, keepContent: true } : m)}
                        className="accent-[rgb(var(--color-accent))]"
                      />
                      Keep as body content of the idiom note
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-[rgb(var(--color-text-secondary))]">
                      <input
                        type="radio"
                        checked={!convertIdiomModal.keepContent}
                        onChange={() => setConvertIdiomModal(m => m ? { ...m, keepContent: false } : m)}
                        className="accent-[rgb(var(--color-accent))]"
                      />
                      Clear body content (idiom term + meaning only)
                    </label>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConvertIdiomModal(null)} className="px-3 py-1.5 text-xs rounded-lg text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer">Cancel</button>
                <button
                  disabled={!convertIdiomModal.term.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white disabled:opacity-40 hover:opacity-90 transition-opacity cursor-pointer"
                  onClick={async () => {
                    const { note, term, meaning, keepContent } = convertIdiomModal
                    if (!term.trim()) return
                    setConvertIdiomModal(null)
                    const updates: Record<string, unknown> = {
                      type: 'idiom',
                      title: term.trim(),
                      idiomTerm: term.trim().toLowerCase(),
                      idiomMeaning: meaning.trim() || undefined,
                      content: keepContent ? note.content : '',
                    }
                    await window.notes.updateNote(note.id, updates)
                    const updated = { ...note, ...updates, title: term.trim(), updatedAt: Date.now() } as Note
                    setNotes(prev => prev.map(n => n.id === note.id ? updated : n))
                    if (activeNote?.id === note.id) setActiveNote(updated)
                    window.notes.listIdioms?.().then(setIdiomCache).catch(() => {})
                  }}
                >
                  Convert
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {versionHistoryOpen && activeNote && (
        <NoteVersionHistory
          noteId={activeNote.id}
          currentContent={activeNote.content}
          currentTitle={activeNote.title || 'Untitled'}
          onClose={() => setVersionHistoryOpen(false)}
          onRestored={(content) => {
            const id = activeNote.id
            setActiveNote(prev => prev ? { ...prev, content, updatedAt: Date.now() } : prev)
            setNotes(prev => prev.map(n => n.id === id ? { ...n, content, updatedAt: Date.now() } : n))
            lastSnapshotContentRef.current = content
            bumpNoteToken()
            maybeSyncNote(id)
          }}
        />
      )}

      {/* One-time "click a note to open it" hint — a floating corner toast (not inline in the
          list, so it doesn't shift layout) shown until the user opens any note or dismisses it. */}
      {createPortal(
        <AnimatePresence>
          {!openNoteHintDismissed && !editing && !selectMode && !noteSearch && visibleNotes.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="fixed bottom-4 right-4 z-[500] flex items-center gap-2 pl-3 pr-2 py-2 rounded-shell-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl text-[12px] text-[rgb(var(--color-text-secondary))]"
            >
              <span>Click a note to open it</span>
              <button
                onClick={dismissOpenNoteHint}
                title="Dismiss"
                className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer flex-shrink-0"
              >
                <X size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

// Which secondary fields exist for an idiom note, beyond Term + Meaning — added
// individually via the "+ Add field" button rather than all revealed together behind one
// disclosure, so the header only ever shows fields actually in use.
const IDIOM_FIELD_DEFS = [
  { key: 'aliases', label: 'Aliases' },
  { key: 'explanation', label: 'Explanation' },
  { key: 'compare', label: 'Compare to' },
  { key: 'references', label: 'References' },
] as const
type IdiomFieldKey = typeof IDIOM_FIELD_DEFS[number]['key']

function idiomFieldHasContent(note: Note, key: IdiomFieldKey): boolean {
  const data = note.idiomData ?? {}
  switch (key) {
    case 'aliases': return (note.idiomAliases ?? []).length > 0
    case 'explanation': return (data.explanation ?? '').trim().length > 0
    case 'compare': return (data.compare ?? []).length > 0
    case 'references': return (data.verses ?? []).length > 0
  }
}

// ── IdiomHeader ───────────────────────────────────────────────────────────────
// Idiom header — Term + Meaning only by default (a clean, borderless two-line look, no
// input-box chrome). Aliases/Explanation/Compare/References are each added individually
// via "+ Add field" — a field only ever appears once it either already has content or the
// user explicitly adds it, instead of one toggle revealing all four together. Auto-
// variants matching and example sentences are behavior-only settings that never appear on
// the printed export — tucked into a small menu next to Term instead of sitting in the
// main field flow.
function IdiomHeader({ note, onUpdate }: {
  note: Note
  onUpdate: (updates: Partial<Note>) => Promise<void>
}) {
  const [aliasInput, setAliasInput] = useState('')
  const aliases = note.idiomAliases ?? []
  const autoVariants = note.idiomAutoVariants ?? false

  // Structured reference-book fields (idiomData JSON).
  const data = note.idiomData ?? {}
  const examples = data.examples ?? []
  const compare = data.compare ?? []
  const verses = data.verses ?? []
  const [exInput, setExInput] = useState('')
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [behaviorMenuOpen, setBehaviorMenuOpen] = useState(false)
  const [addFieldMenuOpen, setAddFieldMenuOpen] = useState(false)
  // Seeded from whichever fields already have content, so existing idiom notes show
  // everything they already have without the user needing to re-add it. Once a field is
  // added (or already had content), it stays visible for the rest of the session even if
  // the user clears it out mid-edit — it only disappears again via its own "remove field"
  // action, not automatically just because it's momentarily empty.
  const [addedFields, setAddedFields] = useState<Set<IdiomFieldKey>>(
    () => new Set(IDIOM_FIELD_DEFS.map((f) => f.key).filter((k) => idiomFieldHasContent(note, k)))
  )
  const updateData = (patch: Partial<NonNullable<Note['idiomData']>>) => onUpdate({ idiomData: { ...data, ...patch } })

  function addField(key: IdiomFieldKey) {
    setAddedFields((prev) => new Set(prev).add(key))
    setAddFieldMenuOpen(false)
  }
  function removeField(key: IdiomFieldKey) {
    setAddedFields((prev) => { const next = new Set(prev); next.delete(key); return next })
    if (key === 'aliases') onUpdate({ idiomAliases: [] })
    else if (key === 'explanation') updateData({ explanation: undefined })
    else if (key === 'compare') updateData({ compare: [] })
    else if (key === 'references') updateData({ verses: [] })
  }

  // Same auto-detection idiomExportEntries() already mines at export time — surfaced
  // live here too, so the user isn't manually retyping references the export will pick
  // up on its own. Shown read-only underneath the manual Verses row; only the ones NOT
  // already listed manually, so nothing appears twice.
  const autoVerses = useMemo(() => {
    const textForRefs = [...examples, data.explanation ?? '', note.content ?? ''].join('\n')
    const fmt = (r: NoteVerseRef): string =>
      r.isChapter || r.verse === 0
        ? bookChapterVerseLabel(r.bookId, r.chapter)
        : `${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${r.endVerse ? `-${r.endVerse}` : ''}`
    const found = extractRefsFromNote(textForRefs, note.idiomTerm || note.title || '').map(fmt)
    const already = new Set(verses.map((v) => v.toLowerCase()))
    return [...new Set(found)].filter((v) => !already.has(v.toLowerCase()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examples, data.explanation, note.content, note.idiomTerm, note.title, verses])

  async function saveAlias(val: string) {
    const trimmed = val.trim()
    if (!trimmed || aliases.map(a => a.toLowerCase()).includes(trimmed.toLowerCase())) return
    await onUpdate({ idiomAliases: [...aliases, trimmed] })
    setAliasInput('')
  }

  async function removeAlias(alias: string) {
    await onUpdate({ idiomAliases: aliases.filter(a => a !== alias) })
  }

  const availableFieldDefs = IDIOM_FIELD_DEFS.filter((f) => !addedFields.has(f.key))

  return (
    <div className="flex flex-col gap-1.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 px-4 pt-3 pb-2">
      <div className="flex items-start gap-2">
        {/* Term — the printed entry's own heading style (bold, uppercase, colored). */}
        <input
          key={note.id + '-term'}
          className="flex-1 min-w-0 bg-transparent outline-none text-violet-400 placeholder:text-[rgb(var(--color-text-muted))] font-bold text-base uppercase tracking-wide"
          placeholder="Term…"
          defaultValue={note.idiomTerm ?? note.title}
          onBlur={async (e) => {
            const term = e.target.value.trim()
            if (!term || term === note.idiomTerm) return
            await onUpdate({ idiomTerm: term.toLowerCase(), title: term })
          }}
        />
        {/* Behavior-only settings (never printed) — plurals matching + example sentences,
            tucked away here instead of sitting in the main field flow. */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setBehaviorMenuOpen((v) => !v)}
            title="Highlighting behavior"
            className={`p-1 rounded cursor-pointer transition-colors ${behaviorMenuOpen ? 'text-violet-400 bg-violet-500/10' : 'text-[rgb(var(--color-text-muted))] hover:text-violet-400'}`}
          >
            <SlidersHorizontal size={14} />
          </button>
          {behaviorMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBehaviorMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-64 rounded-shell border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg p-2.5 flex flex-col gap-2.5">
                <button
                  onClick={() => onUpdate({ idiomAutoVariants: !autoVariants })}
                  className="flex items-center justify-between gap-2 text-left cursor-pointer group"
                >
                  <span className="text-xs text-[rgb(var(--color-text-secondary))] group-hover:text-[rgb(var(--color-text-primary))]">Also match plurals/possessives</span>
                  <span className={`relative flex-shrink-0 w-8 h-4 rounded-full transition-colors ${autoVariants ? 'bg-violet-500' : 'bg-[rgb(var(--color-surface-4))]'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoVariants ? 'translate-x-4' : ''}`} />
                  </span>
                </button>
                <div className="pt-2 border-t border-[rgb(var(--color-surface-4))]">
                  <button onClick={() => setExamplesOpen((v) => !v)} className="w-full flex items-center justify-between text-xs text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
                    <span>Example sentences{examples.length > 0 ? ` (${examples.length})` : ''}</span>
                    <span>{examplesOpen ? '▾' : '▸'}</span>
                  </button>
                  <p className="text-[10px] text-[rgb(var(--color-text-muted))] opacity-70 mt-1">Not printed — just text to mine for scripture references.</p>
                  {examplesOpen && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {examples.map((ex, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <input
                            defaultValue={ex}
                            className="flex-1 text-xs bg-[rgb(var(--color-surface-4))/50] rounded px-2 py-1 outline-none text-[rgb(var(--color-text-primary))]"
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              const next = [...examples]
                              if (!v) next.splice(i, 1); else next[i] = v
                              updateData({ examples: next })
                            }}
                          />
                          <button onClick={() => updateData({ examples: examples.filter((_, j) => j !== i) })} className="text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer text-xs">×</button>
                        </div>
                      ))}
                      <input
                        value={exInput}
                        onChange={(e) => setExInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && exInput.trim()) { e.preventDefault(); updateData({ examples: [...examples, exInput.trim()] }); setExInput('') } }}
                        onBlur={() => { if (exInput.trim()) { updateData({ examples: [...examples, exInput.trim()] }); setExInput('') } }}
                        placeholder="+ add an example sentence…"
                        className="text-xs bg-transparent outline-none text-[rgb(var(--color-text-secondary))] placeholder:text-[rgb(var(--color-text-muted))]"
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Meaning — the export's definition paragraph. Only other field always visible. */}
      <textarea
        key={note.id + '-meaning'}
        defaultValue={note.idiomMeaning ?? ''}
        rows={1}
        placeholder="Meaning…"
        className="w-full text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] bg-transparent outline-none resize-none leading-snug"
        onBlur={async (e) => {
          const meaning = e.target.value.trim()
          if (meaning === (note.idiomMeaning ?? '')) return
          await onUpdate({ idiomMeaning: meaning || undefined })
        }}
      />

      {addedFields.has('aliases') && (
        <IdiomFieldWrap label="Aliases" onRemove={() => removeField('aliases')}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {aliases.map((alias) => (
              <span key={alias} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 text-[10px] font-medium">
                {alias}
                <button
                  onClick={() => removeAlias(alias)}
                  className="text-violet-400 hover:text-violet-200 leading-none cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
                  title="Remove"
                >×</button>
              </span>
            ))}
            <input
              className="text-xs bg-transparent outline-none text-[rgb(var(--color-text-secondary))] placeholder:text-[rgb(var(--color-text-muted))] min-w-[120px] max-w-[180px]"
              placeholder="+ same idiom, different wording…"
              value={aliasInput}
              onChange={e => setAliasInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); await saveAlias(aliasInput) }
                if (e.key === 'Backspace' && !aliasInput && aliases.length) await removeAlias(aliases[aliases.length - 1])
              }}
              onBlur={() => { if (aliasInput.trim()) saveAlias(aliasInput) }}
            />
          </div>
        </IdiomFieldWrap>
      )}

      {addedFields.has('explanation') && (
        <IdiomFieldWrap label="Explanation" onRemove={() => removeField('explanation')}>
          <textarea
            key={note.id + '-expl'}
            defaultValue={data.explanation ?? ''}
            rows={2}
            placeholder="What it means, where it comes from…"
            className="w-full text-xs text-[rgb(var(--color-text-secondary))] placeholder:text-[rgb(var(--color-text-muted))] bg-transparent outline-none resize-y leading-relaxed"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (data.explanation ?? '')) updateData({ explanation: v || undefined }) }}
          />
        </IdiomFieldWrap>
      )}

      {addedFields.has('compare') && (
        <IdiomFieldWrap label="Compare to" onRemove={() => removeField('compare')}>
          <IdiomChipRow items={compare} onChange={(next) => updateData({ compare: next })} placeholder="+ related idiom…" />
        </IdiomFieldWrap>
      )}

      {addedFields.has('references') && (
        <IdiomFieldWrap label="References" onRemove={() => removeField('references')}>
          <IdiomChipRow items={verses} onChange={(next) => updateData({ verses: next })} placeholder="+ e.g. Luke 13:32…" />
          {autoVerses.length > 0 && (
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] italic mt-1">
              Also found in your text (included automatically, no need to add): {autoVerses.join(', ')}
            </p>
          )}
        </IdiomFieldWrap>
      )}

      {availableFieldDefs.length > 0 && (
        <div className="relative self-start">
          <button
            onClick={() => setAddFieldMenuOpen((v) => !v)}
            className="text-[11px] text-[rgb(var(--color-text-muted))] hover:text-violet-400 cursor-pointer flex items-center gap-1 py-0.5"
          >
            <span>+</span>
            <span>Add field</span>
          </button>
          {addFieldMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAddFieldMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 w-40 rounded-shell border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg py-1">
                {availableFieldDefs.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => addField(f.key)}
                    className="w-full text-left px-3 py-1.5 text-xs text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Label-above-content wrapper for an idiom secondary field, with a hover-revealed
 *  "Remove" action — consistent minimal treatment (no boxes/borders) across all four
 *  individually-added fields. */
function IdiomFieldWrap({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 group/field">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-muted))]">{label}</span>
        <button
          onClick={onRemove}
          className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer opacity-0 group-hover/field:opacity-100 transition-opacity"
        >
          Remove
        </button>
      </div>
      {children}
    </div>
  )
}

/** Small reusable add/remove chip list for the idiom structured fields — label now lives
 *  in the enclosing IdiomFieldWrap, so this only renders the chips + add input. */
function IdiomChipRow({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('')
  const add = (v: string) => { const t = v.trim(); if (t && !items.includes(t)) onChange([...items, t]); setInput('') }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {items.map((it) => (
        <span key={it} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 text-xs font-medium">
          {it}
          <button onClick={() => onChange(items.filter((x) => x !== it))} className="text-violet-400 hover:text-violet-200 leading-none cursor-pointer opacity-70 hover:opacity-100">×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && input.trim()) { e.preventDefault(); add(input) } }}
        onBlur={() => { if (input.trim()) add(input) }}
        placeholder={placeholder}
        className="text-xs bg-transparent outline-none text-[rgb(var(--color-text-secondary))] placeholder:text-[rgb(var(--color-text-muted))] min-w-[110px]"
      />
    </div>
  )
}

