/**
 * The one database interface every shared service is written against.
 *
 * Desktop implements it over better-sqlite3 (electron/db/adapters/betterSqliteAdapter.ts); iOS
 * implements it over the BereanSQLite Capacitor plugin (src/platform/ios/capacitorSqliteAdapter.ts);
 * tests use an in-memory better-sqlite3 (src/platform/db/memoryAdapter.ts). The surface is
 * deliberately the minimum the extracted electron/ipc/*.ts SQL needs — see docs/mobile/database.md.
 *
 * Conventions:
 *  - positional `?` parameters only (every existing query already uses them);
 *  - `all`/`get` return plain row objects keyed by column name, exactly as better-sqlite3 does;
 *  - `run` reports `changes` and `lastInsertRowid` like better-sqlite3's RunResult;
 *  - `exec` runs one or more statements with no parameters (migrations, PRAGMAs);
 *  - `transaction(fn)` runs `fn` inside BEGIN…COMMIT and rolls back if it throws. The callback
 *    receives a handle that MUST be used for every statement inside the transaction. Callbacks
 *    must not await anything other than that handle's own methods — on desktop the adapter
 *    serialises all other database work behind the open transaction, so an unrelated await
 *    inside the callback would stall the whole app until the transaction finishes.
 */

export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlParams = ReadonlyArray<SqlValue | undefined>

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export type AdapterKind = 'better-sqlite3' | 'capacitor' | 'memory'

export interface DatabaseAdapter {
  readonly kind: AdapterKind
  /** Human-readable identity for logs (file name or alias). */
  readonly label: string

  all<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T | undefined>
  run(sql: string, params?: SqlParams): Promise<RunResult>
  exec(sql: string): Promise<void>

  /**
   * Run `fn` in a transaction. Nested calls become SAVEPOINTs. See the header for the
   * "only await the handle" rule.
   */
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>

  /** ATTACH another database file under `alias` (used for seed merges and cross-DB joins). */
  attach(filePath: string, alias: string): Promise<void>
  detach(alias: string): Promise<void>

  close(): Promise<void>
}

/** Build `?,?,?` for an IN (...) list. Shared so every service spells it the same way. */
export function placeholders(count: number): string {
  if (count <= 0) return ''
  return new Array(count).fill('?').join(',')
}

/**
 * Column-existence probe shared by the text-DB services (several bundled texts lack
 * `text_tagged` / `title` / `sort_order`). Cached per (adapter label, table, column) because
 * a bundled DB's schema never changes while the app runs.
 */
const _columnCache = new Map<string, boolean>()
export async function hasColumn(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  const key = `${db.label}|${table}|${column}`
  const cached = _columnCache.get(key)
  if (cached !== undefined) return cached
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(${table})`)
  const has = cols.some((c) => c.name === column)
  _columnCache.set(key, has)
  return has
}

/** Test-only: forget cached column probes (e.g. after recreating an in-memory DB). */
export function __resetColumnCache(): void {
  _columnCache.clear()
}
