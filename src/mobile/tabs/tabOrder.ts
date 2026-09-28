/**
 * Tab order for the tab cards (T23-008): the workspace's unified display order — the same list
 * the desktop sidebar shows (sessionDisplayOrders / reorderTabDisplay) — so reordering on the
 * phone and on the Mac is one order.
 */

/** Stored order, dropping ids that no longer exist, then any tab missing from it (in `live` order). */
export function workspaceOrder(stored: readonly string[], live: readonly string[]): string[] {
  const alive = new Set(live)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of stored) if (alive.has(id) && !seen.has(id)) { out.push(id); seen.add(id) }
  for (const id of live) if (!seen.has(id)) { out.push(id); seen.add(id) }
  return out
}

/** `order` with `id` moved to index `to` (clamped). */
export function moveInOrder(order: readonly string[], id: string, to: number): string[] {
  const from = order.indexOf(id)
  if (from === -1) return [...order]
  const next = order.filter((x) => x !== id)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id)
  return next
}
