import { describe, it, expect } from 'vitest'
import { scanTagRefs, buildKnownTagIndex } from '@/lib/tagRefScan'

describe('scanTagRefs', () => {
  const known = ['Second Temple', 'Temple', 'Church', 'Church History']

  it('matches a single-word known tag', () => {
    const hits = scanTagRefs('see #Temple here', known)
    expect(hits).toEqual([{ index: 4, length: 7, name: 'Temple', known: true }])
  })

  it('greedily matches the longest known multi-word tag', () => {
    const hits = scanTagRefs('the #Second Temple period', known)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ name: 'Second Temple', known: true, index: 4, length: 14 })
  })

  it('returns the canonical stored casing regardless of typed case', () => {
    const hits = scanTagRefs('a #second temple b', known)
    expect(hits[0].name).toBe('Second Temple')
  })

  it('stops at a word boundary — #Church does not eat the following word', () => {
    const hits = scanTagRefs('#Church zeal', known)
    expect(hits[0]).toMatchObject({ name: 'Church', length: 7 })
  })

  it('prefers "Church History" over "Church" when both fit', () => {
    const hits = scanTagRefs('#Church History matters', known)
    expect(hits[0].name).toBe('Church History')
  })

  it('falls back to a single token for an unknown tag', () => {
    const hits = scanTagRefs('a #unknown-tag b', known)
    expect(hits[0]).toEqual({ index: 2, length: 12, name: 'unknown-tag', known: false })
  })

  it('ignores a "#" in the middle of a word', () => {
    expect(scanTagRefs('foo#Temple', known)).toEqual([])
  })

  it('matches after an opening paren', () => {
    const hits = scanTagRefs('(#Temple)', known)
    expect(hits[0].name).toBe('Temple')
  })

  it('accepts a prebuilt index', () => {
    const idx = buildKnownTagIndex(known)
    expect(scanTagRefs('#Temple', idx)[0].name).toBe('Temple')
  })

  it('finds multiple hits in one string', () => {
    const hits = scanTagRefs('#Temple and #Church', known)
    expect(hits.map((h) => h.name)).toEqual(['Temple', 'Church'])
  })
})
