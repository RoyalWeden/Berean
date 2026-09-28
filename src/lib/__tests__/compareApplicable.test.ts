/**
 * T23-022…T23-027: Compare is LXX ↔ KJVA only — which references it applies to, and the
 * counterpart chapter on the other side (versification-aware).
 */
import { describe, it, expect } from 'vitest'
import { compareApplicable, compareCounterpart, textChapterCount } from '@/lib/textCoverage'

describe('compareApplicable', () => {
  it('is true for an OT book both texts carry', () => {
    expect(compareApplicable('GEN', 1)).toBe(true)
    expect(compareApplicable('ISA', 53)).toBe(true)
    expect(compareApplicable('TOB', 1)).toBe(true)
  })
  it('is false for NT books', () => {
    expect(compareApplicable('JHN', 3)).toBe(false)
    expect(compareApplicable('REV', 1)).toBe(false)
    expect(compareApplicable('MAT', 5, 'kjv')).toBe(false)
  })
  it('is false for books only one of the two texts has', () => {
    expect(compareApplicable('3MA', 1, 'lxx')).toBe(false) // LXX-only
    expect(compareApplicable('LJE', 1, 'lxx')).toBe(false) // LXX-only (KJVA folds it into Baruch 6)
    expect(compareApplicable('EST', 1)).toBe(false)        // Hebrew Esther: KJVA only (LXX has ESG)
    expect(compareApplicable('2ES', 1)).toBe(false)        // 2 Esdras: KJVA only
  })
  it('is false for chapters with no counterpart / out of range', () => {
    expect(compareApplicable('PSA', 151, 'lxx')).toBe(false)
    expect(compareApplicable('BAR', 6)).toBe(false)
    expect(compareApplicable('EZR', 15, 'lxx')).toBe(false)
    expect(compareApplicable('GEN', 51)).toBe(false)
    expect(compareApplicable('GEN', 0)).toBe(false)
  })
  it('is false for texts outside the LXX/KJV pair', () => {
    expect(compareApplicable('GEN', 1, 'jubilees')).toBe(false)
  })
})

describe('compareCounterpart', () => {
  it('pairs KJV(A) with LXX and back at the same chapter', () => {
    expect(compareCounterpart('kjva', 'GEN', 1)).toEqual({ textId: 'lxx', chapter: 1 })
    expect(compareCounterpart('KJV', 'EXO', 20)).toEqual({ textId: 'lxx', chapter: 20 })
    expect(compareCounterpart('lxx', 'GEN', 1)).toEqual({ textId: 'kjva', chapter: 1 })
  })
  it('maps versification-shifted chapters (Psalms, Joel, Malachi, Jeremiah)', () => {
    expect(compareCounterpart('kjva', 'PSA', 23)).toEqual({ textId: 'lxx', chapter: 22 })
    expect(compareCounterpart('lxx', 'PSA', 22)).toEqual({ textId: 'kjva', chapter: 23 })
    expect(compareCounterpart('lxx', 'PSA', 9)).toEqual({ textId: 'kjva', chapter: 9 })
    expect(compareCounterpart('kjva', 'PSA', 10)).toEqual({ textId: 'lxx', chapter: 9 })
    expect(compareCounterpart('kjva', 'PSA', 150)).toEqual({ textId: 'lxx', chapter: 150 })
    expect(compareCounterpart('lxx', 'JOL', 4)).toEqual({ textId: 'kjva', chapter: 3 })
    expect(compareCounterpart('kjva', 'MAL', 4)).toEqual({ textId: 'lxx', chapter: 3 })
    expect(compareCounterpart('kjva', 'JER', 46)).toEqual({ textId: 'lxx', chapter: 26 })
  })
  it('returns null where there is no counterpart', () => {
    expect(compareCounterpart('kjva', 'JHN', 3)).toBeNull()
    expect(compareCounterpart('enoch', 'GEN', 1)).toBeNull()
    expect(compareCounterpart('lxx', 'PSA', 151)).toBeNull()
  })
})

describe('textChapterCount', () => {
  it('uses LXX chapter counts where they differ', () => {
    expect(textChapterCount('lxx', 'PSA')).toBe(151)
    expect(textChapterCount('kjva', 'PSA')).toBe(150)
    expect(textChapterCount('lxx', 'GEN')).toBe(50)
  })
})
