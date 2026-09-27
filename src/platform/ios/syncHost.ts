import { SyncEngine } from '../sync/engine'
import type { SyncStatusSnapshot } from '../sync/types'
import { BEREAN_SCHEMA_VERSION } from '../db/bereanMigrations'
import { CloudSyncStore } from './cloudSyncStore'
import { BereanCloud } from './plugins'
import { iosServices, iosServiceContext } from './services'
import type { SyncConfig } from '../../types/electron'

/**
 * iOS host for the sync engine — the in-process counterpart of electron/sync/host.ts. Same
 * settings keys (`icloudSyncEnabled`), same device-id rule (random 16-hex, kept in
 * `sync_state`), same triggers: start, container change notifications, a 60 s interval, the app
 * coming back to the foreground, and a push when it goes to the background. `installIosSyncBridge`
 * exposes it as `window.sync`, the surface Settings → iCloud and App.tsx already use.
 *
 * Differences from desktop, by design: there is no folder picker (the ubiquity container is the
 * only place iOS can sync through — `chooseFolder` reports `canceled`), and the container is
 * addressed by id, never by path.
 */
const DEFAULT_CONTAINER = 'iCloud.com.berean.app'
const INTERVAL_MS = 60_000

let engine: SyncEngine | null = null
let store: CloudSyncStore | null = null
let timer: ReturnType<typeof setInterval> | null = null
let unwatch: (() => void) | null = null
let lastStatus: SyncStatusSnapshot | null = null
const statusListeners = new Set<(s: SyncStatusSnapshot | null) => void>()
const appliedListeners = new Set<(entities: string[]) => void>()

async function setting<T>(key: string): Promise<T | null> {
  return (await iosServices().settings.get(key)) as T | null
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function deviceIdFor(): Promise<string> {
  const row = await iosServiceContext().userDb.get<{ value: string }>("SELECT value FROM sync_state WHERE key = 'device_id'")
  return row?.value ?? randomHex(8)
}

async function publishStatus(): Promise<void> {
  if (!engine) { lastStatus = null }
  else {
    try { lastStatus = await engine.status() } catch (err) { console.warn('[sync] status failed', err) }
  }
  for (const cb of statusListeners) cb(lastStatus)
}

async function syncNow(reason: string): Promise<void> {
  if (!engine) return
  try {
    await engine.sync()
  } catch (err) {
    console.error(`[sync] sync (${reason}) failed`, err)
  } finally {
    await publishStatus()
  }
}

/**
 * Start the engine. Capture is independent of the transport (DATA-SYNC-001): once sync is
 * enabled, every local change is journaled to the SQLite outbox whether or not iCloud is
 * reachable right now (signed out, container not ready, offline start); push / pull simply
 * report "unavailable" and retry on the interval, foreground and container triggers. Only turning
 * sync ON requires iCloud to be available (`requireAvailable`), so the user gets a clear answer.
 * `reconcile`: 'full' after sync was off (changes made meanwhile were never captured), otherwise
 * the cheap watermark pass that also covers a kill between a write and its capture.
 */
async function startEngine(opts: { requireAvailable: boolean; reconcile: 'full' | 'since-last' }): Promise<{ ok: boolean; reason?: string }> {
  if (engine) return { ok: true }
  const cloud = await BereanCloud.status().catch((err: unknown) => ({ available: false, signedIn: false, reason: String(err), containerId: DEFAULT_CONTAINER, deviceName: '' }))
  if (opts.requireAvailable && !cloud.available) return { ok: false, reason: cloud.reason ?? 'iCloud unavailable' }
  const deviceId = await deviceIdFor()
  store = new CloudSyncStore(deviceId)
  if (opts.requireAvailable) {
    const st = await store.status()
    if (!st.available) { store = null; return { ok: false, reason: st.reason } }
  }
  engine = await SyncEngine.open({
    db: iosServiceContext().userDb, store, events: iosServiceContext().events, deviceId,
    deviceName: cloud.deviceName || 'iPhone', platform: 'ios',
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0', schema: BEREAN_SCHEMA_VERSION,
    log: { info: (m, ...r) => console.log(m, ...r), warn: (m, ...r) => console.warn(m, ...r), error: (m, ...r) => console.error(m, ...r) },
    onApplied: (entities) => { for (const cb of appliedListeners) cb([...entities]) },
  })
  engine.start()
  const adopted = await engine.adoptExisting()
  if (adopted) console.log(`[sync] adopted ${adopted} existing records`)
  try {
    const n = await engine.reconcileLocal(opts.reconcile === 'full')
    if (n) console.log(`[sync] reconciled ${n} local change(s) not captured before`)
  } catch (err) { console.warn('[sync] local reconciliation failed', err) }
  unwatch = store.watch((() => { void syncNow('watch') }))
  timer = setInterval(() => { void syncNow('interval') }, INTERVAL_MS)
  void syncNow('start')
  return { ok: true }
}

function stopEngine(): void {
  if (timer) { clearInterval(timer); timer = null }
  unwatch?.(); unwatch = null
  engine?.stop()
  engine = null
  store = null
  lastStatus = null
}

let lifecycleInstalled = false
function installLifecycle(): void {
  if (lifecycleInstalled) return
  lifecycleInstalled = true
  document.addEventListener('visibilitychange', () => {
    if (!engine) return
    if (document.visibilityState === 'visible') void syncNow('foreground')
    else void engine.push().catch(() => {})
  })
}

/** Starts the engine if the user enabled sync earlier; safe to call once at boot. */
export async function initIosSyncHost(): Promise<void> {
  installLifecycle()
  if ((await setting<boolean>('icloudSyncEnabled')) === true) {
    const r = await startEngine({ requireAvailable: false, reconcile: 'since-last' })
    if (!r.ok) console.warn(`[sync] not started: ${r.reason}`)
  }
}

export function installIosSyncBridge(): void {
  const sync: Window['sync'] = {
    getStatus: async () => (engine ? engine.status() : null),
    getConfig: async (): Promise<SyncConfig> => {
      const cloud = await BereanCloud.status().catch((err: unknown) => ({ available: false, signedIn: false, reason: String(err), containerId: DEFAULT_CONTAINER, deviceName: '' }))
      return {
        enabled: (await setting<boolean>('icloudSyncEnabled')) === true,
        folder: cloud.available ? `iCloud Drive › Berean › sync/v1` : '(iCloud Drive container)',
        folderOverride: null,
        containerId: cloud.containerId || DEFAULT_CONTAINER,
        containerExists: cloud.available,
        running: !!engine,
      }
    },
    syncNow: async () => { await syncNow('manual'); return lastStatus },
    enable: async () => {
      const r = await startEngine({ requireAvailable: true, reconcile: 'full' })
      if (r.ok) await iosServices().settings.set('icloudSyncEnabled', true)
      return r
    },
    disable: async () => {
      stopEngine()
      await iosServices().settings.set('icloudSyncEnabled', false)
      await publishStatus()
      return { ok: true }
    },
    chooseFolder: async () => ({ canceled: true }),
    useDefaultFolder: async () => ({ ok: true }),
    onStatus: (cb) => { statusListeners.add(cb); return () => { statusListeners.delete(cb) } },
    onApplied: (cb) => { appliedListeners.add(cb); return () => { appliedListeners.delete(cb) } },
  }
  window.sync = sync
}

/** Test/inspection hook. */
export function __iosSyncEngine(): SyncEngine | null { return engine }
