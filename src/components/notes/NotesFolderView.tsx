import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import {
  Folder, FolderOpen, FolderPlus, FilePlus, ChevronRight, FileText, NotepadText, Trash2,
  Pencil, Lock, CalendarDays, BookOpen, Download as DownloadIcon,
  BookMarked, CheckSquare, Square, FolderInput, FileType2, FolderTree,
  RotateCcw, AlertTriangle,
} from 'lucide-react'
import type { Note, NoteFolder, NoteStatus, PdfDoc } from '@/types'
import NoteContextMenu, { orderedFolders, type SessionInfo } from './NoteContextMenu'
import { contentSnippets } from './NotesList'
import { applyFindHighlight } from '@/lib/highlight'
import { useAppStore } from '@/store'
import { bookName, bookOrder } from '@/lib/parseRef'
import { noteStatusMeta } from '@/lib/noteStatus'
import FloatingHoverPanel, { type FloatingHoverPanelHandle } from '@/components/shell/FloatingHoverPanel'

// ── System (virtual) folders ─────────────────────────────────────────────────
// Notes belong to a system folder by their type/tags. A note that has been moved
// into a user folder (folderId set) leaves its system folder. System-folder notes
// cannot be moved.
type SystemKey = 'daily' | 'esword' | 'biblegateway' | 'verse'

export function systemFolderOf(note: Note): SystemKey | null {
  if (note.tags?.includes('biblegateway')) return 'biblegateway'
  if (note.tags?.includes('esword')) return 'esword'
  if (note.type === 'daily' || note.type === 'journal' ||
      note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — ')) return 'daily'
  if (note.verseRef || note.type === 'verse') return 'verse'
  return null
}

// A note can be filed into / out of user folders only if it isn't owned by a
// system folder (daily, e-Sword, BibleGateway, verse notes).
export function noteIsMovable(note: Note): boolean {
  return systemFolderOf(note) === null
}

// "Deleted 3 days ago" / "Deleted today" style label for the Trash list — also implicitly
// communicates how much of the 30-day auto-purge window is left without a separate countdown.
function deletedAgoLabel(deletedAt: number | undefined): string {
  if (!deletedAt) return ''
  const days = Math.floor((Date.now() - deletedAt) / 86_400_000)
  if (days <= 0) return 'Deleted today'
  if (days === 1) return 'Deleted yesterday'
  return `Deleted ${days} days ago`
}

const SYSTEM_FOLDERS: { key: SystemKey; label: string; icon: typeof CalendarDays }[] = [
  { key: 'daily',        label: 'Daily Notes',  icon: CalendarDays },
  { key: 'verse',        label: 'Verse Notes',  icon: BookMarked },
  { key: 'esword',       label: 'e-Sword',      icon: DownloadIcon },
  { key: 'biblegateway', label: 'BibleGateway', icon: BookOpen },
]

interface Props {
  notes: Note[]
  folders: NoteFolder[]
  activeNoteId?: string | null
  onSelect: (note: Note) => void
  /** Single-click behaviour when the home preview panel is showing — preview instead of
   *  opening the editor. Double-click still calls onSelect (open). */
  onPreview?: (note: Note) => void
  /** Selecting a folder row surfaces its context in the home panel (alongside expand/collapse). */
  onFolderSelect?: (folderId: string) => void
  onDelete: (note: Note) => void
  onSetNoteFolder: (noteId: string, folderId: string | null) => void
  onCreateNote?: () => void
  onCreateNoteInFolder?: (folderId: string) => void
  onCreateIdiom?: () => void
  onCreateIdiomInFolder?: (folderId: string) => void
  onCreateFolder: (parentId: string | null) => void
  /** Id of a just-created folder that should immediately open its rename input, auto-focused
   *  and selected — set by the parent right after createFolder resolves, cleared via
   *  onAutoRenameHandled once consumed here. */
  autoRenameFolderId?: string | null
  onAutoRenameHandled?: () => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onDeleteFolderDeep: (id: string) => void
  onSetFolderParent: (id: string, parentId: string | null) => void
  // Note actions — parity with list-view context menu
  onRenameNote?: (id: string, title: string) => void
  onOpenNewTab?: (note: Note) => void
  onOpenInFloatingTab?: (note: Note) => void
  onOpenInSession?: (note: Note, sessionId: string) => void
  onExportPdf?: (note: Note) => void
  onSetStatus?: (note: Note, status: NoteStatus | null) => void
  sessions?: SessionInfo[]
  // Select mode
  selectMode?: boolean
  selectedNoteIds?: string[]
  selectedFolderIds?: string[]
  onToggleSelectNote?: (id: string) => void
  onToggleSelectFolder?: (id: string) => void
  searchQuery?: string
}

const MENU_ITEM = `w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left
  text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]
  hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer`

export default function NotesFolderView({
  notes, folders, activeNoteId,
  onSelect, onPreview, onFolderSelect, onDelete, onSetNoteFolder,
  onCreateNote, onCreateNoteInFolder, onCreateIdiom, onCreateIdiomInFolder, onCreateFolder, autoRenameFolderId, onAutoRenameHandled, onRenameFolder, onDeleteFolder, onDeleteFolderDeep, onSetFolderParent,
  onRenameNote, onOpenNewTab, onOpenInFloatingTab, onOpenInSession, onExportPdf, onSetStatus, sessions,
  selectMode = false, selectedNoteIds = [], selectedFolderIds = [],
  onToggleSelectNote, onToggleSelectFolder,
  searchQuery,
}: Props) {
  const EXPAND_KEY = 'berean:folderViewExpanded2'
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(EXPAND_KEY)
      if (saved) {
        const arr = JSON.parse(saved) as string[]
        return new Set(arr)
      }
    } catch { /* ignore */ }
    // First launch: all collapsed
    return new Set<string>()
  })
  // Always-current ref so useEffect closures don't capture stale expanded
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  // Snapshot of expanded state before search started — restored when search clears
  const preSearchExpandedRef = useRef<Set<string> | null>(null)

  // Every folder that contains a matching note, plus all its ancestors up to root —
  // used both to auto-expand (below) and to HIDE folders with zero matches while a
  // search is active (renderUserFolder's two call sites) so an empty folder row
  // doesn't sit there looking like "nothing matched here" when really the whole
  // folder just isn't relevant to the search. Empty (irrelevant) when no search is
  // active — callers must check `searchQuery` themselves before using this to hide
  // anything, same as this already only DRIVES auto-expand under that condition.
  const foldersWithMatches = useMemo(() => {
    const folderMap = new Map(folders.map(f => [f.id, f]))
    const result = new Set<string>()
    function addAncestors(folderId: string) {
      if (result.has(folderId)) return
      const folder = folderMap.get(folderId)
      if (!folder) return
      result.add(folderId)
      if (folder.parentId) addAncestors(folder.parentId)
    }
    for (const note of notes) {
      if (note.folderId) addAncestors(note.folderId)
    }
    return result
  }, [notes, folders])

  // Which locked/system folders (Daily Notes, Verse Notes, e-Sword, BibleGateway) have at
  // least one matching note during a search. Shared by the auto-expand effect below AND the
  // jump rail (which lists every folder — user or system — worth jumping to).
  const matchedSystemKeys = useMemo(
    () => new Set(notes.map(systemFolderOf).filter((k): k is SystemKey => k !== null)),
    [notes]
  )

  useEffect(() => {
    if (!searchQuery) {
      // Search cleared — restore pre-search expansion state
      if (preSearchExpandedRef.current !== null) {
        const saved = preSearchExpandedRef.current
        preSearchExpandedRef.current = null
        setExpanded(saved)
        try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...saved])) } catch { /* ignore */ }
      }
      return
    }
    // Entering or updating search — save state only on first keystroke
    if (preSearchExpandedRef.current === null) {
      preSearchExpandedRef.current = new Set(expandedRef.current)
    }
    // Auto-expand every user folder that contains a visible (matching) note, and all its ancestors,
    // PLUS any system (locked) folder — Daily Notes, Verse Notes, e-Sword, BibleGateway — that has
    // a matching note. Those notes were always included in the search results (the backend query
    // doesn't filter by type), but sat invisible inside a collapsed locked folder that nothing here
    // used to auto-open, so a match there looked like "search doesn't search locked folders."
    const systemKeysWithMatches = SYSTEM_FOLDERS.filter(({ key }) => matchedSystemKeys.has(key)).map(({ key }) => key)
    // System folders render matches inside their own nested virtual subfolders (Daily Notes:
    // Year → Month; Verse/e-Sword/BibleGateway: Book → Chapter) — expanding just the top-level
    // system-folder row wasn't enough, the matching note still sat inside a collapsed year/month
    // or book/chapter row one level deeper. Mirrors the same id scheme renderDailyContent /
    // renderSystemContent use ("sys:daily:{year}" / "sys:daily:{year}-{month}" and
    // "sys:{key}:{bookId}" / "sys:{key}:{bookId}:{chapter}") so `expanded.has(...)` matches.
    const nestedSystemIds = new Set<string>()
    for (const note of notes) {
      const sys = systemFolderOf(note)
      if (sys === 'daily') {
        const m = (note.title ?? '').match(/(\d{4})-(\d{2})-(\d{2})/)
        if (m) {
          nestedSystemIds.add(`sys:daily:${m[1]}`)
          nestedSystemIds.add(`sys:daily:${m[1]}-${m[2]}`)
        }
      } else if (sys === 'verse' || sys === 'esword' || sys === 'biblegateway') {
        const parts = (note.verseRef ?? '').split('.')
        const bookId = parts[0]
        const ch = parts[1] ? parseInt(parts[1]) : NaN
        if (bookId && !isNaN(ch)) {
          nestedSystemIds.add(`sys:${sys}:${bookId}`)
          nestedSystemIds.add(`sys:${sys}:${bookId}:${ch}`)
        }
      }
    }
    if (foldersWithMatches.size > 0 || systemKeysWithMatches.length > 0 || nestedSystemIds.size > 0) {
      setExpanded(prev => {
        let changed = false
        const next = new Set(prev)
        for (const id of foldersWithMatches) { if (!next.has(id)) { next.add(id); changed = true } }
        for (const key of systemKeysWithMatches) { if (!next.has(key)) { next.add(key); changed = true } }
        for (const id of nestedSystemIds) { if (!next.has(id)) { next.add(id); changed = true } }
        return changed ? next : prev
      })
    }
  }, [searchQuery, notes, folders]) // eslint-disable-line react-hooks/exhaustive-deps

  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // Track what's being dragged so we can show "→ FolderName" on the note row
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)
  const draggingNoteRef = useRef<Note | null>(null)
  // Row DOM refs for the search jump rail below — keyed by folder id (user folders) or
  // the SystemKey string (locked folders), scrollIntoView'd when a rail entry is clicked.
  const folderRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [jumpRailSearch, setJumpRailSearch] = useState('')
  const jumpRailSearchRef = useRef<HTMLInputElement>(null)
  const jumpRailPanelRef = useRef<FloatingHoverPanelHandle>(null)
  // Imported PDFs (locked folder) — feature is off by default (Settings → Experimental)
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
  const [pdfs, setPdfs] = useState<PdfDoc[]>([])
  const openPdf = useAppStore((s) => s.openPdf)
  useEffect(() => {
    if (!pdfFeatureEnabled) return
    window.pdf?.list?.().then(setPdfs).catch(() => {})
    function onChange() { window.pdf?.list?.().then(setPdfs).catch(() => {}) }
    window.addEventListener('berean:pdfsChanged', onChange)
    return () => window.removeEventListener('berean:pdfsChanged', onChange)
  }, [pdfFeatureEnabled])
  // Trash (locked folder, same self-fetching shape as the PDFs section above) — refetches on
  // the same noteChangeToken bump every other note mutation in the app already relies on
  // (App.tsx's window.notes.onChanged listener), so a delete/restore/purge from anywhere shows
  // up here without any new plumbing.
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const [trashedNotes, setTrashedNotes] = useState<Note[]>([])
  useEffect(() => {
    window.notes.listTrash().then(setTrashedNotes).catch(() => {})
  }, [noteChangeToken])
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const [trashMenu, setTrashMenu] = useState<{ x: number; y: number } | null>(null)
  const trashMenuRef = useRef<HTMLDivElement>(null)

  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)
  // Inline note rename
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [noteRenameVal, setNoteRenameVal] = useState('')
  const noteRenameRef = useRef<HTMLInputElement>(null)
  // Note hover-move submenu (inline, not a full context menu)
  const [noteMoveMenu, setNoteMoveMenu] = useState<{ noteId: string } | null>(null)
  // Context menus
  const [noteMenu, setNoteMenu] = useState<{ note: Note; x: number; y: number } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: NoteFolder; x: number; y: number } | null>(null)
  const folderMenuRef = useRef<HTMLDivElement>(null)
  const [folderMoveOpen, setFolderMoveOpen] = useState(false)
  // Confirm dialog for "Delete folder & contents" (with "Don't ask again")
  const SKIP_CONFIRM_KEY = 'berean:skipFolderDeleteConfirm'
  const [confirmDelete, setConfirmDelete] = useState<{ folder: NoteFolder } | null>(null)
  const [skipConfirmChecked, setSkipConfirmChecked] = useState(false)
  // Empty-space right-click context menu
  const [emptyMenu, setEmptyMenu] = useState<{ x: number; y: number } | null>(null)
  const emptyMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (renamingId) { renameRef.current?.focus(); renameRef.current?.select() } }, [renamingId])
  useEffect(() => { if (renamingNoteId) { noteRenameRef.current?.focus(); noteRenameRef.current?.select() } }, [renamingNoteId])

  // Opens the rename input automatically right after a folder is created (see the pencil
  // button below for the manual equivalent this reuses verbatim: setRenameVal + setRenamingId,
  // which the auto-focus effect right above already reacts to). Also expands every ancestor of
  // the new folder — a subfolder created inside a currently-collapsed parent wouldn't render a
  // row at all otherwise, so the rename input would have nothing to attach to.
  useEffect(() => {
    if (!autoRenameFolderId) return
    const folder = folders.find((f) => f.id === autoRenameFolderId)
    if (!folder) return // parent hasn't re-rendered with the new folder yet — effect re-fires once it has
    setExpanded((prev) => {
      const next = new Set(prev)
      let cur: NoteFolder | undefined = folder
      while (cur?.parentId) {
        next.add(cur.parentId)
        cur = folders.find((f) => f.id === cur!.parentId)
      }
      return next
    })
    setRenameVal(folder.name)
    setRenamingId(folder.id)
    onAutoRenameHandled?.()
  }, [autoRenameFolderId, folders, onAutoRenameHandled])

  // Close inline move menu on outside click
  useEffect(() => {
    if (!noteMoveMenu) return
    function onDown(e: MouseEvent) {
      // Close if click is outside any element with our data marker
      const target = e.target as HTMLElement
      if (!target.closest('[data-note-move-menu]')) setNoteMoveMenu(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [noteMoveMenu])

  // Close all menus when floating search opens
  useEffect(() => {
    function onClose() { setNoteMenu(null); setFolderMenu(null); setFolderMoveOpen(false); setNoteMoveMenu(null); setEmptyMenu(null) }
    window.addEventListener('berean:closeContextMenus', onClose)
    return () => window.removeEventListener('berean:closeContextMenus', onClose)
  }, [])

  // Trash context-menu dismissal
  useEffect(() => {
    if (!trashMenu) return
    function onClick(e: MouseEvent) {
      if (trashMenuRef.current && !trashMenuRef.current.contains(e.target as Node)) setTrashMenu(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setTrashMenu(null) }
    window.addEventListener('mousedown', onClick, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onClick, true); window.removeEventListener('keydown', onKey) }
  }, [trashMenu])

  // Folder context-menu dismissal
  useEffect(() => {
    if (!folderMenu) return
    function onClick(e: MouseEvent) {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) { setFolderMenu(null); setFolderMoveOpen(false) }
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setFolderMenu(null); setFolderMoveOpen(false) } }
    window.addEventListener('mousedown', onClick, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onClick, true); window.removeEventListener('keydown', onKey) }
  }, [folderMenu])

  // Dismiss empty-space menu on outside click or Escape
  useEffect(() => {
    if (!emptyMenu) return
    function onClick(e: MouseEvent) {
      if (emptyMenuRef.current && !emptyMenuRef.current.contains(e.target as Node)) setEmptyMenu(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setEmptyMenu(null) }
    window.addEventListener('mousedown', onClick, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onClick, true); window.removeEventListener('keydown', onKey) }
  }, [emptyMenu])

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    // Don't persist to localStorage during search mode — we're restoring from preSearchExpandedRef
    if (!preSearchExpandedRef.current) {
      try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    }
    return next
  })

  // Index notes by user folder + system folder + root
  const { byUserFolder, bySystem, rootNotes } = useMemo(() => {
    const byUserFolder = new Map<string, Note[]>()
    const bySystem: Record<SystemKey, Note[]> = { daily: [], esword: [], biblegateway: [], verse: [] }
    const rootNotes: Note[] = []
    const folderIds = new Set(folders.map((f) => f.id))
    for (const note of notes) {
      if (note.folderId && folderIds.has(note.folderId)) {
        const arr = byUserFolder.get(note.folderId) ?? []
        arr.push(note); byUserFolder.set(note.folderId, arr)
        continue
      }
      const sys = systemFolderOf(note)
      if (sys) { bySystem[sys].push(note); continue }
      rootNotes.push(note)
    }
    return { byUserFolder, bySystem, rootNotes }
  }, [notes, folders])

  // Book/chapter sub-grouping for verse / esword / biblegateway system folders.
  // Notes without a parseable verseRef go into withoutRef and render flat above the book groups.
  const systemSubGroups = useMemo(() => {
    const keys: SystemKey[] = ['verse', 'esword', 'biblegateway']
    const result = {} as Record<SystemKey, {
      withoutRef: Note[]
      sortedBooks: [string, [number, Note[]][]][]
    }>
    for (const key of keys) {
      const withoutRef: Note[] = []
      const byBook = new Map<string, Map<number, Note[]>>()
      for (const n of bySystem[key]) {
        const parts = (n.verseRef ?? '').split('.')
        const bookId = parts[0]
        const ch = parts[1] ? parseInt(parts[1]) : NaN
        if (bookId && !isNaN(ch)) {
          if (!byBook.has(bookId)) byBook.set(bookId, new Map())
          const byChapter = byBook.get(bookId)!
          if (!byChapter.has(ch)) byChapter.set(ch, [])
          byChapter.get(ch)!.push(n)
        } else {
          withoutRef.push(n)
        }
      }
      // Sort once here (book order, then chapter number) instead of on every
      // renderSystemContent() call — this Map only changes when `bySystem` does.
      const sortedBooks: [string, [number, Note[]][]][] = [...byBook.entries()]
        .sort(([aId], [bId]) => bookOrder(aId) - bookOrder(bId))
        .map(([bid, chapters]) => [bid, [...chapters.entries()].sort(([a], [b]) => a - b)])
      result[key] = { withoutRef, sortedBooks }
    }
    return result
  }, [bySystem])

  // Daily/journal notes grouped into Year → Month virtual subfolders (newest first).
  // Date comes from a YYYY-MM-DD in the title, else the note's createdAt.
  const dailySubGroups = useMemo(() => {
    const dateOf = (n: Note): Date | null => {
      const m = (n.title ?? '').match(/(\d{4})-(\d{2})-(\d{2})/)
      if (m) return new Date(+m[1], +m[2] - 1, +m[3])
      if (n.createdAt) return new Date(n.createdAt)
      return null
    }
    const withoutDate: Note[] = []
    // byYear: year("2026") → month("2026-06") → notes
    const byYear = new Map<string, Map<string, Note[]>>()
    for (const n of bySystem.daily) {
      const d = dateOf(n)
      if (!d || isNaN(d.getTime())) { withoutDate.push(n); continue }
      const year = String(d.getFullYear())
      const monthKey = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!byYear.has(year)) byYear.set(year, new Map())
      const months = byYear.get(year)!
      if (!months.has(monthKey)) months.set(monthKey, [])
      months.get(monthKey)!.push(n)
    }
    // Sort once here (newest year/month/note first) instead of on every
    // renderDailyContent() call — this Map only changes when `bySystem` does.
    const sortedYears: [string, [string, Note[]][]][] = [...byYear.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, months]) => [
        year,
        [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([monthKey, mNotes]) => [
            monthKey,
            [...mNotes].sort((a, b) => (b.title ?? '').localeCompare(a.title ?? '') || (b.createdAt ?? 0) - (a.createdAt ?? 0)),
          ] as [string, Note[]]),
      ])
    return { withoutDate, sortedYears }
  }, [bySystem])

  // Grouped once per `folders` change instead of re-filtering the full array on
  // every recursive call — this is called once per rendered folder, so on a
  // deep/wide tree the naive filter() was effectively O(n^2).
  const childFoldersByParent = useMemo(() => {
    const map = new Map<string | null, NoteFolder[]>()
    for (const f of folders) {
      const key = f.parentId ?? null
      const arr = map.get(key)
      if (arr) arr.push(f)
      else map.set(key, [f])
    }
    return map
  }, [folders])
  const childFolders = (parentId: string | null) => childFoldersByParent.get(parentId) ?? []

  // Descendant folder ids (for hiding invalid move targets)
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>([id])
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()!
      for (const f of folders) if (f.parentId === cur && !out.has(f.id)) { out.add(f.id); stack.push(f.id) }
    }
    return out
  }

  // ── Drag/drop ────────────────────────────────────────────────────────────────
  function onNoteDragStart(e: React.DragEvent, note: Note) {
    if (!noteIsMovable(note)) { e.preventDefault(); return }
    e.dataTransfer.setData('berean-note-id', note.id)
    e.dataTransfer.setData('berean-note-title', note.title || 'Untitled')
    e.dataTransfer.effectAllowed = 'copyMove'
    // Defer the state update — if we setState synchronously during dragstart,
    // React re-renders and inserts the indicator div before the dragged element,
    // shifting it in the DOM. The browser sees its drag target move and
    // immediately fires dragend, cancelling the gesture.
    draggingNoteRef.current = note
    setTimeout(() => setDraggingNoteId(note.id), 0)
  }
  function onNoteDragEnd(e: React.DragEvent) {
    const note = draggingNoteRef.current
    draggingNoteRef.current = null
    setDraggingNoteId(null)
    setDragOverId(null)
    if (!note) return
    const inside = e.clientX > 0 && e.clientX < window.innerWidth &&
                   e.clientY > 0 && e.clientY < window.innerHeight
    if (!inside) {
      window.app.openFloatingTab('notes', { noteId: note.id }).catch?.(() => {})
    }
  }
  function onFolderDragStart(e: React.DragEvent, folderId: string) {
    e.dataTransfer.setData('berean-folder-id', folderId)
    e.dataTransfer.effectAllowed = 'move'
    setTimeout(() => setDraggingFolderId(folderId), 0)
  }
  function onFolderDragEnd() {
    setDraggingFolderId(null)
    setDragOverId(null)
  }
  // Shared drop handler — mirrored by both folder rows and note rows.
  // targetFolderId: the folder to drop into (null = root / unfiled).
  function onDropTo(e: React.DragEvent, targetFolderId: string | null) {
    e.preventDefault(); e.stopPropagation()
    setDragOverId(null)
    setDraggingNoteId(null)
    const noteId  = e.dataTransfer.getData('berean-note-id')
    if (noteId) {
      const note = notes.find((n) => n.id === noteId)
      const currentFolderId = note?.folderId ?? null
      if (currentFolderId !== targetFolderId) onSetNoteFolder(noteId, targetFolderId)
      return
    }
    const folderId = e.dataTransfer.getData('berean-folder-id')
    if (folderId) {
      const folder = folders.find((f) => f.id === folderId)
      const currentParent = folder?.parentId ?? null
      if (folderId !== targetFolderId && currentParent !== targetFolderId) onSetFolderParent(folderId, targetFolderId)
    }
  }

  function commitNoteRename(note: Note) {
    onRenameNote?.(note.id, noteRenameVal.trim() || 'Untitled')
    setRenamingNoteId(null)
  }

  const renderNote = (note: Note, depth: number) => {
    const isRenaming = renamingNoteId === note.id
    const isSelected = selectedNoteIds.includes(note.id)
    const snippets = searchQuery ? contentSnippets(note.content, searchQuery, 2) : []
    const isDraggingThis = draggingNoteId === note.id
    const movable = noteIsMovable(note)
    const renameable = !systemFolderOf(note)   // daily, verse, esword, biblegateway notes cannot be renamed
    const isMoveMenuOpen = noteMoveMenu?.noteId === note.id
    return (
      <div
        key={note.id}
        // Note rows are first-class drop targets (mirrors folder row pattern).
        // Dropping on a note puts the dragged item in the same folder as that note.
        onDragOver={(e) => {
          e.preventDefault(); e.stopPropagation()
          const zoneId = note.folderId ?? '__root__'
          if (dragOverId !== zoneId) setDragOverId(zoneId)
        }}
        onDragLeave={(e) => {
          // Only clear if cursor is truly leaving this note's wrapper
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverId((c) => (c === (note.folderId ?? '__root__') ? null : c))
          }
        }}
        onDrop={(e) => onDropTo(e, note.folderId ?? null)}
      >
      <div
        data-note-row
        draggable={!isRenaming && !selectMode}
        onDragStart={(e) => onNoteDragStart(e, note)}
        onDragEnd={(e) => onNoteDragEnd(e)}
        onClick={() => { if (isRenaming || isMoveMenuOpen) return; selectMode ? onToggleSelectNote?.(note.id) : (onPreview ?? onSelect)(note) }}
        onDoubleClick={() => { if (!isRenaming && !isMoveMenuOpen && !selectMode) onSelect(note) }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (selectMode) return; setNoteMenu({ note, x: e.clientX, y: e.clientY }) }}
        style={{ paddingLeft: 12 + depth * 16 }}
        // Flat, no border — matches NotesList's row treatment (a bordered box around every
        // single row read as heavy/boxy and out of step with the rest of the app). Just a
        // soft hover tint and a slightly stronger accent tint for the active note.
        // Was hover:bg-surface-3 — but NotesPanel.tsx's own root container is ALSO
        // bg-surface-3, so hovering a note row painted the identical color already behind it:
        // zero contrast, invisible on every theme (not just one). Folder rows right above this
        // one already correctly use surface-4 for exactly this reason; matched here too.
        className={`group relative flex items-center gap-2 pr-2 py-1.5 mx-1.5 rounded-shell cursor-pointer transition-colors ${
          isDraggingThis ? 'opacity-40' :
          activeNoteId === note.id ? 'bg-[rgb(var(--color-accent))/8]' :
          'hover:bg-[rgb(var(--color-surface-4))]'
        }`}
      >
        {selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelectNote?.(note.id) }}
            className="flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer"
          >
            {isSelected ? <CheckSquare size={14} className="text-[rgb(var(--color-accent))]" /> : <Square size={14} />}
          </button>
        )}
        <NotepadText size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
        {isRenaming ? (
          <input
            ref={noteRenameRef}
            value={noteRenameVal}
            onChange={(e) => setNoteRenameVal(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNoteRename(note)
              if (e.key === 'Escape') setRenamingNoteId(null)
            }}
            onBlur={() => commitNoteRename(note)}
            className="flex-1 min-w-0 text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-accent))/50] rounded px-1 outline-none text-[rgb(var(--color-text-primary))]"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-primary))]">{note.title || 'Untitled'}</span>
        )}
        {/* Status indicator — same colored icon used in the list/board views, for a consistent
            at-a-glance status signal across every way of browsing notes. */}
        {!isRenaming && (() => {
          const status = noteStatusMeta(note.status)
          if (!status) return null
          const Icon = status.icon
          return <Icon size={11} className="flex-shrink-0" style={{ color: status.color }} />
        })()}
        {/* Hover action buttons — rename and move (not in select mode, not on system-folder notes) */}
        {!selectMode && !isRenaming && renameable && onRenameNote && (
          <button
            onClick={(e) => { e.stopPropagation(); setNoteRenameVal(note.title || ''); setRenamingNoteId(note.id) }}
            title="Rename"
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-opacity cursor-pointer"
          >
            <Pencil size={11} />
          </button>
        )}
        {!selectMode && !isRenaming && movable && (
          <div className="relative" data-note-move-menu>
            <button
              onClick={(e) => { e.stopPropagation(); setNoteMoveMenu(isMoveMenuOpen ? null : { noteId: note.id }) }}
              title="Move to folder"
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-opacity cursor-pointer"
            >
              <FolderInput size={11} />
            </button>
            {isMoveMenuOpen && (
              <div className="context-menu absolute right-0 top-full mt-0.5 z-50 min-w-[150px] max-h-48 overflow-y-auto rounded-shell-lg py-1">
                {note.folderId != null && (
                  <button
                    className={MENU_ITEM}
                    onClick={(e) => { e.stopPropagation(); onSetNoteFolder(note.id, null); setNoteMoveMenu(null) }}
                  >
                    Move out (no folder)
                  </button>
                )}
                {orderedFolders(folders).map(({ folder: f, depth: d }) => (
                  <button
                    key={f.id}
                    disabled={f.id === note.folderId}
                    className={`${MENU_ITEM} ${f.id === note.folderId ? 'opacity-40 cursor-default' : ''}`}
                    style={{ paddingLeft: 12 + d * 10 }}
                    onClick={(e) => { e.stopPropagation(); if (f.id !== note.folderId) { onSetNoteFolder(note.id, f.id); setNoteMoveMenu(null) } }}
                  >
                    {f.name}
                  </button>
                ))}
                {folders.length === 0 && (
                  <div className="px-3 py-1.5 text-[11px] text-[rgb(var(--color-text-muted))] italic">No folders yet</div>
                )}
              </div>
            )}
          </div>
        )}
        {!selectMode && !isRenaming && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(note) }}
            title="Delete note"
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-opacity cursor-pointer"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {/* In-folder search snippets — more compact than list view */}
      {snippets.length > 0 && (
        <div className="flex flex-col gap-0.5 pb-1" style={{ paddingLeft: 28 + depth * 16, paddingRight: 8 }}>
          {snippets.map((s, i) => (
            <div
              key={i}
              onClick={() => onSelect(note)}
              className="text-[10px] leading-snug text-[rgb(var(--color-text-secondary))] bg-[rgb(var(--color-surface-4))/40] rounded px-1.5 py-0.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] truncate"
            >
              {applyFindHighlight(s, searchQuery!)}
            </div>
          ))}
        </div>
      )}
      </div>
    )
  }

  const renderUserFolder = (folder: NoteFolder, depth: number) => {
    const isOpen = expanded.has(folder.id)
    const kids = childFolders(folder.id)
    const fNotes = byUserFolder.get(folder.id) ?? []
    const isRenaming = renamingId === folder.id
    const isSelected = selectedFolderIds.includes(folder.id)
    return (
      <div key={folder.id}>
        <div
          data-folder-row
          ref={(el) => { if (el) folderRowRefs.current.set(folder.id, el); else folderRowRefs.current.delete(folder.id) }}
          draggable={!isRenaming && !selectMode}
          onDragStart={(e) => onFolderDragStart(e, folder.id)}
          onDragEnd={onFolderDragEnd}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation() // ← prevent root-zone from overwriting dragOverId
            setDragOverId(folder.id)
          }}
          onDragLeave={(e) => {
            // Only clear when cursor genuinely leaves this folder header (not entering a child)
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverId((c) => (c === folder.id ? null : c))
            }
          }}
          onDrop={(e) => { e.stopPropagation(); onDropTo(e, folder.id) }}
          onClick={() => { if (selectMode) { onToggleSelectFolder?.(folder.id) } else { toggle(folder.id); onFolderSelect?.(folder.id) } }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (selectMode) return; setFolderMenu({ folder, x: e.clientX, y: e.clientY }); setFolderMoveOpen(false) }}
          style={{ paddingLeft: 8 + depth * 16 }}
          className={`group flex items-center gap-1.5 pr-2 py-1.5 mx-1.5 rounded-shell cursor-pointer transition-colors ${
            dragOverId === folder.id ? 'bg-[rgb(var(--color-accent))/20] ring-1 ring-inset ring-[rgb(var(--color-accent))]'
              : isSelected ? 'bg-[rgb(var(--color-accent))/10]' : 'hover:bg-[rgb(var(--color-surface-4))]'
          }`}
        >
          {selectMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelectFolder?.(folder.id) }}
              className="flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer"
            >
              {isSelected ? <CheckSquare size={14} className="text-[rgb(var(--color-accent))]" /> : <Square size={14} />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); toggle(folder.id) }}
            className="flex-shrink-0 cursor-pointer"
          >
            <ChevronRight size={12} className={`text-[rgb(var(--color-text-muted))] transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
          {isOpen ? <FolderOpen size={13} className="flex-shrink-0 text-[rgb(var(--color-accent))]" /> : <Folder size={13} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
          {isRenaming ? (
            <input
              ref={renameRef}
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRenameFolder(folder.id, renameVal.trim() || 'Folder'); setRenamingId(null) }
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => { onRenameFolder(folder.id, renameVal.trim() || 'Folder'); setRenamingId(null) }}
              className="flex-1 min-w-0 text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-accent))/50] rounded px-1 outline-none text-[rgb(var(--color-text-primary))]"
            />
          ) : (
            <span className="flex-1 min-w-0 truncate text-xs font-medium text-[rgb(var(--color-text-primary))]">{folder.name}</span>
          )}
          {/* "→ drop here" badge — shows for both note and folder drags */}
          {(draggingNoteId || draggingFolderId) && dragOverId === folder.id && !isRenaming && draggingFolderId !== folder.id ? (
            <span className="ml-auto text-[10px] font-medium text-[rgb(var(--color-accent))] animate-pulse flex-shrink-0">→ here</span>
          ) : (
            <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{fNotes.length || ''}</span>
          )}
          {!isRenaming && !selectMode && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onCreateFolder(folder.id) }} title="New subfolder"
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-opacity cursor-pointer"><FolderPlus size={11} /></button>
              <button onClick={(e) => { e.stopPropagation(); setRenameVal(folder.name); setRenamingId(folder.id) }} title="Rename"
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-opacity cursor-pointer"><Pencil size={11} /></button>
              <button onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id) }} title="Delete folder (notes move to root)"
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-opacity cursor-pointer"><Trash2 size={11} /></button>
            </>
          )}
        </div>
        {/* Was an instant show/hide with no transition at all — flagged in the notes-feel pass.
            AnimatePresence/motion (already a dependency, used throughout the app) handles the
            "animate to/from height:auto" problem CSS transitions can't do without a JS
            measurement step. Scoped to just this general user-folder tree (the most common
            case) for now, not the more specialized book/chapter/year/month/pdfs/trash sections
            below, which would need the same treatment as a follow-up. */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              {kids
                .filter((k) => !searchQuery || foldersWithMatches.has(k.id))
                .map((k) => renderUserFolder(k, depth + 1))}
              {fNotes.map((n) => renderNote(n, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  // Render the body of a system folder that uses book/chapter virtual sub-folders.
  // Virtual folder IDs: "sys:{key}:{bookId}" and "sys:{key}:{bookId}:{chapter}"
  const renderSystemContent = (key: SystemKey) => {
    const { withoutRef, sortedBooks } = systemSubGroups[key]
    return (
      <>
        {withoutRef.map((n) => renderNote(n, 1))}
        {sortedBooks.map(([bid, sortedChapters]) => {
          const bookFolderId = `sys:${key}:${bid}`
          const bookIsOpen = expanded.has(bookFolderId)
          const totalNotes = sortedChapters.reduce((sum, [, ns]) => sum + ns.length, 0)
          return (
            <div key={bookFolderId}>
              {/* Book virtual folder — depth=1, paddingLeft=8+1*16=24 */}
              <div
                onClick={() => toggle(bookFolderId)}
                style={{ paddingLeft: 24 }}
                className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
              >
                <ChevronRight size={11} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${bookIsOpen ? 'rotate-90' : ''}`} />
                {bookIsOpen
                  ? <FolderOpen size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  : <Folder    size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />}
                <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-secondary))]">{bookName(bid)}</span>
                <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{totalNotes || ''}</span>
              </div>
              {bookIsOpen && sortedChapters.map(([ch, chNotes]) => {
                const chFolderId = `sys:${key}:${bid}:${ch}`
                const chIsOpen = expanded.has(chFolderId)
                return (
                  <div key={chFolderId}>
                    {/* Chapter virtual folder — depth=2, paddingLeft=8+2*16=40 */}
                    <div
                      onClick={() => toggle(chFolderId)}
                      style={{ paddingLeft: 40 }}
                      className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
                    >
                      <ChevronRight size={11} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${chIsOpen ? 'rotate-90' : ''}`} />
                      {chIsOpen
                        ? <FolderOpen size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                        : <Folder    size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />}
                      <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-secondary))]">Chapter {ch}</span>
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{chNotes.length || ''}</span>
                    </div>
                    {/* Notes inside chapter — depth=3 → paddingLeft=12+3*16=60 */}
                    {chIsOpen && chNotes.map((n) => renderNote(n, 3))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </>
    )
  }

  // Render the Daily Notes body as Year → Month virtual subfolders (newest first).
  // Virtual folder IDs: "sys:daily:{year}" and "sys:daily:{year}-{month}".
  const renderDailyContent = () => {
    const { withoutDate, sortedYears } = dailySubGroups
    return (
      <>
        {withoutDate.map((n) => renderNote(n, 1))}
        {sortedYears.map(([year, sortedMonths]) => {
          const yearFolderId = `sys:daily:${year}`
          const yearIsOpen = expanded.has(yearFolderId)
          const totalNotes = sortedMonths.reduce((sum, [, ns]) => sum + ns.length, 0)
          return (
            <div key={yearFolderId}>
              {/* Year virtual folder — depth=1 */}
              <div
                onClick={() => toggle(yearFolderId)}
                style={{ paddingLeft: 24 }}
                className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
              >
                <ChevronRight size={11} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${yearIsOpen ? 'rotate-90' : ''}`} />
                {yearIsOpen
                  ? <FolderOpen size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  : <Folder    size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />}
                <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-secondary))]">{year}</span>
                <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{totalNotes || ''}</span>
              </div>
              {yearIsOpen && sortedMonths.map(([monthKey, mNotes]) => {
                const monthFolderId = `sys:daily:${monthKey}`
                const monthIsOpen = expanded.has(monthFolderId)
                const monthLabel = new Date(+monthKey.slice(0, 4), +monthKey.slice(5, 7) - 1, 1)
                  .toLocaleString('default', { month: 'long' })
                return (
                  <div key={monthFolderId}>
                    {/* Month virtual folder — depth=2 */}
                    <div
                      onClick={() => toggle(monthFolderId)}
                      style={{ paddingLeft: 40 }}
                      className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
                    >
                      <ChevronRight size={11} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${monthIsOpen ? 'rotate-90' : ''}`} />
                      {monthIsOpen
                        ? <FolderOpen size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                        : <Folder    size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />}
                      <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-secondary))]">{monthLabel}</span>
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{mNotes.length || ''}</span>
                    </div>
                    {/* Notes inside month — depth=3, newest first (pre-sorted in dailySubGroups) */}
                    {monthIsOpen && mNotes.map((n) => renderNote(n, 3))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </>
    )
  }

  // Folder move targets (exclude self + descendants)
  const folderMoveTargets = useMemo(() => {
    if (!folderMenu) return []
    const blocked = descendantsOf(folderMenu.folder.id)
    return orderedFolders(folders).filter(({ folder }) => !blocked.has(folder.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderMenu, folders])

  function handleEmptyContextMenu(e: React.MouseEvent) {
    // Only fire when clicking on the background, not on a note/folder row
    if ((e.target as HTMLElement).closest('[data-note-row],[data-folder-row]')) return
    e.preventDefault()
    setEmptyMenu({ x: e.clientX, y: e.clientY })
    setNoteMenu(null)
    setFolderMenu(null)
  }

  return (
    <div className="py-1 text-sm min-h-full flex flex-col" onContextMenu={handleEmptyContextMenu}>
      {/* System folders (locked) — entire section blocks context menu to prevent "New note" appearing.
          While searching, a folder with zero matching notes is hidden entirely rather than shown
          collapsed-and-empty (matches how user folders already behave during search). */}
      {SYSTEM_FOLDERS.filter(({ key }) => !searchQuery || bySystem[key].length > 0).map(({ key, label, icon: Icon }) => {
        const isOpen = expanded.has(key)
        const sysNotes = bySystem[key]
        const useSubFolders = key === 'verse' || key === 'esword' || key === 'biblegateway'
        return (
          <div key={key} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <div
              ref={(el) => { if (el) folderRowRefs.current.set(key, el); else folderRowRefs.current.delete(key) }}
              onClick={() => toggle(key)}
              className="group flex items-center gap-1.5 pl-2 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors"
            >
              <ChevronRight size={12} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <Icon size={13} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
              <span className="flex-1 min-w-0 truncate text-xs font-medium text-[rgb(var(--color-text-secondary))]">{label}</span>
              <Lock size={9} className="text-[rgb(var(--color-text-muted))] opacity-50" />
              <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{sysNotes.length || ''}</span>
            </div>
            {isOpen && (
              key === 'daily'
                ? renderDailyContent()
                : useSubFolders
                  ? renderSystemContent(key)
                  : sysNotes.map((n) => renderNote(n, 1))
            )}
          </div>
        )
      })}

      {/* PDFs (locked) — imported PDF documents; hidden unless the experimental feature is on */}
      {pdfFeatureEnabled && (
      <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
        <div
          onClick={() => toggle('pdfs')}
          className="group flex items-center gap-1.5 pl-2 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors"
        >
          <ChevronRight size={12} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${expanded.has('pdfs') ? 'rotate-90' : ''}`} />
          <FileType2 size={13} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
          <span className="flex-1 min-w-0 truncate text-xs font-medium text-[rgb(var(--color-text-secondary))]">PDFs</span>
          <Lock size={9} className="text-[rgb(var(--color-text-muted))] opacity-50" />
          <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{pdfs.length || ''}</span>
        </div>
        {expanded.has('pdfs') && (
          pdfs.length === 0
            ? <div className="pl-8 pr-2 py-1.5 text-[11px] text-[rgb(var(--color-text-muted))] italic">No PDFs imported</div>
            : pdfs.map((p) => (
                <div key={p.id}
                  onClick={() => openPdf(p.id, p.title)}
                  style={{ paddingLeft: 28 }}
                  className="group flex items-center gap-2 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors">
                  <FileText size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-primary))]">{p.title}</span>
                </div>
              ))
        )}
      </div>
      )}

      {/* Trash (locked) — soft-deleted notes. Restorable individually, or permanently cleared
          all at once via right-click "Empty Trash" (with a warning, no "don't ask again" skip
          given the stakes — see the confirm modal below). Auto-purges 30 days after each note's
          own deletion regardless of whether this UI is ever opened (electron/ipc/vault.ts's
          setupTrashPurge, a background timer, not something this component drives). */}
      <div onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (trashedNotes.length > 0) setTrashMenu({ x: e.clientX, y: e.clientY })
      }}>
        <div
          data-folder-row
          onClick={() => toggle('trash')}
          className="group flex items-center gap-1.5 pl-2 pr-2 py-1.5 cursor-pointer mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors"
        >
          <ChevronRight size={12} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${expanded.has('trash') ? 'rotate-90' : ''}`} />
          <Trash2 size={13} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
          <span className="flex-1 min-w-0 truncate text-xs font-medium text-[rgb(var(--color-text-secondary))]">Trash</span>
          <Lock size={9} className="text-[rgb(var(--color-text-muted))] opacity-50" />
          <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{trashedNotes.length || ''}</span>
        </div>
        {expanded.has('trash') && (
          trashedNotes.length === 0
            ? <div className="pl-8 pr-2 py-1.5 text-[11px] text-[rgb(var(--color-text-muted))] italic">Trash is empty</div>
            : trashedNotes.map((n) => (
                <div key={n.id}
                  style={{ paddingLeft: 28 }}
                  className="group flex items-center gap-2 pr-2 py-1.5 mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors">
                  <NotepadText size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs text-[rgb(var(--color-text-secondary))]">{n.title || 'Untitled'}</div>
                    <div className="text-[10px] text-[rgb(var(--color-text-muted))]">{deletedAgoLabel(n.deletedAt)}</div>
                  </div>
                  <button
                    title="Restore"
                    onClick={() => window.notes.restoreNote(n.id).then(() => useAppStore.getState().bumpNoteToken())}
                    className="flex-shrink-0 p-1 rounded hover:bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    title="Delete forever"
                    onClick={() => window.notes.purgeTrashItem(n.id).then(() => useAppStore.getState().bumpNoteToken())}
                    className="flex-shrink-0 p-1 rounded hover:bg-red-500/10 text-[rgb(var(--color-text-muted))] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
        )}
      </div>
      {/* "Empty Trash" — reached via right-click on the Trash row above, not a per-item menu */}
      {trashMenu && createPortal(
        <MenuPositioner ref={trashMenuRef} x={trashMenu.x} y={trashMenu.y}>
          <div className="glass-panel rounded-shell-lg py-1 min-w-[160px] shadow-xl">
            <button
              className={`${MENU_ITEM} text-red-400 hover:text-red-300 hover:bg-red-500/10`}
              onClick={() => { setTrashMenu(null); setConfirmEmptyTrash(true) }}
            >
              <Trash2 size={13} className="flex-shrink-0" /> Empty Trash
            </button>
          </div>
        </MenuPositioner>,
        document.body
      )}
      {confirmEmptyTrash && createPortal(
        <div className="native-buttons fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
          <div className="glass-panel rounded-shell-lg p-5 w-80 max-w-full">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">
                Empty Trash?
              </p>
            </div>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-4">
              This will permanently delete {trashedNotes.length} note{trashedNotes.length === 1 ? '' : 's'} in Trash.
              This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
                onClick={() => setConfirmEmptyTrash(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors cursor-pointer"
                onClick={() => {
                  window.notes.emptyTrash().then(() => useAppStore.getState().bumpNoteToken())
                  setConfirmEmptyTrash(false)
                }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Divider */}
      {/* Divider + New note/New folder row — hidden while searching, since neither
          action makes sense mid-search and the row was just clutter above the results. */}
      {!searchQuery && (
        <div className="my-1 h-px bg-[rgb(var(--color-surface-4))] mx-2" />
      )}

      {/* User folders + root notes — flex-1 so blank space below notes is also droppable */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOverId('__root__') }}
        onDragLeave={(e) => {
          // Only clear when leaving the zone entirely (not entering a child)
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverId((c) => (c === '__root__' ? null : c))
          }
        }}
        onDrop={(e) => onDropTo(e, null)}
        className={`flex-1 ${dragOverId === '__root__' ? 'bg-[rgb(var(--color-accent))/10]' : ''}`}
      >
        {!searchQuery && (
          <div className="flex items-center gap-1.5 pl-2 pr-2 py-1 min-h-[26px]">
            {(draggingNoteId || draggingFolderId) && dragOverId === '__root__' && (
              <span className="text-[10px] text-[rgb(var(--color-accent))] animate-pulse">→ top level (no folder)</span>
            )}
            <div className="flex items-center gap-1">
              {onCreateNote && (
                <button onClick={onCreateNote} title="New note"
                  className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-shell text-[11px] text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors">
                  <FilePlus size={13} className="flex-shrink-0" /> New Note
                </button>
              )}
              {onCreateNote && <div className="w-px h-3 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />}
              <button onClick={() => onCreateFolder(null)} title="New folder"
                className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-shell text-[11px] text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors">
                <FolderPlus size={13} className="flex-shrink-0" /> New Folder
              </button>
              {onCreateIdiom && (
                <>
                  <div className="w-px h-3 bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
                  <button onClick={onCreateIdiom} title="New idiom"
                    className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-shell text-[11px] text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors">
                    <BookOpen size={13} className="flex-shrink-0" /> New Idiom
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {childFolders(null)
          .filter((f) => !searchQuery || foldersWithMatches.has(f.id))
          .map((f) => renderUserFolder(f, 0))}
        {rootNotes.map((n) => renderNote(n, 0))}
      </div>

      {/* Empty-space right-click menu — create note or folder */}
      {emptyMenu && onCreateNote && createPortal(
        <MenuPositioner ref={emptyMenuRef} x={emptyMenu.x} y={emptyMenu.y}
          className="native-buttons context-menu min-w-[170px] rounded-shell-lg py-1 overflow-hidden"
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <button className={MENU_ITEM} onClick={() => { setEmptyMenu(null); onCreateNote() }}>
            <NotepadText size={13} className="flex-shrink-0" /> New note
          </button>
          {onCreateIdiom && (
            <button className={MENU_ITEM} onClick={() => { setEmptyMenu(null); onCreateIdiom() }}>
              <BookOpen size={13} className="flex-shrink-0" /> New idiom
            </button>
          )}
          <button className={MENU_ITEM} onClick={() => { setEmptyMenu(null); onCreateFolder(null) }}>
            <FolderPlus size={13} className="flex-shrink-0" /> New folder
          </button>
        </MenuPositioner>,
        document.body
      )}

      {/* Note context menu (parity with list view + move to folder) */}
      {noteMenu && (
        <NoteContextMenu
          note={noteMenu.note}
          x={noteMenu.x}
          y={noteMenu.y}
          onClose={() => setNoteMenu(null)}
          onSelect={onSelect}
          onOpenNewTab={onOpenNewTab}
          onOpenInFloatingTab={onOpenInFloatingTab}
          onRename={(onRenameNote && !systemFolderOf(noteMenu.note)) ? (note) => { setNoteRenameVal(note.title || ''); setRenamingNoteId(note.id) } : undefined}
          onDelete={onDelete}
          onOpenInSession={onOpenInSession}
          sessions={sessions}
          folders={folders}
          canMove={noteIsMovable(noteMenu.note)}
          currentFolderId={noteMenu.note.folderId ?? null}
          onMoveToFolder={(note, fid) => onSetNoteFolder(note.id, fid)}
          onExportPdf={onExportPdf}
          onSetStatus={onSetStatus}
        />
      )}

      {/* Folder context menu */}
      {folderMenu && createPortal(
        <MenuPositioner ref={folderMenuRef} x={folderMenu.x} y={folderMenu.y}
          className="native-buttons context-menu min-w-[190px] rounded-shell-lg py-1 overflow-hidden"
        >
              {onCreateNoteInFolder && (
                <button className={MENU_ITEM} onClick={() => { onCreateNoteInFolder(folderMenu.folder.id); setFolderMenu(null) }}>
                  <FilePlus size={13} className="flex-shrink-0" /> New note here
                </button>
              )}
              {onCreateIdiomInFolder && (
                <button className={MENU_ITEM} onClick={() => { onCreateIdiomInFolder(folderMenu.folder.id); setFolderMenu(null) }}>
                  <BookOpen size={13} className="flex-shrink-0" /> New idiom here
                </button>
              )}
              <button className={MENU_ITEM} onClick={() => { onCreateFolder(folderMenu.folder.id); setFolderMenu(null) }}>
                <FolderPlus size={13} className="flex-shrink-0" /> New subfolder
              </button>
              <button className={MENU_ITEM} onClick={() => { setRenameVal(folderMenu.folder.name); setRenamingId(folderMenu.folder.id); setFolderMenu(null) }}>
                <Pencil size={13} className="flex-shrink-0" /> Rename
              </button>
              <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
              <button className={`${MENU_ITEM} justify-between`} onClick={() => setFolderMoveOpen(v => !v)}>
                <span className="flex items-center gap-2.5"><FolderInput size={13} className="flex-shrink-0" /> Move into folder</span>
                <ChevronRight size={11} className={`transition-transform ${folderMoveOpen ? 'rotate-90' : ''}`} />
              </button>
              {folderMoveOpen && (
                <div className="border-t border-[rgb(var(--color-surface-4))] mt-1 pt-1 max-h-48 overflow-y-auto">
                  {folderMenu.folder.parentId != null && (
                    <button className={`${MENU_ITEM} pl-8`} onClick={() => { onSetFolderParent(folderMenu.folder.id, null); setFolderMenu(null) }}>
                      Move to top level
                    </button>
                  )}
                  {folderMoveTargets.map(({ folder, depth }) => (
                    <button
                      key={folder.id}
                      disabled={folder.id === folderMenu.folder.parentId}
                      className={`${MENU_ITEM} ${folder.id === folderMenu.folder.parentId ? 'opacity-40 cursor-default' : ''}`}
                      style={{ paddingLeft: 20 + depth * 12 }}
                      onClick={() => { if (folder.id !== folderMenu.folder.parentId) { onSetFolderParent(folderMenu.folder.id, folder.id); setFolderMenu(null) } }}
                    >
                      {folder.name}
                    </button>
                  ))}
                  {folderMoveTargets.length === 0 && (
                    <div className="px-3 py-1.5 text-[11px] text-[rgb(var(--color-text-muted))] italic">No other folders</div>
                  )}
                </div>
              )}
              <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
              <button
                className={`${MENU_ITEM} text-red-400 hover:text-red-300 hover:bg-red-500/10`}
                onClick={() => {
                  const f = folderMenu.folder
                  setFolderMenu(null)
                  if (localStorage.getItem(SKIP_CONFIRM_KEY) === 'true') {
                    onDeleteFolderDeep(f.id)
                  } else {
                    setSkipConfirmChecked(false)
                    setConfirmDelete({ folder: f })
                  }
                }}
              >
                <Trash2 size={13} className="flex-shrink-0" /> Delete folder & contents
              </button>
        </MenuPositioner>,
        document.body
      )}
      {/* Custom confirm dialog for "Delete folder & contents" */}
      {confirmDelete && createPortal(
        <div className="native-buttons fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
          <div className="glass-panel rounded-shell-lg p-5 w-80 max-w-full">
            <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))] mb-1">
              Delete &ldquo;{confirmDelete.folder.name}&rdquo;?
            </p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-4">
              This will permanently delete the folder and all notes inside it. This cannot be undone.
            </p>
            <button
              onClick={() => setSkipConfirmChecked((v) => !v)}
              className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-secondary))] mb-4 cursor-pointer select-none"
            >
              <span className={`relative flex-shrink-0 w-8 h-4 rounded-full transition-colors ${skipConfirmChecked ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}>
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${skipConfirmChecked ? 'translate-x-4' : ''}`} />
              </span>
              Don&rsquo;t ask again
            </button>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] mx-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors cursor-pointer"
                onClick={() => {
                  if (skipConfirmChecked) localStorage.setItem(SKIP_CONFIRM_KEY, 'true')
                  onDeleteFolderDeep(confirmDelete.folder.id)
                  setConfirmDelete(null)
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Jump-to-folder rail — same floating hover-expand widget as ScriptureSearchView's
          jump-to-book rail, listing every folder (user or locked/system) that has at least
          one matching note during a search, so a match buried several folders/notes down
          the list is one click away instead of requiring a manual scroll-and-hunt. Only
          shown once there's a search active and more than one folder actually worth
          jumping between (matches Scripture's own `> 1` gating). */}
      {searchQuery && (() => {
        const directMatchFolderIds = new Set(notes.map((n) => n.folderId).filter((id): id is string => !!id))
        const jumpFolders = folders.filter((f) => directMatchFolderIds.has(f.id))
        const jumpSystem = SYSTEM_FOLDERS.filter(({ key }) => matchedSystemKeys.has(key))
        const totalJumpTargets = jumpFolders.length + jumpSystem.length
        if (totalJumpTargets <= 1) return null
        const railQuery = jumpRailSearch.trim().toLowerCase()
        const filteredJumpFolders = railQuery ? jumpFolders.filter((f) => f.name.toLowerCase().includes(railQuery)) : jumpFolders
        const filteredJumpSystem = railQuery ? jumpSystem.filter((s) => s.label.toLowerCase().includes(railQuery)) : jumpSystem
        const railIconCount = Math.min(Math.max(totalJumpTargets, 2), 4)
        const railIconSize = 10
        const railIconGap = 8
        const railCollapsedHeight = railIconCount * railIconSize + (railIconCount - 1) * railIconGap + 16
        return (
          <FloatingHoverPanel
            ref={jumpRailPanelRef}
            expandedWidth={260}
            expandedHeight={340}
            anchorRightClass="right-0"
            collapsedWidth={16}
            collapsedHeight={railCollapsedHeight}
            collapsedRadius={8}
            onExpandedChange={(expanded) => { if (expanded) setTimeout(() => jumpRailSearchRef.current?.focus(), 30); else setJumpRailSearch('') }}
            collapsedContent={
              <div className="flex flex-col items-center justify-center" style={{ gap: railIconGap }}>
                {Array.from({ length: railIconCount }).map((_, i) => (
                  <FolderTree key={i} size={railIconSize} className="text-[rgb(var(--color-text-muted))]" />
                ))}
              </div>
            }
          >
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
              <FolderTree size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
              <input
                ref={jumpRailSearchRef}
                value={jumpRailSearch}
                onChange={(e) => setJumpRailSearch(e.target.value)}
                placeholder="Jump to folder…"
                className="flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))] min-w-0"
              />
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {filteredJumpFolders.length === 0 && filteredJumpSystem.length === 0 && (
                <div className="px-3 py-3 text-xs text-center text-[rgb(var(--color-text-muted))]">No match</div>
              )}
              {filteredJumpSystem.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    folderRowRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    jumpRailPanelRef.current?.close()
                  }}
                  className="flex items-center gap-2 w-[calc(100%-8px)] mx-1 rounded-shell px-3 py-1.5 text-[12.5px] text-left text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
                >
                  <Icon size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  <span className="flex-1 truncate">{label}</span>
                  <Lock size={9} className="flex-shrink-0 text-[rgb(var(--color-text-muted))] opacity-50" />
                </button>
              ))}
              {filteredJumpFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    folderRowRefs.current.get(f.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    jumpRailPanelRef.current?.close()
                  }}
                  className="flex items-center gap-2 w-[calc(100%-8px)] mx-1 rounded-shell px-3 py-1.5 text-[12.5px] text-left text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
                >
                  <Folder size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  <span className="flex-1 truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </FloatingHoverPanel>
        )
      })()}
    </div>
  )
}

// Compute the folder path (ancestry) for a note — used by the note's side panel.
export function folderPathFor(note: Note | null | undefined, folders: NoteFolder[]): string[] {
  if (!note) return []
  if (note.folderId) {
    const byId = new Map(folders.map((f) => [f.id, f]))
    const path: string[] = []
    let cur = byId.get(note.folderId)
    let guard = 0
    while (cur && guard++ < 50) {
      path.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    if (path.length) return path
  }
  const sys = systemFolderOf(note)
  if (sys) return [SYSTEM_FOLDERS.find((s) => s.key === sys)!.label]
  return []
}
