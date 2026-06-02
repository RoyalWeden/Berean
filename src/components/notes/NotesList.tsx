import { useState, useEffect, useRef } from 'react'
import { FileText, Trash2, CheckSquare, Square } from 'lucide-react'
import { bookName } from '@/lib/parseRef'
import { applyFindHighlight } from '@/lib/highlight'
import { isSystemNote } from '@/lib/noteUtils'
import NoteContextMenu, { type SessionInfo } from './NoteContextMenu'
import type { Note } from '@/types'

// Build up to `max` truncated snippets around occurrences of `query` in `content`.
export function contentSnippets(content: string, query: string, max = 3): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const text = content.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const out: string[] = []
  let from = 0
  while (out.length < max) {
    const idx = lower.indexOf(q, from)
    if (idx === -1) break
    const start = Math.max(0, idx - 32)
    const end = Math.min(text.length, idx + q.length + 32)
    let s = text.slice(start, end)
    if (start > 0) s = '…' + s
    if (end < text.length) s = s + '…'
    out.push(s)
    from = idx + q.length
  }
  return out
}

interface NotesListProps {
  notes: Note[]
  onSelect: (note: Note) => void
  onDelete?: (note: Note) => void
  findQuery?: string
  searchQuery?: string
  selectMode?: boolean
  selected?: string[]
  onToggleSelect?: (noteId: string) => void
  expandAll?: boolean
  onOpenNewTab?: (note: Note) => void
  onRenameCommit?: (noteId: string, newTitle: string) => void
  onOpenInFloatingTab?: (note: Note) => void
  onOpenInSession?: (note: Note, sessionId: string) => void
  sessions?: SessionInfo[]
  onOpenInTab?: (note: Note) => void
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

export default function NotesList({
  notes, onSelect, onDelete, findQuery, searchQuery,
  selectMode = false, selected = [], onToggleSelect,
  expandAll = false,
  onOpenNewTab, onRenameCommit, onOpenInFloatingTab, onOpenInSession, sessions, onOpenInTab,
}: NotesListProps) {
  const [contextMenu, setContextMenu] = useState<{ note: Note; x: number; y: number } | null>(null)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Track the note being dragged so onDragEnd can open floating tab if dropped off-app
  const draggingNoteRef = useRef<Note | null>(null)

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingNoteId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingNoteId])

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
          const snippets = searchQuery ? contentSnippets(note.content, searchQuery) : []

          return (
            <div key={note.id}>
            <div
              draggable={!selectMode && !renamingNoteId}
              onDragStart={(e) => {
                draggingNoteRef.current = note
                e.dataTransfer.setData('berean-note-id', note.id)
                e.dataTransfer.setData('berean-note-title', note.title || 'Untitled')
                e.dataTransfer.effectAllowed = 'copyMove'
              }}
              onDragEnd={(e) => {
                const note = draggingNoteRef.current
                draggingNoteRef.current = null
                if (!note) return
                const inside = e.clientX > 0 && e.clientX < window.innerWidth &&
                               e.clientY > 0 && e.clientY < window.innerHeight
                if (!inside) {
                  // Dropped off the app window → open as floating tab
                  window.app.openFloatingTab('notes', { noteId: note.id }).catch?.(() => {})
                }
              }}
              className={`relative group flex items-stretch transition-colors
                ${isSelected
                  ? 'bg-[rgb(var(--color-accent))/10]'
                  : 'hover:bg-[rgb(var(--color-surface-4))]'
                }`}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (selectMode) return
                setContextMenu({ note, x: e.clientX, y: e.clientY })
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
                    <span
                      className={`text-xs text-[rgb(var(--color-text-muted))] w-full ${expandAll ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}`}
                      style={expandAll ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    >
                      {findQuery
                        ? applyFindHighlight(snippet || 'Empty note', findQuery)
                        : (snippet || 'Empty note')}
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
            {/* In-note search matches — truncated snippets with the match highlighted */}
            {snippets.length > 0 && (
              <div className="flex flex-col gap-1 px-4 pb-2 pt-0.5">
                {snippets.map((s, i) => (
                  <div
                    key={i}
                    onClick={() => onSelect(note)}
                    className="text-[11px] leading-snug text-[rgb(var(--color-text-secondary))] bg-[rgb(var(--color-surface-4))/40] rounded px-2 py-1 cursor-pointer hover:bg-[rgb(var(--color-surface-4))]"
                  >
                    {applyFindHighlight(s, searchQuery!)}
                  </div>
                ))}
              </div>
            )}
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <NoteContextMenu
          note={contextMenu.note}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onSelect={onSelect}
          onOpenNewTab={onOpenNewTab}
          onOpenInFloatingTab={onOpenInFloatingTab}
          onRename={onRenameCommit ? (note) => { setRenameValue(note.title || ''); setRenamingNoteId(note.id) } : undefined}
          onDelete={onDelete}
          onOpenInSession={onOpenInSession}
          sessions={sessions}
        />
      )}
    </>
  )
}
