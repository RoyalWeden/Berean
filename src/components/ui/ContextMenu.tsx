import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { MenuSurface } from './Menu'
import { MenuPositioner, dispatchCloseContextMenus, useMenuDismiss } from '@/lib/usePositionedMenu'

export interface ContextMenuState<T> { x: number; y: number; payload: T }

/**
 * The one contextual-menu helper (§64–68): open at the pointer (right-click) or below an anchor
 * rect (keyboard: Shift+F10 on a focused row), render `MenuSurface` children, focus the first
 * item, close on Escape / outside mousedown / wheel or scroll outside the menu / window resize or
 * blur / another-menu-open, and return focus to the element that opened it (Escape). The menu is
 * portaled to document.body and measured + flipped + clamped by MenuPositioner.
 *
 *   const menu = useContextMenu<{ note: Note }>()
 *   <ListRow onContextMenu={(e) => menu.openAt(e, { note })} ... />
 *   <menu.Menu>{(p) => <><MenuItem … /></>}</menu.Menu>
 */
export function useContextMenu<T>(opts: { /** Close when anything outside the menu scrolls, programmatic scrolls included (default true). A user wheel always closes. */ closeOnScroll?: boolean } = {}) {
  const [state, setState] = useState<ContextMenuState<T> | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const openAt = useCallback((e: ReactMouseEvent | ReactKeyboardEvent | { x: number; y: number; target?: EventTarget | null }, payload: T) => {
    if ('preventDefault' in e) e.preventDefault()
    if ('stopPropagation' in e) e.stopPropagation()
    dispatchCloseContextMenus()
    openerRef.current = (('currentTarget' in e ? e.currentTarget : e.target) as HTMLElement | null) ?? (document.activeElement as HTMLElement | null)
    let x: number, y: number
    if ('clientX' in e && (e as ReactMouseEvent).clientX > 0) { x = (e as ReactMouseEvent).clientX; y = (e as ReactMouseEvent).clientY }
    else if ('x' in e) { x = e.x; y = e.y }
    else {
      // Keyboard invocation: below the row's leading edge.
      const r = openerRef.current?.getBoundingClientRect()
      x = r ? r.left + 8 : 16; y = r ? r.bottom : 16
    }
    setState({ x, y, payload })
  }, [])

  const close = useCallback((refocus = true) => {
    setState(null)
    if (refocus && openerRef.current && document.contains(openerRef.current)) openerRef.current.focus({ preventScroll: true })
  }, [])

  useMenuDismiss(!!state, [surfaceRef], (reason) => close(reason === 'escape'), { closeOnScroll: opts.closeOnScroll ?? true })
  useEffect(() => {
    if (!state) return
    const raf = requestAnimationFrame(() => {
      const root = surfaceRef.current
      if (root && !root.contains(document.activeElement)) root.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
    // A second right-click while open re-anchors (new x/y) without re-running this.
  }, [!!state])

  // MenuPositioner portals to document.body and measures/flips/clamps the real menu.
  const Menu = useCallback(({ children, className, label }: { children: (payload: T, close: () => void) => ReactNode; className?: string; label?: string }) => {
    if (!state) return null
    return (
      <MenuPositioner x={state.x} y={state.y}>
        <MenuSurface ref={surfaceRef} aria-label={label} className={className} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('[role^="menuitem"]')) close(true) }}>
          {children(state.payload, () => close(true))}
        </MenuSurface>
      </MenuPositioner>
    )
  }, [state, close])

  /** Spread on a focusable row to support keyboard invocation (Shift+F10). */
  const keyboardProps = useCallback((payload: T) => ({
    onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'F10' && e.shiftKey) openAt(e, payload) },
  }), [openAt])

  return { state, openAt, close, Menu, keyboardProps, isOpen: !!state }
}
