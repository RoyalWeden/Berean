import { forwardRef, type HTMLAttributes } from 'react'
import { cx } from './cx'
import { ControlGroupContext, ControlShapeContext, ControlSurfaceContext, useControlSurface, type ControlSurface } from './surface'

export interface ControlGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Resting material of the group container. Defaults to the surrounding Toolbar's surface
   *  ('glass' in bars → one visible glass container; 'ghost' → invisible until hovered). */
  variant?: ControlSurface
  /** Hairline dividers between children (default true). */
  dividers?: boolean
  /** 'capsule' (default) — the macOS 26/27 grouped-toolbar shape: a cluster of items reads as
   *  ONE pill with hairline dividers. 'row' — a 10px rounded rectangle, for a group that sits in
   *  a list/row context rather than a bar. */
  radius?: 'capsule' | 'row'
  align?: 'center' | 'stretch'
}

/**
 * A group of independent controls sharing ONE container (macOS grouped toolbar items:
 * back/forward, ‹ Isaiah 44 ›, LXX | Strong's). The container carries the interactive-glass
 * material; children (IconButton / Button / any ui primitive) read `useInControlGroup()` and
 * render flat inside it. For mutually-exclusive selection use SegmentedControl instead.
 */
export const ControlGroup = forwardRef<HTMLDivElement, ControlGroupProps>(function ControlGroup(
  { variant, dividers = true, radius = 'capsule', align = 'center', className, children, ...rest }, ref,
) {
  const surface = useControlSurface(variant)
  return (
    <ControlGroupContext.Provider value={true}>
      <ControlShapeContext.Provider value="square">
        <ControlSurfaceContext.Provider value={surface}>
          <div
            ref={ref}
            role="group"
            className={cx(
              'control-group no-drag inline-flex flex-shrink-0 overflow-hidden isolate',
              align === 'stretch' ? 'items-stretch' : 'items-center',
              radius === 'capsule' ? 'rounded-control' : 'rounded-row',
              surface === 'glass' ? 'control-glass-inset' : 'bg-transparent hover:bg-lift-1 transition-colors duration-base',
              dividers && '[&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-separator-subtle',
              className,
            )}
            {...rest}
          >
            {children}
          </div>
        </ControlSurfaceContext.Provider>
      </ControlShapeContext.Provider>
    </ControlGroupContext.Provider>
  )
})
export default ControlGroup
