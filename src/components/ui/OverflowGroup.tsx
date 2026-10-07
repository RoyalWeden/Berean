import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cx } from './cx'
import { IconButton } from './IconButton'
import { Popover, PopoverSurface, PopoverTrigger } from './PopoverSurface'
import { MenuGroup, MenuItem, MenuSeparator } from './Menu'
import type { LucideIcon } from 'lucide-react'

/**
 * Metadata a control exposes so it can be represented as a menu item when it folds into the
 * More menu (§17: nothing is hidden — folded controls keep label, icon, shortcut and state).
 * Set on any element via `data-overflow-*` attributes, or on a group via `overflowItems`.
 */
export interface OverflowItemMeta {
  key: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}
/** A wrapper whose children fold as ONE unit into a labelled menu section. */
// `items`/`priority`/`label` are read by OverflowGroup from the element's React props (never
// spread onto the DOM); the div only carries layout.
export function OverflowSection({ children, className }: { children: ReactNode; className?: string; label?: string; items?: OverflowItemMeta[]; priority?: 'never' | 'last' | 'first' }) {
  return <div className={cx('flex items-center gap-2 flex-shrink-0', className)}>{children}</div>
}

export interface OverflowGroupProps {
  /** Controls in priority order — trailing ones fold first. */
  children: ReactNode
  className?: string
  /** Gap between items (px). Default 8 (= gap-2). */
  gap?: number
  /** Accessible label for the overflow button. */
  label?: string
  /** Render folded items inside the popover. Default: each folded child that declares
   *  `overflowItems` (via OverflowSection) becomes a labelled MenuGroup of MenuItems; a child
   *  without metadata is rendered as-is (stacked) so nothing is ever lost. */
  renderOverflow?: (items: ReactElement[]) => ReactNode
  /** Extra always-present items appended below a separator (the curated low-frequency actions). */
  extraItems?: OverflowItemMeta[]
  /** Always-present rows at the TOP of the menu (e.g. MenuSub submenus such as a note's Status /
   *  Look), above the folded controls. Opening a submenu keeps the menu open; choosing a leaf row
   *  anywhere in the menu closes it (macOS menu behaviour). */
  menuHeader?: ReactNode
  /** Where the available width comes from. 'self' (default) — this element's own width (it is
   *  flex-1 in a bar). 'offsetParent' — for a floating shrink-to-fit bar (absolute + centred):
   *  the positioned ancestor's width minus `inset`, since the bar itself has no width until its
   *  children are decided. */
  fit?: 'self' | 'offsetParent'
  /** Horizontal room to leave inside the offsetParent (px, both sides combined). Default 24. */
  inset?: number
}

/**
 * A row of controls that folds its trailing items into a "…" popover when the row is too
 * narrow (§18/§75) — nothing is hidden, nothing scrolls sideways. Measures every child once
 * (all rendered, invisible) and shows as many leading items as fit.
 */
export function OverflowGroup({ children, className, gap = 8, label = 'More', renderOverflow, extraItems, menuHeader, fit = 'self', inset = 24 }: OverflowGroupProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const all = Children.toArray(children).filter(isValidElement) as ReactElement[]
  // Priority: 'never' items are pinned (always shown, measured first). Among the rest, 'first'
  // items fold first, then default ones, then 'last' (kept longest) — each group from its tail.
  // The VISUAL order never changes; only which items fold does.
  const prio = (el: ReactElement) => ((el.props as { priority?: string }).priority ?? (el.props as { 'data-overflow-priority'?: string })['data-overflow-priority'] ?? 'default')
  const pinned = all.filter((e) => prio(e) === 'never')
  const foldable = all.filter((e) => prio(e) !== 'never')
  const items = [...pinned, ...foldable]
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  // Indices (into `items`) currently folded into the menu.
  const [foldedKey, setFoldedKey] = useState('')
  useLayoutEffect(() => {
    const root = rootRef.current, m = measureRef.current
    if (!root || !m) return
    const compute = () => {
      const widths = Array.from(m.children).map((c) => (c as HTMLElement).getBoundingClientRect().width)
      let avail = root.getBoundingClientRect().width
      if (fit === 'offsetParent') {
        // Floating bar: walk up to the absolutely/fixed-positioned wrapper, take ITS containing
        // block's width, and subtract whatever chrome sits between that wrapper and this group
        // (bar padding, sibling controls) so the folded row fits inside the wrapper's max width.
        let a: HTMLElement | null = root
        while (a && !/^(absolute|fixed)$/.test(getComputedStyle(a).position)) a = a.parentElement
        const cb = a?.offsetParent instanceof HTMLElement ? a.offsetParent : null
        if (a && cb) {
          const chrome = a.getBoundingClientRect().width - root.getBoundingClientRect().width
          avail = cb.clientWidth - inset - chrome
        }
      }
      const moreW = 28 + gap
      const hasExtra = !!(extraItems && extraItems.length)
      const total = (k: Set<number>) => {
        let w = 0, first = true
        for (let i = 0; i < widths.length; i++) { if (k.has(i)) continue; w += widths[i] + (first ? 0 : gap); first = false }
        return w + ((k.size > 0 || hasExtra) ? moreW : 0)
      }
      // Fold order: 'first' items from the tail, then default, then 'last' — pinned never fold.
      const rank = (i: number) => { const p = prio(items[i]); return p === 'first' ? 0 : p === 'last' ? 2 : 1 }
      const order = items.map((_, i) => i).filter((i) => prio(items[i]) !== 'never').sort((a, b) => rank(a) - rank(b) || b - a)
      const folded = new Set<number>()
      for (const i of order) { if (total(folded) <= avail) break; folded.add(i) }
      const key = [...folded].sort((a, b) => a - b).join(',')
      setFoldedKey((prev) => (prev === key ? prev : key))
    }
    compute()
    if (typeof ResizeObserver === 'undefined') return  // jsdom / tests: measure once
    const ro = new ResizeObserver(compute)
    ro.observe(root); ro.observe(m)
    if (fit === 'offsetParent') {
      let a: HTMLElement | null = root
      while (a && !/^(absolute|fixed)$/.test(getComputedStyle(a).position)) a = a.parentElement
      if (a?.offsetParent instanceof HTMLElement) ro.observe(a.offsetParent)
    }
    return () => ro.disconnect()
  }, [items.length, gap, fit, inset, pinned.length, !!(extraItems && extraItems.length)]) // eslint-disable-line react-hooks/exhaustive-deps
  const foldedSet = new Set(foldedKey ? foldedKey.split(',').map(Number) : [])
  const shown = items.filter((_, i) => !foldedSet.has(i))
  const folded = items.filter((_, i) => foldedSet.has(i))
  const foldedMeta = folded.map((el) => ({ el, items: (el.props as { items?: OverflowItemMeta[] }).items, label: (el.props as { label?: string }).label }))
  const hasMenu = folded.length > 0 || !!(extraItems && extraItems.length) || menuHeader != null
  // A click on a leaf menu row (not a submenu trigger, not a folded live control) closes the menu.
  const closeOnChoose = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')
    if (row && row.getAttribute('aria-haspopup') !== 'menu' && !row.hasAttribute('disabled')) setMenuOpen(false)
  }
  return (
    <div ref={rootRef} className={cx('relative flex items-center min-w-0', fit === 'self' && 'flex-1', className)} style={{ gap }}>
      {/* Hidden measuring copy — every item at its natural width */}
      <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex items-center invisible pointer-events-none" style={{ gap }}>
        {items.map((it, i) => <div key={i} className="flex-shrink-0">{it}</div>)}
      </div>
      {shown}
      {hasMenu && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <IconButton icon={MoreHorizontal} label={label} size={28} selected={menuOpen} />
          </PopoverTrigger>
          <PopoverSurface align="end" innerClassName="p-1 min-w-[220px]" role="menu" onClick={closeOnChoose}>
            {menuHeader != null && (
              <>
                <MenuGroup>{menuHeader}</MenuGroup>
                {(folded.length > 0 || !!(extraItems && extraItems.length)) && <MenuSeparator />}
              </>
            )}
            {renderOverflow ? renderOverflow(folded) : (
              <>
                {/* Folded controls keep their checked state (aria-checked stays live either way — see
                    MenuItem) but draw it as the selected-row highlight rather than a leading checkmark,
                    so no column of blank leading space is reserved for items that never carry one
                    (§TEST-017/018) — same treatment as the session switcher (§TEST-012). */}
                {foldedMeta.map(({ el, items: meta, label: sectionLabel }, i) => meta ? (
                  <MenuGroup key={i} label={sectionLabel}>
                    {meta.map((m) => (
                      <MenuItem key={m.key} icon={m.icon} label={m.label} shortcut={m.shortcut} active={m.checked} selectionStyle="highlight" disabled={m.disabled} danger={m.danger} onClick={m.onSelect} />
                    ))}
                  </MenuGroup>
                ) : (
                  <div key={i} className="flex flex-col items-stretch gap-0.5 p-0.5">{el}</div>
                ))}
                {extraItems && extraItems.length > 0 && (
                  <>
                    {folded.length > 0 && <MenuSeparator />}
                    <MenuGroup>
                      {extraItems.map((m) => (
                        <MenuItem key={m.key} icon={m.icon} label={m.label} shortcut={m.shortcut} active={m.checked} selectionStyle="highlight" disabled={m.disabled} danger={m.danger} onClick={m.onSelect} />
                      ))}
                    </MenuGroup>
                  </>
                )}
              </>
            )}
          </PopoverSurface>
        </Popover>
      )}
    </div>
  )
}
export default OverflowGroup
