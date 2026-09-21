import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes, type RefObject } from 'react'
import { cx } from './cx'
import { ControlSurfaceContext, type ControlSurface } from './surface'
import { BarMetrics } from './metrics'
import { useScrollEdge } from '@/lib/useScrollEdge'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** 'sm' 40px (list headers, sub-toolbars) · 'md' 44px (window toolbar, panel headers).
   *  Both hold the one 34px bar control (CONTROL_H_BAR) with even margins. */
  size?: 'sm' | 'md'
  /** Which edge touches scrolling content.
   *  'auto' (default) — seamless at rest; hairline + soft shadow appear only once the content
   *  beneath has scrolled (macOS scroll-edge effect). The scroll root is `scrollRef`, else the
   *  bar's next scrollable sibling, else `scrolled` if the caller tracks it.
   *  'bottom' / 'top' — permanent hairline (only where content never scrolls under the bar).
   *  'none' — nothing. */
  edge?: 'auto' | 'bottom' | 'top' | 'none'
  /** Scroll container to observe for edge='auto'. */
  scrollRef?: RefObject<HTMLElement>
  /** Externally tracked scrolled state (store slice) for edge='auto'. */
  scrolled?: boolean
  /** Footer bar: the scroll edge is on its top. */
  edgeSide?: 'bottom' | 'top'
  /** 'soft' (default) — hairline + soft shadow while scrolled (in-content sticky headers).
   *  'hard' — additionally a near-opaque backing (macOS 27's top edge under floating bars):
   *  the window toolbar and inspector sub-toolbars. */
  edgeStyle?: 'soft' | 'hard'
  /** Stick to the top of a scroll container. */
  sticky?: boolean
  /** Use the sidebar (denser) material instead of the bar material. */
  material?: 'bar' | 'sidebar' | 'none'
  /** Resting surface handed to child controls via context (default 'glass' — visible controls,
   *  matching macOS toolbars). Set 'ghost' for a bar that's already floating on its own glass
   *  surface (e.g. a popover/pill), where boxing every individual button too reads as doubled-up
   *  chrome — controls should stay minimal until actually hovered. */
  itemVariant?: ControlSurface
}

/**
 * M1 integrated bar. Every control inside defaults to the 'glass' resting surface, matching
 * macOS 26/27 toolbars. Layout rhythm (§18): `gap-2` BETWEEN groups, `gap-0` inside a
 * ControlGroup, `px-3` insets — one scale, no per-bar spacing.
 */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { size = 'sm', edge = 'auto', scrollRef, scrolled: scrolledProp, edgeSide = 'bottom', edgeStyle = 'soft', sticky, material = 'bar', itemVariant = 'glass', className, children, ...rest }, ref,
) {
  const inner = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLDivElement)
  const auto = edge === 'auto'
  const observed = useScrollEdge(inner, auto && scrolledProp === undefined ? (scrollRef ?? 'auto') : null, edgeSide)
  const scrolled = auto ? (scrolledProp ?? observed) : false
  return (
    <ControlSurfaceContext.Provider value={itemVariant}>
      <BarMetrics>
      <div
        ref={inner}
        data-scroll-edge={auto ? edgeSide : undefined}
        data-edge-style={auto ? edgeStyle : undefined}
        data-scrolled={scrolled || undefined}
        className={cx(
          'flex items-center gap-2 flex-shrink-0 min-w-0 px-3',
          size === 'md' ? 'h-11' : 'h-10',
          material === 'bar' && 'material-bar', material === 'sidebar' && 'material-sidebar',
          edge === 'bottom' && 'border-b border-separator', edge === 'top' && 'border-t border-separator',
          sticky && 'sticky top-0 z-raised',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
      </BarMetrics>
    </ControlSurfaceContext.Provider>
  )
})
export default Toolbar
