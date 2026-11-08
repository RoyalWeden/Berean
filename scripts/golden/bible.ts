/**
 * Bible-service golden (M2-03/M2-04): the TypeScript `createBibleService` run read-only against
 * the bundled text databases in data/. Large outputs are stored as row count + FNV short hash of
 * their JSON (BereanCore computes the same hash), plus a few chapters in full.
 *
 * The databases are not in Git: when data/ lacks them this golden is skipped (null), and the drift
 * guard skips it too. Regenerate after `npm run data:publish` changes a text.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqlite } from '../../electron/db/adapters/nodeSqliteAdapter'
import { createBibleService, safeFtsQuery as bibleFts } from '../../src/platform/services/bibleService'
import { consoleLogger, createServiceEvents, defaultUuid } from '../../src/platform/services/context'
import type { DatabaseAdapter } from '../../src/platform/db/DatabaseAdapter'
import { numberTokenAlternates } from '../../src/lib/numberWords'

const ROOT = resolve(__dirname, '../..')
export const BIBLE_TEXTS = ['kjv', 'kjva', 'lxx', 'lxx_brenton', 'enoch', 'jubilees', '1clement', '2baruch', 'apoc_abraham', 'apoc_elijah',
  'asc_isaiah', 'didache_hoole', 'ep_barnabas', 'gad', 'hermas', 'hermas_taylor', 'recog_clement', 't_jacob', 't_job', 't12p']

function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}
const digest = (x: unknown) => { const j = JSON.stringify(x); return { count: Array.isArray(x) ? x.length : Object.keys(x as object).length, hash: shortHash(j) } }
/** Order-independent digest: rows' JSON strings sorted by UTF-16 code units. FTS `ORDER BY rank` has no
 *  tie-breaker, so equal-rank rows come back in an order that depends on the SQLite version (F-05). */
const setHash = (rows: unknown[]) => shortHash(JSON.stringify(rows.map((r) => JSON.stringify(r)).sort()))

export async function buildBibleGolden(): Promise<{ name: string; data: unknown } | null> {
  const paths = Object.fromEntries(BIBLE_TEXTS.map((t) => [t, resolve(ROOT, 'data', `${t}.db`)]))
  if (!Object.values(paths).every((p) => existsSync(p))) return null
  const dbs = new Map<string, DatabaseAdapter>()
  const svc = createBibleService({
    userDb: null as unknown as DatabaseAdapter,
    textDb: async (id) => {
      if (!paths[id]) return null
      if (!dbs.has(id)) dbs.set(id, openNodeSqlite(paths[id], `text:${id}`, true))
      return dbs.get(id)!
    },
    lexiconDb: async () => { throw new Error('unused') },
    dataDb: async () => null,
    events: createServiceEvents(), now: () => 0, uuid: defaultUuid, isDev: true, log: consoleLogger,
  })

  const texts: Record<string, unknown> = {}
  for (const t of BIBLE_TEXTS) {
    const books = await svc.getBooks(t)
    const chapters: unknown[] = []
    for (const b of books) {
      for (const ch of [...new Set([1, Math.max(1, Math.ceil(b.chapters_count / 2)), b.chapters_count])]) {
        const rows = await svc.queryChapter(b.id, ch, t)
        chapters.push({ bookId: b.id, chapter: ch, ...digest(rows) })
      }
    }
    const first = books[0]
    texts[t] = {
      databaseSha256: createHash('sha256').update(readFileSync(paths[t])).digest('hex'),
      books,
      chapters,
      firstChapterFull: first ? await svc.queryChapter(first.id, 1, t) : [],
      verse: first ? await svc.queryVerse(first.id, 1, 1, t) : null,
      missingVerse: first ? await svc.queryVerse(first.id, 1, 9999, t) : null,
      unknownChapter: digest(await svc.queryChapter('XYZ', 1, t)),
    }
  }
  const versesSample = await svc.queryVerses([
    { bookId: 'GEN', chapter: 1, verse: 1 }, { bookId: 'GEN', chapter: 1, verse: 3 }, { bookId: 'JHN', chapter: 3, verse: 16 },
    { bookId: 'PSA', chapter: 119, verse: 176 }, { bookId: 'GEN', chapter: 1, verse: 9999 }, { bookId: 'XYZ', chapter: 1, verse: 1 },
    { bookId: 'GEN', chapter: 1, verse: 1 },
  ], 'kjva')

  const queries = ['in the beginning', 'seven', '7', 'twenty', 'threescore', 'love', 'grace', 'faith hope charity', 'Lord God', "LORD's", 'and the',
    'x', '', '   ', 'OR', 'NOT', '"quoted"', 'light*', 'é', 'word-for-word', 'sabbath', 'Joshua', 'Holy Ghost', '12 tribes', 'one hundred']
  const search: unknown[] = []
  for (const t of ['kjva', 'kjv', 'lxx', 'enoch']) {
    for (const q of queries) {
      for (const mode of ['all', 'any', 'phrase'] as const) {
        const rows = await svc.searchText(q, t, mode)
        search.push({ text: t, query: q, mode, ...digest(rows), setHash: setHash(rows), first: rows.slice(0, 3).map((r) => `${r.book_id}.${r.chapter}.${r.verse_num}`) })
      }
    }
  }
  for (const [q, books, ch] of [['love', ['JHN', '1JN'], undefined], ['love', ['1JN'], 4], ['light', ['GEN'], 1], ['light', [], undefined], ['god', ['XYZ'], undefined]] as const) {
    for (const mode of ['all', 'any'] as const) {
      const rows = await svc.searchText(q, 'kjva', mode, [...books], ch)
      search.push({ text: 'kjva', query: q, mode, bookIds: books, chapter: ch ?? null, ...digest(rows), setHash: setHash(rows), first: rows.slice(0, 3).map((r) => `${r.book_id}.${r.chapter}.${r.verse_num}`) })
    }
  }
  const fts = queries.flatMap((q) => (['all', 'phrase'] as const).map((mode) => ({ query: q, mode, result: bibleFts(q, mode) })))
  const numberWords = ['0', '7', '20', '60', '80', '99', '100', '1000', 'seven', 'Seven', 'twenty', 'score', 'threescore', 'sixty', 'hundred', 'x', '007']
    .map((token) => ({ token, result: numberTokenAlternates(token) }))
  for (const db of dbs.values()) await db.close?.()
  return {
    name: 'bible',
    data: {
      format: 1, generator: 'scripts/golden/bible.ts',
      sources: Object.fromEntries(['src/platform/services/bibleService.ts', 'src/lib/numberWords.ts', 'src/lib/parseRef.ts', 'scripts/golden/bible.ts']
        .map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      texts, versesSample, search, fts, numberWords,
    },
  }
}
