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

  it('G/H: deletions propagate; a delete concurrent with an edit neither resurrects nor destroys: the note lands in the Trash with the edit (DATA-SYNC-002)', async () => {
    const a = await mac.services.notes.create({ type: 'general', title: 'Doomed', content: 'x' })
    const b = await mac.services.notes.create({ type: 'general', title: 'Edited later', content: 'y' })
    await syncAll(mac, phone)
    // G: purge on mac while phone is offline (phone did not touch it) → gone everywhere
    phone.store.setOnline(false)
    tick(); await mac.services.notes.delete(a.note!.id); await mac.services.notes.purgeTrashItem(a.note!.id)
    await mac.engine.sync()
    expect(await noteById(phone, a.note!.id)).not.toBeNull()
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect(await noteById(phone, a.note!.id)).toBeNull()
    // H: mac trashes b, phone edits b while apart → b is in the Trash on BOTH, holding the edit
    phone.store.setOnline(false)
    tick(); await mac.services.notes.delete(b.note!.id)
    tick(); await phone.services.notes.update(b.note!.id, { content: 'y2' })
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      expect((await noteById(d, b.note!.id))!.content).toBe('y2')
      expect((await d.services.notes.listTrash()).map((n) => n.id)).toContain(b.note!.id)
    }
    // the purge case, either timing: phone edits c while mac purges it → c comes back INTO THE
    // TRASH with the phone's edit on both devices (restorable), never silently gone
    const c = await mac.services.notes.create({ type: 'general', title: 'C', content: 'c' })
    await syncAll(mac, phone)
    phone.store.setOnline(false)
    tick(); await phone.services.notes.update(c.note!.id, { content: 'c2' })
    tick(); await mac.services.notes.delete(c.note!.id); await mac.services.notes.purgeTrashItem(c.note!.id)
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      expect((await noteById(d, c.note!.id))!.content).toBe('c2')
      expect((await d.services.notes.listTrash()).map((n) => n.id)).toContain(c.note!.id)
    }
    // a delete the other device HAD seen is an ordinary delete: restore + edit afterwards is live
    tick(); await mac.services.notes.restore(c.note!.id)
    await syncAll(mac, phone)
    expect((await phone.services.notes.listTrash()).map((n) => n.id)).not.toContain(c.note!.id)
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

describe('sync engine — local reconciliation (DATA-SYNC-001)', () => {
  it('edits made while nothing was capturing (sync off / killed before capture) are reconciled at start, then sync', async () => {
    const n = await mac.services.notes.create({ type: 'general', title: 'N', content: 'v1' })
    const f = await mac.services.notes.folderCreate('Folder')
    await syncAll(mac, phone)
    mac.engine.stop()                                   // no capture: sync switched off, or killed mid-capture
    tick(); await mac.services.notes.update(n.note!.id, { content: 'offline edit' })
    await mac.services.notes.folderRename(f.id, 'Renamed')   // note_folders has no updated_at: the full compare finds it
    mac = await restart(mac)
    expect(await mac.engine.reconcileLocal()).toBe(2)
    expect(await mac.engine.reconcileLocal()).toBe(0)   // idempotent: nothing new the second time
    await syncAll(mac, phone)
    expect((await noteById(phone, n.note!.id))!.content).toBe('offline edit')
    expect((await phone.services.notes.folderList()).map((x) => x.name)).toContain('Renamed')
  })

  it('a missed local edit is not overwritten by a remote edit — it becomes a preserved conflict', async () => {
    const n = await mac.services.notes.create({ type: 'general', title: 'N', content: 'base' })
    await syncAll(mac, phone)
    mac.engine.stop()
    tick(); await mac.services.notes.update(n.note!.id, { content: 'mac, missed by capture' })
    tick(); await phone.services.notes.update(n.note!.id, { content: 'phone edit' })
    mac = await restart(mac)
    await mac.engine.reconcileLocal()
    await syncAll(mac, phone)
    const versions = async (d: Device) => (await d.db.all<{ content: string }>("SELECT content FROM note_versions WHERE note_id = ? AND kind = 'conflict'", [n.note!.id])).map((v) => v.content)
    for (const d of [mac, phone]) {
      const current = (await noteById(d, n.note!.id))!.content
      expect([current, ...(await versions(d))].sort()).toEqual(['mac, missed by capture', 'phone edit'])
    }
  })

  it('a full reconciliation of a never-synced database journals every record once (sync enabled later)', async () => {
    mac.engine.stop()
    await mac.services.notes.create({ type: 'general', title: 'A', content: 'a' })
    await mac.services.notes.create({ type: 'general', title: 'B', content: 'b' })
    mac = await restart(mac)
    expect(await mac.engine.reconcileLocal(true)).toBe(2)
    await syncAll(mac, phone)
    expect(await noteTitles(phone)).toEqual(['A', 'B'])
  })

  it('pending operations survive an app restart while iCloud is unavailable (the outbox is in SQLite, not memory)', async () => {
    phone.store.containerMissing = true            // signed out / container unavailable
    await phone.services.notes.create({ type: 'general', title: 'Offline note', content: 'x' })
    await phone.engine.sync()
    expect((await phone.engine.status()).pendingOutbox).toBeGreaterThan(0)
    expect((await phone.engine.status()).lastError).toMatch(/not available/)
    phone = await restart(phone)
    expect((await phone.engine.status()).pendingOutbox).toBeGreaterThan(0)
    phone.store.containerMissing = false
    await syncAll(phone, mac)
    expect(await noteTitles(mac)).toEqual(['Offline note'])
  })
})

describe('sync engine — daily notes (DATA-DAILY-001)', () => {
  it("the same day's daily note created on two devices while apart is ONE note after sync (the other text kept as a conflict copy)", async () => {
    phone.store.setOnline(false)
    const m = await mac.services.notes.create({ type: 'daily', title: 'Daily — 2026-09-27', content: 'mac thoughts' })
    tick()
    const p = await phone.services.notes.create({ type: 'daily', title: 'Daily — 2026-09-27', content: 'phone thoughts' })
    expect(m.note!.id).toBe('daily-2026-09-27')
    expect(p.note!.id).toBe('daily-2026-09-27')
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      const dailies = (await d.services.notes.getAll()).filter((n) => n.title === 'Daily — 2026-09-27')
      expect(dailies).toHaveLength(1)
      const conflict = await d.db.all<{ content: string }>("SELECT content FROM note_versions WHERE note_id = 'daily-2026-09-27' AND kind = 'conflict'")
      expect([dailies[0].content, ...conflict.map((c) => c.content)].sort()).toEqual(['mac thoughts', 'phone thoughts'])
    }
  })
})

describe('sync engine — user data round trips (DATA-ENT-*)', () => {
  const hl = async (d: Device) => (await d.db.all<{ id: string; color: string }>("SELECT id, color FROM highlights WHERE book_id = 'JHN' AND chapter = 3 AND verse_num = 16"))
  it('highlights: create / recolour / remove sync; the same verse highlighted on both devices while apart is ONE highlight', async () => {
    await mac.services.highlights.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'yellow' })
    await syncAll(mac, phone)
    expect(await hl(phone)).toEqual([{ id: 'hl-kjva-JHN-3-16-v', color: 'yellow' }])
    tick(); await phone.services.highlights.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'green' })
    await syncAll(mac, phone)
    expect((await hl(mac))[0].color).toBe('green')
    tick(); await mac.services.highlights.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'green' })   // same colour → removes
    await syncAll(mac, phone)
    expect(await hl(phone)).toEqual([])
    // apart: both highlight Genesis 1:1 in different colours → one highlight, the later colour
    phone.store.setOnline(false)
    await mac.services.highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'blue' })
    tick(); await phone.services.highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'purple' })
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    for (const d of [mac, phone]) expect(await d.db.all("SELECT color FROM highlights WHERE book_id = 'GEN' AND chapter = 1 AND verse_num = 1")).toEqual([{ color: 'purple' }])
  })

  it('folders: nesting, moving a note in and out, renaming — the tree and the note survive on the other device', async () => {
    const parent = await mac.services.notes.folderCreate('Torah')
    const child = await mac.services.notes.folderCreate('Feasts', parent.id)
    const n = await mac.services.notes.create({ type: 'general', title: 'Sukkot', content: 'Lev 23:34' })
    await mac.services.notes.setFolder(n.note!.id, child.id)
    await syncAll(mac, phone)
    const tree = await phone.services.notes.folderList()
    expect(tree.find((f) => f.name === 'Feasts')!.parentId).toBe(parent.id)
    expect((await noteById(phone, n.note!.id))!.folderId ?? (await phone.db.get<{ folder_id: string }>('SELECT folder_id FROM notes WHERE id = ?', [n.note!.id]))!.folder_id).toBe(child.id)
    tick(); await phone.services.notes.setFolder(n.note!.id, null)
    await phone.services.notes.folderRename(child.id, 'Appointed times')
    await syncAll(mac, phone)
    expect((await mac.db.get<{ folder_id: string | null }>('SELECT folder_id FROM notes WHERE id = ?', [n.note!.id]))!.folder_id).toBeNull()
    expect((await mac.services.notes.folderList()).map((f) => f.name)).toContain('Appointed times')
  })

  it('workspaces: a workspace saved on one device (with its tabs snapshot) appears on the other and loads the same tabs', async () => {
    const state = JSON.stringify({ tabs: { scripture: [{ id: 't1', type: 'bible', state: { bookId: 'MAT', chapter: 10 } }] } })
    const w = await mac.services.workspaces.save('Study', '{}', state)
    await syncAll(mac, phone)
    expect((await phone.services.workspaces.list()).map((x) => x.name)).toEqual(['Study'])
    expect((await phone.services.workspaces.load(w.id))!.state_json).toBe(state)
    tick(); await phone.services.workspaces.rename(w.id, 'Deep study')
    await syncAll(mac, phone)
    expect((await mac.services.workspaces.list()).map((x) => x.name)).toEqual(['Deep study'])
  })
})

describe('sync engine — Phase 9 entities', () => {
  it('P: YouTube stars and resume positions sync and are mirrored into the tables the UI reads', async () => {
    for (const d of [mac, phone]) await d.db.run("INSERT INTO youtube_videos (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, fetched_at) VALUES ('v1', 'Torah portion', '', 'Ch', '@ch', 't1', 'video', '')")
    await mac.services.youtube.toggleStar('v1')
    tick(); await mac.services.youtube.savePosition('v1', 754, { title: 'Torah portion', channelName: 'Ch', thumbnailUrl: 't1' })
    // a video the phone has never fetched: the star must still arrive and be applied later
    await mac.db.run("INSERT INTO youtube_videos (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, fetched_at) VALUES ('v2', 'Later', '', 'Ch', '@ch', '', 'video', '')")
    tick(); await mac.services.youtube.toggleStar('v2')
    await syncAll(mac, phone)
    expect((await phone.services.youtube.loadAll()).find((v) => v.videoId === 'v1')?.isStarred).toBe(true)
    expect(await phone.services.youtube.getPosition('v1')).toBe(754)
    expect((await phone.services.youtube.getWatchHistory()).map((h) => h.videoId)).toEqual(['v1'])
    expect(await phone.db.get('SELECT is_starred FROM youtube_user WHERE video_id = ?', ['v2'])).toEqual({ is_starred: 1 })
    // the phone clears its history; the mac's star survives, its position is gone on both
    tick(); await phone.services.youtube.clearWatchHistory()
    await syncAll(phone, mac)
    expect(await mac.services.youtube.getPosition('v1')).toBe(0)
    expect((await mac.services.youtube.loadAll()).find((v) => v.videoId === 'v1')?.isStarred).toBe(true)
    // unstar on the phone → gone on the mac
    tick(); await phone.services.youtube.toggleStar('v1')
    await syncAll(phone, mac)
    expect((await mac.services.youtube.loadAll()).find((v) => v.videoId === 'v1')?.isStarred).toBe(false)
    expect(await mac.db.get('SELECT 1 AS x FROM youtube_user WHERE video_id = ?', ['v1'])).toBeUndefined()
  })

  it('Q: PDF metadata, highlights and bookmarks sync; the bytes never do, and the file attaches by hash', async () => {
    const pdf = await mac.services.pdf.insert({ id: 'pdf-1', title: 'Jubilees', filename: 'pdf-1.pdf', fileSize: 1234, importedAt: clock, fileHash: 'abc' })
    tick(); await mac.services.pdf.highlightsAdd({ pdfId: pdf.id, page: 3, rects: [{ x: 0, y: 0, w: 1, h: 0.1 }], color: 'yellow', text: 'Sabbath' })
    tick(); const bm = await mac.services.pdf.bookmarksAdd(pdf.id, 7, 'Feast of Weeks')
    await syncAll(mac, phone)
    expect((await phone.services.pdf.list()).map((p) => ({ id: p.id, title: p.title, fileHash: p.fileHash }))).toEqual([{ id: 'pdf-1', title: 'Jubilees', fileHash: 'abc' }])
    expect((await phone.services.pdf.highlightsList('pdf-1')).map((h) => h.text)).toEqual(['Sabbath'])
    expect((await phone.services.pdf.bookmarksList('pdf-1')).map((b) => [b.page, b.label])).toEqual([[7, 'Feast of Weeks']])
    // the phone "imports" the same file: matched by hash, no duplicate row
    expect((await phone.services.pdf.findByHash('abc'))?.id).toBe('pdf-1')
    await phone.services.pdf.attachFile('pdf-1', 'pdf-1.pdf', 1234, 'abc')
    expect((await phone.services.pdf.list()).length).toBe(1)
    // remove the bookmark on the phone, rename on the mac → both converge
    tick(); await phone.services.pdf.bookmarksRemove(bm.id)
    tick(); await mac.services.pdf.rename('pdf-1', 'Book of Jubilees')
    await syncAll(phone, mac)
    expect((await mac.services.pdf.bookmarksList('pdf-1')).length).toBe(0)
    expect((await phone.services.pdf.get('pdf-1'))?.title).toBe('Book of Jubilees')
    // deleting the PDF on the mac removes its highlights on the phone too (cascade without events)
    tick(); await mac.services.pdf.deleteRow('pdf-1')
    await syncAll(mac, phone)
    expect(await phone.services.pdf.list()).toEqual([])
    expect(await phone.services.pdf.highlightsList('pdf-1')).toEqual([])
  })

  it('R: study trail — sessions with pauses and tags, nodes, connections; deleting a session clears its nodes everywhere', async () => {
    const t = mac.services.studyTrail
    const s1 = await t.startSession('Evening study')
    tick(); const n1 = await t.addNode({ trailSessionId: s1.id, bookId: 'GEN', chapter: 1, orderIndex: 0, anchorStartedAt: clock })
    tick(); await t.pauseSession(s1.id)
    tick(); await t.resumeSession(s1.id)
    tick(); const n2 = await t.addNode({ trailSessionId: s1.id, bookId: 'EXO', chapter: 20, orderIndex: 1, anchorStartedAt: clock })
    tick(); await t.addConnection({ trailSessionId: s1.id, fromNodeId: n1.id, toKind: 'chapter', toBookId: 'EXO', toChapter: 20, clarityTier: 1, reasonText: 'Sabbath' })
    tick(); const tag = await t.createTag('Sabbath', 'green')
    tick(); await t.setSessionTags(s1.id, [tag.id])
    tick(); await t.createNote({ trailSessionId: s1.id, kind: 'annotation', body: 'remember', anchorNodeId: n2.id } as Parameters<typeof t.createNote>[0])
    await syncAll(mac, phone)
    const remote = await phone.services.studyTrail.getSession(s1.id)
    expect(remote?.session.name).toBe('Evening study')
    expect(remote?.nodes.map((n) => [n.bookId, n.chapter])).toEqual([['GEN', 1], ['EXO', 20]])
    expect(remote?.connections.map((c) => c.reasonText)).toEqual(['Sabbath'])
    expect(remote?.pausedIntervals.length).toBe(1)
    expect(remote?.pausedIntervals[0].resumedAt).toBeDefined()
    expect((await phone.services.studyTrail.listTags()).map((x) => x.name)).toEqual(['Sabbath'])
    expect(await phone.db.all('SELECT tag_id FROM trail_tag_members WHERE trail_session_id = ?', [s1.id])).toEqual([{ tag_id: tag.id }])
    expect((await phone.services.studyTrail.listNotes(s1.id)).map((n) => n.body)).toEqual(['remember'])
    // phone deletes the tag → membership disappears on the mac; mac deletes the session → nodes/connections vanish on the phone
    tick(); await phone.services.studyTrail.deleteTag(tag.id)
    tick(); await t.deleteSession(s1.id)
    await syncAll(phone, mac)
    expect(await mac.db.all('SELECT tag_id FROM trail_tag_members')).toEqual([])
    expect(await phone.services.studyTrail.getSession(s1.id)).toBeNull()
    expect(await phone.db.all('SELECT id FROM trail_nodes')).toEqual([])
    expect(await phone.db.all('SELECT id FROM trail_connections')).toEqual([])
    expect((await phone.engine.status()).pendingOutbox).toBe(0)
  })

  it('S: AI chats sync as records; verse-tag delete cascades to members and the derived index; folder delete moves notes to the root', async () => {
    const chat = await mac.services.aiChats.saveChat({ title: 'Grace study', messages: [{ role: 'user', content: 'What is G5485?' }] as Parameters<typeof mac.services.aiChats.saveChat>[0]['messages'] })
    const folder = await mac.services.notes.folderCreate('Torah', null)
    const n = await mac.services.notes.create({ type: 'general', title: 'In folder', content: 'x' })
    await mac.services.notes.setFolder(n.note!.id, folder.id)
    await mac.services.verseTags.addMembers({ newTagNames: ['Creation'], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 5 }] }], label: 'Gen 1:1-5' })
    await syncAll(mac, phone)
    expect((await phone.services.aiChats.listChats()).map((c) => c.title)).toEqual(['Grace study'])
    expect((await phone.services.notes.getOne(n.note!.id))?.folderId).toBe(folder.id)
    const tagId = (await phone.services.verseTags.list())[0].id
    expect((await phone.db.all('SELECT verse FROM verse_tag_verse WHERE tag_id = ? ORDER BY verse', [tagId])).length).toBe(5)
    // deletions on the mac
    tick(); await mac.services.aiChats.deleteChat(chat.id)
    tick(); await mac.services.notes.folderDelete(folder.id)
    tick(); await mac.services.verseTags.delete(tagId, true)
    await syncAll(mac, phone)
    expect(await phone.services.aiChats.listChats()).toEqual([])
    expect((await phone.services.notes.getOne(n.note!.id))?.folderId ?? null).toBeNull()
    expect(await phone.services.verseTags.list()).toEqual([])
    expect(await phone.db.all('SELECT * FROM verse_tag_members')).toEqual([])
    expect(await phone.db.all('SELECT * FROM verse_tag_verse')).toEqual([])
  })
})

describe('sync engine — compaction (icloud.md §8)', () => {
  const macFiles = () => [...cloud.folder('mac').keys()].filter((k) => k !== 'manifest.json').map((k) => `mac/${k}`).concat(cloud.manifests.has('mac') ? ['mac/manifest.json'] : []).sort()

  it('V: a snapshot is written; journal files are pruned only once every other device has applied past it', async () => {
    await phone.engine.sync()   // the phone has come online once (its folder exists) but applied nothing yet
    const ids: string[] = []
    for (let i = 0; i < 3; i++) { tick(); ids.push((await mac.services.notes.create({ type: 'general', title: `N${i}`, content: `c${i}` })).note!.id) }
    await mac.engine.sync()
    expect(macFiles()).toEqual(['mac/journal-000000001-000000003.jsonl', 'mac/manifest.json'])
    // thresholds not reached → no compaction on its own
    expect(await mac.engine.compact()).toBe(false)
    // forced (as if 5,000 ops had accumulated): snapshot appears, journal stays (phone has not applied)
    expect(await mac.engine.compact(true)).toBe(true)
    expect(macFiles()).toEqual(['mac/journal-000000001-000000003.jsonl', 'mac/manifest.json', 'mac/snapshot-000000003.json'])
    expect(cloud.manifests.get('mac')?.snapshot).toMatchObject({ seq: 3, records: 3 })
    await mac.engine.sync()   // nothing to push → prune attempted → still blocked by the phone
    expect(macFiles()).toContain('mac/journal-000000001-000000003.jsonl')
    // the phone catches up and publishes applied[mac] = 3 → the next mac pass prunes
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['N0', 'N1', 'N2'])
    await mac.engine.sync()
    expect(macFiles()).toEqual(['mac/manifest.json', 'mac/snapshot-000000003.json'])
    expect(cloud.manifests.get('mac')?.files).toEqual([])
    // later edits continue in new journal files after the snapshot
    tick(); await mac.services.notes.update(ids[0], { content: 'edited after snapshot' })
    await syncAll(mac, phone)
    expect(macFiles()).toEqual(['mac/journal-000000004-000000004.jsonl', 'mac/manifest.json', 'mac/snapshot-000000003.json'])
    expect((await noteById(phone, ids[0]))!.content).toBe('edited after snapshot')
    expect((await mac.engine.status()).journal).toMatchObject({ files: 1, snapshotSeq: 3 })
  })

  it('W: a new device (or reinstall) bootstraps from the snapshot, then follows the journal; nothing newer is overwritten', async () => {
    const a = (await mac.services.notes.create({ type: 'general', title: 'Kept', content: 'from snapshot' })).note!.id
    tick(); const b = (await mac.services.notes.create({ type: 'general', title: 'Trashed later', content: 'x' })).note!.id
    tick(); await mac.services.highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow', textId: 'kjva' })
    tick(); await mac.services.notes.delete(b); tick(); await mac.services.notes.purgeTrashItem(b)   // tombstone in the snapshot (create+trash+purge coalesce into one delete op)
    await mac.engine.sync()
    await phone.engine.sync()                                   // phone applied everything → prune allowed
    expect(await mac.engine.compact(true)).toBe(true)
    await mac.engine.sync()
    expect(macFiles()).toEqual(['mac/manifest.json', 'mac/snapshot-000000003.json'])
    expect(cloud.manifests.get('mac')?.snapshot).toMatchObject({ seq: 3, records: 3 })
    tick(); await mac.services.notes.update(a, { content: 'journal after snapshot' })
    await mac.engine.sync()
    // third device joins with its own newer edit of a note that also exists in the snapshot
    const ipad = await makeDevice('ipad', 'ios')
    tick(); await ipad.services.notes.create({ type: 'general', title: 'Kept', content: 'ipad copy' })
    await ipad.engine.sync(); await ipad.engine.sync()
    expect((await noteById(ipad, a))!.content).toBe('journal after snapshot')     // snapshot then journal
    expect(await noteById(ipad, b)).toBeNull()                                    // tombstone honoured
    expect(Object.keys(await ipad.services.highlights.getChapter('GEN', 1, 'kjva'))).toEqual(['1'])
    expect((await noteTitles(ipad)).filter((t) => t === 'Kept').length).toBe(2)   // its own note untouched
    expect((await ipad.engine.status()).devices.map((d) => d.name).sort()).toEqual(['ipad', 'mac', 'phone'])
    expect((await ipad.engine.status()).lastError ?? null).toBeNull()
    // re-running the bootstrap is a no-op
    const before = await ipad.db.all('SELECT * FROM notes ORDER BY id')
    await ipad.engine.sync()
    expect(await ipad.db.all('SELECT * FROM notes ORDER BY id')).toEqual(before)
  })

  it('X: a device silent for 90 days no longer blocks pruning', async () => {
    tick(); await mac.services.notes.create({ type: 'general', title: 'A', content: 'a' })
    await mac.engine.sync()
    await phone.engine.sync()                                    // phone's manifest: applied[mac] = 1, updatedAt = now
    tick(); await mac.services.notes.create({ type: 'general', title: 'B', content: 'b' })
    await mac.engine.sync()
    expect(await mac.engine.compact(true)).toBe(true)
    expect(macFiles()).toContain('mac/journal-000000002-000000002.jsonl')   // phone only applied up to 1
    clock += 91 * 24 * 60 * 60 * 1000
    await mac.engine.sync()
    expect(macFiles()).toEqual(['mac/manifest.json', 'mac/snapshot-000000002.json'])
    // the silent phone comes back: it bootstraps from the snapshot and is complete again
    await phone.engine.sync()
    expect(await noteTitles(phone)).toEqual(['A', 'B'])
  })
})

declare module '../stores/memorySyncStore' {
  interface MemoryCloud { readManifestSeq(device: string): Promise<number> }
}
MemoryCloud.prototype.readManifestSeq = async function (device: string) { return this.manifests.get(device)?.seq ?? 0 }
