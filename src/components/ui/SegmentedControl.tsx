import { useId, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'
import { useBarMetrics } from './metrics'
import { SPRING_SNAPPY } from '@/lib/motion'

export interface SegmentOption<T extends string> {
  value: T
  label?: string
  icon?: LucideIcon
  /** Tooltip / accessible name (required when `label` is omitted). */
  title?: string
  disabled?: boolean
  /** Small trailing count / badge. */
  badge?: string | number
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Stretch segments to fill the container width. */
  fill?: boolean
  /** 'segmented' (default) — capsule track with a sliding thumb (mode switches, filters).
   *  'inspector' — flat tab strip for inspector/panel headers: no track, selected segment gets
   *  a rounded-square fill; same selection logic, typography and keyboard behavior (§33/§48). */
  variant?: 'segmented' | 'inspector'
  /** Accessible group label. */
  'aria-label'?: string
  className?: string
  disabled?: boolean
}

const SIZE = {
  sm: { seg: 'h-[22px] px-2 text-caption2 gap-1', icon: 12 },
  md: { seg: 'h-6 px-2.5 text-footnote gap-1.5', icon: 14 },  // 24px segment in a 28px track = Button sm / Select sm row
  /** Bar size: a 32px segment + the track's 2px padding each side = the 36px track
   *  (CONTROL_H_BAR), so a segmented control
   *  lines up with the IconButtons and grouped pills beside it in the same toolbar. */
  bar: { seg: 'h-8 px-4 text-subhead gap-1.5', icon: 15 },
}

/**
 * The one segment primitive: mutually-exclusive selector with an animated selection thumb
 * (rounded-rectangle track 8px / thumb 7px — Apple's small-control shape; capsules are reserved
 * for search fields and prominent actions). For document tabs use TabStrip.
 * Arrow keys (←/→ or ↑/↓), Home/End move the selection (WAI radiogroup); Tab leaves the group.
 */
export function SegmentedControl<T extends string>({
  value, options, onChange, size = 'sm', fill, variant = 'segmented', className, 'aria-label': ariaLabel, disabled,
}: SegmentedControlProps<T>) {
  const layoutId = useId()
  const bar = useBarMetrics()
  const s = SIZE[bar ? 'bar' : size]
  const inspector = variant === 'inspector'
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    const edge = e.key === 'Home' || e.key === 'End'
    if (!fwd && !back && !edge) return
    const enabled = options.filter((o) => !o.disabled)
    if (!enabled.length) return
    const i = enabled.findIndex((o) => o.value === value)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? enabled.length - 1 : fwd ? (i + 1) % enabled.length : (i - 1 + enabled.length) % enabled.length
    e.preventDefault()
    const v = enabled[next].value
    if (v !== value) onChange(v)
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(v)}"]`)
    btn?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cx(
        'no-drag inline-flex items-stretch flex-shrink-0',
        inspector ? 'gap-0.5' : cx('p-0.5 bg-control shadow-[inset_0_0_0_1px_var(--control-border)]', bar ? 'rounded-control' : 'rounded-card'),
        fill && 'flex w-full', disabled && 'opacity-40 pointer-events-none', className,
      )}
    >
      {options.map(({ value: v, label, icon: Icon, title, disabled: segDisabled, badge }) => {
        const on = v === value
        const btn = (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label ? undefined : title}
            data-value={v}
            tabIndex={on ? 0 : -1}
            disabled={segDisabled}
            onClick={() => !on && onChange(v)}
            className={cx(
              'focus-ring relative inline-flex items-center justify-center font-medium select-none whitespace-nowrap cursor-pointer',
              bar ? 'rounded-control' : 'rounded-control-md',
              'transition-colors duration-base ease-mac disabled:opacity-40 disabled:pointer-events-none',
              s.seg, fill && 'flex-1',
              on ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-lift-1 active:bg-lift-3',
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className={cx('absolute inset-0 bg-control-selected', bar ? 'rounded-control' : 'rounded-control-md', !inspector && 'border border-hairline shadow-1')}
                aria-hidden
              />
            )}
            <span className="relative inline-flex items-center gap-[inherit]">
              {Icon && <Icon size={s.icon} strokeWidth={on ? 2 : 1.75} />}
              {label && <span>{label}</span>}
              {badge !== undefined && <span className="text-meta">{badge}</span>}
            </span>
          </button>
        )
        return title && !label ? <Tooltip key={v} label={title}>{btn}</Tooltip> : btn
      })}
    </div>
  )
}

export default SegmentedControl
