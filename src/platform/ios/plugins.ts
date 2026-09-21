import { registerPlugin } from '@capacitor/core'

/**
 * TypeScript faces of Berean's local Capacitor plugins (ios/App/BereanNative). Each interface
 * mirrors the Swift `pluginMethods` exactly; the Swift side is the source of truth.
 */

export type SqliteJsonValue = string | number | null | { __blob: string }

export interface BereanSQLitePlugin {
  /** `path` is symbolic: `bundle:data/kjva.db`, `appsupport:berean.db` or `memory:`. */
  open(opts: { path: string; readOnly?: boolean }): Promise<{ handle: number; readOnly: boolean }>
  close(opts: { handle: number }): Promise<void>
  exec(opts: { handle: number; sql: string }): Promise<void>
  run(opts: { handle: number; sql: string; params?: SqliteJsonValue[] }): Promise<{ changes: number; lastInsertRowid: number }>
  query(opts: { handle: number; sql: string; params?: SqliteJsonValue[] }): Promise<{ rows: Record<string, SqliteJsonValue>[] }>
  batch(opts: { handle: number; statements: Array<{ sql: string; params?: SqliteJsonValue[]; kind?: 'run' | 'query' }> }): Promise<{ results: Array<{ changes?: number; lastInsertRowid?: number; rows?: Record<string, SqliteJsonValue>[] }> }>
  attach(opts: { handle: number; path: string; alias: string }): Promise<void>
  detach(opts: { handle: number; alias: string }): Promise<void>
  fileInfo(opts: { path: string }): Promise<{ exists: boolean; size: number; readOnly: boolean }>
}

export const BereanSQLite = registerPlugin<BereanSQLitePlugin>('BereanSQLite')

export interface CloudEntry { name: string; isDir: boolean; downloaded: boolean }
export interface CloudStatus { available: boolean; signedIn: boolean; reason?: string; containerId: string; path?: string; deviceName: string }
export interface CloudChange { paths: string[]; initial: boolean }

/** iCloud Drive container access for the sync journal (ios/App/BereanNative/.../BereanCloudPlugin.swift).
 *  Paths are relative to `<container>/Documents/sync/v1`. */
export interface BereanCloudPlugin {
  status(): Promise<CloudStatus>
  mkdir(opts: { path: string }): Promise<void>
  list(opts: { path: string }): Promise<{ entries: CloudEntry[] }>
  /** `text` is null while `downloading` (iCloud has the file but it is not local yet). */
  read(opts: { path: string }): Promise<{ exists: boolean; downloading: boolean; text: string | null }>
  write(opts: { path: string; text: string }): Promise<void>
  remove(opts: { path: string }): Promise<void>
  startWatching(): Promise<void>
  stopWatching(): Promise<void>
  addListener(event: 'change', cb: (change: CloudChange) => void): Promise<{ remove: () => Promise<void> }>
}

export const BereanCloud = registerPlugin<BereanCloudPlugin>('BereanCloud')
