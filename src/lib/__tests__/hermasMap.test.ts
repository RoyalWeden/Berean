/**
 * Shepherd of Hermas section-map suite. Locks the flat DB chapter numbers to the correct
 * Vision/Mandate/Similitude labels (verified against the text) and guards internal
 * consistency (every DB chapter mapped exactly once, no gaps/overlaps).
 */
import { describe, it, expect } from 'vitest'
import {
  getHermasSections, getHermasSection, getHermasChapterLabel, getHermasShortLabel,
  getHermasValidChapters, getHermasNextChapter, getHermasPrevChapter, isHermasBook,
} from '../hermasMap'

// The exact chapter numbers present in hermas.db (verified by querying the DB).
const DB_CHAPTERS = {
  HER_VIS: Array.from({ length: 25 }, (_, i) => i + 1),                       // 1–25
  HER_MAN: [...Array.from({ length: 7 }, (_, i) => i + 1), ...Array.from({ length: 16 }, (_, i) => i + 9)], // 1–7, 9–24
  HER_SIM: Array.from({ length: 65 }, (_, i) => i + 1),                       // 1–65
} as const

describe('Hermas map covers exactly the DB chapters', () => {
  for (const book of ['HER_VIS', 'HER_MAN', 'HER_SIM'] as const) {
    it(`${book}: every section chapter is a real DB chapter, with no duplicates`, () => {
      const valid = getHermasValidChapters(book)
      expect(valid).toEqual([...DB_CHAPTERS[book]].sort((a, b) => a - b))
      expect(new Set(valid).size).toBe(valid.length) // no chapter mapped twice
    })
    it(`${book}: every DB chapter resolves to a section`, () => {
      for (const ch of DB_CHAPTERS[book]) expect(getHermasSection(book, ch)).not.toBeNull()
    })
  }
})

describe('Hermas section numbering', () => {
  it('has 5 Visions, 12 Mandates, 10 Similitudes', () => {
    expect(getHermasSections('HER_VIS').map(s => s.sectionNum)).toEqual([1, 2, 3, 4, 5])
    expect(getHermasSections('HER_MAN').map(s => s.sectionNum)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(getHermasSections('HER_SIM').map(s => s.sectionNum)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('Mandate boundaries (verified against the text)', () => {
  const label = (ch: number) => getHermasSection('HER_MAN', ch)?.sectionName
  it('Mandate 3 = ch 3 (single chapter, previously mis-split across 3–4), Mandate 4 = ch 4–7', () => {
    expect(label(3)).toBe('Mandate 3')
    expect(label(4)).toBe('Mandate 4')
    expect(label(7)).toBe('Mandate 4')
  })
  it('Mandate 5 = ch 9–10 ("Be patient"), Mandate 6 = ch 11–12', () => {
    expect(label(9)).toBe('Mandate 5')
    expect(label(10)).toBe('Mandate 5')
    expect(label(11)).toBe('Mandate 6')
    expect(label(12)).toBe('Mandate 6')
  })
  it('Mandate 7 = ch 13, … Mandate 12 = ch 19–24', () => {
    expect(label(13)).toBe('Mandate 7')
    expect(label(14)).toBe('Mandate 8')
    expect(label(15)).toBe('Mandate 9')
    expect(label(16)).toBe('Mandate 10')
    expect(label(18)).toBe('Mandate 11')
    expect(label(19)).toBe('Mandate 12')
    expect(label(24)).toBe('Mandate 12')
  })
})

describe('labels & navigation', () => {
  it('Vision boundaries', () => {
    expect(getHermasSection('HER_VIS', 1)?.sectionName).toBe('Vision 1')
    expect(getHermasSection('HER_VIS', 9)?.sectionName).toBe('Vision 3')
    expect(getHermasSection('HER_VIS', 25)?.sectionName).toBe('Vision 5')
  })
  it('Similitude boundaries', () => {
    expect(getHermasSection('HER_SIM', 16)?.sectionName).toBe('Similitude 6')
    expect(getHermasSection('HER_SIM', 17)?.sectionName).toBe('Similitude 7')
    expect(getHermasSection('HER_SIM', 18)?.sectionName).toBe('Similitude 8')
    expect(getHermasSection('HER_SIM', 29)?.sectionName).toBe('Similitude 9')
    expect(getHermasSection('HER_SIM', 62)?.sectionName).toBe('Similitude 10')
  })
  it('single-chapter sections omit the sub-index; multi-chapter include it', () => {
    expect(getHermasChapterLabel('HER_VIS', 25)).toBe('Vision 5')      // 1 chapter
    expect(getHermasChapterLabel('HER_MAN', 9)).toBe('Mandate 5.1')    // first of [9,10]
    expect(getHermasChapterLabel('HER_MAN', 10)).toBe('Mandate 5.2')
    expect(getHermasShortLabel('HER_MAN', 10)).toBe('Man. 5.2')
  })
  it('next/prev skip the db gap at Mandate ch 8', () => {
    expect(getHermasNextChapter('HER_MAN', 7)).toBe(9)
    expect(getHermasPrevChapter('HER_MAN', 9)).toBe(7)
  })
  it('isHermasBook', () => {
    expect(isHermasBook('HER_MAN')).toBe(true)
    expect(isHermasBook('GEN')).toBe(false)
  })
})
