/// <reference path="./node-sqlite.d.ts" />
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { SyncSqliteAdapter } from './syncSqliteAdapter'

/**
 * Test-only DatabaseAdapter over Node's built-in `node:sqlite` (Node ≥ 22.5; this repo runs
 * vitest on Node 24). It exists because better-sqlite3 in this repo is compiled against
 * Electron's ABI and cannot be loaded by plain Node. Same SQLite engine family, same FTS5, same
 * SQL — so the shared services' contract tests exercise real SQL rather than fakes.
 *
 * Loaded through `process.getBuiltinModule` rather than a static import because Vite 5's
 * import analysis predates `node:sqlite` and tries to resolve it as a package.
 */
function loadDatabaseSync(): typeof DatabaseSyncType {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
  if (!getBuiltin) throw new Error('node:sqlite requires Node ≥ 22.5 (process.getBuiltinModule missing)')
  const mod = getBuiltin('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType } | undefined
  if (!mod?.DatabaseSync) throw new Error('node:sqlite is not available in this Node build')
  return mod.DatabaseSync
}

export function openNodeSqlite(path = ':memory:', label = 'memory', readOnly = false): SyncSqliteAdapter {
  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true })
  return new SyncSqliteAdapter(db, label, 'memory')
}
