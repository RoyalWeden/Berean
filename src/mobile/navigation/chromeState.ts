import { useSyncExternalStore } from 'react'

/**
 * Reader-driven chrome state (NEW-007/NEW-012; SEP25: the bottom controls now float over every tab,
 * and only Scripture views — reader and Compare — set `overlay` to let them collapse): while the Scripture reader is showing, the bottom
 * controls overlay the text (so they can slide away without reflowing it), and scrolling down
 * collapses them — the same hysteresis signal (useHideOnScroll) that collapses the top header, so
 * the two always move together. Any other page leaves the bottom controls in normal flow.
 */
type Chrome = { overlay: boolean; collapsed: boolean }
let state: Chrome = { overlay: false, collapsed: false }
const listeners = new Set<() => void>()
export const chromeState = {
  set(next: Partial<Chrome>) {
    const merged = { ...state, ...next }
    if (merged.overlay === state.overlay && merged.collapsed === state.collapsed) return
    state = merged
    listeners.forEach((l) => l())
  },
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
export function useChromeState(): Chrome {
  return useSyncExternalStore(chromeState.subscribe, chromeState.get, chromeState.get)
}
