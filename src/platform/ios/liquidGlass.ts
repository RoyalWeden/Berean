import { BereanGlass } from './plugins'
import type { LiquidGlassAdapter } from '../liquidGlass/types'

/**
 * iOS adapter for the semantic Liquid Glass API (src/platform/liquidGlass), installed as
 * `window.__bereanGlass` at boot — shared code never imports this file (importBoundaries.test.ts).
 *
 * UIKit glass is a native view effect and cannot wrap DOM, so on iOS the semantic API maps to
 * native CONTROL CLUSTERS drawn above the web view (BereanGlassPlugin.swift). Generic page surfaces
 * (`surface` / `group`) are not drawn natively on iOS: they keep their CSS material.
 */
export function installIosLiquidGlass(): void {
  const listeners = new Set<(e: { cluster: string; item?: string; swipe?: 'next' | 'previous' }) => void>()
  let wired = false
  const wire = () => {
    if (wired) return
    wired = true
    void BereanGlass.addListener('press', (e) => listeners.forEach((l) => l({ cluster: e.cluster, item: e.item })))
    void BereanGlass.addListener('swipe', (e) => listeners.forEach((l) => l({ cluster: e.cluster, swipe: e.direction })))
  }
  const adapter: LiquidGlassAdapter = {
    platform: 'ios',
    capabilities: () => BereanGlass.capabilities(),
    surface: async () => false,
    group: async () => false,
    destroy: async () => true,
    controls: async (spec) => { wire(); await BereanGlass.setControls(spec); return true },
    removeControls: async (id) => { await BereanGlass.removeControls({ id }); return true },
    onControlEvent: (cb) => { wire(); listeners.add(cb); return () => { listeners.delete(cb) } },
  }
  window.__bereanGlass = adapter
  // Simulator automation (dev probe) — debug builds return native state; release builds return {}.
  ;(window as unknown as { __bereanGlassDebug?: unknown }).__bereanGlassDebug = (press?: string) => BereanGlass.debugState({ press })
}
