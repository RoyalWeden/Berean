import { describe, it, expect } from 'vitest'
import { buildMatchExcerpt, excerptBudgetForWidth } from '../matchExcerpt'

const BEATITUDE =
  'How beautiful upon the mountains are the feet of him that bringeth good tidings, ' +
  'that publisheth peace; that bringeth good tidings of good, that publisheth salvation; ' +
  'that saith unto Zion, Thy God reigneth!'

function startsOrEndsMidWord(original: string, sliceStart: number, sliceEnd: number) {
  const isWordChar = (c: string | undefined) => !!c && /\w/.test(c)
  const startsMid = sliceStart > 0 && isWordChar(original[sliceStart - 1]) && isWordChar(original[sliceStart])
  const endsMid = sliceEnd < original.length && isWordChar(original[sliceEnd - 1]) && isWordChar(original[sliceEnd])
  return { startsMid, endsMid }
}

describe('buildMatchExcerpt', () => {
  it.each([60, 90])('keeps "good tidings" fully visible at budget %i', (budget) => {
    const snippet = buildMatchExcerpt(BEATITUDE, 'good tidings', { mode: 'phrase', budget })
    expect(snippet.text.toLowerCase()).toContain('good tidings')

    // No mid-word cuts at the kept slice boundaries.
    const { startsMid, endsMid } = startsOrEndsMidWord(BEATITUDE, snippet.sliceStart, snippet.sliceEnd)
    expect(startsMid).toBe(false)
    expect(endsMid).toBe(false)

    // Ellipsis presence must match truncation.
    const hasLeadingEllipsis = snippet.text.startsWith('…')
    const hasTrailingEllipsis = snippet.text.endsWith('…')
    expect(hasLeadingEllipsis).toBe(snippet.sliceStart > 0)
    expect(hasTrailingEllipsis).toBe(snippet.sliceEnd < BEATITUDE.length)
    expect(snippet.prefixLen).toBe(hasLeadingEllipsis ? 1 : 0)
  })

  it('phrase mode finds the exact phrase window', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the river bank this fine sunny afternoon today.'
    const snippet = buildMatchExcerpt(text, 'lazy dog', { mode: 'phrase', budget: 30 })
    expect(snippet.text.toLowerCase()).toContain('lazy dog')
    const { startsMid, endsMid } = startsOrEndsMidWord(text, snippet.sliceStart, snippet.sliceEnd)
    expect(startsMid).toBe(false)
    expect(endsMid).toBe(false)
  })

  it('any mode picks the densest window covering the most distinct query words', () => {
    // "apple" appears early alone; "banana" and "cherry" appear close together later.
    const text =
      'apple starts the sentence here with lots of padding words in between everything ' +
      'so that banana and cherry sit close together near the end of this long verse text.'
    const snippet = buildMatchExcerpt(text, 'apple banana cherry', { mode: 'any', budget: 40 })
    const lower = snippet.text.toLowerCase()
    // Should prefer the window with both banana and cherry (2 distinct words) over the one
    // with just "apple" (1 distinct word).
    expect(lower).toContain('banana')
    expect(lower).toContain('cherry')
  })

  it('all mode: the real beatitude case covers at least one full occurrence of each word', () => {
    const snippet = buildMatchExcerpt(BEATITUDE, 'good tidings', { mode: 'all', budget: 60 })
    const lower = snippet.text.toLowerCase()
    expect(lower).toContain('good')
    expect(lower).toContain('tidings')
  })

  it('handles a match at the very end of the text', () => {
    const text = 'This is a long sentence that eventually mentions the keyword treasure here'
    const snippet = buildMatchExcerpt(text, 'treasure', { mode: 'phrase', budget: 30 })
    expect(snippet.text.toLowerCase()).toContain('treasure')
    expect(snippet.sliceEnd).toBe(text.length)
    expect(snippet.text.endsWith('…')).toBe(false)
    const { startsMid, endsMid } = startsOrEndsMidWord(text, snippet.sliceStart, snippet.sliceEnd)
    expect(startsMid).toBe(false)
    expect(endsMid).toBe(false)
  })

  it('handles a match at the very start of the text', () => {
    const text = 'Treasure was mentioned right away and then a very long trailing sentence continues on and on and on.'
    const snippet = buildMatchExcerpt(text, 'treasure', { mode: 'phrase', budget: 30 })
    expect(snippet.text.toLowerCase()).toContain('treasure')
    expect(snippet.sliceStart).toBe(0)
    expect(snippet.text.startsWith('…')).toBe(false)
  })

  it('falls back to the start, word-snapped, with trailing ellipsis when there is no match', () => {
    const text = 'This sentence does not contain the searched term at all, it just keeps going and going.'
    const snippet = buildMatchExcerpt(text, 'nonexistentword', { mode: 'phrase', budget: 20 })
    expect(snippet.sliceStart).toBe(0)
    expect(snippet.text.endsWith('…')).toBe(true)
    const { startsMid, endsMid } = startsOrEndsMidWord(text, snippet.sliceStart, snippet.sliceEnd)
    expect(startsMid).toBe(false)
    expect(endsMid).toBe(false)
  })

  it('handles regex special characters in the query without throwing', () => {
    const text = 'What is this (parenthetical) remark about? It costs $5.00 and that is a lot of text to read here.'
    expect(() => buildMatchExcerpt(text, '(parenthetical)', { mode: 'phrase', budget: 30 })).not.toThrow()
    const snippet = buildMatchExcerpt(text, '(parenthetical)', { mode: 'phrase', budget: 30 })
    expect(snippet.text.toLowerCase()).toContain('parenthetical')
  })

  it('returns text untouched when it already fits the budget', () => {
    const text = 'Short verse text.'
    const snippet = buildMatchExcerpt(text, 'verse', { mode: 'phrase', budget: 100 })
    expect(snippet).toEqual({ text, sliceStart: 0, sliceEnd: text.length, prefixLen: 0 })
  })

  it('keeps the first full match when the matched span itself exceeds the budget', () => {
    const text = 'Padding before a very long matched phrase that is itself quite long and then padding after it continues onward for a while.'
    const snippet = buildMatchExcerpt(text, 'a very long matched phrase that is itself quite long', {
      mode: 'phrase',
      budget: 20,
    })
    // The slice should start at (or before) the match start and the match's opening words
    // should be present even though the whole phrase can't fit.
    expect(snippet.text.toLowerCase()).toContain('a very long')
    const { startsMid, endsMid } = startsOrEndsMidWord(text, snippet.sliceStart, snippet.sliceEnd)
    expect(startsMid).toBe(false)
    expect(endsMid).toBe(false)
  })

  it('never produces a prefixLen outside 0 or 1', () => {
    const snippet = buildMatchExcerpt(BEATITUDE, 'good tidings', { mode: 'phrase', budget: 60 })
    expect([0, 1]).toContain(snippet.prefixLen)
  })
})

describe('excerptBudgetForWidth', () => {
  it('scales with width and lines', () => {
    const one = excerptBudgetForWidth(400, 14, 1)
    const two = excerptBudgetForWidth(400, 14, 2)
    expect(two).toBeGreaterThan(one)
  })

  it('clamps to the [60, 600] range', () => {
    expect(excerptBudgetForWidth(1, 1, 1)).toBeGreaterThanOrEqual(60)
    expect(excerptBudgetForWidth(100000, 1, 10)).toBeLessThanOrEqual(600)
  })
})
