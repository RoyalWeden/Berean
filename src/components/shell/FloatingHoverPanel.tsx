import { useState, useRef, useEffect, useImperativeHandle, forwardRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

// ── Shared "hover trigger → floating card" widget ───────────────────────────
//
// Used by NoteSidePanel.tsx (outline/backlinks) and ScriptureSearchView.tsx's
// "jump to book" rail — both are mechanically identical: a small pill floats
// over the content's right edge; hovering it (or pinning it open) reveals a
// floating card. Extracted here so both get fixed consistently instead of
// drifting into two slightly-different implementations again.
//
// Two-layer box, not one: the OUTER layer (this component's root motion.div)
// has no `overflow` set, so a badge positioned outside its bounds (e.g. a pin
// button at `-top-2 -right-2`) renders as a real floating badge instead of
// getting clipped. Only the INNER layer (`absolute inset-0 overflow-hidden`)
// clips — it holds the actual resizing/scrolling content. An earlier version
// had ONE layer with `overflow: hidden` on the whole box, which correctly
// clipped content during the resize but ALSO clipped the pin badge that was
// deliberately positioned outside the box — the reported "cropped corners" bug.
//
// `border-radius` is a CONSTANT 16px, never animated: a 32×32 collapsed box is
// already a perfect circle at radius 16 (16 = 32/2, the "fully round"
// threshold for a square), and the expanded card also uses 16 — so there's
// never an intermediate radius value fighting mismatched width/height
// animation rates, which is what produced a stadium/pill shape mid-transition
// in an earlier attempt.
//
// Sizing animates via framer-motion's `animate` prop with explicit numeric
// width/height targets (NOT the `layout` prop) — `layout` renders children at
// full final size and visually shrinks the whole subtree with a CSS
// `transform: scale()`, which distorts any plain (non-motion) child like a
// lucide icon; explicit numeric `animate` avoids that scale-the-subtree
// behavior entirely while still getting real spring physics. The spring
// config (`stiffness: 500, damping: 45`) matches the app's own existing
// motion vocabulary (Sidebar.tsx's `layoutId="active-tab-pill"`).

const HOVER_ZONE_HEIGHT = 160
const COLLAPSED_SIZE = 32
const RADIUS = 16
const CLOSE_DELAY_MS = 220

export interface FloatingHoverPanelHandle {
  /** Programmatically close the panel — e.g. after a click inside `children`
   *  completes its own action (jump to a book, scroll to a heading). */
  close: () => void
}

export interface FloatingHoverPanelProps {
  /** Width of the expanded card, in px. */
  expandedWidth: number
  /** Height of the expanded card, in px. */
  expandedHeight: number
  /** Icon/dots shown inside the collapsed circle. */
  collapsedContent: ReactNode
  /** Rendered in the OUTER (unclipped) layer, only while expanded — e.g. a pin button
   *  meant to float partly outside the card's own rounded corner. */
  cornerBadge?: ReactNode
  /** When true, disables the auto-close-on-mouseleave countdown (stays open). */
  pinned?: boolean
  /** The expanded card's own body content (scrolls internally as needed). */
  children: ReactNode
  /** Horizontal offset of the anchor from the right edge of its container (Tailwind spacing scale, default `right-1`). */
  anchorRightClass?: string
  /** Width of the hover-trigger zone (Tailwind width scale, default `w-8`) — callers
   *  with less horizontal clearance (e.g. right next to a scrollbar) can narrow this. */
  anchorWidthClass?: string
  /** Delay, in ms, the cursor must dwell inside the hover zone before it actually
   *  expands (default 0 — expands immediately on enter). A cursor merely passing
   *  THROUGH the zone on its way somewhere else (e.g. toward a scrollbar right at
   *  the content's edge) won't trigger it if it clears the zone before this fires. */
  openDelayMs?: number
  /** Fires whenever the expanded state changes — e.g. to autofocus a search input the instant it opens. */
  onExpandedChange?: (expanded: boolean) => void
  /** Collapsed-state width/height/radius, in px (default 32/32/16 — a perfect circle).
   *  Override together to get a different idle shape, e.g. a thin vertical pill
   *  (16/44/8) matching FloatingRail.tsx's own idle trigger — the collapsed shape is
   *  otherwise ALWAYS a circle, which doesn't fit every caller's surrounding chrome. */
  collapsedWidth?: number
  collapsedHeight?: number
  collapsedRadius?: number
}

const FloatingHoverPanel = forwardRef<FloatingHoverPanelHandle, FloatingHoverPanelProps>(function FloatingHoverPanel({
  expandedWidth,
  expandedHeight,
  collapsedContent,
  cornerBadge,
  pinned = false,
  children,
  anchorRightClass = 'right-1',
  anchorWidthClass = 'w-8',
  openDelayMs = 0,
  onExpandedChange,
  collapsedWidth = COLLAPSED_SIZE,
  collapsedHeight = COLLAPSED_SIZE,
  collapsedRadius = RADIUS,
}, ref) {
  const [expanded, setExpanded] = useState(false)
  const [anchor, setAnchor] = useState<{ centerY: number; right: number } | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function measure() {
      const r = anchorRef.current?.getBoundingClientRect()
      if (r) setAnchor({ centerY: r.top + r.height / 2, right: window.innerWidth - r.left + 6 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => { onExpandedChange?.(expanded) }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  // Used once already expanded (moving from the anchor into the card itself, or
  // back into the anchor while the card is open) — always instant, so the open
  // card never flickers shut-then-reopens while the cursor is still over it.
  function openImmediate() {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null }
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    setExpanded(true)
  }
  // Used only for the FIRST hover into the anchor zone while collapsed — honors
  // `openDelayMs` so a cursor merely passing through the zone (e.g. traveling to
  // a scrollbar right at the content's edge) doesn't trigger it.
  function openFromAnchor() {
    if (expanded) { openImmediate(); return }
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    if (openDelayMs <= 0) { setExpanded(true); return }
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = setTimeout(() => { openTimerRef.current = null; setExpanded(true) }, openDelayMs)
  }
  function cancelPendingOpen() {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null }
  }
  function scheduleClose() {
    cancelPendingOpen()
    if (pinned) return
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setExpanded(false), CLOSE_DELAY_MS)
  }

  useImperativeHandle(ref, () => ({ close: () => setExpanded(false) }), [])

  // Pinning while already open keeps it open with no hover required; unpinning
  // starts the normal auto-close countdown right away instead of waiting for
  // the next mouseleave.
  useEffect(() => {
    if (!pinned && expanded) scheduleClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned])

  return (
    <>
      {/* Hover target — much taller than the visible dot so it's easy to land
          the pointer on, positioned so the visible circle sits centered inside it. */}
      <div
        ref={anchorRef}
        className={`absolute top-1/2 -translate-y-1/2 ${anchorRightClass} ${anchorWidthClass}`}
        style={{ height: HOVER_ZONE_HEIGHT }}
        onMouseEnter={openFromAnchor}
        onMouseLeave={() => { cancelPendingOpen(); scheduleClose() }}
      />

      {anchor && createPortal(
        <div
          style={{ position: 'fixed', top: anchor.centerY, right: anchor.right, transform: 'translateY(-50%)' }}
          onMouseEnter={openImmediate}
          onMouseLeave={scheduleClose}
        >
          <motion.div
            animate={{ width: expanded ? expandedWidth : collapsedWidth, height: expanded ? expandedHeight : collapsedHeight }}
            transition={{ type: 'spring', stiffness: 500, damping: 45 }}
            style={{ borderRadius: expanded ? RADIUS : collapsedRadius }}
            className={`relative z-[9999] border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]/95 backdrop-blur-sm ${
              expanded
                ? 'shadow-2xl cursor-default'
                : 'shadow-lg cursor-pointer opacity-55 hover:opacity-100 transition-opacity'
            }`}
          >
            {expanded && cornerBadge}
            <div className="absolute inset-0 overflow-hidden flex flex-col" style={{ borderRadius: expanded ? RADIUS : collapsedRadius }}>
              <div
                className="absolute inset-0 flex items-center justify-center transition-opacity duration-100"
                style={{ opacity: expanded ? 0 : 1, pointerEvents: expanded ? 'none' : 'auto' }}
              >
                {collapsedContent}
              </div>
              <div
                className="absolute inset-0 flex flex-col transition-opacity duration-150 delay-100"
                style={{ opacity: expanded ? 1 : 0, pointerEvents: expanded ? 'auto' : 'none' }}
              >
                {children}
              </div>
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </>
  )
})

export default FloatingHoverPanel
