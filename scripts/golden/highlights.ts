/** Highlights golden: createHighlightsService toggle/getChapter/remove script on a migrated DB (fake clock). */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHighlightsService } from '../../src/platform/services/highlightsService'
import { migratedUserDb } from '../../src/platform/db/__tests__/testDb'
import { consoleLogger, createServiceEvents } from '../../src/platform/services/context'

const ROOT = resolve(__dirname, '../..')
export const HIGHLIGHT_SCRIPT = [
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'yellow' },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'red' },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'red' },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'green', startWord: 2, endWord: 4 },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'blue', startChar: 4, endChar: 13 },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'blue', startChar: 4, endChar: 13, startWord: 1, endWord: 1 },
  { bookId: 'JHN', chapter: 3, verseNum: 17, color: 'purple', startChar: 0, endChar: 3 },
  { bookId: 'JHN', chapter: 3, verseNum: 3, color: 'yellow' },
  { bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow', textId: 'lxx' },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'green', startWord: 2, endWord: 4 },
  { bookId: 'JHN', chapter: 3, verseNum: 16, color: 'orange', startWord: 2 },
]

export async function buildHighlightsGolden(): Promise<{ name: string; data: unknown }> {
  const db = await migratedUserDb()
  let clock = 70_000
  const events: unknown[] = []
  const ev = createServiceEvents()
  ev.on('data:changed', (c) => events.push({ entity: c.entity, id: c.id ?? null, op: c.op, scope: c.scope ?? null }))
  const svc = createHighlightsService({ userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('unused') }, dataDb: async () => null,
    events: ev, now: () => clock, uuid: () => 'u', isDev: true, log: consoleLogger })
  const results: unknown[] = []
  for (const p of HIGHLIGHT_SCRIPT) { clock += 5; results.push(await svc.toggle(p as never)) }
  const chapter = await svc.getChapter('JHN', 3)
  const lxx = await svc.getChapter('GEN', 1, 'lxx')
  await svc.remove('JHN', 3, 17)
  const after = await svc.getChapter('JHN', 3)
  const rows = await db.all('SELECT * FROM highlights ORDER BY id')
  await db.close()
  return { name: 'highlights', data: { format: 1, generator: 'scripts/golden/highlights.ts',
    sources: Object.fromEntries(['src/platform/services/highlightsService.ts', 'scripts/golden/highlights.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
    script: HIGHLIGHT_SCRIPT, results, chapter, lxx, after, rows, events } }
}
