/**
 * Lexicon golden (M2-04): `createLexiconService` (getEntry, getRelated, search, getOccurrencePage)
 * read-only over data/strongs_*.db and the tagged texts. Skipped (null) when the databases are absent.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqlite } from '../../electron/db/adapters/nodeSqliteAdapter'
import { createLexiconService } from '../../src/platform/services/lexiconService'
import { consoleLogger, createServiceEvents, defaultUuid } from '../../src/platform/services/context'
import type { DatabaseAdapter } from '../../src/platform/db/DatabaseAdapter'

const ROOT = resolve(__dirname, '../..')
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}

export async function buildLexiconGolden(): Promise<{ name: string; data: unknown } | null> {
  const files = { H: 'strongs_hebrew.db', G: 'strongs_greek.db', kjva: 'kjva.db', lxx: 'lxx.db' }
  if (!Object.values(files).every((f) => existsSync(resolve(ROOT, 'data', f)))) return null
  const open = new Map<string, DatabaseAdapter>()
  const get = (f: string) => { if (!open.has(f)) open.set(f, openNodeSqlite(resolve(ROOT, 'data', f), f, true)); return open.get(f)! }
  const svc = createLexiconService({
    userDb: null as unknown as DatabaseAdapter,
    textDb: async (id) => (id === 'kjva' || id === 'lxx' ? get(`${id}.db`) : null),
    lexiconDb: async (lang) => get(lang === 'H' ? files.H : files.G),
    dataDb: async () => null,
    events: createServiceEvents(), now: () => 0, uuid: defaultUuid, isDev: true, log: consoleLogger,
  })
  // Every entry, digested per block of 250 ids.
  const entryBlocks: unknown[] = []
  for (const [lang, max] of [['H', 8674], ['G', 5624]] as const) {
    for (let start = 1; start <= max; start += 250) {
      const rows: unknown[] = []
      for (let n = start; n < start + 250 && n <= max + 2; n++) rows.push(await svc.getEntry(`${lang}${n}`))
      entryBlocks.push({ lang, start, hash: shortHash(JSON.stringify(rows)) })
    }
  }
  const entryCases = ['H7225', 'h7225', ' G5485 ', 'G26', 'H0', 'H07225', 'X1', '', 'G', 'H99999', 'G3056']
    .map((id) => ({ id, entry: null as unknown })); for (const c of entryCases) c.entry = await svc.getEntry(c.id)
  const related = await Promise.all(['H1', 'H6', 'H24', 'H430', 'H3068', 'H0010', 'G26', 'G1537', 'G5485', 'X1', 'H', 'G'].map(async (id) => ({ id, related: await svc.getRelated(id) })))
  const search: unknown[] = []
  for (const q of ['grace', 'love', 'beginning', 'H72', 'agape', 'λόγος', 'בְּרֵאשִׁית', '', '%', '_', 'lord god', 'Yehovah', 'Jehovah'])
    for (const lang of ['H', 'G', 'all'] as const) search.push({ query: q, lang, results: await svc.search(q, lang) })
  const pages: unknown[] = []
  for (const [num, textId, bookId, offset, limit] of [['H7225', 'kjva', 'GEN', 0, 20], ['G5485', 'kjva', 'ROM', 0, 5], ['G5485', 'kjva', 'ROM', 5, 5], ['G5485', 'lxx', 'GEN', 0, 50],
    ['h430', 'kjva', 'gen', 10, 100], ['H430', 'lxx', 'GEN', 0, 10], ['G26', 'kjva', '1JN', 0, 0], ['G26', 'kjva', '1JN', -5, 3.7], ['G1', 'xyz', 'GEN', 0, 5]] as const)
    pages.push({ num, textId, bookId, offset, limit, page: await svc.getOccurrencePage(num, { textId, bookId, offset, limit }) })
  for (const db of open.values()) await db.close()
  return {
    name: 'lexicon',
    data: {
      format: 1, generator: 'scripts/golden/lexicon.ts',
      sources: Object.fromEntries(['src/platform/services/lexiconService.ts', 'scripts/golden/lexicon.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      databases: Object.fromEntries(Object.values(files).map((f) => [f, createHash('sha256').update(readFileSync(resolve(ROOT, 'data', f))).digest('hex')])),
      entryBlocks, entryCases, related, search, pages,
    },
  }
}
