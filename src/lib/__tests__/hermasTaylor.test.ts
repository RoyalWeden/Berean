/**
 * Charles Taylor Shepherd-of-Hermas translation: section map, translation switching,
 * and registration. Taylor uses its own (finer) verse divisions and differs from
 * Roberts-Donaldson in several chapter boundaries — and, unlike the RD database,
 * includes Similitude 7.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  setHermasVariant, hermasVariantForTextId, getHermasSections, getHermasSection,
  getHermasValidChapters, getHermasValidChaptersFor, clampHermasChapter,
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

  it('includes Similitude 7 (absent from RD)', () => {
    setHermasVariant('taylor')
    const sim7 = getHermasSections('HER_SIM').find((s) => s.sectionNum === 7)
    expect(sim7).toBeTruthy()
    expect(sim7!.chapters).toEqual([17])
    // chapter 17 maps to Similitude 7 under Taylor, but Similitude 6 under RD
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

  it('does not mutate the RD map (default variant still has the gap + no Sim 7)', () => {
    setHermasVariant('rd')
    expect(getHermasValidChapters('HER_MAN')).toContain(24)
    expect(getHermasValidChapters('HER_MAN')).not.toContain(8)
    expect(getHermasSection('HER_SIM', 17)!.sectionName).toBe('Similitude 6')
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
