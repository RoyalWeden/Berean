import { describe, it, expect } from 'vitest'
import { buildCrossRefSources, reciprocalRefsFor, flagReciprocalVerses, flagReciprocalChapterRefs, chapterCrossRefSources } from '@/lib/crossRefIndex'

// Helper to build a minimal note
const note = (verseRef: string | null, content: string, title = 'note') => ({ verseRef, content, title })

describe('buildCrossRefSources', () => {
  it('parses a verse note into a source with its refs', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'see Exodus 20:11 for the Sabbath')])
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ homeBookId: 'GEN', homeChapter: 1, homeVerse: 1 })
    expect(sources[0].refs.some(r => r.bookId === 'EXO' && r.chapter === 20 && r.verse === 11)).toBe(true)
  })

  it('skips general notes (no verseRef)', () => {
    expect(buildCrossRefSources([note(null, 'mentions Exodus 20:11')])).toHaveLength(0)
  })

  it('skips verse notes with no refs in their content', () => {
    expect(buildCrossRefSources([note('GEN.1.1', 'just some thoughts')])).toHaveLength(0)
  })

  it('skips malformed verseRefs', () => {
    expect(buildCrossRefSources([note('GEN', 'Exodus 20:11')])).toHaveLength(0)
    expect(buildCrossRefSources([note('GEN.1', 'Exodus 20:11')])).toHaveLength(0)
  })

  it('handles multiple notes', () => {
    const sources = buildCrossRefSources([
      note('GEN.1.1', 'cf Exodus 20:11'),
      note('JHN.1.1', 'cf Genesis 1:1'),
    ])
    expect(sources).toHaveLength(2)
  })
})

describe('reciprocalRefsFor — backward lookup', () => {
  it('finds the home verse of a note that references the target verse', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'see Exodus 20:11', 'Creation/Sabbath')])
    const back = reciprocalRefsFor(sources, 'EXO', 20, 11)
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ bookId: 'GEN', chapter: 1, verse: 1, sourceNoteTitle: 'Creation/Sabbath' })
  })

  it('matches abbreviated reference forms', () => {
    for (const form of ['Exod 20:11', 'Ex 20:11', 'Exodus 20:11', '[[Exod 20:11]]']) {
      const sources = buildCrossRefSources([note('GEN.1.1', `cf ${form}`)])
      const back = reciprocalRefsFor(sources, 'EXO', 20, 11)
      expect(back, `form="${form}"`).toHaveLength(1)
    }
  })

  it('matches a verse inside a referenced range', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'Romans 9:21-23')])
    expect(reciprocalRefsFor(sources, 'ROM', 9, 22)).toHaveLength(1)
    expect(reciprocalRefsFor(sources, 'ROM', 9, 24)).toHaveLength(0)
  })

  it('matches any verse when the reference is a whole chapter', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'see Genesis 5')])
    expect(reciprocalRefsFor(sources, 'GEN', 5, 1)).toHaveLength(1)
    expect(reciprocalRefsFor(sources, 'GEN', 5, 27)).toHaveLength(1)
  })

  it('does not return a note pointing at its own verse', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'Genesis 1:1 is the start')])
    expect(reciprocalRefsFor(sources, 'GEN', 1, 1)).toHaveLength(0)
  })

  it('deduplicates multiple refs from the same source note', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'Exodus 20:11 and again Exod 20:11')])
    expect(reciprocalRefsFor(sources, 'EXO', 20, 11)).toHaveLength(1)
  })

  it('returns nothing for an unreferenced verse', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'see Exodus 20:11')])
    expect(reciprocalRefsFor(sources, 'LEV', 1, 1)).toHaveLength(0)
  })

  it('aggregates multiple distinct source notes pointing at the same verse', () => {
    const sources = buildCrossRefSources([
      note('GEN.1.1', 'cf Exodus 20:11', 'A'),
      note('PSA.19.1', 'cf Exod 20:11', 'B'),
    ])
    const back = reciprocalRefsFor(sources, 'EXO', 20, 11)
    expect(back).toHaveLength(2)
    expect(back.map(b => b.bookId).sort()).toEqual(['GEN', 'PSA'])
  })
})

describe('reciprocalRefsFor — excludeChapterRefs option', () => {
  const sources = buildCrossRefSources([
    note('GEN.1.1', 'see Numbers 5'),          // chapter-level ref
    note('PSA.19.1', 'Numbers 5:11 specifically'), // verse-specific ref
  ])

  it('without flag: chapter refs appear alongside verse refs', () => {
    const back = reciprocalRefsFor(sources, 'NUM', 5, 11)
    expect(back).toHaveLength(2)
  })

  it('with excludeChapterRefs=true: only verse-specific refs returned', () => {
    const back = reciprocalRefsFor(sources, 'NUM', 5, 11, true)
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ bookId: 'PSA', chapter: 19, verse: 1 })
  })

  it('with excludeChapterRefs=true on a verse only cited by chapter ref: returns empty', () => {
    const chapterOnlySources = buildCrossRefSources([note('GEN.1.1', 'see Numbers 5')])
    expect(reciprocalRefsFor(chapterOnlySources, 'NUM', 5, 11, true)).toHaveLength(0)
  })

  it('verse-specific ref still appears with excludeChapterRefs=true even when same note also has a chapter ref', () => {
    const mixed = buildCrossRefSources([
      note('GEN.1.1', 'see Numbers 5 broadly, and Numbers 5:11 specifically'),
    ])
    const back = reciprocalRefsFor(mixed, 'NUM', 5, 11, true)
    expect(back).toHaveLength(1) // the note has both types but the verse ref qualifies it
  })
})

describe('chapterCrossRefSources', () => {
  it('returns sources that reference the whole chapter', () => {
    const sources = buildCrossRefSources([
      note('GEN.1.1', 'see Numbers 5'),
      note('PSA.19.1', 'Numbers 5:11'),
    ])
    const ch = chapterCrossRefSources(sources, 'NUM', 5)
    expect(ch).toHaveLength(1)
    expect(ch[0]).toMatchObject({ homeBookId: 'GEN', homeChapter: 1, homeVerse: 1 })
  })

  it('returns empty when no notes reference the chapter broadly', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'Numbers 5:11')])
    expect(chapterCrossRefSources(sources, 'NUM', 5)).toHaveLength(0)
  })

  it('a note referencing both verse and chapter is included (has a chapter ref)', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'see Numbers 5 and Numbers 5:11')])
    expect(chapterCrossRefSources(sources, 'NUM', 5)).toHaveLength(1)
  })

  it('does not bleed into adjacent chapters', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'Numbers 5')])
    expect(chapterCrossRefSources(sources, 'NUM', 4)).toHaveLength(0)
    expect(chapterCrossRefSources(sources, 'NUM', 6)).toHaveLength(0)
  })

  it('multiple sources all returned when each references the chapter', () => {
    const sources = buildCrossRefSources([
      note('GEN.1.1', 'Numbers 5'),
      note('HOS.4.14', 'see also Numbers 5'),
    ])
    expect(chapterCrossRefSources(sources, 'NUM', 5)).toHaveLength(2)
  })
})

describe('flagReciprocalVerses', () => {
  it('flags a single referenced verse in the chapter', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'cf Exodus 20:11')])
    const flags = flagReciprocalVerses(sources, 'EXO', 20, [10, 11, 12], {})
    expect(flags[11]).toBe(true)
    expect(flags[10]).toBeUndefined()
  })

  it('flags every verse covered by a range', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'Exodus 20:8-11')])
    const flags = flagReciprocalVerses(sources, 'EXO', 20, [7, 8, 9, 10, 11, 12], {})
    expect([8, 9, 10, 11].every(v => flags[v])).toBe(true)
    expect(flags[7]).toBeUndefined()
    expect(flags[12]).toBeUndefined()
  })

  it('flags all chapter verses for a whole-chapter ref', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'see Exodus 20')])
    const flags = flagReciprocalVerses(sources, 'EXO', 20, [1, 2, 3], {})
    expect(flags[1] && flags[2] && flags[3]).toBe(true)
  })

  it('does not flag verses in a different chapter', () => {
    const sources = buildCrossRefSources([note('GEN.1.1', 'cf Exodus 20:11')])
    const flags = flagReciprocalVerses(sources, 'EXO', 19, [1, 11, 20], {})
    expect(Object.keys(flags)).toHaveLength(0)
  })

  it('merges into an existing flags object (forward + backward)', () => {
    const sources = buildCrossRefSources([note('EXO.20.1', 'cf Exodus 20:11')])
    const flags: Record<number, boolean> = { 1: true } // pretend forward already flagged v1
    flagReciprocalVerses(sources, 'EXO', 20, [1, 11], flags)
    expect(flags[1]).toBe(true)
    expect(flags[11]).toBe(true)
  })
})

// ── User scenario tests: Hosea 4:14 ↔ Numbers 5:11 ──────────────────────────

describe('user scenario — note on Hosea 4:14 mentions Numbers 5:11', () => {
  // Build sources once for all tests in this suite
  const sources = buildCrossRefSources([
    note('HOS.4.14', 'Compare with Numbers 5:11 regarding harlotry and jealousy offering', 'Hosea 4:14 study'),
  ])

  it('buildCrossRefSources parses the note into a source on HOS.4.14', () => {
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ homeBookId: 'HOS', homeChapter: 4, homeVerse: 14 })
  })

  it('the source contains a ref pointing at NUM 5:11', () => {
    const ref = sources[0].refs.find(r => r.bookId === 'NUM' && r.chapter === 5 && r.verse === 11)
    expect(ref).toBeDefined()
  })

  it('reciprocalRefsFor returns HOS 4:14 when querying NUM 5:11', () => {
    const back = reciprocalRefsFor(sources, 'NUM', 5, 11)
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ bookId: 'HOS', chapter: 4, verse: 14 })
  })

  it('flagReciprocalVerses flags verse 11 when rendering Numbers 5', () => {
    const verseNums = Array.from({ length: 31 }, (_, i) => i + 1)
    const flags = flagReciprocalVerses(sources, 'NUM', 5, verseNums, {})
    expect(flags[11]).toBe(true)
    // Other verses are not flagged
    expect(flags[10]).toBeUndefined()
    expect(flags[12]).toBeUndefined()
  })

  it('does NOT flag any verse in Numbers 5 as a chapter-level cross-ref (this is verse-specific)', () => {
    const verseNums = Array.from({ length: 31 }, (_, i) => i + 1)
    const chapterFlags = flagReciprocalChapterRefs(sources, 'NUM', 5, verseNums, {})
    expect(Object.keys(chapterFlags)).toHaveLength(0)
  })

  it('Hosea 4:14 itself is not returned as a backward ref when querying HOS 4:14 (self-ref excluded)', () => {
    const sourcesWithSelf = buildCrossRefSources([
      note('HOS.4.14', 'Hosea 4:14 and Numbers 5:11', 'note'),
    ])
    expect(reciprocalRefsFor(sourcesWithSelf, 'HOS', 4, 14)).toHaveLength(0)
  })

  it('Numbers 5:1 and 5:28 are NOT flagged (verse-specific ref only hits v11)', () => {
    const flags = flagReciprocalVerses(sources, 'NUM', 5, [1, 11, 28], {})
    expect(flags[1]).toBeUndefined()
    expect(flags[28]).toBeUndefined()
  })
})

// ── Verse range cross-refs ───────────────────────────────────────────────────

describe('verse range cross-refs', () => {
  it('Numbers 5:11-28 as a range flags every verse 11–28', () => {
    const sources = buildCrossRefSources([
      note('HOS.4.14', 'The jealousy law in Numbers 5:11-28', 'jealousy offering'),
    ])
    const allNums5 = Array.from({ length: 31 }, (_, i) => i + 1)
    const flags = flagReciprocalVerses(sources, 'NUM', 5, allNums5, {})
    for (let v = 11; v <= 28; v++) expect(flags[v], `v${v}`).toBe(true)
    expect(flags[10]).toBeUndefined()
    expect(flags[29]).toBeUndefined()
  })

  it('verse range with em-dash (11–28) works identically', () => {
    const sources = buildCrossRefSources([
      note('HOS.4.14', 'Numbers 5:11–28 jealousy offering'),
    ])
    const flags = flagReciprocalVerses(sources, 'NUM', 5, [10, 11, 20, 28, 29], {})
    expect(flags[11]).toBe(true)
    expect(flags[20]).toBe(true)
    expect(flags[28]).toBe(true)
    expect(flags[10]).toBeUndefined()
    expect(flags[29]).toBeUndefined()
  })

  it('a verse inside a referenced range is included in reciprocalRefsFor', () => {
    const sources = buildCrossRefSources([note('HOS.4.14', 'Numbers 5:11-28')])
    expect(reciprocalRefsFor(sources, 'NUM', 5, 15)).toHaveLength(1)
    expect(reciprocalRefsFor(sources, 'NUM', 5, 29)).toHaveLength(0)
  })

  it('range refs do NOT appear in flagReciprocalChapterRefs', () => {
    const sources = buildCrossRefSources([note('HOS.4.14', 'Numbers 5:11-28')])
    const chapterFlags = flagReciprocalChapterRefs(sources, 'NUM', 5, [11, 15, 28], {})
    expect(Object.keys(chapterFlags)).toHaveLength(0)
  })

  it('multiple source notes with overlapping ranges all contribute flags', () => {
    const sources = buildCrossRefSources([
      note('GEN.1.1', 'Numbers 5:1-10'),
      note('HOS.4.14', 'Numbers 5:11-28'),
    ])
    const allNums5 = Array.from({ length: 31 }, (_, i) => i + 1)
    const flags = flagReciprocalVerses(sources, 'NUM', 5, allNums5, {})
    for (let v = 1; v <= 28; v++) expect(flags[v], `v${v}`).toBe(true)
    expect(flags[29]).toBeUndefined()
  })
})

// ── Whole-chapter cross-refs (distinct display path) ─────────────────────────

describe('whole-chapter cross-refs — flagReciprocalChapterRefs', () => {
  it('a note saying "Numbers 5" flags every verse in Numbers 5 as a chapter ref', () => {
    const sources = buildCrossRefSources([
      note('HOS.4.14', 'See the jealousy law in Numbers 5 for context'),
    ])
    const verseNums = [1, 5, 11, 20, 28, 31]
    const chapterFlags = flagReciprocalChapterRefs(sources, 'NUM', 5, verseNums, {})
    for (const v of verseNums) expect(chapterFlags[v], `v${v}`).toBe(true)
  })

  it('chapter ref also appears in flagReciprocalVerses (chapter refs flag all verses there too)', () => {
    const sources = buildCrossRefSources([note('HOS.4.14', 'Numbers 5')])
    const verseNums = [1, 11, 31]
    const flags = flagReciprocalVerses(sources, 'NUM', 5, verseNums, {})
    for (const v of verseNums) expect(flags[v], `v${v}`).toBe(true)
  })

  it('chapter ref does NOT bleed into adjacent chapters', () => {
    const sources = buildCrossRefSources([note('HOS.4.14', 'Numbers 5')])
    const flags4 = flagReciprocalChapterRefs(sources, 'NUM', 4, [1, 10, 49], {})
    const flags6 = flagReciprocalChapterRefs(sources, 'NUM', 6, [1, 10, 27], {})
    expect(Object.keys(flags4)).toHaveLength(0)
    expect(Object.keys(flags6)).toHaveLength(0)
  })

  it('a verse ref in the same note does not contaminate chapter flags', () => {
    const sources = buildCrossRefSources([
      // verse-specific ref to Exo 20:11 — should NOT appear in chapter flags for Exo 20
      note('GEN.1.1', 'see Exodus 20:11 for the Sabbath'),
    ])
    const chapterFlags = flagReciprocalChapterRefs(sources, 'EXO', 20, [10, 11, 12], {})
    expect(Object.keys(chapterFlags)).toHaveLength(0)
  })

  it('verse-specific flags and chapter flags are independent and both accurate', () => {
    const sources = buildCrossRefSources([
      note('GEN.1.1', 'Numbers 5:11 specifically'),  // verse ref
      note('PSA.19.1', 'see Numbers 5 broadly'),     // chapter ref
    ])
    const verseNums = [1, 11, 28]

    const verseFlags = flagReciprocalVerses(sources, 'NUM', 5, verseNums, {})
    const chapterFlags = flagReciprocalChapterRefs(sources, 'NUM', 5, verseNums, {})

    // verse-specific source flags only v11
    expect(verseFlags[11]).toBe(true)
    expect(verseFlags[1]).toBe(true)   // also true because the chapter ref contributes to flagReciprocalVerses
    // chapter source flags all
    expect(chapterFlags[1]).toBe(true)
    expect(chapterFlags[11]).toBe(true)
    expect(chapterFlags[28]).toBe(true)
  })

  it('reciprocalRefsFor returns the home verse for a chapter-level ref', () => {
    const sources = buildCrossRefSources([note('PSA.19.1', 'see Numbers 5')])
    const back = reciprocalRefsFor(sources, 'NUM', 5, 11)
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ bookId: 'PSA', chapter: 19, verse: 1 })
  })
})
