import type { DatabaseAdapter } from '../db/DatabaseAdapter'

/**
 * Merges the bundled YouTube index (`youtube_index.db`, D-007 — videos, channel sync rows and
 * transcript *metadata*) into berean.db once per seed version, exactly as desktop's
 * `mergeYouTubeSeed` (electron/db/berean.ts) does with the full seed. Transcript segments are not
 * in the index; they arrive per channel through downloaded packs (`mergeTranscriptPack`).
 *
 * Both functions are plain adapter code so the iOS host runs them over the BereanSQLite plugin;
 * desktop keeps its own better-sqlite3 path untouched.
 */
export async function mergeYoutubeIndex(db: DatabaseAdapter, attachPath: string): Promise<{ merged: boolean; seedVersion: number }> {
  await db.attach(attachPath, 'ytindex')
  try {
    const seedVersion = Number((await db.get<{ value: string }>("SELECT value FROM ytindex.meta WHERE key = 'seed_version'"))?.value ?? 0)
    const current = Number(JSON.parse((await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'youtubeSeedVersion'"))?.value ?? '0'))
    if (current >= seedVersion) return { merged: false, seedVersion }
    await db.transaction(async (tx) => {
      await tx.run(`
        INSERT OR IGNORE INTO youtube_videos
          (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, is_live_now, fetched_at, duration_seconds, is_starred, description)
        SELECT video_id, title, published, channel_name, channel_handle, thumbnail_url, type, is_live_now, fetched_at, duration_seconds, is_starred, description
        FROM ytindex.youtube_videos
      `)
      // Stars synced from another device (youtube_user) win over the seed's is_starred.
      await tx.run(`
        UPDATE youtube_videos SET is_starred = (SELECT u.is_starred FROM youtube_user u WHERE u.video_id = youtube_videos.video_id)
        WHERE video_id IN (SELECT video_id FROM youtube_user)
      `)
      await tx.run(`
        INSERT OR IGNORE INTO youtube_sync (channel_handle, last_full_sync, last_refresh)
        SELECT channel_handle, last_full_sync, last_refresh FROM ytindex.youtube_sync
      `)
      // Transcript metadata: lets the UI show "transcript available" before the pack is downloaded.
      // segment_count stays as published; `getTranscriptStatus` reports the videos whose segments
      // are actually present (see youtubeService), so a not-yet-downloaded transcript is never
      // mistaken for a downloaded one.
      await tx.run(`
        INSERT OR IGNORE INTO youtube_transcripts (video_id, lang, source, fetched_at, segment_count, duration_ms, error)
        SELECT video_id, lang, source, fetched_at, segment_count, duration_ms, error FROM ytindex.youtube_transcripts
      `)
      await tx.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('youtubeSeedVersion', ?)", [JSON.stringify(seedVersion)])
    })
    return { merged: true, seedVersion }
  } finally {
    await db.detach('ytindex').catch(() => {})
  }
}

/**
 * Merges one downloaded transcript pack (`youtube_transcripts/<handle>.db`) into berean.db. The
 * segment inserts fire the existing FTS5 triggers, so transcript search covers the pack at once.
 * Idempotent: a pack merged twice adds nothing (segments are replaced per video, not duplicated).
 */
export async function mergeTranscriptPack(db: DatabaseAdapter, attachPath: string): Promise<{ videos: number; segments: number; channelHandle: string }> {
  await db.attach(attachPath, 'ytpack')
  try {
    const handle = (await db.get<{ value: string }>("SELECT value FROM ytpack.meta WHERE key = 'channel_handle'"))?.value ?? ''
    let videos = 0, segments = 0
    await db.transaction(async (tx) => {
      const ids = (await tx.all<{ video_id: string }>('SELECT video_id FROM ytpack.youtube_transcripts')).map((r) => r.video_id)
      for (const id of ids) {
        await tx.run('DELETE FROM youtube_transcript_segments WHERE video_id = ?', [id])
        await tx.run(`
          INSERT OR REPLACE INTO youtube_transcripts (video_id, lang, source, fetched_at, segment_count, duration_ms, error)
          SELECT video_id, lang, source, fetched_at, segment_count, duration_ms, error FROM ytpack.youtube_transcripts WHERE video_id = ?
        `, [id])
        const r = await tx.run(`
          INSERT INTO youtube_transcript_segments (video_id, start_ms, dur_ms, text)
          SELECT video_id, start_ms, dur_ms, text FROM ytpack.youtube_transcript_segments WHERE video_id = ? ORDER BY start_ms
        `, [id])
        segments += r.changes
        videos++
      }
    })
    return { videos, segments, channelHandle: handle }
  } finally {
    await db.detach('ytpack').catch(() => {})
  }
}
