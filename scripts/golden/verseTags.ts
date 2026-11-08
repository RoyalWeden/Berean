/** Verse tags golden (M7): createVerseTagsService write/read script on a migrated DB (fake clock, ids, Math.random = 0). */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createVerseTagsService, expandRanges, type TagRange } from '../../src/platform/services/verseTagsService'
import { migratedUserDb } from '../../src/platform/db/__tests__/testDb'
import { consoleLogger, createServiceEvents } from '../../src/platform/services/context'

const ROOT = resolve(__dirname, '../..')
export const EXPAND_CASES: TagRange[][] = [
  [{ bookId: 'JHN', chapter: 3, spans: [{ s: 16, e: 17 }, { s: 17, e: 18 }] }],
  [{ bookId: 'GEN', chapter: 1, whole: true }, { bookId: 'GEN', chapter: 1, whole: true }],
  [{ bookId: 'PSA', chapter: 119, spans: [{ s: 0, e: 2 }, { s: 5.7, e: 3 }, { s: 1, e: 9999 }] }],
  [{ bookId: 'EXO', chapter: 20, spans: [] }, { bookId: 'EXO', chapter: 20 }],
]

export async function buildVerseTagsGolden(): Promise<{ name: string; data: unknown }> {
  const expanded = EXPAND_CASES.map((r) => expandRanges(r))
  const db = await migratedUserDb()
  let clock = 70_000, n = 0
  const events: unknown[] = []
  const ev = createServiceEvents()
  ev.on('data:changed', (c) => events.push({ entity: c.entity, id: c.id ?? null, op: c.op }))
  const svc = createVerseTagsService({ userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('unused') }, dataDb: async () => null,
    events: ev, now: () => clock, uuid: () => `t${++n}`, isDev: true, log: consoleLogger })
  const realRandom = Math.random
  Math.random = () => 0
  const steps: unknown[] = []
  try {
    steps.push(await svc.create('Sabbath'))
    clock += 10; steps.push(await svc.create('sabbath'))            // case-insensitive: same tag
    clock += 10; steps.push(await svc.create('Feasts', '#ff0000'))
    clock += 10; steps.push(await svc.addMembers({ tagIds: ['t1'], newTagNames: ['Covenant', 'Feasts'], ranges: [{ bookId: 'EXO', chapter: 20, spans: [{ s: 8, e: 11 }] }], label: 'Exodus 20:8-11' }))
    clock += 10; steps.push(await svc.addMembers({ tagIds: ['t1'], ranges: [{ bookId: 'GEN', chapter: 2, whole: true }], label: 'Genesis 2', kind: 'chapter' }))
    clock += 10; steps.push(await svc.rename('t3', 'Appointed Times'))
    steps.push(await svc.setColor('t1', '#00aa00'))
    steps.push(await svc.setColorSlot('t1', 15))
    steps.push(await svc.reorder(['t3', 't1']))
    steps.push(await svc.getForChapter('EXO', 20), await svc.getForChapter('GEN', 2), await svc.getForChapter('JHN', 3))
    steps.push(await svc.getMembers(['t1', 't3']), await svc.getMembers([]))
    const firstMember = (await db.get<{ id: string }>("SELECT id FROM verse_tag_members WHERE label = 'Exodus 20:8-11' AND tag_id = 't1'"))!.id
    clock += 10; steps.push(await svc.updateMemberRanges(firstMember, [{ bookId: 'EXO', chapter: 20, spans: [{ s: 8, e: 8 }] }], 'Exodus 20:8'))
    steps.push(await svc.updateMemberRanges(firstMember, [{ bookId: 'EXO', chapter: 20, whole: true }], 'Exodus 20', 'chapter'))
    steps.push(await svc.updateMemberRanges('nope', [], 'x'))
    steps.push(await svc.merge('t4', 't1'))
    await db.run("INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES ('n1', 'general', 'x', 'see #Appointed Times', 1, 1)")
    steps.push(await svc.delete('t3'), await svc.delete('t3', true), await svc.delete('missing'))
    steps.push(await svc.removeMember(firstMember))
  } finally { Math.random = realRandom }
  const tables = Object.fromEntries(await Promise.all(['verse_tags', 'verse_tag_members', 'verse_tag_verse', 'tag_edges'].map(async (t) => [t, await db.all(`SELECT * FROM ${t} ORDER BY rowid`)])))
  await db.close()
  return { name: 'verse-tags', data: { format: 1, generator: 'scripts/golden/verseTags.ts',
    sources: Object.fromEntries(['src/platform/services/verseTagsService.ts', 'scripts/golden/verseTags.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
    expandCases: EXPAND_CASES, expanded, steps: JSON.parse(JSON.stringify(steps)), events, tables } }
}
