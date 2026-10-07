import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useWindowDrag, isInteractiveDragTarget } from '@/lib/useWindowDrag'
import { Toolbar, ToolbarSpacer } from '@/components/ui'

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
 *
 * Two zones, same as the docked shared TopBar (ShellHeader.tsx): `children` is the CONTEXT
 * zone (title/nav, left), and a second, independently-portaled ACTIONS zone (trailing action
 * group(s), right) sits after a flexible spacer. TabHeaderPortal calls this component only for
 * the panel's `zone="context"` (the default) call — its `zone="actions"` call, a sibling in the
 * caller's tree rather than a child of this one, can't hand its content down as a prop, so it
 * portals into the actions container this publishes via `publishFloatingActionsSlot` (see that
 * function's own comment). A panel that never issues a `zone="actions"` call (every panel but
 * PDFViewer, for now) simply leaves that container empty — harmless, no layout effect.
 */
/**
 * Where the panel is being shown. 'phone' = a desktop panel hosted full-screen by the iPhone shell
 * (MobileApp's hosted-panel wrapper): no macOS traffic-light inset, no window drag, and the phone's
 * header metrics (--m-header-h) so hosted tabs (Lexicon, YouTube, PDF, tags) line up with every
 * native phone page instead of showing a squeezed Mac title bar under the notch (T23-001/002).
 */
export const PanelChromeContext = createContext<'desktop' | 'phone'>('desktop')

export default function PanelHeader({
  floating = false,
  children,
  className = '',
}: {
  floating?: boolean
  children: ReactNode
  className?: string
}) {
  const chrome = useContext(PanelChromeContext)
  const onMouseDown = useWindowDrag(isInteractiveDragTarget)
  const actionsRef = useCallback((el: HTMLDivElement | null) => {
    publishFloatingActionsSlot(el)
  }, [])
  if (chrome === 'phone') {
    return (
      <div className={`mobile-hosted-header flex-shrink-0 select-none material-bar border-b border-separator ${className}`}>
        <Toolbar size="md" edge="none" material="none">
          <div className="shell-context-zone flex items-center gap-2 min-w-0 flex-shrink">{children}</div>
          <ToolbarSpacer className="shell-flex-space" />
          <div ref={actionsRef} className="shell-actions-zone flex items-center gap-2 flex-shrink-0 justify-end" />
        </Toolbar>
      </div>
    )
  }
  return (
    <div
      onMouseDown={onMouseDown}
      className={`h-11 flex-shrink-0 no-drag select-none material-bar border-b border-separator ${
        floating ? 'pl-traffic-lights pr-3' : 'px-3'
      } ${className}`}
    >
      <Toolbar size="md" edge="none" material="none">
        <div className="shell-context-zone flex items-center gap-2 min-w-0 flex-shrink">{children}</div>
        <ToolbarSpacer className="shell-flex-space" />
        <div ref={actionsRef} className="shell-actions-zone flex items-center gap-2 flex-shrink-0 justify-end" />
      </Toolbar>
    </div>
  )
}

// ── Floating ACTIONS-zone slot ──────────────────────────────────────────────────────
// Mirrors TopBarSlotContext's docked `publishActionsSlot`/`useTopBarSlots` pair (see that
// file's comment for the full reasoning behind the module-singleton approach). A floating "Pop
// Out Tab" window is its own renderer process/module scope and hosts exactly one panel at a
// time, so a bare singleton here — rather than a React context threaded down from FloatingShell
// (out of scope for this lane) — is safe.
let floatingActionsSlotEl: HTMLDivElement | null = null
const floatingActionsListeners = new Set<() => void>()

export function publishFloatingActionsSlot(el: HTMLDivElement | null) {
  floatingActionsSlotEl = el
  floatingActionsListeners.forEach((listener) => listener())
}

export function subscribeFloatingActionsSlot(listener: () => void) {
  floatingActionsListeners.add(listener)
  return () => floatingActionsListeners.delete(listener)
}

export function getFloatingActionsSlot() {
  return floatingActionsSlotEl
}
