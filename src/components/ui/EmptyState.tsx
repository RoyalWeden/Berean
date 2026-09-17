import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'

/** Quiet, centered empty/idle state: icon, one-line title, optional hint and action. */
export function EmptyState({
  icon: Icon, title, hint, action, compact, className,
}: { icon?: LucideIcon; title: ReactNode; hint?: ReactNode; action?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center select-none', compact ? 'gap-1 px-4 py-6' : 'gap-1.5 px-6 py-10', className)}>
      {Icon && <Icon size={compact ? 20 : 28} strokeWidth={1.5} className="text-text-muted opacity-60 mb-1" />}
      <div className={cx('text-text-secondary', compact ? 'text-footnote' : 'text-subhead')}>{title}</div>
      {hint && <div className="text-caption text-text-muted max-w-[280px] leading-relaxed">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
export default EmptyState
