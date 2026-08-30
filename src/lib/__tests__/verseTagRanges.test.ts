import { describe, it, expect } from 'vitest'
import { selectionToRanges, chapterRanges, rangesLabel } from '../verseTagRanges'

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
