import { describe, it, expect } from 'vitest'
import {
  mapChapterOnTranslationSwitch, isLxxTranslation, isKjvTranslation,
} from '../translationChapterMap'

const k2l = (book: string, ch: number) => mapChapterOnTranslationSwitch(book, ch, 'kjva', 'lxx')
const l2k = (book: string, ch: number) => mapChapterOnTranslationSwitch(book, ch, 'lxx', 'kjva')

describe('translation tradition detection', () => {
  it('identifies LXX vs KJV translations', () => {
    expect(isLxxTranslation('lxx')).toBe(true)
    expect(isLxxTranslation('LXX')).toBe(true)
    expect(isKjvTranslation('kjva')).toBe(true)
    expect(isKjvTranslation('kjv')).toBe(true)
    expect(isLxxTranslation('kjva')).toBe(false)
    expect(isKjvTranslation('lxx')).toBe(false)
  })
})

describe('no-op cases', () => {
  it('same tradition → unchanged', () => {
    expect(mapChapterOnTranslationSwitch('JER', 30, 'kjva', 'kjv')).toBe(30)
    expect(mapChapterOnTranslationSwitch('PSA', 50, 'kjv', 'kjva')).toBe(50)
    expect(mapChapterOnTranslationSwitch('JER', 30, 'lxx', 'lxx')).toBe(30)
  })
  it('books without remapping → unchanged', () => {
    expect(k2l('GEN', 5)).toBe(5)
    expect(k2l('ISA', 53)).toBe(53)
    expect(l2k('MAT', 1)).toBe(1)
  })
})

describe('Jeremiah KJV → LXX', () => {
  it('first 25 chapters are the same', () => {
    for (const ch of [1, 10, 25]) expect(k2l('JER', ch)).toBe(ch)
  })
  it('reordered second half maps correctly', () => {
    expect(k2l('JER', 26)).toBe(33)
    expect(k2l('JER', 32)).toBe(39)
    expect(k2l('JER', 44)).toBe(51)
    expect(k2l('JER', 46)).toBe(26)
    expect(k2l('JER', 47)).toBe(29)
    expect(k2l('JER', 48)).toBe(31)
    expect(k2l('JER', 49)).toBe(30)
    expect(k2l('JER', 50)).toBe(27)
    expect(k2l('JER', 51)).toBe(28)
  })
  it('chapter 52 is the same', () => {
    expect(k2l('JER', 52)).toBe(52)
  })
  it('is case-insensitive on bookId', () => {
    expect(mapChapterOnTranslationSwitch('jer', 26, 'kjva', 'lxx')).toBe(33)
  })
})

describe('Jeremiah LXX → KJV (round-trip where unambiguous)', () => {
  it('reordered chapters map back', () => {
    expect(l2k('JER', 33)).toBe(26)
    expect(l2k('JER', 39)).toBe(32)
    expect(l2k('JER', 26)).toBe(46)
    expect(l2k('JER', 29)).toBe(47)
    expect(l2k('JER', 31)).toBe(48)
    expect(l2k('JER', 30)).toBe(49)
    expect(l2k('JER', 27)).toBe(50)
    expect(l2k('JER', 28)).toBe(51)
  })
  it('round-trips for the non-duplicated chapters', () => {
    for (const ch of [26, 27, 28, 29, 30, 31, 32, 40, 44, 50]) {
      expect(l2k('JER', k2l('JER', ch))).toBe(ch)
    }
  })
})

describe('Psalms KJV → LXX', () => {
  it('1–8 are the same', () => {
    for (const ch of [1, 5, 8]) expect(k2l('PSA', ch)).toBe(ch)
  })
  it('KJV 9 & 10 merge into LXX 9', () => {
    expect(k2l('PSA', 9)).toBe(9)
    expect(k2l('PSA', 10)).toBe(9)
  })
  it('KJV 11–113 → LXX 10–112 (offset -1)', () => {
    expect(k2l('PSA', 11)).toBe(10)
    expect(k2l('PSA', 23)).toBe(22) // the shepherd psalm
    expect(k2l('PSA', 113)).toBe(112)
  })
  it('KJV 114 & 115 merge into LXX 113', () => {
    expect(k2l('PSA', 114)).toBe(113)
    expect(k2l('PSA', 115)).toBe(113)
  })
  it('split region maps to first part', () => {
    expect(k2l('PSA', 116)).toBe(114)
    expect(k2l('PSA', 117)).toBe(116)
    expect(k2l('PSA', 118)).toBe(117)
  })
  it('KJV 119–146 → LXX 118–145', () => {
    expect(k2l('PSA', 119)).toBe(118)
    expect(k2l('PSA', 146)).toBe(145)
  })
  it('KJV 147 → LXX 146; 148–150 unchanged', () => {
    expect(k2l('PSA', 147)).toBe(146)
    expect(k2l('PSA', 148)).toBe(148)
    expect(k2l('PSA', 150)).toBe(150)
  })
})

describe('Psalms LXX → KJV', () => {
  it('1–8 same; LXX 9 → KJV 9', () => {
    expect(l2k('PSA', 8)).toBe(8)
    expect(l2k('PSA', 9)).toBe(9)
  })
  it('LXX 10–112 → KJV 11–113', () => {
    expect(l2k('PSA', 10)).toBe(11)
    expect(l2k('PSA', 22)).toBe(23)
    expect(l2k('PSA', 112)).toBe(113)
  })
  it('LXX 148–150 unchanged; 151 stays 151 (LXX-only)', () => {
    expect(l2k('PSA', 148)).toBe(148)
    expect(l2k('PSA', 151)).toBe(151)
  })
})

describe('Joel KJV ↔ LXX (KJV 3 ch / LXX 4 ch — split at 2:28)', () => {
  it('KJV → LXX', () => {
    expect(k2l('JOL', 1)).toBe(1)
    expect(k2l('JOL', 2)).toBe(2)
    expect(k2l('JOL', 3)).toBe(4)
  })
  it('LXX → KJV', () => {
    expect(l2k('JOL', 1)).toBe(1)
    expect(l2k('JOL', 2)).toBe(2)
    expect(l2k('JOL', 3)).toBe(2) // LXX 3 = KJV 2:28-32
    expect(l2k('JOL', 4)).toBe(3)
  })
})

describe('Malachi KJV ↔ LXX (KJV 4 ch / LXX 3 ch — KJV 4 = LXX 3)', () => {
  it('KJV → LXX', () => {
    expect(k2l('MAL', 1)).toBe(1)
    expect(k2l('MAL', 2)).toBe(2)
    expect(k2l('MAL', 3)).toBe(3)
    expect(k2l('MAL', 4)).toBe(3)
  })
  it('LXX → KJV', () => {
    expect(l2k('MAL', 1)).toBe(1)
    expect(l2k('MAL', 2)).toBe(2)
    expect(l2k('MAL', 3)).toBe(3) // maps to first part (KJV 3)
  })
})

describe('books that are NOT reordered stay identity', () => {
  it('Proverbs, Ezra(1-10), Genesis, Isaiah unchanged', () => {
    for (const ch of [1, 24, 25, 30, 31]) expect(k2l('PRO', ch)).toBe(ch)
    for (const ch of [1, 5, 10]) expect(k2l('EZR', ch)).toBe(ch)
    expect(k2l('GEN', 50)).toBe(50)
    expect(k2l('ISA', 53)).toBe(53)
    expect(l2k('HOS', 14)).toBe(14)
  })
})
