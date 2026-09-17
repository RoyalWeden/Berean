import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'
import { useControlSurface, type ControlSurface } from './surface'

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
  /** 'glass' = visible capsule at rest (toolbars); 'ghost' = transparent at rest (inline row actions).
   *  Defaults to the surrounding `Toolbar`'s material, else 'ghost'. */
  variant?: ControlSurface
  /** Accent-tinted "this mode is on" state (rail space, Strong's toggle, filter). */
  active?: boolean
  /** Neutral raised "this item is current" state (segment-like). */
  selected?: boolean
  /** Hover turns destructive (close / delete). */
  danger?: boolean
  /** Solid accent fill (play / send). */
  filled?: boolean
  loading?: boolean
  /** Show the label as a tooltip (default true). Object form adds a shortcut hint / side. */
  tooltip?: boolean | { shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right' }
  strokeWidth?: number
  iconClassName?: string
  children?: ReactNode
}

/**
 * Capsule icon button — the single recipe for every toolbar/rail/row icon control.
 * States: rest (ghost or glass) → hover (lift) → pressed (deeper lift, 0.97 scale) →
 * selected/active (persistent material) → focus-visible ring → disabled (dimmed, still hoverable
 * so its tooltip can explain why).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 28, variant, active, selected, danger, filled, loading, tooltip = true, strokeWidth, iconClassName, className, type = 'button', disabled, onClick, children, ...rest },
  ref,
) {
  const s = SIZE[size]
  const surface = useControlSurface(variant)
  const isOff = disabled || loading
  const state = filled
    ? 'bg-accent text-white shadow-control hover:bg-accent-raised active:bg-accent-pressed'
    : active
      ? 'bg-accent-muted text-accent hover:bg-accent-hover active:bg-accent-active'
      : selected
        ? 'bg-control-selected text-text-primary shadow-control border border-hairline hover:brightness-110 active:brightness-95'
        : danger
          ? cx(surface === 'glass' ? 'control-glass text-text-secondary' : 'text-text-muted', 'hover:text-destructive hover:bg-destructive/12 active:bg-destructive/20')
          : surface === 'glass'
            ? 'control-glass text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed'
            : 'text-text-muted hover:text-text-primary hover:bg-control-hover active:bg-control-pressed'
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active !== undefined ? active : undefined}
      aria-disabled={isOff || undefined}
      aria-busy={loading || undefined}
      onClick={isOff ? (e: MouseEvent<HTMLButtonElement>) => e.preventDefault() : onClick}
      className={cx(
        'no-drag focus-ring inline-flex items-center justify-center flex-shrink-0 rounded-control select-none',
        'transition-[background-color,color,transform,filter,box-shadow] duration-base ease-mac cursor-pointer',
        'active:scale-[0.97]',
        s.box, state,
        isOff && 'opacity-40 cursor-default active:scale-100',
        className,
      )}
      {...rest}
    >
      {loading
        ? <Loader2 size={s.icon} className="animate-spin" />
        : <Icon size={s.icon} strokeWidth={strokeWidth ?? (active || selected || filled ? 2 : 1.75)} className={iconClassName} />}
      {children}
    </button>
  )
  if (!tooltip) return btn
  const opts = typeof tooltip === 'object' ? tooltip : {}
  return <Tooltip label={label} shortcut={opts.shortcut} side={opts.side}>{btn}</Tooltip>
})

export default IconButton
