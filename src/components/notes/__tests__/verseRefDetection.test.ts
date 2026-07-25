/**
 * Tests for:
 *  - findVerseRefMatches: ANY number of verse refs per line, multi-word book
 *    names, leading-word recovery ("vs Deuteronomy 18:15-19"), all books.
 *  - verseTextMatchRatio: the "actually contains the verse text" check.
 *  - renderPreviewContent verse blocks (view-mode styling parity).
 *  - detectVerseBlock across all books.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  findVerseRefMatches, verseTextMatchRatio, renderPreviewContent, detectVerseBlock,
} from '../NoteEditor'
import { ALL_BOOKS, parseRef } from '@/lib/parseRef'
import { useAppStore } from '@/store'

// ── helpers ──────────────────────────────────────────────────────────────────

const refTexts = (s: string) => findVerseRefMatches(s).map(m => m.refText)
const refIds = (s: string) => findVerseRefMatches(s).map(m => parseRef(m.refText)?.bookId)

// Representative books spanning every section of the canon Berean ships. Each is
// verified to round-trip through parseRef. We test detection across this curated
// set (rather than every obscure pseudepigraphon) plus the explicit multi-word
// cases in section 1.
const SIMPLE_BOOKS = ALL_BOOKS.filter(b => [
  // OT
  'GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI',
  '1CH','2CH','EZR','NEH','JOB','PSA','PRO','ECC','ISA','JER','LAM','EZK',
  'DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  // NT
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL',
  '1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV',
  // Apocrypha / pseudepigrapha (single-token or "N Word" names)
  'TOB','JDT','SIR','BAR','ENO','JUB',
].includes(b.id))

// Alias retained for any remaining references.
const CLEAN_BOOKS = SIMPLE_BOOKS

// ── 1. Multiple refs per line (the reported bug) ──────────────────────────────

describe('findVerseRefMatches — multiple refs per line', () => {
  it('the reported line: Romans 10:1-2 vs Deuteronomy 18:15-19', () => {
    const line = 'two diff righteousness: Romans 10:1-2 vs Deuteronomy 18:15-19'
    const ids = refIds(line)
    expect(ids).toContain('ROM')
    expect(ids).toContain('DEU')
    expect(ids.length).toBe(2)
  })

  it('recovers book after a leading non-book word ("vs Deuteronomy")', () => {
    const m = findVerseRefMatches('vs Deuteronomy 18:15-19')
    expect(m.length).toBe(1)
    expect(m[0].refText).toBe('Deuteronomy 18:15-19')
    expect(parseRef(m[0].refText)?.bookId).toBe('DEU')
  })

  it('two refs separated by "and"', () => {
    expect(refIds('Gen 1:1 and John 1:1')).toEqual(['GEN', 'JHN'])
  })

  it('three refs on one line', () => {
    expect(refIds('Gen 1:1, Exod 20:3, and Rev 22:21')).toEqual(['GEN', 'EXO', 'REV'])
  })

  it('four refs on one line', () => {
    const ids = refIds('Matt 5:8 Mark 1:1 Luke 2:1 John 3:16')
    expect(ids).toEqual(['MAT', 'MRK', 'LUK', 'JHN'])
  })

  it('refs with ranges all detected', () => {
    expect(refIds('Isa 53:1-5 / Ps 22:1-18')).toEqual(['ISA', 'PSA'])
  })

  it('numbered-book refs both detected', () => {
    expect(refIds('1 John 2:4 vs 2 Peter 1:5')).toEqual(['1JN', '2PE'])
  })

  it('multi-word book ref + simple ref', () => {
    expect(refIds('Song of Songs 2:1 and Ps 45:1')).toEqual(['SNG', 'PSA'])
  })

  it('leading commentary words then two refs', () => {
    expect(refIds('compare Genesis 1:1 with John 1:1')).toEqual(['GEN', 'JHN'])
  })

  it('refs separated by colon-prefixed phrase', () => {
    const ids = refIds('law vs grace: Galatians 3:24 then Romans 6:14')
    expect(ids).toEqual(['GAL', 'ROM'])
  })

  it('five refs in a list', () => {
    const ids = refIds('Gen 1:1 Exod 2:2 Lev 3:3 Num 4:4 Deut 5:5')
    expect(ids).toEqual(['GEN', 'EXO', 'LEV', 'NUM', 'DEU'])
  })

  it('match offsets are non-overlapping and ordered', () => {
    const m = findVerseRefMatches('Gen 1:1 and John 3:16')
    expect(m.length).toBe(2)
    expect(m[0].index).toBeLessThan(m[1].index)
    expect(m[0].index + m[0].length).toBeLessThanOrEqual(m[1].index)
  })

  it('refText excludes the leading non-book word', () => {
    const m = findVerseRefMatches('see Romans 8:28')
    expect(m[0].refText).toBe('Romans 8:28')
  })

  it('chapter-only refs detected', () => {
    expect(refIds('Genesis 1 and Exodus 20')).toEqual(['GEN', 'EXO'])
  })

  it('mixed chapter-only and verse refs', () => {
    expect(refIds('Psalm 23 then Ps 23:1')).toEqual(['PSA', 'PSA'])
  })

  it('does not match gibberish', () => {
    expect(findVerseRefMatches('hello world no refs here')).toHaveLength(0)
  })

  it('does not match a word glued to a number with no book', () => {
    expect(findVerseRefMatches('xyz123 abc456')).toHaveLength(0)
  })

  it('LXX suffix flagged on the right ref only', () => {
    const m = findVerseRefMatches('Gen 1:1 LXX and John 1:1')
    expect(m.length).toBe(2)
    expect(m[0].lxx).toBe(true)
    expect(m[1].lxx).toBe(false)
  })
})

// ── 2. All books — single ref recognised ──────────────────────────────────────

describe('findVerseRefMatches — every clean-named book', () => {
  for (const book of CLEAN_BOOKS) {
    it(`${book.name} 1:1 → ${book.id}`, () => {
      const m = findVerseRefMatches(`${book.name} 1:1`)
      expect(m.length).toBeGreaterThanOrEqual(1)
      expect(parseRef(m[0].refText)?.bookId).toBe(book.id)
    })
  }
})

// ── 3. All books — two refs on one line (cross product sample) ────────────────

describe('findVerseRefMatches — each book paired with John 3:16', () => {
  for (const book of SIMPLE_BOOKS) {
    it(`${book.name} 1:1 and John 3:16`, () => {
      const ids = refIds(`${book.name} 1:1 and John 3:16`)
      expect(ids).toContain(book.id)
      expect(ids).toContain('JHN')
      expect(ids.length).toBe(2)
    })
  }
})

// ── 4. All books — "vs" recovery (leading word) ───────────────────────────────
// Single-chapter books (Obadiah, Philemon, 2 John, 3 John, Jude) only have
// chapter 1, so we use "1:2" for those and "2:2" for multi-chapter books.
const SINGLE_CHAPTER_BOOKS = new Set(['OBA', 'PHM', '2JN', '3JN', 'JUD'])

describe('findVerseRefMatches — "vs Book" recovery for every book', () => {
  for (const book of SIMPLE_BOOKS) {
    const ref = SINGLE_CHAPTER_BOOKS.has(book.id) ? '1:2' : '2:2'
    it(`Gen 1:1 vs ${book.name} ${ref}`, () => {
      const ids = refIds(`Gen 1:1 vs ${book.name} ${ref}`)
      expect(ids).toContain('GEN')
      expect(ids).toContain(book.id)
    })
  }
})

// ── 5. False-positive guard — ambiguous patterns and out-of-range chapters ────

describe('findVerseRefMatches — false-positive guard', () => {
  // Chapter-count validation
  it('"is 99% fulfilled" — Isaiah only has 66 chapters', () => {
    expect(findVerseRefMatches('The OT is 99% fulfilled.')).toHaveLength(0)
  })
  it('"am 12 years old" — Amos only has 9 chapters', () => {
    expect(findVerseRefMatches('I am 12 years old.')).toHaveLength(0)
  })
  it('"re 30 items" — Revelation only has 22 chapters', () => {
    expect(findVerseRefMatches('re 30 items on the list')).toHaveLength(0)
  })
  // Ambiguous pattern + lowercase + no colon → skip
  it('"is 5 times worse" — lowercase "is" without colon', () => {
    expect(findVerseRefMatches('grace is 5 times greater than sin')).toHaveLength(0)
  })
  it('"her 3 children" — "her" is a pronoun, not Hermas', () => {
    expect(findVerseRefMatches('she gave her 3 children food')).toHaveLength(0)
  })
  it('"job 10 applicants" — common English word', () => {
    expect(findVerseRefMatches('there were job 10 applicants')).toHaveLength(0)
  })
  it('"col 3 layout" — spreadsheet column', () => {
    expect(findVerseRefMatches('see col 3 in the spreadsheet')).toHaveLength(0)
  })
  it('"re: 5 points" — email prefix', () => {
    expect(findVerseRefMatches('re: 5 points from the meeting')).toHaveLength(0)
  })
  // Ambiguous + capitalised → ALLOW
  it('"Is 5" capitalised → Isaiah 5', () => {
    const m = findVerseRefMatches('see Is 5 for this prophecy')
    expect(m.length).toBeGreaterThan(0)
    expect(parseRef(m[0].refText)?.bookId).toBe('ISA')
  })
  it('"Job 1" capitalised → Job 1', () => {
    const m = findVerseRefMatches('read Job 1 today')
    expect(m.length).toBeGreaterThan(0)
    expect(parseRef(m[0].refText)?.bookId).toBe('JOB')
  })
  // Ambiguous + colon → ALLOW
  it('"is 5:1" with colon → Isaiah 5:1', () => {
    const m = findVerseRefMatches('is 5:1 speaks of Yeshua')
    expect(m.length).toBeGreaterThan(0)
    expect(parseRef(m[0].refText)?.bookId).toBe('ISA')
  })
  it('"col 3:1" with colon → Colossians 3:1', () => {
    const m = findVerseRefMatches('seek what is above — col 3:1')
    expect(m.length).toBeGreaterThan(0)
    expect(parseRef(m[0].refText)?.bookId).toBe('COL')
  })
  // Full book names always allowed regardless of case
  it('"isaiah 5" full name lowercase → allowed', () => {
    const m = findVerseRefMatches('read isaiah 5 today')
    expect(m.length).toBeGreaterThan(0)
    expect(parseRef(m[0].refText)?.bookId).toBe('ISA')
  })
})

// ── 6. verseTextMatchRatio ────────────────────────────────────────────────────

describe('verseTextMatchRatio', () => {
  it('identical text → 1', () => {
    expect(verseTextMatchRatio('In the beginning', 'In the beginning')).toBe(1)
  })

  it('candidate fully contained → 1', () => {
    expect(verseTextMatchRatio('the beginning', 'In the beginning God created')).toBe(1)
  })

  it('no overlap → 0', () => {
    expect(verseTextMatchRatio('xyz qqq', 'In the beginning')).toBe(0)
  })

  it('half overlap → 0.5', () => {
    expect(verseTextMatchRatio('beginning xyz', 'in the beginning')).toBe(0.5)
  })

  it('case-insensitive', () => {
    expect(verseTextMatchRatio('IN THE BEGINNING', 'in the beginning')).toBe(1)
  })

  it('ignores punctuation', () => {
    expect(verseTextMatchRatio('beginning,', 'In the beginning.')).toBe(1)
  })

  it('empty candidate → 0', () => {
    expect(verseTextMatchRatio('', 'anything')).toBe(0)
  })

  it('commentary text scores low', () => {
    // "my thoughts here" vs an actual verse — near zero
    const ratio = verseTextMatchRatio('my thoughts here', 'And Adam lived after he begat Seth eight hundred years')
    expect(ratio).toBeLessThan(0.5)
  })

  it('real verse text scores high', () => {
    const actual = 'For God so loved the world that he gave his only begotten Son'
    const candidate = 'For God so loved the world that he gave his only begotten Son'
    expect(verseTextMatchRatio(candidate, actual)).toBe(1)
  })

  it('mostly-correct verse scores above 0.9', () => {
    const actual = 'He that saith I know him and keepeth not his commandments is a liar'
    const candidate = 'He that saith I know him and keepeth not his commandments is a' // dropped last word
    expect(verseTextMatchRatio(candidate, actual)).toBeGreaterThan(0.9)
  })

  it('multiset: duplicate candidate words need duplicate actual words', () => {
    // candidate has "the the", actual has only one "the"
    expect(verseTextMatchRatio('the the', 'the cat')).toBe(0.5)
  })

  it('gibberish verse comment example scores low', () => {
    // user's example: "Genesis 5:4 therniorns gresoin" — comment text
    expect(verseTextMatchRatio('therniorns gresoin', 'And the days of Adam after he had begotten Seth')).toBe(0)
  })
})

// ── 6. renderPreviewContent verse blocks (view-mode styling) ─────────────────

describe('renderPreviewContent verse blocks (setting ON)', () => {
  beforeAll(() => { useAppStore.setState({ noteScriptureBlock: true, noteScriptureBlockThreshold: 0.9 }) })
  afterAll(() => { useAppStore.setState({ noteScriptureBlock: false }) })

  it('single-line verse block gets berean-verse-block div', () => {
    const html = renderPreviewContent('1 John 2:4 He that saith I know him')
    expect(html).toContain('berean-verse-block')
    expect(html).toContain('He that saith')
  })

  it('single-line block has the ref styled', () => {
    const html = renderPreviewContent('John 3:16 For God so loved the world')
    expect(html).toContain('berean-verse-block')
    expect(html).toContain('berean-verse-ref')
    expect(html).toContain('John 3:16')
  })

  it('multi-line verse block gets a single block div', () => {
    const md = 'Luke 16:29-31\n29 Abraham saith.\n30 And he said.\n31 And he said.'
    const html = renderPreviewContent(md)
    expect(html).toContain('berean-verse-block')
    expect(html).toContain('Abraham saith')
    expect(html).toContain('Luke 16:29-31')
  })

  it('bare reference alone is NOT a block', () => {
    const html = renderPreviewContent('Luke 16:29-31')
    expect(html).not.toContain('berean-verse-block')
  })

  it('block style applied via inline style (works in print)', () => {
    const html = renderPreviewContent('Gen 1:1 In the beginning God created')
    expect(html).toMatch(/berean-verse-block[^>]*style=/)
  })
})

describe('renderPreviewContent verse blocks (setting OFF)', () => {
  beforeAll(() => { useAppStore.setState({ noteScriptureBlock: false }) })

  it('no block formatting when disabled', () => {
    const html = renderPreviewContent('1 John 2:4 He that saith I know him')
    expect(html).not.toContain('berean-verse-block')
  })

  it('inline verse refs still link when disabled', () => {
    const html = renderPreviewContent('See Gen 1:1 here')
    expect(html).toContain('berean-verse-ref')
  })
})

// ── 7. Inline multi-ref in preview HTML ───────────────────────────────────────

describe('renderPreviewContent — multiple inline refs per line', () => {
  beforeAll(() => { useAppStore.setState({ noteScriptureBlock: false }) })

  it('both refs become links: Romans 10:1-2 vs Deuteronomy 18:15-19', () => {
    const html = renderPreviewContent('compare Romans 10:1-2 vs Deuteronomy 18:15-19')
    const links = html.match(/class="berean-verse-ref"/g) ?? []
    expect(links.length).toBe(2)
    expect(html).toContain('Romans 10:1-2')
    expect(html).toContain('Deuteronomy 18:15-19')
  })

  it('three refs all become links', () => {
    const html = renderPreviewContent('Gen 1:1, John 1:1, and Rev 22:21')
    const links = html.match(/class="berean-verse-ref"/g) ?? []
    expect(links.length).toBe(3)
  })

  it('ref inside code is NOT linked', () => {
    const html = renderPreviewContent('`Gen 1:1`')
    expect(html).not.toContain('berean-verse-ref')
  })
})

// ── 8. detectVerseBlock across all clean books ───────────────────────────────

describe('detectVerseBlock — single-line for every clean book', () => {
  for (const book of CLEAN_BOOKS) {
    it(`${book.name} 1:1 + text`, () => {
      const r = detectVerseBlock(`${book.name} 1:1 here is some verse text content`)
      expect(r).not.toBeNull()
      expect(r!.kind).toBe('single')
      expect(parseRef(r!.ref)?.bookId).toBe(book.id)
    })
  }
})

// ── 8b. "Book N," comma form for multi-book editions (Recognitions of Clement) ──
// bookChapterVerseLabel (parseRef.ts) GENERATES this exact comma'd shape ("Recognitions,
// Book 1, 1:2") for search titles / copy-verse-reference output, but parseRef's own regex,
// SINGLE_VERSE_LINE_RE, and VERSE_REF_SCAN_RE each independently required NO comma between
// "Book N" and the chapter:verse — so text the app itself produces couldn't be parsed back.

describe('detectVerseBlock — "Book N," comma form (Recognitions of Clement)', () => {
  it('single-line: ref + body, comma before AND after "Book N"', () => {
    const r = detectVerseBlock('Recognitions, Book 1, 1:2 For a thought that was in me constantly led me to think of my condition of mortality.')
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('single')
    expect(parseRef(r!.ref)?.bookId).toBe('RCL1')
  })
})

describe('parseRef — "Book N," comma form', () => {
  it('parses a bare reference with a comma before the chapter:verse', () => {
    expect(parseRef('Recognitions, Book 1, 1:3')?.bookId).toBe('RCL1')
  })
})

describe('findVerseRefMatches — "Book N," comma form', () => {
  it('detects a bare reference (trailing period) with a comma before the chapter:verse', () => {
    const matches = findVerseRefMatches('Recognitions, Book 1, 1:3.')
    expect(matches.length).toBeGreaterThan(0)
    expect(parseRef(matches[0].refText)?.bookId).toBe('RCL1')
  })
})

// ── 8c. Embedded-comma book names (Shepherd of Hermas) ──────────────────────────
// bookName() for Hermas is "Hermas, Visions" / "Hermas, Mandates" / "Hermas, Similitudes"
// (a comma baked into the name itself), and verseClipboard.ts's copy-verse output adds a
// further comma before the chapter:verse ("Hermas, Similitudes, 35:1") — the book-token
// group in all three regexes needed to tolerate an embedded comma, not just the ones
// around "Book N".

describe('detectVerseBlock — embedded-comma book name (Hermas)', () => {
  it('single-line: ref + body, comma within the book name AND before chapter:verse', () => {
    const r = detectVerseBlock('Hermas, Similitudes, 35:1 Be careful, my children, to do what is right in all things.')
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('single')
    expect(parseRef(r!.ref)?.bookId).toBe('HER_SIM')
  })
})

describe('parseRef — embedded-comma book name (Hermas)', () => {
  it('parses a bare reference with a comma inside the book name and before chapter:verse', () => {
    expect(parseRef('Hermas, Similitudes, 35:1')?.bookId).toBe('HER_SIM')
  })
  it('still parses the no-comma-before-chapter form (bookName\'s own comma only)', () => {
    expect(parseRef('Hermas, Similitudes 35:1')?.bookId).toBe('HER_SIM')
  })
})

describe('findVerseRefMatches — embedded-comma book name (Hermas)', () => {
  it('detects a bare reference with the full comma\'d Hermas label', () => {
    const matches = findVerseRefMatches('Hermas, Similitudes, 35:1.')
    expect(matches.length).toBeGreaterThan(0)
    expect(parseRef(matches[0].refText)?.bookId).toBe('HER_SIM')
  })
})

// ── 9. Print HTML carries verse styles ───────────────────────────────────────

describe('buildPrintHTML verse styling', () => {
  it('print CSS includes pm-verse-ref and pm-verse-block rules', async () => {
    const { buildPrintHTML } = await import('../NoteEditor')
    const html = buildPrintHTML('Test', 'See Gen 1:1')
    expect(html).toContain('.pm-verse-block')
    expect(html).toContain('.pm-verse-ref')
  })
})
