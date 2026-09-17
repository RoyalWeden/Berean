import * as RP from '@radix-ui/react-popover'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cx } from './cx'

/**
 * Pre-styled Radix Popover.Content (portaled, popover material, menu radius). Use with
 * `Popover.Root` / `Popover.Trigger` re-exported below. The entrance animation is on the
 * inner div, not Content — see Tooltip.tsx / global.css radix-popup-in comment.
 */
export const PopoverSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RP.Content> & { innerClassName?: string }>(
  function PopoverSurface({ className, innerClassName, children, sideOffset = 6, collisionPadding = 8, ...rest }, ref) {
    return (
      <RP.Portal>
        <RP.Content ref={ref} sideOffset={sideOffset} collisionPadding={collisionPadding} className={cx('z-popover outline-none', className)} {...rest}>
          <div className={cx('material-popover rounded-menu text-footnote text-text-primary animate-radix-popup-in', innerClassName)}>
            {children}
          </div>
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
