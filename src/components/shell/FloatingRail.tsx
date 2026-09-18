import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { SPRING_GENTLE } from '@/lib/motion'
import Ribbon from './Ribbon'

// ── Floating hover-expand wrapper around Ribbon.tsx ──────────────────────────
//
// A small, fully floating (`position: fixed`) trigger — deliberately NOT a
// flex sibling reserving its own column width in App.tsx's layout anymore.
// An earlier version gave it a permanent 14px-wide in-flow dock so it could
// never visually overlap anything; in practice that dock itself read as an
// unwanted "vertical rectangle" sitting between Sidebar and content even
// though it had no background of its own (Sidebar's own right-edge shadow —
// see Sidebar.tsx's `.material-bar` box-shadow — bled into it). A small
// floating pill has a far smaller footprint than a full-height column, so
// it's a better trade than reserving real layout space just to avoid ever
// touching content.
//
// Positioned from Sidebar's own collapsed/expanded width (0, or the live
// user-resizable sidebarWidth store value Sidebar.tsx's drag handle controls)
// plus a small GAP so it floats just clear of Sidebar's edge rather than
// touching it directly. Vertically, it targets the center of the area BELOW ShellHeader
// (not raw window center) — matching where FloatingHoverPanel.tsx's own
// triggers land (NoteSidePanel.tsx / ScriptureSearchView.tsx anchor within
// their panel's content area, which also excludes the header), so this
// rail's dot and those panels' hover dots line up on the same horizontal row.
//
// Collapsed shape is a thin vertical pill (not FloatingHoverPanel's circle)
// with three vertically-stacked dots — a deliberately different, narrower
// idle shape from FloatingHoverPanel.tsx's own circular trigger, per explicit
// direction, with more breathing room between the dots than a packed icon
// glyph would give.
//
// Expanding unfolds a real elevated-glass card (`.material-elevated`, same
// family as every other menu/popover in the app, not a bespoke shadow/blur)
// out of the collapsed pill's own edge — `transform-origin: left center` plus
// a scaleX/x/opacity entrance (SPRING_GENTLE, the settle-in-place spring used
// for popovers) makes it visibly originate FROM the trigger rather than just
// cross-fading in place. It's a separate element from the collapsed pill
// (not one div animating its own width/height), so its size is always however
// many buttons Ribbon actually renders (Ribbon conditionally adds a
// floating-search button when Sidebar is collapsed) — no height measuring
// needed.
//
// Ribbon's own internals (buttons, tooltips, popovers, drag handling) are
// completely unchanged.
//
// Marked `no-drag` explicitly (not `app-drag-region`) — Ribbon.tsx/Sidebar.tsx's
// own comments document real past bugs where Electron's OS-level drag-region
// hit-testing desynced from portaled/floating content's visual bounds, so this
// deliberately gives up the small sliver of window-drag surface Ribbon's own
// idle background used to provide (ShellHeader's full-width top bar remains
// the primary drag surface) rather than risk that class of bug recurring.

const GAP = 2
const HEADER_HEIGHT = 44
const COLLAPSED_WIDTH = 14
const COLLAPSED_HEIGHT = 40
const CLOSE_DELAY_MS = 220

export default function FloatingRail() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const appZoom = useAppStore((s) => s.appZoom)
  const [hovered, setHovered] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  // `e.buttons` reflects the real OS-level button state at dispatch time regardless of which
  // process/frame originally saw the mousedown — so this also catches a drag that STARTED
  // inside the YouTube webview (e.g. scrubbing its timeline): Electron's <webview> is a
  // separate native compositor layer, so a mousedown on YouTube's own seek bar never reaches
  // this host document at all, but once the drag carries the cursor across into this rail's
  // hover strip, `buttons` still correctly reports the button as held. Skipping open() in that
  // case is what stops the rail popping open and getting in the way mid-drag; onMouseMove below
  // re-arms it the moment the button is actually released while the cursor is still here.
  function open(e?: React.MouseEvent) {
    if (e && e.buttons !== 0) return
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    setHovered(true)
  }
  function onMove(e: React.MouseEvent) {
    if (!hovered && e.buttons === 0) open()
  }
  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setHovered(false), CLOSE_DELAY_MS)
  }

  const left = (sidebarCollapsed ? 0 : sidebarWidth) + GAP
  const headerHeight = HEADER_HEIGHT * appZoom

  return createPortal(
    <div
      className="no-drag fixed z-raised transition-[left] duration-200 ease-in-out"
      style={{ top: `calc(50% + ${headerHeight / 2}px)`, left }}
      onMouseEnter={open}
      onMouseMove={onMove}
      onMouseLeave={scheduleClose}
    >
      {/* Collapsed handle — a low-contrast grip pill, always mounted (it's the hover target
          itself); fades out rather than unmounting while the card above is open so the hover
          region under the cursor never changes shape mid-interaction. */}
      <div
        className="material-control rounded-control flex flex-col items-center justify-center gap-2 transition-opacity duration-150"
        style={{
          width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT, transform: 'translateY(-50%)',
          opacity: hovered ? 0 : 1, pointerEvents: hovered ? 'none' : 'auto', cursor: hovered ? 'default' : 'pointer',
        }}
      >
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1 h-1 rounded-full bg-text-quaternary" />
        ))}
      </div>

      {/* Expanded card — a separate element (not the pill growing), so it can unfold FROM the
          pill's edge on every open rather than only animating on first mount. */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, scaleX: 0.92, x: -4, y: '-50%' }}
            animate={{ opacity: 1, scaleX: 1, x: 0, y: '-50%' }}
            exit={{ opacity: 0, scaleX: 0.92, x: -4, y: '-50%' }}
            transition={SPRING_GENTLE}
            style={{ position: 'absolute', top: '50%', left: 0, transformOrigin: 'left center' }}
            className="material-elevated rounded-menu overflow-hidden w-fit cursor-default"
          >
            <Ribbon />
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
