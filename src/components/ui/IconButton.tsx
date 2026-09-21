import { forwardRef, useContext, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'
import { ControlShapeContext, useControlSurface, useInControlGroup, type ControlShape, type ControlSurface } from './surface'
import { Badge, type BadgeProps } from './Badge'
import { useBarMetrics, useCompactMetrics } from './metrics'

export type IconButtonSize = 20 | 24 | 28 | 32

/** Icon scale (§82): 20→12, 24→14, 28→16, 32→18. */
const SIZE: Record<IconButtonSize, { box: string; icon: number; radius: string }> = {
  20: { box: 'w-5 h-5', icon: 12, radius: 'rounded-control-sm' },
  24: { box: 'w-6 h-6', icon: 14, radius: 'rounded-control-sm' },
  28: { box: 'w-7 h-7', icon: 16, radius: 'rounded-control-md' },
  32: { box: 'w-8 h-8', icon: 18, radius: 'rounded-control-md' },
}
const DOWN: Record<IconButtonSize, IconButtonSize> = { 20: 20, 24: 20, 28: 24, 32: 28 }
/** The one bar box (CONTROL_H_BAR = 34): every IconButton in a bar renders at this size, so a
 *  toolbar shows one control height whatever size each call site asked for (see metrics.tsx). */
const BAR = { box: 'w-[34px] h-[34px]', icon: 17, radius: 'rounded-control-md' }

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Accessible name; also the tooltip text unless `tooltip={false}`. */
  label: string
  size?: IconButtonSize
  /** 'glass' = visible control at rest (toolbars); 'ghost' = transparent at rest (inline row actions).
   *  Defaults to the surrounding `Toolbar`'s material, else 'ghost'. */
  variant?: ControlSurface
  /** 'square' (rounded square, --radius-compact) or 'round' (capsule). Defaults: square for glass
   *  controls and anything inside a ControlGroup/Toolbar; round for ghost buttons elsewhere. */
  shape?: ControlShape
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
  /** Status marker at the top-right corner (live presenter, pending count). */
  badge?: { variant?: BadgeProps['variant']; tone?: BadgeProps['tone']; label?: string; children?: ReactNode }
  children?: ReactNode
}

/**
 * Icon button — the single recipe for every toolbar/rail/row icon control.
 * States: rest (ghost or glass) → hover (lift) → pressed (deeper lift, 0.98 scale) →
 * selected/active (persistent material) → focus-visible ring → disabled (dimmed, still hoverable
 * so its tooltip can explain why). Inside a ControlGroup it renders flat (the group owns the
 * material/radius) and only paints its own hover/pressed/selected fill.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 28, variant, shape, active, selected, danger, filled, loading, tooltip = true, strokeWidth, iconClassName, badge, className, type = 'button', disabled, onClick, children, ...rest },
  ref,
) {
  const compact = useCompactMetrics()
  const bar = useBarMetrics()
  const s = compact ? SIZE[DOWN[size]] : bar ? BAR : SIZE[size]
  const surface = useControlSurface(variant)
  const inGroup = useInControlGroup()
  const ctxShape = useContext(ControlShapeContext)
  const resolvedShape: ControlShape = shape ?? ctxShape ?? (surface === 'glass' ? 'square' : 'round')
  const isOff = disabled || loading
  let state: string
  if (inGroup) {
    // Flat inside a grouped control: no own chrome, fills only.
    state = filled
      ? 'bg-accent text-white hover:bg-accent-raised active:bg-accent-pressed'
      : active
        ? 'bg-accent-muted text-accent hover:bg-accent-hover active:bg-accent-active'
        : selected
          ? 'bg-control-selected text-text-primary'
          : danger
            ? 'text-text-secondary hover:text-destructive hover:bg-destructive/12 active:bg-destructive/20'
            : 'text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed'
  } else {
    state = filled
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
  }
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
        'no-drag focus-ring relative inline-flex items-center justify-center flex-shrink-0 select-none',
        'transition-[background-color,color,transform,filter,box-shadow] duration-base ease-mac cursor-pointer',
        inGroup ? 'rounded-none' : resolvedShape === 'square' ? s.radius : 'rounded-control',
        !inGroup && 'active:scale-[0.98]',
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
      {badge && <Badge {...badge} className="absolute -top-0.5 -right-0.5" />}
    </button>
  )
  if (!tooltip) return btn
  const opts = typeof tooltip === 'object' ? tooltip : {}
  return <Tooltip label={label} shortcut={opts.shortcut} side={opts.side}>{btn}</Tooltip>
})

export default IconButton
