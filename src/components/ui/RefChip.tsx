import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'
import { cx } from './cx'

export type RefChipVariant = 'default' | 'lxx' | 'lexicon' | 'neutral'

const VARIANT: Record<RefChipVariant, string> = {
  default: 'text-accent bg-accent-muted',
  lxx: 'text-[rgb(var(--link-lxx-ref))] bg-[rgb(var(--link-lxx-ref)/0.14)]',
  lexicon: 'text-[rgb(var(--link-lexicon-ref))] bg-[rgb(var(--link-lexicon-ref)/0.14)]',
  neutral: 'text-text-secondary bg-surface-4/60',
}
const SIZE = { xs: 'text-micro px-1 py-px', sm: 'text-caption2 px-1.5 py-0.5' }

type Base = {
  variant?: RefChipVariant
  size?: 'xs' | 'sm'
  className?: string
  /** Set false where the chip sits beside its own verse text and both must read as one
   *  paragraph (occurrence lists, cross-ref cards) — the system font, not monospace. Small
   *  standalone tag chips (sidebar badges, note verse tags) keep the default monospace look. */
  mono?: boolean
}

/** Reference chip ("Gen 1:1", "H7225") — monospace by default (a scannable tag look); pass
 *  `mono={false}` when it needs to read as ordinary text alongside adjacent prose. Renders a
 *  <button> when `onClick` is given. */
export const RefChip = forwardRef<HTMLElement, Base & (ButtonHTMLAttributes<HTMLButtonElement> | HTMLAttributes<HTMLSpanElement>)>(
  function RefChip({ variant = 'default', size = 'sm', mono = true, className, ...rest }, ref) {
    const cls = cx(
      'inline-flex items-center font-semibold rounded-chip leading-none whitespace-nowrap tabular-nums',
      mono ? 'font-mono' : 'font-sans',
      SIZE[size], VARIANT[variant], className,
    )
    if ('onClick' in rest && rest.onClick) {
      return <button ref={ref as React.Ref<HTMLButtonElement>} type="button" className={cx(cls, 'focus-ring cursor-pointer transition-[filter] duration-fast hover:brightness-115 active:brightness-90 disabled:opacity-40 disabled:pointer-events-none')} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} />
    }
    return <span ref={ref as React.Ref<HTMLSpanElement>} className={cls} {...(rest as HTMLAttributes<HTMLSpanElement>)} />
  },
)
export default RefChip
