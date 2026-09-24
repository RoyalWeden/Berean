import { describe, it, expect } from 'vitest'
import { findInVerses } from '../reader/FindOnPage'

describe('Find on Page — whole book (SEP24-019)', () => {
  const verses = [
    { chapter: 1, verse_num: 1, text: 'In the beginning God created the heaven' },
    { chapter: 2, verse_num: 4, text: 'These are the generations of the heavens' },
    { chapter: 1, verse_num: 8, text: 'And God called the firmament Heaven' },
  ]
  it('finds matches in every chapter, in book order, case-insensitive', () => {
    expect(findInVerses(verses, 'heaven')).toEqual([{ chapter: 1, verse: 1 }, { chapter: 1, verse: 8 }, { chapter: 2, verse: 4 }])
  })
  it('several words must all appear', () => {
    expect(findInVerses(verses, 'god heaven')).toEqual([{ chapter: 1, verse: 1 }, { chapter: 1, verse: 8 }])
    expect(findInVerses(verses, '  ')).toEqual([])
  })
  it('matches the displayed text (word replacer)', () => {
    expect(findInVerses([{ chapter: 3, verse_num: 16, text: 'Jesus answered' }], 'yeshua', () => 'Yeshua answered')).toEqual([{ chapter: 3, verse: 16 }])
  })
})
