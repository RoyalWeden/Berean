import { createContext, useContext } from 'react'
import type { TabType } from '@/types'

/**
 * The tab TYPE currently shown in the main panel area (i.e. the active space's
 * active tab's type), or null when nothing is open.
 *
 * ActivePanel keeps several panels (Notes, Lexicon, Search, YouTube — and, later,
 * Bible/PDF) mounted at once and just hides the inactive ones, so a panel can no
 * longer assume "I am mounted" means "I am the visible one". Each panel reads
 * this to decide whether to portal its header controls into the single shared
 * TopBar slot (see TabHeaderPortal's `active` prop) and to no-op work that only
 * makes sense while visible.
 */
export const ActivePanelContext = createContext<TabType | null>(null)

/** True when `type` is the panel currently visible in the main area. */
export function useIsActivePanel(type: TabType): boolean {
  return useContext(ActivePanelContext) === type
}
