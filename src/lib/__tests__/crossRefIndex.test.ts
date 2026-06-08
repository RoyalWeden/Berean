import { describe, it, expect } from 'vitest'
import { buildCrossRefSources, reciprocalRefsFor, flagReciprocalVerses } from '@/lib/crossRefIndex'

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
