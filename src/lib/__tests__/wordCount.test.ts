import { describe, it, expect } from 'vitest'
import { computeWordStats } from '../wordCount'

describe('computeWordStats', () => {
  it('reports 0 words / 0 minutes for an empty note (not NaN)', () => {
    expect(computeWordStats('')).toEqual({ words: 0, minutes: 0 })
    expect(computeWordStats('   \n\t  ')).toEqual({ words: 0, minutes: 0 })
  })

  it('collapses multiple spaces/newlines when counting words', () => {
    expect(computeWordStats('one   two\n\nthree\tfour')).toEqual({ words: 4, minutes: 1 })
  })

  it('strips markdown syntax before counting so it does not inflate the count', () => {
    // "#", "**", "*" are markup, not words — should count as 4 real words (Heading, bold,
    // italic, text), not inflated by the leftover markup characters.
    expect(computeWordStats('# Heading\n**bold** *italic* text')).toEqual({ words: 4, minutes: 1 })
  })

  it('rounds reading time up and enforces a 1-minute minimum once there is content', () => {
    expect(computeWordStats('word')).toEqual({ words: 1, minutes: 1 })
    // 201 words -> just over 1 minute at 200wpm -> rounds up to 2
    const twoHundredOneWords = Array(201).fill('word').join(' ')
    expect(computeWordStats(twoHundredOneWords)).toEqual({ words: 201, minutes: 2 })
    // exactly 200 words -> exactly 1 minute
    const twoHundredWords = Array(200).fill('word').join(' ')
    expect(computeWordStats(twoHundredWords)).toEqual({ words: 200, minutes: 1 })
  })
})
