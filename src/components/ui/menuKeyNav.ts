import type { KeyboardEvent } from 'react'

const ITEMS = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled]),[role="option"]:not([aria-disabled="true"])'

/**
 * The macOS menu keys for any `role="menu"` container: ↑/↓ move between items (wrapping),
 * Home/End jump to the ends, and a printable character jumps to the next item starting with it.
 * Shared by MenuSurface and PopoverSurface (role="menu"), so a pop-up button's menu (Match, Sort…)
 * behaves exactly like a context menu. Enter/Space are left to the focused item itself.
 */
export function menuKeyNav(e: KeyboardEvent<HTMLElement>): void {
  if (e.defaultPrevented) return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ITEMS))
  if (!items.length) return
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
    const i = items.indexOf(document.activeElement as HTMLElement)
    const order = [...items.slice(i + 1), ...items.slice(0, i + 1)]
    const hit = order.find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(e.key.toLowerCase()))
    if (hit) { e.preventDefault(); hit.focus() }
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
    : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items[next]?.focus()
}
