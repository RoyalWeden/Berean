// MAC-FS-ADV: where the floating search opens Advanced Scripture Search.
//
// Floating search opened to edit the CURRENT tab (⌘L-style, searchMode 'current') turns that
// tab into the advanced search in place — but only when the current tab really is a Scripture
// tab (a note/lexicon/YouTube tab can't become a Scripture search). New-tab (⌘T) and floating
// modes, or no Scripture tab in focus, keep opening a fresh search tab.

export type FloatingSearchTarget = 'current' | 'new' | 'floating'

/** The Scripture tab id to convert in place, or null to open a new search tab. */
export function advancedSearchInPlaceTabId(
  searchMode: FloatingSearchTarget,
  activeSpace: string,
  activeScriptureTabId: string | null | undefined,
): string | null {
  if (searchMode !== 'current') return null
  if (activeSpace !== 'scripture') return null
  return activeScriptureTabId ?? null
}

/** Tab-state patch that switches an existing Scripture tab into Advanced Search, mirroring the
 *  fields openScriptureSearchTab seeds on a new search tab (book/chapter stay underneath). */
export function advancedSearchTabPatch(query: string | undefined, tagIds: string[]): Record<string, unknown> {
  return {
    searchMode: true,
    scriptureSearchQuery: query ?? '',
    searchTagFilter: tagIds.length ? tagIds.join(',') : undefined,
    searchTagFilterAll: undefined,
  }
}

/** Tab title for a Scripture search — same rule as openScriptureSearchTab. */
export function advancedSearchTitle(query: string | undefined, tagNames: string[]): string {
  return query ? 'Search' : (tagNames[0] ? `#${tagNames[0]}` : 'Tagged')
}
