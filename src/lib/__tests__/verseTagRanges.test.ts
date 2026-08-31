import { describe, it, expect } from 'vitest'
import { selectionToRanges, chapterRanges, rangesLabel, parseVerseSpans } from '../verseTagRanges'

describe('selectionToRanges', () => {
  it('collapses contiguous verses into spans, per chapter', () => {
    const r = selectionToRanges([
      { bookId: 'DEU', chapter: 32, verse: 6 },
      { bookId: 'DEU', chapter: 32, verse: 3 },
      { bookId: 'DEU', chapter: 32, verse: 4 },
    ])
    expect(r).toEqual([{ bookId: 'DEU', chapter: 32, spans: [{ s: 3, e: 4 }, { s: 6, e: 6 }] }])
  })

  it('groups across chapters into separate range entries', () => {
    const r = selectionToRanges([
      { bookId: 'GEN', chapter: 1, verse: 1 },
      { bookId: 'GEN', chapter: 2, verse: 4 },
      { bookId: 'GEN', chapter: 1, verse: 2 },
    ])
    expect(r).toEqual([
      { bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 2 }] },
      { bookId: 'GEN', chapter: 2, spans: [{ s: 4, e: 4 }] },
    ])
  })

  it('dedupes repeated verses', () => {
    const r = selectionToRanges([
      { bookId: 'PSA', chapter: 23, verse: 1 },
      { bookId: 'PSA', chapter: 23, verse: 1 },
    ])
    expect(r).toEqual([{ bookId: 'PSA', chapter: 23, spans: [{ s: 1, e: 1 }] }])
  })
})

describe('chapterRanges', () => {
  it('marks the whole chapter', () => {
    expect(chapterRanges('DEU', 32)).toEqual([{ bookId: 'DEU', chapter: 32, whole: true }])
  })
})

describe('rangesLabel', () => {
  it('renders verse spans as "Book ch:1-4,6"', () => {
    expect(rangesLabel([{ bookId: 'DEU', chapter: 32, spans: [{ s: 3, e: 4 }, { s: 6, e: 6 }] }]))
      .toBe('Deuteronomy 32:3-4,6')
  })

  it('renders a whole-chapter range as "Book ch (chapter)"', () => {
    expect(rangesLabel([{ bookId: 'DEU', chapter: 32, whole: true }])).toBe('Deuteronomy 32 (chapter)')
  })

  it('joins cross-chapter ranges with "; "', () => {
    expect(rangesLabel([
      { bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 3 }] },
      { bookId: 'GEN', chapter: 2, spans: [{ s: 4, e: 4 }] },
    ])).toBe('Genesis 1:1-3; Genesis 2:4')
  })
})

describe('parseVerseSpans', () => {
  it('parses a single verse', () => {
    expect(parseVerseSpans('6')).toEqual([{ s: 6, e: 6 }])
  })
  it('parses mixed singles and ranges, sorting and merging', () => {
    expect(parseVerseSpans('6, 3-4 , 5')).toEqual([{ s: 3, e: 6 }])
    expect(parseVerseSpans('12,3-4,6')).toEqual([{ s: 3, e: 4 }, { s: 6, e: 6 }, { s: 12, e: 12 }])
  })
  it('accepts an en-dash range and flips reversed bounds', () => {
    expect(parseVerseSpans('9–7')).toEqual([{ s: 7, e: 9 }])
  })
  it('rejects malformed / empty / out-of-range input', () => {
    expect(parseVerseSpans('')).toBeNull()
    expect(parseVerseSpans('  ')).toBeNull()
    expect(parseVerseSpans('abc')).toBeNull()
    expect(parseVerseSpans('3-')).toBeNull()
    expect(parseVerseSpans('0')).toBeNull()
    expect(parseVerseSpans('999')).toBeNull()
  })
})
