import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, renameSync, readdirSync, statSync, rmSync } from 'fs'
import { SyncSqliteAdapter } from './adapters/syncSqliteAdapter'
import { runMigrations } from '../../src/platform/db/bereanMigrations'

// Merge YouTube seed data from the bundled youtube_seed.db into the user's
// berean.db. Uses INSERT OR IGNORE so existing user data is never overwritten.
// Runs once (tracked by the 'youtubeSeedVersion' setting) so re-installs or
// app updates can push a refreshed seed by bumping the seed version number.
export function mergeYouTubeSeed(db: DB): void {
  const SEED_VERSION = 2 // bump this when youtube_seed.db is regenerated (v2 adds transcripts)

  // Check if already seeded at this version
  const row = db.prepare("SELECT value FROM settings WHERE key='youtubeSeedVersion'").get() as { value: string } | undefined
  if (row && parseInt(row.value ?? '0') >= SEED_VERSION) return

  const seedPath = app.isPackaged
    ? join(process.resourcesPath, 'data', 'youtube_seed.db')
    : join(app.getAppPath(), 'data', 'youtube_seed.db')

  if (!existsSync(seedPath)) {
    return
  }

  try {
    db.exec(`ATTACH '${seedPath.replace(/'/g, "''")}' AS seed`)

    db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO youtube_videos
          (video_id, title, published, channel_name, channel_handle,
           thumbnail_url, type, is_live_now, fetched_at,
           duration_seconds, is_starred, description)
        SELECT
          video_id, title, published, channel_name, channel_handle,
          thumbnail_url, type, is_live_now, fetched_at,
          duration_seconds, is_starred, description
        FROM seed.youtube_videos
      `).run()

      // Stars synced from another device (youtube_user, v45) win over the seed's is_starred.
      db.prepare(`
        UPDATE youtube_videos SET is_starred = (SELECT u.is_starred FROM youtube_user u WHERE u.video_id = youtube_videos.video_id)
        WHERE video_id IN (SELECT video_id FROM youtube_user)
      `).run()

      db.prepare(`
        INSERT OR IGNORE INTO youtube_sync (channel_handle, last_full_sync, last_refresh)
        SELECT channel_handle, last_full_sync, last_refresh FROM seed.youtube_sync
      `).run()

      // Transcripts (only present in seed v2+). Guard against an older seed that lacks them.
      const hasTranscripts = db.prepare(
        "SELECT name FROM seed.sqlite_master WHERE type='table' AND name='youtube_transcripts'"
      ).get() as { name: string } | undefined

      if (hasTranscripts) {
        // Metadata rows FIRST — youtube_transcript_segments.video_id REFERENCES
        // youtube_transcripts(video_id) and foreign_keys=ON (see getBereanDb below), so
        // inserting segments before their parent row exists violates the FK constraint and
        // aborts the whole transaction. (Previously segments were inserted first here, which
        // silently rolled back this entire merge — and re-attempted and re-failed on every
        // single app launch, since youtubeSeedVersion below is only ever reached on success.)
        db.prepare(`
          INSERT OR IGNORE INTO youtube_transcripts
            (video_id, lang, source, fetched_at, segment_count, duration_ms, error)
          SELECT video_id, lang, source, fetched_at, segment_count, duration_ms, error
          FROM seed.youtube_transcripts
        `).run()

        // Then segments, gated on youtube_transcript_segments itself (not youtube_transcripts —
        // that table was just populated with EVERY seed video_id above, so gating on it here
        // would skip every row). Checking segments directly still correctly skips videos the
        // user already had transcript content for from an earlier seed merge. We omit the
        // explicit segment `id` so SQLite assigns fresh rowids and the FTS5 AFTER-INSERT
        // trigger indexes each row.
        db.prepare(`
          INSERT INTO youtube_transcript_segments (video_id, start_ms, dur_ms, text)
          SELECT s.video_id, s.start_ms, s.dur_ms, s.text
          FROM seed.youtube_transcript_segments s
          WHERE s.video_id NOT IN (SELECT DISTINCT video_id FROM youtube_transcript_segments)
        `).run()
      }
    })()

    db.exec('DETACH seed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('youtubeSeedVersion', ?)").run(String(SEED_VERSION))
  } catch (err) {
    console.error('[mergeYouTubeSeed] failed, rolled back:', err)
    try { db.exec('DETACH seed') } catch { /* ignore */ }
  }
}

type DB = InstanceType<typeof Database>

let _db: DB | null = null
let _initPromise: Promise<DB> | null = null

/**
 * Open (or create) berean.db in userData and bring it to the current schema version through the
 * SHARED migration runner (src/platform/db/bereanMigrations.ts — the same history iOS runs).
 * main.ts awaits this once at startup before any IPC handler is registered; everything after that
 * uses the synchronous `getBereanDb()`.
 */
export function initBereanDb(): Promise<DB> {
  if (_db) return Promise.resolve(_db)
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })

    const dbPath = join(userDataPath, 'berean.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Before an upgrade migrates berean.db: integrity check and a consistent backup (VACUUM INTO,
    // WAL-safe), newest 3 kept in userData/backups (DATA-SAFE-070).
    await runMigrations(new SyncSqliteAdapter(db, 'berean.db'), undefined, {
      beforeMigrate: async (from, to) => {
        const dir = join(userDataPath, 'backups')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        const tmp = join(dir, `berean-v${from}-to-v${to}-${Date.now()}.db`)
        db.prepare('VACUUM INTO ?').run(tmp + '.tmp')
        renameSync(tmp + '.tmp', tmp)
        const old = readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
        for (const o of old.slice(3)) rmSync(join(dir, o.f), { force: true })
        console.log(`[berean-db] backup before migration: ${tmp}`)
      },
      onBackupFailed: (err) => console.warn('[berean-db] backup before migration failed', err),
    })

    _db = db
    return db
  })()
  return _initPromise
}

/** The open user DB. Throws if `initBereanDb()` has not completed — a startup-order bug, never a
 *  normal condition (the old code opened + migrated synchronously here, so callers never had to
 *  think about ordering; keeping the throw loud makes any regression obvious). */
export function getBereanDb(): DB {
  if (!_db) throw new Error('berean.db is not open yet — main.ts must await initBereanDb() first')
  return _db
}

export function closeBereanDb(): void {
  _db?.close()
  _db = null
  _initPromise = null
}
