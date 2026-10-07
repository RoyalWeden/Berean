import { describe, it, expect } from 'vitest'
import { parseRef, getTranslationForBook, bookName, isStrongsRef, resolveBookToken, isExactBookToken, bookChapterVerseLabel, bookChapterHoverLabel, bookChapterLabel } from '../parseRef'
import { formatVerseRef } from '../verseClipboard'

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

  it('parses Recognitions of Clement "Book N" subdivision (3-level Book.Chapter.Verse addressing)', () => {
    expect(parseRef('Recognitions, Book 10 41:8')).toMatchObject({ bookId: 'RCL10', chapter: 41, verse: 8 })
    expect(parseRef('Recognitions Book 10 41:8')).toMatchObject({ bookId: 'RCL10', chapter: 41, verse: 8 })
    expect(parseRef('RCL10 41:8')).toMatchObject({ bookId: 'RCL10', chapter: 41, verse: 8 })
    expect(parseRef('Recognitions of Clement, Book 5 3:5')).toMatchObject({ bookId: 'RCL5', chapter: 3, verse: 5 })
    // "Book N" subdivision doesn't apply to editions without a numbered-book convention
    expect(parseRef('Hermas, Book 3 5:2')).toBeNull()
    // The literal "Chapter" word bookChapterVerseLabel now generates for "Book N" editions
    // (see below) must parse back too — same round-trip requirement as the comma fix above.
    expect(parseRef('Recognitions of Clement, Book 9, Chapter 2')).toMatchObject({ bookId: 'RCL9', chapter: 2 })
    expect(parseRef('Recognitions of Clement, Book 9, Chapter 2:5')).toMatchObject({ bookId: 'RCL9', chapter: 2, verse: 5 })
  })

  // Recognitions of Clement has no "book 1 by default" — it is genuinely addressed
  // Book.Chapter[.Verse], so a BARE work-name token (no "Book N" phrase, and no book
  // number baked into the token itself, e.g. "RCL4") followed by a number must name the
  // BOOK, not silently default to Book 1 and treat that number as ITS chapter. This was a
  // real reported bug: "Recognitions 4:35" resolved to Book 1, chapter 4, verse 35 instead
  // of Book 4, chapter 35.
  it('treats the first number after a bare Recognitions-of-Clement token as the BOOK, not the chapter', () => {
    expect(parseRef('Recognitions 4:35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('Recognitions 4 35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('Recognitions of Clement 4:35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('Recognitions of Clement, Book 4, 35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('Recognitions of Clement, Book 4, 35:1')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: 1 })
    expect(parseRef('Recognitions Book 4 Chapter 35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('RCL 4:35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('RCL4 35:1')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: 1 })
    expect(parseRef('Rec. Clem. IV 35')).toMatchObject({ bookId: 'RCL4', chapter: 35, verse: undefined })
    expect(parseRef('RCL 4 25:1')).toMatchObject({ bookId: 'RCL4', chapter: 25, verse: 1 })
    // Explicit book id / "Book N" phrase forms are unaffected (still their own book, own chapter)
    expect(parseRef('RCL2 5:1')).toMatchObject({ bookId: 'RCL2', chapter: 5, verse: 1 })
  })

  it('parses Hermas Vision/Mandate/Similitude section references (hermasMap.ts)', () => {
    // Vision 2's 3rd sub-chapter (db-chapters [5,6,7,8]) is db-chapter 7
    expect(parseRef('Hermas Vision 2 3:1')).toMatchObject({ bookId: 'HER_VIS', chapter: 7, verse: 1 })
    // Whole-section reference (no sub-chapter) → the section's first db-chapter
    expect(parseRef('Shepherd of Hermas, Mandate 4')).toMatchObject({ bookId: 'HER_MAN', chapter: 4 })
    expect(parseRef('Hermas Similitude 9')).toMatchObject({ bookId: 'HER_SIM', chapter: 29 })
    // The canonical display's own dot form round-trips
    expect(parseRef('Shepherd of Hermas, Vision 2.1:2')).toMatchObject({ bookId: 'HER_VIS', chapter: 5, verse: 2 })
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

  // Trailing " LXX" used to make parseRef return null outright, so every direct caller
  // (floating search, scripture search, history) simply failed to resolve the reference.
  it('parses a trailing LXX suffix and reports it as forcedTranslation', () => {
    expect(parseRef('Isaiah 66:3 LXX')).toMatchObject({ bookId: 'ISA', chapter: 66, verse: 3, forcedTranslation: 'LXX' })
    expect(parseRef('isaiah 66:3 lxx')).toMatchObject({ bookId: 'ISA', chapter: 66, verse: 3, forcedTranslation: 'LXX' })
    expect(parseRef('Gen 1 LXX')).toMatchObject({ bookId: 'GEN', chapter: 1, forcedTranslation: 'LXX' })
    expect(parseRef('Isa 53:1-5 LXX')).toMatchObject({ bookId: 'ISA', chapter: 53, verse: 1, endVerse: 5, forcedTranslation: 'LXX' })
    expect(parseRef('Hosea 13-14 LXX')).toMatchObject({ bookId: 'HOS', chapter: 13, endChapter: 14, forcedTranslation: 'LXX' })
    expect(parseRef('Isaiah 63:17-64:3 LXX')).toMatchObject({ bookId: 'ISA', chapter: 63, verse: 17, endChapter: 64, endVerse: 3, forcedTranslation: 'LXX' })
    // bare-space form
    expect(parseRef('psalm 95 1 lxx')).toMatchObject({ bookId: 'PSA', chapter: 95, verse: 1, forcedTranslation: 'LXX' })
  })

  it('only treats LXX as a suffix, not any trailing word', () => {
    expect(parseRef('Isaiah 66:3 KJV')).toBeNull()
    expect(parseRef('Isaiah 66:3 LXXX')).toBeNull()
  })

  it('parses "book chapter verse" with a bare space instead of ":"/"." ', () => {
    expect(parseRef('james 1 15')).toMatchObject({ bookId: 'JAS', chapter: 1, verse: 15 })
    expect(parseRef('gen 1 1')).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 1 })
    expect(parseRef('1 sam 2 3')).toMatchObject({ bookId: '1SA', chapter: 2, verse: 3 })
    expect(parseRef('song of solomon 1 1')).toMatchObject({ bookId: 'SNG', chapter: 1, verse: 1 })
  })

  it('bare-space chapter+verse never shadows the punctuated dash chapter-range form', () => {
    expect(parseRef('Hosea 13-14')).toMatchObject({ bookId: 'HOS', chapter: 13, endChapter: 14 })
  })

  it('rejects a bare-space "verse" form with an invalid book token', () => {
    expect(parseRef('nosuchbook 1 15')).toBeNull()
  })

  it('parses cross-chapter verse ranges ("Isaiah 63:17-64:3")', () => {
    expect(parseRef('Isaiah 63:17-64:3')).toMatchObject({ bookId: 'ISA', chapter: 63, verse: 17, endChapter: 64, endVerse: 3 })
    expect(parseRef('Rev 1:1-2:5')).toMatchObject({ bookId: 'REV', chapter: 1, verse: 1, endChapter: 2, endVerse: 5 })
  })

  it('still parses a same-chapter verse range, not confused with the cross-chapter form', () => {
    const r = parseRef('Isaiah 63:17-19')
    expect(r).toMatchObject({ bookId: 'ISA', chapter: 63, verse: 17, endVerse: 19 })
    expect(r?.endChapter).toBeUndefined()
  })

  it('still parses a bare chapter range, not confused with the cross-chapter verse form', () => {
    const r = parseRef('Hosea 13-14')
    expect(r).toMatchObject({ bookId: 'HOS', chapter: 13, endChapter: 14 })
    expect(r?.verse).toBeUndefined()
    expect(r?.endVerse).toBeUndefined()
  })

  it('rejects a cross-chapter range whose end chapter is out of the book\'s range', () => {
    expect(parseRef('Isaiah 65:1-99:3')).toBeNull()
  })

  it('parses period-abbreviated book tokens ("Isa.", "Gen.", "1 Cor.")', () => {
    expect(parseRef('Isa. 40:1')).toMatchObject({ bookId: 'ISA', chapter: 40, verse: 1 })
    expect(parseRef('Gen. 1:1')).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 1 })
    expect(parseRef('1 Cor. 13:4')).toMatchObject({ bookId: '1CO', chapter: 13, verse: 4 })
    // a period used as the chapter:verse separator (not a book abbreviation) still works
    expect(parseRef('Gen 1.1')).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 1 })
  })

  it('resolves "II"/"III" roman-numeral book prefixes to the correct arabic book, not the wrong one', () => {
    // Regression: these previously dropped the numeral entirely and fuzzy-matched
    // "Kings"/"John" alone, which is equidistant between 1/2 Kings and always resolved
    // to whichever sorts first (1 Kings) — silently wrong, not a failure to match.
    expect(parseRef('II Kings 5:1')).toMatchObject({ bookId: '2KI', chapter: 5, verse: 1 })
    expect(parseRef('III John 1:2')).toMatchObject({ bookId: '3JN', chapter: 1, verse: 2 })
    expect(parseRef('I Samuel 3:1')).toMatchObject({ bookId: '1SA', chapter: 3, verse: 1 })
  })

  // ── Comma-grouped verse lists ──────────────────────────────────────────────
  it('parses a comma list into verseGroups (range + single)', () => {
    const r = parseRef('Deuteronomy 32:3-4,6')
    expect(r).toMatchObject({ bookId: 'DEU', chapter: 32, verse: 3, endVerse: 4 })
    expect(r?.verseGroups).toEqual([{ verse: 3, endVerse: 4 }, { verse: 6 }])
  })

  it('parses a long comma list with mixed singles and ranges', () => {
    const r = parseRef('Deuteronomy 32:3,6,9-13,23,25')
    expect(r).toMatchObject({ bookId: 'DEU', chapter: 32, verse: 3 })
    expect(r?.verseGroups).toEqual([
      { verse: 3 }, { verse: 6 }, { verse: 9, endVerse: 13 }, { verse: 23 }, { verse: 25 },
    ])
  })

  it('leaves verseGroups undefined for a plain single ref', () => {
    expect(parseRef('Genesis 1:1')?.verseGroups).toBeUndefined()
    expect(parseRef('Isa 53:1-5')?.verseGroups).toBeUndefined()
  })

  it('rejects the whole ref when a comma group is out of range', () => {
    expect(parseRef('Deuteronomy 32:3,600')).toBeNull()
    expect(parseRef('Deuteronomy 32:3,6-400')).toBeNull()
  })

  it('a comma list still accepts a trailing LXX suffix', () => {
    const r = parseRef('Deuteronomy 32:3,6 LXX')
    expect(r).toMatchObject({ bookId: 'DEU', chapter: 32, verse: 3, forcedTranslation: 'LXX' })
    expect(r?.verseGroups).toEqual([{ verse: 3 }, { verse: 6 }])
  })

  it('stops the comma list at a ";" or a following word', () => {
    // ";" — parseRef only sees a single ref at a time, but the `$` anchor means the
    // trailing "; Genesis 1:1" makes the whole string fail rather than silently truncating.
    expect(parseRef('Deuteronomy 32:3,6; Genesis 1:1')).toBeNull()
    // a following ordinary word likewise breaks the strict full-string match
    expect(parseRef('Deuteronomy 32:3,6 and then')).toBeNull()
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
    // Was 'Shepherd of Hermas' — a duplicate BOOK_MAP entry for the same id (added
    // only so bare "her"/"hermas" would also resolve to HER_VIS) redefined `name`
    // too, and since ID_TO_NAME is built with `.set(id, name)` in array order, the
    // later duplicate silently overwrote the correct, more specific name via
    // Map last-write-wins. Fixed by merging those patterns into this entry instead
    // of a second object — see parseRef.ts's BOOK_MAP comment.
    // Comma (not dash) — a literal " - " in the name broke note auto-linking, since
    // the reference regexes don't allow a dash inside the book-name phrase.
    expect(bookName('HER_VIS')).toBe('Hermas, Visions')
    expect(bookName('TREU')).toBe('Testament of Reuben')
  })

  it('falls back to the ID for unknown books', () => {
    expect(bookName('UNKNOWN')).toBe('UNKNOWN')
  })
})

describe('bookChapterVerseLabel', () => {
  it('spells out the full work name as "Work, Book N, ch:v" (TEST 2026-09-29)', () => {
    // Was "Recognitions, Book 9, 2" — ambiguous about what "2" even is. Per feedback, the
    // full work name plus an explicit "Chapter" reads unambiguously everywhere this citation
    // format shows up (Study Trail map labels included).
    expect(bookChapterVerseLabel('RCL9', 2)).toBe('Recognitions of Clement, Book 9, Chapter 2')
    expect(bookChapterVerseLabel('RCL9', 2, 5)).toBe('Recognitions of Clement, Book 9, 2:5')
  })

  it('is unaffected for ordinary books', () => {
    expect(bookChapterVerseLabel('GEN', 1, 1)).toBe('Genesis 1:1')
  })

  // Hermas's flat db-chapter (5) is meaningless to a reader — the canonical display uses
  // hermasMap.ts's own Vision/Mandate/Similitude.sub-chapter numbering instead (db-chapter 5
  // is Vision 2's 1st sub-chapter).
  it('uses hermasMap.ts section numbering for Hermas books, not the raw db-chapter', () => {
    expect(bookChapterVerseLabel('HER_VIS', 5, 2)).toBe('Shepherd of Hermas, Vision 2.1:2')
    // Mandate 1 is a single-db-chapter section, so the sub-chapter index is omitted
    expect(bookChapterVerseLabel('HER_MAN', 1)).toBe('Shepherd of Hermas, Mandate 1')
  })
})

// ─── resolveBookToken (fuzzy misspelling fallback) ────────────────────────────

describe('resolveBookToken misspelling fallback', () => {
  it('resolves common misspellings via edit-distance fallback', () => {
    expect(resolveBookToken('Genesys')).toBe('GEN')
    // Bare "Corinthans" (no numeral) is genuinely ambiguous between 1/2 Corinthians and
    // correctly does NOT resolve — the numeral is required, same as typing it correctly.
    expect(resolveBookToken('1 Corinthans')).toBe('1CO')
    expect(resolveBookToken('Deuteronmy')).toBe('DEU')
    expect(resolveBookToken('Philipians')).toBe('PHP')
    expect(resolveBookToken('Ecclesiates')).toBe('ECC')
    expect(resolveBookToken('Revelaton')).toBe('REV')
  })

  it('does not fuzzy-match short/ambiguous tokens', () => {
    // 3-char tokens stay below the fuzzy-match length floor — prefix matching
    // (already covers real 3-letter abbreviations) is safer here than fuzzy.
    expect(resolveBookToken('xyz')).toBe(null)
  })

  it('still resolves exact and prefix matches unaffected by the fuzzy addition', () => {
    expect(resolveBookToken('gen')).toBe('GEN')
    expect(resolveBookToken('john')).toBe('JHN')
    expect(resolveBookToken('revela')).toBe('REV')
  })
})

// ─── isExactBookToken ─────────────────────────────────────────────────────────
// resolveBookToken happily resolves short common words like "to" via its
// prefix-match tier ("to" prefixes "tob"/"tobit"), which is fine for parsing
// but too permissive to trust blindly when auto-linking free-typed note text
// (see AMBIGUOUS_PATTERNS / findVerseRefMatches / extractRefsFromNote's guard).
// isExactBookToken distinguishes "really is a listed abbreviation or full
// name" (tier 1) from "merely happens to prefix- or fuzzy-match one" (tier 2/3).
describe('isExactBookToken', () => {
  it('is false for words that only resolve via the prefix-match tier', () => {
    expect(resolveBookToken('to')).toBe('TOB') // confirms the tier-2 resolution exists
    expect(isExactBookToken('to')).toBe(false)
    expect(resolveBookToken('so')).toBe('SNG')
    expect(isExactBookToken('so')).toBe(false)
    expect(resolveBookToken('as')).toBe('AIS')
    expect(isExactBookToken('as')).toBe(false)
    expect(resolveBookToken('he')).toBe('HEB')
    expect(isExactBookToken('he')).toBe(false)
    expect(resolveBookToken('be')).toBe('BEL')
    expect(isExactBookToken('be')).toBe(false)
  })

  it('is true for literal patterns and full canonical names', () => {
    expect(isExactBookToken('tob')).toBe(true)
    expect(isExactBookToken('tobit')).toBe(true)
    expect(isExactBookToken('man')).toBe(true) // exact pattern for Prayer of Manasseh
    expect(isExactBookToken('gen')).toBe(true)
    expect(isExactBookToken('Genesis')).toBe(true)
    expect(isExactBookToken('song of songs')).toBe(true)
  })

  it('is false for fuzzy-only misspelling matches', () => {
    expect(resolveBookToken('Genesys')).toBe('GEN')
    expect(isExactBookToken('Genesys')).toBe(false)
  })
})

// ─── resolveBookToken (roman-numeral prefix) ──────────────────────────────────

describe('resolveBookToken roman-numeral prefix', () => {
  it('resolves "II"/"III" prefixes to the same book as their arabic equivalent', () => {
    expect(resolveBookToken('II Kings')).toBe(resolveBookToken('2 Kings'))
    expect(resolveBookToken('III John')).toBe(resolveBookToken('3 John'))
    expect(resolveBookToken('I Samuel')).toBe(resolveBookToken('1 Samuel'))
  })

  it('does not misfire on a single word merely starting with "i"', () => {
    // The lookahead requires the leading "I"/"II"/"III" to be its own whitespace-
    // terminated token, not just a prefix of a longer word — "isaiah" must still
    // resolve normally, not get its leading "i" stripped into "1saiah".
    expect(resolveBookToken('isaiah')).toBe('ISA')
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

// Recognitions Book III: stored 1..65, displayed/typed as ANF 1, 12..75 (chapterNumbering.ts, T23-035).
describe('parseRef — Recognitions Book 3 ANF chapter numbering', () => {
  it('maps typed ANF chapters to stored chapters', () => {
    expect(parseRef('RCL3 55:2')).toMatchObject({ bookId: 'RCL3', chapter: 45, verse: 2 })
    expect(parseRef('Recognitions, Book 3 12')).toMatchObject({ bookId: 'RCL3', chapter: 2 })
    expect(parseRef('Recognitions of Clement, Book 3, Chapter 75:1')).toMatchObject({ bookId: 'RCL3', chapter: 65, verse: 1 })
    expect(parseRef('rec clem 3 1:1')).toMatchObject({ bookId: 'RCL3', chapter: 1, verse: 1 })
  })
  it('rejects chapters omitted by Rufinus (2–11) and past the end', () => {
    expect(parseRef('RCL3 5:1')).toBeNull()
    expect(parseRef('RCL3 11')).toBeNull()
    expect(parseRef('RCL3 76')).toBeNull()
  })
  it('leaves other Recognitions books unchanged', () => {
    expect(parseRef('RCL2 5:1')).toMatchObject({ bookId: 'RCL2', chapter: 5, verse: 1 })
  })
  it('labels show ANF numbers and round-trip through parseRef', () => {
    const label = bookChapterVerseLabel('RCL3', 45, 2)
    expect(label).toBe('Recognitions of Clement, Book 3, 55:2')
    expect(parseRef(label)).toMatchObject({ bookId: 'RCL3', chapter: 45, verse: 2 })
    expect(bookChapterHoverLabel('RCL3', 2)).toBe('Recognitions of Clement 12, Book 3')
    expect(bookChapterLabel('RCL3', 1)).toBe('Recognitions, Book 3 1')
    expect(parseRef(formatVerseRef('RCL3', 45, 2))).toMatchObject({ bookId: 'RCL3', chapter: 45, verse: 2 })
  })
})

// ─── Round-trip: parse(display(ref)) deep-equals ref ─────────────────────────
// Every reference bookChapterVerseLabel (and formatVerseRef, which delegates to it — see
// verseClipboard.ts) can produce must parse back to the SAME {bookId, chapter, verse} —
// otherwise search-result titles, copy-verse output, and tab/history labels the app itself
// generates silently fail to round-trip through note auto-linking and the reference bar.
describe('parseRef — round-trip through bookChapterVerseLabel for representative books', () => {
  const cases: Array<[string, number, number?]> = [
    ['ENO', 6, 3],       // 1 Enoch
    ['JUB', 2, 1],       // Jubilees
    ['SIR', 3, 18],      // Sirach / Ecclesiasticus
    ['WIS', 5, 1],       // Wisdom of Solomon
    ['1MA', 2, 1],       // 1 Maccabees
    ['2MA', 7, 1],       // 2 Maccabees
    ['TOB', 1, 1],       // Tobit
    ['TJUD', 1, 1],      // Testament of Judah (T12P)
    ['EPB', 4, 1],       // Epistle of Barnabas
    ['1CL', 5, 1],       // 1 Clement
    ['DID', 7, 1],       // Didache
    ['2BA', 10, 1],      // 2 Baruch
    ['AIS', 3, 1],       // Ascension of Isaiah
  ]
  it.each(cases)('%s %i:%i', (bookId, chapter, verse) => {
    const label = bookChapterVerseLabel(bookId, chapter, verse)
    expect(parseRef(label)).toMatchObject({ bookId, chapter, verse })
  })

  it('round-trips several Recognitions of Clement books, including RCL3\'s custom numbering', () => {
    for (const [bookId, chapter, verse] of [['RCL1', 5, 1], ['RCL4', 35, 1], ['RCL3', 45, 2]] as const) {
      const label = bookChapterVerseLabel(bookId, chapter, verse)
      expect(parseRef(label)).toMatchObject({ bookId, chapter, verse })
    }
  })

  it('round-trips all three Hermas parts', () => {
    for (const [bookId, chapter, verse] of [
      ['HER_VIS', 5, 2],   // Vision 2.1
      ['HER_MAN', 1, 1],   // Mandate 1 (single-chapter section)
      ['HER_SIM', 45, 3],  // Similitude 9.17
    ] as const) {
      const label = bookChapterVerseLabel(bookId, chapter, verse)
      expect(parseRef(label)).toMatchObject({ bookId, chapter, verse })
    }
  })
})
