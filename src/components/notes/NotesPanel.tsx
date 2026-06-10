import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import { Plus, ArrowLeft, Home, Trash2, HelpCircle, X, Search, ScanSearch, Eye, EyeOff, Paperclip, CheckSquare, Calendar, CalendarDays, ChevronLeft, ChevronRight, SortAsc, Filter, AlignJustify, BookOpen, Printer, FileDown, FolderTree, FileText, FolderPlus, FolderInput, ExternalLink, Code2, PenLine, History } from 'lucide-react'
import NoteVersionHistory from './NoteVersionHistory'
import { HintTooltip } from '@/components/shell/HintTooltip'
import ZoomControls from '@/components/shell/ZoomControls'
import NotesList from './NotesList'
import NoteEditor from './NoteEditor'
import PrintPreviewModal from './PrintPreviewModal'
import NoteSidePanel from './NoteSidePanel'
import FindBar from '@/components/shell/FindBar'
import { useAppStore } from '@/store'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import type { ParsedRef } from '@/lib/parseRef'
import type { Note, NoteTabState, Tab, NoteFolder } from '@/types'
import NotesFolderView, { folderPathFor, noteIsMovable } from './NotesFolderView'
import { orderedFolders } from './NoteContextMenu'
import { isSystemNote, parseVerseRef } from '@/lib/noteUtils'

type NoteFilter = 'all' | 'scripture' | 'topic' | 'daily' | 'youtube' | 'biblegateway' | 'esword'
type NoteSort = 'modified' | 'created' | 'name'

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function todayKey(): string { return toDateKey(new Date()) }

function dailyNoteTitle(date: Date): string {
  return `Daily — ${toDateKey(date)}`
}


function formatVerseRef(ref: string): string {
  const [bookId, chapter, verse] = ref.split('.')
  const name = bookId ? bookName(bookId) : ref
  return verse ? `${name} ${chapter}:${verse}` : `${name} ${chapter}`
}

export default function NotesPanel({ floating = false }: { floating?: boolean }) {
  const pendingNoteId = useAppStore((s) => s.pendingNoteId)
  const clearPendingNote = useAppStore((s) => s.clearPendingNote)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpNoteEditToken = useAppStore((s) => s.bumpNoteEditToken)
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabs = useAppStore((s) => s.tabs)
  const renameTab = useAppStore((s) => s.renameTab)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const youtubeIsPlaying = useAppStore((s) => s.youtubeIsPlaying)
  const notesTabId = activeTabId['notes']

  const sessions = useAppStore((s) => s.sessions)
  const addTab = useAppStore((s) => s.addTab)
  const switchSession = useAppStore((s) => s.switchSession)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const noteTransformLayout = useAppStore((s) => s.noteTransformLayout)

  const [notes, setNotes] = useState<Note[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [noteHistory, setNoteHistory] = useState<Array<{ note: Note; scrollTop: number }>>([])
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
  const [localFindOpen, setLocalFindOpen] = useState(false)
  const [localFindQuery, setLocalFindQuery] = useState('')
  const [findMatchIdx, setFindMatchIdx] = useState(0)
  const [noteSearch, setNoteSearch] = useState('')

  // Keep ref in sync so the event handler always sees the latest activeNote
  useEffect(() => { activeNoteRef.current = activeNote }, [activeNote])

  // Listen for App.tsx's routed find-bar open event (also handles type-anywhere seed char)
  useEffect(() => {
    function onOpenNotesFindBar(e: Event) {
      const seedChar = (e as CustomEvent).detail?.seedChar ?? ''
      if (localFindOpen) {
        // Already open — re-focus the input and select its text (don't close).
        window.dispatchEvent(new CustomEvent('berean:findBarSelectAll'))
        return
      }
      setLocalFindOpen(true)
      setLocalFindQuery(seedChar)
      setFindMatchIdx(0)
    }
    window.addEventListener('berean:openNotesFindBar', onOpenNotesFindBar)
    return () => window.removeEventListener('berean:openNotesFindBar', onOpenNotesFindBar)
  }, [localFindOpen])

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
  const [noteSort, setNoteSort] = useState<NoteSort>('modified')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [expandAll, setExpandAll] = useState(false)
  const [folderView, setFolderView] = useState(false)
  const [folders, setFolders] = useState<NoteFolder[]>([])
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number } | null>(null)

  const loadFolders = useCallback(() => {
    window.notes.getFolders().then(setFolders).catch(() => {})
  }, [])

  // Load folders + persisted folder-view preference on mount
  useEffect(() => {
    loadFolders()
    window.settings?.get('notesFolderView').then((v) => { if (v === true) setFolderView(true) }).catch(() => {})
  }, [loadFolders])

  const toggleFolderView = useCallback(() => {
    setFolderView((v) => {
      const next = !v
      window.settings?.set('notesFolderView', next).catch(() => {})
      return next
    })
  }, [])

  // Folder operation handlers — call IPC then reload folders + notes
  const reloadNotes = useCallback(() => {
    window.notes.getNotes(100000, 0).then(setNotes).catch(() => {})
  }, [])
  const handleCreateFolder = useCallback(async (parentId: string | null) => {
    await window.notes.createFolder('New Folder', parentId); loadFolders()
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
    function onOpen() { openDailyNoteRef.current(new Date()) }
    window.addEventListener('berean:openDailyNote', onOpen)
    return () => window.removeEventListener('berean:openDailyNote', onOpen)
  }, [])

  async function openDailyNote(date: Date) {
    const title = dailyNoteTitle(date)
    // 1. Check in-memory list first (fast path)
    const inMemory = notes.find(n => n.title === title && n.type === 'daily')
    if (inMemory) {
      setActiveNote(inMemory)
      setCalendarOpen(false)
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
        setCalendarOpen(false)
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
    setCalendarOpen(false)
  }

  // Allow sidebar's daily-note button (berean:openDailyNote) to work when notes panel is mounted
  const openDailyNoteRef = useRef<(d: Date) => void>(() => {})

  type EditorMode = 'raw' | 'wysiwyg' | 'preview'
  const NEXT_MODE: Record<EditorMode, EditorMode> = { raw: 'wysiwyg', wysiwyg: 'preview', preview: 'raw' }
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg')
  const previewMode = editorMode === 'preview'
  const wysiwygMode = editorMode === 'wysiwyg'

  // Cmd+Shift+M → cycle through raw → wysiwyg → preview
  useEffect(() => {
    function onToggle() { setEditorMode((prev) => NEXT_MODE[prev]) }
    window.addEventListener('berean:toggleMarkdown', onToggle)
    return () => window.removeEventListener('berean:toggleMarkdown', onToggle)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorFocusRef = useRef<(() => void) | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  // Track latest scroll position via scroll events (more reliable than reading DOM on unmount)
  const lastScrollTopRef = useRef(0)
  // Track latest cursor position so it can be persisted on tab switch
  const lastCursorPosRef = useRef(0)

  // Keep tab title in sync with the open note — re-runs whenever the note id
  // OR title changes so that renaming a note immediately updates the tab label.
  useEffect(() => {
    if (!notesTabId) return
    const title = activeNote ? (activeNote.title?.trim() || 'Untitled') : 'Notes'
    renameTab('notes', notesTabId, title)
    // Record note view in history (only on note change, not on every title keystroke)
    if (activeNote) {
      useAppStore.getState().addHistoryEntry({
        type: 'note',
        title,
        noteId: activeNote.id,
      })
    }
  }, [activeNote?.id, activeNote?.title, notesTabId, renameTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.notes.getNotes(100000, 0).then(setNotes).catch(() => {})
  }, [noteChangeToken])

  // Restore the note that was open when this tab was last active
  // Only restore if the tab was NOT freshly created (isNew = false)
  useEffect(() => {
    if (!notesTabId) return
    const tab = tabs['notes'].find((t) => t.id === notesTabId)
    const tabState = tab?.state as NoteTabState | undefined
    if (tabState?.isNew) return // fresh tab → show list
    const savedNoteId = tabState?.noteId ?? null
    const savedScrollTop = tabState?.scrollTop ?? 0
    const savedCursorPos = tabState?.cursorPos ?? 0
    if (!savedNoteId) return
    window.notes.getNote(savedNoteId)
      .then((note) => {
        if (note) {
          setActiveNote(note)
          setRestoredScrollTop(savedScrollTop)
          setRestoredCursorPos(savedCursorPos)
          setAutoFocusEditor(true)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount only

  const [restoredScrollTop, setRestoredScrollTop] = useState(0)
  const [restoredCursorPos, setRestoredCursorPos] = useState(0)
  const [autoFocusEditor, setAutoFocusEditor] = useState(false)

  // Save scroll + cursor when notesTabId changes (switching between notes tabs within the space).
  useEffect(() => {
    const id = notesTabId
    return () => {
      if (!id) return
      useAppStore.getState().updateTabState('notes', id, {
        scrollTop: lastScrollTopRef.current,
        cursorPos: lastCursorPosRef.current,
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
      })
    }
    window.addEventListener('berean:saveScrollBeforeTabChange', onSave)
    return () => window.removeEventListener('berean:saveScrollBeforeTabChange', onSave)
  }, [notesTabId])

  // Persist open note id to tab state
  useEffect(() => {
    if (!notesTabId) return
    updateTabState('notes', notesTabId, { noteId: activeNote?.id ?? null, isNew: false })
  }, [activeNote?.id, notesTabId, updateTabState])

  // Open a specific note (only from explicit requests like full tab opens)
  useEffect(() => {
    if (!pendingNoteId) return
    clearPendingNote()
    window.notes.getNote(pendingNoteId)
      .then((note) => {
        if (!note) return
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

  async function deleteNote(note?: Note) {
    const target = note ?? activeNote
    if (!target) return
    await window.notes.deleteNote(target.id)
    setNotes((prev) => prev.filter((n) => n.id !== target.id))
    bumpNoteToken()
    if (target.id === activeNote?.id) { setActiveNote(null); setEditorMode('wysiwyg') }
  }

  async function goBack() {
    if (!activeNote) return
    if (activeNote.content.trim() === '') {
      await deleteNote(activeNote)
    } else {
      snapshotVersion(activeNote, 'auto')   // consolidate a version on leaving the note
    }
    setActiveNote(null)
    setNoteHistory([])
    setEditorMode('wysiwyg')
  }

  function navigateToNote(note: Note) {
    if (activeNote && activeNote.id !== note.id) {
      snapshotVersion(activeNote, 'auto')   // snapshot the outgoing note
      // Save current scroll so back-navigation can restore it
      setNoteHistory(prev => [{ note: activeNote, scrollTop: lastScrollTopRef.current }, ...prev.slice(0, 19)])
      // Reset scroll for the new note
      lastScrollTopRef.current = 0
      setRestoredScrollTop(0)
    }
    // Baseline the snapshot tracker to the newly-opened content (don't snapshot on open).
    lastSnapshotContentRef.current = note.content
    setActiveNote(note)
  }

  function goBackNote() {
    if (noteHistory.length === 0) return
    const { note: prev, scrollTop } = noteHistory[0]
    setNoteHistory(h => h.slice(1))
    setActiveNote(prev)
    // Restore the scroll position the user was at in the previous note
    lastScrollTopRef.current = scrollTop
    setRestoredScrollTop(scrollTop)
  }

  function openNoteInNewTab(note: Note) {
    const tab: Tab = {
      id: `note-${note.id}-${Date.now()}`,
      spaceId: 'notes',
      type: 'note',
      title: note.title || 'Untitled',
      state: { noteId: note.id, isNew: false },
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
      window.notes.updateNote(id, { content }).catch(() => {})
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)))
      maybeSyncNote(id)
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
      window.notes.updateNote(activeNote.id, { title }).catch(() => {})
      setNotes((prev) => prev.map((n) => (n.id === activeNote.id ? updated : n)))
    }, 500)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      editorFocusRef.current?.()
    }
  }

  function handleWikilinkClick(title: string) {
    const note = notes.find(n => (n.title || 'Untitled').toLowerCase() === title.toLowerCase())
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
  }

  const editing = activeNote !== null

  const visibleNotes = useMemo(() => {
    let filtered = [...notes]
    // Text search
    if (noteSearch.trim()) {
      const q = noteSearch.toLowerCase()
      filtered = filtered.filter(n =>
        n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q)
      )
    }
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
    // Sort
    if (noteSort === 'modified') filtered.sort((a, b) => b.updatedAt - a.updatedAt)
    else if (noteSort === 'created') filtered.sort((a, b) => b.createdAt - a.createdAt)
    else if (noteSort === 'name') filtered.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'))
    return filtered
  }, [notes, noteSearch, noteFilter, noteSort])

  return (
    <div
      ref={notesContentRef}
      className="flex flex-col h-full bg-[rgb(var(--color-surface-3))] relative"
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
      <div className={`flex items-center gap-2 py-2 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 min-h-[40px] ${floating ? 'pl-[76px] pr-4 app-drag-region' : 'px-4 app-drag-region'}`}>
        {editing ? (
          <>
            {noteHistory.length === 0 ? (
              <button
                onClick={goBack}
                className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                title="Back to notes list"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <>
                <button
                  onClick={goBack}
                  className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
                  title="Back to notes list"
                >
                  <Home size={14} />
                </button>
                <button
                  onClick={goBackNote}
                  className="flex items-center gap-1 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] rounded px-1.5 py-0.5 cursor-pointer transition-colors flex-shrink-0 max-w-[120px]"
                  title={`Back to "${noteHistory[0].note.title || 'Untitled'}"`}
                >
                  <ArrowLeft size={12} className="flex-shrink-0" />
                  <span className="truncate">{noteHistory[0].note.title || 'Untitled'}</span>
                </button>
              </>
            )}
            {isSystemNote(activeNote) ? (
              /* System notes (daily, verse, esword, biblegateway) — title is read-only */
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {activeNote.verseRef && parseVerseRef(activeNote.verseRef) ? (
                  <button
                    onClick={() => openVerseFromNote(activeNote.verseRef!)}
                    title="Open scripture reference"
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left group"
                  >
                    <span className="flex-1 text-sm font-medium truncate text-[rgb(var(--color-text-primary))] group-hover:text-[rgb(var(--color-accent))] transition-colors">
                      {activeNote.title || 'Untitled'}
                    </span>
                    <ExternalLink size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))] group-hover:text-[rgb(var(--color-accent))] transition-colors" />
                  </button>
                ) : (
                  <span className="flex-1 text-sm font-medium truncate text-[rgb(var(--color-text-primary))] opacity-75 select-none">
                    {activeNote.title || 'Untitled'}
                  </span>
                )}
              </div>
            ) : (
              <input
                ref={titleInputRef}
                value={activeNote.title ?? ''}
                onChange={(e) => handleTitleChange(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                placeholder="Untitled"
                className="flex-1 text-sm font-medium bg-transparent outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
              />
            )}
            {/* ── Editor mode segmented toggle ── */}
            <div
              className="flex items-center bg-[rgb(var(--color-surface-3))] rounded-md p-0.5 gap-px flex-shrink-0"
              title="Editor mode (⌘⇧M to cycle)"
            >
              {([
                ['raw',     Code2,   'Raw',     'Raw markdown — see syntax as-is'],
                ['wysiwyg', PenLine, 'Edit',    'Clean edit — syntax hidden while editing'],
                ['preview', Eye,     'View',    'Preview — rendered read-only output'],
              ] as const).map(([mode, Icon, label, tip]) => (
                <button
                  key={mode}
                  title={tip}
                  onClick={() => setEditorMode(mode)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer select-none ${
                    editorMode === mode
                      ? 'bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] shadow-sm'
                      : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
                  }`}
                >
                  <Icon size={11} strokeWidth={editorMode === mode ? 2.2 : 1.8} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <ZoomControls context="notes" compact />
            <HintTooltip label="Version history">
            <button
              onClick={() => { if (activeNote) setVersionHistoryOpen(true) }}
              className="p-1 rounded cursor-pointer transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
            >
              <History size={15} />
            </button>
            </HintTooltip>
            <button
              onClick={() => { if (activeNote) setPrintPreviewOpen(true) }}
              title="Print / export note (preview)"
              className="p-1 rounded cursor-pointer transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
            >
              <Printer size={15} />
            </button>
            <button
              onClick={() => { if (activeNote) setPrintPreviewOpen(true) }}
              title="Export note as PDF (preview)"
              className="p-1 rounded cursor-pointer transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
            >
              <FileDown size={15} />
            </button>
            <button
              onClick={openMarkdownReference}
              title="Markdown reference guide"
              className="p-1 rounded cursor-pointer transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
            >
              <HelpCircle size={15} />
            </button>
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
            <button
              onClick={() => {
                if (localFindOpen) {
                  closeFindBarLocal()
                } else {
                  setLocalFindOpen(true)
                  setLocalFindQuery('')
                  setFindMatchIdx(0)
                }
              }}
              title="Find in note (⌘F)"
              className={`p-1 rounded cursor-pointer transition-colors ${
                localFindOpen
                  ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                  : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'
              }`}
            >
              <ScanSearch size={14} />
            </button>
            {!floating && (
              <button
                onClick={() => openNoteAsScripture()}
                title="Open alongside scripture"
                className="p-1 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))] transition-colors"
              >
                <BookOpen size={15} />
              </button>
            )}
            <button
              onClick={() => deleteNote()}
              title="Delete note"
              className="p-1 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-red-500/15 hover:text-red-400 transition-colors"
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] flex-1">Notes</span>
            {/* Daily calendar + today shortcut — grouped together */}
            <div className="relative flex items-center gap-0.5">
              <button
                data-calendar-toggle="true"
                onClick={() => setCalendarOpen(v => !v)}
                title="Daily notes calendar"
                className={`p-1 rounded cursor-pointer transition-colors ${calendarOpen ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}
              >
                <Calendar size={15} />
              </button>
              <button
                onClick={() => openDailyNote(new Date())}
                title="Open today's daily note"
                className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer"
              >
                <CalendarDays size={15} />
              </button>
              {calendarOpen && (
                <CalendarWidget
                  date={calendarDate}
                  notes={notes}
                  onDateChange={setCalendarDate}
                  onSelectDate={openDailyNote}
                  onClose={() => setCalendarOpen(false)}
                />
              )}
            </div>
            {/* Folder view toggle */}
            <button
              onClick={toggleFolderView}
              title={folderView ? 'List view' : 'Folder view'}
              className={`p-1 rounded cursor-pointer transition-colors ${folderView ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}
            >
              <FolderTree size={15} />
            </button>
            {/* Expand all toggle — only meaningful in list view (folder view has no snippets) */}
            {!folderView && (
              <button
                onClick={() => setExpandAll(v => !v)}
                title={expandAll ? 'Collapse notes' : 'Expand all notes'}
                className={`p-1 rounded cursor-pointer transition-colors ${expandAll ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}
              >
                <AlignJustify size={15} />
              </button>
            )}
            {/* Select mode toggle */}
            <button
              onClick={() => { if (selectMode) { exitSelectMode() } else { setSelectMode(true) } }}
              title="Select notes"
              className={`p-1 rounded cursor-pointer transition-colors ${selectMode ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}
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
              className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <Plus size={16} />
            </button>
          </>
        )}
      </div>

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
              <FileText size={13} className="flex-shrink-0" /> New note
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => {
                setPlusMenu(null)
                if (!folderView) { setFolderView(true); window.settings?.set('notesFolderView', true).catch(() => {}) }
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
      <div className="flex-1 overflow-hidden flex flex-col">
        {editing ? (
          <div className="flex-1 overflow-hidden flex flex-row">
            <div className="flex-1 overflow-hidden flex flex-col min-w-0">
              <NoteEditor
                content={activeNote.content}
                onChange={handleContentChange}
                onFocusRef={(fn) => { editorFocusRef.current = fn }}
                onScrollPosition={(pos) => { lastScrollTopRef.current = pos }}
                onCursorPosition={(pos) => { lastCursorPosRef.current = pos }}
                initialScrollTop={restoredScrollTop}
                initialCursorPos={restoredCursorPos}
                autoFocus={autoFocusEditor}
                previewMode={previewMode}
                wysiwyg={wysiwygMode}
                notes={notes}
                onWikilinkClick={handleWikilinkClick}
                onVerseRefClick={handleVerseRefClick}
                noteId={activeNote.id}
                noteTitle={activeNote.title || 'Untitled'}
                findQuery={findBarVisible ? localFindQuery : ''}
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
            </div>
            <NoteSidePanel
              content={activeNote.content}
              noteTitle={activeNote.title || 'Untitled'}
              noteId={activeNote.id}
              allNotes={notes}
              onNoteClick={navigateToNote}
              folderPath={folderPathFor(activeNote, folders)}
            />
          </div>
        ) : (
          <>
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

            <div className="flex-1 overflow-y-auto" style={{ transform: 'translateZ(0)', contain: 'paint' }}>
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
                  onCreateFolder={handleCreateFolder}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onDeleteFolderDeep={handleDeleteFolderDeep}
                  onSetFolderParent={handleSetFolderParent}
                  onRenameNote={renameNoteCommit}
                  onOpenNewTab={openNoteInNewTab}
                  onOpenInFloatingTab={openNoteInFloatingTab}
                  onOpenInSession={openNoteInSession}
                  sessions={sessions}
                  selectMode={selectMode}
                  selectedNoteIds={selectedIds}
                  selectedFolderIds={selectedFolderIds}
                  onToggleSelectNote={toggleSelectNote}
                  onToggleSelectFolder={toggleSelectFolder}
                  searchQuery={noteSearch || undefined}
                />
              ) : (
                <NotesList
                  notes={visibleNotes}
                  onSelect={navigateToNote}
                  onDelete={(note) => deleteNote(note)}
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
                  sessions={sessions}
                />
              )}
            </div>
          </>
        )}
      </div>

      {printPreviewOpen && activeNote && (
        <PrintPreviewModal
          title={activeNote.title || 'Untitled'}
          content={activeNote.content}
          onClose={() => setPrintPreviewOpen(false)}
        />
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
    </div>
  )
}

// ── CalendarWidget ────────────────────────────────────────────────────────────
interface CalendarWidgetProps {
  date: Date
  notes: Note[]
  onDateChange: (d: Date) => void
  onSelectDate: (d: Date) => void
  onClose: () => void
}

function CalendarWidget({ date, notes, onDateChange, onSelectDate, onClose }: CalendarWidgetProps) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const today = new Date()
  const todayStr = toDateKey(today)

  // Days with daily notes — handle both new ISO format (Daily — 2024-01-01)
  // and old localised format (Daily — January 1, 2024 / Journal — ...)
  const dailyDates = new Set(
    notes
      .filter(n =>
        n.type === 'daily' || n.type === 'journal' ||
        (n.type === 'general' && !!(n.title?.startsWith('Daily — ') || n.title?.startsWith('Journal — ')))
      )
      .map(n => {
        const raw = n.title ?? ''
        const dateStr = raw.replace(/^(Daily|Journal) — /, '')
        // New format: already ISO yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
        // Old locale format: try to parse
        try {
          const d = new Date(dateStr)
          if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          }
        } catch { /* ignore */ }
        return ''
      })
      .filter(Boolean)
  )

  // First day of month and number of days
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() {
    onDateChange(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    onDateChange(new Date(year, month + 1, 1))
  }

  const monthLabel = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  // Close on outside click — skip if the click was on the calendar toggle button itself
  // (the button carries data-calendar-toggle so we don't fight its own toggle handler)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-calendar-toggle]')) return
      if (ref.current && !ref.current.contains(target)) onClose()
    }
    window.addEventListener('mousedown', handle, true)
    return () => window.removeEventListener('mousedown', handle, true)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl p-3 w-64"
    >
      {/* Month navigation */}
      <div className="flex items-center gap-2 mb-2">
        <button onClick={prevMonth} className="p-0.5 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer">
          <ChevronLeft size={14} />
        </button>
        <span className="flex-1 text-center text-xs font-medium text-[rgb(var(--color-text-primary))]">{monthLabel}</span>
        <button onClick={nextMonth} className="p-0.5 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer">
          <ChevronRight size={14} />
        </button>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-[9px] text-[rgb(var(--color-text-muted))] font-medium py-0.5">{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateKey === todayStr
          const hasNote = dailyDates.has(dateKey)
          return (
            <button
              key={day}
              onClick={() => onSelectDate(new Date(year, month, day))}
              className={`relative text-center text-[11px] rounded py-0.5 cursor-pointer transition-colors
                ${isToday ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))] font-semibold' : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'}`}
            >
              {day}
              {hasNote && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[rgb(var(--color-accent))]" />
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-2 pt-2 border-t border-[rgb(var(--color-surface-4))]">
        <button
          onClick={() => onSelectDate(today)}
          className="w-full text-xs text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/10] rounded py-1 cursor-pointer transition-colors"
        >
          Today
        </button>
      </div>
    </div>
  )
}
