import { useId, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { IconButton } from './IconButton'
import { Badge, type BadgeProps } from './Badge'
import { SPRING_SNAPPY } from '@/lib/motion'
import { useRovingNav } from '@/lib/useRovingNav'

export interface TabStripItem<K extends string = string> {
  id: K
  label: ReactNode
  icon?: LucideIcon
  iconClassName?: string
  badge?: { variant?: BadgeProps['variant']; tone?: BadgeProps['tone']; children?: ReactNode; label?: string }
  closable?: boolean
  disabled?: boolean
  /** Accessible name when the label is not plain text. */
  title?: string
  draggable?: boolean
  onDragStart?: (e: DragEvent<HTMLElement>) => void
  onDragEnd?: (e: DragEvent<HTMLElement>) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent<HTMLElement>) => void
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  'data-attrs'?: Record<string, string | number | undefined>
}

export interface TabStripProps<K extends string = string> {
  items: TabStripItem<K>[]
  value: K | null
  onChange: (id: K, e?: MouseEvent | KeyboardEvent) => void
  onClose?: (id: K) => void
  /** sidebar — vertical inset rows (macOS source list) · inspector — horizontal flat strip · segmented — horizontal track. */
  variant?: 'sidebar' | 'inspector' | 'segmented'
  'aria-label'?: string
  className?: string
  /** Clicking the already-selected item calls this instead of onChange (inspector "click active tab closes slot" idiom). */
  onReselect?: (id: K) => void
  /** Stable key for the shared selection pill (two strips in one view must differ). */
  layoutKey?: string
}

/**
 * The one tab primitive (§69): document/panel tabs with an animated selection pill, hover,
 * focus ring, optional close, drag handlers, context menu, and roving keyboard navigation
 * (↑/↓ for sidebar, ←/→ for inspector/segmented; Home/End; Enter/Space select). Closing is
 * only via the × button, ⌘W (global) or the context menu — no Delete key binding.
 */
export function TabStrip<K extends string = string>({ items, value, onChange, onClose, variant = 'sidebar', className, 'aria-label': ariaLabel, onReselect, layoutKey }: TabStripProps<K>) {
  const id = useId()
  const vertical = variant === 'sidebar'
  const roving = useRovingNav({ orientation: vertical ? 'vertical' : 'horizontal', selector: '[role="tab"]:not([aria-disabled="true"])', loop: true })
  const pillId = layoutKey ?? `tabstrip-${id}`
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      onKeyDown={roving}
      className={cx(
        'no-drag min-w-0',
        vertical ? 'flex flex-col gap-px px-2' : variant === 'segmented' ? 'inline-flex items-stretch p-0.5 rounded-card bg-control shadow-[inset_0_0_0_1px_var(--control-border)]' : 'flex items-stretch gap-0.5',
        className,
      )}
    >
      {items.map((it) => {
        const on = it.id === value
        const { 'data-attrs': dataAttrs, ...item } = it
        return (
          <div key={it.id} className={cx('group/tabrow relative min-w-0', vertical ? '' : 'flex-1 flex')}>
            {on && (
              <motion.span
                layoutId={pillId}
                transition={SPRING_SNAPPY}
                aria-hidden
                className={cx('absolute inset-0 pointer-events-none', vertical ? 'rounded-control-md bg-accent-muted' : 'rounded-control-md bg-control-selected', variant === 'segmented' && 'border border-hairline shadow-1')}
              />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={it.disabled || undefined}
              aria-label={it.title}
              tabIndex={on ? 0 : -1}
              draggable={it.draggable}
              onDragStart={it.onDragStart}
              onDragEnd={it.onDragEnd}
              onDragOver={it.onDragOver}
              onDrop={it.onDrop}
              onContextMenu={it.onContextMenu}
              onClick={(e) => { if (it.disabled) return; if (on) onReselect?.(it.id); else onChange(it.id, e) }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !on) { e.preventDefault(); onChange(it.id, e) } }}
              {...dataAttrs}
              className={cx(
                'focus-ring relative flex items-center min-w-0 select-none cursor-pointer transition-colors duration-fast rounded-control-md',
                vertical ? 'w-full h-7 px-2 gap-2 text-footnote text-left' : 'flex-1 justify-center h-[26px] px-1.5 gap-1.5 text-caption font-medium whitespace-nowrap',
                on ? (vertical ? 'text-text-primary font-medium' : 'text-text-primary') : 'text-text-secondary hover:text-text-primary hover:bg-lift-2 active:bg-lift-3',
                it.disabled && 'opacity-40 cursor-default',
                item.closable && vertical && 'group-hover/tabrow:pr-8 group-focus-within/tabrow:pr-8 transition-[padding]',
              )}
            >
              {it.icon && <it.icon size={vertical ? 14 : 13} strokeWidth={on ? 2 : 1.75} className={cx('flex-shrink-0', on ? 'text-accent' : it.iconClassName ?? 'text-text-tertiary')} />}
              <span className="relative z-10 min-w-0 truncate">{it.label}</span>
              {it.badge && <Badge {...it.badge} className="ml-auto" />}
            </button>
            {it.closable && vertical && onClose && (
              <span className={cx('absolute inset-y-0 right-1 flex items-center transition-opacity duration-fast', on ? 'opacity-60 hover:opacity-100' : 'opacity-0 pointer-events-none group-hover/tabrow:opacity-100 group-hover/tabrow:pointer-events-auto group-focus-within/tabrow:opacity-100 group-focus-within/tabrow:pointer-events-auto')} data-tab-close>
                <IconButton icon={X} label="Close tab" size={20} variant="ghost" danger tooltip={false} onClick={(e) => { e.stopPropagation(); onClose(it.id) }} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
export default TabStrip
