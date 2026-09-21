import { describe, it, expect, beforeEach } from 'vitest'
import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../../services'
import { consoleLogger, defaultUuid, type ServiceContext } from '../../services/context'
import { BEREAN_SCHEMA_VERSION } from '../../db/bereanMigrations'
import { SyncEngine } from '../engine'
import { MemoryCloud, MemorySyncStore } from '../stores/memorySyncStore'
import { journalFileName } from '../journal'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

/**
 * Two-device integration tests over the real services, the real migrated schema and the real
 * engine, with only the transport swapped for the in-memory one (docs/mobile/testing.md §4 and
 * the brief's cases A–O). "mac" and "phone" are two independent databases.
 */
interface Device {
  name: string
  db: DatabaseAdapter
  services: Services
  store: MemorySyncStore
  engine: SyncEngine
  changes: ReturnType<typeof recordingEvents>['changes']
  applied: string[][]
}

let clock = 1_700_000_000_000
const tick = (ms = 1000) => { clock += ms; return clock }
let cloud: MemoryCloud

async function makeDevice(name: string, platform: 'darwin' | 'ios'): Promise<Device> {
  const db = await migratedUserDb(name)
  const rec = recordingEvents()
  const ctx: ServiceContext = {
    userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null,
    events: rec.events, now: () => clock, uuid: defaultUuid, isDev: true, log: consoleLogger,
  }
  const services = createServices(ctx)
  const store = cloud.device(name)
  MemorySyncStore.all.add(store)
  const applied: string[][] = []
  const engine = await SyncEngine.open({
    db, store, events: rec.events, deviceId: name, deviceName: name, platform, appVersion: '0.6.19', schema: BEREAN_SCHEMA_VERSION,
    log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => clock, uuid: defaultUuid,
    onApplied: (set) => applied.push([...set].sort()),
  })
  engine.start()
  return { name, db, services, store, engine, changes: rec.changes, applied }
}

/** Re-open an engine on the same database (simulates an app restart). */
async function restart(d: Device): Promise<Device> {
  d.engine.stop()
  const rec = recordingEvents()
  const ctx: ServiceContext = {
    userDb: d.db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null,
    events: rec.events, now: () => clock, uuid: defaultUuid, isDev: true, log: consoleLogger,
  }
  const services = createServices(ctx)
  const engine = await SyncEngine.open({
    db: d.db, store: d.store, events: rec.events, deviceId: d.name, deviceName: d.name, platform: 'darwin', appVersion: '0.6.19', schema: BEREAN_SCHEMA_VERSION,
    log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => clock, uuid: defaultUuid, onApplied: (set) => d.applied.push([...set].sort()),
  })
  engine.start()
  return { ...d, services, engine, changes: rec.changes }
}

async function syncAll(...devices: Device[]) {
  for (const d of devices) await d.engine.sync()
  for (const d of devices) await d.engine.sync()   // second round so replies (conflict copies) converge
}

const noteTitles = async (d: Device) => (await d.services.notes.getAll()).map((n) => n.title).sort()
const noteById = async (d: Device, id: string) => d.services.notes.getOne(id)

let mac: Device
let phone: Device
beforeEach(async () => {
  clock = 1_700_000_000_000
  cloud = new MemoryCloud()
  MemorySyncStore.all.clear()
  mac = await makeDevice('mac', 'darwin')
  phone = await makeDevice('phone', 'ios')
})

describe('sync engine — two devices', () => {
  it('A/B: a note created on either device reaches the other; sync is idempotent', async () => {
    const a = await mac.services.notes.create({ type: 'general', title: 'From Mac', content: 'shalom' })
    tick()
    const b = await phone.services.notes.create({ type: 'general', title: 'From Phone', content: 'peace' })
    await syncAll(mac, phone)
    expect(await noteTitles(mac)).toEqual(['From Mac', 'From Phone'])
    expect(await noteTitles(phone)).toEqual(['From Mac', 'From Phone'])
    expect((await noteById(phone, a.note!.id))!.content).toBe('shalom')
    expect((await noteById(mac, b.note!.id))!.content).toBe('peace')
    // I: processing the same journals again changes nothing
    const before = await mac.db.all('SELECT * FROM notes ORDER BY id')
    await syncAll(mac, phone)
    expect(await mac.db.all('SELECT * FROM notes ORDER BY id')).toEqual(before)
    expect((await mac.engine.status()).pendingOutbox).toBe(0)
    expect(phone.applied.length).toBeGreaterThan(0)
    expect(phone.changes.some((c) => c.entity === 'note' && (c as { remote?: boolean }).remote)).toBe(false) // recordingEvents strips remote; engine emitted via events
  })

  it('C/D: edits made while offline propagate after reconnecting (both directions)', async () => {
    const a = await mac.services.notes.create({ type: 'general', title: 'Draft', content: 'v1' })
    await syncAll(mac, phone)
    mac.store.setOnline(false)
    tick(); await mac.services.notes.update(a.note!.id, { content: 'v2 (offline on mac)' })
    await mac.engine.sync()   // pushes into the local queue only
    await phone.engine.sync()
    expect((await noteById(phone, a.note!.id))!.content).toBe('v1')
    mac.store.setOnline(true)
    await syncAll(mac, phone)
    expect((await noteById(phone, a.note!.id))!.content).toBe('v2 (offline on mac)')

    phone.store.setOnline(false)
    tick(); await phone.services.notes.update(a.note!.id, { content: 'v3 (offline on phone)' })
    await syncAll(mac, phone)
    expect((await noteById(mac, a.note!.id))!.content).toBe('v2 (offline on mac)')
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect((await noteById(mac, a.note!.id))!.content).toBe('v3 (offline on phone)')
    // no conflict copies were created — these were sequential edits
    expect(await mac.services.notes.getVersions(a.note!.id)).toEqual([])
  })

  it('E: concurrent edits of one note converge on the later edit and keep the other as a conflict version on both devices', async () => {
    const a = await mac.services.notes.create({ type: 'general', title: 'Shared', content: 'base' })
    await syncAll(mac, phone)
    mac.store.setOnline(false); phone.store.setOnline(false)
    tick(); await mac.services.notes.update(a.note!.id, { content: 'mac edit' })
    tick(); await phone.services.notes.update(a.note!.id, { content: 'phone edit' })   // later HLC
    mac.store.setOnline(true); phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect((await noteById(mac, a.note!.id))!.content).toBe('phone edit')
    expect((await noteById(phone, a.note!.id))!.content).toBe('phone edit')
    const vMac = await mac.services.notes.getVersions(a.note!.id)
    const vPhone = await phone.services.notes.getVersions(a.note!.id)
    expect(vMac.map((v) => [v.kind, v.content])).toEqual([['conflict', 'mac edit']])
    expect(vPhone.map((v) => [v.kind, v.content])).toEqual([['conflict', 'mac edit']])
    expect(vMac[0].id).toBe(vPhone[0].id)   // deterministic id → the same row everywhere
    // further syncs never duplicate the conflict copy
    await syncAll(mac, phone)
    expect((await mac.services.notes.getVersions(a.note!.id)).length).toBe(1)
  })

  it('F: concurrent creation of related entities merges (two tags with the same name, members on both)', async () => {
    mac.store.setOnline(false); phone.store.setOnline(false)
    await mac.services.verseTags.addMembers({ newTagNames: ['Covenant'], ranges: [{ bookId: 'GEN', chapter: 9, spans: [{ s: 8, e: 17 }] }], label: 'Gen 9:8-17' })
    tick()
    await phone.services.verseTags.addMembers({ newTagNames: ['Covenant'], ranges: [{ bookId: 'EXO', chapter: 19, spans: [{ s: 5, e: 6 }] }], label: 'Exo 19:5-6' })
    mac.store.setOnline(true); phone.store.setOnline(true)
    await syncAll(mac, phone)
    const macTags = await mac.services.verseTags.list()
    const phoneTags = await phone.services.verseTags.list()
    expect(macTags.map((t) => [t.id, t.name])).toEqual(phoneTags.map((t) => [t.id, t.name]))
    // independent additions both survive; tag names are unique, so the later-created one is
    // deterministically renamed on every device (the user can merge them in the Tag Manager)
    expect(macTags.map((t) => t.name).sort()).toEqual(['Covenant', 'Covenant (2)'])
    expect(macTags.reduce((n, t) => n + t.verseCount, 0)).toBe(12)
    expect((await phone.services.verseTags.getForChapter('GEN', 9)).verseTags[8]?.length).toBe(1)   // derived index rebuilt from synced ranges
    expect((await phone.services.verseTags.getForChapter('EXO', 19)).verseTags[5]?.length).toBe(1)
  })

  it('G/H: deletions propagate; an edit made after a trash or purge wins (never silently loses work)', async () => {
    const a = await mac.services.notes.create({ type: 'general', title: 'Doomed', content: 'x' })
    const b = await mac.services.notes.create({ type: 'general', title: 'Edited later', content: 'y' })
    await syncAll(mac, phone)
    // G: purge on mac while phone is offline
    phone.store.setOnline(false)
    tick(); await mac.services.notes.delete(a.note!.id); await mac.services.notes.purgeTrashItem(a.note!.id)
    await mac.engine.sync()
    expect(await noteById(phone, a.note!.id)).not.toBeNull()
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect(await noteById(phone, a.note!.id)).toBeNull()
    // H: mac trashes b, phone edits b LATER (offline) → the edit wins and b is back out of the trash
    phone.store.setOnline(false)
    tick(); await mac.services.notes.delete(b.note!.id)
    tick(); await phone.services.notes.update(b.note!.id, { content: 'y2' })
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect((await noteById(mac, b.note!.id))!.content).toBe('y2')
    expect((await mac.services.notes.listTrash()).map((n) => n.id)).not.toContain(b.note!.id)
    // and the mirror case: phone edits EARLIER than mac's purge → purge wins on both
    const c = await mac.services.notes.create({ type: 'general', title: 'C', content: 'c' })
    await syncAll(mac, phone)
    phone.store.setOnline(false)
    tick(); await phone.services.notes.update(c.note!.id, { content: 'c2' })
    tick(); await mac.services.notes.delete(c.note!.id); await mac.services.notes.purgeTrashItem(c.note!.id)
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect(await noteById(mac, c.note!.id)).toBeNull()
    expect(await noteById(phone, c.note!.id)).toBeNull()
  })

  it('J: a journal file that is not downloaded yet stops that device\'s stream at the gap; later files are applied in order once it arrives', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) { tick(); ids.push((await mac.services.notes.create({ type: 'general', title: `n${i}`, content: `${i}` })).note!.id) }
    await mac.engine.sync()               // file 1: seq 1-3
    tick(); await mac.services.notes.update(ids[0], { content: 'edited' })
    await mac.engine.sync()               // file 2: seq 4
    const first = journalFileName(1, 3)
    cloud.evict('mac', first)
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual([])   // nothing applied: seq 4 must not run before 1-3
    cloud.evict('mac', first, false)
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['n0', 'n1', 'n2'])
    expect((await noteById(phone, ids[0]))!.content).toBe('edited')
  })

  it('K/L: both devices reorder / add tabs in the same session — union membership and one deterministic order', async () => {
    const tab = (id: string, order: string, chapter: number) => ({ id, session_id: 's1', space_id: 'scripture', type: 'bible', title: `Gen ${chapter}`, is_pinned: 0, order_key: order, display_order_key: order, origin_tab_id: null, origin_space_id: null, sync_state_json: JSON.stringify({ bookId: 'GEN', chapter }) })
    const session = { id: 's1', name: 'Session 1', icon: null, tab_filter: null, order_key: 'a0' }
    await mac.services.sessions.applySnapshot({ sessions: [session], tabs: [tab('t1', 'a0', 1)], archivedGroups: [] })
    await syncAll(mac, phone)
    expect((await phone.services.sessions.listTabs('s1')).map((t) => t.id)).toEqual(['t1'])
    mac.store.setOnline(false); phone.store.setOnline(false)
    tick(); await mac.services.sessions.applySnapshot({ sessions: [session], tabs: [tab('t1', 'a0', 1), tab('t2', 'a1', 2)], archivedGroups: [] })
    tick(); await phone.services.sessions.applySnapshot({ sessions: [session], tabs: [tab('t3', 'Zz', 3), tab('t1', 'a0', 1)], archivedGroups: [] })  // t3 first
    mac.store.setOnline(true); phone.store.setOnline(true)
    await syncAll(mac, phone)
    const macTabs = (await mac.services.sessions.listTabs('s1')).map((t) => t.id)
    const phoneTabs = (await phone.services.sessions.listTabs('s1')).map((t) => t.id)
    expect(macTabs).toEqual(['t3', 't1', 't2'])
    expect(phoneTabs).toEqual(macTabs)
    // L: rename the session on mac, close t2 on phone concurrently
    mac.store.setOnline(false); phone.store.setOnline(false)
    tick(); await mac.services.sessions.applySnapshot({ sessions: [{ ...session, name: 'Renamed' }], tabs: [tab('t3', 'Zz', 3), tab('t1', 'a0', 1), tab('t2', 'a1', 2)], archivedGroups: [] })
    tick(); await phone.services.sessions.applySnapshot({ sessions: [session], tabs: [tab('t3', 'Zz', 3), tab('t1', 'a0', 1)], archivedGroups: [] })
    mac.store.setOnline(true); phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect((await mac.services.sessions.listSessions())[0].name).toBe('Renamed')   // phone's later snapshot had the same name → no change to it
    expect((await mac.services.sessions.listTabs('s1')).map((t) => t.id)).toEqual(['t3', 't1'])
    expect((await phone.services.sessions.listTabs('s1')).map((t) => t.id)).toEqual(['t3', 't1'])
    expect((await phone.services.sessions.listSessions())[0].name).toBe('Renamed')
  })

  it('M: restarting mid-push resumes without duplicating or losing ops', async () => {
    for (let i = 0; i < 3; i++) { tick(); await mac.services.notes.create({ type: 'general', title: `m${i}`, content: '' }) }
    mac.store.failWrites = 2              // the journal write fails (sync() retries push once after pull)
    await mac.engine.sync()
    expect((await mac.engine.status()).pendingOutbox).toBe(3)
    expect((await mac.engine.status()).lastError).toMatch(/push/)
    mac = await restart(mac)
    await syncAll(mac, phone)
    expect(await noteTitles(phone)).toEqual(['m0', 'm1', 'm2'])
    expect((await mac.engine.status()).pendingOutbox).toBe(0)
    // a restart after a successful push never re-sends
    mac = await restart(mac)
    await syncAll(mac, phone)
    expect((await cloud.readManifestSeq('mac'))).toBe(3)
  })

  it('N/O: a truncated journal applies its complete lines and finishes later; a corrupt line is skipped and counted', async () => {
    tick(); const a = await mac.services.notes.create({ type: 'general', title: 'A', content: '' })
    tick(); const b = await mac.services.notes.create({ type: 'general', title: 'B', content: '' })
    await mac.engine.sync()
    const file = journalFileName(1, 2)
    const full = cloud.folder('mac').get(file)!
    // N: cut the second line in half (upload in progress)
    cloud.corrupt('mac', file, (t) => t.slice(0, t.lastIndexOf('\n', t.length - 2) + 10))
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['A'])
    cloud.folder('mac').set(file, full)
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['A', 'B'])
    // O: a garbage line and an op claiming another device's id are skipped, later ops still apply
    tick(); const c = await mac.services.notes.create({ type: 'general', title: 'C', content: '' })
    await mac.engine.sync()
    const f2 = journalFileName(3, 3)
    cloud.corrupt('mac', f2, (t) => `{"garbage":true}\n${t.replace('"device":"mac"', '"device":"phone"')}${t}`)
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['A', 'B', 'C'])
    expect((await phone.engine.status()).unreadable).toBe(2)
    expect(a.note && b.note && c.note).toBeTruthy()
  })

  it('adoptExisting: data from before sync was enabled is journaled once with HLCs from its own timestamps', async () => {
    // mac has old notes (created "a year ago"), phone has one newer edit of a note with the same id (synced by another means)
    const old = clock - 365 * 86400_000
    await mac.db.run("INSERT INTO notes (id, type, title, content, created_at, updated_at, tags) VALUES ('shared', 'general', 'Shared', 'old content', ?, ?, '[]')", [old, old])
    await mac.db.run("INSERT INTO notes (id, type, title, content, created_at, updated_at, tags) VALUES ('only-mac', 'general', 'Only mac', 'x', ?, ?, '[]')", [old, old])
    await phone.db.run("INSERT INTO notes (id, type, title, content, created_at, updated_at, tags) VALUES ('shared', 'general', 'Shared', 'newer content', ?, ?, '[]')", [old, old + 5000])
    expect(await mac.engine.adoptExisting()).toBe(2)
    expect(await phone.engine.adoptExisting()).toBe(1)
    expect(await mac.engine.adoptExisting()).toBe(0)   // once
    await syncAll(mac, phone)
    expect((await noteById(mac, 'shared'))!.content).toBe('newer content')
    expect((await noteById(phone, 'only-mac'))!.title).toBe('Only mac')
    // the two adopted copies differed, so the older content is kept as a recoverable conflict copy
    expect((await mac.services.notes.getVersions('shared')).map((v) => [v.kind, v.content])).toEqual([['conflict', 'old content']])
    expect((await phone.services.notes.getVersions('shared')).map((v) => [v.kind, v.content])).toEqual([['conflict', 'old content']])
  })

  it('a device on a newer schema is reported, not applied; iCloud unavailable queues locally', async () => {
    tick(); await mac.services.notes.create({ type: 'general', title: 'N', content: '' })
    await mac.engine.sync()
    const m = cloud.manifests.get('mac')!
    m.schema = BEREAN_SCHEMA_VERSION + 1
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual([])
    expect((await phone.engine.status()).lastError).toMatch(/Update Berean/)
    m.schema = BEREAN_SCHEMA_VERSION
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['N'])
    phone.store.containerMissing = true
    tick(); await phone.services.notes.create({ type: 'general', title: 'Queued', content: '' })
    await phone.engine.sync()
    expect((await phone.engine.status()).pendingOutbox).toBe(1)
    expect((await phone.engine.status()).transport.available).toBe(false)
    phone.store.containerMissing = false
    await syncAll(mac, phone)
    expect(await noteTitles(mac)).toEqual(['N', 'Queued'])
  })
})

declare module '../stores/memorySyncStore' {
  interface MemoryCloud { readManifestSeq(device: string): Promise<number> }
}
MemoryCloud.prototype.readManifestSeq = async function (device: string) { return this.manifests.get(device)?.seq ?? 0 }
