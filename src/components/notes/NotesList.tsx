import { useState, useEffect, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { NotepadText, Trash2, CheckSquare, Square, Pin, PinOff } from 'lucide-react'
import { applyFindHighlight } from '@/lib/highlight'
import { isSystemNote } from '@/lib/noteUtils'
import NoteContextMenu, { type SessionInfo } from './NoteContextMenu'
import ShortcutKeys from '@/components/shell/ShortcutKeys'
import type { Note, NoteStatus } from '@/types'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { NoteBadgeRow } from './NoteBadgeRow'
import NoteIcon from './NoteIcon'

// Build up to `max` truncated snippets around occurrences of `query` in `content`.
export function contentSnippets(content: string, query: string, max = 3): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const text = stripMarkdownFormatting(content).replace(/\s+/g, ' ').trim()
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
  /** Ref to the scrollable ancestor (owned by NotesPanel) — read by the virtualizer
   *  so only visible rows are mounted regardless of total note count. */
  scrollParentRef: React.RefObject<HTMLDivElement>
  onSelect: (note: Note) => void
  /** Single-click behaviour when the home preview panel is showing — select + preview
   *  instead of opening the editor. Double-click still calls onSelect (open). */
  onPreview?: (note: Note) => void
  /** Id of the note currently previewed in the home panel — gets a persistent selected look. */
  previewNoteId?: string | null
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
  onConvertToIdiom?: (note: Note) => void
  onExportPdf?: (note: Note) => void
  onSetStatus?: (note: Note, status: NoteStatus | null) => void
  onTogglePinned?: (note: Note) => void
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

export default function NotesList({
  notes, scrollParentRef, onSelect, onPreview, previewNoteId, onDelete, findQuery, searchQuery,
  selectMode = false, selected = [], onToggleSelect,
  expandAll = false,
  onOpenNewTab, onRenameCommit, onOpenInFloatingTab, onOpenInSession, sessions, onOpenInTab, onConvertToIdiom, onExportPdf, onSetStatus,
  onTogglePinned,
}: NotesListProps) {
  const [contextMenu, setContextMenu] = useState<{ note: Note; x: number; y: number } | null>(null)
  // Pinned notes float to the top — a stable sort (pinned notes otherwise keep their original
  // relative order among themselves, same for unpinned) so this doesn't fight whatever sort/
  // filter order the caller already applied beyond the pin/unpin split itself.
  const sortedNotes = useMemo(
    () => notes.length === 0 ? notes : [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)),
    [notes],
  )
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

  // Only visible rows are mounted, regardless of total note count — mounting/
  // unmounting a fully flat DOM list of every note (no windowing at all before
  // this) is what made switching into list view feel like a multi-second stall
  // once a note collection grew into the hundreds.
  const virtualizer = useVirtualizer({
    count: sortedNotes.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 84,
    overscan: 8,
  })

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
        <NotepadText size={32} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-40" />
        <p className="text-sm text-[rgb(var(--color-text-secondary))]">No notes yet</p>
        <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">
          Click a verse number to add a verse note, or press{' '}
          <ShortcutKeys keys="⌘⇧N" className="align-middle" />{' '}
          for a general note.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const note = sortedNotes[virtualRow.index]
          const rawSnippet = note.type === 'idiom' && note.idiomMeaning
            ? note.idiomMeaning
            : stripMarkdownFormatting(note.content).trim()
          const snippet = expandAll
            ? rawSnippet
            : rawSnippet.replace(/\n/g, ' ')
          const isSelected = selected.includes(note.id)
          // Previewed in the home side panel (single-click) — a distinct, clearly visible
          // "this is the one you're looking at" state, separate from multi-select.
          const isPreviewed = !selectMode && !!previewNoteId && note.id === previewNoteId
          const isRenaming = renamingNoteId === note.id
          const snippets = searchQuery ? contentSnippets(note.content, searchQuery) : []

          return (
            <div
              key={note.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              // Thin hairline between rows — dropping the per-row border/fill (see the inner
              // card's own comment) left completely flat, unbroken rows with nothing to read
              // by at a glance when not hovering; this restores just enough structure without
              // going back to a full box around every entry. Skipped on the very last note.
              className={`absolute top-0 left-0 w-full px-2 py-0.5 ${
                virtualRow.index < sortedNotes.length - 1 ? 'border-b border-[rgb(var(--color-surface-4))/40]' : ''
              }`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
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
              // Flat by default — no border, no idle fill — with just a soft tint on hover/select
              // and the Linear-style accent bar below for the "this one's active" signal. The
              // previous bordered-card-per-row treatment (bg + border on every single row) read
              // as visually heavy/boxy and out of step with the rest of the app's flatter UI.
              className={`relative group flex items-stretch rounded-shell transition-colors overflow-hidden
                ${isPreviewed
                  ? 'bg-[rgb(var(--color-accent))/15] ring-1 ring-inset ring-[rgb(var(--color-accent))/40]'
                  : isSelected
                  ? 'bg-[rgb(var(--color-accent))/8]'
                  : 'hover:bg-[rgb(var(--color-surface-3))]'
                }`}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (selectMode) return
                setContextMenu({ note, x: e.clientX, y: e.clientY })
              }}
            >
              {/* Linear-style left accent bar — solid when selected/previewed, fades in on hover */}
              <div
                className={`absolute left-0 top-0 bottom-0 bg-[rgb(var(--color-accent))] origin-center transition-transform duration-100
                  ${isPreviewed ? 'w-1' : 'w-0.5'}
                  ${isSelected || isPreviewed ? 'scale-y-100' : 'scale-y-0 group-hover:scale-y-100'}`}
              />

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
                    (onPreview ?? onSelect)(note)
                  }
                }}
                onDoubleClick={() => { if (!isRenaming && !selectMode) onSelect(note) }}
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
                  <span className="flex items-center gap-1 w-full min-w-0">
                    <NoteIcon icon={note.icon} size={13} />
                    <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] truncate">
                      {findQuery ? applyFindHighlight(note.title || 'Untitled', findQuery) : (note.title || 'Untitled')}
                    </span>
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
                      <NoteBadgeRow note={note} />
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

              {/* Pin toggle — a pinned note's icon stays visible always (so pinned status
                  reads at a glance without hovering); an unpinned note's only shows on hover,
                  matching the delete button's own reveal-on-hover convention below. Sits left
                  of delete (right-9 vs right-2) so the two never overlap. */}
              {onTogglePinned && !selectMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTogglePinned(note) }}
                  className={`
                    absolute right-9 top-1/2 -translate-y-1/2
                    p-1.5 rounded transition-opacity cursor-pointer
                    ${note.pinned
                      ? 'text-[rgb(var(--color-accent))] opacity-100'
                      : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] opacity-0 group-hover:opacity-100'
                    }
                  `}
                  title={note.pinned ? 'Unpin note' : 'Pin note'}
                >
                  {note.pinned ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
                </button>
              )}

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
          onConvertToIdiom={onConvertToIdiom}
          onExportPdf={onExportPdf}
          onSetStatus={onSetStatus}
        />
      )}
    </>
  )
}
