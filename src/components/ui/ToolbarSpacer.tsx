import { cx } from './cx'

export interface ToolbarSpacerProps {
  /** 'flexible' (default) — absorbs slack, pushing what follows to the trailing edge.
   *  'fixed' — a deliberate gap that separates two adjacent groups so they don't read as one. */
  size?: 'flexible' | 'fixed'
  className?: string
}

/**
 * The space BETWEEN two logical toolbar groups.
 *
 * Apple's rule for the new design (WWDC25, "Build a SwiftUI/AppKit app with the new design"):
 * toolbar items on macOS are automatically grouped and *share* one glass background with the
 * other items in the same logical grouping; a `ToolbarSpacer` is what splits them into separate
 * groups. Berean's `ControlGroup` is the shared-glass container; this is the other half of that
 * API — a named, greppable group boundary instead of a bare `<div className="flex-1" />`, so a
 * toolbar's grouping is legible in the markup and a reviewer can tell an intentional group break
 * from incidental layout.
 *
 * `fixed` renders nothing visible: the separation is Toolbar's own `gap-2` plus this element's
 * width, per §45 (spacing, not dividers, communicates grouping).
 */
export function ToolbarSpacer({ size = 'flexible', className }: ToolbarSpacerProps) {
  return (
    <div
      aria-hidden
      data-toolbar-spacer={size}
      className={cx(size === 'flexible' ? 'flex-1 min-w-2' : 'w-2 flex-shrink-0', className)}
    />
  )
}
export default ToolbarSpacer
