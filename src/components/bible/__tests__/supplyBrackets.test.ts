import { describe, it, expect } from 'vitest'
import { supplyBracketIndices } from '../VerseRow'

/** Build the `{ word }` token shape supplyBracketIndices consumes from a word list. */
const toks = (words: string[]) => words.map((word) => ({ word }))

describe('supplyBracketIndices (LXX supply-bracket detection)', () => {
  it('returns no indices when there are no brackets', () => {
    const set = supplyBracketIndices(toks(['All', 'wisdom', 'cometh']))
    expect(set.size).toBe(0)
  })

  it('flags a single-token supply span ([is])', () => {
    // "This [is] the book" — only the bracketed token is supply
    const set = supplyBracketIndices(toks(['This', '[is]', 'the', 'book']))
    expect([...set].sort((a, b) => a - b)).toEqual([1])
  })

  it('flags every token of a multi-token supply span ([It … is])', () => {
    // "said, [It is] not good" — both boundary tokens and nothing outside
    const set = supplyBracketIndices(toks(['said,', '[It', 'is]', 'not', 'good']))
    expect([...set].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('handles the Sirach prologue (two spans, real content outside)', () => {
    // "[The Prologue to the Wisdom of] Jesus [the son of] Sirach Whereas"
    const set = supplyBracketIndices(
      toks(['[The', 'Prologue', 'to', 'the', 'Wisdom', 'of]', 'Jesus', '[the', 'son', 'of]', 'Sirach', 'Whereas']),
    )
    expect([...set].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9])
    // Real (non-supply) words are never flagged
    expect(set.has(6)).toBe(false)  // Jesus
    expect(set.has(10)).toBe(false) // Sirach
    expect(set.has(11)).toBe(false) // Whereas
  })
})
