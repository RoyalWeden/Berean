/**
 * Charles Taylor Shepherd-of-Hermas translation: section map, translation switching,
 * and registration. Taylor uses its own (finer) verse divisions and its own flat DB
 * chapter numbering, which differs from Roberts-Donaldson at the Mandate boundaries —
 * most notably, Taylor's HER_MAN has no gap at db-chapter 8 (RD's does).
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  setHermasVariant, hermasVariantForTextId, getHermasSections, getHermasSection,
  getHermasValidChapters, getHermasValidChaptersFor, clampHermasChapter,
  getHermasNextChapter, getHermasPrevChapter, getHermasShortLabel, hermasAwareChapterLabel,
} from '../hermasMap'
import { getTranslationForBook, setHermasTextId, getHermasTextId, isDedicatedTranslation } from '../parseRef'
import { TRANSLATIONS, ANNOTATION_KEYS } from '../bibleTexts'

// Always leave global module state on the default after each test.
afterEach(() => { setHermasVariant('rd'); setHermasTextId('hermas') })

describe('hermasVariantForTextId', () => {
  it('maps the Taylor textId to the taylor variant, everything else to rd', () => {
    expect(hermasVariantForTextId('hermas_taylor')).toBe('taylor')
    expect(hermasVariantForTextId('hermas')).toBe('rd')
    expect(hermasVariantForTextId(undefined)).toBe('rd')
  })
})

describe('Taylor section map', () => {
  it('HER_MAN is contiguous 1–24 (no RD gap at chapter 9)', () => {
    setHermasVariant('taylor')
    expect(getHermasValidChapters('HER_MAN')).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
  })

  it('includes Similitude 7, matching RD', () => {
    setHermasVariant('taylor')
    const sim7 = getHermasSections('HER_SIM').find((s) => s.sectionNum === 7)
    expect(sim7).toBeTruthy()
    expect(sim7!.chapters).toEqual([17])
    // chapter 17 maps to Similitude 7 under both Taylor and RD
    expect(getHermasSection('HER_SIM', 17)!.sectionName).toBe('Similitude 7')
  })

  it('Mandate 3 is a single undivided chapter in Taylor', () => {
    setHermasVariant('taylor')
    const man3 = getHermasSections('HER_MAN').find((s) => s.sectionNum === 3)
    expect(man3!.chapters).toEqual([3])
  })

  it('every Taylor section chapter is unique and covers HER_SIM 1–65', () => {
    setHermasVariant('taylor')
    const sim = getHermasValidChapters('HER_SIM')
    expect(sim).toEqual(Array.from({ length: 65 }, (_, i) => i + 1))
    expect(new Set(sim).size).toBe(sim.length)
  })

  it('does not mutate the RD map (default variant still has the Mandate gap)', () => {
    setHermasVariant('rd')
    expect(getHermasValidChapters('HER_MAN')).toContain(24)
    expect(getHermasValidChapters('HER_MAN')).not.toContain(8)
    expect(getHermasSection('HER_SIM', 17)!.sectionName).toBe('Similitude 7')
  })
})

describe('getHermasValidChaptersFor (variant-independent of active state)', () => {
  it('returns each variant\'s chapters regardless of the active variant', () => {
    setHermasVariant('rd')
    expect(getHermasValidChaptersFor('HER_MAN', 'taylor')).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    expect(getHermasValidChaptersFor('HER_MAN', 'rd')).toContain(24)
  })
})

describe('clampHermasChapter (used when switching translations)', () => {
  it('keeps a chapter that is valid in the target', () => {
    expect(clampHermasChapter('HER_VIS', 12, 'taylor')).toBe(12)
    expect(clampHermasChapter('HER_SIM', 40, 'rd')).toBe(40)
  })
  it('snaps a Taylor-valid chapter that falls in the RD gap (chapter 8) to the nearest valid RD chapter', () => {
    expect(clampHermasChapter('HER_MAN', 8, 'rd')).not.toBe(8)
    expect([7, 9]).toContain(clampHermasChapter('HER_MAN', 8, 'rd'))
  })
})

describe('getTranslationForBook honors the Hermas translation preference', () => {
  it('returns the selected Hermas textId for all three Hermas books', () => {
    setHermasTextId('hermas_taylor')
    expect(getHermasTextId()).toBe('hermas_taylor')
    for (const b of ['HER_VIS', 'HER_MAN', 'HER_SIM']) {
      expect(getTranslationForBook(b)).toBe('hermas_taylor')
    }
    setHermasTextId('hermas')
    expect(getTranslationForBook('HER_VIS')).toBe('hermas')
  })
  it('leaves non-Hermas dedicated books unaffected', () => {
    setHermasTextId('hermas_taylor')
    expect(getTranslationForBook('ENO')).toBe('enoch')
    expect(getTranslationForBook('GEN')).toBeNull()
  })
})

// Reported bug: BiblePanel.tsx's next/prev chapter navigation (and its tab-title/
// presenter-view chapter labeling) used to read the AMBIENT `activeVariant` global
// only, ignoring which translation the tab whose button was actually clicked was
// showing. With two Hermas tabs open on different translations (or after changing
// the global Settings preference), navigating in one tab could silently use the
// OTHER translation's chapter structure — RD and Taylor have different db-chapter
// boundaries for the same book id, so "next chapter" could land on the wrong
// chapter, and the label shown (tab title / presenter view header) could describe
// the wrong Vision/Mandate/Similitude number. Fixed by making every one of these
// functions accept an explicit `variant` argument that overrides the global,
// mirroring `getHermasValidChaptersFor`'s existing (already correct) pattern.
describe('explicit variant argument is honored regardless of the ambient global (the reported nav/label bug)', () => {
  it('getHermasNextChapter/getHermasPrevChapter use the PASSED variant, not the active global', () => {
    setHermasVariant('rd') // ambient global says RD
    // Explicitly asking for 'taylor' must skip the RD-only gap at chapter 8 —
    // Taylor is contiguous, so next(7) should be 8, not RD's 9.
    expect(getHermasNextChapter('HER_MAN', 7, 'taylor')).toBe(8)
    expect(getHermasPrevChapter('HER_MAN', 8, 'taylor')).toBe(7)
    // And explicitly asking for 'rd' still gets RD's real gap-skipping behavior,
    // even with the ambient global left at its default.
    expect(getHermasNextChapter('HER_MAN', 7, 'rd')).toBe(9)
  })

  it('getHermasNextChapter/getHermasPrevChapter still fall back to the ambient global when no variant is passed (back-compat)', () => {
    setHermasVariant('taylor')
    expect(getHermasNextChapter('HER_MAN', 7)).toBe(8) // Taylor: contiguous
    setHermasVariant('rd')
    expect(getHermasNextChapter('HER_MAN', 7)).toBe(9) // RD: skips the gap at 8
  })

  it('getHermasShortLabel with an explicit variant differs from the ambient global when they disagree', () => {
    setHermasVariant('rd')
    // Same book+chapter, but under Taylor's different section boundaries — since
    // Taylor's Mandate structure is contiguous, chapter 8 falls in a DIFFERENT
    // Mandate/sub-index under 'taylor' than whatever RD (the active global) would say.
    const taylorLabel = getHermasShortLabel('HER_MAN', 8, 'taylor')
    const rdAmbientLabel = getHermasShortLabel('HER_MAN', 8) // uses ambient 'rd' global
    expect(taylorLabel).not.toBe(rdAmbientLabel)
  })

  it('hermasAwareChapterLabel resolves the Hermas section label using textId, not a generic label', () => {
    expect(hermasAwareChapterLabel('HER_MAN', 10, 'hermas')).toBe('Hermas Man. 5.2')
    expect(hermasAwareChapterLabel('HER_MAN', 10, 'hermas_taylor')).not.toBe('Hermas Man. 5.2')
    // Non-Hermas books still get the plain generic label.
    expect(hermasAwareChapterLabel('GEN', 1)).toBe('Genesis 1')
  })
})

describe('Taylor translation registration', () => {
  it('appears in the TRANSLATIONS list', () => {
    expect(TRANSLATIONS.find((t) => t.id === 'hermas_taylor')).toBeTruthy()
  })
  it('is recognized as a dedicated (non-canonical) translation', () => {
    expect(isDedicatedTranslation('hermas_taylor')).toBe(true)
    expect(isDedicatedTranslation('HERMAS_TAYLOR')).toBe(true)
  })
  it('has annotation-key metadata', () => {
    expect(ANNOTATION_KEYS.hermas_taylor).toBeTruthy()
  })
})
