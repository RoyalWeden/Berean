import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migratedUserDb, recordingEvents } from '../../../src/platform/db/__tests__/testDb'
import { createServices } from '../../../src/platform/services'
import { consoleLogger, defaultUuid, type ServiceContext } from '../../../src/platform/services/context'
import { BEREAN_SCHEMA_VERSION } from '../../../src/platform/db/bereanMigrations'
import { SyncEngine } from '../../../src/platform/sync/engine'
import { FsSyncStore } from '../fsSyncStore'

/** The engine over the REAL filesystem transport: two devices sharing one folder, as iCloud
 *  Drive presents it on both machines. */
let root: string
let clock = 1_700_000_000_000
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'berean-fs-sync-')); clock = 1_700_000_000_000 })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

async function device(name: string) {
  const db = await migratedUserDb(name)
  const rec = recordingEvents()
  const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: rec.events, now: () => clock, uuid: defaultUuid, isDev: true, log: consoleLogger }
  const services = createServices(ctx)
  const store = new FsSyncStore(root, name)
  const engine = await SyncEngine.open({ db, store, events: rec.events, deviceId: name, deviceName: name, platform: 'darwin', appVersion: '0', schema: BEREAN_SCHEMA_VERSION, log: { info() {}, warn() {}, error() {} }, now: () => clock, uuid: defaultUuid })
  engine.start()
  return { db, services, engine, store }
}

describe('sync over FsSyncStore', () => {
  it('propagates notes, tags and tabs both ways through journal files on disk and preserves note conflicts', async () => {
    const mac = await device('mac')
    const phone = await device('phone')
    const n = await mac.services.notes.create({ type: 'general', title: 'Disk', content: 'v1' })
    await mac.services.verseTags.addMembers({ newTagNames: ['Sabbath'], ranges: [{ bookId: 'EXO', chapter: 20, spans: [{ s: 8, e: 11 }] }], label: 'Exo 20:8-11' })
    await mac.services.sessions.applySnapshot({ sessions: [{ id: 's', name: 'S', icon: null, tab_filter: null, order_key: 'a0' }], tabs: [{ id: 't', session_id: 's', space_id: 'scripture', type: 'bible', title: 'Exo 20', is_pinned: 0, order_key: 'a0', display_order_key: 'a0', origin_tab_id: null, origin_space_id: null, sync_state_json: '{"bookId":"EXO","chapter":20}', local_state_json: '{"scrollPosition":77}' }], archivedGroups: [] })
    await mac.engine.sync()
    expect(readdirSync(join(root, 'devices', 'mac')).sort()).toEqual(['journal-000000001-000000005.jsonl', 'manifest.json'])
    await phone.engine.sync()
    expect((await phone.services.notes.getOne(n.note!.id))!.content).toBe('v1')
    expect((await phone.services.verseTags.list()).map((t) => t.name)).toEqual(['Sabbath'])
    const tab = (await phone.services.sessions.listTabs('s'))[0]
    expect(JSON.parse(tab.sync_state_json)).toEqual({ bookId: 'EXO', chapter: 20 })
    expect(tab.local_state_json).toBe('{}')   // device-local state never crossed the wire
    // concurrent edit through files
    clock += 1000; await mac.services.notes.update(n.note!.id, { content: 'mac' })
    clock += 1000; await phone.services.notes.update(n.note!.id, { content: 'phone' })
    await mac.engine.sync(); await phone.engine.sync(); await mac.engine.sync(); await phone.engine.sync()
    expect((await mac.services.notes.getOne(n.note!.id))!.content).toBe('phone')
    expect((await phone.services.notes.getOne(n.note!.id))!.content).toBe('phone')
    expect((await mac.services.notes.getVersions(n.note!.id)).map((v) => v.content)).toEqual(['mac'])
    expect((await phone.services.notes.getVersions(n.note!.id)).map((v) => v.content)).toEqual(['mac'])
    const status = await phone.engine.status()
    expect(status.devices.map((d) => d.name).sort()).toEqual(['mac', 'phone'])
    expect(status.pendingOutbox).toBe(0)
  })
})
