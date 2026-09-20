import { forwardRef, type HTMLAttributes } from 'react'
import { cx } from './cx'

export interface ResizeHandleProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'vertical' | 'horizontal'
  /** True while a drag is in progress (keeps the accent tint on). */
  active?: boolean
  /** Reset to the preferred size (double-click), macOS split-view idiom. */
  onReset?: () => void
  label?: string
}

/**
 * The one split/pane resize handle (sidebar, inspector, bottom panels): a 4px hairline strip
 * inside a 14px hit area, accent-tinted on hover/drag, double-click resets. It is a divider, not
 * a grip — no dots, no bar. Keyboard: ←/→ (or ↑/↓) nudge by 16px via `onNudge` when provided.
 */
export const ResizeHandle = forwardRef<HTMLDivElement, ResizeHandleProps & { onNudge?: (delta: number) => void }>(function ResizeHandle(
  { orientation = 'vertical', active, onReset, onNudge, label = 'Resize', className, ...rest }, ref,
) {
  const v = orientation === 'vertical'
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={onNudge ? 0 : -1}
      onDoubleClick={onReset}
      onKeyDown={onNudge ? (e) => {
        const k = e.key
        const d = v ? (k === 'ArrowLeft' ? -16 : k === 'ArrowRight' ? 16 : 0) : (k === 'ArrowUp' ? -16 : k === 'ArrowDown' ? 16 : 0)
        if (d) { e.preventDefault(); onNudge(e.shiftKey ? d * 4 : d) }
      } : undefined}
      className={cx(
        'group/rh relative flex-shrink-0 flex items-center justify-center focus-ring rounded-chip',
        v ? 'w-3.5 h-full cursor-col-resize' : 'h-3.5 w-full cursor-row-resize',
        className,
      )}
      {...rest}
    >
      <div className={cx('transition-colors duration-fast', v ? 'w-1 h-full' : 'h-1 w-full', active ? 'bg-accent/40' : 'bg-transparent group-hover/rh:bg-accent/40')} />
    </div>
  )
})
export default ResizeHandle
