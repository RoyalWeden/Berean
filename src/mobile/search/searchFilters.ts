import { TRANSLATIONS } from '@/lib/bibleTexts'
import { booksSummary } from '@/lib/scriptureSearchFilters'
import type { WordMode } from '@/lib/scriptureHighlight'
import type { SearchSortMode, SearchSortDirection } from '@/lib/scriptureSearch'

/**
 * Search's Advanced options behind ONE compact "Filters" entry (SEP25). Pure helpers: which
 * filters are active (the count badge) and the short summary the entry shows. SearchPage's
 * caret uses the same count so the two never disagree.
 */
export type SearchScope = 'all' | 'scripture' | 'notes' | 'lexicon'

/** Everything the filter sheet edits. Tags and sort are applied client-side to the hit list;
 *  text / match / books change the query itself (same split as ScriptureSearchView). */
export interface SearchFilterState {
  textId: string | 'all'
  wordMode: WordMode
  books: string[]
  /** Selected verse-tag ids; results narrow to tagged verses (chapter tags cover every verse). */
  tagIds: string[]
  /** Every selected tag must contain the verse (AND) rather than any one (OR). */
  tagMatchAll: boolean
  sort: SearchSortMode
  direction: SearchSortDirection
}
export const DEFAULT_SEARCH_FILTERS: SearchFilterState = { textId: 'all', wordMode: 'all', books: [], tagIds: [], tagMatchAll: false, sort: 'relevance', direction: 'desc' }

/** Which scopes have filters at all (Lexicon has none). */
export function scopeHasFilters(scope: SearchScope): boolean { return scope !== 'lexicon' }

/** Number of non-default filters that apply to `scope` (Notes only honours the word mode). */
export function activeFilterCount(f: SearchFilterState, scope: SearchScope = 'scripture'): number {
  if (scope === 'lexicon') return 0
  const match = f.wordMode !== 'all' ? 1 : 0
  if (scope === 'notes') return match
  return match + (f.textId !== 'all' ? 1 : 0) + (f.books.length ? 1 : 0) + (f.tagIds.length ? 1 : 0) + (f.sort !== 'relevance' ? 1 : 0)
}

export const WORD_MODE_LABEL: Record<WordMode, string> = { all: 'All words', any: 'Any word', phrase: 'Exact phrase' }

export function textFilterLabel(textId: string): string {
  return textId === 'all' ? 'All texts' : (TRANSLATIONS.find((t) => t.id === textId)?.label ?? textId)
}

/** The Filters entry's one-line summary: "Every book · All texts", "Genesis · KJVA · Exact phrase · 2 tags". */
export function filtersSummary(f: SearchFilterState, scope: SearchScope = 'scripture'): string {
  if (scope === 'notes') return WORD_MODE_LABEL[f.wordMode]
  const parts = [booksSummary(f.books), textFilterLabel(f.textId)]
  if (f.wordMode !== 'all') parts.push(WORD_MODE_LABEL[f.wordMode])
  if (f.tagIds.length) parts.push(`${f.tagIds.length} tag${f.tagIds.length === 1 ? '' : 's'}`)
  if (f.sort !== 'relevance') parts.push('Bible order')
  return parts.join(' · ')
}
