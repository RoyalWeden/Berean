import { Search } from 'lucide-react'

export default function SearchTab() {
  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      <div className="flex items-center px-4 py-2 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
        <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Search</span>
      </div>
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-12 text-center">
        <Search size={32} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-40" />
        <p className="text-sm text-[rgb(var(--color-text-secondary))]">Full-text search</p>
        <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">
          Press <kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded text-[10px]">⌘K</kbd> to open the search bar.
        </p>
      </div>
    </div>
  )
}
