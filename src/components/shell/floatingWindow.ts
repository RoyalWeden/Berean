import { createContext, useContext } from 'react'

/**
 * Shared framework for a tab shown in its own floating window (FloatingShell.tsx): whatever every
 * floating window has regardless of what it shows. Each panel keeps its own content-specific
 * layout; PanelHeader reads this to put the window's one "Return to Main Window" control at the
 * trailing end of the title bar — the same place in every floating window, never overlaid on the
 * content (it used to be a "Put back" button floating over the bottom-right corner, on top of
 * verses, a lexicon's paging bar or the note inspector).
 */
export interface FloatingWindowApi {
  /** Moves the tab back into the main window (current state, after pending saves are written). */
  returnToMain: () => void
  /** A panel whose current position isn't in the floating store's tabs (a note window navigates
   *  between notes without a tab) reports what "return" should restore, and the window's title. */
  reportCurrent: (state: Record<string, unknown>, title?: string) => void
}

export const FloatingWindowContext = createContext<FloatingWindowApi | null>(null)

export function useFloatingWindow(): FloatingWindowApi | null {
  return useContext(FloatingWindowContext)
}

/** The space each floatable tab type lives in (put-back target). Types not listed don't float. */
export const FLOATABLE_TAB_SPACES = {
  bible: 'scripture',
  pdf: 'scripture',
  notes: 'notes',
  note: 'notes',
  lexicon: 'lexicon',
  youtube: 'youtube',
  search: 'search',
} as const

export type FloatableType = keyof typeof FLOATABLE_TAB_SPACES

/** Tag graph, history, settings and calendar tabs are app-level tools with no floating layout;
 *  they are not offered "Open in floating tab" anywhere (one rule for every entry point). */
export function canFloatTabType(type: string): type is FloatableType {
  return Object.prototype.hasOwnProperty.call(FLOATABLE_TAB_SPACES, type)
}
