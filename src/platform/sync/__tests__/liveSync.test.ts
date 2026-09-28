/**
 * DATA-SYNC-007/008 — the LIVE sync lifecycle, as on two real devices: the real services, schema,
 * engine, CloudSyncStore (iPhone transport) and the shared host core, over a behavioural model of
 * iCloud Drive (upload delay, metadata notifications, downloads only on request). NOTHING here
 * calls engine.sync(): every change must travel on its own, driven by events.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../../services'
import { consoleLogger, defaultUuid, type ServiceContext, type DataChange } from '../../services/context'
import { BEREAN_SCHEMA_VERSION } from '../../db/bereanMigrations'
import { SyncEngine } from '../engine'
import { createSyncHostCore, type SyncHostCore } from '../hostCore'
import { createSyncTrace } from '../trace'
import { CloudSyncStore } from '../../ios/cloudSyncStore'
import { ICloudDriveSim } from './icloudDriveSim'
import type { SyncState, SyncStatusSnapshot } from '../types'

interface Dev { name: string; services: Services; engine: SyncEngine; core: SyncHostCore; applied: string[][]; remoteEvents: DataChange[]; states: SyncState[]; trace: ReturnType<typeof createSyncTrace> }
const devs: Dev[] = []
afterEach(() => { for (const d of devs.splice(0)) { d.core.stop(); d.engine.stop() } })

async function device(name: string, sim: ICloudDriveSim): Promise<Dev> {
  const db = await migratedUserDb(`live-${name}-${Math.random()}`)
  const rec = recordingEvents()
  const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: rec.events, now: () => Date.now(), uuid: defaultUuid, isDev: true, log: consoleLogger }
  const services = createServices(ctx)
  const store = new CloudSyncStore(name, sim.plugin(name))
  const applied: string[][] = []
  const remoteEvents: DataChange[] = []
  rec.events.on('data:changed', (c) => { if (c.remote) remoteEvents.push(c) })
  const trace = createSyncTrace({ enabled: true })
  const engine = await SyncEngine.open({
    db, store, events: rec.events, deviceId: name, deviceName: name, platform: 'ios', appVersion: '0', schema: BEREAN_SCHEMA_VERSION,
    log: { info() {}, warn() {}, error() {} }, uuid: defaultUuid, trace, onApplied: (e) => applied.push([...e].sort()),
  })
  engine.start()
  const states: SyncState[] = []
  const core = createSyncHostCore({ engine, store, trace, localDebounceMs: 30, fallbackIntervalMs: null, onStatus: (s: SyncStatusSnapshot | null) => { if (s?.state) states.push(s.state) } })
  const d = { name, services, engine, core, applied, remoteEvents, states, trace }
  devs.push(d)
  return d
}

const until = async (cond: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)) }
}

describe('live sync over a model of iCloud Drive (no manual sync)', () => {
  it('TEST 1–3: a local edit uploads on its own; the other device is notified, downloads, applies, and emits invalidation', async () => {
    const sim = new ICloudDriveSim({ uploadMs: 40, downloadMs: 30, proactiveDownloads: true })
    const phone = await device('phone', sim)
    const mac = await device('mac', sim)
    const n = await phone.services.notes.create({ type: 'general', title: 'DEVICE A TEST 001', content: 'hello' })
    // TEST 1: nobody asked for a sync — the captured change woke the push.
    await until(() => [...sim.files.keys()].some((p) => p.startsWith('devices/phone/journal-')))
    // TEST 2: the mac's database has it, without any refresh or manual sync.
    await until(async () => (await mac.services.notes.getOne(n.note!.id))?.title === 'DEVICE A TEST 001')
    // TEST 3: invalidation reached the UI layer (onApplied) and remote data:changed events fired.
    expect(mac.applied.flat()).toContain('note')
    expect(mac.remoteEvents.some((e) => e.entity === 'note' && e.id === n.note!.id)).toBe(true)
    // …and back: an edit on the mac arrives on the phone the same way.
    await mac.services.notes.update(n.note!.id, { content: 'DEVICE B TEST 002' })
    await until(async () => (await phone.services.notes.getOne(n.note!.id))?.content === 'DEVICE B TEST 002')
    const events = mac.trace.entries().map((e) => e.event)
    for (const e of ['remote:notified', 'pull:start', 'remote:applied', 'local:captured', 'push:written']) expect(events).toContain(e)
  })

  it('the OLD plugin behaviour (no proactive downloads, no local-change wake) leaves the other device stale — the reported bug', async () => {
    const sim = new ICloudDriveSim({ uploadMs: 20, downloadMs: 20, proactiveDownloads: false })
    const phone = await device('phone', sim)
    const mac = await device('mac', sim)
    phone.engine.setLocalChangeListener(null)          // old host: nothing woke the push
    const n = await phone.services.notes.create({ type: 'general', title: 'stale', content: 'x' })
    await new Promise((r) => setTimeout(r, 300))
    expect([...sim.files.keys()].some((p) => p.startsWith('devices/phone/journal-'))).toBe(false)   // waited for the 60 s timer
    expect(await mac.services.notes.getOne(n.note!.id)).toBeNull()
  })

  it('folders, highlights, tags and workspaces travel on their own too', async () => {
    const sim = new ICloudDriveSim({ uploadMs: 20, downloadMs: 20, proactiveDownloads: true })
    const phone = await device('phone', sim)
    const mac = await device('mac', sim)
    const f = await phone.services.notes.folderCreate('Torah')
    await phone.services.highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow' })
    const w = await phone.services.workspaces.save('Study', '{}', '{}')
    await until(async () => (await mac.services.notes.folderList()).some((x) => x.id === f.id))
    await phone.services.notes.folderRename(f.id, 'Law')
    await phone.services.workspaces.rename(w.id, 'Deep study')
    await until(async () => (await mac.services.notes.folderList()).find((x) => x.id === f.id)?.name === 'Law')
    await until(async () => (await mac.services.workspaces.list()).some((x) => x.name === 'Deep study'))
    expect(Object.keys(await mac.services.highlights.getChapter('GEN', 1, 'kjva'))).toEqual(['1'])
    expect(mac.applied.flat()).toEqual(expect.arrayContaining(['note_folder', 'highlight', 'workspace']))
  })

  it('TEST 9: duplicate notifications are idempotent', async () => {
    const sim = new ICloudDriveSim({ uploadMs: 20, downloadMs: 20, proactiveDownloads: true })
    const phone = await device('phone', sim)
    const mac = await device('mac', sim)
    const n = await phone.services.notes.create({ type: 'general', title: 'Once', content: 'x' })
    await until(async () => !!(await mac.services.notes.getOne(n.note!.id)))
    const before = mac.remoteEvents.length
    for (let i = 0; i < 3; i++) sim.duplicateNotify('mac', ['devices/phone/manifest.json'])
    await new Promise((r) => setTimeout(r, 1700))
    await mac.core.idle()
    expect(mac.remoteEvents.length).toBe(before)
    expect((await mac.services.notes.getAll()).filter((x) => x.title === 'Once')).toHaveLength(1)
  })

  it('TEST 10: status is honest — pending → uploading → up to date on the sender; downloading/reconciling → up to date on the receiver', async () => {
    const sim = new ICloudDriveSim({ uploadMs: 150, downloadMs: 60, proactiveDownloads: true })
    const phone = await device('phone', sim)
    const mac = await device('mac', sim)
    await phone.services.notes.create({ type: 'general', title: 'status', content: 'x' })
    await new Promise((r) => setTimeout(r, 5))
    expect((await phone.engine.status()).state).toBe('pending')
    await until(async () => (await phone.engine.status()).state === 'uploading', 1000)
    await until(async () => (await phone.engine.status()).state === 'synced', 2000)
    await until(async () => (await mac.services.notes.getAll()).length === 1)
    // The receiver was notified first, then applied (the plugin had already fetched the files) …
    const ev = mac.trace.entries().map((e) => e.event)
    expect(ev.indexOf('remote:notified')).toBeGreaterThanOrEqual(0)
    expect(ev.indexOf('remote:notified')).toBeLessThan(ev.indexOf('remote:applied'))
    // … then acknowledged it in its own manifest, honestly 'uploading' until iCloud takes that
    // file, and only then 'synced'.
    await until(async () => (await mac.engine.status()).state === 'synced', 2000)
  })

  it('the diagnostic log carries metadata only — never titles or content', async () => {
    const sim = new ICloudDriveSim({ uploadMs: 20, downloadMs: 20, proactiveDownloads: true })
    const phone = await device('phone', sim)
    const mac = await device('mac', sim)
    const n = await phone.services.notes.create({ type: 'general', title: 'SECRET TITLE', content: 'secret body text' })
    await until(async () => !!(await mac.services.notes.getOne(n.note!.id)))
    const all = JSON.stringify([...phone.trace.entries(), ...mac.trace.entries()])
    expect(all).not.toMatch(/SECRET|secret body/)
  })
})
