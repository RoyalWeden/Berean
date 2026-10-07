/**
 * A Scripture-search history step (TEST 2026-10-05: several searches in one Search tab kept only
 * the last). One step per SUBMITTED search — the query plus the scope / match / sort / tag options
 * it ran with, so back / forward re-opens THAT search, not just its words. Undefined / empty
 * options are dropped so the same search recorded from two places dedups (pushTabNav compares
 * `state`).
 */
export function searchNavEntry(query: string, opts: Record<string, unknown>) {
  const state: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') state[k] = v
  return { type: 'bible' as const, title: `Search: "${query}"`, query, state }
}
