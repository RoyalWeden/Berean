import type { AdapterKind, DatabaseAdapter, RunResult, SqlParams, SqlValue } from '../../../src/platform/db/DatabaseAdapter'

/**
 * The minimal synchronous driver surface this adapter needs. Satisfied by better-sqlite3's
 * `Database` (desktop) and by Node's built-in `node:sqlite` `DatabaseSync` (vitest — the
 * better-sqlite3 binding in this repo is compiled for Electron's ABI and cannot load under plain
 * Node; see electron/ipc/__tests__/lexicon.occurrences.test.ts's header).
 */
export interface SyncSqliteDriver {
  prepare(sql: string): SyncStatement
  exec(sql: string): void
  close(): void
}
export interface SyncStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}

/**
 * DatabaseAdapter over a synchronous SQLite driver (better-sqlite3 on desktop, node:sqlite in
 * tests).
 *
 * The driver is synchronous, so every method resolves immediately; the async surface exists
 * only so the shared services have one signature on both platforms. Two things this class adds
 * beyond a thin wrapper:
 *
 *  1. Prepared-statement cache keyed by SQL text (the hot chapter/search handlers relied on the
 *     old per-file `prep()` caches; this keeps that behaviour for every service at once).
 *  2. Transaction serialisation. `db.transaction(fn)` in better-sqlite3 needs a synchronous
 *     callback; the shared services need an async one. So a transaction is BEGIN…COMMIT around an
 *     awaited callback, and to make that safe every statement issued OUTSIDE the transaction
 *     (another IPC handler landing mid-transaction) waits until the transaction has finished.
 *     Statements issued through the transaction's own handle run directly. Nested transactions
 *     become SAVEPOINTs.
 */
export class SyncSqliteAdapter implements DatabaseAdapter {
  readonly kind: AdapterKind
  readonly label: string

  private readonly db: SyncSqliteDriver
  private readonly stmtCache = new Map<string, SyncStatement>()
  private static readonly STMT_CACHE_MAX = 512

  // The tail of the transaction queue. Non-transactional work awaits it; each new transaction
  // chains onto it so transactions never overlap and never interleave with outside statements.
  private txTail: Promise<unknown> = Promise.resolve()
  private savepointDepth = 0

  constructor(db: SyncSqliteDriver, label: string, kind: AdapterKind = 'better-sqlite3') {
    this.db = db
    this.label = label
    this.kind = kind
  }

  /** The raw driver handle — for desktop-only code that still uses better-sqlite3 directly (main.ts). */
  get raw(): SyncSqliteDriver {
    return this.db
  }

  private prep(sql: string): SyncStatement {
    let stmt = this.stmtCache.get(sql)
    if (stmt) return stmt
    stmt = this.db.prepare(sql)
    if (this.stmtCache.size >= SyncSqliteAdapter.STMT_CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.stmtCache.keys().next().value
      if (oldest !== undefined) this.stmtCache.delete(oldest)
    }
    this.stmtCache.set(sql, stmt)
    return stmt
  }

  private static bind(params?: SqlParams): SqlValue[] {
    if (!params || params.length === 0) return []
    // better-sqlite3 rejects `undefined`; the old handlers never passed it deliberately, but a
    // missing optional argument at an IPC boundary is easy to hit — treat it as NULL.
    return params.map((p) => (p === undefined ? null : p))
  }

  // ── direct executors (used by the tx handle and after the outside-tx wait) ────────────────
  private allNow<T>(sql: string, params?: SqlParams): T[] {
    return this.prep(sql).all(...SyncSqliteAdapter.bind(params)) as T[]
  }
  private getNow<T>(sql: string, params?: SqlParams): T | undefined {
    return this.prep(sql).get(...SyncSqliteAdapter.bind(params)) as T | undefined
  }
  private runNow(sql: string, params?: SqlParams): RunResult {
    const r = this.prep(sql).run(...SyncSqliteAdapter.bind(params))
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }
  private execNow(sql: string): void {
    this.db.exec(sql)
  }

  // ── public async surface (outside a transaction) ─────────────────────────────────────────
  async all<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T[]> {
    await this.txTail
    return this.allNow<T>(sql, params)
  }
  async get<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T | undefined> {
    await this.txTail
    return this.getNow<T>(sql, params)
  }
  async run(sql: string, params?: SqlParams): Promise<RunResult> {
    await this.txTail
    return this.runNow(sql, params)
  }
  async exec(sql: string): Promise<void> {
    await this.txTail
    this.execNow(sql)
  }

  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const start = async (): Promise<T> => {
      this.execNow('BEGIN IMMEDIATE')
      const tx = this.makeTxHandle()
      try {
        const result = await fn(tx)
        this.execNow('COMMIT')
        return result
      } catch (err) {
        try { this.execNow('ROLLBACK') } catch { /* already rolled back (e.g. SQLITE_BUSY on BEGIN) */ }
        throw err
      }
    }
    const p = this.txTail.then(start, start)
    this.txTail = p.then(() => undefined, () => undefined)
    return p
  }

  /** Statements issued through this handle run directly inside the open transaction. */
  private makeTxHandle(): DatabaseAdapter {
    const self = this
    const handle: DatabaseAdapter = {
      kind: self.kind,
      label: self.label,
      async all<T = Record<string, unknown>>(sql: string, params?: SqlParams) { return self.allNow<T>(sql, params) },
      async get<T = Record<string, unknown>>(sql: string, params?: SqlParams) { return self.getNow<T>(sql, params) },
      async run(sql: string, params?: SqlParams) { return self.runNow(sql, params) },
      async exec(sql: string) { self.execNow(sql) },
      async transaction<T>(inner: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
        const name = `sp_${++self.savepointDepth}`
        self.execNow(`SAVEPOINT ${name}`)
        try {
          const r = await inner(handle)
          self.execNow(`RELEASE SAVEPOINT ${name}`)
          return r
        } catch (err) {
          self.execNow(`ROLLBACK TO SAVEPOINT ${name}`)
          self.execNow(`RELEASE SAVEPOINT ${name}`)
          throw err
        } finally {
          self.savepointDepth--
        }
      },
      async attach(filePath: string, alias: string) { self.attachNow(filePath, alias) },
      async detach(alias: string) { self.detachNow(alias) },
      async close() { throw new Error('close() is not allowed inside a transaction') },
    }
    return handle
  }

  private static assertAlias(alias: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid ATTACH alias: ${alias}`)
  }
  private attachNow(filePath: string, alias: string): void {
    SyncSqliteAdapter.assertAlias(alias)
    this.db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(filePath)
  }
  private detachNow(alias: string): void {
    SyncSqliteAdapter.assertAlias(alias)
    this.db.exec(`DETACH DATABASE ${alias}`)
  }
  async attach(filePath: string, alias: string): Promise<void> {
    await this.txTail
    this.attachNow(filePath, alias)
  }
  async detach(alias: string): Promise<void> {
    await this.txTail
    this.detachNow(alias)
  }

  async close(): Promise<void> {
    await this.txTail
    this.stmtCache.clear()
    this.db.close()
  }
}
