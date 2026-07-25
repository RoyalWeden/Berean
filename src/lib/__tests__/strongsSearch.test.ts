import { describe, it, expect } from 'vitest'
import { parseStrongsQuery, isStrongsQuery, splitStrongsHighlight, parseMultiStrongsQuery, searchMultiStrongs } from '../strongsSearch'

describe('parseStrongsQuery', () => {
  it('normalizes case and prefixes', () => {
    expect(parseStrongsQuery('g5485')).toBe('G5485')
    expect(parseStrongsQuery('H1319')).toBe('H1319')
    expect(parseStrongsQuery('  h7225 ')).toBe('H7225')
  })
  it('accepts an optional space and strips leading zeros', () => {
    expect(parseStrongsQuery('H 1319')).toBe('H1319')
    expect(parseStrongsQuery('h0001')).toBe('H1')
    expect(parseStrongsQuery('G 0003')).toBe('G3')
  })
  it('rejects non-Strong\'s queries', () => {
    expect(parseStrongsQuery('in the beginning')).toBeNull()
    expect(parseStrongsQuery('grace')).toBeNull()      // starts with g but not a number
    expect(parseStrongsQuery('h')).toBeNull()
    expect(parseStrongsQuery('1319')).toBeNull()       // no prefix
    expect(parseStrongsQuery('g0')).toBeNull()
    expect(parseStrongsQuery('x1234')).toBeNull()
  })
})

describe('isStrongsQuery', () => {
  it('matches parseStrongsQuery', () => {
    expect(isStrongsQuery('g5485')).toBe(true)
    expect(isStrongsQuery('hello')).toBe(false)
  })
})

describe('splitStrongsHighlight', () => {
  it('flags the words at the given indices', () => {
    const segs = splitStrongsHighlight('In the beginning God created', [3])
    expect(segs.map((s) => s.text)).toEqual(['In', 'the', 'beginning', 'God', 'created'])
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['God'])
  })
  it('supports multiple matches and reconstructs the text', () => {
    const segs = splitStrongsHighlight('a b c d', [0, 2])
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['a', 'c'])
    expect(segs.map((s) => s.text).join(' ')).toBe('a b c d')
  })
  it('handles no matches', () => {
    expect(splitStrongsHighlight('a b', []).every((s) => !s.match)).toBe(true)
  })
  it('also flags extraWords by text, alongside index matches — combined "G5485 god" search', () => {
    const segs = splitStrongsHighlight('For by grace are ye saved, through faith; and that not of God', [2], ['god'])
    // index 2 ("grace") from the Strong's match, plus "God" (punctuation-stripped, case-insensitive) from extraWords
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['grace', 'God'])
  })
  it('extraWords alone (no index matches) still highlights by text', () => {
    const segs = splitStrongsHighlight('grace and peace to you', [], ['peace'])
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['peace'])
  })
})

describe('parseMultiStrongsQuery', () => {
  it('parses a single bare Strong\'s number (superset of parseStrongsQuery)', () => {
    expect(parseMultiStrongsQuery('g5485')).toEqual({ strongsNums: ['G5485'], words: [] })
  })
  it('parses multiple Strong\'s numbers as an AND combination', () => {
    expect(parseMultiStrongsQuery('g5485 g54')).toEqual({ strongsNums: ['G5485', 'G54'], words: [] })
  })
  it('parses a Strong\'s number combined with a plain word', () => {
    expect(parseMultiStrongsQuery('g5485 jacob')).toEqual({ strongsNums: ['G5485'], words: ['jacob'] })
  })
  it('returns null when there is no Strong\'s-number token at all', () => {
    expect(parseMultiStrongsQuery('jacob wept')).toBeNull()
    expect(parseMultiStrongsQuery('')).toBeNull()
  })
})

describe('searchMultiStrongs', () => {
  const row = (book_id: string, chapter: number, verse_num: number, text: string, matchWordIndices: number[]) =>
    ({ book_id, chapter, verse_num, text, matchWordIndices })

  it('ANDs multiple Strong\'s numbers — only verses carrying every number match', async () => {
    const g5485 = [row('ROM', 1, 1, 'grace to you', [0]), row('ROM', 1, 2, 'grace only', [0])]
    const g54 = [row('ROM', 1, 1, 'grace to you', [2])]
    const getOccurrences = async (n: string) => (n === 'G5485' ? g5485 : g54)
    const result = await searchMultiStrongs({ strongsNums: ['G5485', 'G54'], words: [] }, getOccurrences)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ book_id: 'ROM', chapter: 1, verse_num: 1 })
    // Highlight indices union across both matched numbers for that verse.
    expect(result[0].matchWordIndices.sort()).toEqual([0, 2])
  })

  it('further filters by plain words (case-insensitive substring, all required)', async () => {
    const occ = [row('ROM', 1, 1, 'grace and Jacob', [0]), row('ROM', 1, 2, 'grace and Esau', [0])]
    const getOccurrences = async () => occ
    const result = await searchMultiStrongs({ strongsNums: ['G5485'], words: ['jacob'] }, getOccurrences)
    expect(result).toHaveLength(1)
    expect(result[0].verse_num).toBe(1)
  })

  it('returns nothing when no verse satisfies every AND condition', async () => {
    const getOccurrences = async (n: string) =>
      n === 'G5485' ? [row('ROM', 1, 1, 'a', [0])] : [row('ROM', 2, 2, 'b', [0])]
    const result = await searchMultiStrongs({ strongsNums: ['G5485', 'G54'], words: [] }, getOccurrences)
    expect(result).toEqual([])
  })
})
