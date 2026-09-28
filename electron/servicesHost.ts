import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import Database from 'better-sqlite3'
import log from 'electron-log'
import { SyncSqliteAdapter } from './db/adapters/syncSqliteAdapter'
import { getBereanDb } from './db/berean'
import { getTextDb } from './db/bible'
import { getHebrewDb, getGreekDb } from './db/lexicon'
import { createServiceEvents, type ServiceContext } from '../src/platform/services/context'
import { initServices } from './services'
import type { Services } from '../src/platform/services'

/**
 * Desktop host for the shared services (docs/mobile/architecture.md §3). Builds the
 * ServiceContext over better-sqlite3 and registers it with electron/services.ts. Called once from
 * main.ts after berean.db is open and migrated.
 *
 * Bundled data path resolution is unified here (audit finding K6): dev = <repo>/data, packaged =
 * <Resources>/data. `getTextDb`/`getHebrewDb` keep their own resolution for now because the raw
 * handles are still used by desktop-only code; both resolve to the same files.
 */
export function bundledDataPath(filename: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'data', filename)
    : join(app.getAppPath(), 'data', filename)
}

const textAdapters = new Map<string, SyncSqliteAdapter | null>()
const lexAdapters = new Map<'H' | 'G', SyncSqliteAdapter>()
const dataAdapters = new Map<string, SyncSqliteAdapter | null>()

/** Wrap an already-open readonly better-sqlite3 text DB. */
function textAdapter(textId: string): SyncSqliteAdapter | null {
  if (textAdapters.has(textId)) return textAdapters.get(textId)!
  const raw = getTextDb(textId)
  const adapter = raw ? new SyncSqliteAdapter(raw, `text:${textId}`) : null
  textAdapters.set(textId, adapter)
  return adapter
}

function lexiconAdapter(lang: 'H' | 'G'): SyncSqliteAdapter {
  let a = lexAdapters.get(lang)
  if (!a) {
    a = new SyncSqliteAdapter(lang === 'H' ? getHebrewDb() : getGreekDb(), `lexicon:${lang}`)
    lexAdapters.set(lang, a)
  }
  return a
}

function dataAdapter(name: 'cross_references' | 'tske_refs' | 'hermas_taylor'): SyncSqliteAdapter | null {
  if (dataAdapters.has(name)) return dataAdapters.get(name)!
  const path = bundledDataPath(`${name}.db`)
  let adapter: SyncSqliteAdapter | null = null
  if (existsSync(path)) {
    try {
      adapter = new SyncSqliteAdapter(new Database(path, { readonly: true }), `data:${name}`)
    } catch (err) {
      log.error(`[services] failed to open ${name}.db:`, err)
    }
  }
  dataAdapters.set(name, adapter)
  return adapter
}

/** Build the desktop ServiceContext and register the service registry. */
export function initDesktopServices(): Services {
  const events = createServiceEvents()
  const ctx: ServiceContext = {
    userDb: new SyncSqliteAdapter(getBereanDb(), 'berean.db'),
    textDb: async (textId) => textAdapter(textId),
    lexiconDb: async (lang) => lexiconAdapter(lang),
    dataDb: async (name) => dataAdapter(name),
    events,
    now: () => Date.now(),
    uuid: () => randomUUID(),
    isDev: is.dev,
    log: {
      info: (m, ...r) => log.info(m, ...r),
      warn: (m, ...r) => log.warn(m, ...r),
      error: (m, ...r) => log.error(m, ...r),
    },
  }
  const svc = initServices(ctx)
  installCrossWindowChangeBroadcast(ctx)
  return svc
}

/**
 * Fan a data-change event out to every OTHER app window as the legacy per-domain channels the
 * renderer already listens on (`notes:changed`, `studyTrail:dataChanged`). Kept here so the
 * services never touch BrowserWindow. The originating window (the IPC sender, tracked with
 * `withSender`) is skipped exactly like the old inline broadcasts did.
 */
function installCrossWindowChangeBroadcast(ctx: ServiceContext): void {
  ctx.events.on('data:changed', (change) => {
    const channel =
      change.entity === 'note' || change.entity === 'note_folder' || change.entity === 'note_version'
        ? 'notes:changed'
        : change.entity.startsWith('trail_')
          ? 'studyTrail:dataChanged'
          : null
    if (!channel) return
    // A change applied from another device (sync) has no originating window: every window refreshes.
    const senderId = change.remote ? null : currentSender()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (senderId !== null && win.webContents.id === senderId) continue
      if (channel === 'studyTrail:dataChanged') win.webContents.send(channel, change.scope)
      else win.webContents.send(channel)
    }
  })
}

// The webContents id of the IPC sender whose handler is currently running. AsyncLocalStorage
// (not a module variable) so two interleaved async handlers can't see each other's sender.
const senderContext = new AsyncLocalStorage<number | null>()
export function withSender<T>(senderId: number | undefined, fn: () => Promise<T>): Promise<T> {
  return senderContext.run(senderId ?? null, fn)
}
function currentSender(): number | null {
  return senderContext.getStore() ?? null
}
