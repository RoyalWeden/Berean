import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** count — small numeric pill · dot — 6px status dot · live — pulsing accent dot ("on presenter") · text — short uppercase label */
  variant?: 'count' | 'dot' | 'live' | 'text'
  tone?: 'accent' | 'neutral' | 'warning' | 'destructive' | 'success' | 'info'
  children?: ReactNode
  /** Accessible description when the badge carries meaning without text (dot/live). */
  label?: string
}

const TONE_BG: Record<NonNullable<BadgeProps['tone']>, string> = {
  accent: 'bg-badge text-badge-fg',
  neutral: 'bg-surface-4 text-text-secondary',
  warning: 'bg-warning text-white',
  destructive: 'bg-destructive text-white',
  success: 'bg-success text-white',
  info: 'bg-info text-white',
}
const TONE_DOT: Record<NonNullable<BadgeProps['tone']>, string> = {
  accent: 'bg-accent', neutral: 'bg-text-muted', warning: 'bg-warning', destructive: 'bg-destructive', success: 'bg-success', info: 'bg-info',
}

/**
 * Non-interactive status marker (NSItemBadge-style): counts, dots, live indicators and short
 * text labels. Replaces raw `rounded-full` spans and RefChip-used-as-badge. Never clickable;
 * put it inside a Button/IconButton via their `badge` prop or beside a label.
 */
export function Badge({ variant = 'count', tone = 'accent', children, label, className, ...rest }: BadgeProps) {
  if (variant === 'dot' || variant === 'live') {
    return (
      <span
        role="status"
        aria-label={label}
        className={cx('inline-block w-1.5 h-1.5 rounded-control flex-shrink-0', TONE_DOT[tone], variant === 'live' && 'badge-live', className)}
        {...rest}
      />
    )
  }
  return (
    <span
      role="status"
      aria-label={label}
      className={cx(
        'inline-flex items-center justify-center rounded-control leading-none select-none flex-shrink-0 tabular-nums',
        variant === 'count' ? 'min-w-[16px] h-4 px-1 text-micro font-semibold' : 'h-4 px-1.5 text-micro font-semibold uppercase tracking-wide',
        TONE_BG[tone], className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
export default Badge
