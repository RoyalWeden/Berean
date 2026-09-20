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
import { MenuSurface, MenuItem, MenuSeparator } from '@/components/ui'

export interface SessionInfo { id: string; name: string; icon?: string }

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
    <MenuPositioner ref={ref} x={x} y={y} className="min-w-[190px]">
      <MenuSurface>
      {onOpenNewTab && (
        <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { onOpenNewTab(note); onClose() }} />
      )}
      {onOpenInFloatingTab && (
        <MenuItem icon={Monitor} label="Open in floating tab" onClick={() => { onOpenInFloatingTab(note); onClose() }} />
      )}
      <MenuItem icon={PanelRightOpen} label="Open in current tab" onClick={() => { onSelect(note); onClose() }} />

      {onExportPdf && (
        <MenuItem icon={Printer} label="Export to PDF / Print" onClick={() => { onExportPdf(note); onClose() }} />
      )}

      {canRename && (
        <MenuItem icon={Pencil} label="Rename" onClick={() => { onRename!(note); onClose() }} />
      )}

      {/* Move to folder (folder view, movable notes only) */}
      {showMove && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={FolderInput}
            label="Move to folder"
            trailing={<ChevronRight size={11} className={`transition-transform ${showFolders ? 'rotate-90' : ''}`} />}
            onClick={() => setShowFolders(v => !v)}
          />
          {showFolders && (
            <div className="border-t border-separator mt-1 pt-1 max-h-48 overflow-y-auto">
              {currentFolderId != null && (
                <MenuItem
                  icon={FolderMinus}
                  label="Move out (no folder)"
                  className="pl-8"
                  onClick={() => { onMoveToFolder!(note, null); onClose() }}
                />
              )}
              {orderedFolders(folders!).map(({ folder, depth }) => (
                <MenuItem
                  key={folder.id}
                  disabled={folder.id === currentFolderId}
                  label={folder.name}
                  style={{ paddingLeft: 20 + depth * 12 }}
                  onClick={() => { if (folder.id !== currentFolderId) { onMoveToFolder!(note, folder.id); onClose() } }}
                />
              ))}
              {folders!.length === 0 && (
                <div className="px-3 py-1.5 text-caption text-text-muted italic">No folders yet</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Set status — flyout, see statusFlyout state above for why it's not inline */}
      {onSetStatus && (
        <>
          <MenuSeparator />
          <MenuItem
            ref={statusBtnRef}
            icon={CircleDashed}
            label="Set status"
            active={statusFlyout ? true : undefined}
            trailing={<ChevronRight size={11} />}
            className={statusFlyout ? 'bg-surface-hover text-text-primary' : ''}
            onClick={() => {
              if (statusFlyout) { setStatusFlyout(null); return }
              const r = statusBtnRef.current?.getBoundingClientRect()
              if (r) setStatusFlyout({ x: r.right + 2, y: r.top })
            }}
          />
        </>
      )}

      {/* Open in session */}
      {sessions && sessions.length > 0 && onOpenInSession && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={Layers}
            label="Open in session"
            trailing={<ChevronRight size={11} className={`transition-transform ${showSessions ? 'rotate-90' : ''}`} />}
            onClick={() => setShowSessions(v => !v)}
          />
          {showSessions && (
            <div className="border-t border-separator mt-1 pt-1">
              {sessions.map(s => (
                <MenuItem
                  key={s.id}
                  label={<>{s.icon && <span className="mr-1">{s.icon}</span>}{s.name}</>}
                  className="pl-8"
                  onClick={() => { onOpenInSession(note, s.id); onClose() }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {onConvertToIdiom && note.type !== 'idiom' && (
        <>
          <MenuSeparator />
          <MenuItem icon={BookOpen} label="Convert to idiom note" onClick={() => { onConvertToIdiom(note); onClose() }} />
        </>
      )}

      {onDelete && (
        <>
          <MenuSeparator />
          <MenuItem danger icon={Trash2} label="Delete" onClick={() => { onDelete(note); onClose() }} />
        </>
      )}
      </MenuSurface>
    </MenuPositioner>

    {statusFlyout && onSetStatus && (
      <MenuPositioner ref={statusFlyoutRef} x={statusFlyout.x} y={statusFlyout.y} className="min-w-[160px]">
        <MenuSurface>
          <MenuItem
            label={<span className="flex items-center gap-2.5"><CircleDashed size={14} strokeWidth={1.75} className="opacity-60" /><span>No status</span></span>}
            onClick={() => { onSetStatus(note, null); setStatusFlyout(null); onClose() }}
          />
          {NOTE_STATUSES.map((s) => (
            <MenuItem
              key={s.id}
              label={<span className="flex items-center gap-2.5"><s.icon size={14} strokeWidth={1.75} style={{ color: s.color }} /><span>{s.label}</span></span>}
              onClick={() => { onSetStatus(note, s.id); setStatusFlyout(null); onClose() }}
            />
          ))}
        </MenuSurface>
      </MenuPositioner>
    )}
    </>,
    document.body
  )
}
