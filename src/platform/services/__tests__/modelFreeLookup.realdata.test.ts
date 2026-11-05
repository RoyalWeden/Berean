import { describe, it, expect, beforeAll } from 'vitest'
import { makeContext, realDataDb } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../index'
import { modelFreeLookup } from '../modelFreeLookup'

// The iPhone path (no AI model): same shared services, real bundled DBs. Skipped when absent.
const kjva = realDataDb('kjva.db'), lxx = realDataDb('lxx_brenton.db')
const heb = realDataDb('strongs_hebrew.db'), grk = realDataDb('strongs_greek.db')

describe.skipIf(!(kjva && lxx && heb && grk))('modelFreeLookup (real data, no model)', () => {
  let s: Services
  beforeAll(() => { s = createServices(makeContext({ texts: { kjva, lxx }, lexiconDb: async (l) => (l === 'H' ? heb! : grk!) })) })

  it('John 3:16 with no model: the local verse, no download needed (scenario 1)', async () => {
    const r = await modelFreeLookup(s, 'John 3:16')
    expect(r.results).toHaveLength(1)
    expect(r.results[0]).toMatchObject({ bookId: 'JHN', chapter: 3, verse: 16, textId: 'kjva', source: 'named' })
    expect(r.results[0].text).toMatch(/^For God so loved the world/)
    expect(r).toMatchObject({ errorCode: 'NO_MODEL_INSTALLED', partial: true })
  })

  it('Strong\'s and word studies resolve without a model (scenario 2, 3)', async () => {
    expect((await modelFreeLookup(s, 'G-5485')).strongsCard?.strongsNum).toBe('G5485')
    const mercy = await modelFreeLookup(s, 'the word for mercy')
    expect(mercy.research?.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(['H2617', 'G1656']))
  })

  it('a topical question falls back to keyword search over the canon', async () => {
    const r = await modelFreeLookup(s, 'verses about the jubilee')
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.results.every((x) => x.text.toLowerCase().includes('jubile'))).toBe(true) // KJV spelling
    expect(r.keywords).toContain('jubilee')
  })

  it('follow-ups resolve against the conversation (scenario 13)', async () => {
    const r = await modelFreeLookup(s, 'show that in the LXX', { history: [{ role: 'user', content: 'Genesis 1:1' }, { role: 'assistant', content: 'Passages: Genesis 1:1' }] })
    expect(r.followUpReason).toMatch(/LXX/)
    expect(r.results[0]).toMatchObject({ textId: 'lxx', bookId: 'GEN', chapter: 1, verse: 1 })
  })

  it('an interpretive question with Commentary off offers interpretations, never writes them', async () => {
    const r = await modelFreeLookup(s, 'what does John 3:16 mean', { commentary: false })
    expect(r.interpretationOffered).toBe(true)
    expect(r.summary).toBeUndefined()
  })
})
