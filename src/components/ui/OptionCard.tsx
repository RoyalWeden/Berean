import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

export interface OptionCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  /** Custom visual (layout preview, swatch) shown above the title. */
  preview?: ReactNode
  selected?: boolean
}

/** Selectable card (settings layouts, onboarding choices). Radio semantics; card is the control. */
export const OptionCard = forwardRef<HTMLButtonElement, OptionCardProps>(function OptionCard(
  { title, description, icon: Icon, preview, selected, className, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      role="radio"
      aria-checked={!!selected}
      className={cx(
        'focus-ring flex flex-col items-start gap-1.5 text-left rounded-card p-3 min-w-0 cursor-pointer select-none',
        'transition-[background-color,box-shadow,border-color] duration-base ease-mac',
        selected ? 'bg-accent-muted border border-accent/40 shadow-[0_0_0_1px_var(--color-focus-ring)]' : 'control-glass hover:bg-control-hover active:bg-control-pressed',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {preview}
      <span className="flex items-center gap-2 w-full min-w-0">
        {Icon && <Icon size={14} strokeWidth={1.75} className={selected ? 'text-accent' : 'text-text-muted'} />}
        <span className={cx('text-footnote font-medium truncate', selected ? 'text-accent' : 'text-text-primary')}>{title}</span>
      </span>
      {description && <span className="text-caption2 text-text-muted leading-snug">{description}</span>}
    </button>
  )
})
export default OptionCard
