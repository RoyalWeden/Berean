/**
 * usePositionedMenu — shared hook for all context/popup menus.
 *
 * Guarantees:
 *  - Menu never renders off-screen: all four corners are kept inside the
 *    viewport after the first render (measured via getBoundingClientRect).
 *  - Menu stays near the cursor: we try to open below-right, then flip to
 *    above and/or left if the menu would overflow.
 *  - Click-outside and Escape close the menu.
 *  - The custom DOM event `berean:closeMenus` also closes (fired by modals /
 *    the floating search bar so every popup disappears when they open).
 *  - No flicker: clamping happens in useLayoutEffect (before paint).
 *
 * Usage:
 *   const { menu, menuRef, openMenu, closeMenu } = usePositionedMenu<{ note: Note }>()
 *   // menu is null when closed, or { ...data, x, y } when open
 *   // attach ref={menuRef} to the menu div in the portal
 */
import { useState, useRef, useLayoutEffect, useEffect, forwardRef, createElement, type ReactNode } from 'react'

type WithPos = { x: number; y: number; _adjusted?: boolean }

export function usePositionedMenu<T extends object>(): {
  menu: (T & WithPos) | null
  menuRef: React.RefObject<HTMLDivElement>
  openMenu: (data: T & { x: number; y: number }) => void
  closeMenu: () => void
} {
  const [menu, setMenuRaw] = useState<(T & WithPos) | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // ── Clamp to viewport after first render (before paint) ──────────────────
  useLayoutEffect(() => {
    if (!menu || menu._adjusted || !menuRef.current) return
    const el = menuRef.current
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Cursor position (raw) is stored in x/y before adjustment
    let x = menu.x
    let y = menu.y

    // Flip horizontally if right edge overflows
    if (x + width + pad > vw) x = menu.x - width
    // Flip vertically if bottom edge overflows
    if (y + height + pad > vh) y = menu.y - height
    // Hard clamp so it's always fully on-screen
    x = Math.max(pad, Math.min(x, vw - width - pad))
    y = Math.max(pad, Math.min(y, vh - height - pad))

    setMenuRaw({ ...menu, x, y, _adjusted: true })
  }) // no deps — runs every render, but the `_adjusted` flag stops it after the first pass

  // ── Click-outside / Escape / berean:closeMenus / closeContextMenus ─────────
  useEffect(() => {
    if (!menu) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuRaw(null)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuRaw(null)
    }
    function onClose() { setMenuRaw(null) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('berean:closeMenus', onClose)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('berean:closeMenus', onClose)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    }
  }, [!!menu]) // only re-subscribe when open/closed state changes

  function openMenu(data: T & { x: number; y: number }) {
    // Close any other context menu first so only one is ever open at a time.
    dispatchCloseContextMenus()
    setMenuRaw({ ...data, _adjusted: false })
  }
  function closeMenu() { setMenuRaw(null) }

  return { menu, menuRef: menuRef as React.RefObject<HTMLDivElement>, openMenu, closeMenu }
}

/** Dispatch the global close-all-menus event (call from modals, search bars, etc.) */
export function dispatchCloseMenus() {
  window.dispatchEvent(new Event('berean:closeMenus'))
}

/**
 * Dedicated event for right-click context menus only. Unlike `berean:closeMenus`
 * (which also closes find bars, settings overlays, the "More" menu, etc.), this
 * event is scoped to transient context menus so that opening one context menu
 * closes every OTHER context menu app-wide without disturbing unrelated UI.
 *
 * Fired: (a) by every context-menu opener (via usePositionedMenu.openMenu), and
 * (b) by a global capture-phase `contextmenu` listener (see App.tsx) so that
 * right-clicking empty space — which opens no menu — still closes any open ones.
 */
export const CLOSE_CONTEXT_MENUS_EVENT = 'berean:closeContextMenus'

/** Dispatch the context-menu-only close event. */
export function dispatchCloseContextMenus() {
  window.dispatchEvent(new Event(CLOSE_CONTEXT_MENUS_EVENT))
}

// ── MenuPositioner ────────────────────────────────────────────────────────────
// Drop-in wrapper for existing portal divs with hardcoded MENU_W/MENU_H estimates.
// Wrap the portal content in <MenuPositioner x={} y={}> instead of a plain div.
// It renders at (x, y) initially, then useLayoutEffect (before paint) adjusts
// left/top via direct DOM manipulation so all four corners stay in the viewport.
// No state is touched, no extra render, no flicker.


export const MenuPositioner = forwardRef<HTMLDivElement, {
  children: ReactNode
  x: number
  y: number
  className?: string
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
  onClick?: (e: React.MouseEvent) => void
  /** 'left' (default): x is the menu's left edge, flipping to open leftward only if it would
   *  overflow the viewport — the right cursor-menu behavior. 'right': x is the edge the menu's
   *  RIGHT side should always hug (e.g. a toolbar button's own right edge) regardless of
   *  viewport space, matching a trigger-anchored dropdown ("open below, right-aligned to the
   *  button") rather than a cursor-anchored context menu. Needed because content-sized menus
   *  (width not known ahead of render) can't have their target x precomputed by the caller —
   *  this measures the actual rendered width first, same as the flip logic below already does. */
  align?: 'left' | 'right'
}>(function MenuPositioner({ children, x, y, className = '', style, onMouseDown, onClick, align = 'left' }, outerRef) {
  const innerRef = useRef<HTMLDivElement>(null)
  // Merge refs
  const ref = (el: HTMLDivElement | null) => {
    (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (typeof outerRef === 'function') outerRef(el)
    else if (outerRef) (outerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
  }

  // Runs on every render but only does DOM writes (no setState) — no re-render loop.
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    let ax: number
    let ay = y
    if (align === 'right') {
      // x is the desired right edge — anchor there unconditionally using the real measured
      // width, rather than only flipping when the LEFT-anchored default would overflow.
      ax = x - width
    } else {
      // Prefer to open right+below cursor; flip if it would overflow.
      ax = x
      if (ax + width + pad > vw) ax = Math.max(pad, x - width)
    }
    if (ay + height + pad > vh) ay = Math.max(pad, y - height)
    // Hard clamp
    ax = Math.max(pad, Math.min(ax, vw - width - pad))
    ay = Math.max(pad, Math.min(ay, vh - height - pad))
    el.style.left = `${ax}px`
    el.style.top  = `${ay}px`
  })

  // Explicit inline no-drag: this is portaled to document.body, so it can end up rendered
  // over an ancestor trigger's `-webkit-app-region: drag` area (e.g. Ribbon.tsx's icon rail,
  // which is itself a drag region) purely by screen position, regardless of the .no-drag CSS
  // class or normal DOM paint order — Electron's drag hit-testing is computed from a
  // periodically-scanned list of draggable screen rectangles at the browser-process level, not
  // guaranteed to respect what's visually painted on top. Without this, every MenuPositioner-
  // based menu opened from within a drag region (e.g. the session right-click menu) could have
  // its buttons silently unclickable.
  return createElement('div', {
    ref,
    className,
    onMouseDown,
    onClick,
    style: { position: 'fixed', left: x, top: y, zIndex: 9999, WebkitAppRegion: 'no-drag', ...style } as React.CSSProperties,
  }, children)
})
