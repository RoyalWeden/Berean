import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import { homedir, hostname } from 'os'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'
import log from 'electron-log'
import { services, serviceContext } from '../services'
import { SyncEngine } from '../../src/platform/sync/engine'
import { BEREAN_SCHEMA_VERSION } from '../../src/platform/db/bereanMigrations'
import { FsSyncStore, ubiquityContainerPath } from './fsSyncStore'
import type { SyncStatusSnapshot } from '../../src/platform/sync/types'

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
const INTERVAL_MS = 60_000

let engine: SyncEngine | null = null
let store: FsSyncStore | null = null
let timer: ReturnType<typeof setInterval> | null = null
let unwatch: (() => void) | null = null
let lastStatus: SyncStatusSnapshot | null = null

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

async function publishStatus(): Promise<void> {
  if (!engine) { lastStatus = null; broadcast('sync:status', null); return }
  try {
    lastStatus = await engine.status()
    broadcast('sync:status', lastStatus)
  } catch (err) {
    log.warn('[sync] status failed', err)
  }
}

async function syncNow(reason: string): Promise<void> {
  if (!engine) return
  try {
    await engine.sync()
  } catch (err) {
    log.error(`[sync] sync (${reason}) failed`, err)
  } finally {
    await publishStatus()
  }
}

/** Start the engine (idempotent). Returns false when the folder is not usable. */
async function startEngine(): Promise<{ ok: boolean; reason?: string }> {
  if (engine) return { ok: true }
  const folder = resolveSyncFolder(await setting<string>('icloudSyncFolder'), await setting<string>('icloudContainerId'))
  const containerRoot = folder.replace(/\/sync\/v1$/, '')
  if (!existsSync(containerRoot)) {
    return { ok: false, reason: `iCloud folder not found: ${containerRoot} — open Berean on your iPhone once so iCloud creates the container, or choose a folder inside iCloud Drive.` }
  }
  const deviceId = await deviceIdFor()
  store = new FsSyncStore(folder, deviceId)
  const st = await store.status()
  if (!st.available) { store = null; return { ok: false, reason: st.reason } }
  engine = await SyncEngine.open({
    db: serviceContext().userDb, store, events: serviceContext().events, deviceId,
    deviceName: hostname().replace(/\.local$/, ''), platform: process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin',
    appVersion: app.getVersion(), schema: BEREAN_SCHEMA_VERSION,
    log: { info: (m, ...r) => log.info(m, ...r), warn: (m, ...r) => log.warn(m, ...r), error: (m, ...r) => log.error(m, ...r) },
    onApplied: (entities) => broadcast('sync:applied', [...entities]),
  })
  engine.start()
  const adopted = await engine.adoptExisting()
  if (adopted) log.info(`[sync] adopted ${adopted} existing records`)
  unwatch = store.watch?.(() => { void syncNow('watch') }) ?? null
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
    const r = await startEngine()
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
  ipcMain.handle('sync:useDefaultFolder', async () => {
    stopEngine()
    await services().settings.set('icloudSyncFolder', null)
    return { ok: true }
  })

  if ((await setting<boolean>('icloudSyncEnabled')) === true) {
    const r = await startEngine()
    if (!r.ok) log.warn(`[sync] not started: ${r.reason}`)
  }

  powerMonitor.on('resume', () => { void syncNow('resume') })
  app.on('before-quit', () => { if (engine) void engine.push() })
}
