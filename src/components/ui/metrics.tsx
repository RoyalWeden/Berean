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
 * Bar metrics — the mirror of CompactMetrics. Inside a `Toolbar` (and the sidebar's search row)
 * every sized primitive steps one size UP, so a bar renders ONE control height no matter which
 * size each call site asked for: Button sm→md, IconButton 24→28→32. macOS 26/27 toolbars are
 * roomier than the 28px controls Berean inherited, and mixed 24/28/30/32 heights in one bar read
 * as misalignment rather than hierarchy. Dense contexts (inspector, popovers, menus) still step
 * DOWN via CompactMetrics, so this does not inflate them — a control cannot be both.
 */
export const BarMetricsContext = createContext(false)
export function useBarMetrics(): boolean { return useContext(BarMetricsContext) }
export function BarMetrics({ children, value = true }: { children: ReactNode; value?: boolean }) {
  return <BarMetricsContext.Provider value={value}>{children}</BarMetricsContext.Provider>
}
const UP: Record<ControlSize, ControlSize> = { xs: 'sm', sm: 'md', md: 'md', lg: 'lg' }

export function resolveSize(size: ControlSize, compact: boolean, bar = false): ControlSize {
  if (compact) return DOWN[size]
  return bar ? UP[size] : size
}
