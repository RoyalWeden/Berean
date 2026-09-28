/**
 * iCloud lifecycle (DATA-UX-*): first sync with honest progress, the four first-sync data cases,
 * turning sync off and on, repeated enabling, and a large first sync — real services, schema and
 * engine over the in-memory iCloud Drive model.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Sim, allCloudOps, userState, type SimDevice } from './harness'
import type { SyncProgress } from '../types'

let sim: Sim
beforeEach(() => { sim = new Sim() })
const deletes = () => allCloudOps(sim.cloud).filter((o) => o.op === 'delete')

describe('first sync', () => {
  it('a new device reports real, monotonic progress: fetching → applying (exact total, per kind) → finalizing → done', async () => {
    const a = await sim.device('a')
    for (let i = 0; i < 40; i++) await a.services.notes.create({ type: 'general', title: `N${i}`, content: `c${i}` })
    for (let i = 0; i < 10; i++) await a.services.highlights.toggle({ bookId: 'PSA', chapter: 23, verseNum: i + 1, color: 'yellow' })
    await a.engine.sync()
    const seen: Array<SyncProgress | null> = []
    const b = await sim.device('b', { onProgress: (p) => seen.push(p && { ...p, byEntity: JSON.parse(JSON.stringify(p.byEntity)) }) })
    await b.engine.sync()
    const acts = seen.filter(Boolean).map((p) => p!.activity)
    expect(acts[0]).toBe('checking')
    expect(acts).toContain('fetching'); expect(acts).toContain('applying'); expect(acts).toContain('finalizing')
    const applying = seen.filter((p) => p?.activity === 'applying') as SyncProgress[]
    expect(applying.every((p) => p.total === 50 && p.firstSync)).toBe(true)
    const dones = applying.map((p) => p.done)
    expect(dones).toEqual([...dones].sort((x, y) => x - y))       // never goes backwards
    expect(dones[dones.length - 1]).toBe(50)
    expect(applying[applying.length - 1].byEntity).toEqual({ note: { done: 40, total: 40 }, highlight: { done: 10, total: 10 } })
    expect(seen[seen.length - 1]).toBeNull()                          // cleared when done
    const st = await b.engine.status()
    expect(st.progress).toBeNull(); expect(st.lastSyncedAt).not.toBeNull()
    // the next pass is no longer a first sync
    const again: Array<SyncProgress | null> = []
    const b2 = await sim.restart(b, { onProgress: (p) => again.push(p) })
    await b2.engine.sync()
    expect(again.filter(Boolean).every((p) => !p!.firstSync)).toBe(true)
  })
  it('nothing to apply: no invented applying stage or percentage', async () => {
    const seen: Array<SyncProgress | null> = []
    const a = await sim.device('a', { onProgress: (p) => seen.push(p) })
    await a.engine.sync()
    expect(seen.filter((p) => p?.activity === 'applying')).toEqual([])
    expect(seen.filter((p) => p && p.activity === 'finalizing' && p.total != null)).toEqual([])
  })
})

describe('first-sync data cases', () => {
  it('A: cloud has data, device is empty → everything arrives, nothing is deleted', async () => {
    const a = await sim.device('a')
    for (let i = 0; i < 5; i++) await a.services.notes.create({ type: 'general', title: `N${i}`, content: 'x' })
    await a.engine.sync()
    const b = await sim.device('b'); await sim.syncAll([a, b])
    expect(await userState(b)).toEqual(await userState(a)); expect(deletes()).toEqual([])
  })
  it('B: device has data, cloud is empty → it is uploaded (adopted), nothing lost', async () => {
    const pre = await sim.device('pre')   // data created before sync on this device
    pre.engine.stop()
    // simulate "sync was off": data written without the engine running
    await pre.db.run(`INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES ('local-1', 'general', 'Offline note', 'x', 1, 1)`)
    const a = await sim.restart(pre)      // turning sync on runs a FULL reconciliation (hosts: enable → reconcile 'full')
    await a.engine.reconcileLocal(true)
    await a.engine.sync()
    const b = await sim.device('b'); await sim.syncAll([a, b])
    expect((await b.services.notes.getOne('local-1'))?.content).toBe('x')
  })
  it('C/D: both have data (different and the same ids) → union, the same id merged, the other text kept', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.notes.create({ type: 'general', title: 'Only A', content: 'a' })
    await b.services.notes.create({ type: 'general', title: 'Only B', content: 'b' })
    for (const [d, c] of [[a, 'from A'], [b, 'from B']] as const) {
      await d.db.run(`INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES ('shared', 'general', 'Same id', ?, 1, 1)`, [c])
      await d.engine.captureRecord('note', 'shared')
    }
    await sim.syncAll([a, b])
    expect(await userState(a)).toEqual(await userState(b))
    const titles = (await a.services.notes.getAll()).map((n) => n.title).sort()
    expect(titles).toEqual(['Only A', 'Only B', 'Same id'])
    const kept = new Set([(await a.services.notes.getOne('shared'))!.content, ...(await a.services.notes.getVersions('shared')).map((v) => v.content)])
    expect(kept).toEqual(new Set(['from A', 'from B']))
  })
  it('E: a database recreated after uninstall restores from iCloud and publishes nothing', async () => {
    const a = await sim.device('a')
    for (let i = 0; i < 5; i++) await a.services.notes.create({ type: 'general', title: `N${i}`, content: 'x' })
    await a.engine.sync()
    const before = allCloudOps(sim.cloud).length
    a.engine.stop()
    const a2 = await sim.device('a'); await a2.engine.sync()
    expect((await a2.services.notes.getAll()).length).toBe(5)
    expect(allCloudOps(sim.cloud).length).toBe(before); expect(deletes()).toEqual([])
  })
})

describe('turning sync off and on', () => {
  it('off: nothing is deleted anywhere; edits made while off are sent when it is turned on again', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'N', content: 'v1' })).note!
    await sim.syncAll([a, b])
    const opsBefore = allCloudOps(sim.cloud).length
    a.engine.stop()                                           // "iCloud Sync off" on A
    await a.services.notes.update(n.id, { content: 'edited while off' })
    const extra = (await a.services.notes.create({ type: 'general', title: 'Made while off', content: 'y' })).note!
    await sim.syncAll([b])
    expect(allCloudOps(sim.cloud).length).toBe(opsBefore)     // nothing left A while off
    expect((await b.services.notes.getOne(n.id))?.content).toBe('v1')
    const a2 = await sim.restart(a)                          // on again (full reconcile at start)
    await a2.engine.reconcileLocal(true)
    await sim.syncAll([a2, b])
    expect((await b.services.notes.getOne(n.id))?.content).toBe('edited while off')
    expect((await b.services.notes.getOne(extra.id))?.content).toBe('y')
    expect(deletes()).toEqual([])
  })
  it('on/off/on repeatedly: one capture per change, no duplicate records or ops', async () => {
    const a = await sim.device('a')
    for (let i = 0; i < 3; i++) { a.engine.stop(); a.engine.start(); a.engine.start() }
    await a.services.notes.create({ type: 'general', title: 'Once', content: 'x' })
    await new Promise((r) => setTimeout(r, 20))   // capture runs asynchronously after the event
    const outbox = await a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox')
    expect(outbox!.n).toBe(1)
    await a.engine.sync()
    let d = a
    for (let i = 0; i < 3; i++) { d = await sim.restart(d); await d.engine.sync() }
    const b = await sim.device('b'); await sim.syncAll([d, b])
    expect((await b.services.notes.getAll()).length).toBe(1)
  })
})

describe('scale', () => {
  it('a first sync of 3,000 records completes with exact progress totals', async () => {
    const a = await sim.device('a')
    await a.db.transaction(async (tx) => {
      for (let i = 0; i < 3000; i++) await tx.run(`INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES (?, 'general', ?, 'x', 1, 1)`, [`bulk-${i}`, `N${i}`])
    })
    await a.engine.reconcileLocal(true); await a.engine.sync()
    let last: SyncProgress | null = null
    const t0 = Date.now()
    const b = await sim.device('b', { onProgress: (p) => { if (p?.activity === 'applying') last = p } })
    await b.engine.sync()
    expect(last!.total).toBe(3000); expect(last!.done).toBe(3000)
    expect((await b.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notes'))!.n).toBe(3000)
    expect(Date.now() - t0).toBeLessThan(60_000)
  }, 120_000)
})

describe('UI reconciliation signal', () => {
  it('every pass that applied something tells the UI which kinds changed (the invalidation map covers them all)', async () => {
    const { INVALIDATES } = await import('@/lib/syncInvalidation')
    const a = await sim.device('a')
    const touched: string[][] = []
    const b: SimDevice = await sim.device('b', { onApplied: (s) => touched.push([...s].sort()) })
    await a.services.notes.create({ type: 'general', title: 'N', content: 'x' })
    await a.services.notes.folderCreate('F')
    await a.services.highlights.toggle({ bookId: 'JHN', chapter: 1, verseNum: 1, color: 'blue' })
    await a.services.workspaces.save('W', '{}', '{}')
    await sim.syncAll([a, b])
    const kinds = new Set(touched.flat())
    for (const k of ['note', 'note_folder', 'highlight', 'workspace']) expect(kinds.has(k)).toBe(true)
    for (const k of kinds) expect(INVALIDATES[k], `${k} has no UI invalidation`).toBeDefined()
  })
})

describe('TestFlight update (build N → N+1)', () => {
  it('changes still waiting to upload survive the database migration and sync afterwards, once', async () => {
    const { BEREAN_MIGRATIONS, runMigrations } = await import('../../db/bereanMigrations')
    const { memoryDb } = await import('../../db/__tests__/testDb')
    // Build N: a database one schema version behind, with a synced note and an unsent edit.
    const db = memoryDb('buildN')
    const origLog = console.log; console.log = () => {}
    await runMigrations(db, BEREAN_MIGRATIONS.slice(0, -1))
    console.log = origLog
    const a = await sim.device('a', { db })
    const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'Study', content: 'v1' })).note!
    await sim.syncAll([a, b])
    a.store.setOnline(false)
    await a.services.notes.update(n.id, { content: 'edited offline before the update' })
    await a.engine.sync()                                  // queued locally, not uploaded
    a.engine.stop()
    // Build N+1: the same database migrates on launch.
    console.log = () => {}
    const applied = await runMigrations(db)
    console.log = origLog
    expect(applied).toEqual([BEREAN_MIGRATIONS[BEREAN_MIGRATIONS.length - 1].version])
    const a2 = await sim.restart(a)
    a2.store.setOnline(true)
    await sim.syncAll([a2, b])
    expect((await b.services.notes.getOne(n.id))?.content).toBe('edited offline before the update')
    expect((await b.services.notes.getAll()).length).toBe(1)
    expect(allCloudOps(sim.cloud).filter((o) => o.op === 'delete')).toEqual([])
  })
})
