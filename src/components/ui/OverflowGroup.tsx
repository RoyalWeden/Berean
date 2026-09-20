import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cx } from './cx'
import { IconButton } from './IconButton'
import { Popover, PopoverSurface, PopoverTrigger } from './PopoverSurface'

export interface OverflowGroupProps {
  /** Controls in priority order — trailing ones fold first. */
  children: ReactNode
  className?: string
  /** Gap between items (px). Default 8 (= gap-2). */
  gap?: number
  /** Accessible label for the overflow button. */
  label?: string
  /** Render folded items inside the popover (default: stacked vertically, ghost surface). */
  renderOverflow?: (items: ReactElement[]) => ReactNode
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
export function OverflowGroup({ children, className, gap = 8, label = 'More', renderOverflow, fit = 'self', inset = 24 }: OverflowGroupProps) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement[]
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
      let used = 0, n = 0
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i] + (i ? gap : 0)
        const needMore = i < widths.length - 1 ? moreW : 0
        if (used + w + needMore > avail) break
        used += w; n++
      }
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
  }, [items.length, gap, fit, inset])
  const shown = items.slice(0, visible)
  const folded = items.slice(visible)
  return (
    <div ref={rootRef} className={cx('relative flex items-center min-w-0', fit === 'self' && 'flex-1', className)} style={{ gap }}>
      {/* Hidden measuring copy — every item at its natural width */}
      <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex items-center invisible pointer-events-none" style={{ gap }}>
        {items.map((it, i) => <div key={i} className="flex-shrink-0">{it}</div>)}
      </div>
      {shown}
      {folded.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton icon={MoreHorizontal} label={label} size={28} />
          </PopoverTrigger>
          <PopoverSurface align="end" innerClassName="p-1.5">
            {renderOverflow ? renderOverflow(folded) : <div className="flex flex-col items-stretch gap-0.5">{folded}</div>}
          </PopoverSurface>
        </Popover>
      )}
    </div>
  )
}
export default OverflowGroup
