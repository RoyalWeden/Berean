import { describe, it, expect } from 'vitest'
import { floatingTabState, decodeFloatingParam } from '../floatingTab'

// The main process puts a floating window's tab state into its URL as strings; FloatingShell
// decodes it back. An Advanced Scripture Search tab must arrive as that search (TEST 2026-10-11).
describe('floating tab state round trip', () => {
  it('carries a search-mode Scripture tab — flags, numbers, strings and objects', () => {
    const state = {
      bookId: 'GEN', chapter: 1, searchMode: true, scriptureSearchQuery: 'peace', searchWordMode: 'phrase',
      searchScrollTop: 240, hiddenAnnotations: ['a', 'b'], noteBack: null, rightPanelLexiconEntry: undefined,
    }
    const encoded = floatingTabState(state)
    // What the main process does: String() every value into the URL.
    const params = Object.fromEntries(Object.entries(encoded).map(([k, v]) => [k, String(v)]))
    expect(params.hiddenAnnotations).not.toBe('a,b')
    const decoded = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, decodeFloatingParam(k, v)]))
    expect(decoded).toEqual({
      bookId: 'GEN', chapter: 1, searchMode: true, scriptureSearchQuery: 'peace', searchWordMode: 'phrase',
      searchScrollTop: 240, hiddenAnnotations: ['a', 'b'],
    })
  })
  it('keeps a numeric-looking query a string', () => {
    expect(decodeFloatingParam('scriptureSearchQuery', '316')).toBe('316')
  })
})
