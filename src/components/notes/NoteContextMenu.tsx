import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import {
  Trash2, ExternalLink, PanelRightOpen, Pencil, Layers, ChevronRight,
  Monitor, FolderInput, FolderMinus,
} from 'lucide-react'
import type { Note, NoteFolder } from '@/types'
import { isSystemNote } from '@/lib/noteUtils'

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
}

export default function NoteContextMenu({
  note, x, y, onClose, onSelect,
  onOpenNewTab, onOpenInFloatingTab, onRename, onDelete, onOpenInSession, sessions,
  folders, canMove, currentFolderId, onMoveToFolder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [showSessions, setShowSessions] = useState(false)
  const [showFolders, setShowFolders] = useState(false)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
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
    <MenuPositioner ref={ref} x={x} y={y}
      className="min-w-[190px] bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1 overflow-hidden"
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
    </MenuPositioner>,
    document.body
  )
}
