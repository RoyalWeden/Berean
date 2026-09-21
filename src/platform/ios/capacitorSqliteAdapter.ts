import type { AdapterKind, DatabaseAdapter, RunResult, SqlParams, SqlValue } from '../db/DatabaseAdapter'
import { BereanSQLite, type SqliteJsonValue } from './plugins'

/**
 * DatabaseAdapter over the BereanSQLite Capacitor plugin (iOS). See docs/mobile/database.md §2.
 *
 * Every call is a bridge round-trip to the native serial queue for this connection, so the
 * mutual-exclusion the desktop adapter has to build with a promise chain comes for free here;
 * what this class adds is (a) the transaction protocol — `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`
 * around an awaited callback, with outside statements queued behind an open transaction exactly
 * like the desktop adapter — and (b) value encoding (Uint8Array ↔ `{__blob}` base64, undefined →
 * null).
 */
function encodeParams(params?: SqlParams): SqliteJsonValue[] {
  if (!params || params.length === 0) return []
  return params.map((p): SqliteJsonValue => {
    if (p === undefined || p === null) return null
    if (p instanceof Uint8Array) return { __blob: bytesToBase64(p) }
    if (typeof p === 'bigint') return Number(p)
    return p
  })
}

function decodeRow<T>(row: Record<string, SqliteJsonValue>): T {
  const out: Record<string, SqlValue> = {}
  for (const k of Object.keys(row)) {
    const v = row[k]
    out[k] = v !== null && typeof v === 'object' && '__blob' in v ? base64ToBytes(v.__blob) : (v as SqlValue)
  }
  return out as T
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export class CapacitorSqliteAdapter implements DatabaseAdapter {
  readonly kind: AdapterKind = 'capacitor'
  readonly label: string
  private handle: number
  private txTail: Promise<unknown> = Promise.resolve()
  private savepointDepth = 0

  private constructor(handle: number, label: string) {
    this.handle = handle
    this.label = label
  }

  static async open(path: string, opts: { readOnly?: boolean; label?: string } = {}): Promise<CapacitorSqliteAdapter> {
    const { handle } = await BereanSQLite.open({ path, readOnly: opts.readOnly })
    return new CapacitorSqliteAdapter(handle, opts.label ?? path)
  }

  // direct executors (inside a transaction, or after the outside-tx wait)
  private async allNow<T>(sql: string, params?: SqlParams): Promise<T[]> {
    const { rows } = await BereanSQLite.query({ handle: this.handle, sql, params: encodeParams(params) })
    return rows.map((r) => decodeRow<T>(r))
  }
  private async runNow(sql: string, params?: SqlParams): Promise<RunResult> {
    return BereanSQLite.run({ handle: this.handle, sql, params: encodeParams(params) })
  }
  private async execNow(sql: string): Promise<void> {
    await BereanSQLite.exec({ handle: this.handle, sql })
  }

  async all<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T[]> {
    await this.txTail
    return this.allNow<T>(sql, params)
  }
  async get<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T | undefined> {
    await this.txTail
    const rows = await this.allNow<T>(sql, params)
    return rows[0]
  }
  async run(sql: string, params?: SqlParams): Promise<RunResult> {
    await this.txTail
    return this.runNow(sql, params)
  }
  async exec(sql: string): Promise<void> {
    await this.txTail
    return this.execNow(sql)
  }

  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const start = async (): Promise<T> => {
      await this.execNow('BEGIN IMMEDIATE')
      const tx = this.makeTxHandle()
      try {
        const result = await fn(tx)
        await this.execNow('COMMIT')
        return result
      } catch (err) {
        try { await this.execNow('ROLLBACK') } catch { /* already rolled back */ }
        throw err
      }
    }
    const p = this.txTail.then(start, start)
    this.txTail = p.then(() => undefined, () => undefined)
    return p
  }

  private makeTxHandle(): DatabaseAdapter {
    const self = this
    const handle: DatabaseAdapter = {
      kind: self.kind,
      label: self.label,
      all: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => self.allNow<T>(sql, params),
      get: async <T = Record<string, unknown>>(sql: string, params?: SqlParams) => (await self.allNow<T>(sql, params))[0],
      run: (sql: string, params?: SqlParams) => self.runNow(sql, params),
      exec: (sql: string) => self.execNow(sql),
      async transaction<T>(inner: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
        const name = `sp_${++self.savepointDepth}`
        await self.execNow(`SAVEPOINT ${name}`)
        try {
          const r = await inner(handle)
          await self.execNow(`RELEASE SAVEPOINT ${name}`)
          return r
        } catch (err) {
          await self.execNow(`ROLLBACK TO SAVEPOINT ${name}`)
          await self.execNow(`RELEASE SAVEPOINT ${name}`)
          throw err
        } finally {
          self.savepointDepth--
        }
      },
      attach: (path: string, alias: string) => BereanSQLite.attach({ handle: self.handle, path, alias }),
      detach: (alias: string) => BereanSQLite.detach({ handle: self.handle, alias }),
      async close() { throw new Error('close() is not allowed inside a transaction') },
    }
    return handle
  }

  async attach(path: string, alias: string): Promise<void> {
    await this.txTail
    await BereanSQLite.attach({ handle: this.handle, path, alias })
  }
  async detach(alias: string): Promise<void> {
    await this.txTail
    await BereanSQLite.detach({ handle: this.handle, alias })
  }
  async close(): Promise<void> {
    await this.txTail
    await BereanSQLite.close({ handle: this.handle })
  }
}
