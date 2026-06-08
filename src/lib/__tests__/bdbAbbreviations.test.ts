import { describe, it, expect } from 'vitest'
import { expandBdbAbbr, tokenizeBdbNotes, BDB_ABBR } from '@/lib/bdbAbbreviations'

describe('expandBdbAbbr', () => {
  it('expands common parts of speech', () => {
    expect(expandBdbAbbr('vb.')).toBe('verb')
    expect(expandBdbAbbr('n.f.')).toBe('noun, feminine')
    expect(expandBdbAbbr('n.m.')).toBe('noun, masculine')
    expect(expandBdbAbbr('adj.')).toBe('adjective')
    expect(expandBdbAbbr('adv.')).toBe('adverb')
  })

  it('expands proper-noun and place-name variants', () => {
    expect(expandBdbAbbr('n.pr.m.')).toBe('proper noun, masculine')
    expect(expandBdbAbbr('n.pr.loc.')).toBe('place name')
  })

  it('expands Hebrew verb stems', () => {
    expect(expandBdbAbbr('Hiph.')).toBe('Hiphil')
    expect(expandBdbAbbr('Niph.')).toBe('Niphal')
    expect(expandBdbAbbr('Pi.')).toBe('Piel')
    expect(expandBdbAbbr('Hithp.')).toBe('Hithpael')
  })

  it('expands number/state markers', () => {
    expect(expandBdbAbbr('pl.')).toBe('plural')
    expect(expandBdbAbbr('cstr.')).toBe('construct')
    expect(expandBdbAbbr('abs.')).toBe('absolute')
  })

  it('returns null for unknown tokens and ordinary words', () => {
    expect(expandBdbAbbr('beginning')).toBeNull()
    expect(expandBdbAbbr('reckless')).toBeNull()
    expect(expandBdbAbbr('Qal')).toBeNull() // already a readable word — left alone
  })

  it('does not expand ambiguous single-letter abbreviations', () => {
    expect(expandBdbAbbr('m.')).toBeNull()
    expect(expandBdbAbbr('f.')).toBeNull()
    expect(expandBdbAbbr('c.')).toBeNull()
    expect(expandBdbAbbr('v.')).toBeNull()
  })
})

describe('tokenizeBdbNotes', () => {
  it('tags the H6348 example correctly', () => {
    const toks = tokenizeBdbNotes('[פָּחַז] vb. be wanton, reckless')
    const abbr = toks.filter(t => t.kind === 'abbr')
    expect(abbr).toHaveLength(1)
    expect(abbr[0].text).toBe('verb')
    expect(abbr[0].raw).toBe('vb.')
    // joins back to readable prose (with the expansion swapped in)
    expect(toks.map(t => t.text).join('')).toBe('[פָּחַז] verb be wanton, reckless')
  })

  it('tags a leading occurrence-count number as a num token (not Strong\'s)', () => {
    const toks = tokenizeBdbNotes('אָב 1101 n.m. father')
    const nums = toks.filter(t => t.kind === 'num')
    expect(nums.map(n => n.text)).toContain('1101')
    expect(toks.filter(t => t.kind === 'abbr')[0].text).toBe('noun, masculine')
  })

  it('handles an abbreviation followed by a comma', () => {
    const toks = tokenizeBdbNotes('n.f., beginning')
    const abbr = toks.find(t => t.kind === 'abbr')
    expect(abbr?.text).toBe('noun, feminine')
    // the comma is preserved as its own text token
    expect(toks.map(t => t.text).join('')).toBe('noun, feminine, beginning')
  })

  it('preserves whitespace so the text rejoins faithfully', () => {
    const input = 'rulers, judges  divine ones'
    expect(tokenizeBdbNotes(input).map(t => t.text).join('')).toBe(input)
  })

  it('leaves ordinary prose untouched', () => {
    const toks = tokenizeBdbNotes('be wanton reckless')
    expect(toks.every(t => t.kind === 'text')).toBe(true)
  })

  it('every BDB_ABBR value is a readable multi-letter word/phrase', () => {
    for (const [k, v] of Object.entries(BDB_ABBR)) {
      expect(v.length, k).toBeGreaterThan(2)
      expect(v).not.toMatch(/\.$/) // expansions shouldn't keep the abbreviating dot
    }
  })
})
