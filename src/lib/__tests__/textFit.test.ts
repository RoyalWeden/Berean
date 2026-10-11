import { describe, expect, it } from 'vitest'
import { makeSnippet } from '../highlight'
import { charsThatFit } from '../textFit'

describe('charsThatFit', () => {
  it('fills the line slightly past its edge (the CSS ellipsis marks the real cut)', () => {
    expect(charsThatFit(700, 7)).toBe(112) // 100 chars fit → 12% overshoot
  })
  it('returns null until the width and font metrics are known', () => {
    expect(charsThatFit(0, 7)).toBeNull()
    expect(charsThatFit(700, null)).toBeNull()
  })
  it('never collapses below a usable minimum', () => {
    expect(charsThatFit(40, 8)).toBe(24)
  })
})

describe('makeSnippet sized to the line', () => {
  const verse = 'And Yeshua answered and said unto them, Verily I say unto you, If ye have faith, and doubt not, ye shall not only do this which is done to the fig tree'
  it('keeps a late match inside the visible line', () => {
    const fit = 60
    const snip = makeSnippet(verse, 'fig', charsThatFit(fit * 7, 7)!, 'all')
    // The match sits within the first `fit` characters actually shown.
    expect(snip.toLowerCase().indexOf('fig')).toBeGreaterThan(-1)
    expect(snip.toLowerCase().indexOf('fig')).toBeLessThan(fit)
  })
  it('a wide line shows the whole verse instead of an early "…"', () => {
    expect(makeSnippet(verse, 'shall', charsThatFit(200 * 7, 7)!, 'all')).toBe(verse)
  })
})
