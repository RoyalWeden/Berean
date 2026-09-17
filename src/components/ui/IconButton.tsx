import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'

export type IconButtonSize = 20 | 24 | 28 | 32

const SIZE: Record<IconButtonSize, { box: string; icon: number }> = {
  20: { box: 'w-5 h-5', icon: 11 },
  24: { box: 'w-6 h-6', icon: 12 },
  28: { box: 'w-7 h-7', icon: 14 },
  32: { box: 'w-8 h-8', icon: 16 },
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Accessible name; also the tooltip text unless `tooltip={false}`. */
  label: string
  size?: IconButtonSize
  /** Accent-tinted "this mode is on" state (rail space, Strong's toggle, filter). */
  active?: boolean
  /** Neutral "this item is current" state (segment-like, matches sidebar selection). */
  selected?: boolean
  /** Hover turns destructive (close / delete). */
  danger?: boolean
  /** Show the label as a tooltip (default true). Pass a string for a custom shortcut hint. */
  tooltip?: boolean | { shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right' }
  /** Override the icon's stroke weight (default 1.75; active/selected bump to 2). */
  strokeWidth?: number
  /** Extra classes for the icon element. */
  iconClassName?: string
  children?: ReactNode
}

/**
 * Capsule icon button — the single recipe for every toolbar/rail/row icon control.
 * Sizes: 20 (inline close-x in rows), 24 (dense chrome), 28 (toolbar default), 32 (rail).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 28, active, selected, danger, tooltip = true, strokeWidth, iconClassName, className, type = 'button', children, ...rest },
  ref,
) {
  const s = SIZE[size]
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active !== undefined ? active : undefined}
      className={cx(
        'no-drag focus-ring inline-flex items-center justify-center flex-shrink-0 rounded-control select-none',
        'transition-[background-color,color,transform] duration-base ease-mac cursor-pointer',
        'active:scale-[0.96] disabled:opacity-40 disabled:pointer-events-none',
        s.box,
        active
          ? 'bg-accent-muted text-accent hover:bg-accent-hover'
          : selected
            ? 'bg-surface-selected text-text-primary'
            : danger
              ? 'text-text-muted hover:text-destructive hover:bg-destructive/12'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
        className,
      )}
      {...rest}
    >
      <Icon size={s.icon} strokeWidth={strokeWidth ?? (active || selected ? 2 : 1.75)} className={iconClassName} />
      {children}
    </button>
  )
  if (!tooltip) return btn
  const opts = typeof tooltip === 'object' ? tooltip : {}
  return <Tooltip label={label} shortcut={opts.shortcut} side={opts.side}>{btn}</Tooltip>
})

export default IconButton
