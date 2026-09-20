import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import {
  Folder, FolderOpen, FolderPlus, FilePlus, ChevronRight, FileText, NotepadText, Trash2,
  Pencil, Lock, CalendarDays, BookOpen, Download as DownloadIcon,
  BookMarked, FolderInput, FileType2, FolderTree,
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
import { MenuSurface, MenuItem, MenuSeparator, TextField, Button, Divider, Switch, IconButton, Checkbox, DisclosureRow, ListRow, cx } from '@/components/ui'
import { useRovingNav } from '@/lib/useRovingNav'

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
  const folderRowRefs = useRef<Map<string, HTMLElement>>(new Map())
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
      <ListRow
        data-note-row=""
        flush
        dense
        indent={12 + depth * 16}
        draggable={!isRenaming && !selectMode}
        onDragStart={(e) => onNoteDragStart(e, note)}
        onDragEnd={(e) => onNoteDragEnd(e)}
        onClick={() => { if (isRenaming || isMoveMenuOpen) return; selectMode ? onToggleSelectNote?.(note.id) : (onPreview ?? onSelect)(note) }}
        onDoubleClick={() => { if (!isRenaming && !isMoveMenuOpen && !selectMode) onSelect(note) }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (selectMode) return; setNoteMenu({ note, x: e.clientX, y: e.clientY }) }}
        className={cx('mx-1.5', isDraggingThis && 'opacity-40')}
        selected={activeNoteId === note.id}
        titleSize="footnote"
        buttonProps={{ 'data-roving': '' }}
        leading={<>
          {selectMode && (
            <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={isSelected} onChange={() => onToggleSelectNote?.(note.id)} />
            </span>
          )}
          <NotepadText size={12} className="flex-shrink-0 text-text-muted" />
        </>}
        title={isRenaming ? (
          <TextField
            ref={noteRenameRef}
            size="sm"
            value={noteRenameVal}
            onChange={(e) => setNoteRenameVal(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNoteRename(note)
              if (e.key === 'Escape') setRenamingNoteId(null)
            }}
            onBlur={() => commitNoteRename(note)}
            wrapperClassName="flex-1 min-w-0"
            className="h-5"
          />
        ) : (note.title || 'Untitled')}
        // Status indicator — same colored icon used in the list/board views, for a consistent
        // at-a-glance status signal across every way of browsing notes.
        meta={!isRenaming && (() => {
          const status = noteStatusMeta(note.status)
          if (!status) return null
          const Icon = status.icon
          return <Icon size={12} className="flex-shrink-0" style={{ color: status.color }} />
        })()}
        // Hover action buttons — rename, move and delete (not in select mode, not on
        // system-folder notes). ListRow's own `trailing` slot already reveals these on row
        // hover/focus-within, so they carry no opacity classes of their own.
        trailing={!selectMode && !isRenaming ? <>
          {renameable && onRenameNote && (
            <IconButton
              icon={Pencil}
              label="Rename"
              size={20}
              onClick={(e) => { e.stopPropagation(); setNoteRenameVal(note.title || ''); setRenamingNoteId(note.id) }}
            />
          )}
          {movable && (
            <div className="relative" data-note-move-menu>
              <IconButton
                icon={FolderInput}
                label="Move to folder"
                size={20}
                onClick={(e) => { e.stopPropagation(); setNoteMoveMenu(isMoveMenuOpen ? null : { noteId: note.id }) }}
              />
              {isMoveMenuOpen && (
                <MenuSurface className="absolute right-0 top-full mt-0.5 z-menu max-h-48 overflow-y-auto min-w-[150px]">
                  {note.folderId != null && (
                    <MenuItem
                      label="Move out (no folder)"
                      onClick={(e) => { e.stopPropagation(); onSetNoteFolder(note.id, null); setNoteMoveMenu(null) }}
                    />
                  )}
                  {orderedFolders(folders).map(({ folder: f, depth: d }) => (
                    <MenuItem
                      key={f.id}
                      disabled={f.id === note.folderId}
                      label={f.name}
                      style={{ paddingLeft: 12 + d * 10 }}
                      onClick={(e) => { e.stopPropagation(); if (f.id !== note.folderId) { onSetNoteFolder(note.id, f.id); setNoteMoveMenu(null) } }}
                    />
                  ))}
                  {folders.length === 0 && (
                    <div className="px-3 py-1.5 text-caption text-text-muted italic">No folders yet</div>
                  )}
                </MenuSurface>
              )}
            </div>
          )}
          <IconButton
            icon={Trash2}
            label="Delete note"
            size={20}
            danger
            onClick={(e) => { e.stopPropagation(); onDelete(note) }}
          />
        </> : undefined}
      />
      {/* In-folder search snippets — more compact than list view */}
      {snippets.length > 0 && (
        <div className="flex flex-col gap-0.5 pb-1" style={{ paddingLeft: 28 + depth * 16, paddingRight: 8 }}>
          {snippets.map((s, i) => (
            <div
              key={i}
              onClick={() => onSelect(note)}
              className="text-caption2 leading-snug text-text-secondary bg-surface-4/40 rounded px-1.5 py-0.5 cursor-pointer hover:bg-surface-hover truncate"
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
        <ListRow
          data-folder-row=""
          flush
          dense
          indent={8 + depth * 16}
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
          className={cx('mx-1.5', dragOverId === folder.id && 'ring-1 ring-inset ring-accent/40')}
          current={isSelected || dragOverId === folder.id}
          titleSize="footnote"
          buttonProps={{ 'data-roving': '' }}
          leading={<>
            {selectMode && (
              <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isSelected} onChange={() => onToggleSelectFolder?.(folder.id)} />
              </span>
            )}
            <IconButton
              icon={ChevronRight}
              label={isOpen ? 'Collapse' : 'Expand'}
              tooltip={false}
              size={20}
              variant="ghost"
              iconClassName={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggle(folder.id) }}
            />
            {isOpen ? <FolderOpen size={14} className="flex-shrink-0 text-accent" /> : <Folder size={14} className="flex-shrink-0 text-accent" />}
          </>}
          title={isRenaming ? (
            <TextField
              ref={renameRef}
              size="sm"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRenameFolder(folder.id, renameVal.trim() || 'Folder'); setRenamingId(null) }
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => { onRenameFolder(folder.id, renameVal.trim() || 'Folder'); setRenamingId(null) }}
              wrapperClassName="flex-1 min-w-0"
              className="h-5"
            />
          ) : <span className="font-medium">{folder.name}</span>}
          // "→ drop here" badge — shows for both note and folder drags
          meta={(draggingNoteId || draggingFolderId) && dragOverId === folder.id && !isRenaming && draggingFolderId !== folder.id
            ? <span className="font-medium text-accent animate-pulse">→ here</span>
            : (fNotes.length || '')}
          trailing={!isRenaming && !selectMode ? <>
            <IconButton icon={FolderPlus} label="New subfolder" size={20}
              onClick={(e) => { e.stopPropagation(); onCreateFolder(folder.id) }} />
            <IconButton icon={Pencil} label="Rename" size={20}
              onClick={(e) => { e.stopPropagation(); setRenameVal(folder.name); setRenamingId(folder.id) }} />
            <IconButton icon={Trash2} label="Delete folder (notes move to root)" size={20} danger
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id) }} />
          </> : undefined}
        />
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
              {/* Book virtual folder — depth=1, indent=8+1*16=24 */}
              <DisclosureRow
                open={bookIsOpen}
                onClick={() => toggle(bookFolderId)}
                indent={24}
                icon={bookIsOpen ? FolderOpen : Folder}
                title={bookName(bid)}
                count={totalNotes || undefined}
                className="mx-1.5"
              />
              {bookIsOpen && sortedChapters.map(([ch, chNotes]) => {
                const chFolderId = `sys:${key}:${bid}:${ch}`
                const chIsOpen = expanded.has(chFolderId)
                return (
                  <div key={chFolderId}>
                    {/* Chapter virtual folder — depth=2, indent=8+2*16=40 */}
                    <DisclosureRow
                      open={chIsOpen}
                      onClick={() => toggle(chFolderId)}
                      indent={40}
                      icon={chIsOpen ? FolderOpen : Folder}
                      title={`Chapter ${ch}`}
                      count={chNotes.length || undefined}
                      className="mx-1.5"
                    />
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
              <DisclosureRow
                open={yearIsOpen}
                onClick={() => toggle(yearFolderId)}
                indent={24}
                icon={yearIsOpen ? FolderOpen : Folder}
                title={year}
                count={totalNotes || undefined}
                className="mx-1.5"
              />
              {yearIsOpen && sortedMonths.map(([monthKey, mNotes]) => {
                const monthFolderId = `sys:daily:${monthKey}`
                const monthIsOpen = expanded.has(monthFolderId)
                const monthLabel = new Date(+monthKey.slice(0, 4), +monthKey.slice(5, 7) - 1, 1)
                  .toLocaleString('default', { month: 'long' })
                return (
                  <div key={monthFolderId}>
                    {/* Month virtual folder — depth=2 */}
                    <DisclosureRow
                      open={monthIsOpen}
                      onClick={() => toggle(monthFolderId)}
                      indent={40}
                      icon={monthIsOpen ? FolderOpen : Folder}
                      title={monthLabel}
                      count={mNotes.length || undefined}
                      className="mx-1.5"
                    />
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
    <div className="py-1 text-body min-h-full flex flex-col" onContextMenu={handleEmptyContextMenu}>
      {/* System folders (locked) — entire section blocks context menu to prevent "New note" appearing.
          While searching, a folder with zero matching notes is hidden entirely rather than shown
          collapsed-and-empty (matches how user folders already behave during search). */}
      {SYSTEM_FOLDERS.filter(({ key }) => !searchQuery || bySystem[key].length > 0).map(({ key, label, icon: Icon }) => {
        const isOpen = expanded.has(key)
        const sysNotes = bySystem[key]
        const useSubFolders = key === 'verse' || key === 'esword' || key === 'biblegateway'
        return (
          <div key={key} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <DisclosureRow
              ref={(el) => { if (el) folderRowRefs.current.set(key, el); else folderRowRefs.current.delete(key) }}
              open={isOpen}
              onClick={() => toggle(key)}
              icon={Icon}
              title={label}
              count={sysNotes.length || undefined}
              trailing={<Lock size={9} className="text-text-tertiary" />}
              className="mx-1.5"
            />
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
        <DisclosureRow
          open={expanded.has('pdfs')}
          onClick={() => toggle('pdfs')}
          icon={FileType2}
          title="PDFs"
          count={pdfs.length || undefined}
          trailing={<Lock size={9} className="text-text-tertiary" />}
          className="mx-1.5"
        />
        {expanded.has('pdfs') && (
          pdfs.length === 0
            ? <div className="pl-8 pr-2 py-1.5 text-caption text-text-muted italic">No PDFs imported</div>
            : pdfs.map((p) => (
                <ListRow
                  key={p.id}
                  dense
                  indent={28}
                  onClick={() => openPdf(p.id, p.title)}
                  leading={<FileText size={12} />}
                  title={p.title}
                  className="mx-1.5"
                />
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
        <DisclosureRow
          data-folder-row
          open={expanded.has('trash')}
          onClick={() => toggle('trash')}
          icon={Trash2}
          title="Trash"
          count={trashedNotes.length || undefined}
          trailing={<Lock size={9} className="text-text-tertiary" />}
          className="mx-1.5"
        />
        {expanded.has('trash') && (
          trashedNotes.length === 0
            ? <div className="pl-8 pr-2 py-1.5 text-caption text-text-muted italic">Trash is empty</div>
            : trashedNotes.map((n) => (
                <ListRow
                  key={n.id}
                  indent={28}
                  className="mx-1.5"
                  leading={<NotepadText size={12} />}
                  title={n.title || 'Untitled'}
                  subtitle={deletedAgoLabel(n.deletedAt)}
                  trailing={<>
                    <IconButton
                      icon={RotateCcw}
                      label="Restore"
                      size={20}
                      onClick={() => window.notes.restoreNote(n.id).then(() => useAppStore.getState().bumpNoteToken())}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Delete forever"
                      size={20}
                      danger
                      onClick={() => window.notes.purgeTrashItem(n.id).then(() => useAppStore.getState().bumpNoteToken())}
                    />
                  </>}
                />
              ))
        )}
      </div>
      {/* "Empty Trash" — reached via right-click on the Trash row above, not a per-item menu */}
      {trashMenu && createPortal(
        <MenuPositioner ref={trashMenuRef} x={trashMenu.x} y={trashMenu.y}>
          <MenuSurface className="min-w-[160px]">
            <MenuItem
              danger
              icon={Trash2}
              label="Empty Trash"
              onClick={() => { setTrashMenu(null); setConfirmEmptyTrash(true) }}
            />
          </MenuSurface>
        </MenuPositioner>,
        document.body
      )}
      {confirmEmptyTrash && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50">
          <div className="material-popover rounded-menu p-5 w-80 max-w-full">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-destructive flex-shrink-0" />
              <p className="text-body font-semibold text-text-primary">
                Empty Trash?
              </p>
            </div>
            <p className="text-footnote text-text-muted mb-4">
              This will permanently delete {trashedNotes.length} note{trashedNotes.length === 1 ? '' : 's'} in Trash.
              This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setConfirmEmptyTrash(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  window.notes.emptyTrash().then(() => useAppStore.getState().bumpNoteToken())
                  setConfirmEmptyTrash(false)
                }}
              >
                Delete Permanently
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Divider */}
      {/* Divider + New note/New folder row — hidden while searching, since neither
          action makes sense mid-search and the row was just clutter above the results. */}
      {!searchQuery && (
        <Divider className="my-1 mx-2" />
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
        className={`flex-1 ${dragOverId === '__root__' ? 'bg-accent-muted' : ''}`}
      >
        {!searchQuery && (
          <div className="flex items-center gap-1.5 pl-2 pr-2 py-1 min-h-[26px]">
            {(draggingNoteId || draggingFolderId) && dragOverId === '__root__' && (
              <span className="text-caption2 text-accent animate-pulse">→ top level (no folder)</span>
            )}
            <div className="flex items-center gap-1">
              {onCreateNote && (
                <Button variant="ghost" size="sm" icon={FilePlus} onClick={onCreateNote}>New Note</Button>
              )}
              {onCreateNote && <Divider orientation="vertical" />}
              <Button variant="ghost" size="sm" icon={FolderPlus} onClick={() => onCreateFolder(null)}>New Folder</Button>
              {onCreateIdiom && (
                <>
                  <Divider orientation="vertical" />
                  <Button variant="ghost" size="sm" icon={BookOpen} onClick={onCreateIdiom}>New Idiom</Button>
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
          className="min-w-[170px]"
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <MenuSurface>
            <MenuItem icon={NotepadText} label="New note" onClick={() => { setEmptyMenu(null); onCreateNote() }} />
            {onCreateIdiom && (
              <MenuItem icon={BookOpen} label="New idiom" onClick={() => { setEmptyMenu(null); onCreateIdiom() }} />
            )}
            <MenuItem icon={FolderPlus} label="New folder" onClick={() => { setEmptyMenu(null); onCreateFolder(null) }} />
          </MenuSurface>
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
          className="min-w-[190px]"
        >
          <MenuSurface>
              {onCreateNoteInFolder && (
                <MenuItem icon={FilePlus} label="New note here" onClick={() => { onCreateNoteInFolder(folderMenu.folder.id); setFolderMenu(null) }} />
              )}
              {onCreateIdiomInFolder && (
                <MenuItem icon={BookOpen} label="New idiom here" onClick={() => { onCreateIdiomInFolder(folderMenu.folder.id); setFolderMenu(null) }} />
              )}
              <MenuItem icon={FolderPlus} label="New subfolder" onClick={() => { onCreateFolder(folderMenu.folder.id); setFolderMenu(null) }} />
              <MenuItem icon={Pencil} label="Rename" onClick={() => { setRenameVal(folderMenu.folder.name); setRenamingId(folderMenu.folder.id); setFolderMenu(null) }} />
              <MenuSeparator />
              <MenuItem
                icon={FolderInput}
                label="Move into folder"
                trailing={<ChevronRight size={12} className={`transition-transform ${folderMoveOpen ? 'rotate-90' : ''}`} />}
                onClick={() => setFolderMoveOpen(v => !v)}
              />
              {folderMoveOpen && (
                <div className="border-t border-separator mt-1 pt-1 max-h-48 overflow-y-auto">
                  {folderMenu.folder.parentId != null && (
                    <MenuItem className="pl-8" label="Move to top level" onClick={() => { onSetFolderParent(folderMenu.folder.id, null); setFolderMenu(null) }} />
                  )}
                  {folderMoveTargets.map(({ folder, depth }) => (
                    <MenuItem
                      key={folder.id}
                      disabled={folder.id === folderMenu.folder.parentId}
                      label={folder.name}
                      style={{ paddingLeft: 20 + depth * 12 }}
                      onClick={() => { if (folder.id !== folderMenu.folder.parentId) { onSetFolderParent(folderMenu.folder.id, folder.id); setFolderMenu(null) } }}
                    />
                  ))}
                  {folderMoveTargets.length === 0 && (
                    <div className="px-3 py-1.5 text-caption text-text-muted italic">No other folders</div>
                  )}
                </div>
              )}
              <MenuSeparator />
              <MenuItem
                danger
                icon={Trash2}
                label="Delete folder & contents"
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
              />
          </MenuSurface>
        </MenuPositioner>,
        document.body
      )}
      {/* Custom confirm dialog for "Delete folder & contents" */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50">
          <div className="material-popover rounded-menu p-5 w-80 max-w-full">
            <p className="text-body font-semibold text-text-primary mb-1">
              Delete &ldquo;{confirmDelete.folder.name}&rdquo;?
            </p>
            <p className="text-footnote text-text-muted mb-4">
              This will permanently delete the folder and all notes inside it. This cannot be undone.
            </p>
            <label className="flex items-center gap-2 text-footnote text-text-secondary mb-4 cursor-pointer select-none">
              <Switch checked={skipConfirmChecked} onCheckedChange={() => setSkipConfirmChecked((v) => !v)} />
              Don&rsquo;t ask again
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (skipConfirmChecked) localStorage.setItem(SKIP_CONFIRM_KEY, 'true')
                  onDeleteFolderDeep(confirmDelete.folder.id)
                  setConfirmDelete(null)
                }}
              >
                Delete
              </Button>
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
                  <FolderTree key={i} size={railIconSize} className="text-text-muted" />
                ))}
              </div>
            }
          >
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-separator flex-shrink-0">
              <TextField
                ref={jumpRailSearchRef}
                bare
                icon={FolderTree}
                size="sm"
                value={jumpRailSearch}
                onChange={(e) => setJumpRailSearch(e.target.value)}
                placeholder="Jump to folder…"
                wrapperClassName="flex-1 min-w-0"
              />
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {filteredJumpFolders.length === 0 && filteredJumpSystem.length === 0 && (
                <div className="px-3 py-3 text-footnote text-center text-text-muted">No match</div>
              )}
              {filteredJumpSystem.map(({ key, label, icon: Icon }) => (
                <ListRow
                  key={key}
                  className="mx-1"
                  onClick={() => {
                    folderRowRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    jumpRailPanelRef.current?.close()
                  }}
                  leading={<Icon size={12} />}
                  title={label}
                  trailing={<Lock size={9} className="text-text-tertiary" />}
                  trailingAlways
                />
              ))}
              {filteredJumpFolders.map((f) => (
                <ListRow
                  key={f.id}
                  className="mx-1"
                  onClick={() => {
                    folderRowRefs.current.get(f.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    jumpRailPanelRef.current?.close()
                  }}
                  leading={<Folder size={12} />}
                  title={f.name}
                />
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
