import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Generic hover-card wrapper for Study Trail's Map/Everything views — spine nodes, branch
// nodes, and edges all use this for the same "hover shows detail, click navigates" split (see
// the design spec's §3). A short delay before showing (so passing the mouse across the spine
// doesn't spam cards open) but instant hide on mouseleave; flips to the left of the cursor if
// it would overflow the window's right edge, same collision-avoidance idea StrongsTooltip
// already uses elsewhere in the app.
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
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const [secondaryPos, setSecondaryPos] = useState<{ top: number; left: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleOpen(e: React.MouseEvent) {
    if (disabled) return
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    const x = e.clientX, y = e.clientY
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const overflowsRight = x + 280 > window.innerWidth
      const top = Math.min(y - 6, window.innerHeight - 140)
      setPos(overflowsRight ? { top, right: window.innerWidth - x + 12 } : { top, left: x + 12 })
      if (secondaryContent) {
        // Placed just to the side of the primary card — mirrored to the LEFT when the primary
        // itself already flipped left to avoid the right edge, otherwise to the right; clamped
        // so it can't run off the opposite edge either.
        const secondaryLeft = overflowsRight
          ? Math.max(12, x - 290 - 12 - 280)
          : Math.min(x + 12 + 290, window.innerWidth - 290)
        setSecondaryPos({ top, left: secondaryLeft })
      }
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
  useEffect(() => { if (disabled) closeNow() }, [disabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} style={{ display: 'contents' }}>
      {children}
      {open && pos && createPortal(
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={closeNow}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 10000,
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
