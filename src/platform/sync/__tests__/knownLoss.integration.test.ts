/**
 * Data-loss defects found by the native migration audit (docs/native-migration-audit/05, D1–D3),
 * each reproduced here through the real services, schema and engine.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Sim } from './harness'

let sim: Sim
beforeEach(() => { sim = new Sim() })

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('an edit made while a push is writing (D1)', () => {
  it('reaches other devices instead of being deleted unpublished', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'N', content: 'v1' })).note!
    await sim.syncAll([a, b])
    await a.services.notes.update(n.id, { content: 'v2' })
    await settle()
    const write = a.store.writeOwnFile.bind(a.store)
    let typed = false
    a.store.writeOwnFile = async (...args: Parameters<typeof write>) => {
      await write(...args)
      if (typed) return
      typed = true
      sim.tick()
      await a.services.notes.update(n.id, { content: 'v3 typed during the push' })
      await settle()
    }
    await a.engine.sync()
    a.store.writeOwnFile = write
    await sim.syncAll([a, b])
    expect((await b.services.notes.getOne(n.id))!.content).toBe('v3 typed during the push')
    expect(await a.db.get('SELECT COUNT(*) AS n FROM sync_outbox')).toEqual({ n: 0 })
  })
})

describe('bootstrapping a new device from a snapshot (D2)', () => {
  it('keeps records whose parents come later in the snapshot', async () => {
    const a = await sim.device('a')
    await a.services.verseTags.create('Mercy')
    const [t1, t2] = await a.services.verseTags.create('Grace')
    await a.services.tagGraph.createEdge(t1.id, t2.id)
    await settle()
    await sim.syncAll([a])
    expect(await a.engine.compact(true)).toBe(true)
    const m = (await a.store.readManifest(a.engine.deviceId))!
    for (const f of m.files) await a.store.deleteOwnFile(f.name)
    await a.store.writeOwnManifest({ ...m, files: [] })
    const fresh = await sim.device('n')
    await sim.syncAll([fresh])
    expect(await fresh.db.get('SELECT COUNT(*) AS n FROM tag_edges')).toEqual({ n: 1 })
  })
})

describe('an op that failed to apply (D3)', () => {
  it('stays unacknowledged, so its author cannot prune the only copy', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.notes.create({ type: 'general', title: 'N', content: 'x' })
    await sim.syncAll([a, b])
    const folder = sim.cloud.folders.get(a.engine.deviceId)!
    const m = sim.cloud.manifests.get(a.engine.deviceId)!
    const bad = m.seq + 1, good = m.seq + 2
    const line = (seq: number, entity: string, op: string) => JSON.stringify({ id: `x${seq}`, seq, hlc: `${sim.clock + 5000 + seq}-0000-${a.engine.deviceId}`, device: a.engine.deviceId, entity, key: 'k', op, fields: {}, schema: 1 })
    const name = `journal-${String(bad).padStart(9, '0')}-${String(good).padStart(9, '0')}.jsonl`
    folder.set(name, `${line(bad, 'future_thing', 'upsert')}\n${line(good, 'note', 'delete')}\n`)
    sim.cloud.manifests.set(a.engine.deviceId, { ...m, seq: good, files: [...m.files, { name, seqFrom: bad, seqTo: good }] })
    await b.engine.sync()
    expect(await b.db.get('SELECT error FROM sync_failed WHERE seq = ?', [bad])).toEqual({ error: 'unknown entity future_thing' })
    const manifest = (await b.store.readManifest(b.engine.deviceId))!
    expect(manifest.applied[a.engine.deviceId]).toBe(bad - 1)
  })
})
