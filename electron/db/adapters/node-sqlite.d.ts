// Minimal ambient typing for Node's built-in `node:sqlite` (stable API shape since Node 22.5; the
// repo's @types/node 20 predates it). Only what tests/nodeSqliteAdapter.ts use.
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean; enableForeignKeyConstraints?: boolean })
    prepare(sql: string): StatementSync
    exec(sql: string): void
    close(): void
  }
  export class StatementSync {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }
}
