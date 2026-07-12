import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Home } from 'lucide-react'
import PanelHeader from './PanelHeader'
import { useTopBarSlot } from './TopBarSlotContext'
import { useAppStore } from '@/store'

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
  const content = (
    <>
      <HomeButton />
      {children}
    </>
  )
  if (floating) return <PanelHeader floating className={className}>{content}</PanelHeader>
  if (!active || !slotEl) return null
  return createPortal(
    <div className={`flex items-center gap-2 min-w-0 w-full ${className}`}>{content}</div>,
    slotEl
  )
}

// A small, persistent way back to the tab's own search/browse view — the
// mechanism (navTabBack repeated to the synthetic idx-(-1) "home" entry)
// already existed but was only reachable via a long-press/right-click on
// the top bar's global back button (TopBar.tsx's nav-history dropdown),
// not as a visible affordance on the tab itself. Only Notes and Lexicon
// tabs support a "home" state today (navSupportsHome in the store); YouTube
// doesn't yet have an equivalent channel-browse landing view to return to,
// so it's deliberately not included here.
function HomeButton() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTabId = useAppStore((s) => s.activeTabId[activeSpace])
  const tabNavStacks = useAppStore((s) => s.tabNavStacks)
  const goToTabHome = useAppStore((s) => s.goToTabHome)

  const tabStack = activeTabId ? tabNavStacks[activeTabId] : null
  const stackType = tabStack?.stack[0]?.type
  const supportsHome = stackType === 'note' || stackType === 'lexicon'
  if (!supportsHome || !tabStack || tabStack.idx < 0) return null

  const label = stackType === 'note' ? 'Notes list' : 'Lexicon search'

  // Plain native title, not Radix Tooltip: this component is portaled from
  // each panel's own component tree (NotesPanel/LexiconPanel), not from
  // inside TopBar.tsx's tree — createPortal relocates the DOM node but not
  // the React fiber/context lineage, so it doesn't inherit TopBar's local
  // <Tooltip.Provider> (this codebase wraps providers per-component, not
  // globally — confirmed no global provider exists). A native title avoids
  // needing to thread its own provider through here.
  return (
    <button
      onClick={() => goToTabHome()}
      title={label}
      className="no-drag flex-shrink-0 p-1.5 rounded-shell transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]"
    >
      <Home size={14} />
    </button>
  )
}
