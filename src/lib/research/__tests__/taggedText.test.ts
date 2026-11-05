import { describe, it, expect } from 'vitest'
import { parseTaggedText, tagCoverage } from '../taggedText'

// Real rows copied from data/kjva.db (2026-10-28).
const GEN_1_1 = 'In{} the{} beginning{H7225} God{H430} created{H1254} ~{H853} the{} heaven{H8064} and{} the{} earth.{H776}'
const GEN_1_2 = 'And{} the{} earth{H776} was{H1961} without{} form,{H8414} and{} void;{H922} and{} darkness{H2822} *was{} upon{H5921}'
const MAT_5_3 = '!Blessed{G3107} *are{} !the{G3588} !poor{G4434}'

describe('parseTaggedText', () => {
  it('splits words, tags and attached punctuation', () => {
    const t = parseTaggedText(GEN_1_1)
    expect(t.map((x) => x.word)).toEqual(['In', 'the', 'beginning', 'God', 'created', '', 'the', 'heaven', 'and', 'the', 'earth'])
    expect(t[2]).toMatchObject({ word: 'beginning', strongs: ['H7225'], untranslated: false })
    expect(t[10]).toMatchObject({ word: 'earth', after: '.', strongs: ['H776'] })
    expect(t[0].strongs).toEqual([])
  })

  it('marks untranslated tags (~), supplied italics (*) and red letters (!)', () => {
    expect(parseTaggedText(GEN_1_1)[5]).toMatchObject({ word: '', strongs: ['H853'], untranslated: true })
    const g2 = parseTaggedText(GEN_1_2)
    expect(g2.find((x) => x.supplied)).toMatchObject({ word: 'was', strongs: [] })
    expect(g2[5]).toMatchObject({ word: 'form', after: ',' })
    const m = parseTaggedText(MAT_5_3)
    expect(m[0]).toMatchObject({ word: 'Blessed', redLetter: true, supplied: false })
    expect(m[1]).toMatchObject({ word: 'are', supplied: true, redLetter: false })
  })

  it('keeps every number on a multi-tagged word', () => {
    expect(parseTaggedText('word{H1697|H1696}')[0].strongs).toEqual(['H1697', 'H1696'])
  })

  it('handles empty input and plain words', () => {
    expect(parseTaggedText(null)).toEqual([])
    expect(parseTaggedText('plain text')[1]).toMatchObject({ word: 'text', strongs: [] })
  })

  it('reports coverage so a sparse table is never mistaken for a complete one', () => {
    expect(tagCoverage(parseTaggedText(GEN_1_1))).toEqual({ tokens: 11, tagged: 6, untagged: 5 })
  })
})
