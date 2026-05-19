import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { useAppStore } from '@/store'

export default function FloatingSearch() {
  const searchOpen = useAppStore((s) => s.searchOpen)
  const closeSearch = useAppStore((s) => s.closeSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [searchOpen])

  return (
    <Dialog.Root open={searchOpen} onOpenChange={(open) => !open && closeSearch()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 animate-in fade-in-0" />
        <Dialog.Content
          className="
            fixed left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2
            z-50 w-full max-w-lg
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden
            animate-in fade-in-0 zoom-in-95
          "
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>

          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgb(var(--color-surface-4))]">
            <Search size={18} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search verses, notes, Strong's numbers..."
              className="
                flex-1 bg-transparent text-[rgb(var(--color-text-primary))]
                placeholder:text-[rgb(var(--color-text-muted))] text-sm outline-none
              "
            />
            <button
              onClick={closeSearch}
              className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Placeholder hint */}
          <div className="px-4 py-6 text-center text-sm text-[rgb(var(--color-text-muted))]">
            <p>Full search coming in Phase 2.</p>
            <p className="text-xs mt-1 opacity-60">Try: <span className="font-mono">Gen 1:1</span> · <span className="font-mono">H7225</span> · <span className="font-mono">in the beginning</span></p>
          </div>

          {/* Keyboard hint */}
          <div className="px-4 py-2 border-t border-[rgb(var(--color-surface-4))] flex items-center gap-4 text-xs text-[rgb(var(--color-text-muted))]">
            <span><kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">↵</kbd> Open</span>
            <span><kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> Close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
