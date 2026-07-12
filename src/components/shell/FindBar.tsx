import { useEffect, useRef } from 'react'
import { X, ChevronUp, ChevronDown, Search } from 'lucide-react'
import { useAppStore } from '@/store'

type WordMode = 'phrase' | 'all' | 'any'

interface Props {
  visible: boolean
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
  matchCount?: number
  currentMatch?: number     // 0-indexed
  onPrev?: () => void
  onNext?: () => void
  autoOpen?: boolean        // if true, shows subtle "auto" badge and bar has lighter weight
  placeholder?: string
  showAdvancedSearch?: boolean  // show "Advanced search" link (scripture context)
  onAdvancedSearch?: () => void
  rightOffset?: number      // px from right edge (default 16); increases when side panel is open
  showWordMode?: boolean    // show phrase/all/any toggle (scripture context)
  wordMode?: WordMode
  onWordModeChange?: (mode: WordMode) => void
}

export default function FindBar({
  visible,
  query,
  onQueryChange,
  onClose,
  matchCount,
  currentMatch,
  onPrev,
  onNext,
  autoOpen,
  placeholder = 'Find in page…',
  showAdvancedSearch,
  onAdvancedSearch,
  rightOffset = 16,
  showWordMode,
  wordMode = 'phrase',
  onWordModeChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openSearchTab = useAppStore((s) => s.openSearchTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const ensureTab = useAppStore((s) => s.ensureTab)

  // Focus and select when the bar becomes visible (initial open)
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => {
      inputRef.current?.focus()
      if (!autoOpen) inputRef.current?.select()   // select-all only for explicit Cmd+F
    }, 20)
    return () => clearTimeout(t)
  }, [visible, autoOpen])

  // Select all when Cmd+F is pressed while bar is already open
  useEffect(() => {
    function onSelectAll() {
      if (visible) {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('berean:findBarSelectAll', onSelectAll)
    return () => window.removeEventListener('berean:findBarSelectAll', onSelectAll)
  }, [visible])

  if (!visible) return null

  const hasMatches = typeof matchCount === 'number'
  const noMatch = hasMatches && matchCount === 0 && query.length > 0

  function handleAdvancedSearch() {
    if (onAdvancedSearch) {
      onAdvancedSearch()
    } else {
      openSearchTab(query)
      setActiveSpace('search')
      ensureTab('search')
    }
    onClose()
  }

  return (
    <div
      className="glass-panel fixed z-[200] rounded-shell-lg overflow-hidden transition-[right] duration-150 animate-fade-in-drop"
      style={{ top: 50, right: rightOffset, width: 360 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev?.() : onNext?.() }
          }}
          placeholder={placeholder}
          spellCheck={false}
          className={`flex-1 bg-transparent text-sm outline-none min-w-0 placeholder:text-[rgb(var(--color-text-muted))] ${
            noMatch ? 'text-red-400' : 'text-[rgb(var(--color-text-primary))]'
          }`}
        />

        {/* Match counter */}
        {hasMatches && (
          <span className="text-[11px] text-[rgb(var(--color-text-muted))] flex-shrink-0 tabular-nums">
            {matchCount === 0
              ? 'No matches'
              : `${(currentMatch ?? 0) + 1} / ${matchCount}`}
          </span>
        )}

        {/* Prev / Next arrows */}
        {onPrev && (
          <button
            onClick={onPrev}
            title="Previous match (⇧↵)"
            disabled={!hasMatches || matchCount === 0}
            className="p-0.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronUp size={13} />
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            title="Next match (↵)"
            disabled={!hasMatches || matchCount === 0}
            className="p-0.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronDown size={13} />
          </button>
        )}

        {/* Auto-open badge */}
        {autoOpen && (
          <span className="text-[9px] text-[rgb(var(--color-text-muted))] px-1.5 py-0.5 rounded-shell bg-[rgb(var(--color-surface-4))] flex-shrink-0 uppercase tracking-wide">
            auto
          </span>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="p-0.5 rounded-shell hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
        >
          <X size={13} />
        </button>
      </div>

      {/* Word mode toggle row */}
      {showWordMode && (
        <div className="px-3 py-1.5 bg-[rgb(var(--color-surface-4))/25] border-t border-[rgb(var(--color-surface-4))] flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] flex-shrink-0">Match</span>
          {(['phrase', 'all', 'any'] as WordMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onWordModeChange?.(m)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${
                wordMode === m
                  ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white'
                  : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'
              }`}
            >
              {m === 'phrase' ? 'Phrase' : m === 'all' ? 'All words' : 'Any word'}
            </button>
          ))}
        </div>
      )}

      {/* Advanced search row (scripture context only) */}
      {showAdvancedSearch && (
        <div className="px-3 py-1.5 bg-[rgb(var(--color-surface-4))/25] border-t border-[rgb(var(--color-surface-4))] flex items-center justify-between">
          <span className="text-[10px] text-[rgb(var(--color-text-muted))]">Find in page</span>
          <button
            onClick={handleAdvancedSearch}
            className="text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
          >
            Advanced scripture search →
          </button>
        </div>
      )}
    </div>
  )
}
