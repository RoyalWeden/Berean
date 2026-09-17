import { createElement, forwardRef, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { cx } from './cx'

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onClick' | 'onDoubleClick'> {
  /** Leading slot (icon, color dot, chevron, checkbox). */
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Right-aligned secondary text (time, count). */
  meta?: ReactNode
  /** Trailing actions — rendered as SIBLINGS of the row button (never nested), revealed on
   *  hover or keyboard focus-within so they stay reachable. */
  trailing?: ReactNode
  /** Always show trailing actions (don't hide until hover). */
  trailingAlways?: boolean
  /** Neutral current-row state (sidebar tabs, list selection). */
  selected?: boolean
  /** Accent-tinted current state (navigation "you are here"). */
  current?: boolean
  /** Accent bar on the left edge in addition to the fill. */
  bar?: boolean
  /** 28px rows (sidebars, trees) vs 36px (lists with subtitle). */
  dense?: boolean
  /** Indent in px (tree depth). */
  indent?: number
  disabled?: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  onDoubleClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Rendered as a link. */
  href?: string
  /** Extra classes for the inner button. */
  buttonClassName?: string
  titleClassName?: string
  /** aria-current / role overrides for the inner control. */
  buttonProps?: Record<string, unknown>
}

/**
 * The one list/tree/sidebar row. Structure: leading · title (+subtitle) · meta · trailing.
 * The clickable area is a real <button> (keyboard reachable, focus ring); trailing actions are
 * siblings so there are never nested interactive elements. Root <div> carries drag/context-menu
 * handlers passed via ...rest.
 */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { leading, title, subtitle, meta, trailing, trailingAlways, selected, current, bar, dense, indent, disabled, onClick, onDoubleClick, href, className, buttonClassName, titleClassName, buttonProps, ...rest }, ref,
) {
  return (
    <div
      ref={ref}
      className={cx(
        'group/row relative flex items-stretch rounded-row min-w-0 select-none',
        'transition-colors duration-fast',
        current ? 'bg-accent-muted' : selected ? 'bg-surface-selected' : 'hover:bg-lift-2',
        'has-[button:active]:bg-lift-3',
        disabled && 'opacity-40 pointer-events-none',
        className,
      )}
      {...rest}
    >
      {bar && (selected || current) && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-control bg-accent" />}
      {createElement(
        href ? 'a' : 'button',
        {
          type: href ? undefined : 'button',
          href,
          onClick,
          onDoubleClick,
          'aria-selected': selected || undefined,
          'aria-current': current ? 'true' : undefined,
          className: cx(
            'focus-ring flex-1 min-w-0 flex items-center gap-2 text-left rounded-row cursor-pointer outline-none',
            dense ? 'h-7 px-2' : 'min-h-9 px-2.5 py-1.5',
            current ? 'text-accent' : 'text-text-primary',
            buttonClassName,
          ),
          style: indent ? { paddingLeft: indent } : undefined,
          ...buttonProps,
        },
        leading && <span key="l" className="flex-shrink-0 inline-flex items-center justify-center text-text-muted">{leading}</span>,
        <span key="t" className="flex-1 min-w-0">
          <span className={cx('block truncate', dense ? 'text-footnote' : 'text-subhead', (selected || current) ? 'font-medium' : 'font-normal', titleClassName)}>{title}</span>
          {subtitle && <span className="block truncate text-caption2 text-text-muted mt-px">{subtitle}</span>}
        </span>,
        meta && <span key="m" className="flex-shrink-0 text-caption2 text-text-muted tabular-nums">{meta}</span>,
      )}
      {trailing && (
        <div className={cx('flex items-center gap-0.5 pr-1 flex-shrink-0', !trailingAlways && 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity duration-fast')}>
          {trailing}
        </div>
      )}
    </div>
  )
})
export default ListRow
