import { useState, useEffect, useRef } from 'react'
import { FileText, Trash2, CheckSquare, Square, ExternalLink, PanelRightOpen, Pencil, Layers, ChevronRight, Monitor } from 'lucide-react'
import { bookName } from '@/lib/parseRef'
import { applyFindHighlight } from '@/lib/highlight'
import type { Note } from '@/types'

interface SessionInfo { id: string; name: string; icon?: string }

interface NotesListProps {
  notes: Note[]
  onSelect: (note: Note) => void
  onDelete?: (note: Note) => void
  findQuery?: string
  selectMode?: boolean
  selected?: string[]
  onToggleSelect?: (noteId: string) => void
  expandAll?: boolean
  onOpenNewTab?: (note: Note) => void
  onRenameCommit?: (noteId: string, newTitle: string) => void
  onOpenInFloatingTab?: (note: Note) => void
  onOpenInSession?: (note: Note, sessionId: string) => void
  sessions?: SessionInfo[]
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function formatVerseRef(ref: string): string {
  if (!ref.includes('.')) {
    // Old BibleGateway imports stored the raw passage string (e.g. "Matthew 24:32").
    // Return it as-is — it's already human-readable.
    return ref
  }
  const [bookId, chapter, verse] = ref.split('.')
  const name = bookId ? bookName(bookId) : ref
  return verse ? `${name} ${chapter}:${verse}` : `${name} ${chapter}`
}

function noteTypeBadge(note: Note) {
  if (note.type === 'daily' || note.type === 'journal' ||
      (note.type === 'general' && !!(note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — '))))
    return { label: 'Daily', cls: 'bg-amber-500/15 text-amber-400' }
  if (note.type === 'youtube') return { label: 'Video', cls: 'bg-red-500/15 text-red-400' }
  if (note.verseRef || note.type === 'verse') return null // shown via verseRef chip
  return null
}

function noteSourceBadge(note: Note): { label: string; cls: string } | null {
  if (note.tags?.includes('biblegateway'))
    return { label: 'BG', cls: 'bg-sky-500/15 text-sky-400' }
  if (note.tags?.includes('esword'))
    return { label: 'eSw', cls: 'bg-violet-500/15 text-violet-400' }
  return null
}

const MENU_ITEM = `w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left
  text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]
  hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer`

export default function NotesList({
  notes, onSelect, onDelete, findQuery,
  selectMode = false, selected = [], onToggleSelect,
  expandAll = false,
  onOpenNewTab, onRenameCommit, onOpenInFloatingTab, onOpenInSession, sessions,
}: NotesListProps) {
  const [contextMenu, setContextMenu] = useState<{ note: Note; x: number; y: number } | null>(null)
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingNoteId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingNoteId])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    function handle(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
        setShowSessionPicker(false)
      }
    }
    window.addEventListener('mousedown', handle, true)
    return () => window.removeEventListener('mousedown', handle, true)
  }, [contextMenu])

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') { setContextMenu(null); setShowSessionPicker(false) }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [contextMenu])

  function commitRename(noteId: string, title: string) {
    onRenameCommit?.(noteId, title.trim() || 'Untitled')
    setRenamingNoteId(null)
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
        <FileText size={32} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-40" />
        <p className="text-sm text-[rgb(var(--color-text-secondary))]">No notes yet</p>
        <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">
          Click a verse number to add a verse note, or press{' '}
          <kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded text-[10px]">⌘⇧N</kbd>{' '}
          for a general note.
        </p>
      </div>
    )
  }

  // Compute safe context-menu position (avoid going off bottom/right edge)
  function safeMenuPos(x: number, y: number) {
    const menuW = 190
    const menuH = sessions && sessions.length > 0 ? 230 : 190
    return {
      left: x + menuW > window.innerWidth  ? x - menuW : x,
      top:  y + menuH > window.innerHeight ? y - menuH : y,
    }
  }

  return (
    <>
      <div className="flex flex-col divide-y divide-[rgb(var(--color-surface-4))]">
        {notes.map((note) => {
          const rawSnippet = note.content.replace(/[#*`>\-_~\[\]]/g, '').trim()
          const snippet = expandAll
            ? rawSnippet
            : rawSnippet.replace(/\n/g, ' ')
          const isSelected = selected.includes(note.id)
          const badge = noteTypeBadge(note)
          const sourceBadge = noteSourceBadge(note)
          const isRenaming = renamingNoteId === note.id

          return (
            <div
              key={note.id}
              className={`relative group flex items-stretch transition-colors
                ${isSelected
                  ? 'bg-[rgb(var(--color-accent))/10]'
                  : 'hover:bg-[rgb(var(--color-surface-4))]'
                }`}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (selectMode) return
                const MENU_W = 200, MENU_H = 260, pad = 8
                setContextMenu({ note,
                  x: Math.max(pad, Math.min(e.clientX, window.innerWidth  - MENU_W - pad)),
                  y: Math.max(pad, Math.min(e.clientY, window.innerHeight - MENU_H - pad)),
                })
                setShowSessionPicker(false)
              }}
            >
              {/* Checkbox in select mode */}
              {selectMode && (
                <button
                  onClick={() => onToggleSelect?.(note.id)}
                  className="flex items-center pl-3 pr-1 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer flex-shrink-0"
                >
                  {isSelected
                    ? <CheckSquare size={15} className="text-[rgb(var(--color-accent))]" />
                    : <Square size={15} />
                  }
                </button>
              )}

              {/* Note row */}
              <button
                onClick={() => {
                  if (isRenaming) return
                  if (selectMode) {
                    onToggleSelect?.(note.id)
                  } else {
                    onSelect(note)
                  }
                }}
                className={`flex flex-col items-start gap-0.5 py-3 text-left w-full min-w-0 transition-colors cursor-pointer
                  ${selectMode ? 'px-2 pr-9' : 'px-4 pr-9'}
                `}
              >
                {/* Title: inline rename input or normal text */}
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(note.id, renameValue) }
                      if (e.key === 'Escape') { e.stopPropagation(); setRenamingNoteId(null) }
                    }}
                    onBlur={() => commitRename(note.id, renameValue)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-medium text-[rgb(var(--color-text-primary))] bg-[rgb(var(--color-surface-4))] rounded px-1 w-full outline-none border border-[rgb(var(--color-accent))/50]"
                  />
                ) : (
                  <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] truncate w-full">
                    {findQuery ? applyFindHighlight(note.title || 'Untitled', findQuery) : (note.title || 'Untitled')}
                  </span>
                )}
                {!isRenaming && (
                  <>
                    <span className={`text-xs text-[rgb(var(--color-text-muted))] w-full ${expandAll ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                      {findQuery
                        ? applyFindHighlight(expandAll ? (snippet || 'Empty note') : (snippet.slice(0, 80) || 'Empty note'), findQuery)
                        : (expandAll ? (snippet || 'Empty note') : (snippet.slice(0, 80) || 'Empty note'))}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {badge && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                      {sourceBadge && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none ${sourceBadge.cls}`}>
                          {sourceBadge.label}
                        </span>
                      )}
                      {note.verseRef && (
                        <span className="text-[10px] font-medium text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full leading-none">
                          {formatVerseRef(note.verseRef)}
                        </span>
                      )}
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))]">
                        {formatDate(note.createdAt)}
                        {note.updatedAt !== note.createdAt && (
                          <span className="opacity-60"> · {timeAgo(note.updatedAt)}</span>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </button>

              {/* Delete button — appears on row hover (not in select mode) */}
              {onDelete && !selectMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(note) }}
                  className="
                    absolute right-2 top-1/2 -translate-y-1/2
                    p-1.5 rounded opacity-0 group-hover:opacity-100
                    text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-red-500/15
                    transition-opacity cursor-pointer
                  "
                  title="Delete note"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        const pos = safeMenuPos(contextMenu.x, contextMenu.y)
        return (
          <div
            ref={contextMenuRef}
            className="fixed z-[9999] min-w-[190px] bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1 overflow-hidden"
            style={{ left: pos.left, top: pos.top }}
          >
            {/* Open in new tab */}
            {onOpenNewTab && (
              <button
                className={MENU_ITEM}
                onClick={() => { onOpenNewTab(contextMenu.note); setContextMenu(null) }}
              >
                <ExternalLink size={13} className="flex-shrink-0" />
                Open in new tab
              </button>
            )}

            {/* Open in floating tab */}
            {onOpenInFloatingTab && (
              <button
                className={MENU_ITEM}
                onClick={() => { onOpenInFloatingTab(contextMenu.note); setContextMenu(null) }}
              >
                <Monitor size={13} className="flex-shrink-0" />
                Open in floating tab
              </button>
            )}

            {/* Open in current tab */}
            <button
              className={MENU_ITEM}
              onClick={() => { onSelect(contextMenu.note); setContextMenu(null) }}
            >
              <PanelRightOpen size={13} className="flex-shrink-0" />
              Open in current tab
            </button>

            {/* Rename — inline (not available for verse notes or daily notes) */}
            {contextMenu.note.type !== 'verse' && contextMenu.note.type !== 'daily' && (
              <button
                className={MENU_ITEM}
                onClick={() => {
                  const note = contextMenu.note
                  setContextMenu(null)
                  setRenameValue(note.title || '')
                  setRenamingNoteId(note.id)
                }}
              >
                <Pencil size={13} className="flex-shrink-0" />
                Rename
              </button>
            )}

            {/* Open in session */}
            {sessions && sessions.length > 0 && onOpenInSession && (
              <>
                <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
                <button
                  className={`${MENU_ITEM} justify-between`}
                  onClick={() => setShowSessionPicker(v => !v)}
                >
                  <span className="flex items-center gap-2.5">
                    <Layers size={13} className="flex-shrink-0" />
                    Open in session
                  </span>
                  <ChevronRight size={11} className={`transition-transform ${showSessionPicker ? 'rotate-90' : ''}`} />
                </button>
                {showSessionPicker && (
                  <div className="border-t border-[rgb(var(--color-surface-4))] mt-1 pt-1">
                    {sessions.map(s => (
                      <button
                        key={s.id}
                        className={`${MENU_ITEM} pl-8`}
                        onClick={() => { onOpenInSession(contextMenu.note, s.id); setContextMenu(null); setShowSessionPicker(false) }}
                      >
                        {s.icon && <span className="mr-1">{s.icon}</span>}
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Divider + Delete */}
            {onDelete && (
              <>
                <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
                <button
                  className={`${MENU_ITEM} text-red-400 hover:text-red-300 hover:bg-red-500/10`}
                  onClick={() => { onDelete(contextMenu.note); setContextMenu(null) }}
                >
                  <Trash2 size={13} className="flex-shrink-0" />
                  Delete
                </button>
              </>
            )}
          </div>
        )
      })()}
    </>
  )
}
