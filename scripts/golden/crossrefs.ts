/**
 * Cross-reference golden (M2-04): `createCrossrefsService` over cross_references.db, tske_refs.db and
 * hermas_taylor.db (verse texts from kjva.db), plus the KJV⇄LXX chapter map (translationChapterMap.ts).
 * Skipped (null) when the databases are absent.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqlite } from '../../electron/db/adapters/nodeSqliteAdapter'
import { createCrossrefsService } from '../../src/platform/services/crossrefsService'
import { consoleLogger, createServiceEvents, defaultUuid } from '../../src/platform/services/context'
import type { DatabaseAdapter } from '../../src/platform/db/DatabaseAdapter'
import { equivalentChapters, mapChapterOnTranslationSwitch, toCanonicalChapters, versificationNote } from '../../src/lib/translationChapterMap'

const ROOT = resolve(__dirname, '../..')
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}
const digest = (x: unknown) => shortHash(JSON.stringify(x))

export async function buildCrossrefsGolden(): Promise<{ name: string; data: unknown } | null> {
  const files = ['cross_references.db', 'tske_refs.db', 'hermas_taylor.db', 'kjva.db']
  if (!files.every((f) => existsSync(resolve(ROOT, 'data', f)))) return null
  const open = new Map<string, DatabaseAdapter>()
  const get = (f: string) => { if (!open.has(f)) open.set(f, openNodeSqlite(resolve(ROOT, 'data', f), f, true)); return open.get(f)! }
  const svc = createCrossrefsService({
    userDb: null as unknown as DatabaseAdapter,
    textDb: async (id) => (id === 'kjva' ? get('kjva.db') : null),
    lexiconDb: async () => { throw new Error('unused') },
    dataDb: async (id) => (['cross_references', 'tske_refs', 'hermas_taylor'].includes(id) ? get(`${id}.db`) : null),
    events: createServiceEvents(), now: () => 0, uuid: defaultUuid, isDev: true, log: consoleLogger,
  })
  const kjva = get('kjva.db')
  const books = await kjva.all<{ id: string; chapters_count: number }>('SELECT id, chapters_count FROM books ORDER BY rowid')
  // Every book's first, middle and last chapter, both datasets.
  const chapters: unknown[] = []
  for (const b of books) {
    for (const ch of [...new Set([1, Math.ceil(b.chapters_count / 2), b.chapters_count])]) {
      chapters.push({ bookId: b.id, chapter: ch, refs: digest(await svc.getForChapter(b.id, ch)), tske: digest(await svc.getTSKeForChapter(b.id, ch)) })
    }
  }
  const lxxChapters: unknown[] = []
  for (const ch of [1, 8, 9, 10, 22, 113, 114, 115, 116, 146, 147, 150, 151]) {
    lxxChapters.push({ chapter: ch, refs: digest(await svc.getForChapter('PSA', ch, 'lxx')), tske: digest(await svc.getTSKeForChapter('PSA', ch, 'lxx')) })
  }
  const verses: unknown[] = []
  for (const [b, c, v, t] of [['GEN', 1, 1, 'kjva'], ['JHN', 3, 16, 'kjva'], ['jhn', 1, 1, 'kjva'], ['PSA', 23, 1, 'kjva'], ['PSA', 9, 1, 'lxx'], ['PSA', 113, 1, 'lxx'],
    ['PSA', 22, 1, 'lxx'], ['ISA', 53, 5, 'kjva'], ['REV', 22, 21, 'kjva'], ['TOB', 1, 1, 'kjva'], ['XYZ', 1, 1, 'kjva'], ['GEN', 999, 1, 'kjva']] as const) {
    verses.push({ bookId: b, chapter: c, verse: v, textId: t, refs: await svc.getForVerse(b, c, v, t), tske: await svc.getTSKeForVerse(b, c, v, t) })
  }
  const hermas: unknown[] = []
  for (const [b, c] of [['HER_VIS', 1], ['HER_MAN', 4], ['HER_SIM', 9], ['her_sim', 30], ['GEN', 1]] as const) hermas.push({ bookId: b, chapter: c, result: await svc.getHermasTaylorChapter(b, c) })
  const status = await svc.status()
  for (const db of open.values()) await db.close()

  // Chapter map over every chapter of the books it affects (and a control book).
  const chapterMap: unknown[] = []
  for (const book of ['PSA', 'psa', 'JER', 'JOL', 'MAL', 'GEN', 'EZR', 'PRO']) {
    for (let ch = 0; ch <= 152; ch++) {
      chapterMap.push([book, ch,
        mapChapterOnTranslationSwitch(book, ch, 'kjva', 'lxx'), mapChapterOnTranslationSwitch(book, ch, 'LXX', 'kjv'), mapChapterOnTranslationSwitch(book, ch, 'kjva', 'kjv'),
        toCanonicalChapters(book, ch, 'lxx'), toCanonicalChapters(book, ch, 'kjva'),
        equivalentChapters(book, ch, 'lxx', 'kjva'), equivalentChapters(book, ch, 'kjva', 'lxx'), equivalentChapters(book, ch, 'enoch', 'lxx'),
        versificationNote(book, ch, 'lxx'), versificationNote(book, ch, 'kjva')])
    }
  }
  return {
    name: 'crossrefs',
    data: {
      format: 1, generator: 'scripts/golden/crossrefs.ts',
      sources: Object.fromEntries(['src/platform/services/crossrefsService.ts', 'src/lib/translationChapterMap.ts', 'scripts/golden/crossrefs.ts']
        .map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      status, chapters, lxxChapters, verses, hermas, chapterMap,
    },
  }
}
