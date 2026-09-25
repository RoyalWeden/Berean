// Contextual (chapter-scoped) side-panel filter rules for Scripture tabs.
//
// A right-panel verse filter ("BOOK.chapter.verse") only means something inside the chapter it
// was set in — carried into another chapter it would silently filter the Cross References /
// Notes lists to a verse of a DIFFERENT chapter (the Hebrews 10:9 → Zechariah 4 report). These
// helpers keep that rule in one pure place: persistent preferences (fonts, Strong's toggle,
// cross-ref source, …) are never touched here.

/** Tab-state fields that are contextual to the tab's current chapter and must never carry
 *  across a chapter change or into a new/duplicated tab. */
export const CONTEXTUAL_SCRIPTURE_FIELDS = ['rightPanelVerseFilter', 'rightPanelVerseFilterB'] as const

/** The filter itself if it points at a verse in `bookId` `chapter`, otherwise null. */
export function verseFilterForChapter(filter: string | null | undefined, bookId: string, chapter: number): string | null {
  if (!filter) return null
  const [b, ch] = filter.split('.')
  return b === bookId && parseInt(ch ?? '', 10) === chapter ? filter : null
}

/** Copy of a Scripture tab state with every contextual filter cleared — for a brand-new or
 *  duplicated tab, which must start with clean contextual filters. */
export function withoutContextualFilters<T extends object>(state: T): T {
  const next = { ...state } as Record<string, unknown>
  for (const k of CONTEXTUAL_SCRIPTURE_FIELDS) if (k in next) next[k] = null
  return next as T
}

/** Which verses the side-panel Cross References should show for this chapter.
 *  - Reader verse selection in this chapter wins (auto-filter; sorted, de-duplicated).
 *  - Otherwise a manual verse filter that belongs to this chapter.
 *  - Otherwise null = whole-chapter view. */
export function crossRefVerseNums(
  selection: ReadonlyArray<{ bookId: string; chapter: number; verse: number }> | null | undefined,
  manualFilter: string | null | undefined,
  bookId: string,
  chapter: number,
): number[] | null {
  const sel = (selection ?? []).filter((r) => r.bookId === bookId && r.chapter === chapter && r.verse > 0)
  if (sel.length) return [...new Set(sel.map((r) => r.verse))].sort((a, b) => a - b)
  const f = verseFilterForChapter(manualFilter, bookId, chapter)
  const v = f ? parseInt(f.split('.')[2] ?? '', 10) : NaN
  return v > 0 ? [v] : null
}
