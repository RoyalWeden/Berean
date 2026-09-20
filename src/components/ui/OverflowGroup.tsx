import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
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
export function OverflowGroup({ children, className, gap = 8, label = 'More', renderOverflow, extraItems, fit = 'self', inset = 24 }: OverflowGroupProps) {
  const all = Children.toArray(children).filter(isValidElement) as ReactElement[]
  // Priority: 'never' items are pinned (always shown, measured first); 'first' fold first.
  const prio = (el: ReactElement) => ((el.props as { priority?: string }).priority ?? (el.props as { 'data-overflow-priority'?: string })['data-overflow-priority'] ?? 'default')
  const pinned = all.filter((e) => prio(e) === 'never')
  const foldable = all.filter((e) => prio(e) !== 'never')
  const items = [...pinned, ...foldable]
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(items.length)
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
      let used = 0, n = 0
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i] + (i ? gap : 0)
        const needMore = (i < widths.length - 1 || hasExtra) ? moreW : 0
        if (used + w + needMore > avail) break
        used += w; n++
      }
      // Pinned items never fold: if even they don't fit, still show them (they overflow the bar
      // rather than disappearing) — visual QA decides whether the bar's minimum width is wrong.
      n = Math.max(n, pinned.length)
      setVisible((prev) => (prev === n ? prev : n))
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
  }, [items.length, gap, fit, inset, pinned.length, !!(extraItems && extraItems.length)])
  const shown = items.slice(0, visible)
  const folded = items.slice(visible)
  const foldedMeta = folded.map((el) => ({ el, items: (el.props as { items?: OverflowItemMeta[] }).items, label: (el.props as { label?: string }).label }))
  const hasMenu = folded.length > 0 || !!(extraItems && extraItems.length)
  return (
    <div ref={rootRef} className={cx('relative flex items-center min-w-0', fit === 'self' && 'flex-1', className)} style={{ gap }}>
      {/* Hidden measuring copy — every item at its natural width */}
      <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex items-center invisible pointer-events-none" style={{ gap }}>
        {items.map((it, i) => <div key={i} className="flex-shrink-0">{it}</div>)}
      </div>
      {shown}
      {hasMenu && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton icon={MoreHorizontal} label={label} size={28} />
          </PopoverTrigger>
          <PopoverSurface align="end" innerClassName="p-1 min-w-[220px]" role="menu">
            {renderOverflow ? renderOverflow(folded) : (
              <>
                {foldedMeta.map(({ el, items: meta, label: sectionLabel }, i) => meta ? (
                  <MenuGroup key={i} label={sectionLabel}>
                    {meta.map((m) => (
                      <MenuItem key={m.key} icon={m.icon} label={m.label} shortcut={m.shortcut} active={m.checked} disabled={m.disabled} danger={m.danger} onClick={m.onSelect} />
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
                        <MenuItem key={m.key} icon={m.icon} label={m.label} shortcut={m.shortcut} active={m.checked} disabled={m.disabled} danger={m.danger} onClick={m.onSelect} />
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
