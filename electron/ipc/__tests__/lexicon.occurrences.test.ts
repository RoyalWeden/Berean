import { describe, it, expect, vi, beforeAll } from 'vitest'

// Regression test for a live bug: getLexiconOccurrences used to filter `bookId` in JS AFTER a
// `LIMIT 500/1000` SQL scan (ordered by book_id, chapter, verse_num) — so a book-scoped lookup
// silently came back EMPTY whenever the requested book sorted late enough that none of its rows
// made it into the first 500/1000 tagged hits, even though real occurrences existed there.
//
// This test can't use a real better-sqlite3 database (the native binding in this worktree is
// compiled against Electron's Node ABI, not the plain Node ABI `vitest` runs under — see
// package.json's `rebuild` script) — instead it stubs a minimal fake "db" whose `.prepare(sql)`
// returns a row-scanning `.all(...params)` that mirrors real SQLite semantics closely enough to
// exercise this bug: it applies a `LIKE`-style tag match, an optional `AND book_id = ?` clause
// (present iff the SQL text contains it — i.e. iff the fix pushed the book filter into the query
// itself) BEFORE truncating to `LIMIT n`, and only then applies LIMIT. A pre-fix implementation
// that filtered by book_id in JS after the DB call would still pass this fake DB the same way a
// real one would, since the fake enforces the LIMIT identically — the pre-fix `WHERE` clause it
// built simply never contained "book_id = ?", so this fake (like real SQLite) would return the
// first `limit` matching rows in book/chapter/verse order regardless of the caller's `bookId`.
interface FakeRow { book_id: string; chapter: number; verse_num: number; text_tagged: string; text: string }

function makeFakeVersesDb(rows: FakeRow[]) {
  const sorted = [...rows].sort((a, b) =>
    a.book_id === b.book_id
      ? (a.chapter === b.chapter ? a.verse_num - b.verse_num : a.chapter - b.chapter)
      : a.book_id.localeCompare(b.book_id))
  return {
    prepare(sql: string) {
      return {
        all(...params: unknown[]) {
          const hasBookClause = /AND book_id = \?/.test(sql)
          const limit = params[params.length - 1] as number
          const bookId = hasBookClause ? (params[params.length - 2] as string) : undefined
          const tagPatterns = (params.slice(0, 4) as string[]).map((p) => p.replace(/^%/, '').replace(/%$/, ''))
          const matches = sorted.filter((r) => tagPatterns.some((p) => r.text_tagged.includes(p.replace(/[{}]/g, (c) => c))))
          const scoped = hasBookClause ? matches.filter((r) => r.book_id === bookId) : matches
          return scoped.slice(0, limit).map((r) => ({ book_id: r.book_id, chapter: r.chapter, verse: r.verse_num }))
        },
        get(id: string) {
          if (id === 'H0001') return { short_def: 'test word' }
          return undefined
        },
      }
    },
    exec() {},
  }
}

const GEN_PADDING = 1200 // exceeds the real 1000-row Hebrew LIMIT — see scanTaggedOccurrences
const rows: FakeRow[] = [
  { book_id: 'GEN', chapter: 1, verse_num: 1, text: 'word', text_tagged: 'word{H0001}' },
  ...Array.from({ length: GEN_PADDING }, (_, i) => ({
    book_id: 'GEN', chapter: 1, verse_num: i + 2, text: 'filler', text_tagged: 'filler',
  })),
  { book_id: 'ZEC', chapter: 1, verse_num: 1, text: 'word', text_tagged: 'word{H0001}' },
]

const fakeKjva = makeFakeVersesDb(rows)

vi.mock('../../db/lexicon', () => ({
  getHebrewDb: () => fakeKjva,
  getGreekDb: () => { throw new Error('not used in this test') },
}))

vi.mock('../../db/bible', () => ({
  getTextDb: (textId: string) => (textId === 'kjva' ? fakeKjva : null),
}))

describe('getLexiconOccurrences book scoping', () => {
  let getLexiconOccurrences: typeof import('../lexicon').getLexiconOccurrences

  beforeAll(async () => {
    ;({ getLexiconOccurrences } = await import('../lexicon'))
  })

  it('finds a book-scoped occurrence even when it sorts after the scan limit', () => {
    const results = getLexiconOccurrences('H0001', 'ZEC')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.book_id === 'ZEC')).toBe(true)
  })

  it('still returns the unscoped occurrence in GEN', () => {
    const results = getLexiconOccurrences('H0001', 'GEN')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.book_id === 'GEN')).toBe(true)
  })
})
