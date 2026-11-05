import { describe, it, expect } from 'vitest'
import { mentionsExcluded, parseExclusions } from '../exclusions'

const book = (p: string) => (/romans/i.test(p) ? 'ROM' : /enoch/i.test(p) ? 'ENO' : null)

describe('parseExclusions (scenario 7)', () => {
  it('takes a word exclusion out of a request for verses', () => {
    expect(parseExclusions('Find passages on obedience to God but not human rulers', book)).toEqual({ remainder: 'Find passages on obedience to God', terms: ['human', 'rulers'], bookIds: [] })
    expect(parseExclusions('verses about fire excluding the lake', book).terms).toEqual(['lake'])
  })
  it('excludes a named book rather than scoping to it', () => {
    expect(parseExclusions('verses on circumcision of the heart, not from Romans', book)).toEqual({ remainder: 'verses on circumcision of the heart', terms: [], bookIds: ['ROM'] })
    expect(parseExclusions('the watchers, but not from Enoch', book)).toMatchObject({ remainder: 'the watchers', bookIds: ['ENO'] })
  })
  it('leaves quotations, ordinary negation and unknown books alone', () => {
    for (const q of ['persecuted, but not forsaken', 'except a man be born again', 'verses about not worrying about tomorrow', 'I was not in Rome', 'faith without works']) {
      expect(parseExclusions(q, book)).toEqual({ remainder: q, terms: [], bookIds: [] })
    }
  })
})

describe('mentionsExcluded', () => {
  it('matches whole words with a plural either way', () => {
    expect(mentionsExcluded('the ruler of the feast', ['rulers'])).toBe(true)
    expect(mentionsExcluded('rulers are not a terror', ['ruler'])).toBe(true)
    expect(mentionsExcluded('misruled', ['ruled'])).toBe(false)
  })
})
