import { describe, it, expect } from 'vitest'
import { memoryDb } from './testDb'
import { BEREAN_MIGRATIONS, BEREAN_SCHEMA_VERSION, currentSchemaVersion, runMigrations, type Migration } from '../bereanMigrations'

const EXPECTED_TABLES = [
  'notes', 'notes_fts', 'highlights', 'settings', 'workspaces', 'youtube_videos', 'youtube_sync',
  'youtube_watch_history', 'history', 'note_folders', 'pdfs', 'pdf_highlights', 'note_versions',
  'youtube_transcripts', 'youtube_transcript_segments', 'youtube_transcripts_fts', 'ai_chats',
  'note_heading_collapse', 'note_thread_collapse', 'playlists', 'playlist_items', 'trail_sessions',
  'trail_paused_intervals', 'trail_nodes', 'trail_connections', 'trail_embeddings', 'verse_tags',
  'verse_tag_members', 'verse_tag_verse', 'trail_collapse', 'trail_notes', 'trail_tags',
  'trail_tag_members', 'tag_edges', 'schema_version',
  'sessions', 'tabs', 'archived_groups', 'session_local_state',
  'sync_state', 'sync_outbox', 'sync_record_meta', 'sync_applied', 'sync_failed',
]

async function tableNames(db: ReturnType<typeof memoryDb>): Promise<string[]> {
  const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%'")
  return rows.map((r) => r.name).sort()
}

describe('bereanMigrations (shared runner)', () => {
  it('has the v42 history with the deliberate v18 gap', () => {
    const versions = BEREAN_MIGRATIONS.map((m) => m.version)
    expect(versions[0]).toBe(1)
    expect(versions).not.toContain(18)
    expect(BEREAN_SCHEMA_VERSION).toBe(44)
    // strictly increasing
    for (let i = 1; i < versions.length; i++) expect(versions[i]).toBeGreaterThan(versions[i - 1])
  })

  it('fresh install: applies every migration and creates every table', async () => {
    const db = memoryDb()
    const applied = await runMigrations(db)
    expect(applied.length).toBe(BEREAN_MIGRATIONS.length)
    expect(await currentSchemaVersion(db)).toBe(44)
    const names = await tableNames(db)
    for (const t of EXPECTED_TABLES) expect(names, `missing table ${t}`).toContain(t)
    // v1 seeded defaults are present and JSON-encoded
    expect(await db.get('SELECT value FROM settings WHERE key = ?', ['defaultText'])).toEqual({ value: '"kjva"' })
    expect(await db.get('SELECT value FROM settings WHERE key = ?', ['onboardingCompleted'])).toEqual({ value: 'false' })
    // notes has every column added across the history
    const cols = (await db.all<{ name: string }>('PRAGMA table_info(notes)')).map((c) => c.name)
    for (const c of ['imported_at', 'folder_id', 'text_id', 'idiom_term', 'idiom_meaning', 'idiom_aliases', 'idiom_auto_variants', 'idiom_data', 'status', 'deleted_at', 'icon', 'pinned']) {
      expect(cols, `notes.${c}`).toContain(c)
    }
    // FTS5 index works end to end through the triggers
    await db.run("INSERT INTO notes (id, title, content, created_at, updated_at) VALUES ('n1', 'Creation', 'In the beginning', 1, 1)")
    expect(await db.all("SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?", ['beginning'])).toHaveLength(1)
  })

  it('is idempotent: a second run applies nothing', async () => {
    const db = memoryDb()
    await runMigrations(db)
    expect(await runMigrations(db)).toEqual([])
    expect(await currentSchemaVersion(db)).toBe(44)
  })

  it('upgrades a database left at an intermediate version', async () => {
    const db = memoryDb()
    const upTo20 = BEREAN_MIGRATIONS.filter((m) => m.version <= 20)
    await runMigrations(db, upTo20)
    expect(await currentSchemaVersion(db)).toBe(20)
    await db.run("INSERT INTO notes (id, title, content, created_at, updated_at, tags) VALUES ('n1', 'Old', 'kept', 1, 1, '[]')")
    const applied = await runMigrations(db)
    expect(applied[0]).toBe(21)
    expect(await currentSchemaVersion(db)).toBe(44)
    expect(await db.get('SELECT title FROM notes WHERE id = ?', ['n1'])).toEqual({ title: 'Old' })
  })

  it('a failing migration rolls back atomically and leaves the version unchanged', async () => {
    const db = memoryDb()
    await runMigrations(db)
    const bad: Migration = {
      version: 999,
      up: async (tx) => {
        await tx.exec('CREATE TABLE will_not_survive (x INTEGER)')
        throw new Error('simulated failure')
      },
    }
    await expect(runMigrations(db, [...BEREAN_MIGRATIONS, bad])).rejects.toThrow('simulated failure')
    expect(await currentSchemaVersion(db)).toBe(BEREAN_SCHEMA_VERSION)
    expect(await tableNames(db)).not.toContain('will_not_survive')
  })

  it('v6 canonicalises imported BibleGateway/e-Sword verse refs', async () => {
    const db = memoryDb()
    await runMigrations(db, BEREAN_MIGRATIONS.filter((m) => m.version <= 5))
    await db.run("INSERT INTO notes (id, title, content, verse_ref, tags, created_at, updated_at) VALUES ('a', 't', '', 'John 3:16', '[\"biblegateway\"]', 1, 1)")
    await db.run("INSERT INTO notes (id, title, content, verse_ref, tags, created_at, updated_at) VALUES ('b', 't', '', 'GEN.1.1', '[\"esword\"]', 1, 1)")
    await runMigrations(db, BEREAN_MIGRATIONS.filter((m) => m.version <= 6))
    expect(await db.get('SELECT verse_ref FROM notes WHERE id = ?', ['a'])).toEqual({ verse_ref: 'JHN.3.16' })
    expect(await db.get('SELECT verse_ref FROM notes WHERE id = ?', ['b'])).toEqual({ verse_ref: 'GEN.1.1' })
  })

  it('v42 backfills verse_tags.color_slot round-robin', async () => {
    const db = memoryDb()
    await runMigrations(db, BEREAN_MIGRATIONS.filter((m) => m.version <= 41))
    for (let i = 0; i < 14; i++) await db.run('INSERT INTO verse_tags (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)', [`t${i}`, `tag${i}`, i, i])
    await runMigrations(db)
    const slots = (await db.all<{ color_slot: number }>('SELECT color_slot FROM verse_tags ORDER BY sort_order')).map((r) => r.color_slot)
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1])
  })
})
