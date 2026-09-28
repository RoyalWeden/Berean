/**
 * Tab-cards sort (SEP25 TAB-SORT): "Recent | Custom".
 *   • Recent — most recently used first (the store's tabMRUList), tabs never used after the custom order.
 *   • Custom — the user's manual order: the session's unified display order (sessionDisplayOrders),
 *     the same order the Mac sidebar shows.
 * A manual reorder ALWAYS lands in Custom: dragging while Recent is shown switches to Custom and
 * saves the dragged (recent-based) order as the new custom order, overwriting the previous one.
 * Switching modes never changes the stored custom order, so Custom → Recent → Custom restores it.
 */
export type TabSortMode = 'recent' | 'custom'

/** `ids` (already in custom order) sorted most-recently-used first; unused tabs keep their custom order. */
export function recentOrder(customOrder: readonly string[], mru: readonly string[]): string[] {
  const present = new Set(customOrder)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of mru) if (present.has(id) && !seen.has(id)) { out.push(id); seen.add(id) }
  for (const id of customOrder) if (!seen.has(id)) out.push(id)
  return out
}

/** The order the cards show in a mode. */
export function displayedOrder(mode: TabSortMode, customOrder: readonly string[], mru: readonly string[]): string[] {
  return mode === 'recent' ? recentOrder(customOrder, mru) : [...customOrder]
}

/** A manual reorder of the shown cards (in either mode): the mode to switch to and the custom order to store. */
export function applyManualReorder(shownAfterDrag: readonly string[]): { mode: 'custom'; customOrder: string[] } {
  return { mode: 'custom', customOrder: [...shownAfterDrag] }
}
