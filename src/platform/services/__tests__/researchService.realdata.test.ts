import { describe, it, expect, beforeAll } from 'vitest'
import { makeContext, realDataDb } from '../../db/__tests__/testDb'
import { createLexiconService } from '../lexiconService'
import { createResearchService, type ResearchService } from '../researchService'

// Runs against the real bundled databases (symlinked into worktrees; absent in CI → skipped).
// These assert the benchmark's Strong's failures (C07, C11–C17, C25, C29, C37–C55, H13, R09) are
// answerable without any model, and that every id returned is a real lexicon entry.
const kjva = realDataDb('kjva.db')
const lxx = realDataDb('lxx_brenton.db')
const heb = realDataDb('strongs_hebrew.db')
const grk = realDataDb('strongs_greek.db')
const haveData = Boolean(kjva && lxx && heb && grk)

describe.skipIf(!haveData)('researchService (real data)', () => {
  let svc: ResearchService
  beforeAll(async () => {
    const ctx = makeContext({ texts: { kjva, lxx }, lexiconDb: async (l) => (l === 'H' ? heb! : grk!) })
    svc = createResearchService(ctx, { lexicon: createLexiconService(ctx) })
    await svc.renderingIndex()
  }, 60_000)

  const ids = async (q: string) => (await svc.answerLexical(q))?.resolution?.candidates.map((c) => c.entry.id) ?? []

  it('resolves every Strong\'s spelling to the same verified lemma (scenario 2)', async () => {
    for (const q of ['G5485', 'g5485', 'G-5485', 'what does g5485 mean in Titus?']) {
      expect((await ids(q))[0]).toBe('G5485')
    }
    expect(await ids("Strong's G-25")).toEqual(['G25'])
  })

  it('reports a nonexistent id instead of inventing one', async () => {
    const a = await svc.answerLexical('G99999')
    expect(a?.resolution?.candidates).toEqual([])
    expect(a?.limitations.join(' ')).toMatch(/G99999 isn't in/)
  })

  it('returns several grouped candidates for an ambiguous English word (scenario 3)', async () => {
    const a = await svc.answerLexical('the word for mercy')
    const got = a!.resolution!
    expect(got.ambiguous).toBe(true)
    expect(got.hebrew.map((c) => c.entry.id)).toEqual(expect.arrayContaining(['H2617', 'H7356']))
    expect(got.greek.map((c) => c.entry.id)).toContain('G1656')
    // Best Hebrew match is the lemma the KJV most often renders "mercy".
    expect(got.hebrew[0].entry.id).toBe('H2617')
    expect(got.hebrew[0].kjvRenderingCount).toBeGreaterThan(100)
  })

  it('narrows by the language the question names', async () => {
    expect((await ids('the Hebrew word for mercy')).every((id) => id.startsWith('H'))).toBe(true)
    expect((await ids('the Greek word for faith'))[0]).toBe('G4102')
    expect((await ids('the Hebrew word for Torah'))[0]).toBe('H8451')
    expect((await ids('the Greek word for mammon'))[0]).toBe('G3126')
  })

  it('resolves transliterations and original script without the H2580 contamination', async () => {
    expect((await ids('chesed'))[0]).toBe('H2617')
    expect((await ids('agape'))[0]).toBe('G26')
    expect((await ids('what does agape mean in Greek'))[0]).toBe('G26')
    expect((await ids('חסד'))[0]).toBe('H2617')
    expect((await ids('χάρις'))[0]).toBe('G5485')
    for (const q of ['chesed', 'agape', 'χάρις', 'the word for holy', 'the word for spirit']) {
      expect(await ids(q)).not.toContain('H2580')
    }
  })

  it('leaves a bare ordinary English word to topical retrieval', async () => {
    expect(await svc.answerLexical('grace')).toBeNull()
    expect(await svc.answerLexical('verses about the jubilee')).toBeNull()
    expect(await svc.answerLexical('what is love')).toBeNull()
  })

  it('reads "what is <transliteration>" and "Hebrew noun for X" as word studies (holdout3 Z004, Z002)', async () => {
    expect(await ids('what is koinonia')).toContain('G2842')
    expect((await ids('tell me the Hebrew noun for heart')).slice(0, 3)).toEqual(expect.arrayContaining(['H3820']))
  })

  it('builds a deterministic word table with visible untagged words (scenario 5)', async () => {
    const a = await svc.answerLexical("Show every word and Strong's number in John 1:1")
    const v = a!.wordTables[0].verses[0]
    expect(v.tokens.find((t) => t.word === 'Word')?.strongs).toEqual(['G3056'])
    expect(v.tokens.find((t) => t.word === 'Word')?.entries[0]).toMatchObject({ id: 'G3056' })
    expect(v.coverage.tokens).toBe(v.coverage.tagged + v.coverage.untagged)
    const range = await svc.answerLexical("Strong's numbers for Genesis 1:1-3")
    expect(range!.wordTables[0].verses.map((x) => x.verse)).toEqual([1, 2, 3])
  })

  it('says the Septuagint Greek tags are unavailable rather than faking them', async () => {
    const a = await svc.answerLexical("Strong's numbers in the Greek Septuagint for Genesis 1:1")
    expect(a!.limitations.join(' ')).toMatch(/Septuagint word tags aren't available/)
  })

  it('counts occurrences exactly from text_tagged, scoped by book when asked', async () => {
    const all = await svc.occurrenceSummary('G5485')
    const kjvTotal = all.totals.find((t) => t.textId === 'kjva')!.verses
    expect(kjvTotal).toBeGreaterThan(100)
    const titus = await svc.occurrenceSummary('G5485', 'TIT')
    expect(titus.byBook.every((b) => b.bookId === 'TIT')).toBe(true)
    expect(titus.totals.find((t) => t.textId === 'kjva')!.verses).toBeGreaterThan(0)
  })
})

describe.skipIf(!haveData)('Strong\'s comparison (scenario 4, real data)', () => {
  it('compares H2617 and H7356 with exact counts and attested shared renderings, no interpretation', async () => {
    const { lexicalPayload } = await import('../researchService')
    const ctx = makeContext({ texts: { kjva, lxx }, lexiconDb: async (l) => (l === 'H' ? heb! : grk!) })
    const s = createResearchService(ctx, { lexicon: createLexiconService(ctx) })
    const a = await s.answerLexical('Compare H2617 and H7356')
    const p = lexicalPayload(a!)
    expect(p.kind).toBe('strongs-compare')
    expect(p.candidates.map((c) => c.id)).toEqual(['H2617', 'H7356'])
    expect(p.occurrences.map((o) => o.id)).toEqual(['H2617', 'H7356'])
    expect(p.occurrences[0].totals[0].verses).toBeGreaterThan(200)
    expect(p.comparison?.shared).toEqual(expect.arrayContaining(['mercy', 'pity']))
    expect(p.comparison?.only.H7356).toEqual(expect.arrayContaining(['womb']))
  })
})
