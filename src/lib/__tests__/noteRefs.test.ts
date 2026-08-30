/**
 * Tests for cross-ref extraction and verse-range matching.
 */
import { describe, it, expect } from 'vitest'
import { extractRefsFromNote, refMatchesVerse } from '../noteRefs'
import { verseTextMatchRatio } from '../notePreviewRender'

// ── helpers ────────────────────────────────────────────────────────────────────
function ref(bookId: string, chapter: number, verse: number, endVerse?: number) {
  return { bookId, chapter, verse, endVerse, sourceNoteTitle: '', context: '' }
}

// ── 1. Chapter-level reference extraction ─────────────────────────────────────

describe('extractRefsFromNote — chapter references', () => {
  it('"Genesis 5" is extracted as a chapter ref (isChapter, verse 0)', () => {
    const refs = extractRefsFromNote('This quotes Genesis 5 about the genealogy', 'Note')
    const gen = refs.find(r => r.bookId === 'GEN')
    expect(gen).toBeTruthy()
    expect(gen!.chapter).toBe(5)
    expect(gen!.isChapter).toBe(true)
    expect(gen!.verse).toBe(0)
  })

  it('"John 3:16" is a verse ref (not chapter)', () => {
    const refs = extractRefsFromNote('See John 3:16 here', 'Note')
    const jhn = refs.find(r => r.bookId === 'JHN')
    expect(jhn!.isChapter).toBeFalsy()
    expect(jhn!.verse).toBe(16)
  })

  it('mixed chapter + verse refs in one note', () => {
    const refs = extractRefsFromNote('Compare Genesis 5 with Romans 8:28', 'Note')
    const gen = refs.find(r => r.bookId === 'GEN')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(gen!.isChapter).toBe(true)
    expect(rom!.isChapter).toBeFalsy()
    expect(rom!.verse).toBe(28)
  })

  it('numbered-book chapter ref: "1 Kings 8"', () => {
    const refs = extractRefsFromNote('quoting 1 Kings 8 the dedication', 'Note')
    const ref = refs.find(r => r.bookId === '1KI')
    expect(ref).toBeTruthy()
    expect(ref!.chapter).toBe(8)
    expect(ref!.isChapter).toBe(true)
  })
})

// ── 2. Verse range extraction (the main bug) ───────────────────────────────────

describe('extractRefsFromNote — verse ranges', () => {
  it('extracts "Romans 9:21-22" with endVerse 22', () => {
    const refs = extractRefsFromNote('connection romans 9:21-22', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom).toBeTruthy()
    expect(rom!.chapter).toBe(9)
    expect(rom!.verse).toBe(21)
    expect(rom!.endVerse).toBe(22)
  })

  it('extracts en-dash range "Romans 9:21–22"', () => {
    const refs = extractRefsFromNote('Romans 9:21–22 the potter', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom!.verse).toBe(21)
    expect(rom!.endVerse).toBe(22)
  })

  it('extracts range with spaces "Romans 9:21 - 22"', () => {
    const refs = extractRefsFromNote('Romans 9:21 - 22', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom!.verse).toBe(21)
    expect(rom!.endVerse).toBe(22)
  })

  it('single verse has no endVerse', () => {
    const refs = extractRefsFromNote('Romans 9:21 is key', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom!.verse).toBe(21)
    expect(rom!.endVerse).toBeUndefined()
  })

  it('chapter ref has no endVerse', () => {
    const refs = extractRefsFromNote('See Romans 9', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom!.isChapter).toBe(true)
    expect(rom!.endVerse).toBeUndefined()
  })

  it('extracts "Genesis 1:1-3"', () => {
    const refs = extractRefsFromNote('In Genesis 1:1-3 creation begins', 'Note')
    const gen = refs.find(r => r.bookId === 'GEN')
    expect(gen!.chapter).toBe(1)
    expect(gen!.verse).toBe(1)
    expect(gen!.endVerse).toBe(3)
  })

  it('extracts "Deuteronomy 5:6-21" the commandments', () => {
    const refs = extractRefsFromNote('Deuteronomy 5:6-21 lists the commandments', 'Note')
    const deu = refs.find(r => r.bookId === 'DEU')
    expect(deu!.verse).toBe(6)
    expect(deu!.endVerse).toBe(21)
  })

  it('extracts multiple ranges in one note', () => {
    const refs = extractRefsFromNote('Romans 9:21-22 and Isaiah 53:4-6', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    const isa = refs.find(r => r.bookId === 'ISA')
    expect(rom!.verse).toBe(21); expect(rom!.endVerse).toBe(22)
    expect(isa!.verse).toBe(4);  expect(isa!.endVerse).toBe(6)
  })

  it('a cross-chapter range ("Isaiah 63:17-64:3") is not silently mis-linked as a bogus same-chapter range', () => {
    // Regression: the old truncating regex captured only "63:17-64", and the old parseRef
    // (no cross-chapter grammar) accepted that as a same-chapter range up to verse 64 —
    // which doesn't exist in Isaiah 63 — so it silently "matched" verses 17 through 64.
    // Now it must NOT do that: endVerse (3) < verse (17) degrades safely to matching only
    // the exact start verse (see noteRefs.ts's own comment on why endChapter isn't tracked
    // here), never a bogus wide same-chapter range.
    const refs = extractRefsFromNote('See Isaiah 63:17-64:3 for the prayer', 'Note')
    const isa = refs.find(r => r.bookId === 'ISA')
    expect(isa).toBeTruthy()
    expect(isa!.chapter).toBe(63)
    expect(isa!.verse).toBe(17)
    expect(refMatchesVerse(isa!, 'ISA', 63, 50)).toBe(false) // must NOT match a bogus wide range
    expect(refMatchesVerse(isa!, 'ISA', 63, 17)).toBe(true)  // exact start verse still matches
  })

  it('extracts range followed by comma: "John 3:16-17,"', () => {
    const refs = extractRefsFromNote('John 3:16-17, and also Heb 11:1', 'Note')
    const jhn = refs.find(r => r.bookId === 'JHN')
    expect(jhn!.verse).toBe(16)
    expect(jhn!.endVerse).toBe(17)
  })

  it('extracts range at end of string with no trailing space', () => {
    const refs = extractRefsFromNote('See Psalm 119:9-16', 'Note')
    const psa = refs.find(r => r.bookId === 'PSA')
    expect(psa!.verse).toBe(9)
    expect(psa!.endVerse).toBe(16)
  })

  it('extracts "1 Corinthians 13:1-13" correctly', () => {
    const refs = extractRefsFromNote('Love chapter 1 Corinthians 13:1-13', 'Note')
    const co = refs.find(r => r.bookId === '1CO')
    expect(co!.chapter).toBe(13)
    expect(co!.verse).toBe(1)
    expect(co!.endVerse).toBe(13)
  })

  it('extracts "2 Kings 2:1-14" Elijah taken up', () => {
    const refs = extractRefsFromNote('2 Kings 2:1-14 Elijah taken', 'Note')
    const ki = refs.find(r => r.bookId === '2KI')
    expect(ki!.verse).toBe(1)
    expect(ki!.endVerse).toBe(14)
  })

  it('range in wikilink "[[Romans 9:21-22]]"', () => {
    const refs = extractRefsFromNote('See [[Romans 9:21-22]]', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom).toBeTruthy()
    expect(rom!.verse).toBe(21)
    expect(rom!.endVerse).toBe(22)
  })

  it('single-verse range "John 3:16-16" treated as single', () => {
    const refs = extractRefsFromNote('John 3:16-16', 'Note')
    const jhn = refs.find(r => r.bookId === 'JHN')
    // endVerse may equal verse — still extracted
    expect(jhn!.verse).toBe(16)
  })

  it('range does not bleed into next sentence', () => {
    const refs = extractRefsFromNote('Romans 9:21-22. Next see Gal 3:1', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    const gal = refs.find(r => r.bookId === 'GAL')
    expect(rom!.endVerse).toBe(22)
    expect(gal!.verse).toBe(1)
    expect(gal!.endVerse).toBeUndefined()
  })

  it('Hebrews 11:1-40 full faith chapter', () => {
    const refs = extractRefsFromNote('Hebrews 11:1-40 the faith hall', 'Note')
    const heb = refs.find(r => r.bookId === 'HEB')
    expect(heb!.verse).toBe(1)
    expect(heb!.endVerse).toBe(40)
  })

  it('Titus 2:11-14 the key grace passage', () => {
    const refs = extractRefsFromNote('Titus 2:11-14 is the key grace passage', 'Note')
    const tit = refs.find(r => r.bookId === 'TIT')
    expect(tit!.chapter).toBe(2)
    expect(tit!.verse).toBe(11)
    expect(tit!.endVerse).toBe(14)
  })

  it('range deduplication: "Romans 9:21-22" mentioned twice produces one ref', () => {
    const refs = extractRefsFromNote('Romans 9:21-22 ... Romans 9:21-22 again', 'Note')
    const allRom = refs.filter(r => r.bookId === 'ROM' && r.verse === 21)
    expect(allRom.length).toBe(1)
  })

  it('same verse with and without range produces two distinct refs', () => {
    const refs = extractRefsFromNote('Romans 9:21 and Romans 9:21-22', 'Note')
    const allRom = refs.filter(r => r.bookId === 'ROM' && r.chapter === 9)
    // One single-verse ref and one range ref
    expect(allRom.length).toBe(2)
  })

  it('Revelation 21:1-5 new creation', () => {
    const refs = extractRefsFromNote('Rev 21:1-5 the new creation', 'Note')
    const rev = refs.find(r => r.bookId === 'REV')
    expect(rev!.verse).toBe(1)
    expect(rev!.endVerse).toBe(5)
  })

  it('Isaiah 53:1-12 servant song', () => {
    const refs = extractRefsFromNote('The servant song Isaiah 53:1-12', 'Note')
    const isa = refs.find(r => r.bookId === 'ISA')
    expect(isa!.verse).toBe(1)
    expect(isa!.endVerse).toBe(12)
  })

  it('Exodus 20:1-17 the ten commandments', () => {
    const refs = extractRefsFromNote('Exodus 20:1-17 the commandments', 'Note')
    const exo = refs.find(r => r.bookId === 'EXO')
    expect(exo!.verse).toBe(1)
    expect(exo!.endVerse).toBe(17)
  })

  it('Psalm 22:1-31 the cross psalm', () => {
    const refs = extractRefsFromNote('Psalm 22:1-31', 'Note')
    const psa = refs.find(r => r.bookId === 'PSA')
    expect(psa!.verse).toBe(1)
    expect(psa!.endVerse).toBe(31)
  })

  it('Galatians 5:19-21 works of flesh', () => {
    const refs = extractRefsFromNote('works of flesh Galatians 5:19-21', 'Note')
    const gal = refs.find(r => r.bookId === 'GAL')
    expect(gal!.verse).toBe(19)
    expect(gal!.endVerse).toBe(21)
  })

  it('extracts range with tab character before it', () => {
    const refs = extractRefsFromNote('\tRomans 9:21-22 the potter', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom!.endVerse).toBe(22)
  })

  it('3 John 1:2-4 range from tiny book', () => {
    const refs = extractRefsFromNote('3 John 1:2-4 beloved', 'Note')
    const jn = refs.find(r => r.bookId === '3JN')
    expect(jn!.verse).toBe(2)
    expect(jn!.endVerse).toBe(4)
  })

  it('Philemon 1:4-7 range', () => {
    const refs = extractRefsFromNote('Philemon 1:4-7 thanksgiving', 'Note')
    const phm = refs.find(r => r.bookId === 'PHM')
    expect(phm!.verse).toBe(4)
    expect(phm!.endVerse).toBe(7)
  })
})

// ── 3. refMatchesVerse — basic ─────────────────────────────────────────────────

describe('refMatchesVerse — basic', () => {
  const chapterRef = ref('GEN', 5, 0)
  const verseRef   = ref('GEN', 5, 4)

  it('chapter ref matches verse 1 of that chapter', () => {
    expect(refMatchesVerse({ ...chapterRef, isChapter: true }, 'GEN', 5, 1)).toBe(true)
  })
  it('chapter ref matches verse 32 of that chapter', () => {
    expect(refMatchesVerse({ ...chapterRef, isChapter: true }, 'GEN', 5, 32)).toBe(true)
  })
  it('chapter ref does NOT match a different chapter', () => {
    expect(refMatchesVerse({ ...chapterRef, isChapter: true }, 'GEN', 6, 1)).toBe(false)
  })
  it('chapter ref does NOT match a different book', () => {
    expect(refMatchesVerse({ ...chapterRef, isChapter: true }, 'EXO', 5, 1)).toBe(false)
  })
  it('verse ref matches only its exact verse', () => {
    expect(refMatchesVerse(verseRef, 'GEN', 5, 4)).toBe(true)
    expect(refMatchesVerse(verseRef, 'GEN', 5, 5)).toBe(false)
  })
  it('verse ref does not match different book same address', () => {
    expect(refMatchesVerse(verseRef, 'EXO', 5, 4)).toBe(false)
  })
  it('verse ref does not match different chapter', () => {
    expect(refMatchesVerse(verseRef, 'GEN', 4, 4)).toBe(false)
  })
})

// ── 4. refMatchesVerse — ranges (the fix) ──────────────────────────────────────

describe('refMatchesVerse — verse ranges', () => {
  const rangeRef = ref('ROM', 9, 21, 22) // Romans 9:21-22

  it('range ref matches start verse', () => {
    expect(refMatchesVerse({ ...rangeRef, sourceNoteTitle: '', context: '' }, 'ROM', 9, 21)).toBe(true)
  })
  it('range ref matches end verse', () => {
    expect(refMatchesVerse({ ...rangeRef, sourceNoteTitle: '', context: '' }, 'ROM', 9, 22)).toBe(true)
  })
  it('range ref does NOT match verse before start', () => {
    expect(refMatchesVerse({ ...rangeRef, sourceNoteTitle: '', context: '' }, 'ROM', 9, 20)).toBe(false)
  })
  it('range ref does NOT match verse after end', () => {
    expect(refMatchesVerse({ ...rangeRef, sourceNoteTitle: '', context: '' }, 'ROM', 9, 23)).toBe(false)
  })
  it('range ref does NOT match different chapter', () => {
    expect(refMatchesVerse({ ...rangeRef, sourceNoteTitle: '', context: '' }, 'ROM', 8, 21)).toBe(false)
  })
  it('range ref does NOT match different book', () => {
    expect(refMatchesVerse({ ...rangeRef, sourceNoteTitle: '', context: '' }, 'GAL', 9, 21)).toBe(false)
  })

  // Wider range
  const wideRange = { ...ref('HEB', 11, 1, 40), sourceNoteTitle: '', context: '' }
  it('wide range Hebrews 11:1-40 matches verse 1', () => {
    expect(refMatchesVerse(wideRange, 'HEB', 11, 1)).toBe(true)
  })
  it('wide range Hebrews 11:1-40 matches verse 20', () => {
    expect(refMatchesVerse(wideRange, 'HEB', 11, 20)).toBe(true)
  })
  it('wide range Hebrews 11:1-40 matches verse 40', () => {
    expect(refMatchesVerse(wideRange, 'HEB', 11, 40)).toBe(true)
  })
  it('wide range Hebrews 11:1-40 does NOT match verse 41', () => {
    expect(refMatchesVerse(wideRange, 'HEB', 11, 41)).toBe(false)
  })

  // Titus 2:11-14
  const titRef = { ...ref('TIT', 2, 11, 14), sourceNoteTitle: '', context: '' }
  it('Titus 2:11-14 matches verse 11', () => { expect(refMatchesVerse(titRef, 'TIT', 2, 11)).toBe(true) })
  it('Titus 2:11-14 matches verse 12', () => { expect(refMatchesVerse(titRef, 'TIT', 2, 12)).toBe(true) })
  it('Titus 2:11-14 matches verse 13', () => { expect(refMatchesVerse(titRef, 'TIT', 2, 13)).toBe(true) })
  it('Titus 2:11-14 matches verse 14', () => { expect(refMatchesVerse(titRef, 'TIT', 2, 14)).toBe(true) })
  it('Titus 2:11-14 does NOT match verse 10', () => { expect(refMatchesVerse(titRef, 'TIT', 2, 10)).toBe(false) })
  it('Titus 2:11-14 does NOT match verse 15', () => { expect(refMatchesVerse(titRef, 'TIT', 2, 15)).toBe(false) })

  // Isaiah 53:4-6
  const isaRef = { ...ref('ISA', 53, 4, 6), sourceNoteTitle: '', context: '' }
  it('Isaiah 53:4-6 matches verse 4', () => { expect(refMatchesVerse(isaRef, 'ISA', 53, 4)).toBe(true) })
  it('Isaiah 53:4-6 matches verse 5', () => { expect(refMatchesVerse(isaRef, 'ISA', 53, 5)).toBe(true) })
  it('Isaiah 53:4-6 matches verse 6', () => { expect(refMatchesVerse(isaRef, 'ISA', 53, 6)).toBe(true) })
  it('Isaiah 53:4-6 does NOT match verse 3', () => { expect(refMatchesVerse(isaRef, 'ISA', 53, 3)).toBe(false) })
  it('Isaiah 53:4-6 does NOT match verse 7', () => { expect(refMatchesVerse(isaRef, 'ISA', 53, 7)).toBe(false) })

  // Range where endVerse === verse (degenerate)
  const sameVerse = { ...ref('JHN', 3, 16, 16), sourceNoteTitle: '', context: '' }
  it('degenerate range endVerse===verse still matches that verse', () => {
    expect(refMatchesVerse(sameVerse, 'JHN', 3, 16)).toBe(true)
  })
  it('degenerate range does NOT match adjacent verse', () => {
    expect(refMatchesVerse(sameVerse, 'JHN', 3, 17)).toBe(false)
  })

  // Galatians 5:19-23
  const galRef = { ...ref('GAL', 5, 19, 23), sourceNoteTitle: '', context: '' }
  it('Galatians 5:19-23 matches verse 19', () => { expect(refMatchesVerse(galRef, 'GAL', 5, 19)).toBe(true) })
  it('Galatians 5:19-23 matches verse 23', () => { expect(refMatchesVerse(galRef, 'GAL', 5, 23)).toBe(true) })
  it('Galatians 5:19-23 does NOT match verse 24', () => { expect(refMatchesVerse(galRef, 'GAL', 5, 24)).toBe(false) })
})

// ── 5. extractRefsFromNote — additional book coverage ─────────────────────────

describe('extractRefsFromNote — book coverage', () => {
  it('Exodus reference', () => {
    const refs = extractRefsFromNote('See Exodus 20:3', 'Note')
    expect(refs.find(r => r.bookId === 'EXO')?.verse).toBe(3)
  })
  it('Leviticus reference', () => {
    const refs = extractRefsFromNote('Leviticus 19:18 neighbor', 'Note')
    expect(refs.find(r => r.bookId === 'LEV')?.verse).toBe(18)
  })
  it('Deuteronomy reference', () => {
    const refs = extractRefsFromNote('Deut 6:4 Shema', 'Note')
    expect(refs.find(r => r.bookId === 'DEU')?.verse).toBe(4)
  })
  it('Psalm reference', () => {
    const refs = extractRefsFromNote('Psalm 23:1 the Lord is my shepherd', 'Note')
    expect(refs.find(r => r.bookId === 'PSA')?.verse).toBe(1)
  })
  it('Proverbs reference', () => {
    const refs = extractRefsFromNote('Proverbs 3:5-6', 'Note')
    const prov = refs.find(r => r.bookId === 'PRO')
    expect(prov?.verse).toBe(5); expect(prov?.endVerse).toBe(6)
  })
  it('Isaiah reference', () => {
    const refs = extractRefsFromNote('Isaiah 40:31 mount up with wings', 'Note')
    expect(refs.find(r => r.bookId === 'ISA')?.verse).toBe(31)
  })
  it('Jeremiah reference', () => {
    const refs = extractRefsFromNote('Jer 29:11', 'Note')
    expect(refs.find(r => r.bookId === 'JER')?.verse).toBe(11)
  })
  it('Matthew reference', () => {
    const refs = extractRefsFromNote('Matthew 5:3-12 the beatitudes', 'Note')
    const mat = refs.find(r => r.bookId === 'MAT')
    expect(mat?.verse).toBe(3); expect(mat?.endVerse).toBe(12)
  })
  it('Mark reference', () => {
    const refs = extractRefsFromNote('Mark 16:15 great commission', 'Note')
    expect(refs.find(r => r.bookId === 'MRK')?.verse).toBe(15)
  })
  it('Luke reference', () => {
    const refs = extractRefsFromNote('Luke 4:18-19 Yeshua reads Isaiah', 'Note')
    const luk = refs.find(r => r.bookId === 'LUK')
    expect(luk?.verse).toBe(18); expect(luk?.endVerse).toBe(19)
  })
  it('Acts reference', () => {
    const refs = extractRefsFromNote('Acts 2:38', 'Note')
    expect(refs.find(r => r.bookId === 'ACT')?.verse).toBe(38)
  })
  it('Romans reference', () => {
    const refs = extractRefsFromNote('Romans 6:23', 'Note')
    expect(refs.find(r => r.bookId === 'ROM')?.verse).toBe(23)
  })
  it('Ephesians reference', () => {
    const refs = extractRefsFromNote('Eph 2:8-9', 'Note')
    const eph = refs.find(r => r.bookId === 'EPH')
    expect(eph?.verse).toBe(8); expect(eph?.endVerse).toBe(9)
  })
  it('Philippians reference', () => {
    const refs = extractRefsFromNote('Phil 4:13 I can do all things', 'Note')
    expect(refs.find(r => r.bookId === 'PHP')?.verse).toBe(13)
  })
  it('Colossians reference', () => {
    const refs = extractRefsFromNote('Col 3:1-4 risen with Messiah', 'Note')
    const col = refs.find(r => r.bookId === 'COL')
    expect(col?.verse).toBe(1); expect(col?.endVerse).toBe(4)
  })
  it('Hebrews reference', () => {
    const refs = extractRefsFromNote('Hebrews 4:12 the word of Yehovah', 'Note')
    expect(refs.find(r => r.bookId === 'HEB')?.verse).toBe(12)
  })
  it('James reference', () => {
    const refs = extractRefsFromNote('James 2:17-18 faith without works', 'Note')
    const jas = refs.find(r => r.bookId === 'JAS')
    expect(jas?.verse).toBe(17); expect(jas?.endVerse).toBe(18)
  })
  it('1 Peter reference', () => {
    const refs = extractRefsFromNote('1 Peter 2:9 royal priesthood', 'Note')
    expect(refs.find(r => r.bookId === '1PE')?.verse).toBe(9)
  })
  it('Revelation reference', () => {
    const refs = extractRefsFromNote('Rev 22:1-5 the river of life', 'Note')
    const rev = refs.find(r => r.bookId === 'REV')
    expect(rev?.verse).toBe(1); expect(rev?.endVerse).toBe(5)
  })
  it('1 Enoch reference', () => {
    const refs = extractRefsFromNote('1 Enoch 1:9 the judgment', 'Note')
    expect(refs.find(r => r.bookId === 'ENO')?.verse).toBe(9)
  })
  it('Jubilees reference', () => {
    const refs = extractRefsFromNote('Jubilees 2:17-25 the Sabbath', 'Note')
    const jub = refs.find(r => r.bookId === 'JUB')
    expect(jub?.verse).toBe(17); expect(jub?.endVerse).toBe(25)
  })
  it('2 Chronicles reference with range', () => {
    const refs = extractRefsFromNote('2 Chronicles 7:14-15', 'Note')
    const ch = refs.find(r => r.bookId === '2CH')
    expect(ch?.verse).toBe(14); expect(ch?.endVerse).toBe(15)
  })
  it('1 Samuel reference', () => {
    const refs = extractRefsFromNote('1 Samuel 16:7 Yehovah looks at the heart', 'Note')
    expect(refs.find(r => r.bookId === '1SA')?.verse).toBe(7)
  })
  it('2 Samuel reference with range', () => {
    const refs = extractRefsFromNote('2 Samuel 7:12-14', 'Note')
    const sa = refs.find(r => r.bookId === '2SA')
    expect(sa?.verse).toBe(12); expect(sa?.endVerse).toBe(14)
  })
  it('Song of Songs reference', () => {
    const refs = extractRefsFromNote('Song of Songs 2:1', 'Note')
    expect(refs.find(r => r.bookId === 'SNG')).toBeTruthy()
  })
  it('abbreviated book "Rom 9:21-22"', () => {
    const refs = extractRefsFromNote('Rom 9:21-22', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom?.verse).toBe(21); expect(rom?.endVerse).toBe(22)
  })
  it('abbreviated "Gal 3:1-5"', () => {
    const refs = extractRefsFromNote('Gal 3:1-5', 'Note')
    const gal = refs.find(r => r.bookId === 'GAL')
    expect(gal?.verse).toBe(1); expect(gal?.endVerse).toBe(5)
  })
  it('abbreviated "Eph 2:8-10"', () => {
    const refs = extractRefsFromNote('Eph 2:8-10', 'Note')
    const eph = refs.find(r => r.bookId === 'EPH')
    expect(eph?.verse).toBe(8); expect(eph?.endVerse).toBe(10)
  })
  it('abbreviated "Heb 11:1-3"', () => {
    const refs = extractRefsFromNote('Heb 11:1-3', 'Note')
    const heb = refs.find(r => r.bookId === 'HEB')
    expect(heb?.verse).toBe(1); expect(heb?.endVerse).toBe(3)
  })
  it('returns empty for blank content', () => {
    const refs = extractRefsFromNote('', 'Note')
    expect(refs).toHaveLength(0)
  })
  it('returns empty for non-ref prose', () => {
    const refs = extractRefsFromNote('This is a general note about prayer and fasting', 'Note')
    expect(refs).toHaveLength(0)
  })
})

// ── 6. extractRefsFromNote — edge cases ───────────────────────────────────────

describe('extractRefsFromNote — edge cases', () => {
  it('handles multiple refs in a long note body', () => {
    const content = `
      This note covers several passages.
      First see Genesis 1:1-3 for creation.
      Then Exodus 20:1-17 for the commandments.
      Finally Romans 8:28 for providence.
    `
    const refs = extractRefsFromNote(content, 'Study Note')
    const gen = refs.find(r => r.bookId === 'GEN')
    const exo = refs.find(r => r.bookId === 'EXO')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(gen?.endVerse).toBe(3)
    expect(exo?.endVerse).toBe(17)
    expect(rom?.endVerse).toBeUndefined()
    expect(rom?.verse).toBe(28)
  })

  it('does not produce endVerse for chapter-only ref mixed with range', () => {
    const refs = extractRefsFromNote('Romans 9 and Romans 9:21-22', 'Note')
    const chap = refs.find(r => r.bookId === 'ROM' && r.isChapter)
    const range = refs.find(r => r.bookId === 'ROM' && r.verse === 21)
    expect(chap?.endVerse).toBeUndefined()
    expect(range?.endVerse).toBe(22)
  })

  it('sourceNoteTitle is preserved on extracted refs', () => {
    const refs = extractRefsFromNote('John 3:16-18', 'My Study Note')
    expect(refs[0].sourceNoteTitle).toBe('My Study Note')
  })

  it('context snippet is included', () => {
    const refs = extractRefsFromNote('See John 3:16-17 for the love of Yehovah', 'Note')
    const jhn = refs.find(r => r.bookId === 'JHN')
    expect(jhn?.context).toContain('John 3:16')
  })

  it('range with only 1 verse difference: Ps 119:9-10', () => {
    const refs = extractRefsFromNote('Ps 119:9-10', 'Note')
    const psa = refs.find(r => r.bookId === 'PSA')
    expect(psa?.verse).toBe(9)
    expect(psa?.endVerse).toBe(10)
  })

  it('large verse numbers: Rev 20:11-15', () => {
    const refs = extractRefsFromNote('Rev 20:11-15 the judgment', 'Note')
    const rev = refs.find(r => r.bookId === 'REV')
    expect(rev?.verse).toBe(11)
    expect(rev?.endVerse).toBe(15)
  })

  it('verse ref followed immediately by period: "John 3:16."', () => {
    const refs = extractRefsFromNote('John 3:16.', 'Note')
    const jhn = refs.find(r => r.bookId === 'JHN')
    expect(jhn?.verse).toBe(16)
  })

  it('range followed by period: "Romans 9:21-22."', () => {
    const refs = extractRefsFromNote('Romans 9:21-22.', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom?.verse).toBe(21)
    expect(rom?.endVerse).toBe(22)
  })

  it('verse ref in parentheses: "(Romans 9:21)"', () => {
    const refs = extractRefsFromNote('(Romans 9:21)', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom?.verse).toBe(21)
  })

  it('range in parentheses: "(Romans 9:21-22)"', () => {
    const refs = extractRefsFromNote('(Romans 9:21-22)', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom?.verse).toBe(21)
    expect(rom?.endVerse).toBe(22)
  })

  it('two consecutive ranges same book: "John 3:16-17 and John 3:19-21"', () => {
    const refs = extractRefsFromNote('John 3:16-17 and John 3:19-21', 'Note')
    const all = refs.filter(r => r.bookId === 'JHN')
    expect(all).toHaveLength(2)
    const first = all.find(r => r.verse === 16)
    const second = all.find(r => r.verse === 19)
    expect(first?.endVerse).toBe(17)
    expect(second?.endVerse).toBe(21)
  })

  it('note title is not parsed for refs', () => {
    // Title-based refs are not extracted — content is what matters
    const refs = extractRefsFromNote('some generic text with no refs', 'Romans 9:21-22')
    expect(refs).toHaveLength(0)
  })

  it('wikilink with range [[Romans 9:21-22|potter]]', () => {
    const refs = extractRefsFromNote('See [[Romans 9:21-22|potter passage]]', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom?.verse).toBe(21)
  })

  it('colon separator works: "Romans 9:21-22"', () => {
    const refs = extractRefsFromNote('Romans 9:21-22', 'Note')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(rom?.chapter).toBe(9)
  })

  it('multiple ranges across different books — all extracted', () => {
    const content = 'Gen 1:1-3, Exo 20:3-17, Lev 19:18, Num 6:24-26, Deut 6:4-9'
    const refs = extractRefsFromNote(content, 'Torah')
    expect(refs.find(r => r.bookId === 'GEN')?.endVerse).toBe(3)
    expect(refs.find(r => r.bookId === 'EXO')?.endVerse).toBe(17)
    expect(refs.find(r => r.bookId === 'LEV')?.endVerse).toBeUndefined()
    expect(refs.find(r => r.bookId === 'NUM')?.endVerse).toBe(26)
    expect(refs.find(r => r.bookId === 'DEU')?.endVerse).toBe(9)
  })
})

// ── 7. refMatchesVerse — comprehensive range coverage ─────────────────────────

describe('refMatchesVerse — comprehensive range coverage', () => {
  function makeRef(bookId: string, chapter: number, verse: number, endVerse?: number) {
    return { bookId, chapter, verse, endVerse, isChapter: false, sourceNoteTitle: '', context: '' }
  }

  // Every verse inside [21,22] inclusive
  it('ROM 9:21-22 — verse 21 matches', () => expect(refMatchesVerse(makeRef('ROM', 9, 21, 22), 'ROM', 9, 21)).toBe(true))
  it('ROM 9:21-22 — verse 22 matches', () => expect(refMatchesVerse(makeRef('ROM', 9, 21, 22), 'ROM', 9, 22)).toBe(true))
  it('ROM 9:21-22 — verse 20 no match', () => expect(refMatchesVerse(makeRef('ROM', 9, 21, 22), 'ROM', 9, 20)).toBe(false))
  it('ROM 9:21-22 — verse 23 no match', () => expect(refMatchesVerse(makeRef('ROM', 9, 21, 22), 'ROM', 9, 23)).toBe(false))

  // Single verse (no endVerse) acts as exact match
  it('ROM 9:21 (no range) — verse 21 matches', () => expect(refMatchesVerse(makeRef('ROM', 9, 21), 'ROM', 9, 21)).toBe(true))
  it('ROM 9:21 (no range) — verse 22 no match', () => expect(refMatchesVerse(makeRef('ROM', 9, 21), 'ROM', 9, 22)).toBe(false))

  // Larger ranges
  it('DEU 5:6-21 — verse 10 matches', () => expect(refMatchesVerse(makeRef('DEU', 5, 6, 21), 'DEU', 5, 10)).toBe(true))
  it('DEU 5:6-21 — verse 5 no match', () => expect(refMatchesVerse(makeRef('DEU', 5, 6, 21), 'DEU', 5, 5)).toBe(false))
  it('DEU 5:6-21 — verse 22 no match', () => expect(refMatchesVerse(makeRef('DEU', 5, 6, 21), 'DEU', 5, 22)).toBe(false))

  // Cross-book non-match
  it('ISA 53:4-6 does NOT match ROM 53:5', () => expect(refMatchesVerse(makeRef('ISA', 53, 4, 6), 'ROM', 53, 5)).toBe(false))

  // Chapter 0 / verse 0 edge
  it('verse=0 ref (chapter ref) matches verse 1', () => {
    const chRef = { ...makeRef('GEN', 1, 0), isChapter: true }
    expect(refMatchesVerse(chRef, 'GEN', 1, 1)).toBe(true)
  })
  it('verse=0 ref (chapter ref) matches verse 99', () => {
    const chRef = { ...makeRef('GEN', 1, 0), isChapter: true }
    expect(refMatchesVerse(chRef, 'GEN', 1, 99)).toBe(true)
  })

  // Range of 1 (start === end)
  it('JHN 3:16-16 matches verse 16', () => expect(refMatchesVerse(makeRef('JHN', 3, 16, 16), 'JHN', 3, 16)).toBe(true))
  it('JHN 3:16-16 does NOT match verse 17', () => expect(refMatchesVerse(makeRef('JHN', 3, 16, 16), 'JHN', 3, 17)).toBe(false))

  // Boundary at verse 1
  it('GEN 1:1-5 matches verse 1', () => expect(refMatchesVerse(makeRef('GEN', 1, 1, 5), 'GEN', 1, 1)).toBe(true))
  it('GEN 1:1-5 does NOT match verse 0', () => expect(refMatchesVerse(makeRef('GEN', 1, 1, 5), 'GEN', 1, 0)).toBe(false))

  // Extra checks on Titus 2:11-14
  it('TIT 2:11-14 — verse 11 matches', () => expect(refMatchesVerse(makeRef('TIT', 2, 11, 14), 'TIT', 2, 11)).toBe(true))
  it('TIT 2:11-14 — verse 14 matches', () => expect(refMatchesVerse(makeRef('TIT', 2, 11, 14), 'TIT', 2, 14)).toBe(true))
  it('TIT 2:11-14 — verse 15 no match', () => expect(refMatchesVerse(makeRef('TIT', 2, 11, 14), 'TIT', 2, 15)).toBe(false))
  it('TIT 2:11-14 — wrong chapter no match', () => expect(refMatchesVerse(makeRef('TIT', 2, 11, 14), 'TIT', 3, 11)).toBe(false))

  // Isaiah 53:4-6
  it('ISA 53:4-6 — verse 4 matches', () => expect(refMatchesVerse(makeRef('ISA', 53, 4, 6), 'ISA', 53, 4)).toBe(true))
  it('ISA 53:4-6 — verse 5 matches', () => expect(refMatchesVerse(makeRef('ISA', 53, 4, 6), 'ISA', 53, 5)).toBe(true))
  it('ISA 53:4-6 — verse 6 matches', () => expect(refMatchesVerse(makeRef('ISA', 53, 4, 6), 'ISA', 53, 6)).toBe(true))
  it('ISA 53:4-6 — verse 3 no match', () => expect(refMatchesVerse(makeRef('ISA', 53, 4, 6), 'ISA', 53, 3)).toBe(false))
  it('ISA 53:4-6 — verse 7 no match', () => expect(refMatchesVerse(makeRef('ISA', 53, 4, 6), 'ISA', 53, 7)).toBe(false))

  // Revelation 21:1-5
  it('REV 21:1-5 — verse 3 matches', () => expect(refMatchesVerse(makeRef('REV', 21, 1, 5), 'REV', 21, 3)).toBe(true))
  it('REV 21:1-5 — verse 6 no match', () => expect(refMatchesVerse(makeRef('REV', 21, 1, 5), 'REV', 21, 6)).toBe(false))

  // Cross-verse, cross-chapter non-match
  it('JHN 3:16 vs JHN 4:16 — no match', () => expect(refMatchesVerse(makeRef('JHN', 3, 16), 'JHN', 4, 16)).toBe(false))

  // Psalm 119:9-16
  it('PSA 119:9-16 — verse 9 matches', () => expect(refMatchesVerse(makeRef('PSA', 119, 9, 16), 'PSA', 119, 9)).toBe(true))
  it('PSA 119:9-16 — verse 16 matches', () => expect(refMatchesVerse(makeRef('PSA', 119, 9, 16), 'PSA', 119, 16)).toBe(true))
  it('PSA 119:9-16 — verse 8 no match', () => expect(refMatchesVerse(makeRef('PSA', 119, 9, 16), 'PSA', 119, 8)).toBe(false))
  it('PSA 119:9-16 — verse 17 no match', () => expect(refMatchesVerse(makeRef('PSA', 119, 9, 16), 'PSA', 119, 17)).toBe(false))
})

// ── 8. Verse-text match ratio direction (sensitivity bug) ────────────────────
// The verse-block check measures how much of the ACTUAL VERSE is present in the
// typed text: verseTextMatchRatio(actualVerse, typedText).

describe('verseTextMatchRatio — verse-coverage direction', () => {
  // Genesis 1:5 (KJV) — the real verse text
  const GEN_1_5 = 'And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day'

  it('a short comment reusing common words scores LOW (the reported bug)', () => {
    const ratio = verseTextMatchRatio(GEN_1_5, 'the the')
    expect(ratio).toBeLessThan(0.9)
  })

  it('the full actual verse scores 1.0', () => {
    expect(verseTextMatchRatio(GEN_1_5, GEN_1_5)).toBe(1)
  })

  it('most of the verse present scores high', () => {
    const almost = GEN_1_5.split(' ').slice(0, -2).join(' ')
    expect(verseTextMatchRatio(GEN_1_5, almost)).toBeGreaterThan(0.8)
  })

  it('a few words of the verse scores below 0.9 threshold', () => {
    expect(verseTextMatchRatio(GEN_1_5, 'And God called the light')).toBeLessThan(0.9)
  })

  it('unrelated commentary scores near 0', () => {
    expect(verseTextMatchRatio(GEN_1_5, 'my own thoughts about creation')).toBeLessThan(0.3)
  })
})

// ── 9. Ambiguous-guard regression — words that only resolve via resolveBookToken's
// prefix/fuzzy tiers (e.g. "to" -> Tobit, "so" -> Song of Songs) must not be
// trusted as real refs unless capitalised or followed by a chapter:verse colon,
// same as the curated AMBIGUOUS_PATTERNS words (see isExactBookToken in parseRef.ts).

describe('extractRefsFromNote — prefix/fuzzy-tier ambiguous words (the reported "to 2" bug)', () => {
  it('lowercase, no colon: does not link', () => {
    expect(extractRefsFromNote('I need to 2 things before we leave', 'Note')).toHaveLength(0)
    expect(extractRefsFromNote('this is so 2 much fun', 'Note')).toHaveLength(0)
    expect(extractRefsFromNote('as 2 witnesses testified', 'Note')).toHaveLength(0)
    expect(extractRefsFromNote('he 2 times denied it', 'Note')).toHaveLength(0)
    expect(extractRefsFromNote('be 2 minutes late', 'Note')).toHaveLength(0)
    expect(extractRefsFromNote('every man 5 cubits tall', 'Note')).toHaveLength(0)
  })

  it('capitalised: still links (book names are always capitalised when meant literally)', () => {
    expect(extractRefsFromNote('See To 2 for the reference', 'Note')[0]?.bookId).toBe('TOB')
  })

  it('with a chapter:verse colon: still links even lowercase', () => {
    expect(extractRefsFromNote('quoting to 2:1 here', 'Note')[0]?.bookId).toBe('TOB')
    expect(extractRefsFromNote('so 2:1 says', 'Note')[0]?.bookId).toBe('SNG')
  })

  it('legitimate common abbreviations already in AMBIGUOUS_PATTERNS are unaffected', () => {
    expect(extractRefsFromNote('landed the job 3 weeks ago', 'Note')).toHaveLength(0)
    expect(extractRefsFromNote('Job 3 speaks of despair', 'Note')[0]?.bookId).toBe('JOB')
  })

  it('legitimate multi-word full names typed lowercase still link (regression check)', () => {
    expect(extractRefsFromNote('reading song of songs 2:1 tonight', 'Note')[0]?.bookId).toBe('SNG')
  })
})

// ── 10. Recognitions of Clement — "Book N" subdivision auto-linking ────────────
// RCL's real addressing is 3-level Book.Chapter.Verse. The pretty form ("Recognitions,
// Book 10 41:8") must resolve to the same book id as the existing fused shorthand
// ("RCL10 41:8"), and the dash-free book name ("Recognitions, Book 10") must not
// itself break linking (the old " - " name did).

describe('extractRefsFromNote — Recognitions of Clement "Book N" subdivision', () => {
  it('"Recognitions, Book 10 41:8" links to RCL10 41:8', () => {
    const refs = extractRefsFromNote('See Recognitions, Book 10 41:8 on this.', 'Note')
    const r = refs.find(r => r.bookId === 'RCL10')
    expect(r).toBeTruthy()
    expect(r!.chapter).toBe(41)
    expect(r!.verse).toBe(8)
  })

  it('"Recognitions Book 10 41:8" (no comma) links the same way', () => {
    const refs = extractRefsFromNote('See Recognitions Book 10 41:8 on this.', 'Note')
    const r = refs.find(r => r.bookId === 'RCL10')
    expect(r).toBeTruthy()
    expect(r!.chapter).toBe(41)
    expect(r!.verse).toBe(8)
  })

  it('"RCL10 41:8" fused shorthand still resolves to the same book/chapter/verse', () => {
    const refs = extractRefsFromNote('See RCL10 41:8 on this.', 'Note')
    const r = refs.find(r => r.bookId === 'RCL10')
    expect(r).toBeTruthy()
    expect(r!.chapter).toBe(41)
    expect(r!.verse).toBe(8)
  })

  it('bare "Recognitions of Clement 5:3" (no Book N) defaults to Book 1', () => {
    const refs = extractRefsFromNote('quoting Recognitions of Clement 5:3 here', 'Note')
    const r = refs.find(r => r.bookId === 'RCL1')
    expect(r).toBeTruthy()
    expect(r!.chapter).toBe(5)
    expect(r!.verse).toBe(3)
  })
})

// ── Comma-grouped verse lists → one NoteVerseRef per segment ─────────────────

describe('extractRefsFromNote — comma-grouped verse lists', () => {
  it('"Deuteronomy 32:3,6,9-13,23,25" emits one row per segment', () => {
    const refs = extractRefsFromNote('See Deuteronomy 32:3,6,9-13,23,25 for the song', 'Note')
    const deu = refs.filter(r => r.bookId === 'DEU' && r.chapter === 32)
    expect(deu.map(r => [r.verse, r.endVerse ?? null])).toEqual([
      [3, null], [6, null], [9, 13], [23, null], [25, null],
    ])
  })

  it('refMatchesVerse matches a verse in ANY segment', () => {
    const refs = extractRefsFromNote('Deuteronomy 32:3-4,6,9-13', 'Note')
    const hit = (v: number) => refs.some(r => refMatchesVerse(r, 'DEU', 32, v))
    expect(hit(3)).toBe(true)   // first group (range 3-4)
    expect(hit(4)).toBe(true)
    expect(hit(6)).toBe(true)   // single
    expect(hit(11)).toBe(true)  // second range 9-13
    expect(hit(5)).toBe(false)  // gap between groups
    expect(hit(14)).toBe(false)
  })
})

// ── Trailing " LXX" marker → lxx flag on the row ────────────────────────────

describe('extractRefsFromNote — LXX marker', () => {
  it('flags a plain "Isaiah 6:4 LXX" ref as lxx', () => {
    const refs = extractRefsFromNote('Compare Isaiah 6:4 LXX with the Hebrew', 'Note')
    const isa = refs.find(r => r.bookId === 'ISA' && r.chapter === 6)
    expect(isa).toBeTruthy()
    expect(isa!.verse).toBe(4)
    expect(isa!.lxx).toBe(true)
  })

  it('a non-LXX ref has no lxx flag', () => {
    const refs = extractRefsFromNote('See Isaiah 6:4 here', 'Note')
    expect(refs.find(r => r.bookId === 'ISA')!.lxx).toBeUndefined()
  })

  it('LXX and non-LXX refs to the same verse are distinct rows', () => {
    const refs = extractRefsFromNote('Isaiah 6:4 and also Isaiah 6:4 LXX', 'Note')
    const isa = refs.filter(r => r.bookId === 'ISA' && r.chapter === 6 && r.verse === 4)
    expect(isa.length).toBe(2)
    expect(isa.some(r => r.lxx)).toBe(true)
    expect(isa.some(r => !r.lxx)).toBe(true)
  })
})
