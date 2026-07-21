import { createContext, useContext } from 'react'

/**
 * DOM node for the shared top bar's right-hand portal target. ShellHeader.tsx owns
 * the actual div and reports it up via a ref callback; the active tab panel
 * (BiblePanel/NotesPanel/LexiconPanel/YouTubeTab/SearchTab) portals its own
 * header controls into it when docked (floating windows keep their own
 * PanelHeader instead, since they have no shared app-level top bar).
 */
export const TopBarSlotContext = createContext<HTMLDivElement | null>(null)

export function useTopBarSlot(): HTMLDivElement | null {
  return useContext(TopBarSlotContext)
}
