import * as RP from '@radix-ui/react-popover'
import { createContext, forwardRef, useContext, type ComponentPropsWithoutRef } from 'react'
import { cx } from './cx'
import { CompactMetrics } from './metrics'

/**
 * Collision boundary for every popover: the app shell's content area (excluding window chrome),
 * provided by App.tsx. Popovers never open under the toolbar/sidebar/inspector edge; they flip or
 * shift to stay inside the shell, and reposition on resize/scroll.
 */
export const PopoverBoundaryContext = createContext<Element | null>(null)

export interface PopoverSurfaceProps extends ComponentPropsWithoutRef<typeof RP.Content> {
  innerClassName?: string
  /** No backdrop blur — for popovers that open OVER a blurred sheet (blur-over-blur is avoided). */
  opaque?: boolean
  /** Popover contents use compact control metrics (Apple: dense inspectors/popovers). Default true. */
  compact?: boolean
}

/**
 * Pre-styled Radix Popover.Content (portaled, popover material, menu radius). Use with
 * `Popover` / `PopoverTrigger` re-exported below. The entrance animation is on the inner div
 * (origin from Radix's transform-origin var), not Content — see Tooltip.tsx / global.css.
 */
export const PopoverSurface = forwardRef<HTMLDivElement, PopoverSurfaceProps>(
  function PopoverSurface({ className, innerClassName, children, sideOffset = 6, collisionPadding = 8, opaque, compact = true, collisionBoundary, ...rest }, ref) {
    const boundary = useContext(PopoverBoundaryContext)
    return (
      <RP.Portal>
        <RP.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          collisionBoundary={collisionBoundary ?? boundary ?? undefined}
          avoidCollisions
          sticky="always"
          updatePositionStrategy="always"
          className={cx('z-popover outline-none', className)}
          {...rest}
        >
          <CompactMetrics value={compact}>
            <div className={cx('material-popover rounded-menu text-footnote text-text-primary animate-radix-popup-in', opaque && 'popover-opaque', innerClassName)}>
              {children}
            </div>
          </CompactMetrics>
        </RP.Content>
      </RP.Portal>
    )
  },
)

export const Popover = RP.Root
export const PopoverTrigger = RP.Trigger
export const PopoverAnchor = RP.Anchor
export const PopoverClose = RP.Close
export default PopoverSurface
