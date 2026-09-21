import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import PanelHeader, { subscribeFloatingActionsSlot, getFloatingActionsSlot } from './PanelHeader'
import { useTopBarSlots } from './TopBarSlotContext'
import { BarMetrics, ControlSurfaceContext } from '@/components/ui'

/**
 * Drop-in replacement for PanelHeader at each of the tab-panel call sites.
 * Floating windows (no sidebar, no shared TopBar) keep their own PanelHeader
 * exactly as before. Docked panels portal the same header content into the
 * shared TopBar's slot instead of drawing their own top strip.
 *
 * Two zones — `context` (title/nav, left, the default; every existing call site keeps working
 * unchanged) and `actions` (trailing action group(s), right). A panel that needs both issues two
 * separate `<TabHeaderPortal>` calls, one per zone (see PDFViewer.tsx). Docked, each portals into
 * the matching node from `useTopBarSlots()` (ShellHeader.tsx owns both). Floating, only the
 * `context` call renders the actual `PanelHeader` bar; the `actions` call portals into the
 * container that bar publishes (see PanelHeader.tsx's `publishFloatingActionsSlot` comment) —
 * neither call is an ancestor of the other, so a prop can't carry the content across.
 */
export default function TabHeaderPortal({
  floating = false,
  active = true,
  zone = 'context',
  className = '',
  children,
}: {
  floating?: boolean
  /** Skip portaling when this panel isn't the currently active one (e.g. YouTube
   * stays mounted for PiP even when hidden — it must not fight the active tab
   * for the shared slot). */
  active?: boolean
  /** Which top-bar zone this call's children belong in. Defaults to 'context' — the title/nav
   * controls every existing panel already portals there. */
  zone?: 'context' | 'actions'
  className?: string
  children: ReactNode
}) {
  // The Home button used to be rendered here, ahead of `children`. It moved into ShellHeader's
  // fixed left nav pill (beside back/forward/history): portaled here it landed in the top bar's
  // flex-1, justify-end slot, so its appearing/disappearing with tab navigation state pushed
  // every other control in that slot sideways. It is a global navigation action like back and
  // forward, so it belongs with them in the cluster that never reflows — see the comment at its
  // new home in ShellHeader.tsx. Floating windows keep their own PanelHeader and have no shared
  // top bar, so they simply have no Home affordance now; their nav is per-window anyway.
  // Re-establish the toolbar's resting surface INSIDE the portal. `Toolbar` publishes
  // `ControlSurfaceContext = 'glass'` so every control in a bar is a visible glass control at
  // rest (macOS 26/27: toolbar items get a glass background, shared per logical group). React
  // context follows the React tree, not the DOM tree — portaled panel content is rendered in the
  // PANEL's tree, so it never saw that provider and silently fell back to the 'ghost' default.
  // The result was that exactly ONE ControlGroup in the whole app (ShellHeader's own leading nav
  // cluster, a direct Toolbar child) drew its glass container, while every portaled group
  // rendered its dividers floating with no container around them. Both portal destinations are
  // bars, so both re-provide 'glass' here.
  // BarMetrics for the same reason as the surface below: both destinations are bars, and
  // without it portaled controls render at their own 24/28px sizes beside 32px direct children.
  const content = (
    <ControlSurfaceContext.Provider value="glass"><BarMetrics>{children}</BarMetrics></ControlSurfaceContext.Provider>
  )

  // Both hooks are read unconditionally (regardless of `zone`/`floating`) so their call order
  // never varies across renders — only which one's value actually gets used below depends on
  // those props.
  const dockedSlots = useTopBarSlots()
  const floatingActionsEl = useSyncExternalStore(subscribeFloatingActionsSlot, getFloatingActionsSlot, () => null)

  if (floating) {
    if (zone === 'actions') {
      if (!active || !floatingActionsEl) return null
      return createPortal(content, floatingActionsEl)
    }
    return <PanelHeader floating className={className}>{content}</PanelHeader>
  }

  const slotEl = zone === 'actions' ? dockedSlots.actions : dockedSlots.context
  if (!active || !slotEl) return null
  return createPortal(
    <div className={`flex items-center gap-2 min-w-0 w-full ${className}`}>{content}</div>,
    slotEl
  )
}
