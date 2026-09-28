import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { openNodeSqlite } from '../../../../electron/db/adapters/nodeSqliteAdapter'
import { createServices, type Services } from '../../services'
import { consoleLogger, type ServiceContext } from '../../services/context'
import { BEREAN_SCHEMA_VERSION } from '../../db/bereanMigrations'
import { SyncEngine } from '../engine'
import { MemoryCloud, MemorySyncStore } from '../stores/memorySyncStore'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

/**
 * Multi-device simulation over the REAL services, schema and engine (only the transport is the
 * in-memory iCloud Drive model): any number of logical devices, offline / online, restarts,
 * reinstalls (a fresh database), restored backups (a copy of an older database), account
 * switches (another cloud). Used by the data-safety scenarios and the chaos suite.
 */
export interface SimDevice {
  name: string
  db: DatabaseAdapter
  services: Services
  store: MemorySyncStore
  engine: SyncEngine
  cloud: MemoryCloud
  opts: DeviceOpts
}
export interface DeviceOpts { accountIdentity?: string | null; storageIdentity?: string | null; appVersion?: string; databaseProblem?: string | null }

export class Sim {
  clock = 1_700_000_000_000
  cloud = new MemoryCloud()
  private ids = 0
  private uuids = 0
  /** Deterministic ids, so a seed reproduces a scenario exactly. */
  uuid = (): string => `00000000-0000-4000-8000-${(++this.uuids).toString(16).padStart(12, '0')}`
  constructor() { MemorySyncStore.all.clear() }
  tick(ms = 1000): number { this.clock += ms; return this.clock }

  /** A new install (fresh, migrated database) — or an existing database (`db`: a restore / copy). */
  async device(name: string, o: DeviceOpts & { db?: DatabaseAdapter; cloud?: MemoryCloud } = {}): Promise<SimDevice> {
    const db = o.db ?? await migratedUserDb(name)
    return this.open(name, db, o.cloud ?? this.cloud, o)
  }

  private async open(name: string, db: DatabaseAdapter, cloud: MemoryCloud, o: DeviceOpts): Promise<SimDevice> {
    const rec = recordingEvents()
    const ctx: ServiceContext = {
      userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null,
      events: rec.events, now: () => this.clock, uuid: this.uuid, isDev: true, log: consoleLogger,
    }
    const services = createServices(ctx)
    const { deviceId } = await SyncEngine.resolveDeviceId(db, {
      newId: () => `${name}${++this.ids}`,
      storageIdentity: o.storageIdentity ?? null,
      peekManifest: (id) => cloud.device(id).readManifest(id),
    })
    const store = cloud.device(deviceId)
    MemorySyncStore.all.add(store)
    const quiet = { info: () => {}, warn: () => {}, error: () => {} }
    const engine = await SyncEngine.open({
      db, store, events: rec.events, deviceId, deviceName: name, platform: 'ios', appVersion: o.appVersion ?? '1.0', schema: BEREAN_SCHEMA_VERSION,
      log: quiet, now: () => this.clock, uuid: this.uuid, accountIdentity: o.accountIdentity ?? null, databaseProblem: o.databaseProblem ?? null,
    })
    engine.start()
    if (!o.databaseProblem) { await engine.adoptExisting(); await engine.republishIfRequested() }
    await engine.reconcileLocal()
    return { name, db, services, store, engine, cloud, opts: o }
  }

  /** App relaunch on the same database (optionally with changed options, e.g. another account). */
  async restart(d: SimDevice, o: Partial<DeviceOpts> & { cloud?: MemoryCloud } = {}): Promise<SimDevice> {
    d.engine.stop()
    MemorySyncStore.all.delete(d.store)
    return this.open(d.name, d.db, o.cloud ?? d.cloud, { ...d.opts, ...o })
  }

  /** A consistent copy of a device's database as it is now (a backup to restore later). */
  async backup(d: SimDevice): Promise<DatabaseAdapter> {
    const file = join(mkdtempSync(join(tmpdir(), 'berean-sim-')), 'backup.db')
    await d.db.run('VACUUM INTO ?', [file])
    return openNodeSqlite(file, `${d.name}-backup`)
  }

  async syncAll(devices: SimDevice[], rounds = 3): Promise<void> {
    for (let r = 0; r < rounds; r++) for (const d of devices) await d.engine.sync()
  }
}

/** Every op ever written to the cloud (all devices), for "was anything deleted?" assertions. */
export function allCloudOps(cloud: MemoryCloud): Array<{ device: string; op: string; entity: string; key: string }> {
  const out: Array<{ device: string; op: string; entity: string; key: string }> = []
  for (const [device, folder] of cloud.folders) {
    for (const [name, text] of folder) {
      if (!name.startsWith('journal-')) continue
      for (const line of text.split('\n')) if (line.trim()) { const o = JSON.parse(line); out.push({ device, op: o.op, entity: o.entity, key: o.key }) }
    }
  }
  return out
}

/** The user-visible synced state of a device, for convergence checks. */
export async function userState(d: SimDevice): Promise<Record<string, unknown>> {
  const q = (sql: string) => d.db.all<Record<string, unknown>>(sql)
  return {
    notes: await q('SELECT id, title, content, deleted_at, pinned, folder_id, color, status FROM notes ORDER BY id'),
    folders: await q('SELECT id, name, parent_id FROM note_folders ORDER BY id'),
    highlights: await q('SELECT id, color FROM highlights ORDER BY id'),
    tags: await q('SELECT id, name FROM verse_tags ORDER BY id'),
    conflictCopies: await q("SELECT id, note_id, content FROM note_versions WHERE kind = 'conflict' ORDER BY id"),
  }
}
