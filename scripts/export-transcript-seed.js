#!/usr/bin/env node
/**
 * Export the YouTube transcripts you fetched (in the dev berean.db) into the
 * bundled data/youtube_seed.db so they ship to production users on the next release.
 *
 * WHY: transcripts are pulled (dev-only, via tactiq.io) into the dev user database
 * at ~/Library/Application Support/Berean-dev/berean.db. To ship them, they must be
 * baked into youtube_seed.db, which the app merges on first launch (mergeYouTubeSeed,
 * gated by youtubeSeedVersion). This copies the youtube_transcripts +
 * youtube_transcript_segments tables from the dev DB into the seed DB.
 *
 * Uses the sqlite3 CLI (macOS /usr/bin/sqlite3) rather than better-sqlite3, which is
 * compiled for Electron's ABI and can't be loaded by plain Node.
 *
 * USAGE:  npm run transcripts:seed
 *   Then:  npm run data:publish     (uploads the refreshed seed for CI)
 *          npm run tag:stable / tag:beta
 *
 * Re-runnable: drops and recreates the transcript tables in the seed each time.
 */

const { execFileSync } = require('child_process')
const { join } = require('path')
const { existsSync } = require('fs')
const os = require('os')

const devDbPath = join(os.homedir(), 'Library', 'Application Support', 'Berean-dev', 'berean.db')
const seedPath = join(__dirname, '..', 'data', 'youtube_seed.db')

if (!existsSync(devDbPath)) { console.error(`[transcripts:seed] dev DB not found: ${devDbPath}`); process.exit(1) }
if (!existsSync(seedPath)) { console.error(`[transcripts:seed] seed DB not found: ${seedPath}`); process.exit(1) }

const esc = (p) => p.replace(/'/g, "''")

const sql = `
PRAGMA journal_mode=DELETE;
DROP TABLE IF EXISTS youtube_transcript_segments;
DROP TABLE IF EXISTS youtube_transcripts;
CREATE TABLE youtube_transcripts (
  video_id      TEXT PRIMARY KEY,
  lang          TEXT NOT NULL DEFAULT 'en',
  source        TEXT NOT NULL DEFAULT 'tactiq',
  fetched_at    INTEGER NOT NULL,
  segment_count INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE TABLE youtube_transcript_segments (
  id       INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  dur_ms   INTEGER NOT NULL DEFAULT 0,
  text     TEXT NOT NULL
);
ATTACH '${esc(devDbPath)}' AS dev;
BEGIN;
INSERT INTO youtube_transcripts (video_id, lang, source, fetched_at, segment_count, duration_ms, error)
  SELECT video_id, lang, source, fetched_at, segment_count, duration_ms, error
  FROM dev.youtube_transcripts WHERE segment_count > 0;
INSERT INTO youtube_transcript_segments (id, video_id, start_ms, dur_ms, text)
  SELECT s.id, s.video_id, s.start_ms, s.dur_ms, s.text
  FROM dev.youtube_transcript_segments s
  WHERE s.video_id IN (SELECT video_id FROM dev.youtube_transcripts WHERE segment_count > 0);
COMMIT;
DETACH dev;
SELECT 'videos=' || (SELECT COUNT(*) FROM youtube_transcripts) ||
       ' segments=' || (SELECT COUNT(*) FROM youtube_transcript_segments);
`

try {
  const out = execFileSync('sqlite3', [seedPath], { input: sql, encoding: 'utf8' })
  console.log(`[transcripts:seed] ${out.trim()} written into ${seedPath}`)
  console.log('[transcripts:seed] next: npm run data:publish, then tag a release.')
  console.log('[transcripts:seed] (SEED_VERSION in electron/db/berean.ts is 2 — bump it if you re-export after a release.)')
} catch (err) {
  console.error('[transcripts:seed] failed:', err.message)
  process.exit(1)
}
