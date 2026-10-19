import { useEffect, useLayoutEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, X, Search } from 'lucide-react'
import { useAppStore } from '@/store'
import { IconButton, SegmentedControl, Button, cx } from '@/components/ui'

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
  autoOpen?: boolean        // opened by typing (auto-dismisses) rather than ⌘F
  placeholder?: string
  showAdvancedSearch?: boolean  // show "Advanced Search" (scripture context)
  onAdvancedSearch?: () => void
  rightOffset?: number      // px from the panel's right edge (default 16); grows with the side panel
  showWordMode?: boolean    // show phrase/all/any toggle (scripture context)
  wordMode?: WordMode
  onWordModeChange?: (mode: WordMode) => void
  /** Window event that re-selects the query (⌘F while open). Each bar has its own, so ⌘F in one
   *  place never pulls focus into another bar. */
  selectAllEvent?: string
}

/** Gap between the window toolbar (the panel's top edge) and the bar. */
export const FIND_BAR_TOP = 8

/**
 * Find-in-page bar for the Scripture, Notes and Lexicon panels and Berean Chat's conversations: one compact row (field, match
 * count, previous / next, close) on the popover material, with Scripture's match mode and
 * Advanced Search in a quieter second row.
 *
 * Positioning: `absolute`, anchored to its panel (every host is `position: relative` and starts
 * right under the window toolbar). It used to be `fixed` with `top: 50` — measured from the
 * window in Notes/Lexicon (overlapping the toolbar's edge) but from the Scripture pane in the
 * reader, whose `container-type` makes it the containing block for fixed children, so there it
 * sat 50px below the toolbar ("too low").
 *
 * Focus: established in a layout effect (same frame the input exists), caret at the end — keys
 * already appended to the query during a handoff stay in order and later keys type straight in
 * (lib/findHandoff.ts). The material is the CSS popover material, not native Liquid Glass (on
 * macOS native glass draws behind the page and would be hidden under the reader).
 */
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
  placeholder = 'Find in Page',
  showAdvancedSearch,
  onAdvancedSearch,
  rightOffset = 16,
  showWordMode,
  wordMode = 'phrase',
  onWordModeChange,
  selectAllEvent = 'berean:findBarSelectAll',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openSearchTab = useAppStore((s) => s.openSearchTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const ensureTab = useAppStore((s) => s.ensureTab)

  // Focus as soon as the bar exists. ⌘F selects what is there; type-to-find keeps the caret at
  // the end of what was typed so far.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!visible || !el) return
    const take = () => {
      el.focus({ preventScroll: true })
      if (autoOpen) { const n = el.value.length; el.setSelectionRange(n, n) } else el.select()
    }
    take()
    // A closing overlay's focus trap (the floating search, Radix) is torn down only in its passive
    // effects — in this same commit it can pull focus back, and then releases it to <body>. Take it
    // again on the next frame, unless something real (another field) holds it by then.
    const raf = requestAnimationFrame(() => {
      const a = document.activeElement
      if (a !== el && (!a || a === document.body)) take()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, autoOpen])

  // ⌘F while the bar is already open: select the query again.
  useEffect(() => {
    function onSelectAll() {
      if (visible) {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener(selectAllEvent, onSelectAll)
    return () => window.removeEventListener(selectAllEvent, onSelectAll)
  }, [visible, selectAllEvent])

  if (!visible) return null

  const hasMatches = typeof matchCount === 'number' && query.length > 0
  const noMatch = hasMatches && matchCount === 0
  const navDisabled = !hasMatches || matchCount === 0

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

  // Type-to-find auto-dismisses (App.tsx); hovering pauses the countdown, a click / focus resets it.
  function pauseAutoDismiss() {
    if (autoOpen) window.dispatchEvent(new Event('berean:findBarPauseTimer'))
  }
  function resetAutoDismiss() {
    if (autoOpen) window.dispatchEvent(new Event('berean:findBarResetTimer'))
  }

  const secondRow = showWordMode || showAdvancedSearch

  return (
    <div
      role="search"
      aria-label="Find in page"
      data-find-bar
      className="find-bar material-popover absolute z-overlay rounded-[14px] overflow-hidden animate-fade-in-drop"
      style={{ top: FIND_BAR_TOP, right: rightOffset, width: 'min(380px, calc(100% - 24px))' }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={pauseAutoDismiss}
      onMouseLeave={resetAutoDismiss}
    >
      <div className="flex items-center gap-1 h-9 pl-2.5 pr-1">
        <Search size={13} strokeWidth={2} className="flex-shrink-0 text-text-muted" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev?.(); else onNext?.() }
          }}
          onClick={resetAutoDismiss}
          onFocus={resetAutoDismiss}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={cx('find-bar-input flex-1 min-w-0 h-7 px-1.5 bg-transparent outline-none text-footnote text-text-primary placeholder:text-text-muted', noMatch && 'text-destructive')}
        />
        {hasMatches && (
          <span className="flex-shrink-0 px-1 text-caption2 tabular-nums text-text-muted" aria-live="polite">
            {matchCount === 0 ? 'No Matches' : `${(currentMatch ?? 0) + 1} of ${matchCount}`}
          </span>
        )}
        {(onPrev || onNext) && <span className="w-px h-4 mx-0.5 bg-separator flex-shrink-0" aria-hidden />}
        {onPrev && <IconButton icon={ChevronUp} label="Previous Match" tooltip={{ shortcut: '⇧↵' }} size={24} onClick={onPrev} disabled={navDisabled} />}
        {onNext && <IconButton icon={ChevronDown} label="Next Match" tooltip={{ shortcut: '↵' }} size={24} onClick={onNext} disabled={navDisabled} />}
        <IconButton icon={X} label="Close" tooltip={{ shortcut: 'esc' }} size={24} onClick={onClose} className="flex-shrink-0" />
      </div>

      {secondRow && (
        <div className="flex items-center gap-2 h-8 px-2 border-t border-separator">
          {showWordMode && (
            <SegmentedControl
              size="sm"
              aria-label="Match"
              value={wordMode}
              onChange={(m) => onWordModeChange?.(m)}
              options={[
                { value: 'phrase', label: 'Phrase' },
                { value: 'all', label: 'All Words' },
                { value: 'any', label: 'Any Word' },
              ]}
            />
          )}
          <span className="flex-1" />
          {showAdvancedSearch && (
            <Button variant="link" size="sm" onClick={handleAdvancedSearch} className="flex-shrink-0">
              Advanced Search
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
