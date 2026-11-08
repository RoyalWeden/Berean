/** Saved-workspaces golden: createWorkspacesService script on a migrated DB (fake clock + ids). */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createWorkspacesService } from '../../src/platform/services/workspacesService'
import { migratedUserDb } from '../../src/platform/db/__tests__/testDb'
import { consoleLogger, createServiceEvents } from '../../src/platform/services/context'

const ROOT = resolve(__dirname, '../..')
export async function buildWorkspacesGolden(): Promise<{ name: string; data: unknown }> {
  const db = await migratedUserDb()
  let clock = 90_000, n = 0
  const events: unknown[] = []
  const ev = createServiceEvents()
  ev.on('data:changed', (c) => events.push({ entity: c.entity, id: c.id, op: c.op }))
  const svc = createWorkspacesService({ userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('unused') }, dataDb: async () => null,
    events: ev, now: () => clock, uuid: () => `ws${++n}`, isDev: true, log: consoleLogger })
  const saved = [await svc.save('Study', '{"direction":"row"}', '{"tabs":[]}')]
  clock += 10; saved.push(await svc.save('Compare', '"bible"', '{}'))
  clock += 10; await svc.rename('ws1', 'Study Mode')
  const list1 = await svc.list()
  const loaded = [await svc.load('ws1'), await svc.load('nope')]
  await svc.delete('ws2')
  const list2 = await svc.list()
  const rows = await db.all('SELECT * FROM workspaces ORDER BY id')
  await db.close()
  return { name: 'workspaces', data: { format: 1, generator: 'scripts/golden/workspaces.ts',
    sources: Object.fromEntries(['src/platform/services/workspacesService.ts', 'scripts/golden/workspaces.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
    saved, list1, loaded, list2, rows, events } }
}
