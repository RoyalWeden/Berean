import { describe, it, expect } from 'vitest'
import { verseRefDisplay } from '@/lib/parseRef'
import { filterNoteCrossRefs } from '@/lib/notesCrossRefs'
import type { Note } from '@/types'

describe('verseRefDisplay (SEP25 human-readable references)', () => {
  it('formats a stored dotted ref with the full book name', () => {
    expect(verseRefDisplay('DEU.29.3', 'kjva')).toBe('Deuteronomy 29:3')
  })
  it('appends LXX only for the Septuagint', () => {
    expect(verseRefDisplay('DEU.29.3', 'lxx')).toBe('Deuteronomy 29:3 LXX')
    expect(verseRefDisplay('DEU.29.3', 'KJVA')).toBe('Deuteronomy 29:3')
    expect(verseRefDisplay('DEU.29.3')).toBe('Deuteronomy 29:3')
  })
  it('keeps ranges and comma lists', () => {
    expect(verseRefDisplay('DEU.29.3-5', 'kjva')).toBe('Deuteronomy 29:3-5')
    expect(verseRefDisplay('GEN.1.1,GEN.1.3')).toBe('Genesis 1:1, Genesis 1:3')
  })
  it('handles chapter refs and unknown shapes', () => {
    expect(verseRefDisplay('PSA.23')).toBe('Psalms 23')
    expect(verseRefDisplay('')).toBe('')
    expect(verseRefDisplay('not a ref')).toBe('not a ref')
  })
})

describe('filterNoteCrossRefs (selected-verse filter)', () => {
  const note = { id: 'x', title: 'Sabbath' } as Note
  const data = {
    byVerse: [
      { verseNum: 3, refs: [{ bookId: 'EXO', chapter: 20, verse: 8, sourceNoteTitle: 'a', context: '' }] },
      { verseNum: 9, refs: [{ bookId: 'ISA', chapter: 58, verse: 13, sourceNoteTitle: 'b', context: '' }] },
    ],
    indirect: [{ note, verses: [9] }],
  }
  it('keeps everything when no verse is selected', () => {
    expect(filterNoteCrossRefs(data, [])).toBe(data)
  })
  it('keeps only the selected verses (one or several)', () => {
    expect(filterNoteCrossRefs(data, [3]).byVerse.map((v) => v.verseNum)).toEqual([3])
    expect(filterNoteCrossRefs(data, [3]).indirect).toHaveLength(0)
    const both = filterNoteCrossRefs(data, [3, 9])
    expect(both.byVerse.map((v) => v.verseNum)).toEqual([3, 9])
    expect(both.indirect).toHaveLength(1)
  })
})
