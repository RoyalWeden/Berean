import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'
import { cx } from './cx'

export type RefChipVariant = 'default' | 'lxx' | 'lexicon' | 'neutral'

const VARIANT: Record<RefChipVariant, string> = {
  default: 'text-accent bg-accent-muted',
  lxx: 'text-[rgb(var(--link-lxx-ref))] bg-[rgb(var(--link-lxx-ref)/0.14)]',
  lexicon: 'text-[rgb(var(--link-lexicon-ref))] bg-[rgb(var(--link-lexicon-ref)/0.14)]',
  neutral: 'text-text-secondary bg-surface-4/60',
}
const SIZE = {
  xs: 'text-micro px-1 py-px',
  sm: 'text-caption2 px-1.5 py-0.5',
  /** Matches the app's --text-footnote body size — use beside prose set in text-footnote
   *  (occurrence rows, cross-ref cards, search result snippets) so the ref reads as the same
   *  size as the text it's labeling, not a smaller decoration. */
  md: 'text-footnote px-1.5 py-0.5',
  /** Matches --text-subhead — use beside prose set in text-subhead (e.g. Advanced Search's
   *  main result rows). */
  lg: 'text-subhead px-2 py-0.5',
}

const TEXT_SIZE = { xs: 'text-micro', sm: 'text-caption2', md: 'text-footnote', lg: 'text-subhead' } as const
const TEXT_VARIANT: Record<RefChipVariant, string> = {
  default: 'text-accent',
  lxx: 'text-[rgb(var(--link-lxx-ref))]',
  lexicon: 'text-[rgb(var(--link-lexicon-ref))]',
  neutral: 'text-text-secondary',
}

type Base = {
  variant?: RefChipVariant
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  /** Set false where the chip sits beside its own verse text and both must read as one
   *  paragraph (occurrence lists, cross-ref cards) — the system font, not monospace. Small
   *  standalone tag chips (sidebar badges, note verse tags) keep the default monospace look. */
  mono?: boolean
  /** 'chip' (default) — a tinted capsule, for inline tokens set inside running text (Strong's
   *  codes, verse tags). 'text' — semibold accent text with no background, for a reference that
   *  heads a list row (inspector notes / cross references): interactive without a web badge. */
  appearance?: 'chip' | 'text'
}

/** Reference chip ("Gen 1:1", "H7225") — monospace by default (a scannable tag look); pass
 *  `mono={false}` when it needs to read as ordinary text alongside adjacent prose. Renders a
 *  <button> when `onClick` is given. */
export const RefChip = forwardRef<HTMLElement, Base & (ButtonHTMLAttributes<HTMLButtonElement> | HTMLAttributes<HTMLSpanElement>)>(
  function RefChip({ variant = 'default', size = 'sm', mono = true, appearance = 'chip', className, ...rest }, ref) {
    const text = appearance === 'text'
    const cls = cx(
      'inline-flex items-center font-semibold leading-none whitespace-nowrap tabular-nums',
      text ? 'rounded-sm' : 'rounded-chip',
      mono ? 'font-mono' : 'font-sans',
      text ? TEXT_SIZE[size] : SIZE[size],
      text ? TEXT_VARIANT[variant] : VARIANT[variant],
      className,
    )
    if ('onClick' in rest && rest.onClick) {
      return <button ref={ref as React.Ref<HTMLButtonElement>} type="button" className={cx(cls, 'focus-ring cursor-pointer transition-[filter] duration-fast disabled:opacity-40 disabled:pointer-events-none', text ? 'hover:underline underline-offset-2' : 'hover:brightness-115 active:brightness-90')} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} />
    }
    return <span ref={ref as React.Ref<HTMLSpanElement>} className={cls} {...(rest as HTMLAttributes<HTMLSpanElement>)} />
  },
)
export default RefChip
