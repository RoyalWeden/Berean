import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqlite } from '../../../../electron/db/adapters/nodeSqliteAdapter'
import type { DatabaseAdapter } from '../DatabaseAdapter'
import { __resetColumnCache } from '../DatabaseAdapter'
import { consoleLogger, createServiceEvents, defaultUuid, type ServiceContext } from '../../services/context'
import { runMigrations } from '../bereanMigrations'

/**
 * Shared test scaffolding for the service contract tests.
 *
 *  - `memoryUserDb()` — a fresh in-memory user DB (callers run migrations on it).
 *  - `fixtureTextDb()` — a tiny in-memory scripture text with the exact kjva.db schema (books,
 *    verses incl. text_tagged, verses_fts external-content FTS5 + trigger) and a few verses.
 *  - `realDataDb(file)` — opens a real bundled DB read-only when the file is present under
 *    <repo>/data (symlinked in worktrees; absent in CI), else returns null so tests can skip.
 *  - `makeContext()` — a ServiceContext over those.
 */
export const DATA_DIR = resolve(__dirname, '../../../../data')

export function memoryDb(label = 'memory'): DatabaseAdapter {
  __resetColumnCache()
  return openNodeSqlite(':memory:', label)
}

/**
 * A fresh in-memory user DB with the COMPLETE shared migration history applied — the exact
 * schema desktop and iOS run on (every table, index, FTS5 index and trigger). Prefer this over
 * hand-copied CREATE TABLE statements in service contract tests so a schema change can never
 * silently diverge from what the tests exercise. The migrations' progress `console.log` lines
 * are silenced for the duration of the run.
 */
export async function migratedUserDb(label = 'berean.db'): Promise<DatabaseAdapter> {
  const db = memoryDb(label)
  const origLog = console.log
  console.log = () => {}
  try {
    await runMigrations(db)
  } finally {
    console.log = origLog
  }
  return db
}

/** Collects `data:changed` events so tests can assert on what a service emitted. */
export function recordingEvents() {
  const events = createServiceEvents()
  const changes: Array<{ entity: string; id?: string; op: string; scope?: string }> = []
  events.on('data:changed', (c) => { changes.push({ entity: c.entity, id: c.id, op: c.op, scope: c.scope }) })
  return { events, changes }
}

export async function fixtureTextDb(verses: Array<{ book: string; ch: number; v: number; text: string; tagged?: string }>, opts: { books?: Array<{ id: string; name: string; short: string; testament: string; chapters: number }> } = {}): Promise<DatabaseAdapter> {
  const db = openNodeSqlite(':memory:', `text:fixture-${Math.random().toString(36).slice(2, 6)}`)
  await db.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL, testament TEXT NOT NULL, chapters_count INTEGER NOT NULL
    );
    CREATE TABLE verses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES books(id), chapter INTEGER NOT NULL,
      verse_num INTEGER NOT NULL, text TEXT NOT NULL, text_tagged TEXT, UNIQUE(book_id, chapter, verse_num)
    );
    CREATE INDEX idx_verses_ref ON verses(book_id, chapter);
    CREATE VIRTUAL TABLE verses_fts USING fts5(text, book_id UNINDEXED, chapter UNINDEXED, verse_num UNINDEXED, content=verses, content_rowid=id);
    CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
      INSERT INTO verses_fts(rowid, text, book_id, chapter, verse_num) VALUES (new.id, new.text, new.book_id, new.chapter, new.verse_num);
    END;
  `)
  const books = opts.books ?? [
    { id: 'GEN', name: 'Genesis', short: 'Gen', testament: 'OT', chapters: 50 },
    { id: 'JHN', name: 'John', short: 'John', testament: 'NT', chapters: 21 },
  ]
  for (const b of books) await db.run('INSERT INTO books VALUES (?,?,?,?,?)', [b.id, b.name, b.short, b.testament, b.chapters])
  for (const v of verses) await db.run('INSERT INTO verses (book_id, chapter, verse_num, text, text_tagged) VALUES (?,?,?,?,?)', [v.book, v.ch, v.v, v.text, v.tagged ?? null])
  return db
}

export function realDataDb(file: string): DatabaseAdapter | null {
  const path = resolve(DATA_DIR, file)
  if (!existsSync(path)) return null
  try {
    return openNodeSqlite(path, `data:${file}`, true)
  } catch {
    return null
  }
}

export function makeContext(parts: Partial<ServiceContext> & { texts?: Record<string, DatabaseAdapter | null> } = {}): ServiceContext {
  const texts = parts.texts ?? {}
  return {
    userDb: parts.userDb ?? memoryDb('berean.db'),
    textDb: parts.textDb ?? (async (id) => texts[id] ?? null),
    lexiconDb: parts.lexiconDb ?? (async () => { throw new Error('lexiconDb not provided to test context') }),
    dataDb: parts.dataDb ?? (async () => null),
    events: parts.events ?? createServiceEvents(),
    now: parts.now ?? (() => Date.now()),
    uuid: parts.uuid ?? defaultUuid,
    isDev: parts.isDev ?? true,
    log: parts.log ?? consoleLogger,
  }
}
