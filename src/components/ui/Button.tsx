import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'
import { useControlSurface, useInControlGroup, type ControlSurface } from './surface'

/**
 * primary     — accent fill, capsule (the one default action on a surface)
 * prominent   — tinted glass (accent-muted + hairline): the important toolbar action
 * secondary   — interactive glass, visible at rest on any bar
 * ghost       — text until hovered
 * menu        — secondary/ghost with a trailing ▾ (dropdown trigger)
 * destructive / success / warning — filled status buttons
 */
export type ButtonVariant = 'primary' | 'prominent' | 'secondary' | 'ghost' | 'menu' | 'destructive' | 'success' | 'warning'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Defaults to 'secondary' (glass) inside a Toolbar, else 'ghost'. */
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconTrailing?: boolean
  loading?: boolean
  /** Toggled-on state for ghost/secondary buttons (e.g. "LXX", "Strong's"). */
  selected?: boolean
  /** Force the resting surface for a ghost button. */
  surface?: ControlSurface
  /** Tooltip text (+ optional shortcut) — replaces `title=` on interactive controls. */
  tooltip?: string | { label: string; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right' }
  children?: ReactNode
}

const FILLED: Record<'primary' | 'destructive' | 'success' | 'warning', string> = {
  primary: 'bg-accent text-white shadow-control hover:bg-accent-raised active:bg-accent-pressed',
  destructive: 'bg-destructive text-white shadow-control hover:brightness-110 active:brightness-90',
  success: 'bg-success text-white shadow-control hover:brightness-110 active:brightness-90',
  warning: 'bg-warning text-white shadow-control hover:brightness-110 active:brightness-90',
}
const SIZE: Record<ButtonSize, { box: string; icon: number }> = {
  sm: { box: 'h-7 px-2.5 text-footnote gap-1.5', icon: 14 },
  md: { box: 'h-8 px-3.5 text-subhead gap-2', icon: 14 },
}

/**
 * Capsule text button. `selected` composes an accent-muted tint on top of secondary/ghost and
 * keeps a pressed fill. Inside a ControlGroup the button renders flat (the group owns the
 * material) and only paints its own hover/pressed/selected fill.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size = 'sm', icon: Icon, iconTrailing, loading, selected, surface, tooltip, className, type = 'button', children, disabled, ...rest },
  ref,
) {
  const s = SIZE[size]
  const ctxSurface = useControlSurface(surface)
  const inGroup = useInControlGroup()
  const v: ButtonVariant = variant ?? (ctxSurface === 'glass' ? 'secondary' : 'ghost')
  const iconEl = loading
    ? <Loader2 size={s.icon} className="animate-spin" />
    : Icon ? <Icon size={s.icon} strokeWidth={selected ? 2 : 1.75} /> : null
  let look: string
  if (inGroup && (v === 'secondary' || v === 'ghost' || v === 'menu' || v === 'prominent')) {
    look = selected
      ? 'bg-accent-muted text-accent hover:bg-accent-hover active:bg-accent-active'
      : v === 'prominent'
        ? 'text-accent hover:bg-accent-muted active:bg-accent-hover'
        : 'text-text-primary hover:bg-control-hover active:bg-control-pressed'
  } else if (v === 'secondary' || v === 'menu') {
    look = selected
      ? 'control-glass bg-accent-muted text-accent hover:bg-accent-hover active:bg-accent-active'
      : ctxSurface === 'glass' || v === 'secondary'
        ? 'control-glass text-text-primary hover:bg-control-hover active:bg-control-pressed'
        : 'text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed'
  } else if (v === 'prominent') {
    look = 'control-glass bg-accent-muted text-accent border-accent/25 hover:bg-accent-hover active:bg-accent-active'
  } else if (v === 'ghost') {
    look = selected
      ? 'bg-accent-muted text-accent hover:bg-accent-hover active:bg-accent-active'
      : 'text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed'
  } else {
    look = FILLED[v]
  }
  const btn = (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-pressed={selected !== undefined ? selected : undefined}
      aria-busy={loading || undefined}
      aria-haspopup={v === 'menu' ? 'menu' : undefined}
      className={cx(
        'no-drag focus-ring inline-flex items-center justify-center flex-shrink-0 font-medium select-none whitespace-nowrap',
        'transition-[background-color,color,filter,transform,box-shadow] duration-base ease-mac cursor-pointer',
        inGroup ? 'rounded-none' : 'rounded-control active:scale-[0.98]',
        'disabled:opacity-40 disabled:pointer-events-none',
        s.box, look, className,
      )}
      {...rest}
    >
      {!iconTrailing && iconEl}
      {children}
      {iconTrailing && iconEl}
      {v === 'menu' && <ChevronDown size={12} strokeWidth={2} className="-mr-0.5 opacity-70" />}
    </button>
  )
  if (!tooltip) return btn
  const t = typeof tooltip === 'string' ? { label: tooltip } : tooltip
  return <Tooltip label={t.label} shortcut={t.shortcut} side={t.side}>{btn}</Tooltip>
})

export default Button
