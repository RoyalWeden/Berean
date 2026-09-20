import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { cx } from './cx'

export type CardButtonSurface = 'elevated' | 'glass' | 'plain'

export interface CardButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Resting surface. 'elevated' (default) — a raised card inside a panel (`bg-surface-elevated`);
   *  'glass' — an interactive-glass control card sitting on a bar/popover; 'plain' — no resting
   *  fill, hover only (dense result lists where a fill per row would stripe the panel). */
  surface?: CardButtonSurface
  /** Leading icon in its own column, vertically top-aligned with the first line of content. */
  icon?: LucideIcon
  /** Trailing ›, for a card that navigates somewhere (macOS disclosure affordance). */
  chevron?: boolean
  /** Keyboard-focused row in a result list (arrow-key driven), distinct from hover. */
  focused?: boolean
  /** Persistent "this is the current item" state. */
  selected?: boolean
  density?: 'comfortable' | 'compact'
  children?: ReactNode
}

const PAD: Record<'comfortable' | 'compact', string> = {
  comfortable: 'px-3 py-2.5 gap-2.5',
  compact: 'px-2.5 py-2 gap-2',
}

/**
 * Action card — a block of rich content that is itself one button (AI-lookup results, search
 * result cards, video cards, suggestion rows). The content layer's push button: `Button` is for
 * labelled actions and `OptionCard` is a radio (a *choice*), so neither fits "this whole card
 * opens something". Replaces the hand-rolled
 * `w-full text-left rounded-card bg-surface-elevated hover:bg-surface-hover …` recipe that had
 * been copied across AiLookup / Scripture search / YouTube.
 *
 * Content-layer, so deliberately NOT glass by default (§16: glass belongs to the functional
 * layer) and it never scales on press — cards are large, and a large surface scaling reads as a
 * web animation rather than a Mac control. Press is a tonal shift only.
 */
export const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(function CardButton(
  { surface = 'elevated', icon: Icon, chevron, focused, selected, density = 'comfortable', className, type = 'button', children, ...rest },
  ref,
) {
  const rest_ = surface === 'elevated' ? 'bg-surface-elevated' : surface === 'glass' ? 'control-glass' : ''
  return (
    <button
      ref={ref}
      type={type}
      aria-current={selected || undefined}
      data-focused={focused || undefined}
      className={cx(
        'focus-ring group/card relative w-full flex items-start text-left rounded-card min-w-0 cursor-pointer select-none',
        'transition-[background-color,box-shadow] duration-base ease-mac',
        PAD[density],
        selected ? 'bg-surface-selected' : focused ? 'bg-surface-selected' : cx(rest_, 'hover:bg-surface-hover active:bg-surface-pressed'),
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={14} strokeWidth={1.75} className="flex-shrink-0 mt-px text-text-muted" />}
      <span className="flex-1 min-w-0">{children}</span>
      {chevron && (
        <ChevronRight
          size={12}
          strokeWidth={2}
          className="flex-shrink-0 mt-0.5 text-text-quaternary transition-colors duration-base group-hover/card:text-text-secondary"
        />
      )}
    </button>
  )
})
export default CardButton
