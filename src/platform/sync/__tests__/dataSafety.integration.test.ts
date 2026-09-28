/**
 * Data-safety scenarios (DATA-SAFE-*, docs/mobile/sync.md "Data safety"). Each test is one
 * data-loss vector from the threat model, driven through the real services, schema and engine.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Sim, allCloudOps, userState, type SimDevice } from './harness'
import { MemoryCloud } from '../stores/memorySyncStore'

let sim: Sim
beforeEach(() => { sim = new Sim() })

const note = async (d: SimDevice, id: string) => d.services.notes.getOne(id)
const offline = (...ds: SimDevice[]) => ds.forEach((d) => d.store.setOnline(false))
const online = (...ds: SimDevice[]) => ds.forEach((d) => d.store.setOnline(true))
const conflictRows = (d: SimDevice) => d.db.all<{ entity: string; field: string | null; kind: string; lost_value: string | null }>('SELECT entity, field, kind, lost_value FROM sync_conflicts ORDER BY id')

describe('the reported overwrite: different fields changed on two devices at once', () => {
  it('a pin on one device and a text edit on the other both survive — no conflict copy', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'Study', content: 'v1' })).note!
    await sim.syncAll([a, b])
    offline(a, b)
    sim.tick(); await b.services.notes.update(n.id, { content: 'v2 — edited on B' })
    sim.tick(); await a.services.notes.setPinned(n.id, true)          // later: whole-record LWW made A's stale text win
    online(a, b); await sim.syncAll([a, b])
    for (const d of [a, b]) {
      const x = (await note(d, n.id))!
      expect(x.content).toBe('v2 — edited on B')
      expect(!!x.pinned).toBe(true)
    }
    expect(await a.services.notes.getVersions(n.id)).toEqual([])
    expect(await userState(a)).toEqual(await userState(b))
  })
  it('folder renamed on one device and moved on another keeps both', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const parent = await a.services.notes.folderCreate('Parent')
    const f = await a.services.notes.folderCreate('Sermons')
    await sim.syncAll([a, b])
    offline(a, b)
    sim.tick(); await a.services.notes.folderRename(f.id, 'Teachings')
    sim.tick(); await b.services.notes.folderSetParent(f.id, parent.id)
    online(a, b); await sim.syncAll([a, b])
    for (const d of [a, b]) {
      const row = await d.db.get<{ name: string; parent_id: string }>('SELECT name, parent_id FROM note_folders WHERE id = ?', [f.id])
      expect(row).toEqual({ name: 'Teachings', parent_id: parent.id })
    }
  })
  it('the same field changed on both: one value wins everywhere and the other is kept', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const f = await a.services.notes.folderCreate('Sermons')
    await sim.syncAll([a, b])
    offline(a, b)
    sim.tick(); await a.services.notes.folderRename(f.id, 'From A')
    sim.tick(); await b.services.notes.folderRename(f.id, 'From B')
    online(a, b); await sim.syncAll([a, b])
    expect(await userState(a)).toEqual(await userState(b))
    for (const d of [a, b]) {
      const rows = await conflictRows(d)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ entity: 'note_folder', field: 'name', kind: 'field', lost_value: JSON.stringify('From A') })
    }
  })
})

describe('three and four devices, any arrival order', () => {
  it('A → B → C edits arriving at D out of order produce no spurious conflicts', async () => {
    const [a, b, c, d] = [await sim.device('a'), await sim.device('b'), await sim.device('c'), await sim.device('d')]
    const n = (await a.services.notes.create({ type: 'general', title: 'Chain', content: 'a1' })).note!
    await sim.syncAll([a, b, c, d])
    offline(d)
    sim.tick(); await b.services.notes.update(n.id, { content: 'b2' }); await sim.syncAll([a, b, c])
    sim.tick(); await c.services.notes.update(n.id, { content: 'c3' }); await sim.syncAll([a, b, c])
    // D sees C's file before B's (B's is still downloading)
    for (const [name] of sim.cloud.folders.get(b.engine.deviceId)!) if (name.startsWith('journal-')) sim.cloud.evict(b.engine.deviceId, name)
    online(d); await d.engine.sync()
    for (const [name] of sim.cloud.folders.get(b.engine.deviceId)!) sim.cloud.evict(b.engine.deviceId, name, false)
    await sim.syncAll([a, b, c, d])
    for (const x of [a, b, c, d]) expect((await note(x, n.id))!.content).toBe('c3')
    expect(await d.services.notes.getVersions(n.id)).toEqual([])
  })
  it('three offline edits of one note: one wins everywhere, the other two are conflict copies on every device', async () => {
    const ds = [await sim.device('a'), await sim.device('b'), await sim.device('c')]
    const n = (await ds[0].services.notes.create({ type: 'general', title: 'T', content: 'base' })).note!
    await sim.syncAll(ds)
    offline(...ds)
    for (const [i, d] of ds.entries()) { sim.tick(); await d.services.notes.update(n.id, { content: `edit ${i}` }) }
    for (const order of [[2, 0, 1]]) for (const i of order) { online(ds[i]); await ds[i].engine.sync() }
    await sim.syncAll(ds)
    const states = await Promise.all(ds.map(userState))
    expect(states[1]).toEqual(states[0]); expect(states[2]).toEqual(states[0])
    const kept = new Set([(await note(ds[0], n.id))!.content, ...(states[0].conflictCopies as Array<{ content: string }>).map((c) => c.content)])
    expect(kept).toEqual(new Set(['edit 0', 'edit 1', 'edit 2']))
  })
})

describe('deletes', () => {
  it('a stale device cannot resurrect a deleted highlight by recolouring it; the recolour is kept as a conflict', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.highlights.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'yellow' })
    await sim.syncAll([a, b])
    offline(a, b)
    sim.tick(); await a.services.highlights.remove('JHN', 3, 16)
    sim.tick(); await b.services.highlights.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'green' })
    online(b); await b.engine.sync(); online(a); await sim.syncAll([a, b])
    for (const d of [a, b]) {
      expect(await d.db.all('SELECT id FROM highlights')).toEqual([])
      expect((await conflictRows(d)).some((r) => r.kind === 'edit-deleted')).toBe(true)
    }
  })
  it('a note purged on one device while edited on another ends in the Trash with the edit (both orders, 3 devices)', async () => {
    for (const order of [[0, 1, 2], [1, 0, 2], [2, 1, 0]]) {
      sim = new Sim()
      const ds = [await sim.device('a'), await sim.device('b'), await sim.device('c')]
      const n = (await ds[0].services.notes.create({ type: 'general', title: 'T', content: 'base' })).note!
      await sim.syncAll(ds)
      offline(...ds)
      sim.tick(); await ds[0].services.notes.delete(n.id); await ds[0].services.notes.purgeTrashItem(n.id)
      sim.tick(); await ds[1].services.notes.update(n.id, { content: 'kept work' })
      for (const i of order) { online(ds[i]); await ds[i].engine.sync() }
      await sim.syncAll(ds)
      for (const d of ds) {
        const x = await note(d, n.id)
        expect(x?.content).toBe('kept work')
        expect(x?.deletedAt).toBeTruthy()
      }
    }
  })
  it('today\'s daily note made anew by a device that never saw its purge is kept — in the Trash, with its text, on every device', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.db.run(`INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES ('daily-2026-09-28', 'daily', 'Daily — 2026-09-28', 'old', ?, ?)`, [sim.clock, sim.clock])
    a.engine; await a.engine.captureRecord('note', 'daily-2026-09-28')
    await sim.syncAll([a, b])
    offline(a)
    sim.tick(); await b.services.notes.delete('daily-2026-09-28'); await b.services.notes.purgeTrashItem('daily-2026-09-28')
    await sim.syncAll([b])
    // A new install (C) creates today's daily note before hearing of the purge
    const c = await sim.device('c'); offline(c)
    sim.tick(); await c.db.run(`INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES ('daily-2026-09-28', 'daily', 'Daily — 2026-09-28', 'fresh morning notes', ?, ?)`, [sim.clock, sim.clock])
    await c.engine.captureRecord('note', 'daily-2026-09-28')
    online(a, c); await sim.syncAll([a, b, c])
    for (const d of [a, b, c]) {
      const x = await note(d, 'daily-2026-09-28')
      expect(x?.content).toBe('fresh morning notes')
      expect(x?.deletedAt).toBeTruthy()
    }
    expect(await userState(a)).toEqual(await userState(c))
  })
})

describe('reinstall — an empty database is a new device, never "delete everything"', () => {
  it('uninstalling and reinstalling A deletes nothing in iCloud and brings everything back', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const notes = []
    for (let i = 0; i < 8; i++) { sim.tick(); notes.push((await a.services.notes.create({ type: 'general', title: `N${i}`, content: `c${i}` })).note!) }
    const f = await a.services.notes.folderCreate('Torah'); const f2 = await a.services.notes.folderCreate('Feasts', f.id)
    await a.services.notes.setFolder(notes[0].id, f2.id)
    await a.services.highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'blue' })
    await a.services.verseTags.addMembers({ newTagNames: ['Covenant'], ranges: [{ bookId: 'GEN', chapter: 9, spans: [{ s: 8, e: 17 }] }], label: 'Gen 9:8-17' })
    await sim.syncAll([a, b])
    const before = await userState(b)
    const opsBefore = allCloudOps(sim.cloud).length
    // uninstall A: its database is gone; iCloud keeps its folder. Reinstall = a fresh database.
    a.engine.stop()
    const a2 = await sim.device('a')
    expect(a2.engine.deviceId).not.toBe(a.engine.deviceId)
    await sim.syncAll([a2, b])
    expect(await userState(b)).toEqual(before)
    expect(await userState(a2)).toEqual(before)
    const ops = allCloudOps(sim.cloud)
    expect(ops.filter((o) => o.op === 'delete')).toEqual([])
    expect(ops.length).toBe(opsBefore)             // the reinstall published nothing at all
    expect(sim.cloud.folders.has(a.engine.deviceId)).toBe(true)
  })
  it('reinstalling while B is offline cannot remove anything B has not received yet', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'Only in iCloud', content: 'x' })).note!
    await a.engine.sync()
    offline(b)
    a.engine.stop()
    const a2 = await sim.device('a'); await sim.syncAll([a2])
    online(b); await sim.syncAll([a2, b])
    expect((await note(b, n.id))?.content).toBe('x')
    expect(allCloudOps(sim.cloud).filter((o) => o.op === 'delete')).toEqual([])
  })
})

describe('missing local rows are never turned into cloud deletions', () => {
  it('a damaged / emptied notes table is quarantined, not deleted — and restored from iCloud', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    for (let i = 0; i < 30; i++) await a.services.notes.create({ type: 'general', title: `N${i}`, content: `c${i}` })
    await sim.syncAll([a, b])
    await a.db.run('DELETE FROM notes')                 // what a bad restore / partial load looks like
    const a2 = await sim.restart(a)                     // startup reconciliation runs
    await sim.syncAll([a2, b])
    expect(allCloudOps(sim.cloud).filter((o) => o.op === 'delete')).toEqual([])
    expect((await b.services.notes.getAll()).length).toBe(30)
    expect(a2.engine.getHold()).toMatchObject({ kind: 'quarantine', entities: { note: 30 } })
    expect((await a2.engine.status()).state).toBe('held')
    await a2.engine.resolveQuarantine('restore')
    await sim.syncAll([a2, b])
    expect((await a2.services.notes.getAll()).length).toBe(30)
    expect(a2.engine.getHold()).toBeNull()
    expect(await userState(a2)).toEqual(await userState(b))
  })
  it('a few rows lost in a kill between write and capture are still recognised as the user\'s deletes', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const ns = []
    for (let i = 0; i < 10; i++) ns.push((await a.services.notes.create({ type: 'general', title: `N${i}`, content: 'x' })).note!)
    await sim.syncAll([a, b])
    a.engine.stop()                                          // the capture of the next delete never ran
    await a.db.run('DELETE FROM notes WHERE id = ?', [ns[0].id])
    const a2 = await sim.restart(a)
    await sim.syncAll([a2, b])
    expect(await note(b, ns[0].id)).toBeFalsy()
    expect(a2.engine.getHold()).toBeNull()
  })
  it('the user confirming the deletion sends it', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    for (let i = 0; i < 25; i++) await a.services.highlights.toggle({ bookId: 'PSA', chapter: 119, verseNum: i + 1, color: 'yellow' })
    await sim.syncAll([a, b])
    await a.db.run('DELETE FROM highlights')
    const a2 = await sim.restart(a)
    await a2.engine.resolveQuarantine('delete')
    await sim.syncAll([a2, b])
    expect(await b.db.all('SELECT id FROM highlights')).toEqual([])
  })
  it('a database that failed its integrity check holds sync entirely', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.notes.create({ type: 'general', title: 'N', content: 'x' })
    await sim.syncAll([a, b])
    await a.db.run('DELETE FROM notes')
    const a2 = await sim.restart(a, { databaseProblem: 'malformed page' })
    await sim.syncAll([a2, b])
    expect((await b.services.notes.getAll()).length).toBe(1)
    expect((await a2.engine.status()).state).toBe('held')
    expect(await a2.engine.push()).toBe(0)
  })
})

describe('restored backup / copied database (same device id, older history)', () => {
  it('is detected, forks to a new device id, and recovers the edits made after the backup from iCloud', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'Journal', content: 'before backup' })).note!
    await sim.syncAll([a, b])
    const backup = await sim.backup(a)
    sim.tick(); await a.services.notes.update(n.id, { content: 'after backup' })
    const later = (await a.services.notes.create({ type: 'general', title: 'Later', content: 'made after the backup' })).note!
    await sim.syncAll([a, b])
    a.engine.stop()
    // the phone is restored from the backup
    const restored = await sim.device('a', { db: backup })
    expect(restored.engine.deviceId).not.toBe(a.engine.deviceId)
    sim.tick(); await restored.services.notes.create({ type: 'general', title: 'New on restored', content: 'y' })
    await sim.syncAll([restored, b])
    expect((await note(restored, n.id))!.content).toBe('after backup')
    expect((await note(restored, later.id))!.content).toBe('made after the backup')
    expect((await b.services.notes.getAll()).map((x) => x.title).sort()).toEqual(['Journal', 'Later', 'New on restored'])
    expect((await restored.engine.status()).forks).toBe(1)
  })
  it('a copy running at the same time as the original is caught at its next push', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.notes.create({ type: 'general', title: 'N', content: 'x' })
    await sim.syncAll([a, b])
    const copy = await sim.device('acopy', { db: await sim.backup(a) })
    // (resolveDeviceId saw nothing ahead yet: same id) — the original pushes first
    sim.tick(); await a.services.notes.create({ type: 'general', title: 'From original', content: 'o' })
    await a.engine.sync()
    sim.tick(); await copy.services.notes.create({ type: 'general', title: 'From copy', content: 'c' })
    await copy.engine.sync()
    expect(copy.engine.forkDetected).toBe(true)
    const copy2 = await sim.restart(copy)
    expect(copy2.engine.deviceId).not.toBe(a.engine.deviceId)
    await sim.syncAll([a, copy2, b])
    expect((await b.services.notes.getAll()).map((x) => x.title).sort()).toEqual(['From copy', 'From original', 'N'])
  })
})

describe('iCloud account changes', () => {
  it('another account: nothing crosses in either direction until the user decides; switching back resumes', async () => {
    const a = await sim.device('a', { accountIdentity: 'acct-1' }); const b = await sim.device('b', { accountIdentity: 'acct-1' })
    await a.services.notes.create({ type: 'general', title: 'Account 1 note', content: 'x' })
    await sim.syncAll([a, b])
    const other = new MemoryCloud()
    const stranger = await sim.device('s', { cloud: other, accountIdentity: 'acct-2' })
    await stranger.services.notes.create({ type: 'general', title: 'Account 2 note', content: 'y' })
    await stranger.engine.sync()
    const a2 = await sim.restart(a, { cloud: other, accountIdentity: 'acct-2' })
    sim.tick(); await a2.services.notes.create({ type: 'general', title: 'Written while on account 2', content: 'z' })
    await sim.syncAll([a2, stranger])
    expect((await stranger.services.notes.getAll()).map((x) => x.title)).toEqual(['Account 2 note'])
    expect((await a2.services.notes.getAll()).map((x) => x.title).sort()).toEqual(['Account 1 note', 'Written while on account 2'])
    expect(a2.engine.getHold()?.kind).toBe('account')
    // back to account 1: resumes, and the note written meanwhile reaches account 1's devices
    const a3 = await sim.restart(a2, { cloud: sim.cloud, accountIdentity: 'acct-1' })
    await sim.syncAll([a3, b])
    expect(a3.engine.getHold()).toBeNull()
    expect((await b.services.notes.getAll()).map((x) => x.title).sort()).toEqual(['Account 1 note', 'Written while on account 2'])
    expect(allCloudOps(sim.cloud).filter((o) => o.op === 'delete')).toEqual([])
  })
  it('a container without this device\'s history (no account identity, e.g. the Mac) holds instead of mixing', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.notes.create({ type: 'general', title: 'Mine', content: 'x' })
    await sim.syncAll([a, b])
    const other = new MemoryCloud()
    const s = await sim.device('s', { cloud: other }); await s.services.notes.create({ type: 'general', title: 'Theirs', content: 'y' }); await s.engine.sync()
    const a2 = await sim.restart(a, { cloud: other })
    await sim.syncAll([a2, s])
    expect(a2.engine.getHold()?.kind).toBe('container')
    expect((await s.services.notes.getAll()).map((x) => x.title)).toEqual(['Theirs'])
    expect((await a2.services.notes.getAll()).map((x) => x.title)).toEqual(['Mine'])
    // explicit choice: use this iCloud
    await a2.engine.resolveHold('republish')
    const a3 = await sim.restart(a2)
    await sim.syncAll([a3, s])
    expect((await s.services.notes.getAll()).map((x) => x.title).sort()).toEqual(['Mine', 'Theirs'])
  })
})

describe('partial failures and crashes', () => {
  it('a push that fails half-way is retried without loss or duplication', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    for (let i = 0; i < 700; i++) await a.db.run(`INSERT INTO highlights (id, text_id, book_id, chapter, verse_num, color, created_at) VALUES (?, 'kjva', 'PSA', 119, ?, 'yellow', ?)`, [`h${i}`, i + 1, sim.clock]).catch(() => {})
    await a.engine.reconcileLocal(true)
    a.store.failWrites = 2                              // the 2nd journal file and the manifest fail
    await a.engine.push()
    expect((await a.engine.status()).pendingOutbox).toBeGreaterThan(0)
    await sim.syncAll([a, b])
    expect((await b.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM highlights'))!.n).toBe((await a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM highlights'))!.n)
  })
  it('a kill after the outbox commit but before the manifest write is repaired on the next pass', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.engine.sync()
    const n = (await a.services.notes.create({ type: 'general', title: 'Late', content: 'x' })).note!
    const orig = a.store.writeOwnManifest.bind(a.store)
    a.store.writeOwnManifest = async () => { throw new Error('killed') }
    await a.engine.push()
    a.store.writeOwnManifest = orig
    await sim.syncAll([b])
    expect(await note(b, n.id)).toBeFalsy()             // not visible yet
    const a2 = await sim.restart(a)
    await sim.syncAll([a2, b])
    expect((await note(b, n.id))?.content).toBe('x')
  })
  it('replaying every journal again (lost bookkeeping) changes nothing and adds no conflicts', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const n = (await a.services.notes.create({ type: 'general', title: 'T', content: 'one' })).note!
    await sim.syncAll([a, b])
    sim.tick(); await b.services.notes.update(n.id, { content: 'two' })
    sim.tick(); await a.services.notes.setPinned(n.id, true)
    await sim.syncAll([a, b])
    const before = await userState(b)
    await b.db.run('DELETE FROM sync_applied')
    await sim.syncAll([a, b])
    expect(await userState(b)).toEqual(before)
    expect(await conflictRows(b)).toEqual([])
  })
  it('an op this build cannot understand is parked, not dropped, and retried after an update', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.notes.create({ type: 'general', title: 'N', content: 'x' })
    await sim.syncAll([a, b])
    // a newer build's entity lands in A's journal
    const folder = sim.cloud.folders.get(a.engine.deviceId)!
    const m = sim.cloud.manifests.get(a.engine.deviceId)!
    const seq = m.seq + 1
    const name = `journal-${String(seq).padStart(9, '0')}-${String(seq).padStart(9, '0')}.jsonl`
    folder.set(name, JSON.stringify({ id: 'x', seq, hlc: `${sim.clock + 5000}-0000-${a.engine.deviceId}`, device: a.engine.deviceId, entity: 'future_thing', key: 'k', op: 'upsert', fields: { v: 1 }, schema: m.schema }) + '\n')
    sim.cloud.manifests.set(a.engine.deviceId, { ...m, seq, files: [...m.files, { name, seqFrom: seq, seqTo: seq }] })
    await b.engine.sync()
    expect(await b.db.get('SELECT error FROM sync_failed WHERE seq = ?', [seq])).toEqual({ error: 'unknown entity future_thing' })
    const b2 = await sim.restart(b, { appVersion: '2.0' })
    expect(await b2.db.get('SELECT attempts FROM sync_failed WHERE seq = ?', [seq])).toEqual({ attempts: 0 })
  })
})

describe('creation', () => {
  it('create/create on several offline devices at the same instant: every note survives with its own id', async () => {
    const ds = [await sim.device('a'), await sim.device('b'), await sim.device('c')]
    offline(...ds)
    for (const d of ds) for (let i = 0; i < 5; i++) await d.services.notes.create({ type: 'general', title: 'Same title', content: 'Same content' })
    online(...ds); await sim.syncAll(ds)
    for (const d of ds) expect((await d.services.notes.getAll()).length).toBe(15)
    expect(new Set((await ds[0].services.notes.getAll()).map((n) => n.id)).size).toBe(15)
  })
})

describe('tabs, workspaces, verse tags', () => {
  const tab = (id: string, order: string, chapter: number, title = `Gen ${chapter}`) => ({ id, session_id: 's1', space_id: 'scripture', type: 'bible', title, is_pinned: 0, order_key: order, display_order_key: order, origin_tab_id: null, origin_space_id: null, sync_state_json: JSON.stringify({ bookId: 'GEN', chapter }) })
  const session = { id: 's1', name: 'Session 1', icon: null, tab_filter: null, order_key: 'a0' }
  it('the same tab changed on three devices converges; a tab added on each survives', async () => {
    const ds = [await sim.device('a'), await sim.device('b'), await sim.device('c')]
    await ds[0].services.sessions.applySnapshot({ sessions: [session], tabs: [tab('t1', 'a0', 1)], archivedGroups: [] })
    await sim.syncAll(ds)
    offline(...ds)
    for (const [i, d] of ds.entries()) {
      sim.tick()
      await d.services.sessions.applySnapshot({ sessions: [session], tabs: [tab('t1', 'a0', 10 + i), tab(`n${i}`, `b${i}`, 20 + i)], archivedGroups: [] })
    }
    for (const i of [1, 2, 0]) { online(ds[i]); await ds[i].engine.sync() }
    await sim.syncAll(ds)
    const lists = await Promise.all(ds.map((d) => d.services.sessions.listTabs('s1')))
    for (const l of lists) expect(l.map((t) => t.id).sort()).toEqual(['n0', 'n1', 'n2', 't1'])
    expect(lists[1]).toEqual(lists[0]); expect(lists[2]).toEqual(lists[0])
  })
  it('workspace renamed on one device while its content changes on another keeps both', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    const w = await a.services.workspaces.save('Study', '{}', JSON.stringify({ tabs: [1] }))
    await sim.syncAll([a, b])
    offline(a, b)
    sim.tick(); await a.services.workspaces.rename(w.id, 'Deep study')
    sim.tick(); await b.db.run('UPDATE workspaces SET state_json = ? WHERE id = ?', [JSON.stringify({ tabs: [1, 2] }), w.id]); await b.engine.captureRecord('workspace', w.id)
    online(a, b); await sim.syncAll([a, b])
    for (const d of [a, b]) expect(await d.db.get('SELECT name, state_json FROM workspaces WHERE id = ?', [w.id])).toEqual({ name: 'Deep study', state_json: JSON.stringify({ tabs: [1, 2] }) })
  })
  it('a tag renamed on one device while verses are tagged with it on another keeps the name and the verses', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    await a.services.verseTags.addMembers({ newTagNames: ['Covenant'], ranges: [{ bookId: 'GEN', chapter: 9, spans: [{ s: 8, e: 17 }] }], label: 'Gen 9:8-17' })
    await sim.syncAll([a, b])
    const tagId = (await a.services.verseTags.list())[0].id
    offline(a, b)
    sim.tick(); await a.services.verseTags.rename(tagId, 'Covenants')
    sim.tick(); await b.services.verseTags.addMembers({ tagIds: [tagId], ranges: [{ bookId: 'EXO', chapter: 19, spans: [{ s: 5, e: 6 }] }], label: 'Exo 19:5-6' })
    online(a, b); await sim.syncAll([a, b])
    for (const d of [a, b]) {
      expect((await d.services.verseTags.list()).map((t) => t.name)).toEqual(['Covenants'])
      expect((await d.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM verse_tag_members WHERE tag_id = ?', [tagId]))!.n).toBe(2)
    }
  })
})

describe('change tracking without notifications', () => {
  it('a device that never gets a notification still converges on the next pass (notifications only accelerate)', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    b.store.watch = undefined as never
    const n = (await a.services.notes.create({ type: 'general', title: 'Quiet', content: 'x' })).note!
    await a.engine.sync()
    await b.engine.sync()   // e.g. the 60 s interval / foreground
    expect((await note(b, n.id))?.content).toBe('x')
  })
  it('a kill in the middle of a pull loses nothing and applies nothing twice (each op is applied and recorded in one transaction)', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    for (let i = 0; i < 20; i++) await a.services.notes.create({ type: 'general', title: `N${i}`, content: `c${i}` })
    await a.engine.sync()
    let calls = 0
    const origTx = b.db.transaction.bind(b.db)
    b.db.transaction = (async (fn: Parameters<typeof origTx>[0]) => { if (++calls === 8) throw new Error('killed'); return origTx(fn) }) as typeof origTx
    await b.engine.sync().catch(() => {})
    b.db.transaction = origTx
    const b2 = await sim.restart(b)
    await sim.syncAll([a, b2])
    expect((await b2.services.notes.getAll()).length).toBe(20)
    expect((await b2.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_applied'))!.n).toBeGreaterThanOrEqual(20)
    expect(await userState(b2)).toEqual(await userState(a))
  })
})

describe('explicit deletion', () => {
  it('the confirmed "Delete all notes" propagates (explicit intent), unlike rows that merely went missing', async () => {
    const a = await sim.device('a'); const b = await sim.device('b')
    for (let i = 0; i < 60; i++) await a.services.notes.create({ type: 'general', title: `N${i}`, content: 'x' })
    await sim.syncAll([a, b])
    await a.services.notes.deleteAll()
    await sim.syncAll([a, b])
    expect(a.engine.getHold()).toBeNull()
    expect((await b.services.notes.getAll()).length).toBe(0)
  })
  it('a note created with a caller-chosen id is created once (idempotent share inbox)', async () => {
    const a = await sim.device('a')
    const r1 = await a.services.notes.create({ id: 'share-x1', type: 'general', title: 'Shared', content: 'once' })
    const r2 = await a.services.notes.create({ id: 'share-x1', type: 'general', title: 'Shared', content: 'once' })
    expect(r1.note!.id).toBe('share-x1'); expect(r2.note!.id).toBe('share-x1')
    expect((await a.services.notes.getAll()).length).toBe(1)
  })
})
