import { forwardRef, type HTMLAttributes } from 'react'
import { cx } from './cx'

export interface ScrollContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Also scroll horizontally (compare grids). */
  horizontal?: boolean
  /** Let overscroll chain to the parent (the main chapter root may rubber-band; nested lists must not). */
  chain?: boolean
}

/**
 * The one scroll root: overlay auto-hide scrollbar (global recipe), native momentum, contained
 * overscroll, and `data-scroll-root` so `useScrollEdge`/`Toolbar edge="auto"` can find it.
 * Keyboard scrolling (Space/⇧Space/Page keys/Home/End) stays native — never bound by a primitive.
 */
export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(function ScrollContainer(
  { horizontal, chain, className, children, ...rest }, ref,
) {
  return (
    <div
      ref={ref}
      data-scroll-root=""
      className={cx('min-h-0 overflow-y-auto', horizontal ? 'overflow-x-auto' : 'overflow-x-hidden', !chain && 'overscroll-contain', className)}
      {...rest}
    >
      {children}
    </div>
  )
})
export default ScrollContainer
