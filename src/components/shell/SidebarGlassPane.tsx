import { useRef } from 'react'
import { useAppStore, noteFocusModeActive } from '@/store'
import { useLiquidGlassSurface } from '@/platform/liquidGlass'

/**
 * macOS main window — the sidebar as a floating Liquid Glass pane (docs/liquid-glass.md §macOS).
 *
 * The window is transparent with a native backdrop; the page paints an opaque ground everywhere
 * EXCEPT a rounded hole the size of the pane, inset from the window edges and running the full
 * height (the traffic lights and the toolbar's leading group sit on it, as in macOS 26/27). The
 * native NSGlassEffectView is placed behind the page exactly under the hole; the sidebar's React
 * content draws on top of it, crisp, with every click/scroll/drag/VoiceOver path unchanged.
 *
 * Without the native bridge the hole shows the window's own NSVisualEffectView (sidebar
 * material) — the pre-26 macOS look. Rendered only on the vibrant main window (html[data-vibrant]);
 * every other window keeps the opaque CSS sidebar.
 *
 * The hole's width follows the sidebar's LIVE width (--sidebar-live-w, written by Sidebar.tsx while
 * it animates/resizes), so pane and content never drift apart during collapse or a drag.
 */
export function SidebarGlassPane() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const focus = useAppStore(noteFocusModeActive)
  const visible = !collapsed && !focus
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlassSurface(ref, {
    role: 'sidebar',
    variant: 'regular',
    // Pinned top/bottom/left: AppKit stretches it in the same frame as a live window resize.
    pin: { top: true, bottom: true, left: true },
    enabled: visible,
  })
  return (
    <div aria-hidden className={`shell-ground${visible ? '' : ' is-solid'}`}>
      {visible && <div ref={ref} className="shell-pane-hole" />}
    </div>
  )
}
