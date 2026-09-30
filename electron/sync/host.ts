import { app, BrowserWindow, ipcMain, net, powerMonitor } from 'electron'
import { homedir, hostname, userInfo } from 'os'
import { existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import log from 'electron-log'
import { services, serviceContext } from '../services'
import { SyncEngine } from '../../src/platform/sync/engine'
import { BEREAN_SCHEMA_VERSION, checkDatabase } from '../../src/platform/db/bereanMigrations'
import { FsSyncStore, ubiquityContainerPath } from './fsSyncStore'
import { pickFolder } from '../mac/folderAccess'
import { isMasSandbox, masContainerRoot, masStartDownloading } from './macContainer'
import { APP_IDENTITY, identityProblem } from '../appIdentity'
import { isForeignContainerPath } from '../../src/platform/appIdentity'
import type { SyncStatusSnapshot } from '../../src/platform/sync/types'
import { createSyncHostCore, type SyncHostCore } from '../../src/platform/sync/hostCore'
import { createSyncTrace } from '../../src/platform/sync/trace'

/**
 * Desktop host for the sync engine (docs/mobile/icloud.md; docs/mobile/architecture.md §6).
 * Runs in the main process next to the services: captures every local change, pushes/pulls the
 * iCloud Drive folder on an interval, on folder changes, on wake and before quit, and tells every
 * window what it applied so the UI refreshes.
 *
 * Settings (settings table): `icloudSyncEnabled` (boolean), `icloudSyncFolder` (string | null —
 * overrides the container path).
 *
 * The container is fixed by the app identity (config/app-identity.json): Berean syncs only through
 * iCloud.com.berean.app, Berean Dev only through iCloud.com.berean.app.dev. The retired
 * `icloudContainerId` setting is ignored, a custom folder inside the other identity's container is
 * refused, and a sync folder claimed by the other identity is refused (FsSyncStore identity file).
 */
const CONTAINER = APP_IDENTITY.cloudContainer

let engine: SyncEngine | null = null
let store: FsSyncStore | null = null
let core: SyncHostCore | null = null
let lastStatus: SyncStatusSnapshot | null = null
// Diagnostic log (metadata only, DATA-SYNC-006); toggled from Settings → iCloud (setting key).
const trace = createSyncTrace({ log: (line) => log.info(line) })

async function setting<T>(key: string): Promise<T | null> {
  return (await services().settings.get(key)) as T | null
}

// Mac App Store build: the container root as returned by the system (docs/mac-app-store.md §3).
let masRoot: { id: string; root: string } | null = null

export function resolveSyncFolder(override: string | null): string {
  if (override) return override
  const id = CONTAINER
  if (masRoot && masRoot.id === id) return `${masRoot.root}/Documents/sync/v1`
  // DMG build (not sandboxed): the container by path. In the MAS build before the container is
  // resolved (iCloud signed out) this points at the real home, never the sandbox container, so the
  // "iCloud folder not found" message names the right place.
  const home = isMasSandbox() ? realHome() : homedir()
  return `${ubiquityContainerPath(id, home)}/sync/v1`
}

function realHome(): string {
  try { return userInfo().homedir } catch { return homedir() }
}

/**
 * MAS build only: ask the system for the ubiquity container, which is what opens it to the
 * sandbox. The container exists once iCloud returns it, so its Documents folder may be created
 * here (the DMG build never creates the container — it can only see one iCloud made).
 */
async function ensureMasContainer(): Promise<void> {
  if (!isMasSandbox()) return
  const id = CONTAINER
  if (masRoot?.id === id) return
  const root = await masContainerRoot(id)
  if (!root) { log.warn('[sync] iCloud container unavailable (signed out of iCloud or iCloud Drive off)'); return }
  try { mkdirSync(`${root}/Documents`, { recursive: true }) } catch (err) { log.warn('[sync] could not create the container Documents folder', err) }
  masRoot = { id, root }
  log.info('[sync] iCloud container resolved for the sandbox')
}

/**
 * Why this app must not sync through `folder`, or null. Refuses a binary whose bundle ID does not
 * match the identity it was compiled for, and a custom folder inside the other identity's iCloud
 * container. A leftover `icloudContainerId` setting from before identities existed is ignored.
 */
async function syncLocationProblem(folder: string): Promise<string | null> {
  const mismatch = identityProblem()
  if (mismatch) return `iCloud Sync is disabled: ${mismatch}.`
  const legacy = await setting<string>('icloudContainerId')
  if (legacy && legacy !== CONTAINER) log.warn(`[sync] ignoring the icloudContainerId setting (${legacy}); ${APP_IDENTITY.appName} syncs only through ${CONTAINER}`)
  if (isForeignContainerPath(APP_IDENTITY, folder)) return `${APP_IDENTITY.appName} cannot sync through another Berean app's iCloud folder (${folder}).`
  return null
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

function publish(s: SyncStatusSnapshot | null): void {
  lastStatus = s
  broadcast('sync:status', s)
}
async function publishStatus(): Promise<void> {
  if (!engine) { publish(null); return }
  try { publish(await engine.status()) } catch (err) { log.warn('[sync] status failed', err) }
}

async function syncNow(reason: string): Promise<void> {
  if (!core) return
  core.requestSync(reason)
  await core.idle()
}

/**
 * Start the engine (idempotent). Capture is independent of the folder (DATA-SYNC-001): once
 * sync is enabled every local change goes to the SQLite outbox even if the iCloud folder is
 * missing right now; the store reports "unavailable" (it never creates the container root
 * itself) and push / pull retry on the interval. Only turning sync ON requires the folder.
 */
async function startEngine(opts: { requireAvailable: boolean; reconcile: 'full' | 'since-last' }): Promise<{ ok: boolean; reason?: string }> {
  if (engine) return { ok: true }
  await ensureMasContainer()
  const folder = resolveSyncFolder(await setting<string>('icloudSyncFolder'))
  const problem = await syncLocationProblem(folder)
  if (problem) { log.error(`[sync] ${problem}`); return { ok: false, reason: problem } }
  const containerRoot = folder.replace(/\/sync\/v1$/, '')
  const missing = `iCloud folder not found: ${containerRoot} — open Berean on your iPhone once so iCloud creates the container, or choose a folder inside iCloud Drive.`
  if (opts.requireAvailable && !existsSync(containerRoot)) return { ok: false, reason: missing }
  const userDb = serviceContext().userDb
  // Data-safety gates, same as the iPhone (docs/mobile/sync.md "Data safety"): integrity check,
  // a copied / restored berean.db (Migration Assistant, Time Machine) forks its device id.
  const health = await checkDatabase(userDb)
  if (!health.ok) log.error('[sync] berean.db failed its integrity check — sync held', health.detail)
  let storageIdentity: string | null = null
  try { storageIdentity = `mac:${Math.round(statSync(join(app.getPath('userData'), 'berean.db')).birthtimeMs)}` } catch { /* unknown */ }
  const { deviceId, forked } = await SyncEngine.resolveDeviceId(userDb, {
    newId: () => randomBytes(8).toString('hex'),
    storageIdentity,
    peekManifest: existsSync(containerRoot) ? (id) => new FsSyncStore(folder, id, containerRoot).readManifest(id) : undefined,
    log: { info: (m) => log.info(m), warn: (m) => log.warn(m), error: (m) => log.error(m) },
  })
  if (forked) log.warn(`[sync] this database was restored or copied (${forked}) — syncing as a new device`)
  store = new FsSyncStore(folder, deviceId, containerRoot, isMasSandbox() ? (p) => { masStartDownloading(p) } : null, APP_IDENTITY.name)
  if (opts.requireAvailable) {
    const st = await store.status()
    if (!st.available) { store = null; return { ok: false, reason: st.reason } }
  }
  engine = await SyncEngine.open({
    databaseProblem: health.ok ? null : health.detail,
    db: userDb, store, events: serviceContext().events, deviceId,
    deviceName: hostname().replace(/\.local$/, ''), platform: process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin',
    appVersion: app.getVersion(), schema: BEREAN_SCHEMA_VERSION,
    log: { info: (m, ...r) => log.info(m, ...r), warn: (m, ...r) => log.warn(m, ...r), error: (m, ...r) => log.error(m, ...r) },
    onApplied: (entities) => { trace.record('ui:invalidate', { entities: [...entities].sort().join(',') }); broadcast('sync:applied', [...entities]) },
    trace,
    // Live progress of the pass in progress (DATA-UX-010): merged into the last full status so the
    // Settings row, the iCloud page and the first-sync panel all read one snapshot.
    onProgress: (p) => {
      if (lastStatus) { publish({ ...lastStatus, progress: p }); return }
      void engine?.status().then((st) => publish({ ...st, progress: p })).catch(() => {})
    },
    online: () => net.isOnline(),
  })
  engine.start()
  if (health.ok) {
    const adopted = await engine.adoptExisting()
    if (adopted) log.info(`[sync] adopted ${adopted} existing records`)
    const republished = await engine.republishIfRequested()
    if (republished) log.info(`[sync] republished ${republished} records`)
  }
  try {
    const n = await engine.reconcileLocal(opts.reconcile === 'full')
    if (n) log.info(`[sync] reconciled ${n} local change(s) not captured before`)
  } catch (err) { log.warn('[sync] local reconciliation failed', err) }
  // Event-driven lifecycle shared with the iPhone (DATA-SYNC-007): local change → debounced sync,
  // folder change → sync, 60 s safety net.
  core = createSyncHostCore({ engine, store, trace, onStatus: publish, log, onForkDetected: () => { void restartEngine('fork') } })
  core.requestSync('start')
  return { ok: true }
}

async function restartEngine(reason: string): Promise<void> {
  log.warn(`[sync] restarting the engine (${reason})`)
  stopEngine()
  const r = await startEngine({ requireAvailable: false, reconcile: 'since-last' })
  if (!r.ok) log.warn(`[sync] not restarted: ${r.reason}`)
  await publishStatus()
}

function stopEngine(): void {
  core?.stop(); core = null
  engine?.stop()
  engine = null
  store = null
  lastStatus = null
}

export async function initSyncHost(): Promise<void> {
  ipcMain.handle('sync:getStatus', async () => (engine ? engine.status() : null))
  ipcMain.handle('sync:getConfig', async () => { await ensureMasContainer(); return {
    enabled: (await setting<boolean>('icloudSyncEnabled')) === true,
    folder: resolveSyncFolder(await setting<string>('icloudSyncFolder')),
    folderOverride: await setting<string>('icloudSyncFolder'),
    containerId: CONTAINER,
    containerExists: existsSync(resolveSyncFolder(await setting<string>('icloudSyncFolder')).replace(/\/sync\/v1$/, '')),
    running: !!engine,
  } })
  ipcMain.handle('sync:syncNow', async () => { await syncNow('manual'); return lastStatus })
  ipcMain.handle('sync:enable', async () => {
    const r = await startEngine({ requireAvailable: true, reconcile: 'full' })
    if (r.ok) await services().settings.set('icloudSyncEnabled', true)
    return r
  })
  ipcMain.handle('sync:disable', async () => {
    stopEngine()
    await services().settings.set('icloudSyncEnabled', false)
    await publishStatus()
    return { ok: true }
  })
  ipcMain.handle('sync:chooseFolder', async () => {
    const picked = await pickFolder({ title: 'Choose a folder inside iCloud Drive for Berean sync', properties: ['openDirectory', 'createDirectory'] })
    if (!picked) return { canceled: true }
    if (isForeignContainerPath(APP_IDENTITY, picked)) {
      log.warn(`[sync] refused a folder inside another Berean app's iCloud container: ${picked}`)
      return { canceled: true }
    }
    const chosen = `${picked}/sync/v1`
    stopEngine()
    await services().settings.set('icloudSyncFolder', chosen)
    return { folder: chosen }
  })
  ipcMain.handle('sync:resolveHold', async (_e, choice: 'restore' | 'delete' | 'republish') => {
    if (!engine) return { ok: false, reason: 'sync is off' }
    if (choice === 'republish') { await engine.resolveHold('republish'); await restartEngine('republish'); return { ok: true } }
    if (choice !== 'restore' && choice !== 'delete') return { ok: false, reason: 'unknown choice' }
    await engine.resolveQuarantine(choice)
    await syncNow('hold-resolved')
    return { ok: true }
  })
  ipcMain.handle('sync:getTrace', async () => ({ enabled: trace.enabled(), entries: trace.entries() }))
  ipcMain.handle('sync:setDiagnostics', async (_e, on: boolean) => {
    trace.setEnabled(!!on)
    if (!on) trace.clear()
    await services().settings.set('icloudSyncDiagnostics', !!on)
  })
  ipcMain.handle('sync:useDefaultFolder', async () => {
    stopEngine()
    await services().settings.set('icloudSyncFolder', null)
    return { ok: true }
  })

  trace.setEnabled((await setting<boolean>('icloudSyncDiagnostics')) === true)
  if ((await setting<boolean>('icloudSyncEnabled')) === true) {
    const r = await startEngine({ requireAvailable: false, reconcile: 'since-last' })
    if (!r.ok) log.warn(`[sync] not started: ${r.reason}`)
  }

  powerMonitor.on('resume', () => { core?.requestSync('resume') })
  app.on('before-quit', () => { if (core) void core.pushNow('quit') })
}
