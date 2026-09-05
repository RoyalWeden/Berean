import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Generic hover-card wrapper for Study Trail's Map/Everything views — spine nodes, branch
// nodes, and edges all use this for the same "hover shows detail, click navigates" split (see
// the design spec's §3). A short delay before showing (so passing the mouse across the spine
// doesn't spam cards open) but instant hide on mouseleave.
//
// Placement is two-phase: an initial guess offset diagonally down-right of the cursor, then a
// useLayoutEffect (before paint, so no visible jump) measures the REAL rendered size and
// nudges it so it (a) never sits directly under the pointer — it's always offset by
// CURSOR_OFFSET on both axes so the cursor stays in the clear gap outside the card's corner —
// and (b) never overflows the viewport: it flips to the left of the cursor if the right edge
// would overflow, flips above the cursor if the bottom edge would, and hard-clamps as a last
// resort. Same collision-avoidance idea StrongsTooltip already uses elsewhere.
const CURSOR_OFFSET = 14
//
// Positioned from the cursor (clientX/clientY captured on the triggering mouse event), NOT
// from a getBoundingClientRect() of the wrapper — the wrapper used `display: contents` (so it
// doesn't affect layout of its children), and `display: contents` elements report an
// all-zero getBoundingClientRect() in Chromium, which is exactly why every card was rendering
// pinned to the window's top-left corner regardless of what was actually hovered.
//
// Rendered via a PORTAL straight into document.body — MapView's zoom feature wraps the whole
// spine in `transform: scale(...)`, and a `transform` on any ancestor makes THAT ancestor the
// containing block for `position: fixed` descendants instead of the viewport (a real, if
// obscure, CSS rule) — every hover card was silently being positioned/sized relative to the
// zoomed spine's own (scrolling, clipping) box instead of the actual window, which is exactly
// why cards weren't appearing at the cursor and were getting clipped by the scroll pane's
// bottom edge. A portal escapes that subtree entirely, so `position: fixed` means the real
// viewport again regardless of what transforms sit between this component and the window.
const SHOW_DELAY_MS = 350
// A short grace period before actually closing, given only on leaving the TRIGGER (not the
// card) — long enough for the cursor to travel from the trigger to the card itself (they're
// portaled siblings, not nested, so there's a real gap between them) without flickering shut
// mid-transit. Leaving the card itself closes instantly, same as before.
const CLOSE_GRACE_MS = 120

export default function TrailHoverCard({ content, children, disabled, secondaryContent }: {
  content: ReactNode
  children: ReactNode
  disabled?: boolean
  /** A SECOND, separate floating bubble shown beside the regular one — used for a connection's
   *  own user-written note (TrailNoteHoverBubble in MapView.tsx), which is deliberately its own
   *  bubble rather than a section tacked onto the auto-detected-facts card: "a second, separate
   *  hover bubble... like there are two bubbles." Both open/close together, driven by this same
   *  trigger's hover state. */
  secondaryContent?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [secondaryPos, setSecondaryPos] = useState<{ top: number; left: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const primaryCardRef = useRef<HTMLDivElement | null>(null)
  // Raw cursor coords captured on the triggering mouse event — the layout effect below re-derives
  // the final card position from these once it can measure the card's real size.
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  // Guards the measure-and-place layout effect so it runs exactly once per open (no re-render loop).
  const placedRef = useRef(false)

  function scheduleOpen(e: React.MouseEvent) {
    // Diagnostic only (window.__bereanTrailDebug) — per feedback that hover cards aren't
    // showing at all, this confirms whether the trigger's mouseenter is even reaching this
    // handler and, if so, whether `disabled` is the reason nothing opens.
    if (window.__bereanTrailDebug) console.log('[TrailDebug] hover trigger entered', { disabled })
    if (disabled) return
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    // Already open — per direct feedback ("when i put my cursor over the hover popup, it should
    // stay where it is instead of moving again"), don't recompute/reschedule a new position.
    // The trigger's own onMouseEnter can re-fire even while the card is already showing (the
    // cursor grazing back over part of the trigger while actually heading toward the card,
    // which sits right next to/over it) — that used to restart the SHOW_DELAY timer with the
    // cursor's LATEST coordinates, visibly jumping the card to a new spot a moment later.
    if (open) return
    const x = e.clientX, y = e.clientY
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      cursorRef.current = { x, y }
      placedRef.current = false
      // Initial guess only — offset diagonally off the cursor so it's never directly below it.
      // The layout effect corrects this (viewport flips/clamps) before the browser paints, so
      // this first value never actually shows in a wrong spot.
      setPos({ top: y + CURSOR_OFFSET, left: x + CURSOR_OFFSET })
      setOpen(true)
    }, SHOW_DELAY_MS)
  }
  // Leaving the trigger no longer closes instantly — a short grace window lets the cursor
  // actually reach the card (see cancelOpen's comment above) so it's possible to move INTO the
  // card and interact with it (select text, click a link/button inside it) instead of it
  // vanishing the moment you leave the row that opened it. Per direct feedback: "make sure that
  // the hover things in the study trail stay if the user puts their cursor over the hover thing."
  function scheduleClose() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_GRACE_MS)
  }
  function cancelClose() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
  }
  function closeNow() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setOpen(false)
  }

  // `disabled` (e.g. the "why'd you jump here" edit popup being open) previously only blocked
  // scheduleOpen from arming — an ALREADY-open card (the one under the cursor when you clicked
  // the pencil icon that opens the popup) stayed open regardless. Force it shut the moment
  // disabled flips true, so clicking Edit reliably clears the hover card instead of leaving it
  // floating on top of/behind the popup until the mouse happens to move away.
  useEffect(() => { if (disabled) { placedRef.current = false; closeNow() } }, [disabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 2 of placement: measure the real card, then position it OFF the cursor (never under
  // it) and inside the viewport — flip left of the cursor if the right edge would overflow,
  // flip above if the bottom would, hard-clamp otherwise. Runs once per open (placedRef guard).
  useLayoutEffect(() => {
    if (!open || placedRef.current) return
    const card = primaryCardRef.current
    if (!card) return
    const { width: w, height: h } = card.getBoundingClientRect()
    if (w === 0 && h === 0) return
    const pad = 8
    const vw = window.innerWidth, vh = window.innerHeight
    const { x: cx, y: cy } = cursorRef.current

    let left = cx + CURSOR_OFFSET
    if (left + w > vw - pad) left = cx - CURSOR_OFFSET - w      // flip to the left of the cursor
    if (left < pad) left = Math.max(pad, vw - w - pad)          // last-resort clamp

    let top = cy + CURSOR_OFFSET
    if (top + h > vh - pad) top = cy - CURSOR_OFFSET - h        // flip above the cursor
    if (top < pad) top = Math.max(pad, vh - h - pad)            // last-resort clamp

    placedRef.current = true
    setPos({ top, left })
  }, [open, pos])

  // Position the secondary "Your note" bubble RELATIVE TO THE PRIMARY CARD'S REAL RECT, not the
  // cursor — per direct feedback ("move the note so that it isn't on top of the other thing...
  // needed when they are on top of each other"). Prefer the right of the primary card, fall
  // back to its left, and only if neither side fits, stack it directly below — so the two never
  // overlap regardless of how close to a window edge the card opened.
  useLayoutEffect(() => {
    if (!open || !secondaryContent || !placedRef.current) { if (!open) setSecondaryPos(null); return }
    const card = primaryCardRef.current
    if (!card) return
    const r = card.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    const GAP = 12, W = 280, pad = 8
    let left: number, top = r.top
    if (r.right + GAP + W <= window.innerWidth - pad) {
      left = r.right + GAP
    } else if (r.left - GAP - W >= pad) {
      left = r.left - GAP - W
    } else {
      left = Math.min(Math.max(pad, r.left), window.innerWidth - W - pad)
      top = r.bottom + GAP
    }
    top = Math.max(pad, Math.min(top, window.innerHeight - 160))
    setSecondaryPos({ top, left })
  }, [open, pos, secondaryContent])

  return (
    <div onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} style={{ display: 'contents' }}>
      {children}
      {open && pos && createPortal(
        <div
          ref={primaryCardRef}
          onMouseEnter={cancelClose}
          onMouseLeave={closeNow}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000,
            maxWidth: 280, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: '9px 11px',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
      {open && secondaryPos && secondaryContent && createPortal(
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={closeNow}
          style={{
            position: 'fixed', top: secondaryPos.top, left: secondaryPos.left, zIndex: 10000,
            width: 280, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: '9px 11px',
          }}
        >
          {secondaryContent}
        </div>,
        document.body,
      )}
    </div>
  )
}
