import { SyncEngine } from '../sync/engine'
import type { SyncStatusSnapshot } from '../sync/types'
import { createSyncHostCore, type SyncHostCore } from '../sync/hostCore'
import { createSyncTrace } from '../sync/trace'
import { BEREAN_SCHEMA_VERSION, checkDatabase } from '../db/bereanMigrations'
import { CloudSyncStore } from './cloudSyncStore'
import { BereanCloud, BereanSQLite } from './plugins'
import { iosServices, iosServiceContext } from './services'
import type { SyncConfig } from '../../types/electron'

/**
 * iOS host for the sync engine — the in-process counterpart of electron/sync/host.ts. Same
 * settings keys (`icloudSyncEnabled`), same device-id rule (random 16-hex, kept in
 * `sync_state`), same lifecycle through the shared `createSyncHostCore` (DATA-SYNC-007):
 *   - a captured local change wakes a sync after a short debounce (outbound is event-driven);
 *   - the container watch (NSMetadataQuery in BereanCloud, which also requests the downloads)
 *     wakes a sync (inbound is event-driven);
 *   - foreground and `online` wake a sync; backgrounding pushes;
 *   - a 60 s interval remains as a safety net only.
 * `installIosSyncBridge` exposes it as `window.sync`, the surface Settings → iCloud and the
 * shell's invalidation hook (sync.onApplied → lib/syncInvalidation) use.
 *
 * No folder picker on iOS (the ubiquity container is the only place iOS can sync through —
 * `chooseFolder` reports `canceled`), and the container is addressed by id, never by path.
 */
const DEFAULT_CONTAINER = 'iCloud.com.berean.app'
const TRACE_KEY = 'berean:syncTrace'

let engine: SyncEngine | null = null
let store: CloudSyncStore | null = null
let core: SyncHostCore | null = null
let lastStatus: SyncStatusSnapshot | null = null
const statusListeners = new Set<(s: SyncStatusSnapshot | null) => void>()
const appliedListeners = new Set<(entities: string[]) => void>()

const trace = createSyncTrace({
  enabled: (() => { try { return localStorage.getItem(TRACE_KEY) === '1' } catch { return false } })(),
  log: (line) => console.log(line),
})
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function setting<T>(key: string): Promise<T | null> {
  return (await iosServices().settings.get(key)) as T | null
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

function publish(s: SyncStatusSnapshot | null): void {
  lastStatus = s
  for (const cb of statusListeners) cb(s)
}
async function publishStatus(): Promise<void> {
  if (!engine) { publish(null); return }
  try { publish(await engine.status()) } catch (err) { console.warn('[sync] status failed', errText(err)) }
}

/**
 * Start the engine. Capture is independent of the transport (DATA-SYNC-001): once sync is
 * enabled, every local change is journaled to the SQLite outbox whether or not iCloud is
 * reachable right now; push / pull report "unavailable" and retry. Only turning sync ON requires
 * iCloud to be available (`requireAvailable`). `reconcile`: 'full' after sync was off, otherwise
 * the cheap watermark pass that also covers a kill between a write and its capture.
 */
async function startEngine(opts: { requireAvailable: boolean; reconcile: 'full' | 'since-last' }): Promise<{ ok: boolean; reason?: string }> {
  if (engine) return { ok: true }
  const cloud = await BereanCloud.status().catch((err: unknown) => ({ available: false, signedIn: false, reason: String(err), containerId: DEFAULT_CONTAINER, deviceName: '' }))
  if (opts.requireAvailable && !cloud.available) return { ok: false, reason: cloud.reason ?? 'iCloud unavailable' }
  const userDb = iosServiceContext().userDb
  // Data-safety gates (docs/mobile/sync.md "Data safety"):
  //  - integrity: a damaged berean.db holds sync instead of being read as "records deleted";
  //  - identity: a restored / copied berean.db gets a fresh device id (DATA-SAFE-030);
  //  - account: the database remembers which iCloud account it synced with (DATA-SAFE-040).
  const health = await checkDatabase(userDb)
  if (!health.ok) console.error('[sync] berean.db failed its integrity check — sync held', health.detail)
  const file = await BereanSQLite.fileInfo({ path: 'appsupport:berean.db' }).catch(() => null)
  const { deviceId, forked } = await SyncEngine.resolveDeviceId(userDb, {
    newId: () => randomHex(8),
    storageIdentity: file?.created ? `ios:${file.created}` : null,
    peekManifest: cloud.available ? (id) => new CloudSyncStore(id).readManifest(id) : undefined,
    log: { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) },
  })
  if (forked) console.warn(`[sync] this database was restored or copied (${forked}) — syncing as a new device`)
  store = new CloudSyncStore(deviceId)
  if (opts.requireAvailable) {
    const st = await store.status()
    if (!st.available) { store = null; return { ok: false, reason: st.reason } }
  }
  engine = await SyncEngine.open({
    accountIdentity: cloud.available ? (cloud as { identity?: string }).identity ?? null : null,
    databaseProblem: health.ok ? null : health.detail,
    db: userDb, store, events: iosServiceContext().events, deviceId,
    deviceName: cloud.deviceName || 'iPhone', platform: 'ios',
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0', schema: BEREAN_SCHEMA_VERSION,
    // Ids and entity names only — never note content (the engine logs nothing else).
    log: { info: (m) => console.log(m), warn: (m, ...r) => console.warn(m, ...r.map(errText)), error: (m, ...r) => console.error(m, ...r.map(errText)) },
    onApplied: (entities) => {
      trace.record('ui:invalidate', { entities: [...entities].sort().join(',') })
      for (const cb of appliedListeners) cb([...entities])
    },
    trace,
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  })
  engine.start()
  if (health.ok) {
    const adopted = await engine.adoptExisting()
    if (adopted) console.log(`[sync] adopted ${adopted} existing records`)
    const republished = await engine.republishIfRequested()
    if (republished) console.log(`[sync] republished ${republished} records`)
  }
  try {
    const n = await engine.reconcileLocal(opts.reconcile === 'full')
    if (n) console.log(`[sync] reconciled ${n} local change(s) not captured before`)
  } catch (err) { console.warn('[sync] local reconciliation failed', errText(err)) }
  accountAtStart = cloud.available ? (cloud as { identity?: string }).identity ?? null : null
  core = createSyncHostCore({
    engine, store, trace, onStatus: publish, log: { error: (m, ...r) => console.error(m, ...r.map(errText)) },
    // A copy / rollback detected while running: reopen, which forks the device id.
    onForkDetected: () => { void restartEngine('fork') },
  })
  core.requestSync('start')
  return { ok: true }
}

let accountAtStart: string | null = null

async function restartEngine(reason: string): Promise<void> {
  console.warn(`[sync] restarting the engine (${reason})`)
  stopEngine()
  const r = await startEngine({ requireAvailable: false, reconcile: 'since-last' })
  if (!r.ok) console.warn(`[sync] not restarted: ${r.reason}`)
  await publishStatus()
}

/** iCloud account changed while running (NSUbiquityIdentityDidChange — checked on foreground):
 *  reopen, so the engine compares the new identity and holds if it is another account. */
async function checkAccount(): Promise<void> {
  if (!engine) return
  const cloud = await BereanCloud.status().catch(() => null)
  const identity = cloud?.available ? (cloud as { identity?: string }).identity ?? null : null
  if (identity && accountAtStart && identity !== accountAtStart) await restartEngine('iCloud account changed')
}

function stopEngine(): void {
  core?.stop(); core = null
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
    if (!core) return
    if (document.visibilityState === 'visible') { void checkAccount(); core?.requestSync('foreground') }
    else void core.pushNow('background')
  })
  window.addEventListener('online', () => core?.requestSync('online'))
  window.addEventListener('offline', () => { void publishStatus() })
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
    syncNow: async () => {
      if (!core) return lastStatus
      core.requestSync('manual')
      await core.idle()
      return lastStatus
    },
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
    resolveHold: async (choice) => {
      if (!engine) return { ok: false, reason: 'sync is off' }
      if (choice === 'republish') {
        await engine.resolveHold('republish')
        await restartEngine('republish')
        return { ok: true }
      }
      await engine.resolveQuarantine(choice)
      core?.requestSync('hold-resolved')
      await core?.idle()
      await publishStatus()
      return { ok: true }
    },
    chooseFolder: async () => ({ canceled: true }),
    useDefaultFolder: async () => ({ ok: true }),
    onStatus: (cb) => { statusListeners.add(cb); return () => { statusListeners.delete(cb) } },
    onApplied: (cb) => { appliedListeners.add(cb); return () => { appliedListeners.delete(cb) } },
    getTrace: async () => ({ enabled: trace.enabled(), entries: trace.entries() }),
    setDiagnostics: async (on) => {
      trace.setEnabled(on)
      try { localStorage.setItem(TRACE_KEY, on ? '1' : '0') } catch { /* private mode */ }
      if (!on) trace.clear()
    },
  }
  window.sync = sync
}

/** Test/inspection hook. */
export function __iosSyncEngine(): SyncEngine | null { return engine }
