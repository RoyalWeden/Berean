import { useAppStore } from '@/store'
import type { SearchTabState, TabNavEntry } from '@/types'
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState, type SearchScope } from './searchFilters'

/**
 * Per-tab history for Search and Settings tabs (SEP25). A step is a generic `state` snapshot the
 * store re-applies with updateTabState on back / forward (restoreTabNavEntry). Pushes are ignored
 * while a restore is in progress and identical consecutive snapshots are deduped by the store.
 */
export type NavStep = Omit<TabNavEntry, 'id'>

/** Record a step; when the tab has no history yet, the pre-change `before` step goes first so
 *  ‹ can return to it. */
export function recordTabStep(tabId: string, before: NavStep, after: NavStep): void {
  const s = useAppStore.getState()
  if (s.isNavJumping) return
  const cur = s.tabNavStacks[tabId]
  if (!cur || cur.stack.length === 0) s.pushTabNav(tabId, before)
  s.pushTabNav(tabId, after)
}

/** Merge extra context (the result-list scroll) into the CURRENT step of a tab's history, so
 *  returning to it restores it. Never creates a step. */
export function stampCurrentStep(tabId: string, patch: Record<string, unknown>): void {
  useAppStore.setState((s) => {
    const cur = s.tabNavStacks[tabId]
    const top = cur?.stack[cur.idx]
    if (!cur || !top) return {}
    const stack = cur.stack.slice()
    stack[cur.idx] = { ...top, state: { ...(top.state ?? {}), ...patch } }
    return { tabNavStacks: { ...s.tabNavStacks, [tabId]: { ...cur, stack } } }
  })
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────

/** What a Search history step restores — fixed key order so equal snapshots compare equal. */
export interface SearchSnapshot {
  query: string
  scope: SearchScope
  filters: SearchFilterState
}

export function searchSnapshot(st: Partial<SearchTabState> | undefined): SearchSnapshot {
  const f = { ...DEFAULT_SEARCH_FILTERS, ...((st?.filters ?? {}) as Partial<SearchFilterState>) }
  return {
    query: (st?.query ?? '').trim(),
    scope: st?.scope ?? 'scripture',
    filters: {
      textId: f.textId, wordMode: f.wordMode, books: [...f.books], tagIds: [...f.tagIds],
      tagMatchAll: f.tagMatchAll, sort: f.sort, direction: f.direction,
    },
  }
}

export const searchSnapshotKey = (s: SearchSnapshot): string => JSON.stringify(s)

export function searchStep(s: SearchSnapshot): NavStep {
  return { type: 'search', title: s.query ? `“${s.query}”` : 'Search', state: { query: s.query, scope: s.scope, filters: s.filters } }
}

/** The last snapshot each Search tab recorded (module-level: filter sub-sheets record too). */
const committed = new Map<string, SearchSnapshot>()

/**
 * Record `after` as a Search step if it differs from the tab's last recorded snapshot (`before`
 * when nothing was recorded yet — it also seeds an empty history). The result-list scroll is
 * stamped into the step being left. Returns true when a step was recorded.
 */
export function commitSearchStep(tabId: string, before: SearchSnapshot, after: SearchSnapshot): boolean {
  const last = committed.get(tabId) ?? before
  if (searchSnapshotKey(after) === searchSnapshotKey(last)) return false
  if (useAppStore.getState().isNavJumping) { committed.set(tabId, after); return false }
  committed.set(tabId, after)
  const scrollTop = (useAppStore.getState().tabs.search.find((t) => t.id === tabId)?.state as SearchTabState | undefined)?.scrollTop
  if (scrollTop !== undefined) stampCurrentStep(tabId, { scrollTop })
  recordTabStep(tabId, searchStep(last), searchStep(after))
  return true
}

/** This snapshot is now the recorded one (tab mount, or a restore landed on it) — no step. */
export function markSearchCommitted(tabId: string, s: SearchSnapshot, onlyIfUnset = false): void {
  if (onlyIfUnset && committed.has(tabId)) return
  committed.set(tabId, s)
}

export function isSearchCommitted(tabId: string, s: SearchSnapshot): boolean {
  const c = committed.get(tabId)
  return !!c && searchSnapshotKey(c) === searchSnapshotKey(s)
}

/** Tests only. */
export function _resetSearchCommitted(): void { committed.clear() }
