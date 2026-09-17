import { useId } from 'react'
import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'
import { SPRING_SNAPPY } from '@/lib/motion'

export interface SegmentOption<T extends string> {
  value: T
  label?: string
  icon?: LucideIcon
  /** Tooltip / accessible name (required when `label` is omitted). */
  title?: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Stretch segments to fill the container width. */
  fill?: boolean
  /** Accessible group label. */
  'aria-label'?: string
  className?: string
}

const SIZE = {
  sm: { seg: 'h-[22px] px-2 text-caption2 gap-1', icon: 11 },
  md: { seg: 'h-[26px] px-2.5 text-caption gap-1.5', icon: 13 },
}

/**
 * Capsule segmented control with a sliding thumb — the one mutually-exclusive selector.
 * Replaces HeaderSegmentedToggle, the right-panel tab strip, the cross-ref source toggle,
 * Notes' view-mode/word-mode pills, Lexicon's sort toggle and ImportModal's underline tabs.
 */
export function SegmentedControl<T extends string>({
  value, options, onChange, size = 'sm', fill, className, 'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const layoutId = useId()
  const s = SIZE[size]
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('no-drag inline-flex items-stretch p-0.5 rounded-control bg-surface-4/45 flex-shrink-0', fill && 'flex w-full', className)}
    >
      {options.map(({ value: v, label, icon: Icon, title, disabled }) => {
        const on = v === value
        const btn = (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label ? undefined : title}
            disabled={disabled}
            onClick={() => !on && onChange(v)}
            className={cx(
              'focus-ring relative inline-flex items-center justify-center rounded-control font-medium select-none whitespace-nowrap cursor-pointer',
              'transition-colors duration-base ease-mac disabled:opacity-40 disabled:pointer-events-none',
              s.seg, fill && 'flex-1',
              on ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className="absolute inset-0 rounded-control bg-surface-1 shadow-1"
                aria-hidden
              />
            )}
            <span className="relative inline-flex items-center gap-[inherit]">
              {Icon && <Icon size={s.icon} strokeWidth={on ? 2 : 1.75} />}
              {label && <span>{label}</span>}
            </span>
          </button>
        )
        return title && !label ? <Tooltip key={v} label={title}>{btn}</Tooltip> : btn
      })}
    </div>
  )
}

export default SegmentedControl
