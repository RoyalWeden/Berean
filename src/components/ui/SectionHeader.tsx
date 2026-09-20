import type { ReactNode } from 'react'
import { cx } from './cx'
import { SectionLabel } from './SectionLabel'

/** Section heading row for lists: uppercase caption label + optional count + trailing action slot. */
export function SectionHeader({ children, count, trailing, className, flush }: { children: ReactNode; count?: number | string; trailing?: ReactNode; className?: string; flush?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2 min-w-0', flush ? 'pb-1' : 'px-2 pt-3 pb-1', className)}>
      <SectionLabel className="flex-1 min-w-0 truncate">{children}{count !== undefined && <span className="ml-1.5 normal-case tracking-normal opacity-70 tabular-nums">{count}</span>}</SectionLabel>
      {trailing && <div className="flex items-center gap-0.5 flex-shrink-0">{trailing}</div>}
    </div>
  )
}
export default SectionHeader
