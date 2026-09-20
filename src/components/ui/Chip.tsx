import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cx } from './cx'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode
  size?: 'sm' | 'md'
  /** Filter chip "on" state — accent-muted fill, NO weight change (avoids width jitter). */
  selected?: boolean
  icon?: LucideIcon
  count?: number | string
  /** Categorical tint as an "r g b" triple (e.g. a tag color or highlight pigment var). */
  tint?: string
  /** Show a remove (×) affordance; fires `onRemove` instead of `onClick`. */
  onRemove?: () => void
  /** Non-interactive badge (renders a span). */
  static?: boolean
  /** filter (default) — rounded-rect toggle in a filter row · token — removable capsule (tags, aliases) · badge — static capsule label. */
  kind?: 'filter' | 'token' | 'badge'
}

const SIZE = { sm: 'h-5 px-2 text-caption2 gap-1', md: 'h-6 px-2.5 text-caption gap-1.5' }

/** Chip: filter toggles (rounded rectangle — Apple's small-control shape), tokens and badges (capsule).
 *  Rest = interactive glass; selected = accent tint. Never a disclosure or a sort toggle. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { children, size = 'sm', selected, icon: Icon, count, tint, onRemove, static: isStatic, kind, className, type = 'button', ...rest }, ref,
) {
  const chipRole = kind ?? (onRemove || tint ? 'token' : isStatic ? 'badge' : 'filter')
  const look = tint
    ? { className: 'border border-transparent', style: { backgroundColor: `rgb(${tint} / ${selected ? 0.28 : 0.14})`, color: `rgb(${tint})` } }
    : selected
      ? { className: 'bg-accent-muted text-accent border border-accent/20 hover:bg-accent-hover active:bg-accent-active', style: undefined }
      : { className: 'control-glass text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed', style: undefined }
  const cls = cx(
    'inline-flex items-center flex-shrink-0 font-medium whitespace-nowrap select-none leading-none',
    chipRole === 'filter' ? 'rounded-control-sm' : 'rounded-control',
    'transition-[background-color,color,box-shadow] duration-base ease-mac',
    SIZE[size], look.className, className,
  )
  const body = (
    <>
      {Icon && <Icon size={size === 'sm' ? 10 : 12} strokeWidth={1.75} />}
      <span>{children}</span>
      {count !== undefined && <span className="opacity-60 tabular-nums">{count}</span>}
      {onRemove && (
        <span role="button" aria-label="Remove" tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onRemove() } }}
          className="-mr-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-control hover:bg-lift-3">
          <X size={8} strokeWidth={2.5} />
        </span>
      )}
    </>
  )
  if (isStatic) return <span className={cls} style={look.style}>{body}</span>
  return (
    <button ref={ref} type={type} aria-pressed={selected !== undefined ? selected : undefined}
      className={cx(cls, 'focus-ring cursor-pointer disabled:opacity-40 disabled:pointer-events-none')} style={look.style} {...rest}>
      {body}
    </button>
  )
})
export default Chip
