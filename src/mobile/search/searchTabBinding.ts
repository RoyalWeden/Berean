import { useAppStore } from '@/store'
import type { BibleTabState, SearchTabState, SpaceId, Tab, TabState } from '@/types'
import { BOOK_SECTIONS } from '@/lib/scriptureSearchFilters'
import { searchNavEntry } from '@/lib/searchNav'
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState } from './searchFilters'

/**
 * The iPhone Search page drives two kinds of tab:
 *
 *  - its own Search tabs (space `search`, type `search`) — state is `SearchTabState` as is;
 *  - the desktop's Advanced Scripture Search tabs (space `scripture`, type `bible`, `searchMode`)
 *    — which sync over iCloud with the desktop's own field names (`scriptureSearchQuery`,
 *    `searchTextId`, `searchBookFilter` …, tabFields.ts). The phone used to route every Scripture
 *    tab to the reader, so a synced search showed up as Genesis 1.
 *
 * This adapter presents both as a `SearchTabState` and writes edits back in the tab's OWN shape,
 * so a search edited on the phone is the same search when it syncs back to the Mac.
 */

/** A Scripture tab that the desktop has in Advanced Search mode. */
export function isScriptureSearchTab(tab: Pick<Tab, 'type' | 'state'> | null | undefined): boolean {
  return !!tab && tab.type === 'bible' && !!(tab.state as BibleTabState | undefined)?.searchMode
}

/** The search-capable tab with this id, in whichever space holds it. */
export function findSearchTab(tabId: string, s = useAppStore.getState()): Tab | undefined {
  return s.tabs.search.find((t) => t.id === tabId) ?? s.tabs.scripture.find((t) => t.id === tabId && isScriptureSearchTab(t))
}

/** Phone-only extras kept beside the desktop fields (never read by the Mac). */
interface ScriptureSearchExtras {
  searchSortDirection?: SearchFilterState['direction']
  searchPreview?: unknown
}

/** Desktop's testament filter, as the book ids it covers (Pseudepigrapha has no fixed list). */
function testamentBooks(testament: string | undefined): string[] {
  const section = testament === 'OT' ? 'ot' : testament === 'NT' ? 'nt' : testament === 'Apocrypha' ? 'apocrypha' : null
  return section ? [...(BOOK_SECTIONS.find((s) => s.id === section)?.books ?? [])] : []
}

/** Desktop fields → the phone's filter model. */
export function scriptureFiltersOf(st: BibleTabState & ScriptureSearchExtras): SearchFilterState {
  const books = st.searchBookFilter && st.searchBookFilter !== 'all' ? st.searchBookFilter.split(',').filter(Boolean) : testamentBooks(st.searchTestamentFilter)
  const sort = st.searchSortMode === 'bookOrder' ? 'bookOrder' : 'relevance'
  return {
    ...DEFAULT_SEARCH_FILTERS,
    textId: st.searchTextId || 'all',
    wordMode: st.searchWordMode ?? 'all',
    books,
    tagIds: st.searchTagFilter ? st.searchTagFilter.split(',').filter(Boolean) : [],
    tagMatchAll: !!st.searchTagFilterAll,
    sort,
    direction: st.searchSortDirection ?? (sort === 'relevance' ? 'desc' : 'asc'),
  }
}

/** A tab's search state, whichever kind of tab it is. */
export function readSearchState(tab: Tab | undefined): SearchTabState | undefined {
  if (!tab) return undefined
  if (tab.type === 'search') return tab.state as SearchTabState
  if (!isScriptureSearchTab(tab)) return undefined
  const st = tab.state as BibleTabState & ScriptureSearchExtras
  return {
    query: st.scriptureSearchQuery ?? '',
    results: [],
    scope: 'scripture',
    filters: scriptureFiltersOf(st) as unknown as Record<string, unknown>,
    scrollTop: st.searchScrollTop,
    ...({ preview: st.searchPreview ?? null } as object),
  } as SearchTabState
}

/** Live search state of tab `tabId` (store, not a render snapshot). */
export function liveSearchState(tabId: string): SearchTabState | undefined {
  return readSearchState(findSearchTab(tabId))
}

/** The phone's filter patch → desktop fields (only what changed, so an untouched desktop
 *  testament filter is not rewritten as a book list). */
export function scriptureFieldsFor(prev: SearchFilterState, next: SearchFilterState): Partial<BibleTabState & ScriptureSearchExtras> {
  const out: Partial<BibleTabState & ScriptureSearchExtras> = {}
  if (next.textId !== prev.textId) out.searchTextId = next.textId
  if (next.wordMode !== prev.wordMode) out.searchWordMode = next.wordMode
  if (next.books.join(',') !== prev.books.join(',')) { out.searchBookFilter = next.books.join(',') || 'all'; out.searchTestamentFilter = 'all' }
  if (next.tagIds.join(',') !== prev.tagIds.join(',')) out.searchTagFilter = next.tagIds.join(',') || undefined
  if (next.tagMatchAll !== prev.tagMatchAll) out.searchTagFilterAll = next.tagMatchAll || undefined
  if (next.sort !== prev.sort) out.searchSortMode = next.sort
  if (next.direction !== prev.direction) out.searchSortDirection = next.direction
  return out
}

/** Write a `SearchTabState` patch into the tab, in that tab's own shape. */
export function writeSearchState(tabId: string, patch: Partial<SearchTabState> & { preview?: unknown }): void {
  const s = useAppStore.getState()
  const tab = findSearchTab(tabId, s)
  if (!tab) return
  if (tab.type === 'search') { s.updateTabState('search', tabId, patch as Partial<TabState>); return }
  const st = tab.state as BibleTabState & ScriptureSearchExtras
  const out: Partial<BibleTabState & ScriptureSearchExtras> = {}
  if (patch.query !== undefined) out.scriptureSearchQuery = patch.query
  if (patch.scrollTop !== undefined) out.searchScrollTop = patch.scrollTop
  if ('preview' in patch) out.searchPreview = patch.preview
  if (patch.filters !== undefined) {
    const next = { ...DEFAULT_SEARCH_FILTERS, ...(patch.filters as Partial<SearchFilterState>) }
    Object.assign(out, scriptureFieldsFor(scriptureFiltersOf(st), next))
  }
  // `scope` has no desktop counterpart: an Advanced Scripture Search is always Scripture.
  if (Object.keys(out).length) s.updateTabState('scripture', tabId, out as Partial<TabState>)
}

/** The space a search-capable tab lives in. */
export function searchTabSpace(tabId: string): SpaceId {
  return findSearchTab(tabId)?.spaceId ?? 'search'
}

/** Name the tab after its query — the desktop's own title form for its search tabs. */
export function renameSearchTab(tabId: string, query: string): void {
  const s = useAppStore.getState()
  const tab = findSearchTab(tabId, s)
  if (!tab) return
  const q = query.trim()
  const title = tab.type === 'search' ? (q ? `“${q}”` : 'Search') : (q ? `"${q}"` : 'Search')
  if (tab.title !== title) s.renameTab(tab.spaceId, tabId, title)
}

/**
 * Opening a result IN a desktop Advanced Scripture Search tab: record the search as the tab's
 * back step and leave search mode — exactly what the desktop does (BiblePanel onNavigate), so ‹
 * (here or on the Mac) returns to these results with the query and filters restored.
 */
export function leaveScriptureSearch(tabId: string) {
  const s = useAppStore.getState()
  const tab = findSearchTab(tabId, s)
  if (!tab || !isScriptureSearchTab(tab)) return
  const st = tab.state as BibleTabState
  const q = st.scriptureSearchQuery ?? ''
  if (q) {
    s.pushTabNav(tabId, searchNavEntry(q, {
      searchTextId: st.searchTextId, searchWordMode: st.searchWordMode, searchTestamentFilter: st.searchTestamentFilter,
      searchBookFilter: st.searchBookFilter, searchSortMode: st.searchSortMode, searchTagFilter: st.searchTagFilter, searchTagFilterAll: st.searchTagFilterAll,
    }))
  }
  s.updateTabState('scripture', tabId, { searchMode: false, searchBack: q ? { query: q } : null })
}
