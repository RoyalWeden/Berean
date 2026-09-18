import type { ReactNode } from 'react'
import { useWindowDrag, isInteractiveDragTarget } from '@/lib/useWindowDrag'
import { Toolbar } from '@/components/ui'

/**
 * Shared header chrome for every tab-panel type (Bible, Notes, Lexicon,
 * YouTube, Search). Standardizes height, padding, and drag-region behavior so
 * floating windows are always draggable from the header and docked panels
 * always clear the traffic-light cluster consistently — previously each
 * panel reimplemented this independently and drifted (Lexicon and YouTube
 * dropped `app-drag-region` in docked mode; Search never had floating
 * handling at all).
 *
 * `floating` is now a REAL bar, not a transparent row of individually-chipped
 * floating controls — macOS 27 dropped the "floating chip toolbar" idiom
 * (see docs/design-system.md's decision log: "Toolbars are real bars, not
 * floating chip clusters — the floating pop-out window header will become a
 * bar too"). Both variants now share the one `.material-bar` recipe; the
 * only real difference is the traffic-light inset a floating "Pop Out Tab"
 * window (FloatingShell.tsx, a real separate top-level BrowserWindow) needs
 * to clear its own traffic lights, vs. a docked panel's plain padding.
 *
 * Window-drag on this bar uses the manual JS-tracked `useWindowDrag` hook, not a real
 * `-webkit-app-region: drag` CSS region (this used to be `app-drag-region`) — see that hook's
 * own comment for why: reported "drag doesn't work" / "starts selecting text instead" and
 * flaky multi-monitor dragging both trace back to Electron's native drag-region hit-testing,
 * which this sidesteps entirely.
 */
export default function PanelHeader({
  floating = false,
  children,
  className = '',
}: {
  floating?: boolean
  children: ReactNode
  className?: string
}) {
  const onMouseDown = useWindowDrag(isInteractiveDragTarget)
  return (
    <div
      onMouseDown={onMouseDown}
      className={`h-11 flex-shrink-0 no-drag select-none material-bar border-b border-separator ${
        floating ? 'pl-traffic-lights pr-3' : 'px-3'
      } ${className}`}
    >
      <Toolbar size="md" edge="none" material="none">
        {children}
      </Toolbar>
    </div>
  )
}
