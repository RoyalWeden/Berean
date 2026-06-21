import { describe, it, expect } from 'vitest'
import { parseStrongsQuery, isStrongsQuery, splitStrongsHighlight } from '../strongsSearch'

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
})
