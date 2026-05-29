import { describe, it, expect } from 'vitest'
import { getWordWindow, normalizeBookQuery, extractGlossWords, findMatchWordIndices } from '../verseUtils'

// ─── getWordWindow ─────────────────────────────────────────────────────────────

describe('getWordWindow', () => {
  it('returns null when no match indices provided', () => {
    expect(getWordWindow('The quick brown fox', [])).toBeNull()
    expect(getWordWindow('The quick brown fox', undefined)).toBeNull()
  })

  it('returns null when first match is within first 10 words (no windowing needed)', () => {
    const text = 'In the beginning God created the heavens and the earth'
    // word index 2 = "beginning" — within first 10 words
    expect(getWordWindow(text, [2])).toBeNull()
    expect(getWordWindow(text, [0])).toBeNull()
    expect(getWordWindow(text, [9])).toBeNull()
  })

  it('returns a windowed text when match is at index >= 10', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`)
    const text = words.join(' ')
    const result = getWordWindow(text, [15])
    expect(result).not.toBeNull()
    expect(result!.windowText).toContain('…')
    expect(result!.windowText).toContain('word15')
  })

  it('includes 3 words before the match in the window', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    const result = getWordWindow(text, [15])!
    // Window starts at 15 - 3 = 12, so w12, w13, w14, w15 should appear
    expect(result.windowText).toContain('w12')
    expect(result.windowText).toContain('w15')
  })

  it('adjusts window match indices relative to the window', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    // match at word 15; window starts at 12; hasPrefix=true (offset=1)
    // relIdx = 15 - 12 + 1 = 4
    const result = getWordWindow(text, [15])!
    expect(result.windowMatchIndices).toContain(4)
  })

  it('handles multiple match indices, filtering those inside the window', () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    // matches at 5 (outside window for first match at 20), 20, 25
    const result = getWordWindow(text, [20, 25])!
    expect(result.windowMatchIndices.length).toBe(2)
  })

  it('omits suffix ellipsis when window reaches the end', () => {
    const words = Array.from({ length: 15 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    const result = getWordWindow(text, [12])!
    // windowEnd = min(15, 12-3+14) = 15 = words.length → no suffix
    expect(result.windowText.endsWith('…')).toBe(false)
  })
})

// ─── normalizeBookQuery ────────────────────────────────────────────────────────

describe('normalizeBookQuery', () => {
  it('converts Roman numeral I prefix to 1', () => {
    expect(normalizeBookQuery('i sam')).toBe('1 sam')
    expect(normalizeBookQuery('I Samuel')).toBe('1 Samuel')
  })

  it('converts Roman numeral II prefix to 2', () => {
    expect(normalizeBookQuery('ii cor')).toBe('2 cor')
    expect(normalizeBookQuery('II Kings')).toBe('2 Kings')
  })

  it('converts Roman numeral III prefix to 3', () => {
    expect(normalizeBookQuery('iii john')).toBe('3 john')
    expect(normalizeBookQuery('III John')).toBe('3 John')
  })

  it('leaves already-numeric prefixes unchanged', () => {
    expect(normalizeBookQuery('1 samuel')).toBe('1 samuel')
    expect(normalizeBookQuery('2 kings')).toBe('2 kings')
  })

  it('leaves non-prefixed book names unchanged', () => {
    expect(normalizeBookQuery('genesis')).toBe('genesis')
    expect(normalizeBookQuery('matthew')).toBe('matthew')
    expect(normalizeBookQuery('isaiah')).toBe('isaiah')
  })

  it('does not match "i" followed by another letter (no false positive on "isaiah", "in")', () => {
    expect(normalizeBookQuery('isaiah')).toBe('isaiah')
    expect(normalizeBookQuery('in the beginning')).toBe('in the beginning')
  })
})

// ─── extractGlossWords ────────────────────────────────────────────────────────

describe('extractGlossWords', () => {
  it('extracts words of length >= 4', () => {
    const words = extractGlossWords('beginning, chief')
    expect(words).toContain('beginning')
    expect(words).toContain('chief')
  })

  it('strips parenthetical content', () => {
    const words = extractGlossWords('grace (as a gift), favour')
    expect(words).not.toContain('gift')
    expect(words).toContain('grace')
    expect(words).toContain('favour')
  })

  it('strips special characters', () => {
    const words = extractGlossWords('love × affection')
    expect(words).toContain('love')
    expect(words).toContain('affection')
  })

  it('filters out words shorter than 4 chars', () => {
    const words = extractGlossWords('go, run, walk, flee')
    expect(words).not.toContain('go')
    expect(words).not.toContain('run')
    expect(words).toContain('walk')
    expect(words).toContain('flee')
  })

  it('returns empty array for empty input', () => {
    expect(extractGlossWords('')).toEqual([])
  })
})

// ─── findMatchWordIndices ─────────────────────────────────────────────────────

describe('findMatchWordIndices', () => {
  it('finds indices from text_tagged primary path', () => {
    const tagged = 'For{G1063} by{G5485} grace{G5485} are{G2075}'
    const indices = findMatchWordIndices(tagged, '', 'G5485', [])
    expect(indices).toEqual([1, 2])
  })

  it('handles Hebrew tags', () => {
    const tagged = 'In{} the{} beginning{H7225} God{H430}'
    const indices = findMatchWordIndices(tagged, '', 'H7225', [])
    expect(indices).toEqual([2])
  })

  it('handles italic-prefixed tokens (* prefix)', () => {
    const tagged = '*that{} ye{G5210} might{G3588}'
    const indices = findMatchWordIndices(tagged, '', 'G5210', [])
    expect(indices).toEqual([1])
  })

  it('falls back to gloss-word matching when text_tagged is null', () => {
    const plain = 'For by grace are ye saved through faith'
    const fallback = ['grace', 'favour']
    const indices = findMatchWordIndices(null, plain, 'G5485', fallback)
    expect(indices).toContain(2) // "grace" is at index 2
  })

  it('falls back to gloss-word matching when text_tagged has no matching tag', () => {
    const tagged = 'For{G1063} by{} *grace{} are{G2075}'
    const plain = 'For by grace are ye saved'
    const fallback = ['grace', 'favour']
    const indices = findMatchWordIndices(tagged, plain, 'G5485', fallback)
    // tagged has no G5485 → falls back to gloss match on "grace" at index 2
    expect(indices).toContain(2)
  })

  it('matches plural form via +s rule', () => {
    const plain = 'These are the works of righteousness'
    const fallback = ['work']
    const indices = findMatchWordIndices(null, plain, 'G2041', fallback)
    expect(indices).toContain(3) // "works" matches fallback word "work" + s
  })

  it('returns empty array when no text_tagged and no fallback match', () => {
    const plain = 'In the beginning God created'
    const indices = findMatchWordIndices(null, plain, 'H1234', [])
    expect(indices).toEqual([])
  })

  it('is case-insensitive for the strongs number', () => {
    const tagged = 'grace{G5485}'
    expect(findMatchWordIndices(tagged, '', 'g5485', [])).toEqual([0])
    expect(findMatchWordIndices(tagged, '', 'G5485', [])).toEqual([0])
  })
})
