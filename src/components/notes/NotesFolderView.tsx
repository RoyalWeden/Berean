import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import {
  Folder, FolderOpen, FolderPlus, FilePlus, ChevronRight, FileText, Trash2,
  Pencil, Lock, CalendarDays, BookOpen, Download as DownloadIcon,
  BookMarked, CheckSquare, Square, FolderInput, FileType2,
} from 'lucide-react'
import type { Note, NoteFolder, PdfDoc } from '@/types'
import NoteContextMenu, { orderedFolders, type SessionInfo } from './NoteContextMenu'
import { contentSnippets } from './NotesList'
import { applyFindHighlight } from '@/lib/highlight'
import { useAppStore } from '@/store'
import { bookName, bookOrder } from '@/lib/parseRef'

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
  onDelete: (note: Note) => void
  onSetNoteFolder: (noteId: string, folderId: string | null) => void
  onCreateNote?: () => void
  onCreateNoteInFolder?: (folderId: string) => void
  onCreateFolder: (parentId: string | null) => void
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
  onSelect, onDelete, onSetNoteFolder,
  onCreateNote, onCreateNoteInFolder, onCreateFolder, onRenameFolder, onDeleteFolder, onDeleteFolderDeep, onSetFolderParent,
  onRenameNote, onOpenNewTab, onOpenInFloatingTab, onOpenInSession, onExportPdf, sessions,
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
    // Auto-expand every user folder that contains a visible (matching) note, and all its ancestors
    const folderMap = new Map(folders.map(f => [f.id, f]))
    const toExpand = new Set<string>()
    function addAncestors(folderId: string) {
      if (toExpand.has(folderId)) return
      const folder = folderMap.get(folderId)
      if (!folder) return
      toExpand.add(folderId)
      if (folder.parentId) addAncestors(folder.parentId)
    }
    for (const note of notes) {
      if (note.folderId) addAncestors(note.folderId)
    }
    if (toExpand.size > 0) {
      setExpanded(prev => {
        let changed = false
        const next = new Set(prev)
        for (const id of toExpand) { if (!next.has(id)) { next.add(id); changed = true } }
        return changed ? next : prev
      })
    }
  }, [searchQuery, notes, folders]) // eslint-disable-line react-hooks/exhaustive-deps

  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // Track what's being dragged so we can show "→ FolderName" on the note row
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)
  const draggingNoteRef = useRef<Note | null>(null)
  // Imported PDFs (locked folder)
  const [pdfs, setPdfs] = useState<PdfDoc[]>([])
  const openPdf = useAppStore((s) => s.openPdf)
  useEffect(() => {
    window.pdf?.list?.().then(setPdfs).catch(() => {})
    function onChange() { window.pdf?.list?.().then(setPdfs).catch(() => {}) }
    window.addEventListener('berean:pdfsChanged', onChange)
    return () => window.removeEventListener('berean:pdfsChanged', onChange)
  }, [])
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
    function onClose() { setNoteMenu(null); setFolderMenu(null); setFolderMoveOpen(false); setNoteMoveMenu(null) }
    window.addEventListener('berean:closeContextMenus', onClose)
    return () => window.removeEventListener('berean:closeContextMenus', onClose)
  }, [])

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
    const result = {} as Record<SystemKey, { withoutRef: Note[]; byBook: Map<string, Map<number, Note[]>> }>
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
      result[key] = { withoutRef, byBook }
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
    return { withoutDate, byYear }
  }, [bySystem])

  const childFolders = (parentId: string | null) => folders.filter((f) => f.parentId === parentId)

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
        onClick={() => { if (isRenaming || isMoveMenuOpen) return; selectMode ? onToggleSelectNote?.(note.id) : onSelect(note) }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (selectMode) return; setNoteMenu({ note, x: e.clientX, y: e.clientY }) }}
        style={{ paddingLeft: 12 + depth * 16 }}
        className={`group relative flex items-center gap-2 pr-2 py-1.5 cursor-pointer transition-colors ${
          isDraggingThis ? 'opacity-40' :
          activeNoteId === note.id ? 'bg-[rgb(var(--color-accent))/10]' : 'hover:bg-[rgb(var(--color-surface-4))]'
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
        <FileText size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
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
              <div className="absolute right-0 top-full mt-0.5 z-50 min-w-[150px] max-h-48 overflow-y-auto bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1">
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
          onClick={() => { if (selectMode) { onToggleSelectFolder?.(folder.id) } else { toggle(folder.id) } }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (selectMode) return; setFolderMenu({ folder, x: e.clientX, y: e.clientY }); setFolderMoveOpen(false) }}
          style={{ paddingLeft: 8 + depth * 16 }}
          className={`group flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer transition-colors ${
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
        {isOpen && (
          <div>
            {kids.map((k) => renderUserFolder(k, depth + 1))}
            {fNotes.map((n) => renderNote(n, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Render the body of a system folder that uses book/chapter virtual sub-folders.
  // Virtual folder IDs: "sys:{key}:{bookId}" and "sys:{key}:{bookId}:{chapter}"
  const renderSystemContent = (key: SystemKey) => {
    const { withoutRef, byBook } = systemSubGroups[key]
    const sortedBooks = [...byBook.entries()].sort(([aId], [bId]) => bookOrder(aId) - bookOrder(bId))
    return (
      <>
        {withoutRef.map((n) => renderNote(n, 1))}
        {sortedBooks.map(([bid, chapters]) => {
          const bookFolderId = `sys:${key}:${bid}`
          const bookIsOpen = expanded.has(bookFolderId)
          const totalNotes = [...chapters.values()].reduce((sum, ns) => sum + ns.length, 0)
          const sortedChapters = [...chapters.entries()].sort(([a], [b]) => a - b)
          return (
            <div key={bookFolderId}>
              {/* Book virtual folder — depth=1, paddingLeft=8+1*16=24 */}
              <div
                onClick={() => toggle(bookFolderId)}
                style={{ paddingLeft: 24 }}
                className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
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
                      className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
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
    const { withoutDate, byYear } = dailySubGroups
    const sortedYears = [...byYear.entries()].sort(([a], [b]) => b.localeCompare(a)) // newest year first
    return (
      <>
        {withoutDate.map((n) => renderNote(n, 1))}
        {sortedYears.map(([year, months]) => {
          const yearFolderId = `sys:daily:${year}`
          const yearIsOpen = expanded.has(yearFolderId)
          const totalNotes = [...months.values()].reduce((sum, ns) => sum + ns.length, 0)
          const sortedMonths = [...months.entries()].sort(([a], [b]) => b.localeCompare(a)) // newest month first
          return (
            <div key={yearFolderId}>
              {/* Year virtual folder — depth=1 */}
              <div
                onClick={() => toggle(yearFolderId)}
                style={{ paddingLeft: 24 }}
                className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
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
                      className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors select-none"
                    >
                      <ChevronRight size={11} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${monthIsOpen ? 'rotate-90' : ''}`} />
                      {monthIsOpen
                        ? <FolderOpen size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                        : <Folder    size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />}
                      <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-secondary))]">{monthLabel}</span>
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{mNotes.length || ''}</span>
                    </div>
                    {/* Notes inside month — depth=3, newest first */}
                    {monthIsOpen && [...mNotes]
                      .sort((a, b) => (b.title ?? '').localeCompare(a.title ?? '') || (b.createdAt ?? 0) - (a.createdAt ?? 0))
                      .map((n) => renderNote(n, 3))}
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
      {/* System folders (locked) — entire section blocks context menu to prevent "New note" appearing */}
      {SYSTEM_FOLDERS.map(({ key, label, icon: Icon }) => {
        const isOpen = expanded.has(key)
        const sysNotes = bySystem[key]
        const useSubFolders = key === 'verse' || key === 'esword' || key === 'biblegateway'
        return (
          <div key={key} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <div
              onClick={() => toggle(key)}
              className="group flex items-center gap-1.5 pl-2 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors"
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

      {/* PDFs (locked) — imported PDF documents */}
      <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
        <div
          onClick={() => toggle('pdfs')}
          className="group flex items-center gap-1.5 pl-2 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors"
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
                  className="group flex items-center gap-2 pr-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors">
                  <FileText size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-primary))]">{p.title}</span>
                </div>
              ))
        )}
      </div>

      {/* Divider */}
      <div className="my-1 h-px bg-[rgb(var(--color-surface-4))] mx-2" />

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
        <div className="flex items-center justify-between pl-2 pr-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
            {(draggingNoteId || draggingFolderId) && dragOverId === '__root__'
              ? <span className="text-[rgb(var(--color-accent))] animate-pulse">→ top level (no folder)</span>
              : 'Folders'}
          </span>
          <button onClick={() => onCreateFolder(null)} title="New folder"
            className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"><FolderPlus size={12} /></button>
        </div>
        {childFolders(null).map((f) => renderUserFolder(f, 0))}
        {rootNotes.map((n) => renderNote(n, 0))}
      </div>

      {/* Empty-space right-click menu — create note or folder */}
      {emptyMenu && onCreateNote && createPortal(
        <MenuPositioner ref={emptyMenuRef} x={emptyMenu.x} y={emptyMenu.y}
          className="min-w-[170px] bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1 overflow-hidden"
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <button className={MENU_ITEM} onClick={() => { setEmptyMenu(null); onCreateNote() }}>
            <FileText size={13} className="flex-shrink-0" /> New note
          </button>
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
        />
      )}

      {/* Folder context menu */}
      {folderMenu && createPortal(
        <MenuPositioner ref={folderMenuRef} x={folderMenu.x} y={folderMenu.y}
          className="min-w-[190px] bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1 overflow-hidden"
        >
              {onCreateNoteInFolder && (
                <button className={MENU_ITEM} onClick={() => { onCreateNoteInFolder(folderMenu.folder.id); setFolderMenu(null) }}>
                  <FilePlus size={13} className="flex-shrink-0" /> New note here
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
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
          <div className="bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl p-5 w-80 max-w-full">
            <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))] mb-1">
              Delete &ldquo;{confirmDelete.folder.name}&rdquo;?
            </p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-4">
              This will permanently delete the folder and all notes inside it. This cannot be undone.
            </p>
            <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-secondary))] mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipConfirmChecked}
                onChange={(e) => setSkipConfirmChecked(e.target.checked)}
                className="accent-[rgb(var(--color-accent))]"
              />
              Don&rsquo;t ask again
            </label>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
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
