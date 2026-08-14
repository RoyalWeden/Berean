// A better-sqlite3-API-compatible shim backed by Node's OWN built-in `node:sqlite` module,
// used ONLY by the retrieval eval harness (see runRetrievalEval.ts).
//
// Why this exists: better-sqlite3's native binding in this worktree is compiled against
// Electron's Node ABI (electron-rebuild), not the plain Node ABI `vitest` runs under — see the
// comment at the top of electron/ipc/__tests__/lexicon.occurrences.test.ts, which hit the same
// wall and worked around it with a hand-rolled fake DB with no real data behind it. That's fine
// for a pure-logic regression test; it's useless for a RETRIEVAL eval, which is worthless unless
// it runs against real verse/lexicon/cross-reference text. Node 22+ ships `node:sqlite`
// (confirmed present and able to open these exact .db files read-only, including their existing
// FTS5 virtual tables, at the Node version this repo runs under) as a zero-install alternative
// that needs no rebuild and touches no node_modules.
//
// This file is `vi.mock('better-sqlite3', ...)`'d wholesale in runRetrievalEval.ts, which means
// electron/db/bible.ts, electron/db/lexicon.ts, and electron/ipc/crossrefs.ts all run their REAL,
// UNMODIFIED code against REAL data through this shim — only the underlying native binding is
// swapped, not any of the actual query/retrieval logic under test.
// Loaded via `createRequire` rather than a static `import ... from 'node:sqlite'` — vitest 1.x's
// Vite-based module graph doesn't recognize the (still-experimental) `node:sqlite` builtin and
// tries to resolve/bundle it as a real file, which fails. A runtime `require` sidesteps Vite's
// static analysis entirely; Node itself resolves `node:sqlite` natively regardless.
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>
type StatementSync = ReturnType<DatabaseSyncInstance['prepare']>

interface BetterSqlite3Options { readonly?: boolean; fileMustExist?: boolean }

class ShimStatement {
  constructor(private stmt: StatementSync) {}
  all(...params: unknown[]): unknown[] { return this.stmt.all(...(params as never[])) }
  get(...params: unknown[]): unknown { return this.stmt.get(...(params as never[])) }
  run(...params: unknown[]): unknown { return this.stmt.run(...(params as never[])) }
}

class ShimDatabase {
  private db: DatabaseSyncInstance
  constructor(path: string, options: BetterSqlite3Options = {}) {
    // better-sqlite3's `readonly` -> node:sqlite's `readOnly`; everything else in `options`
    // (verbose, fileMustExist, etc.) is never passed by the real call sites this shim covers
    // (all just `{ readonly: true }`), so nothing else needs translating.
    this.db = new DatabaseSync(path, { readOnly: options.readonly === true })
  }
  prepare(sql: string): ShimStatement { return new ShimStatement(this.db.prepare(sql)) }
  exec(sql: string): void { this.db.exec(sql) }
  pragma(_stmt: string): unknown { return undefined } // unused by any code path this eval exercises
  transaction<T extends (...args: never[]) => unknown>(fn: T): T { return fn } // ditto
  close(): void { this.db.close() }
}

export default ShimDatabase
