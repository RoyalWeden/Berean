/**
 * Unit tests for psalmSuperscription.ts — splitting the Psalm superscription out of verse 1
 * into a faint title line, for KJV/KJVA and Brenton LXX. Sample strings below are verbatim
 * from data/kjva.db (text_tagged) and data/lxx_brenton.db (text) as of the curated data in
 * psalmTitles.ts.
 */

import { describe, it, expect } from 'vitest'
import {
  planPsalmSuperscription,
  resolveTitleLine,
  trimVerseOneText,
  trimVerseOneTagged,
  extractVerseOneTaggedTitle,
} from '../../src/lib/psalmSuperscription'

describe('planPsalmSuperscription', () => {
  it('returns null for non-Psalm books and unsupported texts', () => {
    expect(planPsalmSuperscription('kjva', 'GEN', 1)).toBeNull()
    expect(planPsalmSuperscription('enoch', 'PSA', 51)).toBeNull()
    expect(planPsalmSuperscription(undefined, 'PSA', 51)).toBeNull()
  })

  it('returns null for a Psalm with no KJV superscription', () => {
    expect(planPsalmSuperscription('kjv', 'PSA', 1)).toBeNull()
    expect(planPsalmSuperscription('kjva', 'PSA', 119)).toBeNull()
  })

  it('KJV: title line, no trim (plain text never carries the superscription)', () => {
    const p = planPsalmSuperscription('kjv', 'PSA', 51)!
    expect(p.titleLine).toBe(
      'To the chief Musician, A Psalm of David, when Nathan the prophet came unto him, after he had gone in to Bathsheba.',
    )
    expect(p.firstBodyVerseNum).toBe(1)
    expect(p.trim.kind).toBe('none')
  })

  it('KJVA: same title, but trim kind targets the tagged text', () => {
    const p = planPsalmSuperscription('kjva', 'PSA', 51)!
    expect(p.trim.kind).toBe('kjva-tagged-title')
  })

  it('Brenton whole-verse title: body starts at verse 2 (or 3 for the 2-verse titles)', () => {
    const p3 = planPsalmSuperscription('lxx', 'PSA', 3)!
    expect(p3.firstBodyVerseNum).toBe(2)
    expect([...p3.hiddenVerseNums]).toEqual([1])

    const p50 = planPsalmSuperscription('lxx', 'PSA', 50)!
    expect(p50.firstBodyVerseNum).toBe(3)
    expect([...p50.hiddenVerseNums].sort()).toEqual([1, 2])
  })

  it('Brenton inline title: prefix trim, body stays verse 1', () => {
    const p = planPsalmSuperscription('lxx', 'PSA', 10)!
    expect(p.firstBodyVerseNum).toBe(1)
    expect(p.hiddenVerseNums.size).toBe(0)
    expect(p.trim).toEqual({ kind: 'brenton-inline-prefix', prefix: 'For the end, a Psalm of David.' })
  })
})

describe('resolveTitleLine (Brenton whole-verse)', () => {
  it('joins the hidden verses into the title line', () => {
    const p = planPsalmSuperscription('lxx', 'PSA', 50)!
    const verses = [
      { verse_num: 1, text: 'For the end, a Psalm of David,' },
      { verse_num: 2, text: 'when Nathan the prophet came to him, when he had gone in to Bersabee.' },
      { verse_num: 3, text: 'Have mercy upon me, O God, according to thy great mercy;' },
    ]
    expect(resolveTitleLine(p, verses)).toBe(
      'For the end, a Psalm of David, when Nathan the prophet came to him, when he had gone in to Bersabee.',
    )
  })
})

describe('trimVerseOneText (Brenton inline)', () => {
  const cases: Array<[number, string, string]> = [
    [10, 'For the end, a Psalm of David. In the Lord I have put my trust: how will ye say to my soul, Flee to the mountains as a sparrow?', 'In the Lord I have put my trust: how will ye say to my soul, Flee to the mountains as a sparrow?'],
    [136, 'For David, [a Psalm] of Jeremias. By the rivers of Babylon, there we sat; and wept when we remembered Sion.', 'By the rivers of Babylon, there we sat; and wept when we remembered Sion.'],
    [144, "David's [Psalm of] praise. I will exalt thee, my God, my king; and I will bless thy name for ever and ever.", 'I will exalt thee, my God, my king; and I will bless thy name for ever and ever.'],
    [104, 'Alleluia. Give thanks to the Lord, and call upon his name; declare his works among the heathen.', 'Give thanks to the Lord, and call upon his name; declare his works among the heathen.'],
  ]
  it.each(cases)('Psalm %i strips the exact prefix', (ch, raw, body) => {
    const p = planPsalmSuperscription('lxx', 'PSA', ch)!
    expect(trimVerseOneText(raw, p)).toBe(body)
  })

  it('leaves text untouched when nothing matches (degrades to title shown twice, never eaten text)', () => {
    const p = planPsalmSuperscription('lxx', 'PSA', 10)!
    expect(trimVerseOneText('Totally different opening line of a psalm.', p)).toBe(
      'Totally different opening line of a psalm.',
    )
  })

  it('is a no-op for the whole-verse and KJV plans', () => {
    expect(trimVerseOneText('anything', planPsalmSuperscription('lxx', 'PSA', 3)!)).toBe('anything')
    expect(trimVerseOneText('anything', planPsalmSuperscription('kjv', 'PSA', 51)!)).toBe('anything')
  })
})

describe('trimVerseOneTagged (KJVA text_tagged)', () => {
  it('strips the leading superscription tokens, keeps the body Strong’s tags', () => {
    const p = planPsalmSuperscription('kjva', 'PSA', 51)!
    const tagged =
      'To{} the{} chief{} Musician,{H5329} A{} Psalm{H4210} of{} David,{H1732} when{} Nathan{H5416} the{} prophet{H5030} came{H935} unto{H413} him,{} after{H834} he{} had{} gone{} in{H935} to{H413} Bathsheba.{H1339} Have{} mercy{H2603} upon{} me,{H2603}'
    expect(trimVerseOneTagged(tagged, p)).toBe('Have{} mercy{H2603} upon{} me,{H2603}')
  })

  it('short title', () => {
    const p = planPsalmSuperscription('kjva', 'PSA', 23)!
    const tagged = 'A{} Psalm{H4210} of{} David.{H1732} The{} LORD{H3068} *is{} my{} shepherd;{H7462} I{} shall{} not{H3808} want.{H2637}'
    expect(trimVerseOneTagged(tagged, p)).toBe('The{} LORD{H3068} *is{} my{} shepherd;{H7462} I{} shall{} not{H3808} want.{H2637}')
  })

  it('tolerates the corrupt b> / /b> tokens in the tagged prefix (Psalm 18)', () => {
    const p = planPsalmSuperscription('kjva', 'PSA', 18)!
    // Verbatim head of data/kjva.db PSA 18:1 text_tagged, through the end of the superscription
    // ("...and from the hand of Saul: And he said,") into the body ("I will love thee...").
    const tagged =
      'To{} the{} chief{} Musician,{H5329} b>{} *A{} *Psalm{} of{} David,{} /b>{H1732} the{} servant{H5650} of{} the{} LORD,{H3068} who{H834} spake{H1696} unto{} the{} LORD{H3068} ~{H853} the{} words{H1697} of{} this{H2063} song{H7892} in{} the{} day{H3117} b>{} *that{} /b>{H834} the{} LORD{H3068} delivered{H5337} him{} from{} the{} hand{H3709} of{} all{H3605} his{} enemies,{H341} and{} from{H3027} the{} hand{H3027} of{} Saul:{H7586} And{} he{} said,{H559} I{} will{} love{H7355} thee,{} O{} LORD,{H3068} my{} strength.{H2391}'
    const out = trimVerseOneTagged(tagged, p)
    expect(out.startsWith('I{} will{} love{H7355} thee,{} O{} LORD,{H3068} my{} strength.{H2391}')).toBe(true)
    expect(out).not.toContain('chief')
    expect(out).not.toContain('b>')
  })
})

describe('extractVerseOneTaggedTitle (KJVA — the superscription rendered WITH Strong’s)', () => {
  it('returns the leading tagged title tokens, keeping their Strong’s numbers', () => {
    const p = planPsalmSuperscription('kjva', 'PSA', 51)!
    const tagged =
      'To{} the{} chief{} Musician,{H5329} A{} Psalm{H4210} of{} David,{H1732} when{} Nathan{H5416} the{} prophet{H5030} came{H935} unto{H413} him,{} after{H834} he{} had{} gone{} in{H935} to{H413} Bathsheba.{H1339} Have{} mercy{H2603} upon{} me,{H2603}'
    expect(extractVerseOneTaggedTitle(tagged, p)).toBe(
      'To{} the{} chief{} Musician,{H5329} A{} Psalm{H4210} of{} David,{H1732} when{} Nathan{H5416} the{} prophet{H5030} came{H935} unto{H413} him,{} after{H834} he{} had{} gone{} in{H935} to{H413} Bathsheba.{H1339}',
    )
  })

  it('drops the corrupt b> / /b> tokens from the extracted title (Psalm 18)', () => {
    const p = planPsalmSuperscription('kjva', 'PSA', 18)!
    const tagged =
      'To{} the{} chief{} Musician,{H5329} b>{} *A{} *Psalm{} of{} David,{} /b>{H1732} the{} servant{H5650} of{} the{} LORD,{H3068} who{H834} spake{H1696} unto{} the{} LORD{H3068} ~{H853} the{} words{H1697} of{} this{H2063} song{H7892} in{} the{} day{H3117} b>{} *that{} /b>{H834} the{} LORD{H3068} delivered{H5337} him{} from{} the{} hand{H3709} of{} all{H3605} his{} enemies,{H341} and{} from{H3027} the{} hand{H3027} of{} Saul:{H7586} And{} he{} said,{H559} I{} will{} love{H7355} thee,{} O{} LORD,{H3068} my{} strength.{H2391}'
    const title = extractVerseOneTaggedTitle(tagged, p)!
    expect(title).not.toContain('b>')
    expect(title.startsWith('To{} the{} chief{} Musician,{H5329}')).toBe(true)
    expect(title.endsWith('said,{H559}')).toBe(true)
    expect(title).not.toContain('love')
  })

  it('returns null for kjv plain text and Brenton (no tagged title to show)', () => {
    expect(extractVerseOneTaggedTitle(undefined, planPsalmSuperscription('kjv', 'PSA', 51)!)).toBeNull()
    expect(extractVerseOneTaggedTitle('For the end, a Psalm of David.', planPsalmSuperscription('lxx', 'PSA', 10)!)).toBeNull()
  })
})
