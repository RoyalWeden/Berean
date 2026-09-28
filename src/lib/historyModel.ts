import type { HistoryEntry } from '@/types'

/**
 * The history model in one place (TEST-002): every entry type the app writes, the categories the
 * History UIs filter by, and the filter itself — shared by the desktop History modal and the
 * iPhone History page so both reflect the same model.
 *
 * Writers (audited 2026-09-22): `bible` (reader chapter/verse navigation, desktop + phone),
 * `compare` (entering compare mode), `strongs-click` (Strong's chip), `lexicon` (lexicon entry),
 * `note` (note opened), `search` (search run), `youtube` (video opened), `import` (BibleGateway /
 * e-Sword / PDF import).
 */
export type HistoryEntryType = HistoryEntry['type']

export const HISTORY_ENTRY_TYPES: readonly HistoryEntryType[] = ['bible', 'compare', 'strongs-click', 'lexicon', 'note', 'search', 'youtube', 'import']

export const HISTORY_TYPE_LABEL: Record<HistoryEntryType, string> = {
  bible: 'Scripture',
  compare: 'Compare',
  'strongs-click': "Strong's",
  lexicon: 'Lexicon',
  note: 'Note',
  search: 'Search',
  youtube: 'YouTube',
  import: 'Import',
}

export type HistoryCategory = 'all' | 'scripture' | 'notes' | 'lexicon' | 'youtube' | 'search' | 'imports'

/** Categories in UI order. Every entry type belongs to exactly one non-`all` category. */
export const HISTORY_CATEGORIES: ReadonlyArray<{ key: HistoryCategory; label: string; types: readonly HistoryEntryType[] | null }> = [
  { key: 'all', label: 'All', types: null },
  { key: 'scripture', label: 'Scripture', types: ['bible', 'compare'] },
  { key: 'notes', label: 'Notes', types: ['note'] },
  { key: 'lexicon', label: 'Lexicon', types: ['lexicon', 'strongs-click'] },
  { key: 'youtube', label: 'YouTube', types: ['youtube'] },
  { key: 'search', label: 'Search', types: ['search'] },
  { key: 'imports', label: 'Imports', types: ['import'] },
]

export function typesForCategory(category: HistoryCategory): readonly HistoryEntryType[] {
  return HISTORY_CATEGORIES.find((c) => c.key === category)?.types ?? HISTORY_ENTRY_TYPES
}

/**
 * A routine read is chapter-to-chapter reading: a Scripture visit that landed on no particular
 * verse. Anything that targeted a verse (search, cross reference, Strong's occurrence, note link,
 * reference typed with a verse) is a deliberate study action. The old "Study only" filter hid
 * EVERY Scripture visit, which emptied the Scripture category (TEST-002).
 */
export function isRoutineRead(e: HistoryEntry): boolean {
  return e.type === 'bible' && (e.verse == null || e.verse === 0)
}

export interface HistoryFilter {
  category?: HistoryCategory
  /** Further narrowing inside the category (empty = every type of the category). */
  types?: ReadonlySet<HistoryEntryType>
  /** `YYYY-MM-DD` in local time. */
  date?: string
  /** Hide routine reads (only meaningful where Scripture visits are shown). */
  studyOnly?: boolean
}

export function localDateKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function matchesHistoryFilter(e: HistoryEntry, f: HistoryFilter): boolean {
  const catTypes = f.category && f.category !== 'all' ? typesForCategory(f.category) : null
  if (catTypes && !catTypes.includes(e.type)) return false
  if (f.types && f.types.size > 0 && !f.types.has(e.type)) return false
  if (f.date && localDateKey(e.timestamp) !== f.date) return false
  if (f.studyOnly && isRoutineRead(e)) return false
  return true
}

export function filterHistory(entries: readonly HistoryEntry[], f: HistoryFilter): HistoryEntry[] {
  return entries.filter((e) => matchesHistoryFilter(e, f))
}

/** Per-category counts for the given (already otherwise-filtered) entries. */
export function countByCategory(entries: readonly HistoryEntry[]): Record<HistoryCategory, number> {
  const counts = Object.fromEntries(HISTORY_CATEGORIES.map((c) => [c.key, 0])) as Record<HistoryCategory, number>
  counts.all = entries.length
  for (const e of entries) {
    for (const c of HISTORY_CATEGORIES) if (c.types?.includes(e.type)) counts[c.key]++
  }
  return counts
}

/**
 * When a filter narrows the loaded page to only a few rows, older pages must be fetched even
 * though the user is not scrolling (the old modal stopped paging whenever any filter was
 * active, so rarer types looked "missing").
 */
export function shouldLoadMoreHistory(visibleCount: number, hasMore: boolean, loading: boolean, minVisible = 60): boolean {
  return hasMore && !loading && visibleCount < minVisible
}
