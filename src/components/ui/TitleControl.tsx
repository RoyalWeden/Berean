import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from './cx'
import { ControlGroup } from './ControlGroup'
import { IconButton } from './IconButton'
import { Tooltip } from './Tooltip'

export interface TitleControlProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** The title text (book + chapter, note name, entry id…). */
  title: ReactNode
  /** Small trailing chip / secondary text inside the trigger (translation, count). */
  detail?: ReactNode
  /** Leading icon slot. */
  leading?: ReactNode
  onPrev?: () => void
  onNext?: () => void
  prevLabel?: string
  nextLabel?: string
  prevDisabled?: boolean
  nextDisabled?: boolean
  /** Show the ▾ (the trigger opens a picker). */
  menu?: boolean
  tooltip?: string
  open?: boolean
  className?: string
  triggerClassName?: string
}

/**
 * Toolbar title control (§20): ‹ [Isaiah 44 · LXX ▾] › as ONE grouped control in the toolbar's
 * context zone. The middle is the picker trigger (popover anchors to it); the chevrons are
 * prev/next. Everything reads from the ControlGroup context so it renders as one Mac control.
 */
export const TitleControl = forwardRef<HTMLButtonElement, TitleControlProps>(function TitleControl(
  { title, detail, leading, onPrev, onNext, prevLabel = 'Previous', nextLabel = 'Next', prevDisabled, nextDisabled, menu = true, tooltip, open, className, triggerClassName, ...rest }, ref,
) {
  const trigger = (
    <button
      ref={ref}
      type="button"
      aria-haspopup={menu ? 'dialog' : undefined}
      aria-expanded={menu ? open : undefined}
      className={cx(
        'focus-ring no-drag h-7 min-w-0 px-2.5 inline-flex items-center gap-1.5 text-subhead font-semibold text-text-primary select-none whitespace-nowrap cursor-pointer',
        'transition-colors duration-base ease-mac hover:bg-control-hover active:bg-control-pressed',
        open && 'bg-control-pressed',
        triggerClassName,
      )}
      {...rest}
    >
      {leading}
      <span className="truncate">{title}</span>
      {detail}
      {menu && <ChevronDown size={12} strokeWidth={2} className="text-text-muted -mr-0.5 flex-shrink-0" />}
    </button>
  )
  return (
    <ControlGroup className={cx('max-w-full', className)} align="stretch">
      {onPrev && <IconButton icon={ChevronLeft} label={prevLabel} size={28} onClick={onPrev} disabled={prevDisabled} className="self-center" />}
      {tooltip ? <Tooltip label={tooltip}>{trigger}</Tooltip> : trigger}
      {onNext && <IconButton icon={ChevronRight} label={nextLabel} size={28} onClick={onNext} disabled={nextDisabled} className="self-center" />}
    </ControlGroup>
  )
})
export default TitleControl
