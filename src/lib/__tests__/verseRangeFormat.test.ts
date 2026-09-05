import { describe, it, expect } from 'vitest'
import { formatVerseNumbersToRangeString, formatVerseTieReference } from '../verseRangeFormat'
import { parseRef } from '../parseRef'

describe('formatVerseNumbersToRangeString', () => {
  it('collapses contiguous runs and keeps discontiguous verses separate', () => {
    expect(formatVerseNumbersToRangeString([1, 2, 5, 8, 9, 10])).toBe('1-2,5,8-10')
  })
  it('handles a single verse', () => {
    expect(formatVerseNumbersToRangeString([5])).toBe('5')
  })
  it('handles one big contiguous range', () => {
    expect(formatVerseNumbersToRangeString([3, 4, 5, 6])).toBe('3-6')
  })
  it('handles all-discontiguous verses', () => {
    expect(formatVerseNumbersToRangeString([1, 3, 5])).toBe('1,3,5')
  })
  it('handles empty input', () => {
    expect(formatVerseNumbersToRangeString([])).toBe('')
  })
  it('sorts and de-duplicates unordered/repeated input', () => {
    expect(formatVerseNumbersToRangeString([10, 1, 2, 2, 9, 8])).toBe('1-2,8-10')
  })
})

describe('formatVerseTieReference', () => {
  it('produces a reference parseRef can read back with matching verseGroups', () => {
    const ref = formatVerseTieReference('Mark', 13, [1, 2, 5, 8, 9, 10])
    expect(ref).toBe('Mark 13:1-2,5,8-10')
    const parsed = parseRef(ref)
    expect(parsed?.bookId).toBe('MRK')
    expect(parsed?.chapter).toBe(13)
    expect(parsed?.verseGroups).toEqual([
      { verse: 1, endVerse: 2 }, { verse: 5 }, { verse: 8, endVerse: 10 },
    ])
  })
  it('returns empty string for no verses selected', () => {
    expect(formatVerseTieReference('Mark', 13, [])).toBe('')
  })
})
