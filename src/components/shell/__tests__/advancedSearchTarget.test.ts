import { describe, it, expect } from 'vitest'
import { advancedSearchInPlaceTabId, advancedSearchTabPatch, advancedSearchTitle } from '../advancedSearchTarget'

describe('advancedSearchInPlaceTabId (MAC-FS-ADV)', () => {
  it('current-tab mode on a Scripture tab converts that tab', () => {
    expect(advancedSearchInPlaceTabId('current', 'scripture', 'tab-1')).toBe('tab-1')
  })
  it('new-tab and floating modes always open a new tab', () => {
    expect(advancedSearchInPlaceTabId('new', 'scripture', 'tab-1')).toBeNull()
    expect(advancedSearchInPlaceTabId('floating', 'scripture', 'tab-1')).toBeNull()
  })
  it('current-tab mode outside Scripture (or with no Scripture tab) opens a new tab', () => {
    expect(advancedSearchInPlaceTabId('current', 'notes', 'tab-1')).toBeNull()
    expect(advancedSearchInPlaceTabId('current', 'scripture', null)).toBeNull()
  })
})

describe('advancedSearchTabPatch / advancedSearchTitle', () => {
  it('seeds the same search fields as a new search tab', () => {
    expect(advancedSearchTabPatch('grace', [])).toEqual({ searchMode: true, scriptureSearchQuery: 'grace', searchTagFilter: undefined, searchTagFilterAll: undefined })
    expect(advancedSearchTabPatch(undefined, ['a', 'b'])).toMatchObject({ scriptureSearchQuery: '', searchTagFilter: 'a,b' })
  })
  it('titles match openScriptureSearchTab', () => {
    expect(advancedSearchTitle('grace', [])).toBe('Search')
    expect(advancedSearchTitle(undefined, ['Sabbath'])).toBe('#Sabbath')
    expect(advancedSearchTitle(undefined, [])).toBe('Tagged')
  })
})
