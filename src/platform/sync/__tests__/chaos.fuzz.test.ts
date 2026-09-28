/**
 * Chaos / property-based sync testing (DATA-SAFE-090). Seeded random operation sequences on 2–5
 * logical devices with offline periods, crashes (engine stopped without pushing), duplicate
 * delivery (bookkeeping lost → journals replayed), reinstalls (after a sync — a reinstall can
 * only restore what reached iCloud) and arbitrary sync / reconnect order. After everything
 * reconnects, the invariants must hold:
 *   I1  every device converges to the same user-visible state
 *   I2  no note text anyone wrote silently disappears: it is current somewhere, kept in a
 *       note's Versions, superseded by an edit made ON TOP of it, or was purged by a device that
 *       had it (an explicit deletion)
 *   I3  replaying every journal again changes nothing (idempotence)
 *   I4  a reinstall publishes no deletions
 *   I5  no false alarms: no device ends up holding sync (nothing here damages a database)
 * FUZZ_SEEDS (env) raises the scenario count; a failing seed is printed and belongs in
 * REGRESSION_SEEDS below once fixed.
 */
import { describe, it, expect } from 'vitest'
import { Sim, userState, allCloudOps, type SimDevice } from './harness'

// Seeds that exposed real bugs while this suite was built (docs/mobile/sync.md "Data safety"):
//   2     merge-made conflict copies were never journaled (3+ devices diverged)
//   4     test transport lost offline writes across a restart (fixed in MemorySyncStore)
//   5, 7  a merge outcome shared an id with one side → a later op fast-forwarded over the other
//   50    field values resurfacing through a Trash resolution; a value/clock mismatch
//   225   (model) purging a note deletes its version history on purpose
//   295   tombstones labelled differently on different devices; lineage too short for replays
//   3824  a user's purge cascade (a note's versions) was quarantined as damage
const REGRESSION_SEEDS: number[] = [2, 4, 5, 7, 50, 225, 295, 3824]
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 120)

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

interface Model {
  written: Set<string>
  superseded: Set<string>
  purgedSeen: Set<string>
  tokens: number
}

async function scenario(seed: number): Promise<void> {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const sim = new Sim()
  const n = 2 + Math.floor(r() * 4)
  const ds: SimDevice[] = []
  for (let i = 0; i < n; i++) ds.push(await sim.device(`d${i}`))
  const m: Model = { written: new Set(), superseded: new Set(), purgedSeen: new Set(), tokens: 0 }
  const token = () => `t${seed}x${++m.tokens}`

  // Seed data everyone has.
  for (let i = 0; i < 3; i++) { const t = token(); m.written.add(t); await ds[0].services.notes.create({ type: 'general', title: `N${i}`, content: t }) }
  await ds[0].services.notes.folderCreate('F0')
  await sim.syncAll(ds)
  const opsBeforeReinstalls = () => allCloudOps(sim.cloud).filter((o) => o.op === 'delete').length

  const steps = 30 + Math.floor(r() * 30)
  for (let s = 0; s < steps; s++) {
    sim.tick(1 + Math.floor(r() * 5000))
    const i = Math.floor(r() * ds.length)
    const d = ds[i]
    const notes = await d.services.notes.getAll()
    const trash = await d.services.notes.listTrash()
    const folders = await d.services.notes.folderList()
    const x = r()
    try {
      if (x < 0.12) { d.store.setOnline(!d.store.isOnline()) }
      else if (x < 0.30) { await d.engine.sync() }
      else if (x < 0.38) { const t = token(); m.written.add(t); await d.services.notes.create({ type: 'general', title: 'Same', content: t }) }
      else if (x < 0.55 && notes.length) {
        const note = pick(notes); const t = token()
        m.written.add(t); m.superseded.add(note.content)
        await d.services.notes.update(note.id, { content: t })
      }
      else if (x < 0.60 && notes.length) { const note = pick(notes); await d.services.notes.update(note.id, { title: `T${Math.floor(r() * 100)}` }) }
      else if (x < 0.65 && notes.length) { const note = pick(notes); await d.services.notes.setPinned(note.id, !note.pinned) }
      else if (x < 0.70 && notes.length && folders.length) { await d.services.notes.setFolder(pick(notes).id, pick([...folders.map((f) => f.id), null])) }
      else if (x < 0.74 && notes.length) { await d.services.notes.delete(pick(notes).id) }
      else if (x < 0.77 && trash.length) { await d.services.notes.restore(pick(trash).id) }
      else if (x < 0.80 && trash.length) {
        // Purging deletes the note AND its version history on purpose: everything this device had
        // for it is explicitly deleted by the user.
        const t = pick(trash); m.purgedSeen.add(t.content)
        for (const v of await d.db.all<{ content: string }>('SELECT content FROM note_versions WHERE note_id = ?', [t.id])) m.purgedSeen.add(v.content)
        await d.services.notes.purgeTrashItem(t.id)
      }
      else if (x < 0.83) { await d.services.notes.folderCreate(`F${Math.floor(r() * 5)}`) }
      else if (x < 0.86 && folders.length) { await d.services.notes.folderRename(pick(folders).id, `R${Math.floor(r() * 50)}`) }
      else if (x < 0.90) { await d.services.highlights.toggle({ bookId: 'PSA', chapter: 23, verseNum: 1 + Math.floor(r() * 3), color: pick(['yellow', 'green', 'blue']) }) }
      else if (x < 0.94) { ds[i] = await sim.restart(d) }                                   // crash / relaunch
      else if (x < 0.97) { await d.db.run('DELETE FROM sync_applied') }                     // lost bookkeeping → replay
      else if (ds.length > 1) {
        // uninstall + reinstall, after a sync (only what reached iCloud can come back)
        d.store.setOnline(true); await d.engine.sync()
        const before = opsBeforeReinstalls()
        d.engine.stop()
        ds[i] = await sim.device(d.name)
        await ds[i].engine.sync()
        expect(opsBeforeReinstalls(), `seed ${seed}: reinstall published deletions`).toBe(before)
      }
    } catch (err) {
      throw new Error(`seed ${seed} step ${s}: ${err instanceof Error ? err.stack : String(err)}`)
    }
  }

  for (const d of ds) d.store.setOnline(true)
  await sim.syncAll(ds, 4)
  const states = await Promise.all(ds.map(userState))
  // I5 no false alarm: nothing here damages a database, so no device may end up holding sync
  for (const d of ds) expect(d.engine.getHold(), `seed ${seed}: ${d.name} is holding`).toBeNull()
  for (let i = 1; i < ds.length; i++) expect(states[i], `seed ${seed}: device ${i} diverged`).toEqual(states[0])

  const present = new Set<string>()
  for (const d of ds) {
    for (const row of await d.db.all<{ content: string }>('SELECT content FROM notes')) present.add(row.content)
    for (const row of await d.db.all<{ content: string }>('SELECT content FROM note_versions')) present.add(row.content)
  }
  const lost = [...m.written].filter((t) => !present.has(t) && !m.superseded.has(t) && !m.purgedSeen.has(t))
  expect(lost, `seed ${seed}: note text silently lost`).toEqual([])

  const before = states[0]
  await ds[0].db.run('DELETE FROM sync_applied')
  await sim.syncAll([ds[0]])
  expect(await userState(ds[0]), `seed ${seed}: replay changed the state`).toEqual(before)
}

describe('sync chaos (seeded)', () => {
  for (const seed of REGRESSION_SEEDS) it(`regression seed ${seed}`, () => scenario(seed), 60_000)
  it(`${SEEDS} random multi-device scenarios converge without silent loss`, async () => {
    for (let seed = Number(process.env.FUZZ_FROM ?? 1); seed <= SEEDS; seed++) await scenario(seed)
  }, 600_000)
})
