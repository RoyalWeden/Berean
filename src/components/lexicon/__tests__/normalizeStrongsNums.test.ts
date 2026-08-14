import { describe, it, expect } from 'vitest'
import { normalizeStrongsNums } from '../LexiconPanel'

// Regression coverage: "Compare 3050, 3069." (H3068's real gloss text) linked the first bare
// number but silently left the second one plain — the trailing lookahead excluded ANY number
// immediately followed by "." (meant only to guard a "32:38"-shaped chapter:verse reference),
// which also blocked the far more common "a bare cross-reference number ends the sentence" shape.
describe('normalizeStrongsNums', () => {
  it('links a bare number immediately followed by a sentence-ending period', () => {
    expect(normalizeStrongsNums('Compare 3050, 3069.', 'H')).toBe('Compare H3050, H3069.')
  })

  it('still does NOT link a chapter:verse reference (the guard this exclusion exists for)', () => {
    expect(normalizeStrongsNums('(Deuteronomy 32:38)', 'H')).toBe('(Deuteronomy 32:38)')
  })

  it('links a bare number with no trailing punctuation at all', () => {
    expect(normalizeStrongsNums('See 7495', 'H')).toBe('See H7495')
  })

  it('links a bare number immediately followed by a period with no space (e.g. "See 7495.")', () => {
    expect(normalizeStrongsNums('See 7495.', 'H')).toBe('See H7495.')
  })

  it('strips leading zeros from an already-prefixed number', () => {
    expect(normalizeStrongsNums('from H07941', 'G')).toBe('from H7941')
  })
})
