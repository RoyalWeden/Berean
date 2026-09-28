#!/usr/bin/env node
/**
 * Splits data/youtube_seed.db (desktop's bundled YouTube seed, ~190 MB, 96 % transcript segments)
 * into what the iPhone ships and what it downloads on demand (docs/mobile/decisions.md D-007,
 * docs/mobile/audit/youtube-seed.md):
 *
 *   data/youtube_index.db                       bundled on iOS (~7 MB): youtube_videos,
 *                                               youtube_sync, youtube_transcripts (metadata only —
 *                                               which videos have a transcript, how long, when fetched)
 *   data/youtube_transcripts/<handle>.db        one transcript pack per channel: the
 *                                               youtube_transcript_segments rows for that channel's
 *                                               videos (+ the matching youtube_transcripts rows), so a
 *                                               user downloads only the channels they study
 *   data/youtube_transcripts/manifest.json      { version, generatedAt, seedVersion, packs[] } with
 *                                               bytes, sha256, video/segment counts per pack — the
 *                                               downloader verifies integrity and detects new versions
 *
 * Desktop keeps bundling and merging youtube_seed.db exactly as before; this script only derives
 * the iOS artefacts from the same seed. Re-run after `youtube:buildSeed` (dev) regenerates the seed.
 *
 *   node scripts/data/split-youtube-seed.mjs [--seed data/youtube_seed.db] [--out data] [--seed-version N]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const SEED = resolve(args.get('--seed') ?? 'data/youtube_seed.db')
const OUT = resolve(args.get('--out') ?? 'data')
const SEED_VERSION = Number(args.get('--seed-version') ?? readSeedVersion())

function readSeedVersion() {
  // Mirrors SEED_VERSION in electron/db/berean.ts so the manifest names the seed it came from.
  try {
    const src = readFileSync(resolve('electron/db/berean.ts'), 'utf8')
    const m = src.match(/const SEED_VERSION = (\d+)/)
    return m ? Number(m[1]) : 0
  } catch { return 0 }
}

if (!existsSync(SEED)) { console.error(`seed not found: ${SEED}`); process.exit(1) }
const seed = new DatabaseSync(SEED, { readOnly: true })
const packsDir = join(OUT, 'youtube_transcripts')
mkdirSync(packsDir, { recursive: true })

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const escape = (p) => p.replace(/'/g, "''")

// 1. youtube_index.db ---------------------------------------------------------------------------
const indexPath = join(OUT, 'youtube_index.db')
rmSync(indexPath, { force: true }); rmSync(`${indexPath}-journal`, { force: true })
const index = new DatabaseSync(indexPath)
index.exec(`ATTACH '${escape(SEED)}' AS seed`)
index.exec(`
  CREATE TABLE youtube_videos AS SELECT * FROM seed.youtube_videos;
  CREATE TABLE youtube_sync AS SELECT * FROM seed.youtube_sync;
  CREATE TABLE youtube_transcripts AS SELECT * FROM seed.youtube_transcripts;
  CREATE UNIQUE INDEX idx_yi_video ON youtube_videos(video_id);
  CREATE INDEX idx_yi_handle ON youtube_videos(channel_handle);
  CREATE INDEX idx_yi_published ON youtube_videos(published);
  CREATE UNIQUE INDEX idx_yi_transcript ON youtube_transcripts(video_id);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)
index.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('seed_version', String(SEED_VERSION))
index.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('generated_at', new Date().toISOString())
index.exec('DETACH seed')
index.exec('PRAGMA journal_mode = DELETE; VACUUM')
index.close()

// 2. transcript packs per channel ------------------------------------------------------------------
// The seed has no index on segments.video_id (only the integer primary key), so selecting one
// channel's segments would scan all 2.7 M rows per channel (~10 s × 62). A temp (video_id → id
// range) map makes each pack a primary-key range lookup instead.
seed.exec(`
  CREATE TEMP TABLE seg_span AS
    SELECT video_id, MIN(id) AS id_from, MAX(id) AS id_to FROM youtube_transcript_segments GROUP BY video_id;
  CREATE INDEX temp.idx_seg_span ON seg_span(video_id);
`)
const channels = seed.prepare(`
  SELECT v.channel_handle AS handle, v.channel_name AS name,
         COUNT(DISTINCT t.video_id) AS videos, COALESCE(SUM(t.segment_count), 0) AS segments
  FROM youtube_videos v JOIN youtube_transcripts t ON t.video_id = v.video_id AND t.error IS NULL
  GROUP BY v.channel_handle ORDER BY v.channel_handle
`).all()
const packs = []
for (const ch of channels) {
  const file = `${ch.handle.replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '_')}.db`
  const path = join(packsDir, file)
  rmSync(path, { force: true }); rmSync(`${path}-journal`, { force: true })
  const pack = new DatabaseSync(path)
  pack.exec(`
    CREATE TABLE youtube_transcripts (video_id TEXT PRIMARY KEY, lang TEXT NOT NULL DEFAULT 'en', source TEXT NOT NULL DEFAULT 'tactiq', fetched_at INTEGER NOT NULL, segment_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE youtube_transcript_segments (id INTEGER PRIMARY KEY, video_id TEXT NOT NULL, start_ms INTEGER NOT NULL, dur_ms INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const videos = seed.prepare(`
    SELECT t.video_id, t.lang, t.source, t.fetched_at, t.segment_count, t.duration_ms, t.error, sp.id_from, sp.id_to
    FROM youtube_transcripts t JOIN youtube_videos v ON v.video_id = t.video_id
    LEFT JOIN seg_span sp ON sp.video_id = t.video_id
    WHERE v.channel_handle = ? AND t.error IS NULL ORDER BY t.video_id
  `).all(ch.handle)
  const segs = seed.prepare('SELECT id, video_id, start_ms, dur_ms, text FROM youtube_transcript_segments WHERE id BETWEEN ? AND ? AND video_id = ? ORDER BY id')
  const insT = pack.prepare('INSERT INTO youtube_transcripts VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insS = pack.prepare('INSERT INTO youtube_transcript_segments VALUES (?, ?, ?, ?, ?)')
  pack.exec('BEGIN')
  for (const v of videos) {
    insT.run(v.video_id, v.lang, v.source, v.fetched_at, v.segment_count, v.duration_ms, v.error)
    if (v.id_from != null) for (const sg of segs.all(v.id_from, v.id_to, v.video_id)) insS.run(sg.id, sg.video_id, sg.start_ms, sg.dur_ms, sg.text)
  }
  const ins = pack.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
  ins.run('channel_handle', ch.handle); ins.run('channel_name', ch.name); ins.run('seed_version', String(SEED_VERSION))
  pack.exec('COMMIT')
  pack.exec('CREATE INDEX idx_pack_segments ON youtube_transcript_segments(video_id, start_ms)')
  pack.exec('PRAGMA journal_mode = DELETE; VACUUM')
  pack.close()
  packs.push({ channelHandle: ch.handle, channelName: ch.name, file, bytes: statSync(path).size, sha256: sha256(path), videos: ch.videos, segments: ch.segments })
  console.log(`  ${file.padEnd(36)} ${(statSync(path).size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${String(ch.videos).padStart(5)} videos  ${String(ch.segments).padStart(8)} segments`)
}
seed.close()

// 3. manifest ----------------------------------------------------------------------------------------
const manifest = {
  format: 1,
  seedVersion: SEED_VERSION,
  generatedAt: new Date().toISOString(),
  index: { file: 'youtube_index.db', bytes: statSync(indexPath).size, sha256: sha256(indexPath) },
  packs,
}
writeFileSync(join(packsDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
const total = packs.reduce((n, p) => n + p.bytes, 0)
console.log(`\nindex: ${(manifest.index.bytes / 1024 / 1024).toFixed(1)} MB → ${indexPath}`)
console.log(`packs: ${packs.length} channels, ${(total / 1024 / 1024).toFixed(1)} MB total → ${packsDir}/`)
console.log(`manifest: ${join(packsDir, 'manifest.json')} (seed v${SEED_VERSION})`)
