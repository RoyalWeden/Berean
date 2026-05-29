import { describe, it, expect } from 'vitest'
import { parseRef, getTranslationForBook, bookName, isStrongsRef } from '../parseRef'

// ─── parseRef ─────────────────────────────────────────────────────────────────

describe('parseRef', () => {
  it('parses a standard book + chapter ref', () => {
    expect(parseRef('Genesis 1')).toMatchObject({ bookId: 'GEN', chapter: 1 })
    expect(parseRef('Gen 1')).toMatchObject({ bookId: 'GEN', chapter: 1 })
    expect(parseRef('Ge 1')).toMatchObject({ bookId: 'GEN', chapter: 1 })
  })

  it('parses a verse ref', () => {
    expect(parseRef('Gen 1:1')).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 1 })
    expect(parseRef('Rev 22:21')).toMatchObject({ bookId: 'REV', chapter: 22, verse: 21 })
  })

  it('parses a verse range ref', () => {
    const r = parseRef('Isa 53:1-5')
    expect(r).toMatchObject({ bookId: 'ISA', chapter: 53, verse: 1, endVerse: 5 })
  })

  it('parses numbered-prefix books', () => {
    expect(parseRef('1 Kings 3')).toMatchObject({ bookId: '1KI', chapter: 3 })
    expect(parseRef('2 Cor 5:17')).toMatchObject({ bookId: '2CO', chapter: 5, verse: 17 })
  })

  it('parses pseudepigrapha book IDs', () => {
    expect(parseRef('Hermas 1')).toMatchObject({ bookId: 'HER_VIS', chapter: 1 })
    expect(parseRef('Barnabas 3')).toMatchObject({ bookId: 'EPB', chapter: 3 })
    expect(parseRef('1 Enoch 6')).toMatchObject({ bookId: 'ENO', chapter: 6 })
    expect(parseRef('Jubilees 2')).toMatchObject({ bookId: 'JUB', chapter: 2 })
  })

  it('parses Testament of the Twelve Patriarchs books', () => {
    expect(parseRef('Testament of Reuben 1')).toMatchObject({ bookId: 'TREU', chapter: 1 })
    expect(parseRef('Testament of Levi 3')).toMatchObject({ bookId: 'TLEV', chapter: 3 })
  })

  it('parses refs without space between book and chapter (gen1:5 style)', () => {
    expect(parseRef('gen1:5')).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 5 })
    expect(parseRef('rev22:21')).toMatchObject({ bookId: 'REV', chapter: 22, verse: 21 })
    expect(parseRef('eph2:8')).toMatchObject({ bookId: 'EPH', chapter: 2, verse: 8 })
    expect(parseRef('ps119:1')).toMatchObject({ bookId: 'PSA', chapter: 119, verse: 1 })
    expect(parseRef('1co13:4')).toMatchObject({ bookId: '1CO', chapter: 13, verse: 4 })
  })

  it('parses refs with period separator (Gen 1.1)', () => {
    expect(parseRef('Gen 1.1')).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 1 })
  })

  it('returns null for invalid refs', () => {
    expect(parseRef('')).toBeNull()
    expect(parseRef('foobar')).toBeNull()
    expect(parseRef('Gen')).toBeNull() // no chapter
    expect(parseRef('123 456')).toBeNull()
  })

  it('does not set forcedTranslation itself', () => {
    const r = parseRef('Gen 1:1')
    expect(r?.forcedTranslation).toBeUndefined()
  })
})

// ─── getTranslationForBook ────────────────────────────────────────────────────

describe('getTranslationForBook', () => {
  it('returns null for canonical books (KJV/LXX)', () => {
    expect(getTranslationForBook('GEN')).toBeNull()
    expect(getTranslationForBook('REV')).toBeNull()
    expect(getTranslationForBook('PSA')).toBeNull()
    expect(getTranslationForBook('MAT')).toBeNull()
    expect(getTranslationForBook('TOB')).toBeNull() // apocrypha in KJVA
  })

  it('returns the correct translation for pseudepigrapha books', () => {
    expect(getTranslationForBook('ENO')).toBe('enoch')
    expect(getTranslationForBook('JUB')).toBe('jubilees')
    expect(getTranslationForBook('AEL')).toBe('apoc_elijah')
    expect(getTranslationForBook('RCL1')).toBe('recog_clement')
    expect(getTranslationForBook('HER_VIS')).toBe('hermas')
    expect(getTranslationForBook('AIS')).toBe('asc_isaiah')
    expect(getTranslationForBook('EPB')).toBe('ep_barnabas')
  })

  it('returns t12p for all Twelve Patriarch testaments', () => {
    const t12pBooks = ['TREU','TSIM','TLEV','TJUD','TISS','TZEB','TDAN','TNAP','TGAD','TASH','TJOS','TBEN']
    for (const id of t12pBooks) {
      expect(getTranslationForBook(id)).toBe('t12p')
    }
  })
})

// ─── Translation-override logic (mirrors handleVerseRefClick) ─────────────────

describe('translation override logic', () => {
  const defaultBibleTranslation = 'kjva'

  function resolveTranslation(
    forcedTranslation: string | undefined,
    bookId: string,
  ): string {
    return (
      forcedTranslation ??
      getTranslationForBook(bookId) ??
      defaultBibleTranslation
    ).toUpperCase()
  }

  it('plain canonical ref → defaults to KJVA', () => {
    // no forcedTranslation, no special book
    expect(resolveTranslation(undefined, 'GEN')).toBe('KJVA')
    expect(resolveTranslation(undefined, 'REV')).toBe('KJVA')
    expect(resolveTranslation(undefined, 'PSA')).toBe('KJVA')
  })

  it('LXX-suffixed ref → LXX', () => {
    expect(resolveTranslation('LXX', 'GEN')).toBe('LXX')
    expect(resolveTranslation('LXX', 'PSA')).toBe('LXX')
  })

  it('special book ref without forcedTranslation → book-specific translation', () => {
    expect(resolveTranslation(undefined, 'HER_VIS')).toBe('HERMAS')
    expect(resolveTranslation(undefined, 'ENO')).toBe('ENOCH')
    expect(resolveTranslation(undefined, 'JUB')).toBe('JUBILEES')
    expect(resolveTranslation(undefined, 'TREU')).toBe('T12P')
    expect(resolveTranslation(undefined, 'EPB')).toBe('EP_BARNABAS')
  })

  it('forcedTranslation wins even for special books', () => {
    // edge case: LXX forced on a book that also has a BOOK_TRANSLATION mapping
    expect(resolveTranslation('LXX', 'HER_VIS')).toBe('LXX')
  })

  it('switching from LXX to plain ref → KJVA (bug regression)', () => {
    // Simulates user clicking "Gen 1:1" (no LXX suffix) while LXX is displayed.
    // The handler must force KJVA, not stay on LXX.
    const translation = resolveTranslation(undefined, 'GEN')
    expect(translation).toBe('KJVA')
    expect(translation).not.toBe('LXX')
  })
})

// ─── bookName ─────────────────────────────────────────────────────────────────

describe('bookName', () => {
  it('returns human-readable name for book IDs', () => {
    expect(bookName('GEN')).toBe('Genesis')
    expect(bookName('REV')).toBe('Revelation')
    expect(bookName('HER_VIS')).toBe('Shepherd of Hermas')
    expect(bookName('TREU')).toBe('Testament of Reuben')
  })

  it('falls back to the ID for unknown books', () => {
    expect(bookName('UNKNOWN')).toBe('UNKNOWN')
  })
})

// ─── isStrongsRef ─────────────────────────────────────────────────────────────

describe('isStrongsRef', () => {
  it('recognises Hebrew and Greek Strong\'s numbers', () => {
    expect(isStrongsRef('H7225')).toBe(true)
    expect(isStrongsRef('G3056')).toBe(true)
    expect(isStrongsRef('h7225')).toBe(true) // lowercase
    expect(isStrongsRef('g3056')).toBe(true)
  })

  it('rejects non-Strong\'s strings', () => {
    expect(isStrongsRef('Gen 1:1')).toBe(false)
    expect(isStrongsRef('H')).toBe(false)
    expect(isStrongsRef('X1234')).toBe(false)
  })
})
