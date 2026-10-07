import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { useSheets } from './Sheet'
import type { SheetAction } from './ActionSheet'
import { haptic } from './haptics'
import { layoutAnchoredMenu, keyboardHeight } from './anchoredMenu'
import { safeAreaBottom, safeAreaTop } from './safeArea'

/**
 * iOS popover menu (TEST 2026-10-03: "find places where a sheet may not be needed but instead a
 * popup menu like on iPhone that can easily get dismissed"). Quick choices and overflow actions
 * appear as a compact glass menu anchored to the control that opened them — not a bottom sheet
 * covering half the screen. A tap outside, Escape, or picking a row dismisses it.
 *
 * Same action shape as the action sheet (SheetAction), so a call site switches by swapping one
 * hook. An action with a `view` (a sub-page such as Sort or Status) still opens that view, in a
 * sheet of its own — substantial UI stays a sheet. `checked` marks the current choice.
 */
export interface PopoverAction extends SheetAction {
  checked?: boolean
  /** Start a new group (hairline separator above this row). */
  section?: boolean
  detail?: string
}

interface OpenMenu { anchor: DOMRect; title?: string; actions: PopoverAction[]; id: number }

let current: OpenMenu | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export function closePopoverMenu(): void { if (current) { current = null; emit() } }
function openMenu(anchor: Element, title: string | undefined, actions: PopoverAction[]) {
  current = { anchor: anchor.getBoundingClientRect(), title, actions, id: ++seq }
  emit()
}

/** `open(anchorElement, title?, actions)` — the popover twin of useActionSheet(). */
export function usePopoverMenu() {
  return (anchor: Element | null | undefined, title: string | undefined, actions: PopoverAction[]) => {
    if (!anchor) return
    void haptic.tap()
    openMenu(anchor, title, actions)
  }
}

const WIDTH = 250

/** Mounted once by the shell (inside SheetHost so sub-views can open sheets). */
export function PopoverMenuHost() {
  const menu = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current, () => null)
  const sheets = useSheets()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; origin: string } | null>(null)

  useLayoutEffect(() => {
    if (!menu || !ref.current) { setPos(null); return }
    const vw = window.innerWidth
    const content = ref.current.scrollHeight
    const lay = layoutAnchoredMenu({ anchor: menu.anchor, content, viewportHeight: window.innerHeight, keyboard: keyboardHeight(), safeTop: safeAreaTop(), safeBottom: safeAreaBottom(), prefer: 'below', gap: 8 })
    const width = Math.min(WIDTH, vw - 24)
    const rightAligned = menu.anchor.left + menu.anchor.width / 2 > vw / 2
    const left = Math.max(12, Math.min(vw - width - 12, rightAligned ? menu.anchor.right - width : menu.anchor.left))
    const height = Math.min(content, lay.maxHeight)
    const top = lay.placement === 'below' ? menu.anchor.bottom + 8 : menu.anchor.top - 8 - height
    setPos({ top, left, maxHeight: lay.maxHeight, origin: `${rightAligned ? 'right' : 'left'} ${lay.placement === 'below' ? 'top' : 'bottom'}` })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopoverMenu() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  if (!menu) return null
  const choose = (a: PopoverAction) => {
    if (a.disabled) return
    void haptic.select()
    closePopoverMenu()
    if (a.view) {
      const v = a.view()
      sheets.open({ id: `popover-${a.id}`, title: v.title, detents: [0.62, 0.92], render: (api) => v.render(api) })
      return
    }
    a.onSelect()
  }
  return createPortal(
    // An outside tap only DISMISSES (iOS): closing on pointerdown unmounted this layer before the
    // finger lifted, so the click landed on whatever was underneath — a search result opened
    // (TEST 2026-10-06, real tap in the simulator). Closing on the click consumes it; a drag
    // that starts outside closes the menu as the page starts to move.
    <div className="m-popover-layer"
      onClick={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); closePopoverMenu() } }}
      onTouchMove={(e) => { if (e.target === e.currentTarget) closePopoverMenu() }}>
      <div ref={ref} key={menu.id} role="menu" aria-label={menu.title} className="m-popover-menu"
        style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight, transformOrigin: pos.origin } : { visibility: 'hidden', top: 0, left: 0 }}>
        {menu.title && <div className="m-popover-title">{menu.title}</div>}
        {menu.actions.map((a, i) => (
          <button key={a.id} type="button" role="menuitem" disabled={a.disabled}
            className={`m-popover-row${a.destructive ? ' is-destructive' : ''}${a.section && i > 0 ? ' is-section' : ''}`}
            onClick={() => choose(a)}>
            <span className="m-popover-check" aria-hidden>{a.checked ? <Check size={15} strokeWidth={2.5} /> : null}</span>
            <span className="m-popover-label">{a.label}{a.detail && <small>{a.detail}</small>}</span>
            {a.icon && <a.icon size={18} aria-hidden className="m-popover-icon" />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/** Tests only. */
export function _popoverState(): OpenMenu | null { return current }
export type { OpenMenu }
