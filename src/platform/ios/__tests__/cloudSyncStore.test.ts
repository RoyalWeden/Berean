import { describe, it, expect } from 'vitest'
import { CloudSyncStore } from '../cloudSyncStore'
import type { BereanCloudPlugin, CloudChange, CloudEntry } from '../plugins'
import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices } from '../../services'
import { consoleLogger, defaultUuid, type ServiceContext } from '../../services/context'
import { BEREAN_SCHEMA_VERSION } from '../../db/bereanMigrations'
import { SyncEngine } from '../../sync/engine'

/**
 * A fake of the BereanCloud native plugin: one "container" shared by every device, with the
 * behaviours the real one has — files exist remotely before they are downloaded locally
 * (`downloading`), and change notifications for other devices' writes.
 */
class FakeContainer {
  files = new Map<string, string>()
  /** paths a given device has not "downloaded" yet */
  evicted = new Map<string, Set<string>>()
  listeners = new Map<string, Array<(c: CloudChange) => void>>()
  available = true
  reason?: string

  plugin(device: string): BereanCloudPlugin {
    const self = this
    if (!self.evicted.has(device)) self.evicted.set(device, new Set())
    const notDownloaded = () => self.evicted.get(device)!
    return {
      async status() { return self.available ? { available: true, signedIn: true, containerId: 'iCloud.test', deviceName: device } : { available: false, signedIn: false, reason: self.reason, containerId: 'iCloud.test', deviceName: device } },
      async mkdir() { /* dirs are implicit */ },
      async list({ path }) {
        const prefix = path.replace(/\/$/, '') + '/'
        const entries = new Map<string, CloudEntry>()
        for (const p of self.files.keys()) {
          if (!p.startsWith(prefix)) continue
          const rest = p.slice(prefix.length)
          const name = rest.split('/')[0]
          entries.set(name, { name, isDir: rest.includes('/'), downloaded: !notDownloaded().has(p) })
        }
        return { entries: [...entries.values()] }
      },
      async read({ path }) {
        if (!self.files.has(path)) return { exists: false, downloading: false, text: null }
        if (notDownloaded().has(path)) { setTimeout(() => notDownloaded().delete(path), 0); return { exists: true, downloading: true, text: null } }
        return { exists: true, downloading: false, text: self.files.get(path)! }
      },
      async write({ path, text }) {
        self.files.set(path, text)
        for (const [d, s] of self.evicted) if (d !== device) s.add(path)   // other devices see it before it is local
        for (const [d, cbs] of self.listeners) if (d !== device) for (const cb of cbs) cb({ paths: [path], initial: false })
      },
      async remove({ path }) { self.files.delete(path) },
      async startWatching() {},
      async stopWatching() {},
      async pendingUploads() { return { count: 0 } },
      async addListener(_e, cb) {
        const arr = self.listeners.get(device) ?? []
        arr.push(cb); self.listeners.set(device, arr)
        return { remove: async () => { self.listeners.set(device, (self.listeners.get(device) ?? []).filter((f) => f !== cb)) } }
      },
    }
  }
}

let clock = 1_700_000_000_000
async function device(name: string, container: FakeContainer) {
  const db = await migratedUserDb(name)
  const rec = recordingEvents()
  const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: rec.events, now: () => clock, uuid: defaultUuid, isDev: true, log: consoleLogger }
  const services = createServices(ctx)
  const store = new CloudSyncStore(name, container.plugin(name))
  const engine = await SyncEngine.open({ db, store, events: rec.events, deviceId: name, deviceName: name, platform: 'ios', appVersion: '0', schema: BEREAN_SCHEMA_VERSION, log: { info() {}, warn() {}, error() {} }, now: () => clock, uuid: defaultUuid })
  engine.start()
  return { db, services, engine, store }
}

describe('CloudSyncStore', () => {
  it('reports plugin unavailability as a store status, not an exception', async () => {
    const c = new FakeContainer(); c.available = false; c.reason = 'not signed in'
    const store = new CloudSyncStore('a', c.plugin('a'))
    expect(await store.status()).toEqual({ available: false, reason: 'not signed in' })
    expect(await store.listDevices()).toEqual(['a'])
  })

  it('returns null for a file iCloud has not downloaded yet and the content once it has', async () => {
    const c = new FakeContainer()
    const a = new CloudSyncStore('a', c.plugin('a'))
    const b = new CloudSyncStore('b', c.plugin('b'))
    await a.writeOwnFile('journal-000000001-000000001.jsonl', '{"x":1}\n')
    expect(await b.readFile('a', 'journal-000000001-000000001.jsonl')).toBeNull()
    await new Promise((r) => setTimeout(r, 1))
    expect(await b.readFile('a', 'journal-000000001-000000001.jsonl')).toBe('{"x":1}\n')
    expect(await b.readManifest('a')).toBeNull()                        // missing manifest → null, no throw
    await expect(b.readFile('a', 'nope.jsonl')).rejects.toThrow('ENOENT')
  })

  it('watch fires only for other devices\' files, debounced', async () => {
    const c = new FakeContainer()
    const a = new CloudSyncStore('a', c.plugin('a'))
    const b = new CloudSyncStore('b', c.plugin('b'))
    let fired = 0
    const stop = b.watch(() => { fired++ })
    await new Promise((r) => setTimeout(r, 1))
    await b.writeOwnFile('manifest.json', '{}')          // own write: a's listener fires, b's must not
    await a.writeOwnFile('manifest.json', '{}')
    await a.writeOwnFile('journal-000000001-000000001.jsonl', '')
    await new Promise((r) => setTimeout(r, 1700))
    expect(fired).toBe(1)
    stop()
    await a.writeOwnFile('journal-000000002-000000002.jsonl', '')
    await new Promise((r) => setTimeout(r, 1700))
    expect(fired).toBe(1)
  }, 10_000)

  it('the engine syncs two devices through the container, waiting out not-yet-downloaded files', async () => {
    const c = new FakeContainer()
    const phone = await device('phone', c)
    const mac = await device('mac', c)
    const n = await phone.services.notes.create({ type: 'general', title: 'From phone', content: 'hello' })
    await phone.services.highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow', textId: 'kjva' })
    await phone.engine.sync()
    // Each pull on the mac finds the next file "in iCloud" but not local yet, asks for it and
    // stops at the gap without error; the following pull (triggered in real life by the
    // download-complete metadata update) continues: manifest, then the journal file.
    await mac.engine.sync()
    expect(await mac.services.notes.getOne(n.note!.id)).toBeNull()
    expect((await mac.engine.status()).lastError ?? null).toBeNull()
    let rounds = 1
    while (!(await mac.services.notes.getOne(n.note!.id)) && rounds < 5) { await new Promise((r) => setTimeout(r, 1)); await mac.engine.sync(); rounds++ }
    expect(rounds).toBe(3)
    expect((await mac.services.notes.getOne(n.note!.id))?.content).toBe('hello')
    expect(Object.keys(await mac.services.highlights.getChapter('GEN', 1, 'kjva'))).toEqual(['1'])
    const st = await mac.engine.status()
    expect(st.devices.map((d) => d.name).sort()).toEqual(['mac', 'phone'])
    expect(st.lastError ?? null).toBeNull()
  })
})
