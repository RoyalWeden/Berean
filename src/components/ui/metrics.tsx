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
export function resolveSize(size: ControlSize, compact: boolean): ControlSize { return compact ? DOWN[size] : size }
