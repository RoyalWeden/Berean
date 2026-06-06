/**
 * Floating-search correctness suite.
 *
 * Exercises the pure query-interpretation layer that decides what the floating
 * search bar shows: scripture reference parsing (incl. prefix matching like
 * "joh1" → John 1), Strong's detection, and keyword fallthrough. 200+ cases.
 */
import { describe, it, expect } from 'vitest'
import { parseRef, isStrongsRef, resolveBookToken } from '../parseRef'

// A query's "intent" mirrors FloatingSearch: a ref opens scripture, a Strong's
// number opens the lexicon, everything else (len ≥ 3) is a keyword search.
type Intent = 'ref' | 'strongs' | 'keyword' | 'too-short'
function intentOf(q: string): Intent {
  const t = q.trim()
  if (!t) return 'too-short'
  if (isStrongsRef(t)) return 'strongs'
  if (parseRef(t)) return 'ref'
  if (t.length < 3) return 'too-short'
  return 'keyword'
}

// ─── 1. Book resolution: exact canonical abbreviations ───────────────────────

const BOOK_CASES: Array<[string, string]> = [
  ['gen', 'GEN'], ['ge', 'GEN'], ['gn', 'GEN'], ['genesis', 'GEN'],
  ['exo', 'EXO'], ['ex', 'EXO'], ['exod', 'EXO'], ['exodus', 'EXO'],
  ['lev', 'LEV'], ['leviticus', 'LEV'],
  ['num', 'NUM'], ['numbers', 'NUM'],
  ['deu', 'DEU'], ['deut', 'DEU'], ['deuteronomy', 'DEU'],
  ['jos', 'JOS'], ['josh', 'JOS'], ['joshua', 'JOS'],
  ['jdg', 'JDG'], ['judges', 'JDG'],
  ['rut', 'RUT'], ['ruth', 'RUT'],
  ['psa', 'PSA'], ['ps', 'PSA'], ['psalm', 'PSA'], ['psalms', 'PSA'],
  ['pro', 'PRO'], ['prov', 'PRO'], ['proverbs', 'PRO'],
  ['isa', 'ISA'], ['is', 'ISA'], ['isaiah', 'ISA'],
  ['jer', 'JER'], ['jeremiah', 'JER'],
  ['ezk', 'EZK'], ['ezek', 'EZK'], ['ezekiel', 'EZK'],
  ['dan', 'DAN'], ['daniel', 'DAN'],
  ['mat', 'MAT'], ['matt', 'MAT'], ['matthew', 'MAT'],
  ['mrk', 'MRK'], ['mark', 'MRK'],
  ['luk', 'LUK'], ['luke', 'LUK'],
  ['jhn', 'JHN'], ['jn', 'JHN'], ['john', 'JHN'],
  ['act', 'ACT'], ['acts', 'ACT'],
  ['rom', 'ROM'], ['romans', 'ROM'],
  ['rev', 'REV'], ['revelation', 'REV'],
]

describe('resolveBookToken — exact patterns', () => {
  for (const [input, id] of BOOK_CASES) {
    it(`"${input}" → ${id}`, () => {
      expect(resolveBookToken(input)).toBe(id)
    })
  }
})

// ─── 2. Prefix matching (the "joh1" class of fixes) ──────────────────────────

const PREFIX_CASES: Array<[string, string]> = [
  ['joh', 'JHN'],      // the reported bug
  ['john', 'JHN'],
  ['matth', 'MAT'],
  ['matthe', 'MAT'],
  ['reve', 'REV'],
  ['revel', 'REV'],
  ['gene', 'GEN'],
  ['genes', 'GEN'],
  ['exod', 'EXO'],
  ['levi', 'LEV'],
  ['deute', 'DEU'],
  ['rom', 'ROM'],
  ['roma', 'ROM'],
  ['gala', 'GAL'],
  ['ephe', 'EPH'],
  ['phili', 'PHP'],    // Philippians (canonical before Philemon)
  ['colo', 'COL'],
  ['hebr', 'HEB'],
  ['jam', 'JAS'],
  ['jame', 'JAS'],
  ['titu', 'TIT'],
  ['jud', 'JUD'],      // "jud" is an exact Jude abbreviation → exact match wins
  ['jude', 'JUD'],     // exact pattern
  ['judg', 'JDG'],     // "judg" → Judges via prefix (no exact "judg" pattern)
  ['judge', 'JDG'],
]

describe('resolveBookToken — prefix matching', () => {
  for (const [input, id] of PREFIX_CASES) {
    it(`"${input}" → ${id}`, () => {
      expect(resolveBookToken(input)).toBe(id)
    })
  }
})

// ─── 3. parseRef: no-space forms must resolve (the core "joh1" report) ───────

const NOSPACE_CASES: Array<[string, { bookId: string; chapter: number; verse?: number }]> = [
  ['joh1', { bookId: 'JHN', chapter: 1 }],
  ['joh3', { bookId: 'JHN', chapter: 3 }],
  ['john3', { bookId: 'JHN', chapter: 3 }],
  ['gen1', { bookId: 'GEN', chapter: 1 }],
  ['gen50', { bookId: 'GEN', chapter: 50 }],
  ['rev22', { bookId: 'REV', chapter: 22 }],
  ['ps23', { bookId: 'PSA', chapter: 23 }],
  ['mat5', { bookId: 'MAT', chapter: 5 }],
  ['rom8', { bookId: 'ROM', chapter: 8 }],
  ['isa53', { bookId: 'ISA', chapter: 53 }],
  ['exo20', { bookId: 'EXO', chapter: 20 }],
]

describe('parseRef — no-space book+chapter', () => {
  for (const [input, expected] of NOSPACE_CASES) {
    it(`"${input}" → ${expected.bookId} ${expected.chapter}`, () => {
      expect(parseRef(input)).toMatchObject(expected)
    })
  }
})

// ─── 4. parseRef: chapter:verse + ranges, with and without spaces ────────────

describe('parseRef — verse + ranges', () => {
  const cases: Array<[string, object]> = [
    ['Gen 1:1', { bookId: 'GEN', chapter: 1, verse: 1 }],
    ['gen1:1', { bookId: 'GEN', chapter: 1, verse: 1 }],
    ['John 3:16', { bookId: 'JHN', chapter: 3, verse: 16 }],
    ['joh3:16', { bookId: 'JHN', chapter: 3, verse: 16 }],
    ['Isa 53:1-5', { bookId: 'ISA', chapter: 53, verse: 1, endVerse: 5 }],
    ['Ps 119:105', { bookId: 'PSA', chapter: 119, verse: 105 }],
    ['Rev 22:1-5', { bookId: 'REV', chapter: 22, verse: 1, endVerse: 5 }],
    ['1 Cor 13:4-7', { bookId: '1CO', chapter: 13, verse: 4, endVerse: 7 }],
    ['2cor5:17', { bookId: '2CO', chapter: 5, verse: 17 }],
    ['Gen 1.1', { bookId: 'GEN', chapter: 1, verse: 1 }],
    ['Hosea 13-14', { bookId: 'HOS', chapter: 13, endChapter: 14 }],
  ]
  for (const [input, expected] of cases) {
    it(`"${input}"`, () => { expect(parseRef(input)).toMatchObject(expected) })
  }
})

// ─── 5. Numbered books in every common form ──────────────────────────────────

describe('parseRef — numbered books', () => {
  const cases: Array<[string, string]> = [
    ['1 Samuel 1', '1SA'], ['1sam1', '1SA'], ['1sa1', '1SA'],
    ['2 Samuel 7', '2SA'], ['2sam7', '2SA'],
    ['1 Kings 8', '1KI'], ['1ki8', '1KI'], ['1kings8', '1KI'],
    ['2 Kings 2', '2KI'], ['2ki2', '2KI'],
    ['1 Cor 13', '1CO'], ['1co13', '1CO'], ['1cor13', '1CO'],
    ['2 Cor 5', '2CO'], ['2co5', '2CO'],
    ['1 John 4', '1JN'], ['1jn4', '1JN'], ['1jo4', '1JN'],
    ['2 John 1', '2JN'], ['3 John 1', '3JN'],
    ['1 Pet 1', '1PE'], ['1pe1', '1PE'],
    ['1 Tim 3', '1TI'], ['2 Tim 2', '2TI'],
    ['1 Thess 4', '1TH'], ['2 Thess 2', '2TH'],
  ]
  for (const [input, id] of cases) {
    it(`"${input}" → ${id}`, () => { expect(parseRef(input)?.bookId).toBe(id) })
  }
})

// ─── 6. Strong's detection ───────────────────────────────────────────────────

describe('isStrongsRef + intent', () => {
  const strongs = ['H7225', 'G3056', 'h1', 'g5', 'H07225', 'G00001']
  for (const s of strongs) {
    it(`"${s}" is Strong's`, () => {
      expect(isStrongsRef(s)).toBe(true)
      expect(intentOf(s)).toBe('strongs')
    })
  }
  const notStrongs = ['H', 'G', 'HG12', '12H', 'Hello', 'Genesis']
  for (const s of notStrongs) {
    it(`"${s}" is NOT Strong's`, () => { expect(isStrongsRef(s)).toBe(false) })
  }
})

// ─── 7. Intent classification across realistic queries ───────────────────────

describe('intentOf — query routing', () => {
  const refQueries = ['joh1', 'Gen 1:1', 'rev22', 'ps23', 'Matthew 5', 'isa53', '1cor13', 'john 3:16']
  for (const q of refQueries) it(`"${q}" → ref`, () => expect(intentOf(q)).toBe('ref'))

  const strongsQueries = ['H7225', 'G3056', 'h430']
  for (const q of strongsQueries) it(`"${q}" → strongs`, () => expect(intentOf(q)).toBe('strongs'))

  const keywordQueries = ['in the beginning', 'love your enemies', 'covenant', 'sabbath rest', 'firmament', 'shepherd']
  for (const q of keywordQueries) it(`"${q}" → keyword`, () => expect(intentOf(q)).toBe('keyword'))

  const tooShort = ['a', 'of', 'in']
  for (const q of tooShort) it(`"${q}" → too-short`, () => expect(intentOf(q)).toBe('too-short'))
})

// ─── 8. Negative cases — gibberish must NOT parse as a ref ────────────────────

describe('parseRef — rejects non-references', () => {
  const nonRefs = [
    'hello world', 'covenant', 'the beginning', 'shepherd', 'love', 'xyz123',
    'zzz1', 'qqq5', '123', 'book of life', 'grace and truth',
  ]
  for (const q of nonRefs) {
    it(`"${q}" → null`, () => { expect(parseRef(q)).toBeNull() })
  }
})

// ─── 9. Chapter-only across many books (programmatic breadth) ────────────────

describe('parseRef — chapter sweeps', () => {
  const books: Array<[string, string]> = [
    ['gen', 'GEN'], ['psa', 'PSA'], ['isa', 'ISA'], ['mat', 'MAT'],
    ['joh', 'JHN'], ['rom', 'ROM'], ['rev', 'REV'], ['act', 'ACT'],
  ]
  for (const [abbr, id] of books) {
    for (const ch of [1, 2, 5, 10, 21]) {
      it(`"${abbr} ${ch}" → ${id} ${ch}`, () => {
        expect(parseRef(`${abbr} ${ch}`)).toMatchObject({ bookId: id, chapter: ch })
      })
      it(`"${abbr}${ch}" (no space) → ${id} ${ch}`, () => {
        expect(parseRef(`${abbr}${ch}`)).toMatchObject({ bookId: id, chapter: ch })
      })
    }
  }
})

// ── makeSnippet — windows truncated text around the query match ─────────────────
import { makeSnippet } from '../highlight'

describe('makeSnippet', () => {
  const long = 'In the beginning God created the heaven and the earth and the deep waters covered everything below the firmament of the sky'
  it('returns text unchanged when within maxLen', () => {
    expect(makeSnippet('short text', 'text', 100)).toBe('short text')
  })
  it('shows the opening when match is near the start', () => {
    const s = makeSnippet(long, 'beginning', 40)
    expect(s.startsWith('In the beginning')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
  })
  it('windows around a match deep in the text (phrase)', () => {
    const s = makeSnippet(long, 'firmament', 40, 'phrase')
    expect(s.toLowerCase()).toContain('firmament')
    expect(s.startsWith('…')).toBe(true)
  })
  it('windows around the earliest matching word (all/any)', () => {
    const s = makeSnippet(long, 'sky firmament', 40, 'all')
    expect(s.toLowerCase()).toContain('firmament')
  })
  it('falls back to the opening when there is no match', () => {
    const s = makeSnippet(long, 'zzzznotpresent', 40)
    expect(s.startsWith('In the beginning')).toBe(true)
  })
  it('falls back to the opening when query is empty', () => {
    const s = makeSnippet(long, '', 30)
    expect(s.startsWith('In the beginning')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
  })
})
