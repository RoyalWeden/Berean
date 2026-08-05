import { useState } from 'react'
import { CircleDashed } from 'lucide-react'
import type { Note, NoteStatus } from '@/types'
import { NOTE_STATUSES } from '@/lib/noteStatus'

interface Props {
  notes: Note[]
  onSelect: (note: Note) => void
  onSetStatus: (note: Note, status: NoteStatus | null) => void
}

interface Column { id: NoteStatus | 'none'; label: string; color: string; icon: typeof CircleDashed }

const COLUMNS: Column[] = [
  { id: 'none', label: 'No status', color: '#9ca3af', icon: CircleDashed },
  ...NOTE_STATUSES.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon })),
]

// Kanban-style board, one column per status (+ "No status"). Notes always show in exactly one
// column — status is not hidden/auto-archived (per the user's decision that Archive behaves
// like any other status, not a soft-hide). Dragging a card to a different column calls
// onSetStatus, same mutation the editor-header dropdown and context-menu picker use.
export default function NotesBoardView({ notes, onSelect, onSetStatus }: Props) {
  const [dragNote, setDragNote] = useState<Note | null>(null)
  const [dragOverCol, setDragOverCol] = useState<Column['id'] | null>(null)

  const byColumn = new Map<Column['id'], Note[]>(COLUMNS.map((c) => [c.id, []]))
  for (const note of notes) {
    const col = (note.status && byColumn.has(note.status)) ? note.status : 'none'
    byColumn.get(col)!.push(note)
  }

  return (
    <div className="flex h-full gap-2 overflow-x-auto p-2">
      {COLUMNS.map((col) => {
        const Icon = col.icon
        const colNotes = byColumn.get(col.id) ?? []
        return (
          <div
            key={col.id}
            className={`flex flex-col flex-shrink-0 w-56 rounded-shell-lg border transition-colors
              ${dragOverCol === col.id
                ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/5]'
                : 'border-[rgb(var(--color-surface-4))/60] bg-[rgb(var(--color-surface-2))]'
              }`}
            onDragOver={(e) => { if (dragNote) { e.preventDefault(); setDragOverCol(col.id) } }}
            onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault()
              setDragOverCol(null)
              if (dragNote) onSetStatus(dragNote, col.id === 'none' ? null : col.id)
              setDragNote(null)
            }}
          >
            <div className="flex items-center gap-1.5 px-2.5 py-2 flex-shrink-0 border-b border-[rgb(var(--color-surface-4))/60]">
              <Icon size={13} style={{ color: col.color }} />
              <span className="text-xs font-medium text-[rgb(var(--color-text-secondary))] flex-1">{col.label}</span>
              <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{colNotes.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-1.5 min-h-[80px]">
              {colNotes.map((note) => (
                <div
                  key={note.id}
                  draggable
                  onDragStart={(e) => { setDragNote(note); e.dataTransfer.effectAllowed = 'move' }}
                  onDragEnd={() => { setDragNote(null); setDragOverCol(null) }}
                  onClick={() => onSelect(note)}
                  className="rounded-shell bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))/60] px-2.5 py-2 cursor-pointer hover:border-[rgb(var(--color-accent))/40] transition-colors"
                >
                  <p className="text-xs font-medium text-[rgb(var(--color-text-primary))] truncate">
                    {note.title || 'Untitled'}
                  </p>
                  {note.content && (
                    <p className="text-[11px] text-[rgb(var(--color-text-muted))] line-clamp-2 mt-0.5">
                      {note.content.replace(/[#*_`>[\]]/g, ' ').trim()}
                    </p>
                  )}
                </div>
              ))}
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
