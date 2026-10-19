import { useLayoutEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, Search, X } from 'lucide-react'

/**
 * Find in this conversation on iPhone — Safari's find-on-page arrangement: it takes the
 * composer's place at the bottom (above the keyboard), field + "2 of 9" + previous / next + Done.
 * Matching and highlighting are shared with the Mac (components/ailookup/chatFind.ts).
 */
export function PhoneFindBar({ query, onQuery, count, index, onPrev, onNext, onDone }: {
  query: string
  onQuery: (q: string) => void
  count: number
  index: number
  onPrev: () => void
  onNext: () => void
  onDone: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => { inputRef.current?.focus({ preventScroll: true }) }, [])
  const has = !!query.trim()
  // Buttons never take focus from the field (the keyboard would drop and re-layout under the finger).
  const keep = (e: React.SyntheticEvent) => e.preventDefault()
  return (
    <div className="m-chat-find" role="search" aria-label="Find in conversation">
      <div className="m-chat-find-field">
        <Search size={15} aria-hidden className="m-chat-find-icon" />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onNext() } }}
          placeholder="Find in Conversation"
          aria-label="Find in conversation"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {has && <span className="m-chat-find-count" aria-live="polite">{count ? `${index + 1} of ${count}` : 'No Matches'}</span>}
        {query && <button type="button" className="m-chat-find-clear" aria-label="Clear" onPointerDown={keep} onMouseDown={keep} onClick={() => onQuery('')}><X size={13} strokeWidth={2.5} /></button>}
      </div>
      <button type="button" className="m-chat-find-step" aria-label="Previous Match" disabled={!count} onPointerDown={keep} onMouseDown={keep} onClick={onPrev}><ChevronUp size={20} /></button>
      <button type="button" className="m-chat-find-step" aria-label="Next Match" disabled={!count} onPointerDown={keep} onMouseDown={keep} onClick={onNext}><ChevronDown size={20} /></button>
      <button type="button" className="m-chat-find-done" onClick={onDone}>Done</button>
    </div>
  )
}
