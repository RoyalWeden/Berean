import { createContext, useContext, type ReactNode } from 'react'

/**
 * Compact control metrics (Apple: `prefersCompactControlSizeMetrics` for dense inspectors and
 * popovers). Inside a compact context every sized primitive steps one size down
 * (Button sm→xs, md→sm; IconButton 28→24, 32→28; fields likewise) instead of callers sprinkling
 * ad-hoc pixel sizes. Provided by PopoverSurface, MenuSurface and the inspector pane root.
 */
export const CompactMetricsContext = createContext(false)
export function useCompactMetrics(): boolean { return useContext(CompactMetricsContext) }
export function CompactMetrics({ children, value = true }: { children: ReactNode; value?: boolean }) {
  return <CompactMetricsContext.Provider value={value}>{children}</CompactMetricsContext.Provider>
}

export type ControlSize = 'xs' | 'sm' | 'md' | 'lg'
const DOWN: Record<ControlSize, ControlSize> = { xs: 'xs', sm: 'xs', md: 'sm', lg: 'md' }

/**
 * Bar metrics — the mirror of CompactMetrics. Inside a `Toolbar` (and the sidebar's search row,
 * a bar that is not a `Toolbar`) every sized primitive renders its own BAR box instead of the box
 * its call site asked for, so a bar shows ONE control height regardless of the sizes scattered
 * across call sites. macOS 27 ("uniform toolbars") is roomier than the 28px controls Berean
 * inherited; `CONTROL_H_BAR` is that one height, and each primitive's BAR entry is built from it.
 * Dense contexts (inspector, popovers, menus) still step DOWN via CompactMetrics — a control is
 * never both, and CompactMetrics wins.
 */
export const BarMetricsContext = createContext(false)
export function useBarMetrics(): boolean { return useContext(BarMetricsContext) }
export function BarMetrics({ children, value = true }: { children: ReactNode; value?: boolean }) {
  return <BarMetricsContext.Provider value={value}>{children}</BarMetricsContext.Provider>
}
export function resolveSize(size: ControlSize, compact: boolean): ControlSize {
  return compact ? DOWN[size] : size
}

/** The one bar-control height. Every primitive's BAR box is built to match it; tune here. */
export const CONTROL_H_BAR = 36
