/** Saved-workspaces golden: createWorkspacesService script on a migrated DB (fake clock + ids). */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createWorkspacesService } from '../../src/platform/services/workspacesService'
import { migratedUserDb } from '../../src/platform/db/__tests__/testDb'
import { consoleLogger, createServiceEvents } from '../../src/platform/services/context'
import { buildWorkspaceState, parseWorkspaceState } from '../../src/lib/workspaceSnapshot'

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
  // Snapshot format (state_json v2): build from store-shaped inputs, parse every stored shape.
  const tab = (id: string, spaceId: string, extra: Record<string, unknown> = {}) => ({ id, spaceId, type: spaceId === 'notes' ? 'note' : spaceId === 'lexicon' ? 'lexicon' : 'bible', title: id.toUpperCase(), state: { book: 'John', chapter: 3 }, ...extra })
  const buildInputs: unknown[] = [
    { tabs: { scripture: [tab('a', 'scripture'), tab('b', 'scripture', { isPinned: true })], notes: [tab('n', 'notes')] }, activeTabId: { scripture: 'b' }, displayOrder: ['n', 'zz', 'a'], icon: 'book' },
    { tabs: { scripture: [tab('a', 'scripture'), { id: 'bad', spaceId: 'scripture', type: 'video', title: 'x', state: {} }, { id: 1 }, null, tab('c', 'scripture', { state: [] })] }, activeTabId: { scripture: null, extra: 'q' } },
    { tabs: {}, activeTabId: {}, icon: '' },
  ]
  const built = buildInputs.map((i) => JSON.stringify(buildWorkspaceState(i as Parameters<typeof buildWorkspaceState>[0])))
  const v2 = built[0]
  const parseInputs: (string | null)[] = [null, '', 'garbage', '5', 'null', '[]', '{}', '{"tabs":[]}', v2, built[1],
    JSON.stringify({ tabs: { scripture: [tab('a', 'notes'), tab('b', 'scripture')], lexicon: 'nope' }, activeTabId: { scripture: 'zz', notes: '' }, displayOrder: ['b', 3, 'b', 'q'], icon: 7 }),
    JSON.stringify({ v: 2, tabs: { notes: [tab('n1', 'notes'), tab('n2', 'notes')] }, activeTabId: { notes: 'n2' }, displayOrder: 'x', icon: 'star' }),
    JSON.stringify({ v: 1, tabs: { scripture: [tab('a', 'scripture', { title: 5 }), tab('b', 'scripture', { state: null }), tab('c', 'scripture', { state: 'x' })] } })]
  const parsed = parseInputs.map((s) => ({ input: s, output: JSON.stringify(parseWorkspaceState(s)) }))
  return { name: 'workspaces', data: { format: 1, generator: 'scripts/golden/workspaces.ts',
    sources: Object.fromEntries(['src/platform/services/workspacesService.ts', 'src/lib/workspaceSnapshot.ts', 'scripts/golden/workspaces.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
    saved, list1, loaded, list2, rows, events, snapshot: { buildInputs, built, parsed } } }
}
