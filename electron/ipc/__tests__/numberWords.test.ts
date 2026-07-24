import { describe, it, expect } from 'vitest'
import { numberTokenAlternates } from '../numberWords'

describe('numberTokenAlternates', () => {
  it('digit token returns its word form as an alternate', () => {
    expect(numberTokenAlternates('7')).toEqual(['7', 'seven'])
    expect(numberTokenAlternates('40')).toEqual(['40', 'forty'])
    expect(numberTokenAlternates('100')).toEqual(['100', 'hundred'])
  })

  it('word token returns its digit form as an alternate (case-insensitive)', () => {
    expect(numberTokenAlternates('seven')).toEqual(['seven', '7'])
    expect(numberTokenAlternates('Forty')).toEqual(['Forty', '40'])
  })

  it('KJV archaic terms map correctly', () => {
    expect(numberTokenAlternates('fourscore')).toEqual(['fourscore', '80'])
    expect(numberTokenAlternates('threescore')).toEqual(['threescore', '60'])
    expect(numberTokenAlternates('score')).toEqual(['score', '20'])
  })

  it('non-number tokens and unsupported numbers return just themselves', () => {
    expect(numberTokenAlternates('beginning')).toEqual(['beginning'])
    expect(numberTokenAlternates('12345')).toEqual(['12345'])
  })
})
