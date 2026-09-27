import { useLayoutEffect, useState, type RefObject } from 'react'
import { safeAreaBottom, safeAreaTop } from './safeArea'

/**
 * Keyboard-aware placement for a menu anchored to a control (UI-MENU-001) — the one geometry rule
 * every anchored phone menu uses, instead of fixed CSS offsets that crop when the keyboard is up.
 *
 * The usable band is the layout viewport minus the top safe area (status bar / Dynamic Island) and
 * minus whatever covers the bottom (the keyboard when it is up, else the home-indicator inset).
 * The menu goes on the preferred side of its anchor when it fits there, else on the side with more
 * room; it is never taller than that side's room — when the options genuinely do not fit, the list
 * scrolls inside the menu instead of being cut off. Sheet detents and page scroll need no special
 * case: the anchor's measured rectangle already reflects them.
 */
export interface AnchoredMenuInput {
  /** The anchor's rectangle in viewport coordinates. */
  anchor: { top: number; bottom: number }
  /** The menu's natural (unconstrained) height. */
  content: number
  /** Layout-viewport height (window.innerHeight). */
  viewportHeight: number
  /** Height the keyboard covers at the bottom (0 when hidden). */
  keyboard: number
  safeTop: number
  safeBottom: number
  prefer?: 'above' | 'below'
  /** Distance kept from the screen edges / keyboard (default 8). */
  margin?: number
  /** Space between anchor and menu (default 10). */
  gap?: number
}

export interface AnchoredMenuLayout {
  placement: 'above' | 'below'
  /** Height the menu may take; the list scrolls inside it when `scroll`. */
  maxHeight: number
  scroll: boolean
}

export function layoutAnchoredMenu(i: AnchoredMenuInput): AnchoredMenuLayout {
  const margin = i.margin ?? 8, gap = i.gap ?? 10
  const top = i.safeTop + margin
  const bottom = i.viewportHeight - Math.max(i.keyboard, i.safeBottom) - margin
  const above = Math.max(0, i.anchor.top - gap - top)
  const below = Math.max(0, bottom - (i.anchor.bottom + gap))
  const prefer = i.prefer ?? 'above'
  const [first, second] = prefer === 'above' ? [above, below] : [below, above]
  const usePreferred = i.content <= first || first >= second
  const placement: 'above' | 'below' = usePreferred ? prefer : (prefer === 'above' ? 'below' : 'above')
  const room = placement === 'above' ? above : below
  return { placement, maxHeight: Math.floor(room), scroll: i.content > room }
}

/** Keyboard height the shell publishes (`--m-keyboard-h`, set from the Capacitor Keyboard events). */
export function keyboardHeight(): number {
  if (typeof document === 'undefined') return 0
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--m-keyboard-h')) || 0
}

/**
 * Measures and re-measures while `open`: on open, keyboard show / hide, viewport resize or scroll,
 * and the menu's own content changes (e.g. a link field replacing the options).
 */
export function useAnchoredMenu(open: boolean, anchorRef: RefObject<HTMLElement>, menuRef: RefObject<HTMLElement>, prefer: 'above' | 'below' = 'above'): AnchoredMenuLayout | null {
  const [layout, setLayout] = useState<AnchoredMenuLayout | null>(null)
  useLayoutEffect(() => {
    if (!open) { setLayout(null); return }
    const measure = () => {
      const a = anchorRef.current, m = menuRef.current
      if (!a || !m) return
      const r = a.getBoundingClientRect()
      const next = layoutAnchoredMenu({
        anchor: { top: r.top, bottom: r.bottom }, content: m.scrollHeight,
        viewportHeight: window.innerHeight, keyboard: keyboardHeight(),
        safeTop: safeAreaTop(), safeBottom: safeAreaBottom(), prefer,
      })
      setLayout((cur) => (cur && cur.placement === next.placement && cur.maxHeight === next.maxHeight && cur.scroll === next.scroll ? cur : next))
    }
    measure()
    // The keyboard animates; measure again once it has settled.
    const settle = setTimeout(measure, 320)
    const vv = window.visualViewport
    window.addEventListener('resize', measure)
    window.addEventListener('berean:keyboard', measure)
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    const ro = typeof ResizeObserver !== 'undefined' && menuRef.current ? new ResizeObserver(measure) : null
    if (ro && menuRef.current) ro.observe(menuRef.current)
    return () => {
      clearTimeout(settle)
      window.removeEventListener('resize', measure)
      window.removeEventListener('berean:keyboard', measure)
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
      ro?.disconnect()
    }
  }, [open, anchorRef, menuRef, prefer])
  return layout
}
