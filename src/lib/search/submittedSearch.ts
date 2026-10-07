import { useAppStore } from '@/store'

/**
 * Search History records SEARCHES THAT WERE RUN ON PURPOSE, never typing (TEST 2026-10-05:
 * typing "good tidings" left "go", "good", "good tiding" in History because the live search wrote
 * an entry each time it ran after a typing pause).
 *
 * Call this from an explicit action only — Return / a Search button, opening a result, choosing a
 * recent — never from a debounced live search. Repeats are real events: searching "good tidings"
 * again later is recorded again (no global dedupe). The one guard is a same-query double fire
 * within a second (Return + the result click that immediately follows it count once).
 */
let last: { q: string; at: number } | null = null
export function recordSubmittedSearch(query: string, now = Date.now()): boolean {
  const q = query.trim()
  if (q.length < 2) return false
  if (last && last.q === q && now - last.at < 1000) return false
  last = { q, at: now }
  useAppStore.getState().addHistoryEntry({ type: 'search', title: `"${q}"`, query: q })
  return true
}

/** Tests only. */
export function _resetSubmittedSearch(): void { last = null }
