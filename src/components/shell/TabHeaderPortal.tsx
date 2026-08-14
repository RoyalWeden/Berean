import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import PanelHeader from './PanelHeader'
import { useTopBarSlot } from './TopBarSlotContext'

/**
 * Drop-in replacement for PanelHeader at each of the 5 tab-panel call sites.
 * Floating windows (no sidebar, no shared TopBar) keep their own PanelHeader
 * exactly as before. Docked panels portal the same header content into the
 * shared TopBar's slot instead of drawing their own top strip.
 */
export default function TabHeaderPortal({
  floating = false,
  active = true,
  className = '',
  children,
}: {
  floating?: boolean
  /** Skip portaling when this panel isn't the currently active one (e.g. YouTube
   * stays mounted for PiP even when hidden — it must not fight the active tab
   * for the shared slot). */
  active?: boolean
  className?: string
  children: ReactNode
}) {
  const slotEl = useTopBarSlot()
  // The Home button used to be rendered here, ahead of `children`. It moved into ShellHeader's
  // fixed left nav pill (beside back/forward/history): portaled here it landed in the top bar's
  // flex-1, justify-end slot, so its appearing/disappearing with tab navigation state pushed
  // every other control in that slot sideways. It is a global navigation action like back and
  // forward, so it belongs with them in the cluster that never reflows — see the comment at its
  // new home in ShellHeader.tsx. Floating windows keep their own PanelHeader and have no shared
  // top bar, so they simply have no Home affordance now; their nav is per-window anyway.
  const content = <>{children}</>
  if (floating) return <PanelHeader floating className={className}>{content}</PanelHeader>
  if (!active || !slotEl) return null
  return createPortal(
    <div className={`flex items-center gap-2 min-w-0 w-full ${className}`}>{content}</div>,
    slotEl
  )
}
