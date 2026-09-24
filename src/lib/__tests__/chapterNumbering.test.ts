import { describe, it, expect } from 'vitest'
import { displayChapter, storedChapter, hasCustomChapterNumbering, chapterNumberingNote } from '../chapterNumbering'

describe('chapterNumbering — RCL3 (ANF 1, 12..75)', () => {
  it('maps stored → display', () => {
    expect(displayChapter('RCL3', 1)).toBe(1)
    expect(displayChapter('RCL3', 2)).toBe(12)
    expect(displayChapter('RCL3', 45)).toBe(55)
    expect(displayChapter('RCL3', 65)).toBe(75)
  })
  it('maps display → stored', () => {
    expect(storedChapter('RCL3', 1)).toBe(1)
    expect(storedChapter('RCL3', 12)).toBe(2)
    expect(storedChapter('RCL3', 55)).toBe(45)
    expect(storedChapter('RCL3', 75)).toBe(65)
  })
  it('rejects omitted chapters 2–11 and chapters past the end', () => {
    for (let c = 2; c <= 11; c++) expect(storedChapter('RCL3', c)).toBeNull()
    expect(storedChapter('RCL3', 76)).toBeNull()
  })
  it('round-trips every stored chapter', () => {
    for (let c = 1; c <= 65; c++) expect(storedChapter('RCL3', displayChapter('RCL3', c))).toBe(c)
  })
  it('is identity for every other book', () => {
    for (const b of ['GEN', 'RCL1', 'RCL2', 'RCL4', 'RCL10', 'HER_SIM']) {
      expect(displayChapter(b, 7)).toBe(7)
      expect(storedChapter(b, 7)).toBe(7)
      expect(hasCustomChapterNumbering(b)).toBe(false)
      expect(chapterNumberingNote(b)).toBeNull()
    }
    expect(hasCustomChapterNumbering('RCL3')).toBe(true)
    expect(chapterNumberingNote('RCL3')).toMatch(/12/)
  })
})
