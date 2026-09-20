import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * DOM node for the shared top bar's CONTEXT-zone portal target (the tab title/nav controls,
 * left-of-center). ShellHeader.tsx owns the actual div and reports it up via a ref callback;
 * App.tsx threads it through this Provider. The active tab panel (BiblePanel/NotesPanel/
 * LexiconPanel/YouTubeTab/SearchTab/PDFViewer) portals its own header controls into it when
 * docked (floating windows keep their own PanelHeader instead, since they have no shared
 * app-level top bar).
 */
export const TopBarSlotContext = createContext<HTMLDivElement | null>(null)

export function useTopBarSlot(): HTMLDivElement | null {
  return useContext(TopBarSlotContext)
}

// ── ACTIONS-zone slot ──────────────────────────────────────────────────────────────
// A second portal target (trailing action group(s), right-of-center) inside ShellHeader's
// toolbar. Widening TopBarSlotContext's own Provider value to `{context, actions}` would require
// App.tsx (which owns the Provider and the `topBarSlot` state it's given) to also track a second
// ref — out of scope for this lane (App.tsx belongs to a different concurrent lane). Instead this
// is a tiny module-level external store that ShellHeader publishes into via `publishActionsSlot`
// (mount/unmount effect, same lifecycle as the context slot) and any component reads via
// `useTopBarSlots()`. Safe as a bare module singleton: there is exactly one ShellHeader mounted
// per renderer process.
let actionsSlotEl: HTMLDivElement | null = null
const actionsListeners = new Set<() => void>()

export function publishActionsSlot(el: HTMLDivElement | null) {
  actionsSlotEl = el
  actionsListeners.forEach((listener) => listener())
}

function subscribeActionsSlot(listener: () => void) {
  actionsListeners.add(listener)
  return () => actionsListeners.delete(listener)
}

function getActionsSlot() {
  return actionsSlotEl
}

/** Both top-bar portal targets: `context` (title/nav controls — the same node useTopBarSlot()
 *  returns) and `actions` (the trailing action-group zone). */
export function useTopBarSlots(): { context: HTMLDivElement | null; actions: HTMLDivElement | null } {
  const context = useContext(TopBarSlotContext)
  const actions = useSyncExternalStore(subscribeActionsSlot, getActionsSlot, () => null)
  return { context, actions }
}
