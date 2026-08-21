import { describe, it, expect } from 'vitest'
import {
  mapChapterOnTranslationSwitch, isLxxTranslation, isKjvTranslation,
  toCanonicalChapters, equivalentChapters, versificationNote, STRUCTURAL_NOTES,
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

describe('toCanonicalChapters (LXX chapter → KJV-keyed lookup chapters)', () => {
  it('non-Psalms books are always identity, regardless of textId', () => {
    expect(toCanonicalChapters('GEN', 1, 'lxx')).toEqual([1])
    expect(toCanonicalChapters('JER', 30, 'lxx')).toEqual([30])
    expect(toCanonicalChapters('JOL', 3, 'lxx')).toEqual([3])
  })
  it('Psalms viewed in KJV numbering is always identity', () => {
    for (const ch of [1, 9, 10, 100, 116, 147, 150]) {
      expect(toCanonicalChapters('PSA', ch, 'kjva')).toEqual([ch])
      expect(toCanonicalChapters('psa', ch, 'kjv')).toEqual([ch])
    }
  })
  it('Psalms viewed in LXX numbering: merge chapters union to both KJV chapters', () => {
    expect(toCanonicalChapters('PSA', 9, 'lxx')).toEqual([9, 10])
    expect(toCanonicalChapters('PSA', 113, 'lxx')).toEqual([114, 115])
  })
  it('Psalms viewed in LXX numbering: non-merge chapters map to a single KJV chapter', () => {
    expect(toCanonicalChapters('PSA', 1, 'lxx')).toEqual([1])
    expect(toCanonicalChapters('PSA', 8, 'lxx')).toEqual([8])
    expect(toCanonicalChapters('PSA', 10, 'lxx')).toEqual([11])
    expect(toCanonicalChapters('PSA', 114, 'lxx')).toEqual([116])
    expect(toCanonicalChapters('PSA', 115, 'lxx')).toEqual([116])
    expect(toCanonicalChapters('PSA', 146, 'lxx')).toEqual([147])
    expect(toCanonicalChapters('PSA', 147, 'lxx')).toEqual([147])
    expect(toCanonicalChapters('PSA', 150, 'lxx')).toEqual([150])
  })
  it('is case-insensitive on bookId/textId', () => {
    expect(toCanonicalChapters('psa', 9, 'LXX')).toEqual([9, 10])
  })
})

describe('equivalentChapters (bidirectional chapter mapping between two textIds)', () => {
  it('same-tradition pairs are always identity', () => {
    expect(equivalentChapters('PSA', 9, 'kjva', 'kjv')).toEqual([9])
    expect(equivalentChapters('PSA', 9, 'lxx', 'lxx')).toEqual([9])
  })
  it('non-Psalms books fall back to the single-value chapter-switch mapping', () => {
    expect(equivalentChapters('JER', 26, 'kjva', 'lxx')).toEqual([33])
    expect(equivalentChapters('JER', 33, 'lxx', 'kjva')).toEqual([26])
    expect(equivalentChapters('GEN', 5, 'kjva', 'lxx')).toEqual([5])
  })
  it('LXX → KJV matches toCanonicalChapters exactly', () => {
    for (const ch of [1, 9, 10, 100, 113, 116, 147, 150]) {
      expect(equivalentChapters('PSA', ch, 'lxx', 'kjva')).toEqual(toCanonicalChapters('PSA', ch, 'lxx'))
    }
  })
  it('KJV → LXX split chapters union to both LXX chapters', () => {
    expect(equivalentChapters('PSA', 116, 'kjva', 'lxx')).toEqual([114, 115])
    expect(equivalentChapters('PSA', 147, 'kjva', 'lxx')).toEqual([146, 147])
  })
  it('KJV → LXX merge chapters (9,10 / 114,115) map to the single merged LXX chapter', () => {
    expect(equivalentChapters('PSA', 9, 'kjva', 'lxx')).toEqual([9])
    expect(equivalentChapters('PSA', 10, 'kjva', 'lxx')).toEqual([9])
    expect(equivalentChapters('PSA', 114, 'kjva', 'lxx')).toEqual([113])
    expect(equivalentChapters('PSA', 115, 'kjva', 'lxx')).toEqual([113])
  })
  it('round-trips a KJV split chapter back to itself via either LXX half', () => {
    const lxxHalves = equivalentChapters('PSA', 116, 'kjva', 'lxx')
    for (const lxxCh of lxxHalves) {
      expect(equivalentChapters('PSA', lxxCh, 'lxx', 'kjva')).toEqual([116])
    }
  })
})

describe('versificationNote', () => {
  it('reports the original bug: LXX Psalm 10 is really MT/KJV Psalm 11', () => {
    // versificationNote itself doesn't restate the target chapter for a plain offset (that's
    // shown by the mapped chapter number in the UI, not repeated in the note) — but the
    // underlying mapping this note is built from must resolve correctly, which is the actual
    // bug: LXX Psalm 10 has to map to KJV 11, not display as if it were KJV Psalm 10.
    expect(mapChapterOnTranslationSwitch('PSA', 10, 'lxx', 'kjva')).toBe(11)
  })

  it('explains the Psalm 9/10 merge', () => {
    expect(versificationNote('PSA', 9, 'lxx')).toMatch(/combines.*Psalms 9 and 10/)
  })

  it('explains the Psalm 116 and 147 splits', () => {
    expect(versificationNote('PSA', 114, 'lxx')).toMatch(/Psalm 116/)
    expect(versificationNote('PSA', 115, 'lxx')).toMatch(/Psalm 116/)
    expect(versificationNote('PSA', 146, 'lxx')).toMatch(/Psalm 147/)
    expect(versificationNote('PSA', 147, 'lxx')).toMatch(/Psalm 147/)
  })

  it('explains Psalm 151 has no KJV counterpart', () => {
    expect(versificationNote('PSA', 151, 'lxx')).toMatch(/no Masoretic\/KJV counterpart/)
  })

  it('no note for an identity chapter (LXX Psalm 1)', () => {
    expect(versificationNote('PSA', 1, 'lxx')).toBeNull()
  })

  it('no note when not viewing LXX', () => {
    expect(versificationNote('PSA', 9, 'kjva')).toBeNull()
  })

  it('explains Joel and Malachi split chapters', () => {
    expect(versificationNote('JOL', 3, 'lxx')).toMatch(/Joel 2:28-32/)
    expect(versificationNote('MAL', 3, 'lxx')).toMatch(/Malachi 3.*Malachi 4/)
  })

  it('explains a reordered Jeremiah chapter, no note for an identity one', () => {
    expect(versificationNote('JER', 33, 'lxx')).toMatch(/Jeremiah 33.*Jeremiah 26/)
    expect(versificationNote('JER', 1, 'lxx')).toBeNull()
  })

  it('structural-note books get their note only when viewing LXX', () => {
    expect(versificationNote('EZR', 15, 'lxx')).toBe(STRUCTURAL_NOTES.EZR)
    expect(versificationNote('EZR', 15, 'kjva')).toBeNull()
  })

  it('no note for an unmapped book', () => {
    expect(versificationNote('GEN', 5, 'lxx')).toBeNull()
  })
})
