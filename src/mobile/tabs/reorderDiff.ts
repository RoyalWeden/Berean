/** The single move that turns `before` into `after` (one dragged item), as `reorderTabs` wants it. */
export function singleMove(before: string[], after: string[]): { from: number; to: number } | null {
  if (before.length !== after.length) return null
  let i = 0
  while (i < before.length && before[i] === after[i]) i++
  if (i === before.length) return null
  // Either before[i] moved later (after[i] is what followed it) or after[i] moved earlier.
  if (after[i] === before[i + 1]) { const to = after.indexOf(before[i]); return to === -1 ? null : { from: i, to } }
  const from = before.indexOf(after[i])
  return from === -1 ? null : { from, to: i }
}
