import { describe, it, expect } from 'vitest'
import { activeFilterCount, filtersSummary, scopeHasFilters, DEFAULT_SEARCH_FILTERS, type SearchFilterState } from '../search/searchFilters'
import { historyEntryActions } from '../search/resultActions'
import { destinationSpecs, classifyNewTabQuery } from '../navigation/destinationQuery'

const F = (p: Partial<SearchFilterState> = {}): SearchFilterState => ({ ...DEFAULT_SEARCH_FILTERS, ...p })

describe('Search Filters entry', () => {
  it('defaults: no badge, plain summary', () => {
    expect(activeFilterCount(F())).toBe(0)
    expect(filtersSummary(F())).toBe('Every book · All texts')
  })
  it('counts every non-default Scripture filter once', () => {
    const f = F({ textId: 'kjva', books: ['GEN'], wordMode: 'phrase', tagIds: ['a', 'b'], sort: 'bookOrder', direction: 'asc' })
    expect(activeFilterCount(f)).toBe(5)
    expect(filtersSummary(f)).toBe('Genesis · KJVA · Exact phrase · 2 tags · Bible order')
  })
  it('Notes only honours the match mode; Lexicon has no filters', () => {
    const f = F({ textId: 'kjva', wordMode: 'any' })
    expect(activeFilterCount(f, 'notes')).toBe(1)
    expect(filtersSummary(f, 'notes')).toBe('Any word')
    expect(activeFilterCount(f, 'lexicon')).toBe(0)
    expect(scopeHasFilters('lexicon')).toBe(false)
    expect(scopeHasFilters('scripture') && scopeHasFilters('notes')).toBe(true)
  })
})

describe('historyEntryActions', () => {
  const ids = (t: Parameters<typeof historyEntryActions>[0]) => historyEntryActions(t).map((a) => a.id)
  it('Scripture: open / new tab / copy reference / remove', () => {
    expect(ids('bible')).toEqual(['open', 'open-new-tab', 'copy-ref', 'remove', 'cancel'])
    expect(ids('compare')).toEqual(['open', 'open-new-tab', 'copy-ref', 'remove', 'cancel'])
  })
  it('each type gets only the copy that fits it', () => {
    expect(ids('lexicon')).toContain('copy-strongs')
    expect(ids('strongs-click')).toContain('copy-strongs')
    expect(ids('search')).toContain('copy-query')
    expect(ids('note')).toContain('copy-title')
  })
  it('YouTube has no new-tab action; imports cannot be opened', () => {
    expect(ids('youtube')).toEqual(['open', 'copy-title', 'remove', 'cancel'])
    expect(ids('import')).toEqual(['copy-title', 'remove', 'cancel'])
  })
  it('Remove from History is offered everywhere and Cancel is last', () => {
    for (const t of ['bible', 'note', 'lexicon', 'youtube', 'search', 'strongs-click', 'compare', 'import'] as const) {
      expect(ids(t)).toContain('remove')
      expect(ids(t).at(-1)).toBe('cancel')
    }
  })
})

describe('destinationSpecs (Floating Search + caret current-tab field)', () => {
  const ids = (q: string, t: 'new-tab' | 'current-tab') => destinationSpecs(q, t).map((d) => d.id)
  const primary = (q: string, t: 'new-tab' | 'current-tab') => destinationSpecs(q, t).find((d) => d.primary)?.id
  it('empty query → nothing', () => {
    expect(destinationSpecs('  ', 'new-tab')).toEqual([])
    expect(destinationSpecs('', 'current-tab')).toEqual([])
  })
  it('new-tab keeps Floating Search behaviour: reference → new Scripture tab first', () => {
    expect(ids('John 3:16', 'new-tab')).toEqual(['ref-new-tab', 'ref-current-tab', 'search-new-tab'])
    expect(destinationSpecs('John 3:16', 'new-tab')[0].label).toBe(`Open ${(classifyNewTabQuery('John 3:16') as { label: string }).label}`)
    expect(ids('grace', 'new-tab')).toEqual(['search-new-tab'])
    expect(ids('H7225', 'new-tab')).toEqual(['strongs-open', 'search-new-tab'])
  })
  it('current-tab: reference navigates this tab first; text searches in the current Search tab', () => {
    expect(primary('John 3:16', 'current-tab')).toBe('ref-current-tab')
    expect(ids('John 3:16', 'current-tab')).toEqual(['ref-current-tab', 'ref-new-tab', 'search-current-tab'])
    expect(ids('grace', 'current-tab')).toEqual(['search-current-tab', 'search-new-tab'])
    expect(primary('G3056', 'current-tab')).toBe('strongs-open')
  })
  it('exactly one primary per non-empty query', () => {
    for (const q of ['Gen 1', 'H7225', 'in the beginning'])
      for (const t of ['new-tab', 'current-tab'] as const)
        expect(destinationSpecs(q, t).filter((d) => d.primary)).toHaveLength(1)
  })
})
