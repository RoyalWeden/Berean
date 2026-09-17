import { useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { TextField, IconButton, SegmentedControl } from '@/components/ui'

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

  // Auto-dismiss (autoOpen-only) countdown lives in App.tsx and previously only
  // reset on printable-character keydowns while the input already had focus —
  // hovering the bar to read a match, or clicking into it, didn't count as
  // "still using it" and it could vanish out from under the pointer. Pausing
  // on hover-enter (not just resetting) means it genuinely never counts down
  // while the cursor is resting on it, resuming a fresh countdown on
  // hover-leave; click/focus resets it the same way a keystroke does.
  function pauseAutoDismiss() {
    if (autoOpen) window.dispatchEvent(new Event('berean:findBarPauseTimer'))
  }
  function resetAutoDismiss() {
    if (autoOpen) window.dispatchEvent(new Event('berean:findBarResetTimer'))
  }

  return (
    <div
      className="material-popover fixed z-overlay rounded-menu overflow-hidden transition-[right] duration-150 animate-fade-in-drop"
      style={{ top: 50, right: rightOffset, width: 360 }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={pauseAutoDismiss}
      onMouseLeave={resetAutoDismiss}
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        <TextField
          ref={inputRef}
          size="sm"
          bare
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev?.() : onNext?.() }
          }}
          onClick={resetAutoDismiss}
          onFocus={resetAutoDismiss}
          placeholder={placeholder}
          spellCheck={false}
          className={noMatch ? 'text-destructive' : undefined}
          wrapperClassName="flex-1 min-w-0"
        />

        {/* Match counter */}
        {hasMatches && (
          <span className="text-caption text-text-muted flex-shrink-0 tabular-nums">
            {matchCount === 0
              ? 'No matches'
              : `${(currentMatch ?? 0) + 1} / ${matchCount}`}
          </span>
        )}

        {/* Prev / Next arrows */}
        {onPrev && (
          <IconButton
            icon={ChevronUp}
            label="Previous match"
            tooltip={{ shortcut: '⇧↵' }}
            size={24}
            onClick={onPrev}
            disabled={!hasMatches || matchCount === 0}
          />
        )}
        {onNext && (
          <IconButton
            icon={ChevronDown}
            label="Next match"
            tooltip={{ shortcut: '↵' }}
            size={24}
            onClick={onNext}
            disabled={!hasMatches || matchCount === 0}
          />
        )}

        {/* Auto-open badge */}
        {autoOpen && (
          <span className="text-micro text-text-muted px-1.5 py-0.5 rounded-chip bg-surface-4 flex-shrink-0 uppercase tracking-wide">
            auto
          </span>
        )}

        {/* Close */}
        <IconButton icon={X} label="Close" tooltip={{ shortcut: 'Esc' }} size={24} onClick={onClose} className="flex-shrink-0" />
      </div>

      {/* Word mode toggle row */}
      {showWordMode && (
        <div className="px-3 py-1.5 bg-surface-4/25 border-t border-separator flex items-center gap-1.5">
          <span className="text-micro uppercase tracking-wider text-text-muted flex-shrink-0">Match</span>
          <SegmentedControl
            size="sm"
            aria-label="Word match mode"
            value={wordMode}
            onChange={(m) => onWordModeChange?.(m)}
            options={[
              { value: 'phrase', label: 'Phrase' },
              { value: 'all', label: 'All words' },
              { value: 'any', label: 'Any word' },
            ]}
          />
        </div>
      )}

      {/* Advanced search row (scripture context only) */}
      {showAdvancedSearch && (
        <div className="px-3 py-1.5 bg-surface-4/25 border-t border-separator flex items-center justify-between">
          <span className="text-caption2 text-text-muted">Find in page</span>
          <button
            onClick={handleAdvancedSearch}
            className="text-caption2 text-accent hover:underline cursor-pointer"
          >
            Advanced scripture search →
          </button>
        </div>
      )}
    </div>
  )
}
