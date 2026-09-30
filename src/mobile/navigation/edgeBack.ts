import { useAppStore, tabCanGoBack } from '@/store'
import type { SpaceId, Tab } from '@/types'

/**
 * The iPhone edge swipe on a tab's root page (TEST 2026-09-29) — the ordinary iOS back gesture
 * applied to Berean's per-tab history:
 *   1. the tab has an earlier step in its own history → go back one step (same as the caret's ‹);
 *   2. the tab is at its first step → close it; the store activates the most recently used tab
 *      (closeTab's MRU fallback, any space);
 *   3. it is the only open tab → nothing (there is nowhere to go back to).
 * Pushed pages (settings sub-pages, versions, …) keep their own pop gesture (NavigationStack).
 */
export type EdgeBackAction = 'history' | 'close' | 'none'

export function edgeBackAction(s: {
  activeSpace: SpaceId
  activeTabId: Record<SpaceId, string | null>
  tabs: Record<SpaceId, Tab[]>
  tabNavStacks: Parameters<typeof tabCanGoBack>[0]['tabNavStacks']
}): EdgeBackAction {
  const space = s.activeSpace
  const id = s.activeTabId[space]
  if (!id || !(s.tabs[space] ?? []).some((t) => t.id === id)) return 'none'
  if (tabCanGoBack(s, space, id)) return 'history'
  const open = Object.values(s.tabs).reduce((n, list) => n + (list?.length ?? 0), 0)
  return open > 1 ? 'close' : 'none'
}

export function canEdgeBack(): boolean {
  return edgeBackAction(useAppStore.getState()) !== 'none'
}

/** Performs the edge-back step; returns what it did. */
export function performEdgeBack(): EdgeBackAction {
  const s = useAppStore.getState()
  const action = edgeBackAction(s)
  if (action === 'history') s.navTabBack()
  else if (action === 'close') {
    const space = s.activeSpace
    const id = s.activeTabId[space]
    if (id) s.closeTab(space, id)
  }
  return action
}
