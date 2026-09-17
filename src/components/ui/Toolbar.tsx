import { forwardRef, type HTMLAttributes } from 'react'
import { cx } from './cx'
import { ControlSurfaceContext } from './surface'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** 'sm' 36px (list headers, sub-toolbars) · 'md' 44px (window toolbar, panel headers). */
  size?: 'sm' | 'md'
  /** Hairline on the bottom (default) or top edge, or none. */
  edge?: 'bottom' | 'top' | 'none'
  /** Stick to the top of a scroll container. */
  sticky?: boolean
  /** Use the sidebar (denser) material instead of the bar material. */
  material?: 'bar' | 'sidebar' | 'none'
}

/**
 * M1 integrated bar. Every control inside defaults to the 'glass' resting surface (visible
 * capsules), matching macOS 26/27 toolbars. Use for the window toolbar, panel headers, list
 * headers, filter rows and sub-toolbars — anywhere a row of controls sits above content.
 */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { size = 'sm', edge = 'bottom', sticky, material = 'bar', className, children, ...rest }, ref,
) {
  return (
    <ControlSurfaceContext.Provider value="glass">
      <div
        ref={ref}
        className={cx(
          'flex items-center gap-1.5 flex-shrink-0 min-w-0 px-2',
          size === 'md' ? 'h-11' : 'h-9',
          material === 'bar' && 'material-bar', material === 'sidebar' && 'material-sidebar',
          edge === 'bottom' && 'border-b border-separator', edge === 'top' && 'border-t border-separator',
          sticky && 'sticky top-0 z-raised',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </ControlSurfaceContext.Provider>
  )
})
export default Toolbar
