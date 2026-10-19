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
import { useState, useRef, useLayoutEffect, useEffect, forwardRef, createElement, createContext, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Viewport margin every menu keeps from the window edge. */
export const MENU_EDGE_PAD = 8

export interface MenuPlacement { left: number; top: number; flippedX: boolean; flippedY: boolean }

/**
 * The one placement rule for every cursor/trigger-anchored menu (pure — unit-tested in
 * src/lib/__tests__/menuPlacement.test.ts). The menu's top-left corner sits exactly on the
 * anchor point (no offsets); if the MEASURED menu would cross the right / bottom edge it flips
 * to open leftward / upward from the same point (macOS NSMenu behaviour), and finally it is
 * clamped inside the viewport with MENU_EDGE_PAD so a menu larger than the space on both sides
 * still never leaves the window. `align: 'right'` anchors the menu's right edge on x instead
 * (trigger-anchored dropdowns that hug their button's right edge).
 *
 * TEST 2026-10-17: the Scripture verse menu used hard-coded 180×240 size guesses and clamped
 * without flipping, so near the bottom it slid away from the cursor and still clipped.
 */
export function computeMenuPosition(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { pad?: number; align?: 'left' | 'right' } = {},
): MenuPlacement {
  const pad = opts.pad ?? MENU_EDGE_PAD
  const { x, y } = anchor
  const { width, height } = size
  let left = opts.align === 'right' ? x - width : x
  if (opts.align !== 'right' && left + width + pad > viewport.width) left = x - width
  let top = y
  if (top + height + pad > viewport.height) top = y - height
  left = Math.max(pad, Math.min(left, viewport.width - width - pad))
  top = Math.max(pad, Math.min(top, viewport.height - height - pad))
  return { left, top, flippedX: opts.align === 'right' || left < x, flippedY: top < y }
}

/**
 * Shared dismissal for transient menus: outside mousedown, Escape, a wheel scroll or any
 * document scroll outside the menu (a fixed menu would otherwise float detached from the row it
 * was opened on), window resize / blur, and the app-wide close events. `inside` lists every
 * element that counts as "the menu" (surface + flyouts) — portaled menus are NOT DOM
 * descendants of their opener, so the opener's own ref must never be the outside-click test.
 */
export function useMenuDismiss(
  open: boolean,
  inside: Array<RefObject<HTMLElement | null>>,
  onDismiss: (reason: 'outside' | 'escape' | 'scroll' | 'resize' | 'blur' | 'event') => void,
  opts: { closeOnScroll?: boolean } = {},
): void {
  const cb = useRef(onDismiss)
  cb.current = onDismiss
  const insideRef = useRef(inside)
  insideRef.current = inside
  const closeOnScroll = opts.closeOnScroll ?? true
  useEffect(() => {
    if (!open) return
    const isInside = (t: EventTarget | null) => t instanceof Node && insideRef.current.some((r) => r.current?.contains(t))
    const onDown = (e: MouseEvent) => { if (!isInside(e.target)) cb.current('outside') }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cb.current('escape') } }
    const onWheel = (e: Event) => { if (!isInside(e.target)) cb.current('scroll') }
    const onScroll = (e: Event) => { if (closeOnScroll && !isInside(e.target)) cb.current('scroll') }
    const onResize = () => cb.current('resize')
    const onBlur = () => cb.current('blur')
    const onEvent = () => cb.current('event')
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onBlur)
    window.addEventListener('berean:closeMenus', onEvent)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onEvent)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('berean:closeMenus', onEvent)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onEvent)
    }
  }, [open, closeOnScroll])
}

/** True inside a MenuPositioner: a MenuSurface rendered there is a transient menu and focuses its
 *  first item on open (keyboard users can arrow immediately; Escape/outside close it). */
export const InPositionedMenuContext = createContext(false)

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
    // Layout size, not getBoundingClientRect: menuRef is often the MenuSurface itself, whose
    // entrance animation starts at scale(0.96) — a transformed rect under-measures by 4%.
    const width = el.offsetWidth, height = el.offsetHeight
    // Cursor position (raw) is stored in x/y before adjustment
    const { left: x, top: y } = computeMenuPosition(menu, { width, height }, { width: window.innerWidth, height: window.innerHeight })
    setMenuRaw({ ...menu, x, y, _adjusted: true })
  }) // no deps — runs every render, but the `_adjusted` flag stops it after the first pass

  // ── Click-outside / Escape / wheel / resize / blur / close events ─────────
  // Programmatic scrolls don't close (closeOnScroll: false) — several of these menus open from
  // rows that scroll themselves into view; a user wheel still does.
  useMenuDismiss(!!menu, [menuRef], () => setMenuRaw(null), { closeOnScroll: false })

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
// The one positioning layer for menus. It renders at (x, y), then (before paint) measures the
// real menu and places it with computeMenuPosition — flip near the right/bottom edge, clamp
// inside the window — via direct DOM writes (no state, no extra render, no flicker). A
// ResizeObserver re-places it when the content changes size after mount (a submenu row
// expanding, a colour grid, async items), measured from the ORIGINAL anchor so it never drifts.
//
// It portals itself to document.body (portal={false} to opt out). TEST 2026-10-17: a
// `position: fixed` menu rendered inline inside the chapter view was (a) offset from the
// cursor because ancestors use CSS `zoom` (PanelLayout's app zoom, the side panel's zoom —
// Chromium 128+ multiplies a fixed child's left/top by the ancestor zoom while clientX/Y stay
// viewport px), and (b) see-through / layered under neighbours because ChapterView's
// `view-transition-name` makes the chapter a stacking context and backdrop root (z-index only
// ranked inside the chapter; backdrop-filter could only blur the chapter's own pixels).
// At body level clientX/Y and left/top are the same coordinate space. Callers that already
// portal are unaffected (a portal inside a portal to the same node is a no-op re-parent).

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
  /** Render through a portal to document.body (default true). */
  portal?: boolean
}>(function MenuPositioner({ children, x, y, className = '', style, onMouseDown, onClick, align = 'left', portal = true }, outerRef) {
  const innerRef = useRef<HTMLDivElement>(null)
  // Merge refs
  const ref = (el: HTMLDivElement | null) => {
    (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (typeof outerRef === 'function') outerRef(el)
    else if (outerRef) (outerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
  }
  const anchor = useRef({ x, y, align })
  anchor.current = { x, y, align }

  const place = () => {
    const el = innerRef.current
    if (!el) return
    const width = el.offsetWidth, height = el.offsetHeight
    const a = anchor.current
    const p = computeMenuPosition(a, { width, height }, { width: window.innerWidth, height: window.innerHeight }, { align: a.align })
    el.style.left = `${p.left}px`
    el.style.top  = `${p.top}px`
    // Origin-aware entrance (§57/§103): the menu grows out of the corner nearest its trigger.
    el.style.setProperty('--menu-origin', `${p.flippedY ? 'bottom' : 'top'} ${p.flippedX ? 'right' : 'left'}`)
  }

  // Runs on every render but only does DOM writes (no setState) — no re-render loop.
  useLayoutEffect(place)

  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Placement writes only left/top, never the size, so this cannot feed back into itself.
    const ro = new ResizeObserver(() => place())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Explicit inline no-drag: this is portaled to document.body, so it can end up rendered
  // over an ancestor trigger's `-webkit-app-region: drag` area (e.g. Ribbon.tsx's icon rail,
  // which is itself a drag region) purely by screen position, regardless of the .no-drag CSS
  // class or normal DOM paint order — Electron's drag hit-testing is computed from a
  // periodically-scanned list of draggable screen rectangles at the browser-process level, not
  // guaranteed to respect what's visually painted on top. Without this, every MenuPositioner-
  // based menu opened from within a drag region (e.g. the session right-click menu) could have
  // its buttons silently unclickable.
  const node = createElement(InPositionedMenuContext.Provider, { value: true }, createElement('div', {
    ref,
    className,
    onMouseDown,
    onClick,
    'data-menu-positioner': '',
    style: { position: 'fixed', left: x, top: y, zIndex: 'var(--z-menu)' as unknown as number, WebkitAppRegion: 'no-drag', ...style } as React.CSSProperties,
  }, children))
  return portal && typeof document !== 'undefined' ? createPortal(node, document.body) : node
})
