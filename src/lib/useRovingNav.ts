import { useCallback, type KeyboardEvent } from 'react'

/**
 * Roving keyboard navigation (§59/§71) for lists, tab strips and grids that are NOT native
 * menus: ArrowUp/Down (or Left/Right), Home/End move focus between the matching items inside
 * the container; Enter/Space are left to the focused control itself. Returns an onKeyDown to
 * spread on the container. Items are found by `selector` (default: focusable rows/buttons that
 * aren't disabled).
 */
export function useRovingNav(opts: {
  orientation?: 'vertical' | 'horizontal' | 'both'
  selector?: string
  /** Wrap from last→first (default true). */
  loop?: boolean
  /** Grid column count — enables Up/Down to jump a row in 'both' orientation. */
  columns?: number
} = {}) {
  const { orientation = 'vertical', selector = '[role="option"],[role="tab"],[role="radio"],[role="gridcell"],[role="treeitem"],[role="row"] > button,button[data-roving],a[data-roving]', loop = true, columns } = opts
  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp'
    const horizontal = e.key === 'ArrowRight' || e.key === 'ArrowLeft'
    const edge = e.key === 'Home' || e.key === 'End'
    if (!vertical && !horizontal && !edge) return
    if (orientation === 'vertical' && horizontal && !columns) return
    if (orientation === 'horizontal' && vertical) return
    const target = e.target as HTMLElement
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return
    const root = e.currentTarget
    const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && el.tabIndex >= -1)
    if (!items.length) return
    const i = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement))
    let next: number
    if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else {
      const step = columns && vertical ? columns : 1
      const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight'
      if (i < 0) next = fwd ? 0 : items.length - 1
      else {
        next = fwd ? i + step : i - step
        if (next < 0) next = loop && step === 1 ? items.length - 1 : Math.max(0, i)
        if (next >= items.length) next = loop && step === 1 ? 0 : Math.min(items.length - 1, i)
      }
    }
    e.preventDefault()
    items[next]?.focus()
  }, [orientation, selector, loop, columns])
}

/** Calendar-style grid: arrows move by 1 / by `columns`. */
export function useRovingGridNav(columns: number, selector?: string) {
  return useRovingNav({ orientation: 'both', columns, selector, loop: false })
}
