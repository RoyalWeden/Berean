import { useState } from 'react'
import type { CircleDashed } from 'lucide-react'
import type { Note, NoteStatus } from '@/types'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { NoteBadgeRow } from './NoteBadgeRow'
import NoteIcon from './NoteIcon'
import { SectionHeader, cx } from '@/components/ui'

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
    <div className="flex h-full gap-3 overflow-x-auto px-3 py-2">
      {COLUMNS.map((col) => {
        const Icon = col.icon
        const colNotes = byColumn.get(col.id) ?? []
        return (
          <div
            key={col.id}
            // Flat column background, no border by default — a border/ring only appears as an
            // active drop-target signal while dragging. Columns are told apart by their header's
            // colored accent instead of a boxed outline around the whole column.
            // Columns share the width (196–300 px each) and only scroll sideways when the window
            // can't fit them — a fixed 224 px column cut the fifth one off at 1440 px. No filled
            // panel behind every column (five full-height grey slabs dominated an empty board):
            // the column is a lane, and lights up only as an active drop target.
            className={cx(
              'flex flex-col flex-1 min-w-[196px] max-w-[300px] rounded-menu transition-colors',
              dragOverCol === col.id ? 'ring-1 ring-accent/40 bg-accent-muted' : '',
            )}
            onDragOver={(e) => { if (dragNote) { e.preventDefault(); setDragOverCol(col.id) } }}
            onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault()
              setDragOverCol(null)
              if (dragNote) onSetStatus(dragNote, col.id)
              setDragNote(null)
            }}
          >
            <SectionHeader count={colNotes.length}>
              <span className="inline-flex items-center gap-1.5">
                <Icon size={13} style={{ color: col.color }} />
                <span data-testid="board-col-title">{col.label}</span>
              </span>
            </SectionHeader>
            <div className="flex-1 overflow-y-auto px-1 pt-1 pb-2 space-y-2 min-h-[80px]">
              {colNotes.map((note) => {
                const rawSnippet = note.type === 'idiom' && note.idiomMeaning
                  ? note.idiomMeaning
                  : stripMarkdownFormatting(note.content).trim()
                const flat = rawSnippet.replace(/\s+/g, ' ')
                // A body that opens with `# <title>` would repeat the card's title.
                const t = (note.title ?? '').trim()
                const snippet = t && flat.toLowerCase().startsWith(t.toLowerCase()) ? flat.slice(t.length).trim() : flat
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => { setDragNote(note); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setDragNote(null); setDragOverCol(null) }}
                    onClick={() => onSelect(note)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(note) } }}
                    // No border — a soft shadow reads as "a card sitting on this column"
                    // without needing a hard outline around every single one, which felt
                    // heavy/boxy in practice.
                    className={cx(
                      'focus-ring rounded-card control-glass shadow-1 hover:shadow-2 px-3 py-2.5 cursor-pointer transition-[background-color,box-shadow,opacity]',
                      dragNote?.id === note.id && 'opacity-40',
                    )}
                  >
                    <p className="flex items-center gap-1 min-w-0">
                      {note.icon && <NoteIcon icon={note.icon} size={14} />}
                      <span className="text-footnote font-semibold text-text-primary truncate">
                        {note.title || 'Untitled'}
                      </span>
                    </p>
                    {snippet && (
                      <p
                        className="text-footnote text-text-muted mt-0.5"
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
                // A short, quiet drop zone — it says notes can go here without the empty column
                // out-weighing the populated ones.
                <div className={cx(
                  'h-16 rounded-card border border-dashed flex items-center justify-center text-caption text-text-tertiary transition-colors',
                  dragOverCol === col.id ? 'border-accent/60 text-accent' : 'border-separator',
                )}>
                  {dragNote ? 'Drop here' : 'No notes'}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
