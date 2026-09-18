import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Sheet } from './Sheet'
import { Button } from './Button'
import { cx } from './cx'

export interface AlertSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Body copy (one or two sentences). */
  message?: ReactNode
  icon?: LucideIcon
  /** Default (Enter) action label, e.g. "Delete". */
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive default action → red button, and Enter still triggers it (NSAlert convention
   *  is that the default button is the safe one, so pass `destructive` + `defaultIsCancel`
   *  when Return should cancel instead). */
  destructive?: boolean
  defaultIsCancel?: boolean
  onConfirm: () => void
  onCancel?: () => void
  /** Extra controls between message and buttons (e.g. a "don't ask again" checkbox). */
  children?: ReactNode
  loading?: boolean
}

/**
 * The one confirm dialog (§58): small centred sheet, icon + title + message, Cancel · Confirm,
 * Esc cancels, Enter runs the default action. Replaces every hand-rolled confirm modal.
 */
export function AlertSheet({ open, onOpenChange, title, message, icon: Icon = AlertTriangle, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive, defaultIsCancel, onConfirm, onCancel, children, loading }: AlertSheetProps) {
  const cancel = () => { onCancel?.(); onOpenChange(false) }
  const confirm = () => { onConfirm() }
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) cancel(); else onOpenChange(o) }} size="alert" hideClose critical onDefaultAction={defaultIsCancel ? cancel : confirm} bodyClassName="px-5 pt-5 pb-4">
      <div className="flex flex-col items-center text-center gap-2">
        <span className={cx('inline-flex items-center justify-center w-10 h-10 rounded-full', destructive ? 'bg-destructive/12 text-destructive' : 'bg-accent-muted text-accent')}>
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="text-subhead font-semibold text-text-primary">{title}</div>
        {message && <div className="text-footnote text-text-secondary leading-relaxed">{message}</div>}
        {children}
      </div>
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button variant="secondary" size="md" onClick={cancel} autoFocus={defaultIsCancel}>{cancelLabel}</Button>
        <Button variant={destructive ? 'destructive' : 'primary'} size="md" onClick={confirm} loading={loading} autoFocus={!defaultIsCancel}>{confirmLabel}</Button>
      </div>
    </Sheet>
  )
}
export default AlertSheet
