import { describe, it, expect, beforeAll } from 'vitest'
import { makeContext, memoryDb, realDataDb } from '../../db/__tests__/testDb'
import { createCrossrefsService, decodeTskeText } from '../crossrefsService'
import { toCanonicalChapters } from '../../../lib/translationChapterMap'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

describe('decodeTskeText', () => {
  it('decodes the literal &#x0027; entity tske_refs.db was seeded with, and passes null through', () => {
    expect(decodeTskeText("king&#x0027;s")).toBe("king's")
    expect(decodeTskeText('no entity here')).toBe('no entity here')
    expect(decodeTskeText(null)).toBeNull()
  })
})

describe('crossrefsService (no data)', () => {
  const svc = createCrossrefsService(makeContext({ dataDb: async () => null }))

  it('every read reports hasData:false / error:true with empty results', async () => {
    expect(await svc.status()).toEqual({ hasData: false, loading: false, error: true })
    expect(await svc.getForVerse('GEN', 1, 1)).toEqual({ refs: [], loading: false, error: true })
    expect(await svc.getTSKeForVerse('GEN', 1, 1)).toEqual({ groups: [], loading: false, error: true })
    expect(await svc.getForChapter('GEN', 1)).toEqual({ verseRefs: [], error: true })
    expect(await svc.getTSKeForChapter('GEN', 1)).toEqual({ verseRefs: [], error: true })
    expect(await svc.getHermasTaylorChapter('HER_MAN', 18)).toEqual({ refs: [], error: true })
  })
})

// LXX Psalms merge: toCanonicalChapters('PSA', 9, 'lxx') === [9, 10] (KJV 9+10 merged into LXX 9).
// cross_references.db is keyed to KJV chapter numbers, so this exercises the two-chapter fan-out
// getForVerse falls into. Built as a fixture (rather than relying on real data happening to have
// a coincidental duplicate target ref across KJV chapters 9 and 10) so the de-dup path is
// deterministically exercised: PSA 9:1 and PSA 10:1 both cross-reference HEB 1:1 here.
describe('crossrefsService (LXX merge union + de-dup, fixture data)', () => {
  let svc: ReturnType<typeof createCrossrefsService>

  beforeAll(async () => {
    expect(toCanonicalChapters('PSA', 9, 'lxx')).toEqual([9, 10])
    const refsDb = memoryDb('data:cross_references-fixture')
    await refsDb.exec(`
      CREATE TABLE refs (
        from_book TEXT NOT NULL, from_ch INTEGER NOT NULL, from_vs INTEGER NOT NULL,
        to_book TEXT NOT NULL, to_ch INTEGER NOT NULL, to_vs INTEGER NOT NULL,
        to_vs_end INTEGER, votes INTEGER NOT NULL DEFAULT 0
      );
    `)
    const rows: Array<[string, number, number, string, number, number, number]> = [
      ['PSA', 9, 1, 'HEB', 1, 1, 5],  // duplicated below from chapter 10 with fewer votes
      ['PSA', 9, 1, 'ROM', 3, 1, 2],  // unique to chapter 9
      ['PSA', 10, 1, 'JHN', 3, 16, 9], // unique to chapter 10
      ['PSA', 10, 1, 'HEB', 1, 1, 3], // duplicate target of the chapter-9 row above
    ]
    for (const [fb, fc, fv, tb, tc, tv, votes] of rows) {
      await refsDb.run('INSERT INTO refs (from_book, from_ch, from_vs, to_book, to_ch, to_vs, votes) VALUES (?,?,?,?,?,?,?)', [fb, fc, fv, tb, tc, tv, votes])
    }
    svc = createCrossrefsService(makeContext({ dataDb: async (name) => (name === 'cross_references' ? refsDb : null) }))
  })

  it('getForVerse unions refs from both merged KJV chapters and de-dupes by target verse (first chapter wins)', async () => {
    const { refs, error } = await svc.getForVerse('PSA', 9, 1, 'lxx')
    expect(error).toBe(false)
    expect(refs).toHaveLength(3) // HEB 1:1 (deduped), ROM 3:1, JHN 3:16
    const heb = refs.find((r) => r.bookId === 'HEB')!
    expect(heb.votes).toBe(5) // the chapter-9 copy, not chapter-10's
    expect(refs.some((r) => r.bookId === 'ROM' && r.verse === 1)).toBe(true)
    expect(refs.some((r) => r.bookId === 'JHN' && r.verse === 16)).toBe(true)
  })

  it('getForChapter unions rows from both merged KJV chapters without de-duping (grouped by from_vs only)', async () => {
    const { verseRefs, error } = await svc.getForChapter('PSA', 9, 'lxx')
    expect(error).toBe(false)
    expect(verseRefs.map((v) => v.verseNum)).toEqual([1]) // only from_vs=1 has rows in the fixture
    expect(verseRefs[0].refs).toHaveLength(4) // simple concatenation: all 4 fixture rows land in verse 1's group
  })
})

describe('crossrefsService (real data, skipped when absent)', () => {
  const crossRefsDb = realDataDb('cross_references.db')
  const tskeDb = realDataDb('tske_refs.db')
  const hermasDb = realDataDb('hermas_taylor.db')
  const kjva = realDataDb('kjva.db')
  const real = !!(crossRefsDb && tskeDb && hermasDb && kjva)
  const run = real ? it : it.skip

  const svc = real
    ? createCrossrefsService(makeContext({
        texts: { kjva: kjva! },
        dataDb: async (name) => (name === 'cross_references' ? crossRefsDb : name === 'tske_refs' ? tskeDb : name === 'hermas_taylor' ? hermasDb : null),
      }))
    : null

  run('status reports hasData: true when cross_references.db is present', async () => {
    expect(await svc!.status()).toEqual({ hasData: true, loading: false, error: false })
  })

  run('getForVerse(GEN 1:1) resolves target KJV text, e.g. the John 1:1 cross-reference', async () => {
    const { refs, error } = await svc!.getForVerse('GEN', 1, 1)
    expect(error).toBe(false)
    const jhn = refs.find((r) => r.bookId === 'JHN' && r.chapter === 1 && r.verse === 1)
    expect(jhn).toBeTruthy()
    expect(jhn!.text).toBe('In the beginning was the Word, and the Word was with God, and the Word was God.')
  })

  run('getTSKeForVerse(GEN 14:17) decodes the &#x0027; entity in its heading and groups reciprocal refs separately', async () => {
    const { groups, error } = await svc!.getTSKeForVerse('GEN', 14, 17)
    expect(error).toBe(false)
    expect(JSON.stringify(groups)).not.toContain('&#x0027;')
    const kingsGroup = groups.find((g) => g.heading === "king's")
    expect(kingsGroup).toBeTruthy()
    expect(kingsGroup!.isReciprocal).toBe(false)
    expect(kingsGroup!.refs.some((r) => r.bookId === '2SA' && r.chapter === 18 && r.verse === 18)).toBe(true)
    const reciprocal = groups.find((g) => g.isReciprocal)
    expect(reciprocal).toBeTruthy()
    expect(reciprocal!.heading).toBeNull()
  })

  run('getForChapter/getTSKeForChapter group by verseNum ascending', async () => {
    const { verseRefs } = await svc!.getForChapter('GEN', 14)
    const nums = verseRefs.map((v) => v.verseNum)
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
    expect(nums.length).toBeGreaterThan(0)

    const tske = await svc!.getTSKeForChapter('GEN', 14)
    const tskeNums = tske.verseRefs.map((v) => v.verseNum)
    expect(tskeNums).toEqual([...tskeNums].sort((a, b) => a - b))
    expect(tskeNums).toContain(17)
  })

  run('LXX merged-chapter path: getForChapter unions KJV 9+10 into LXX Psalm 9, verse 1 combining both chapters\' refs', async () => {
    expect(toCanonicalChapters('PSA', 9, 'lxx')).toEqual([9, 10])
    const kjv9 = await svc!.getForChapter('PSA', 9, 'kjva')
    const kjv10 = await svc!.getForChapter('PSA', 10, 'kjva')
    const count9v1 = kjv9.verseRefs.find((v) => v.verseNum === 1)?.refs.length ?? 0
    const count10v1 = kjv10.verseRefs.find((v) => v.verseNum === 1)?.refs.length ?? 0
    expect(count9v1).toBeGreaterThan(0)
    expect(count10v1).toBeGreaterThan(0)

    const merged = await svc!.getForChapter('PSA', 9, 'lxx')
    const mergedV1 = merged.verseRefs.find((v) => v.verseNum === 1)!
    expect(mergedV1.refs.length).toBe(count9v1 + count10v1) // straight union, no de-dup at chapter level
  })

  run('getHermasTaylorChapter returns raw footnote refs for a real Taylor-Hermas chapter', async () => {
    const { refs, error } = await svc!.getHermasTaylorChapter('HER_MAN', 18)
    expect(error).toBe(false)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0]).toHaveProperty('raw')
  })
})
