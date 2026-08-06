import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import {
  Trash2, ExternalLink, PanelRightOpen, Pencil, Layers, ChevronRight,
  Monitor, FolderInput, FolderMinus, BookOpen, Printer, CircleDashed,
} from 'lucide-react'
import type { Note, NoteFolder, NoteStatus } from '@/types'
import { isSystemNote } from '@/lib/noteUtils'
import { NOTE_STATUSES } from '@/lib/noteStatus'

export interface SessionInfo { id: string; name: string; icon?: string }

const MENU_ITEM = `w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left
  text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]
  hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer`

// Flatten the folder tree into a depth-indented ordered list (for the move submenu).
export function orderedFolders(folders: NoteFolder[]): { folder: NoteFolder; depth: number }[] {
  const byParent = new Map<string | null, NoteFolder[]>()
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? []
    arr.push(f); byParent.set(f.parentId, arr)
  }
  const out: { folder: NoteFolder; depth: number }[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const f of (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ folder: f, depth }); walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

interface Props {
  note: Note
  x: number
  y: number
  onClose: () => void
  onSelect: (note: Note) => void
  onOpenNewTab?: (note: Note) => void
  onOpenInFloatingTab?: (note: Note) => void
  onRename?: (note: Note) => void
  onDelete?: (note: Note) => void
  onOpenInSession?: (note: Note, sessionId: string) => void
  sessions?: SessionInfo[]
  // Folder move (folder view only). canMove gates whether the move option shows.
  folders?: NoteFolder[]
  canMove?: boolean
  currentFolderId?: string | null
  onMoveToFolder?: (note: Note, folderId: string | null) => void
  onConvertToIdiom?: (note: Note) => void
  /** Open the print/PDF-export preview for this note without opening the note first. */
  onExportPdf?: (note: Note) => void
  /** Set/clear the note's lifecycle status without opening it — mirrors the same picker in
   *  the note editor header (NoteStatusDropdown), just reachable from the list too. */
  onSetStatus?: (note: Note, status: NoteStatus | null) => void
}

export default function NoteContextMenu({
  note, x, y, onClose, onSelect,
  onOpenNewTab, onOpenInFloatingTab, onRename, onDelete, onOpenInSession, sessions,
  folders, canMove, currentFolderId, onMoveToFolder, onConvertToIdiom, onExportPdf, onSetStatus,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [showSessions, setShowSessions] = useState(false)
  const [showFolders, setShowFolders] = useState(false)
  // "Set status" opens as its own flyout popup anchored to the trigger row, rather than
  // expanding inline inside this menu — expanding inline grew this menu's measured height,
  // and MenuPositioner re-clamps position on every render, so the whole menu visibly jumped
  // to a different spot on screen the moment the status list appeared.
  const statusBtnRef = useRef<HTMLButtonElement>(null)
  const statusFlyoutRef = useRef<HTMLDivElement>(null)
  const [statusFlyout, setStatusFlyout] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (statusFlyoutRef.current && statusFlyoutRef.current.contains(target)) return
      if (ref.current && !ref.current.contains(target)) onClose()
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handleClick, true)
    window.addEventListener('keydown', handleKey)
    window.addEventListener('berean:closeContextMenus', onClose)
    return () => {
      window.removeEventListener('mousedown', handleClick, true)
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('berean:closeContextMenus', onClose)
    }
  }, [onClose])

  const canRename = !isSystemNote(note) && !!onRename
  const showMove  = !!folders && !!onMoveToFolder && !!canMove

  return createPortal(
    <>
    <MenuPositioner ref={ref} x={x} y={y}
      className="native-buttons min-w-[190px] rounded-shell context-menu py-1 overflow-hidden"
    >
      {onOpenNewTab && (
        <button className={MENU_ITEM} onClick={() => { onOpenNewTab(note); onClose() }}>
          <ExternalLink size={13} className="flex-shrink-0" /> Open in new tab
        </button>
      )}
      {onOpenInFloatingTab && (
        <button className={MENU_ITEM} onClick={() => { onOpenInFloatingTab(note); onClose() }}>
          <Monitor size={13} className="flex-shrink-0" /> Open in floating tab
        </button>
      )}
      <button className={MENU_ITEM} onClick={() => { onSelect(note); onClose() }}>
        <PanelRightOpen size={13} className="flex-shrink-0" /> Open in current tab
      </button>

      {onExportPdf && (
        <button className={MENU_ITEM} onClick={() => { onExportPdf(note); onClose() }}>
          <Printer size={13} className="flex-shrink-0" /> Export to PDF / Print
        </button>
      )}

      {canRename && (
        <button className={MENU_ITEM} onClick={() => { onRename!(note); onClose() }}>
          <Pencil size={13} className="flex-shrink-0" /> Rename
        </button>
      )}

      {/* Move to folder (folder view, movable notes only) */}
      {showMove && (
        <>
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button className={`${MENU_ITEM} justify-between`} onClick={() => setShowFolders(v => !v)}>
            <span className="flex items-center gap-2.5">
              <FolderInput size={13} className="flex-shrink-0" /> Move to folder
            </span>
            <ChevronRight size={11} className={`transition-transform ${showFolders ? 'rotate-90' : ''}`} />
          </button>
          {showFolders && (
            <div className="border-t border-[rgb(var(--color-surface-4))] mt-1 pt-1 max-h-48 overflow-y-auto">
              {currentFolderId != null && (
                <button
                  className={`${MENU_ITEM} pl-8`}
                  onClick={() => { onMoveToFolder!(note, null); onClose() }}
                >
                  <FolderMinus size={12} className="flex-shrink-0" /> Move out (no folder)
                </button>
              )}
              {orderedFolders(folders!).map(({ folder, depth }) => (
                <button
                  key={folder.id}
                  disabled={folder.id === currentFolderId}
                  className={`${MENU_ITEM} ${folder.id === currentFolderId ? 'opacity-40 cursor-default' : ''}`}
                  style={{ paddingLeft: 20 + depth * 12 }}
                  onClick={() => { if (folder.id !== currentFolderId) { onMoveToFolder!(note, folder.id); onClose() } }}
                >
                  {folder.name}
                </button>
              ))}
              {folders!.length === 0 && (
                <div className="px-3 py-1.5 text-[11px] text-[rgb(var(--color-text-muted))] italic">No folders yet</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Set status — flyout, see statusFlyout state above for why it's not inline */}
      {onSetStatus && (
        <>
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            ref={statusBtnRef}
            className={`${MENU_ITEM} justify-between ${statusFlyout ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : ''}`}
            onClick={() => {
              if (statusFlyout) { setStatusFlyout(null); return }
              const r = statusBtnRef.current?.getBoundingClientRect()
              if (r) setStatusFlyout({ x: r.right + 2, y: r.top })
            }}
          >
            <span className="flex items-center gap-2.5">
              <CircleDashed size={13} className="flex-shrink-0" /> Set status
            </span>
            <ChevronRight size={11} />
          </button>
        </>
      )}

      {/* Open in session */}
      {sessions && sessions.length > 0 && onOpenInSession && (
        <>
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button className={`${MENU_ITEM} justify-between`} onClick={() => setShowSessions(v => !v)}>
            <span className="flex items-center gap-2.5">
              <Layers size={13} className="flex-shrink-0" /> Open in session
            </span>
            <ChevronRight size={11} className={`transition-transform ${showSessions ? 'rotate-90' : ''}`} />
          </button>
          {showSessions && (
            <div className="border-t border-[rgb(var(--color-surface-4))] mt-1 pt-1">
              {sessions.map(s => (
                <button
                  key={s.id}
                  className={`${MENU_ITEM} pl-8`}
                  onClick={() => { onOpenInSession(note, s.id); onClose() }}
                >
                  {s.icon && <span className="mr-1">{s.icon}</span>}{s.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {onConvertToIdiom && note.type !== 'idiom' && (
        <>
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button className={MENU_ITEM} onClick={() => { onConvertToIdiom(note); onClose() }}>
            <BookOpen size={13} className="flex-shrink-0" /> Convert to idiom note
          </button>
        </>
      )}

      {onDelete && (
        <>
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            className={`${MENU_ITEM} text-red-400 hover:text-red-300 hover:bg-red-500/10`}
            onClick={() => { onDelete(note); onClose() }}
          >
            <Trash2 size={13} className="flex-shrink-0" /> Delete
          </button>
        </>
      )}
    </MenuPositioner>

    {statusFlyout && onSetStatus && (
      <MenuPositioner ref={statusFlyoutRef} x={statusFlyout.x} y={statusFlyout.y}
        className="native-buttons min-w-[160px] rounded-shell context-menu py-1 overflow-hidden"
      >
        <button
          className={MENU_ITEM}
          onClick={() => { onSetStatus(note, null); setStatusFlyout(null); onClose() }}
        >
          <CircleDashed size={12} className="flex-shrink-0 opacity-60" /> No status
        </button>
        {NOTE_STATUSES.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.id}
              className={MENU_ITEM}
              onClick={() => { onSetStatus(note, s.id); setStatusFlyout(null); onClose() }}
            >
              <Icon size={12} className="flex-shrink-0" style={{ color: s.color }} /> {s.label}
            </button>
          )
        })}
      </MenuPositioner>
    )}
    </>,
    document.body
  )
}
