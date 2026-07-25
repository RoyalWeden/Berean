import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useAppStore } from '@/store'
import Ribbon from './Ribbon'

// ── Floating hover-expand wrapper around Ribbon.tsx ──────────────────────────
//
// A small, fully floating (`position: fixed`) trigger — deliberately NOT a
// flex sibling reserving its own column width in App.tsx's layout anymore.
// An earlier version gave it a permanent 14px-wide in-flow dock so it could
// never visually overlap anything; in practice that dock itself read as an
// unwanted "vertical rectangle" sitting between Sidebar and content even
// though it had no background of its own (Sidebar's own right-edge shadow —
// see Sidebar.tsx's `sidebar-vibrant` box-shadow — bled into it). A small
// floating pill has a far smaller footprint than a full-height column, so
// it's a better trade than reserving real layout space just to avoid ever
// touching content.
//
// Positioned from Sidebar's own collapsed/expanded width (0 or 224, the same
// two endpoints Sidebar.tsx's internal spring animates between) plus a small
// GAP so it floats just clear of Sidebar's edge rather than touching it
// directly. Vertically, it targets the center of the area BELOW ShellHeader
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
// Expanding still grows into a rounded card exactly like
// FloatingHoverPanel.tsx's collapsed-circle-to-card widget (same spring
// config, same hover-delay-close timing) — but the expanded HEIGHT is
// measured live from Ribbon's own rendered content (via ResizeObserver)
// rather than a hardcoded guess, so the card hugs however many buttons are
// actually showing (Ribbon conditionally adds a floating-search button when
// Sidebar is collapsed) instead of leaving dead space sized for the max case.
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

const SIDEBAR_WIDTH = 224
const GAP = 5
const HEADER_HEIGHT = 44
const COLLAPSED_WIDTH = 16
const COLLAPSED_HEIGHT = 44
const RADIUS = COLLAPSED_WIDTH / 2
const EXPANDED_WIDTH = 46
const EXPANDED_RADIUS = 20
const CLOSE_DELAY_MS = 220

export default function FloatingRail() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const appZoom = useAppStore((s) => s.appZoom)
  const [hovered, setHovered] = useState(false)
  const [ribbonHeight, setRibbonHeight] = useState(COLLAPSED_HEIGHT)
  const ribbonRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const el = ribbonRef.current
    if (!el) return
    const measure = () => setRibbonHeight(el.scrollHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  function open() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    setHovered(true)
  }
  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setHovered(false), CLOSE_DELAY_MS)
  }

  const left = (sidebarCollapsed ? 0 : SIDEBAR_WIDTH) + GAP
  const headerHeight = HEADER_HEIGHT * appZoom

  return createPortal(
    <div
      className="no-drag fixed z-40 transition-[left] duration-200 ease-in-out"
      style={{ top: `calc(50% + ${headerHeight / 2}px)`, left, transform: 'translateY(-50%)' }}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      <motion.div
        animate={{
          width: hovered ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
          height: hovered ? ribbonHeight : COLLAPSED_HEIGHT,
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 45 }}
        style={{ borderRadius: hovered ? EXPANDED_RADIUS : RADIUS }}
        // More translucent (75%/85%) with a lighter blur — enough that content behind the
        // rail is genuinely visible through it without being distracting, rather than the
        // near-opaque 90%/95% this had before. The idle-state `opacity-55` that used to sit
        // on THIS element doesn't anymore — it used to dim the box AND everything inside it
        // together (background alpha and the dots' own color both getting scaled down at
        // once), which on top of the newly-more-transparent background left the idle dots
        // reading as barely-there/broken. The "recedes when idle" cue now lives on the
        // background/shadow only (via bg-*/85 above and shadow-lg below); the dots get
        // their own independent, much milder fade further down instead.
        className={`relative border border-[rgb(var(--color-surface-4))] backdrop-blur-[2px] ${
          hovered ? 'bg-[rgb(var(--color-surface-2))]/75 shadow-2xl cursor-default' : 'bg-[rgb(var(--color-surface-2))]/85 shadow-lg cursor-pointer'
        }`}
      >
        <div className="absolute inset-0 overflow-hidden flex flex-col" style={{ borderRadius: hovered ? EXPANDED_RADIUS : RADIUS }}>
          <div
            // Own independent opacity (70% idle → 0 on hover) instead of inheriting the
            // container's now-removed idle fade — see the comment above for why sharing one
            // opacity value with the background broke this. Cross-fades with the Ribbon
            // layer below on the SAME duration and no delay on either side — an earlier
            // version snapped this to 0 instantly (inline style, no transition) while the
            // Ribbon layer below waited on a `delay-100` before even starting its own
            // fade-in, leaving a ~100ms+ window where hovering the rail made BOTH layers
            // read as blank (reported as "the dots go away when I hover"). Same
            // duration + no delay on both sides is what makes them swap in lockstep.
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 transition-opacity duration-150"
            style={{ opacity: hovered ? 0 : 0.7, pointerEvents: hovered ? 'none' : 'auto' }}
          >
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-[rgb(var(--color-text-muted))]" />
            ))}
          </div>
          <div
            className="absolute inset-0 flex flex-col transition-opacity duration-150"
            style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none' }}
          >
            <div ref={ribbonRef} className="w-fit">
              <Ribbon />
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
