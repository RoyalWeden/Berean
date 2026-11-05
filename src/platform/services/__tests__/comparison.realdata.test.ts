import { describe, it, expect, beforeAll } from 'vitest'
import { makeContext, realDataDb } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../index'
import { modelFreeLookup } from '../modelFreeLookup'
import { comparisonLabel, comparisonPayload } from '../researchService'

// Translation parallels and passage comparisons against the bundled texts. Skipped when absent.
const kjva = realDataDb('kjva.db'), lxx = realDataDb('lxx_brenton.db')
const heb = realDataDb('strongs_hebrew.db'), grk = realDataDb('strongs_greek.db')

describe.skipIf(!(kjva && lxx && heb && grk))('answerComparison (real data)', () => {
  let s: Services
  beforeAll(() => { s = createServices(makeContext({ texts: { kjva, lxx }, lexiconDb: async (l) => (l === 'H' ? heb! : grk!) })) })

  it('Genesis 1:1 in the KJV and LXX: two labelled panes, each its own text', async () => {
    const a = (await s.research.answerComparison('Genesis 1:1 in the KJV and LXX'))!
    expect(a.panes.map((p) => [p.label, p.textId, p.corpus])).toEqual([['KJV', 'kjva', 'Bible'], ['LXX (Brenton)', 'lxx', 'LXX']])
    expect(a.panes[0].verses[0].text).toBe('In the beginning God created the heaven and the earth.')
    expect(a.panes[1].verses[0].text).toBe('In the beginning God made the heaven and the earth.')
    // Same numbering: only words in one text and not the other are marked.
    expect(a.panes[0].differing).toEqual(['created'])
    expect(a.panes[1].differing).toEqual(['made'])
    expect(a.limitations).toEqual([])
  })

  it('a New Testament verse is an explicit missing pane in the LXX, never blank or invented', async () => {
    const a = (await s.research.answerComparison('John 1:1 in the KJV and LXX'))!
    expect(a.panes[0].verses).toHaveLength(1)
    expect(a.panes[1]).toMatchObject({ verses: [], missing: 'John is not in LXX (Brenton).' })
    expect(a.panes[1].differing).toBeUndefined()
  })

  it('Psalms keep each text\'s own numbering with a neutral caveat and no word marking', async () => {
    const a = (await s.research.answerComparison('compare Psalm 23:1 in the Septuagint'))!
    expect(a.limitations[0]).toMatch(/number some chapters and verses differently/)
    expect(a.panes.every((p) => p.differing === undefined)).toBe(true)
    expect(a.panes[0].verses[0].text).toMatch(/Lord is my shepherd/)
    expect(a.panes[1].verses[0].text).not.toBe(a.panes[0].verses[0].text)
  })

  it('compares two passages, each in its own text', async () => {
    const a = (await s.research.answerComparison('compare Genesis 1:1 and John 1:1'))!
    expect(a.panes.map((p) => p.reference)).toEqual(['Genesis 1:1', 'John 1:1'])
    expect(a.panes.every((p) => p.label === 'KJV' && p.verses.length === 1)).toBe(true)
    expect(a.panes.every((p) => p.differing === undefined)).toBe(true)
    expect(comparisonLabel(a)).toBe('Comparing Genesis 1:1 and John 1:1')
  })

  it('caps a long passage and says so', async () => {
    const a = (await s.research.answerComparison('compare Psalm 119 and Genesis 1:1'))!
    expect(a.panes[0].verses).toHaveLength(12)
    expect(a.panes[0].truncated).toBe(true)
    expect(a.limitations.join(' ')).toMatch(/first 12 verses/)
  })

  it('model-free lookup carries the payload with a label-only reply', async () => {
    const r = await modelFreeLookup(s, 'how does the LXX read Isaiah 7:14')
    expect(r.research?.passageComparison?.panes).toHaveLength(2)
    expect(r.summary).toBe('Isaiah 7:14 in KJV and LXX (Brenton)')
    expect(r.results.map((v) => v.textId)).toEqual(['kjva', 'lxx'])
    expect(r.research).toEqual(comparisonPayload((await s.research.answerComparison('how does the LXX read Isaiah 7:14'))!))
  })

  it('does not take Strong\'s comparisons or plain references', async () => {
    expect(await s.research.answerComparison('Compare H2617 and H7356')).toBeNull()
    expect(await s.research.answerComparison('John 3:16')).toBeNull()
    expect((await modelFreeLookup(s, 'Compare H2617 and H7356')).research?.kind).toBe('strongs-compare')
  })
})
