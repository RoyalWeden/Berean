import type { HTMLAttributes } from 'react'
import { cx } from './cx'

/** Uppercase caption heading for list sections, settings groups, menu groups. */
export function SectionLabel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('text-caption2 font-semibold uppercase tracking-wide text-text-muted select-none', className)} {...rest}>
      {children}
    </div>
  )
}
export default SectionLabel
