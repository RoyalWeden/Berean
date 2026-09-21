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
