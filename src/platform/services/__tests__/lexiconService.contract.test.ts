import { describe, it, expect, beforeAll } from 'vitest'
import { fixtureTextDb, makeContext, memoryDb, realDataDb } from '../../db/__tests__/testDb'
import { createLexiconService } from '../lexiconService'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

/** Minimal in-memory stand-in for strongs_hebrew.db/strongs_greek.db's `entries` table, with
 *  exactly the columns lexiconService's SELECTs read (verified against the real bundled schema:
 *  `sqlite3 data/strongs_hebrew.db ".schema entries"`). */
async function fakeLexiconDb(rows: Array<{ strongs_id: string; word?: string; transliteration?: string; short_def?: string; derivation?: string }>): Promise<DatabaseAdapter> {
  const db = memoryDb(`lex:fixture-${Math.random().toString(36).slice(2, 6)}`)
  await db.exec(`
    CREATE TABLE entries (
      strongs_id TEXT PRIMARY KEY, word TEXT, transliteration TEXT, pronunciation TEXT,
      short_def TEXT, full_def TEXT, derivation TEXT, bdb_def TEXT, occurrence_count INTEGER DEFAULT 0
    );
  `)
  for (const r of rows) {
    await db.run(
      'INSERT INTO entries (strongs_id, word, transliteration, short_def, derivation) VALUES (?,?,?,?,?)',
      [r.strongs_id, r.word ?? null, r.transliteration ?? null, r.short_def ?? null, r.derivation ?? null],
    )
  }
  return db
}

describe('lexiconService (fixture data)', () => {
  it('getOccurrences finds the tagged word and returns its match-word-index within the plain text', async () => {
    const text = await fixtureTextDb([
      { book: 'GEN', ch: 1, v: 1, text: 'In the beginning God created the heaven and the earth.', tagged: 'In{} the{} beginning{H7225} God{H430} created{H1254} ~{H853} the{} heaven{H8064} and{} the{} earth.{H776}' },
    ])
    const lexDb = await fakeLexiconDb([{ strongs_id: 'H7225', short_def: 'beginning, chief, first, principal thing.' }])
    const svc = createLexiconService(makeContext({ texts: { kjva: text }, lexiconDb: async () => lexDb }))

    const occ = await svc.getOccurrences('H7225')
    expect(occ).toHaveLength(1)
    expect(occ[0]).toMatchObject({ book_id: 'GEN', chapter: 1, verse_num: 1, text_id: 'kjva' })
    expect(occ[0].matchWordIndices).toEqual([2]) // "beginning" is plain-text word index 2

    expect(await svc.getOccurrences('H0000')).toEqual([]) // no tagged rows at all -> short-circuits to []
  })

  // Regression scenario for a live bug: getOccurrences used to filter `bookId` in JS AFTER a
  // `LIMIT 500/1000` SQL scan (ordered by book_id, chapter, verse_num) — so a book-scoped lookup
  // silently came back empty whenever the requested book sorted late enough that none of its rows
  // made it into the first 1000 tagged hits, even though real occurrences existed there. See
  // electron/ipc/__tests__/lexicon.occurrences.test.ts for the original fake-db reproduction;
  // this is the same scenario against a real in-memory SQLite text DB.
  describe('bookId scoping past the scan LIMIT', () => {
    let svc: ReturnType<typeof createLexiconService>

    beforeAll(async () => {
      const GEN_PADDING = 1200 // exceeds the real 1000-row Hebrew scan LIMIT
      const verses = [
        { book: 'GEN', ch: 1, v: 1, text: 'word', tagged: 'word{H0001}' },
        ...Array.from({ length: GEN_PADDING }, (_, i) => ({ book: 'GEN', ch: 1, v: i + 2, text: 'word', tagged: 'word{H0001}' })),
        { book: 'ZEC', ch: 1, v: 1, text: 'word', tagged: 'word{H0001}' },
      ]
      const text = await fixtureTextDb(verses, {
        books: [
          { id: 'GEN', name: 'Genesis', short: 'Gen', testament: 'OT', chapters: 50 },
          { id: 'ZEC', name: 'Zechariah', short: 'Zech', testament: 'OT', chapters: 14 },
        ],
      })
      const lexDb = await fakeLexiconDb([{ strongs_id: 'H0001', short_def: 'test word' }])
      svc = createLexiconService(makeContext({ texts: { kjva: text }, lexiconDb: async () => lexDb }))
    })

    it('finds the book-scoped occurrence even though it sorts after the scan limit', async () => {
      const results = await svc.getOccurrences('H0001', 'ZEC')
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((r) => r.book_id === 'ZEC')).toBe(true)
    })

    it('without a bookId, the unscoped scan truncates at 1000 and never reaches the late-sorting ZEC row', async () => {
      const results = await svc.getOccurrences('H0001')
      expect(results).toHaveLength(1000)
      expect(results.every((r) => r.book_id === 'GEN')).toBe(true)
    })
  })
})

describe('lexiconService (real strongs_hebrew.db/strongs_greek.db/kjva.db, skipped when data is absent)', () => {
  const hebrew = realDataDb('strongs_hebrew.db')
  const greek = realDataDb('strongs_greek.db')
  const kjva = realDataDb('kjva.db')
  const lxx = realDataDb('lxx_brenton.db')
  const real = !!(hebrew && greek && kjva)
  const run = real ? it : it.skip

  const svc = real
    ? createLexiconService(makeContext({
        texts: { kjva: kjva!, lxx: lxx ?? null },
        lexiconDb: async (lang) => (lang === 'H' ? hebrew! : greek!),
      }))
    : null

  run('getEntry: H7225 has a Hebrew word, transliteration, and gloss; lowercase input is normalised', async () => {
    const upper = await svc!.getEntry('H7225')
    expect(upper).toMatchObject({ strongsNum: 'H7225', transliteration: 'rêʼshîyth' })
    expect(upper!.lemma.length).toBeGreaterThan(0) // Hebrew script — not comparing literal bytes
    expect(upper!.gloss).toContain('beginning')
    const lower = await svc!.getEntry('h7225')
    expect(lower).toEqual(upper)
  })

  run('getEntry: G3056 has a Greek word and occurrence count', async () => {
    const entry = await svc!.getEntry('G3056')
    expect(entry).toMatchObject({ strongsNum: 'G3056' })
    expect(entry!.lemma.length).toBeGreaterThan(0) // Greek script — not comparing literal bytes
    expect(entry!.occurrences).toBeGreaterThan(0)
  })

  run('getEntry: unknown number or non-H/G prefix returns null', async () => {
    expect(await svc!.getEntry('H99999')).toBeNull()
    expect(await svc!.getEntry('X123')).toBeNull()
  })

  run('getOccurrences: H7225 includes GEN 1:1 with the "beginning" word index', async () => {
    const occ = await svc!.getOccurrences('H7225')
    const gen11 = occ.find((r) => r.book_id === 'GEN' && r.chapter === 1 && r.verse_num === 1)
    expect(gen11).toBeTruthy()
    expect(gen11!.matchWordIndices).toContain(2)
  })

  run('getOccurrences: quickLimit caps the scan and bookId scopes to just that book', async () => {
    const quick = await svc!.getOccurrences('H7225', undefined, 5)
    expect(quick.length).toBeLessThanOrEqual(5)
    const scoped = await svc!.getOccurrences('H7225', 'GEN')
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((r) => r.book_id === 'GEN')).toBe(true)
  })

  run('getRelated: Greek entries derived from G2316 (theos) list related words, excluding itself', async () => {
    const related = await svc!.getRelated('G2316')
    expect(related.length).toBeGreaterThan(0)
    expect(related.length).toBeLessThanOrEqual(12)
    expect(related.some((r) => r.strongsNum === 'G2299')).toBe(true)
    expect(related.every((r) => r.strongsNum !== 'G2316')).toBe(true)
  })

  // strongs_hebrew.db's `derivation` text cites bare numbers ("from the same as 24") with no "H"
  // prefix; the service matches the bare number as a whole token (K7 fix). H7218 (rosh, "head")
  // is cited by H7225 (reshith) among others; the whole-token check must not let "72180" or
  // "17218" through.
  run('getRelated: Hebrew derivations cite bare numbers and are matched as whole tokens', async () => {
    const related = await svc!.getRelated('H7218')
    expect(related.length).toBeGreaterThan(0)
    expect(related.length).toBeLessThanOrEqual(12)
    expect(related.some((r) => r.strongsNum === 'H7225')).toBe(true)
    expect(related.every((r) => r.strongsNum !== 'H7218')).toBe(true)
    // a small number must not match every derivation containing that digit
    const six = await svc!.getRelated('H6')
    expect(six.length).toBeLessThanOrEqual(12)
    expect(six.some((r) => r.strongsNum === 'H9')).toBe(true)   // "from 6 ; Compare 10 ."
  })

  run('search: lang "H" finds by gloss, lang "all" finds by strongs_id across both lexicons', async () => {
    const byGloss = await svc!.search('beginning', 'H')
    expect(byGloss.some((e) => e.strongsNum === 'H7225')).toBe(true)

    const byId = await svc!.search('G3056', 'all')
    expect(byId.some((e) => e.strongsNum === 'G3056')).toBe(true)

    const byGreekGloss = await svc!.search('word', 'G')
    expect(byGreekGloss.some((e) => e.strongsNum === 'G3056')).toBe(true)

    // searchLexiconGloss is the same function under its desktop-compat alias
    expect(svc!.searchLexiconGloss).toBe(svc!.search)
  })

  run('findByNormalizedTransliteration matches through accent stripping', async () => {
    const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const hit = await svc!.findByNormalizedTransliteration('logos', 'G', normalize)
    expect(hit).toEqual({ strongsId: 'G3056', transliteration: 'lógos' })
    expect(await svc!.findByNormalizedTransliteration('nonexistentword', 'all', normalize)).toBeNull()
  })
})
