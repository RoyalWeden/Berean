import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { buildTranscriptRows, isEmptyPlaceholder, type TranscriptItem } from './chatModel'
import { collectFindMatches, paintFindMatches, clearFindHighlights, revealMatch, type FindMatch } from './chatFind'
import { ChatMessageRow } from './ChatMessageRow'
import { useTimestampReveal } from './useTimestampReveal'

/**
 * The scrolling transcript. Large histories stay cheap two ways:
 *  - only the newest `windowSize` rows are in the DOM; scrolling to the top grows the window
 *    (and, in the cross-conversation views, asks for the next older page) while keeping the
 *    reading position exactly where it was;
 *  - rows are memoized and receive the same message object while unchanged, so a new message
 *    or a streamed AI reply re-renders only its own row.
 * Scroll follows new content only while the reader is already at the bottom (or just sent
 * something); otherwise a "New Messages" button appears instead of yanking the view.
 */

/** Rows rendered at first / added per "Show Earlier Messages". 60 covers several screens; 120 made
 *  opening a long conversation take ~156 ms (perf audit 2026-10-19 — each rich reply costs
 *  ~1.2 ms to mount). */
const WINDOW_STEP = 60
const cssEscape = (v: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&'))
const BOTTOM_SLOP = 48
/** While finding, every loaded row is rendered (up to this many) so every match is findable. */
const FIND_WINDOW_MAX = 3000
/** …added in batches of this many, in idle time, starting as soon as Find opens: rendering them
 *  all on the first keystroke stalled it 649 ms in a 600-message conversation, and 40-row batches
 *  (~1.5 ms of layout per rich reply) still held keystrokes up to ~200 ms (perf audit 2026-10-19). */
const FIND_CHUNK = 40
const whenIdle = (fn: () => void): (() => void) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
  if (w.requestIdleCallback) { const h = w.requestIdleCallback(fn, { timeout: 200 }); return () => w.cancelIdleCallback?.(h) }
  const t = setTimeout(fn, 16)
  return () => clearTimeout(t)
}

/** Find in this conversation: the query, which match is current, and where the results go. */
/** Which occurrence within its own message match `i` is (0 = the message's first). */
function ordinal(matches: readonly FindMatch[], i: number): number {
  let n = 0
  for (let k = i - 1; k >= 0 && matches[k].messageId === matches[i].messageId; k--) n++
  return n
}

export interface TranscriptFind {
  query: string
  index: number
  /** Called with the match count (and the current index, clamped) whenever it changes. */
  onMatches: (count: number, index: number) => void
  /** Land on this message's first match (a global-search result was opened). */
  targetMessageId?: string | null
}

export function ChatTranscript({
  items, resetKey, crossConversation, hasOlder, loadingOlder, onLoadOlder, typing, failedIds,
  focusMessageId, onFocusHandled, stickToken, empty, bottomInset = 0, find, onRevealLock,
}: {
  items: TranscriptItem[]
  /** Changes when a different conversation/view is shown → jump to bottom, reset the window. */
  resetKey: string
  crossConversation: boolean
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  /** Progress text while an AI reply is being prepared for this transcript, else null. */
  typing: string | null
  failedIds: ReadonlySet<string>
  focusMessageId: string | null
  onFocusHandled: () => void
  /** Bumped by the composer on send → scroll to bottom even if the reader had scrolled up. */
  stickToken: number
  empty: ReactNode
  /** Space reserved under the last row for a floating composer. */
  bottomInset?: number
  find?: TranscriptFind | null
  /** The swipe-for-times drag passed the lock point (iPhone: a haptic tick). */
  onRevealLock?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  useTimestampReveal(scrollRef, { resetKey, onArm: onRevealLock })
  const atBottomRef = useRef(true)
  const prevHeightRef = useRef<number | null>(null)
  const [windowSize, setWindowSize] = useState(WINDOW_STEP)
  const [showJump, setShowJump] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)

  const rows = useMemo(() => buildTranscriptRows(items, { crossConversation }), [items, crossConversation])
  const questionById = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) if (it.message.kind === 'ai-request') map.set(it.message.id, it.message.content)
    return map
  }, [items])
  // Replies show the message they answer (same object while it is unchanged — rows stay memoized).
  const messageById = useMemo(() => {
    const map = new Map<string, TranscriptItem['message']>()
    for (const it of items) if (!it.message.pending) map.set(it.message.id, it.message)
    return map
  }, [items])

  // Focus target must be inside the rendered window.
  const focusIndex = focusMessageId ? rows.findIndex((r) => r.type === 'message' && r.item.message.id === focusMessageId) : -1
  // Find open (even before a query is typed): the window grows toward every loaded row, a batch at
  // a time (below), so typing never waits for hundreds of rows to mount.
  const findOpen = !!find
  const [findWindow, setFindWindow] = useState(0)
  const findTarget = Math.min(rows.length, FIND_WINDOW_MAX)
  // A focused message (a search result being opened) is always in the window at once.
  const focusWindow = focusIndex >= 0 ? rows.length - focusIndex + 10 : 0
  const effectiveWindow = Math.max(windowSize, focusWindow, findOpen ? findWindow : 0)
  const start = Math.max(0, rows.length - effectiveWindow)
  const visible = start > 0 ? rows.slice(start) : rows

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    else el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setShowJump(false)
  }

  useLayoutEffect(() => { setWindowSize(WINDOW_STEP); setFindWindow(0); scrollToBottom() }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!findOpen) setFindWindow(0) }, [findOpen])
  // Grow the find window one batch per task; each batch keeps the reading position (prepend
  // anchoring below) and is a transition, so a keystroke in the find field always goes first.
  const shownForFind = Math.max(windowSize, findWindow)
  useEffect(() => {
    if (!findOpen || shownForFind >= findTarget) return
    return whenIdle(() => {
      const el = scrollRef.current
      if (el && prevHeightRef.current == null) prevHeightRef.current = el.scrollHeight
      startTransition(() => setFindWindow(Math.min(findTarget, shownForFind + FIND_CHUNK)))
    })
  }, [findOpen, shownForFind, findTarget])
  useLayoutEffect(() => { if (stickToken) scrollToBottom() }, [stickToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prepending older rows: keep the same content under the reader's eye.
  const firstKey = visible[0]?.key
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && prevHeightRef.current != null) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current
      prevHeightRef.current = null
    }
  }, [firstKey])

  // New content at the bottom: follow it only when already there.
  const lastKey = rows[rows.length - 1]?.key
  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom()
    else if (lastKey) setShowJump(true)
  }, [lastKey, typing != null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rows growing in place (a reply streaming in, "Show more") keep a bottom-pinned view pinned.
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (atBottomRef.current && prevHeightRef.current == null) { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight } })
    ro.observe(content)
    // …and so does the viewport shrinking (the composer growing a toolbar row / more lines).
    if (scrollRef.current) ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [])

  // Scroll a focused message (search hit / jump) into view and flash it.
  useEffect(() => {
    if (!focusMessageId || focusIndex < 0) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${cssEscape(focusMessageId)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    atBottomRef.current = false
    setFlashId(focusMessageId)
    onFocusHandled()
    const t = setTimeout(() => setFlashId(null), 1600)
    return () => clearTimeout(t)
  }, [focusMessageId, focusIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Find in this conversation ──
  const matchesRef = useRef<FindMatch[]>([])
  const findRef = useRef(find)
  findRef.current = find
  const [findTick, setFindTick] = useState(0)
  const findQuery = find?.query ?? ''
  useEffect(() => {
    const content = contentRef.current
    if (!content || !findQuery.trim()) { matchesRef.current = []; clearFindHighlights(); return }
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = () => { matchesRef.current = collectFindMatches(content, findQuery); setFindTick((t) => t + 1) }
    run()
    // Streaming replies / new messages / "Show more": re-match (debounced), keeping the index.
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { if (timer) clearTimeout(timer); timer = setTimeout(run, 150) }) : null
    mo?.observe(content, { childList: true, subtree: true, characterData: true })
    return () => { mo?.disconnect(); if (timer) clearTimeout(timer) }
  }, [findQuery, resetKey, visible.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearFindHighlights(), [])
  const targetedRef = useRef<string | null>(null)
  const paintedRef = useRef<{ query: string; requested: number; index: number; messageId: string; ordinal: number } | null>(null)
  useLayoutEffect(() => {
    const f = findRef.current
    const matches = matchesRef.current
    if (!f || !f.query.trim()) return
    let index = Math.min(f.index, Math.max(0, matches.length - 1))
    // Rows added above (the find window growing, "Show Earlier") shift every index: the same query
    // and index as last painted means "keep the same match", found again by its message and its
    // place within that message.
    const painted = paintedRef.current
    // (Either index counts: the host may not have received the one reported last time yet.)
    if (painted && painted.query === f.query && (f.index === painted.index || f.index === painted.requested)) {
      const again = matches.findIndex((m, i) => m.messageId === painted.messageId && ordinal(matches, i) === painted.ordinal)
      if (again >= 0) index = again
    }
    if (f.targetMessageId && targetedRef.current !== f.targetMessageId) {
      const at = matches.findIndex((m) => m.messageId === f.targetMessageId)
      if (at >= 0) { index = at; targetedRef.current = f.targetMessageId }
    }
    paintedRef.current = matches[index] ? { query: f.query, requested: f.index, index, messageId: matches[index].messageId, ordinal: ordinal(matches, index) } : null
    paintFindMatches(matches, index)
    const el = scrollRef.current
    if (el && matches[index]) { revealMatch(el, matches[index]); atBottomRef.current = false }
    f.onMatches(matches.length, index)
  }, [findTick, find?.index]) // eslint-disable-line react-hooks/exhaustive-deps

  const growWindow = () => {
    const el = scrollRef.current
    if (start > 0) {
      if (el) prevHeightRef.current = el.scrollHeight
      setWindowSize((w) => w + WINDOW_STEP)
    } else if (hasOlder && !loadingOlder) {
      if (el) prevHeightRef.current = el.scrollHeight
      onLoadOlder()
    }
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLOP
    atBottomRef.current = atBottom
    if (atBottom && showJump) setShowJump(false)
    if (el.scrollTop < 200) growWindow()
  }

  const hasTyping = typing != null && items.some((it) => isEmptyPlaceholder(it.message))
  const isEmpty = rows.length === 0 && !hasTyping

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-transcript-scroll absolute inset-0 overflow-y-auto overscroll-contain"
        data-reveal-size={crossConversation ? 'wide' : undefined}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div ref={contentRef} className="chat-transcript-content chat-column min-h-full flex flex-col justify-end pt-[var(--chat-space-2)]" style={{ paddingBottom: `calc(${bottomInset}px + var(--chat-space-2))` }}>
          {(start > 0 || hasOlder) && (
            <div className="flex justify-center py-[var(--chat-space-2)]">
              {loadingOlder
                ? <Loader2 size={14} className="animate-spin text-text-muted" />
                : <Button variant="ghost" size="xs" onClick={growWindow}>Show Earlier Messages</Button>}
            </div>
          )}
          {isEmpty && <div className="flex-1 flex items-center justify-center">{empty}</div>}
          {visible.map((r) => r.type === 'day' ? (
            <div key={r.key} className="text-center text-caption2 font-medium text-text-muted pt-[var(--chat-space-4)] pb-[var(--chat-space-1)] select-none" role="separator">{r.label}</div>
          ) : (
            <ChatMessageRow
              key={r.key}
              message={r.item.message}
              chatId={r.item.chatId}
              chatTitle={r.item.chatTitle}
              side={r.side}
              groupStart={r.groupStart}
              groupEnd={r.groupEnd}
              timeLabel={r.timeLabel}
              showConversation={r.showConversation}
              question={r.item.message.replyTo ? questionById.get(r.item.message.replyTo) : undefined}
              quoted={r.item.message.inReplyTo ? messageById.get(r.item.message.inReplyTo) ?? null : undefined}
              failed={failedIds.has(r.item.message.id)}
              focused={flashId === r.item.message.id}
              crossView={crossConversation}
            />
          ))}
          {hasTyping && (
            <div className="px-[var(--chat-space-3)] pt-[var(--chat-space-2)]">
              <div className="inline-flex items-center gap-[var(--chat-space-2)] rounded-[var(--chat-bubble-radius)] bg-surface-2 px-[var(--chat-space-3)] py-[var(--chat-space-2)] text-caption text-text-muted">
                <span className="chat-typing" aria-hidden><i /><i /><i /></span>
                <span>{typing}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          // One quiet capsule (popover material only — no extra shadow stacked on top of it).
          className="absolute left-1/2 -translate-x-1/2 material-popover rounded-control h-6 px-[var(--chat-space-3)] inline-flex items-center gap-[var(--chat-space-1)] text-caption font-medium text-text-secondary hover:text-text-primary focus-ring animate-menu-in"
          style={{ bottom: `calc(${bottomInset}px + var(--chat-space-3))` }}
        >
          <ArrowDown size={12} /> New Messages
        </button>
      )}
    </div>
  )
}
