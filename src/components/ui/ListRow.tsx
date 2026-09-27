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
  /** Extra classes for the subtitle line (default text-caption2 text-text-muted). */
  subtitleClassName?: string
  /** Wrap the title to 2 or 3 lines (line-clamp) instead of the default single-line truncate —
   *  for rows whose "title" is really a quoted passage that needs room to be read, not a name
   *  to be scanned (verse/note preview hover cards). */
  titleClamp?: 2 | 3 | 'none'
  /** aria-current / role overrides for the inner control. */
  /** Interactive content that sits BEFORE the row button as its own hit target — a disclosure
   *  triangle, a selection checkbox. It must not go in `leading`: that renders inside the row's
   *  own `<button>`, and a button or an input nested in a button is invalid HTML (React warns
   *  "validateDOMNesting: <button> cannot appear as a descendant of <button>") and swallows the
   *  inner control's semantics. Symmetric with `trailing`, which already renders outside. This
   *  is also how macOS outline views behave — the disclosure triangle is a separate hit target
   *  beside the row, not part of it. */
  /** 'row' (default) 10px · 'capsule' for a row that is really a field-shaped control (the
   *  sidebar's search/location bar). A `rounded-*` in `buttonClassName` cannot express this:
   *  `cx()` is not tailwind-merge, so it would collide with the row's own radius rather than
   *  win. */
  radius?: 'row' | 'capsule'
  leadingAction?: ReactNode
  buttonProps?: Record<string, unknown>
  /** Title type role. Defaults to footnote (dense) / subhead — set explicitly instead of
   *  fighting the default with `!text-*` in titleClassName. */
  titleSize?: 'caption' | 'footnote' | 'subhead' | 'body'
  /** Edge-to-edge list rows (sidebar tab list, inspector lists): no radius, no inset — the
   *  selection fill runs to the container edges like a Mac source list. */
  flush?: boolean
  /** Inset source-list row (sidebar tabs): 7px radius (`rounded-control-md`) like macOS 26/27 sidebars. */
  inset?: boolean
}

/**
 * The one list/tree/sidebar row. Structure: leading · title (+subtitle) · meta · trailing.
 * The clickable area is a real <button> (keyboard reachable, focus ring); trailing actions are
 * siblings so there are never nested interactive elements. Root <div> carries drag/context-menu
 * handlers passed via ...rest.
 */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { leading, leadingAction, radius, title, subtitle, meta, trailing, trailingAlways, selected, current, bar, dense, indent, disabled, onClick, onDoubleClick, href, className, buttonClassName, titleClassName, subtitleClassName, titleClamp, buttonProps, titleSize, flush, inset, ...rest }, ref,
) {
  const size = titleSize ?? (dense ? 'footnote' : 'subhead')
  return (
    <div
      ref={ref}
      className={cx(
        'group/row relative flex items-stretch min-w-0 select-none',
        radius === 'capsule' ? 'rounded-control' : flush ? 'rounded-none' : inset ? 'rounded-control-md' : 'rounded-row',
        'transition-colors duration-fast',
        current ? 'bg-accent-muted' : selected ? 'bg-surface-selected' : 'hover:bg-lift-2',
        'has-[button:active]:bg-lift-3',
        disabled && 'opacity-40 pointer-events-none',
        className,
      )}
      {...rest}
    >
      {bar && (selected || current) && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-control bg-accent" />}
      {leadingAction && (
        <div className={cx('flex items-center gap-0.5 flex-shrink-0', flush ? 'pl-3' : dense ? 'pl-2' : 'pl-2.5')}>
          {leadingAction}
        </div>
      )}
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
            'focus-ring flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer outline-none',
            radius === 'capsule' ? 'rounded-control' : flush ? 'rounded-none' : inset ? 'rounded-control-md' : 'rounded-row',
            dense ? 'h-7' : 'min-h-9 py-1.5',
            flush ? 'px-3' : dense ? 'px-2' : 'px-2.5',
            leadingAction && 'pl-1.5',
            current ? 'text-accent' : 'text-text-primary',
            buttonClassName,
          ),
          style: indent ? { paddingLeft: indent } : undefined,
          ...buttonProps,
        },
        leading && <span key="l" className="flex-shrink-0 inline-flex items-center justify-center text-text-muted">{leading}</span>,
        <span key="t" className="flex-1 min-w-0">
          <span className={cx(
            'block',
            titleClamp === 3 ? 'line-clamp-3 whitespace-normal' : titleClamp === 2 ? 'line-clamp-2 whitespace-normal' : titleClamp === 'none' ? 'whitespace-normal' : 'truncate',
            size === 'caption' ? 'text-caption' : size === 'footnote' ? 'text-footnote' : size === 'body' ? 'text-body' : 'text-subhead',
            (selected || current) ? 'font-medium' : 'font-normal', titleClassName,
          )}>{title}</span>
          {subtitle && <span className={cx('block truncate text-caption2 text-text-muted mt-px', subtitleClassName)}>{subtitle}</span>}
        </span>,
        meta && <span key="m" className="flex-shrink-0 text-meta">{meta}</span>,
      )}
      {/* Hover-revealed trailing actions take REAL space in the row (SEP26-NOTES-MAC-001): they
          grow from zero width on hover / focus-within, so the title (the flexible element)
          truncates and the meta (e.g. a note count) stays visible beside them — never
          underneath. They used to be overlaid on the row's right edge with a fixed 32 px of
          reserved padding, so a row with three actions covered its count. */}
      {trailing && (
        <div className={cx(
          'flex items-center gap-0.5 flex-shrink-0',
          trailingAlways
            ? 'pr-1'
            : 'max-w-0 overflow-hidden opacity-0 pointer-events-none group-hover/row:max-w-[60%] group-hover/row:pr-1 group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:max-w-[60%] group-focus-within/row:pr-1 group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto transition-[max-width,opacity] duration-fast',
        )}>
          {trailing}
        </div>
      )}
    </div>
  )
})
export default ListRow
