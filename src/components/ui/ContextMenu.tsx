import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MenuSurface } from './Menu'
import { MenuPositioner, dispatchCloseContextMenus, CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'

export interface ContextMenuState<T> { x: number; y: number; payload: T }

/**
 * The one contextual-menu helper (§64–68): open at the pointer (right-click) or below an anchor
 * rect (keyboard: Shift+F10 on a focused row), render `MenuSurface` children, focus the first
 * item, close on Escape / outside mousedown / scroll of any ancestor / window blur /
 * another-menu-open, and return focus to the element that opened it.
 *
 *   const menu = useContextMenu<{ note: Note }>()
 *   <ListRow onContextMenu={(e) => menu.openAt(e, { note })} ... />
 *   <menu.Menu>{(p) => <><MenuItem … /></>}</menu.Menu>
 */
export function useContextMenu<T>() {
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

  useEffect(() => {
    if (!state) return
    const onDown = (e: MouseEvent) => { if (!surfaceRef.current?.contains(e.target as Node)) close(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(true) } }
    const onAway = () => close(false)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onAway, true)
    window.addEventListener('blur', onAway)
    window.addEventListener('berean:closeMenus', onAway)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onAway)
    requestAnimationFrame(() => surfaceRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus())
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onAway, true)
      window.removeEventListener('blur', onAway)
      window.removeEventListener('berean:closeMenus', onAway)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onAway)
    }
  }, [!!state, close])

  const Menu = useCallback(({ children, className }: { children: (payload: T, close: () => void) => ReactNode; className?: string }) => {
    if (!state) return null
    return createPortal(
      <MenuPositioner x={state.x} y={state.y}>
        <MenuSurface ref={surfaceRef} className={className} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('[role^="menuitem"]')) close(true) }}>
          {children(state.payload, () => close(true))}
        </MenuSurface>
      </MenuPositioner>,
      document.body,
    )
  }, [state, close])

  /** Spread on a focusable row to support keyboard invocation (Shift+F10). */
  const keyboardProps = useCallback((payload: T) => ({
    onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'F10' && e.shiftKey) openAt(e, payload) },
  }), [openAt])

  return { state, openAt, close, Menu, keyboardProps, isOpen: !!state }
}
