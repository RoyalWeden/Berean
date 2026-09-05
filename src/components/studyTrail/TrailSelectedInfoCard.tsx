import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// Per feedback ("when the user hovers over a bullet, show the same thing as the item" — meaning
// a SELECTED node/connection, not just a hovered one, should get the same auto-detected-facts
// card TrailHoverCard shows on hover): today, marquee/keyboard-selecting a node only applies a
// highlight ring (see MapView.tsx's `selected` styling) with no info shown at all. This renders
// the SAME content (TrailNodeHoverContent / TrailConnectionHoverContent, passed in as `content`
// by the caller) pinned near the selected row, independent of the mouse.
//
// Deliberately a separate, much simpler component rather than teaching TrailHoverCard itself
// about a second "stay open" trigger — TrailHoverCard's hover-in/hover-out is a real timer-driven
// state machine (SHOW_DELAY_MS / CLOSE_GRACE_MS); folding a persistent, mouse-independent open
// state into that risked exactly the kind of interaction the grace-period timers exist to avoid
// (a real mouseleave closing a still-selected card once its grace period elapses). No delay, no
// grace period here — it shows the instant something is selected and hides the instant it isn't.
export default function TrailSelectedInfoCard({ anchorRef, content }: {
  anchorRef: RefObject<HTMLElement>
  content: ReactNode
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // No dependency array — cheap (one measured rect, at most a handful of these mounted at
  // once for a realistic selection size) and keeps the card following its anchor through
  // re-renders (e.g. the marquee selection itself changing) without a dedicated resize/scroll
  // listener. It does NOT re-run on a plain scroll with no other state change — a modest amount
  // of drift while scrolling past a selected node is a cosmetic tradeoff for staying simple.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) { setPos(null); return }
    const r = anchor.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) { setPos(null); return }
    const cardW = cardRef.current?.getBoundingClientRect().width || 280
    const pad = 8
    let left = r.right + 10
    if (left + cardW > window.innerWidth - pad) left = Math.max(pad, r.left - cardW - 10)
    const top = Math.min(Math.max(pad, r.top), window.innerHeight - 160)
    setPos({ top, left })
  })

  if (!pos) return null
  return createPortal(
    <div
      ref={cardRef}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000,
        maxWidth: 280, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: '9px 11px',
        pointerEvents: 'none',
      }}
    >
      {content}
    </div>,
    document.body,
  )
}
