import { FileText } from 'lucide-react'

export default function NotesList() {
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
