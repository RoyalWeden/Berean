/** SEP26-FIND-001…004 — the shared Scripture Find rule. */
import { describe, it, expect } from 'vitest'
import { verseMatchesFind, verseFindHaystack, haystackMatchesFind, countOccurrences, normalizeFindQuery } from '@/lib/scriptureFind'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { findInVerses } from '@/mobile/reader/FindOnPage'
import type { WordReplacerRule } from '@/store'

const rules: WordReplacerRule[] = [{ id: 'z', queries: ['zacharias'], replacement: 'Zechariah', wholeWord: false, enabled: true }]
const mat2335 = 'That upon you may come all the righteous blood shed upon the earth, from the blood of righteous Abel unto the blood of Zacharias son of Barachias, whom ye slew between the temple and the altar.'
const shown = applyWordReplacer(mat2335, rules)

describe('Scripture Find (shared rule)', () => {
  it('matches the DISPLAYED text — every prefix of "zechariah" keeps matching (the Matthew 23 bug)', () => {
    expect(shown).toContain('Zechariah')
    for (let i = 1; i <= 'zechariah'.length; i++) {
      expect(verseMatchesFind(mat2335, shown, 'zechariah'.slice(0, i))).toBe(true)
    }
    // Raw text alone would have failed from "ze" on — the old behaviour.
    expect(verseMatchesFind(mat2335, null, 'ze')).toBe(false)
  })
  it('still matches the raw text (a search for the original spelling works too)', () => {
    expect(verseMatchesFind(mat2335, shown, 'zacharias')).toBe(true)
  })
  it('is case-insensitive and never changes the text', () => {
    for (const q of ['zechariah', 'Zechariah', 'ZECHARIAH', 'ZeChArIaH']) expect(verseMatchesFind(mat2335, shown, q)).toBe(true)
    expect(shown).toContain('Zechariah')
    expect(normalizeFindQuery('  ZeCh ')).toBe('zech')
  })
  it('counts every occurrence, early and late', () => {
    expect(countOccurrences(shown, 'blood')).toBe(3)
    expect(countOccurrences(shown, 'ALTAR')).toBe(1)
    expect(countOccurrences(shown, 'that')).toBe(1)
  })
  it('word modes: phrase / all / any', () => {
    const h = verseFindHaystack(mat2335, shown)
    expect(haystackMatchesFind(h, 'righteous abel', 'phrase')).toBe(true)
    expect(haystackMatchesFind(h, 'abel altar', 'phrase')).toBe(false)
    expect(haystackMatchesFind(h, 'abel altar', 'all')).toBe(true)
    expect(haystackMatchesFind(h, 'abel moses', 'all')).toBe(false)
    expect(haystackMatchesFind(h, 'abel moses', 'any')).toBe(true)
    expect(haystackMatchesFind(h, '   ', 'any')).toBe(false)
  })
  it('book-wide Find on Page finds the replaced word in a later chapter, in order', () => {
    const verses = [
      { chapter: 22, verse_num: 1, text: 'And Jesus answered and spake unto them again by parables' },
      { chapter: 23, verse_num: 35, text: mat2335 },
      { chapter: 24, verse_num: 1, text: 'And Jesus went out, and departed from the temple' },
    ]
    const display = (v: { text: string }) => applyWordReplacer(v.text, rules)
    expect(findInVerses(verses, 'ZECHARIAH', display)).toEqual([{ chapter: 23, verse: 35 }])
    expect(findInVerses(verses, 'temple', display)).toEqual([{ chapter: 23, verse: 35 }, { chapter: 24, verse: 1 }])
  })
})
