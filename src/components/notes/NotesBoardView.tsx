import { useState } from 'react'
import type { CircleDashed } from 'lucide-react'
import type { Note, NoteStatus } from '@/types'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { NoteBadgeRow } from './NoteBadgeRow'

interface Props {
  notes: Note[]
  onSelect: (note: Note) => void
  onSetStatus: (note: Note, status: NoteStatus | null) => void
}

interface Column { id: NoteStatus; label: string; color: string; icon: typeof CircleDashed }

const COLUMNS: Column[] = NOTE_STATUSES.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon }))

// Kanban-style board, one column per status. Notes with no status don't appear on the board at
// all (the board is specifically for status-tracked notes — use the list/folder view for
// everything else). Dragging a card to a different column calls onSetStatus, same mutation the
// editor-header dropdown and context-menu picker use.
export default function NotesBoardView({ notes, onSelect, onSetStatus }: Props) {
  const [dragNote, setDragNote] = useState<Note | null>(null)
  const [dragOverCol, setDragOverCol] = useState<Column['id'] | null>(null)

  const byColumn = new Map<Column['id'], Note[]>(COLUMNS.map((c) => [c.id, []]))
  for (const note of notes) {
    if (note.status && byColumn.has(note.status)) byColumn.get(note.status)!.push(note)
  }

  return (
    <div className="flex h-full gap-2 overflow-x-auto p-2">
      {COLUMNS.map((col) => {
        const Icon = col.icon
        const colNotes = byColumn.get(col.id) ?? []
        return (
          <div
            key={col.id}
            // Flat column background, no border by default — a border/ring only appears as an
            // active drop-target signal while dragging. Columns are told apart by their header's
            // colored accent instead of a boxed outline around the whole column.
            className={`flex flex-col flex-shrink-0 w-56 rounded-shell-lg transition-colors
              ${dragOverCol === col.id
                ? 'ring-1 ring-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/5]'
                : 'bg-[rgb(var(--color-surface-2))]'
              }`}
            onDragOver={(e) => { if (dragNote) { e.preventDefault(); setDragOverCol(col.id) } }}
            onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault()
              setDragOverCol(null)
              if (dragNote) onSetStatus(dragNote, col.id)
              setDragNote(null)
            }}
          >
            <div className="flex items-center gap-1.5 px-3 py-2.5 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
              <Icon size={13} style={{ color: col.color }} />
              <span className="text-xs font-medium text-[rgb(var(--color-text-secondary))] flex-1">{col.label}</span>
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] tabular-nums">{colNotes.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2 space-y-2 min-h-[80px]">
              {colNotes.map((note) => {
                const rawSnippet = note.type === 'idiom' && note.idiomMeaning
                  ? note.idiomMeaning
                  : stripMarkdownFormatting(note.content).trim()
                const snippet = rawSnippet.replace(/\s+/g, ' ')
                return (
                  <div
                    key={note.id}
                    draggable
                    onDragStart={(e) => { setDragNote(note); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setDragNote(null); setDragOverCol(null) }}
                    onClick={() => onSelect(note)}
                    // No border — a soft shadow reads as "a card sitting on this column"
                    // without needing a hard outline around every single one, which felt
                    // heavy/boxy in practice. Shadow deepens slightly on hover for a bit of
                    // tactile lift.
                    className="rounded-shell bg-[rgb(var(--color-surface-3))] shadow-sm hover:shadow-md px-2.5 py-2 cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-[background-color,box-shadow]"
                  >
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] truncate">
                      {note.title || 'Untitled'}
                    </p>
                    {snippet && (
                      <p
                        className="text-xs text-[rgb(var(--color-text-muted))] mt-0.5"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {snippet}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <NoteBadgeRow note={note} size="sm" showStatus={false} />
                    </div>
                  </div>
                )
              })}
              {colNotes.length === 0 && (
                <div className="text-[11px] text-[rgb(var(--color-text-muted))] italic px-1 py-2 text-center">
                  Drop a note here
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
