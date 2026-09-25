/**
 * MAC-FILTER / MAC-XREF-AUTO (SEP25): contextual side-panel filters never carry across chapters,
 * new tabs start clean, and the reader's verse selection drives the Cross References filter.
 */
import { describe, it, expect } from 'vitest'
import { verseFilterForChapter, withoutContextualFilters, crossRefVerseNums } from '@/lib/scriptureContextFilters'

const v = (verse: number, chapter = 10, bookId = 'HEB') => ({ bookId, chapter, verse })

describe('verseFilterForChapter', () => {
  it('keeps a filter that belongs to the current chapter', () => {
    expect(verseFilterForChapter('HEB.10.9', 'HEB', 10)).toBe('HEB.10.9')
  })
  it('drops a filter from another book/chapter (Hebrews 10:9 → Zechariah 4)', () => {
    expect(verseFilterForChapter('HEB.10.9', 'ZEC', 4)).toBeNull()
    expect(verseFilterForChapter('HEB.10.9', 'HEB', 11)).toBeNull()
  })
  it('treats empty filters as null', () => {
    expect(verseFilterForChapter(null, 'HEB', 10)).toBeNull()
    expect(verseFilterForChapter(undefined, 'HEB', 10)).toBeNull()
  })
})

describe('withoutContextualFilters', () => {
  it('clears contextual filters and keeps persistent fields', () => {
    const st = { bookId: 'HEB', chapter: 10, showStrongs: true, rightPanelVerseFilter: 'HEB.10.9', rightPanelVerseFilterB: 'HEB.10.2' }
    expect(withoutContextualFilters(st)).toEqual({ bookId: 'HEB', chapter: 10, showStrongs: true, rightPanelVerseFilter: null, rightPanelVerseFilterB: null })
    expect(st.rightPanelVerseFilter).toBe('HEB.10.9') // input untouched
  })
  it('does not add absent fields', () => {
    expect(withoutContextualFilters({ bookId: 'GEN' })).toEqual({ bookId: 'GEN' })
  })
})

describe('crossRefVerseNums', () => {
  it('whole chapter when nothing is selected or filtered', () => {
    expect(crossRefVerseNums([], null, 'HEB', 10)).toBeNull()
  })
  it('selection wins over a manual filter, sorted and de-duplicated', () => {
    expect(crossRefVerseNums([v(7), v(3), v(7), v(5)], 'HEB.10.9', 'HEB', 10)).toEqual([3, 5, 7])
  })
  it('ignores selected verses outside the chapter', () => {
    expect(crossRefVerseNums([v(2, 4, 'ZEC')], null, 'HEB', 10)).toBeNull()
  })
  it('falls back to the manual filter when the selection is cleared', () => {
    expect(crossRefVerseNums([], 'HEB.10.9', 'HEB', 10)).toEqual([9])
  })
  it('ignores a stale manual filter from another chapter', () => {
    expect(crossRefVerseNums(null, 'HEB.10.9', 'ZEC', 4)).toBeNull()
  })
})
