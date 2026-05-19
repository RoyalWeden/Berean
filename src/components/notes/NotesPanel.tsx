import { Plus } from 'lucide-react'
import NotesList from './NotesList'

export default function NotesPanel() {
  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
        <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Notes</span>
        <button
          title="New note"
          className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-default"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <NotesList />
      </div>
    </div>
  )
}
