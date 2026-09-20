import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

export interface DisclosureRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  open: boolean
  title: ReactNode
  icon?: LucideIcon
  iconClassName?: string
  count?: number | string
  /** Trailing content (lock icon, badge) — non-interactive. */
  trailing?: ReactNode
  indent?: number
  dense?: boolean
}

/** Collapsible group header row (system folders, sections). Keyboard reachable; chevron rotates. */
export const DisclosureRow = forwardRef<HTMLButtonElement, DisclosureRowProps>(function DisclosureRow(
  { open, title, icon: Icon, iconClassName, count, trailing, indent, dense = true, className, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-expanded={open}
      className={cx(
        // display:flex makes the button block-level (fills its container width), so no `w-full` —
        // w-full + a caller's mx-* margins would overflow the scroller by the margin width.
        'focus-ring group/dr flex items-center gap-1.5 text-left rounded-row cursor-pointer select-none min-w-0',
        dense ? 'h-7 px-1.5' : 'h-8 px-2',
        'text-text-secondary hover:text-text-primary hover:bg-lift-2 active:bg-lift-3 transition-colors duration-fast',
        className,
      )}
      style={indent ? { paddingLeft: indent } : undefined}
      {...rest}
    >
      <ChevronRight size={12} strokeWidth={2} className={cx('flex-shrink-0 text-text-muted transition-transform duration-base ease-mac', open && 'rotate-90')} />
      {Icon && <Icon size={13} strokeWidth={1.75} className={cx('flex-shrink-0', iconClassName ?? 'text-text-muted')} />}
      <span className="flex-1 min-w-0 truncate text-footnote font-medium">{title}</span>
      {count !== undefined && <span className="text-caption2 text-text-muted tabular-nums">{count}</span>}
      {trailing}
    </button>
  )
})
export default DisclosureRow
