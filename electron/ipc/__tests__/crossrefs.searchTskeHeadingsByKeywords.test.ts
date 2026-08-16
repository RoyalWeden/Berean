import { describe, it, expect, beforeAll, vi } from 'vitest'

// NEXT_STEPS.md's one flagged concrete gap: searchTskeHeadingsByKeywords (the raw LIKE-query/
// word-boundary filter) had no isolated unit test, only indirect coverage via the eval harness
// and via the (mocked) consuming-logic tests in aiLookup.tskeCrossRefWidening.test.ts. This
// builds a small in-memory tske_refs table instead of hitting the real 355k-row DB, so the
// word-boundary filter's own claimed behavior (reject a substring-only match, e.g. "do" inside
// "wisdom") is directly verified rather than only inferred from end-to-end retrieval numbers.
//
// The real `better-sqlite3` native binary can't load under plain vitest in this environment
// (it's compiled against Electron's own Node ABI, not the bare Node the test runner uses —
// same reason every other DB-adjacent test in this repo, e.g.
// vault.extractInlineImages.test.ts, mocks the DB module entirely rather than instantiating a
// real one). So this hand-rolls a minimal fake `better-sqlite3` `Database` — just enough of
// `.prepare(sql).all(likeParam, limit)` to faithfully reproduce the ONE fixed query this
// function issues (a `heading LIKE ? ESCAPE '\'` prefilter, `ORDER BY sort_order ASC LIMIT ?`)
// against a small in-memory row array, rather than a general SQL engine.
interface FakeRow {
  heading: string | null; from_book: string; from_ch: number; from_vs: number
  to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null
  sort_order: number; is_reciprocal: number
}

const { rows } = vi.hoisted(() => {
  const rows: FakeRow[] = [
    { heading: 'a good understanding', from_book: 'PSA', from_ch: 111, from_vs: 10, to_book: 'PRO', to_ch: 1, to_vs: 7, to_vs_end: null, sort_order: 1, is_reciprocal: 0 },
    { heading: 'the fear of the LORD', from_book: 'PRO', from_ch: 1, from_vs: 7, to_book: 'PSA', to_ch: 111, to_vs: 10, to_vs_end: null, sort_order: 2, is_reciprocal: 0 },
    // "wisdom" contains the substring "do" but is NOT the word "do" — exists specifically to
    // prove the word-boundary filter rejects it rather than matching on LIKE '%do%' alone.
    { heading: 'the beginning of wisdom', from_book: 'PRO', from_ch: 9, from_vs: 10, to_book: 'PSA', to_ch: 111, to_vs: 10, to_vs_end: null, sort_order: 3, is_reciprocal: 0 },
    // A reciprocal row — excluded at the SQL level regardless of heading text.
    { heading: 'a good understanding', from_book: 'PRO', from_ch: 1, from_vs: 7, to_book: 'PSA', to_ch: 111, to_vs: 10, to_vs_end: null, sort_order: 4, is_reciprocal: 1 },
    // Apostrophe-as-HTML-entity, matching real tske_refs.db seeding — decodeTskeText must fire.
    { heading: 'a king&#x0027;s heart', from_book: 'PRO', from_ch: 21, from_vs: 1, to_book: 'PSA', to_ch: 21, to_vs: 1, to_vs_end: null, sort_order: 5, is_reciprocal: 0 },
  ]
  return { rows }
})

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
// crossrefs.ts also transitively imports ../db/bible, which imports 'fs' itself — a partial
// mock (existsSync only) leaves that module's OWN import without the default export it
// expects, so this preserves everything real and only overrides existsSync.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: () => true }
})
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    prepare: (sql: string) => ({
      all: (likeParam: string, limit: number) => {
        expect(sql).toContain('WHERE is_reciprocal = 0 AND heading LIKE ?')
        // likeParam is always `%<escaped-needle>%` (see crossrefs.ts's own construction) —
        // strip the wildcards back to a plain substring for this fake's simple `includes` scan.
        const needle = likeParam.slice(1, -1).replace(/\\([%_\\])/g, '$1').toLowerCase()
        return rows
          .filter((r) => r.is_reciprocal === 0 && r.heading != null && r.heading.toLowerCase().includes(needle))
          .sort((a, b) => a.sort_order - b.sort_order)
          .slice(0, limit)
      },
    }),
  })),
}))

describe('searchTskeHeadingsByKeywords', () => {
  let searchTskeHeadingsByKeywords: typeof import('../crossrefs').searchTskeHeadingsByKeywords

  beforeAll(async () => {
    ;({ searchTskeHeadingsByKeywords } = await import('../crossrefs'))
  })

  it('rejects a substring-only match ("do" inside "wisdom") via the word-boundary filter', () => {
    const hits = searchTskeHeadingsByKeywords(['do'])
    expect(hits.some((h) => h.heading.includes('wisdom'))).toBe(false)
  })

  it('matches a real standalone word inside a heading', () => {
    const hits = searchTskeHeadingsByKeywords(['understanding'])
    expect(hits.some((h) => h.heading === 'a good understanding')).toBe(true)
  })

  it('is case-insensitive', () => {
    const hits = searchTskeHeadingsByKeywords(['UNDERSTANDING'])
    expect(hits.some((h) => h.heading === 'a good understanding')).toBe(true)
  })

  it('excludes reciprocal rows (is_reciprocal = 1) even when the heading text would match', () => {
    const hits = searchTskeHeadingsByKeywords(['understanding'])
    expect(hits.filter((h) => h.heading === 'a good understanding')).toHaveLength(1)
  })

  it('drops keywords shorter than 3 characters (same floor as the aiLookup bridge functions)', () => {
    expect(searchTskeHeadingsByKeywords(['do', 'a'])).toEqual(searchTskeHeadingsByKeywords(['do']))
  })

  it('decodes the &#x0027; HTML-entity apostrophe seeded into the real DB', () => {
    const hits = searchTskeHeadingsByKeywords(['king'])
    const hit = hits.find((h) => h.heading.includes('king'))
    expect(hit?.heading).toBe("a king's heart")
  })

  it('returns [] for an empty keyword list, without touching the DB', () => {
    expect(searchTskeHeadingsByKeywords([])).toEqual([])
  })
})
