import { create } from 'zustand'
import { DEFAULT_UNIFIED_FILTERS, type UnifiedFilters, type UnifiedScope } from '@/lib/search/unifiedSearch'

/**
 * The search sheet's live state (SRCH-005), outside React: pushing the Filters sub-view unmounts
 * the sheet's root view, and the query, scope and filters must survive that (and the keyboard
 * coming and going). The query starts empty each time the sheet opens; scope and filters are kept
 * for the session (the user's narrowing is a preference, not a one-off).
 */
interface SurfaceState {
  query: string
  scope: UnifiedScope
  filters: UnifiedFilters
  setQuery: (q: string) => void
  setScope: (s: UnifiedScope) => void
  setFilters: (f: Partial<UnifiedFilters>) => void
  resetFilters: () => void
  /** A fresh sheet: empty query, same narrowing. */
  begin: (query?: string) => void
}

export const useSearchSurface = create<SurfaceState>((set) => ({
  query: '',
  scope: 'all',
  filters: DEFAULT_UNIFIED_FILTERS,
  setQuery: (query) => set({ query }),
  setScope: (scope) => set({ scope }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: DEFAULT_UNIFIED_FILTERS }),
  begin: (query = '') => set({ query }),
}))

/** How many filters differ from the defaults (the Filters entry's badge). */
export function surfaceFilterCount(f: UnifiedFilters): number {
  return (f.textId !== 'all' ? 1 : 0) + (f.books.length ? 1 : 0) + (f.wordMode !== 'all' ? 1 : 0)
}
