import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'
import { Badge, type BadgeProps } from './Badge'
import { useControlSurface, useInControlGroup, type ControlSurface } from './surface'
import { resolveSize, useCompactMetrics, type ControlSize } from './metrics'

/**
 * primary     — accent fill, capsule (the one default action on a surface; Apple: default button)
 * prominent   — tinted glass (accent-muted + hairline), capsule: the important toolbar action
 * secondary   — interactive glass, visible at rest on any bar (rounded rectangle)
 * ghost       — text until hovered (rounded rectangle)
 * menu        — secondary/ghost with a trailing ▾ (dropdown trigger)
 * link        — borderless accent text, underline on hover: a quiet navigational action that
 *               leads somewhere else ("Advanced scripture search", a cross-ref that opens a tab).
 *               macOS's borderless accent button; no fill, no bezel, no press scale (scaling a
 *               run of text reads as a web animation). Replaces hand-rolled
 *               `text-accent group-hover:underline` spans and `!text-accent` overrides.
 * destructive / success / warning — filled status buttons
 *
 * Shape follows Apple's rule: xs/sm/md are rounded rectangles; lg, primary and prominent are
 * capsules. `shape` overrides for concentric nesting.
 */
export type ButtonVariant = 'primary' | 'prominent' | 'secondary' | 'ghost' | 'link' | 'menu' | 'destructive' | 'success' | 'warning'
export type ButtonSize = ControlSize
export type ButtonTint = 'none' | 'secondary' | 'primary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Defaults to 'secondary' (glass) inside a Toolbar, else 'ghost'. */
  variant?: ButtonVariant
  /** Apple tint prominence — an alias: none=ghost, secondary=prominent, primary=primary. */
  tint?: ButtonTint
  /** xs 24 (compact contexts) · sm 28 (toolbar default) · md 32 · lg 36 (capsule). */
  size?: ButtonSize
  shape?: 'rect' | 'capsule'
  icon?: LucideIcon
  iconTrailing?: boolean
  loading?: boolean
  /** Toggled-on state for ghost/secondary buttons (e.g. "LXX", "Strong's"). */
  selected?: boolean
  /** Force the resting surface for a ghost button. */
  surface?: ControlSurface
  /** Quiet text button whose hover turns destructive ("Clear all…", "Remove"). ghost/secondary only. */
  danger?: boolean
  /** Tooltip text (+ optional shortcut) — replaces `title=` on interactive controls. */
  tooltip?: string | { label: string; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right' }
  /** Status marker at the top-right corner (live presenter, pending count). */
  badge?: ReactNode | { variant?: BadgeProps['variant']; tone?: BadgeProps['tone']; label?: string; children?: ReactNode }
  children?: ReactNode
}

const FILLED: Record<'primary' | 'destructive' | 'success' | 'warning', string> = {
  primary: 'bg-accent text-white shadow-control hover:bg-accent-raised active:bg-accent-pressed',
  destructive: 'bg-destructive text-white shadow-control hover:brightness-110 active:brightness-90',
  success: 'bg-success text-white shadow-control hover:brightness-110 active:brightness-90',
  warning: 'bg-warning text-white shadow-control hover:brightness-110 active:brightness-90',
}
/** `link` has no control box: it is a run of text, so it takes the size's type scale and gap but
 *  no height or horizontal inset (explicit strings, not a regex over SIZE — Tailwind only
 *  generates classes it can see literally in the source). */
const LINK_BOX: Record<ButtonSize, string> = {
  xs: 'h-auto px-0 text-caption gap-1',
  sm: 'h-auto px-0 text-footnote gap-1.5',
  md: 'h-auto px-0 text-subhead gap-2',
  lg: 'h-auto px-0 text-subhead gap-2',
}
const SIZE: Record<ButtonSize, { box: string; icon: number; radius: string }> = {
  xs: { box: 'h-6 px-2 text-caption gap-1', icon: 12, radius: 'rounded-control-sm' },
  sm: { box: 'h-7 px-2.5 text-footnote gap-1.5', icon: 14, radius: 'rounded-control-md' },
  md: { box: 'h-8 px-3.5 text-subhead gap-2', icon: 14, radius: 'rounded-control-md' },
  lg: { box: 'h-9 px-4 text-subhead gap-2', icon: 16, radius: 'rounded-control' },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, tint, size = 'sm', shape, icon: Icon, iconTrailing, loading, selected, surface, tooltip, danger, badge, className, type = 'button', children, disabled, ...rest },
  ref,
) {
  const compact = useCompactMetrics()
  const s = SIZE[resolveSize(size, compact)]
  const ctxSurface = useControlSurface(surface)
  const inGroup = useInControlGroup()
  const v: ButtonVariant = variant ?? (tint === 'primary' ? 'primary' : tint === 'secondary' ? 'prominent' : ctxSurface === 'glass' ? 'secondary' : 'ghost')
  const capsule = shape ? shape === 'capsule' : (v === 'primary' || v === 'prominent' || size === 'lg')
  const isLink = v === 'link'
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
  } else if (isLink) {
    look = danger
      ? 'text-destructive hover:underline decoration-1 underline-offset-2 active:opacity-70'
      : 'text-accent hover:underline decoration-1 underline-offset-2 active:opacity-70'
  } else if (v === 'ghost' && danger) {
    look = 'text-text-muted hover:text-destructive hover:bg-destructive/12 active:bg-destructive/20'
  } else if (v === 'ghost') {
    look = selected
      ? 'bg-accent-muted text-accent hover:bg-accent-hover active:bg-accent-active'
      : 'text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed'
  } else {
    look = FILLED[v]
  }
  const badgeEl = badge == null ? null
    : (typeof badge === 'object' && !('type' in (badge as object)) && !('$$typeof' in (badge as object)))
      ? <Badge {...(badge as Exclude<ButtonProps['badge'], ReactNode>)} className="absolute -top-1 -right-1" />
      : <span className="absolute -top-1 -right-1">{badge as ReactNode}</span>
  const btn = (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-pressed={selected !== undefined ? selected : undefined}
      aria-busy={loading || undefined}
      aria-haspopup={v === 'menu' ? 'menu' : undefined}
      className={cx(
        'no-drag focus-ring relative inline-flex items-center justify-center flex-shrink-0 font-medium select-none whitespace-nowrap',
        'transition-[background-color,color,filter,transform,box-shadow] duration-base ease-mac cursor-pointer',
        inGroup ? 'rounded-none' : isLink ? 'rounded-control-sm' : cx(capsule ? 'rounded-control' : s.radius, 'active:scale-[0.98]'),
        'disabled:opacity-40 disabled:pointer-events-none',
        isLink ? LINK_BOX[resolveSize(size, compact)] : s.box,
        look, className,
      )}
      {...rest}
    >
      {!iconTrailing && iconEl}
      {children}
      {iconTrailing && iconEl}
      {v === 'menu' && <ChevronDown size={12} strokeWidth={2} className="-mr-0.5 opacity-70" />}
      {badgeEl}
    </button>
  )
  if (!tooltip) return btn
  const t = typeof tooltip === 'string' ? { label: tooltip } : tooltip
  return <Tooltip label={t.label} shortcut={t.shortcut} side={t.side}>{btn}</Tooltip>
})

export default Button
