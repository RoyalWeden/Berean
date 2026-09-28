import { app, BrowserWindow, dialog, ipcMain, net, powerMonitor } from 'electron'
import { homedir, hostname } from 'os'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'
import log from 'electron-log'
import { services, serviceContext } from '../services'
import { SyncEngine } from '../../src/platform/sync/engine'
import { BEREAN_SCHEMA_VERSION } from '../../src/platform/db/bereanMigrations'
import { FsSyncStore, ubiquityContainerPath } from './fsSyncStore'
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
 * overrides the container path), `icloudContainerId` (default 'iCloud.com.berean.app').
 */
const DEFAULT_CONTAINER = 'iCloud.com.berean.app'

let engine: SyncEngine | null = null
let store: FsSyncStore | null = null
let core: SyncHostCore | null = null
let lastStatus: SyncStatusSnapshot | null = null
// Diagnostic log (metadata only, DATA-SYNC-006); toggled from Settings → iCloud (setting key).
const trace = createSyncTrace({ log: (line) => log.info(line) })

async function setting<T>(key: string): Promise<T | null> {
  return (await services().settings.get(key)) as T | null
}

export function resolveSyncFolder(override: string | null, containerId: string | null): string {
  if (override) return override
  return `${ubiquityContainerPath(containerId ?? DEFAULT_CONTAINER, homedir())}/sync/v1`
}

async function deviceIdFor(): Promise<string> {
  const row = await serviceContext().userDb.get<{ value: string }>("SELECT value FROM sync_state WHERE key = 'device_id'")
  return row?.value ?? randomBytes(8).toString('hex')
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
  const folder = resolveSyncFolder(await setting<string>('icloudSyncFolder'), await setting<string>('icloudContainerId'))
  const containerRoot = folder.replace(/\/sync\/v1$/, '')
  const missing = `iCloud folder not found: ${containerRoot} — open Berean on your iPhone once so iCloud creates the container, or choose a folder inside iCloud Drive.`
  if (opts.requireAvailable && !existsSync(containerRoot)) return { ok: false, reason: missing }
  const deviceId = await deviceIdFor()
  store = new FsSyncStore(folder, deviceId, containerRoot)
  if (opts.requireAvailable) {
    const st = await store.status()
    if (!st.available) { store = null; return { ok: false, reason: st.reason } }
  }
  engine = await SyncEngine.open({
    db: serviceContext().userDb, store, events: serviceContext().events, deviceId,
    deviceName: hostname().replace(/\.local$/, ''), platform: process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin',
    appVersion: app.getVersion(), schema: BEREAN_SCHEMA_VERSION,
    log: { info: (m, ...r) => log.info(m, ...r), warn: (m, ...r) => log.warn(m, ...r), error: (m, ...r) => log.error(m, ...r) },
    onApplied: (entities) => { trace.record('ui:invalidate', { entities: [...entities].sort().join(',') }); broadcast('sync:applied', [...entities]) },
    trace,
    online: () => net.isOnline(),
  })
  engine.start()
  const adopted = await engine.adoptExisting()
  if (adopted) log.info(`[sync] adopted ${adopted} existing records`)
  try {
    const n = await engine.reconcileLocal(opts.reconcile === 'full')
    if (n) log.info(`[sync] reconciled ${n} local change(s) not captured before`)
  } catch (err) { log.warn('[sync] local reconciliation failed', err) }
  // Event-driven lifecycle shared with the iPhone (DATA-SYNC-007): local change → debounced sync,
  // folder change → sync, 60 s safety net.
  core = createSyncHostCore({ engine, store, trace, onStatus: publish, log })
  core.requestSync('start')
  return { ok: true }
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
  ipcMain.handle('sync:getConfig', async () => ({
    enabled: (await setting<boolean>('icloudSyncEnabled')) === true,
    folder: resolveSyncFolder(await setting<string>('icloudSyncFolder'), await setting<string>('icloudContainerId')),
    folderOverride: await setting<string>('icloudSyncFolder'),
    containerId: (await setting<string>('icloudContainerId')) ?? DEFAULT_CONTAINER,
    containerExists: existsSync(resolveSyncFolder(await setting<string>('icloudSyncFolder'), await setting<string>('icloudContainerId')).replace(/\/sync\/v1$/, '')),
    running: !!engine,
  }))
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
    const result = await dialog.showOpenDialog({ title: 'Choose a folder inside iCloud Drive for Berean sync', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const chosen = `${result.filePaths[0]}/sync/v1`
    stopEngine()
    await services().settings.set('icloudSyncFolder', chosen)
    return { folder: chosen }
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
