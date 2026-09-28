import type { ServiceContext } from './context'
import type { DatabaseAdapter } from '../db/DatabaseAdapter'

/**
 * YouTube library — DB-backed subset extracted verbatim from electron/ipc/youtube.ts (Phase
 * 1/3). Everything that touches the network (refresh, fullSync, fetchDescription,
 * fetchTranscripts/clearTranscripts — dev-only tactiq scraping, buildSeed, searchVideos'
 * desktop-only sync export) stays in electron/ipc/youtube.ts. Only pure reads/writes over
 * berean.db live here: the stored video library, star/watch-position/watch-history state, and
 * the already-fetched transcript store (read + full-text search over it).
 */

export interface VideoEntry {
  videoId: string
  title: string
  published: string        // exact ISO-8601 date (from API) or approximate (from InnerTube)
  channelName: string
  channelHandle: string
  thumbnailUrl: string
  type: 'video' | 'short' | 'live'
  isLiveNow: boolean
  durationSeconds: number  // 0 when unknown (InnerTube/RSS don't provide duration)
  isStarred: boolean
  description: string
}

export interface WatchHistoryEntry {
  videoId: string
  positionSeconds: number
  lastWatched: string
  title: string
  channelName: string
  thumbnailUrl: string
}

export interface TranscriptSegment {
  startMs: number
  durMs: number
  text: string
}

export interface TranscriptSearchResultEntry {
  videoId: string
  snippet: string
  startMs: number
  matchCount: number
  title: string
  channelName: string
  rank: number
}

interface VideoRow {
  video_id: string
  title: string
  published: string
  channel_name: string
  channel_handle: string
  thumbnail_url: string
  type: VideoEntry['type']
  is_live_now: number
  duration_seconds: number | null
  is_starred: number
  description: string | null
}

interface WatchHistoryRow {
  video_id: string
  position_seconds: number
  last_watched: string
  title: string
  channel_name: string
  thumbnail_url: string
}

// Channels that changed their YouTube handle. Rows already stored under the old handle are
// re-keyed once (on first load) so the video list, sync bookkeeping and watch history keep
// following the channel instead of orphaning under a handle CHANNELS no longer lists.
const HANDLE_RENAMES: Record<string, string> = {
  '@michaelfollowsyah': '@michael4yeshua',
}

/**
 * Copies the synced youtube_user row for `videoId` into youtube_videos.is_starred and
 * youtube_watch_history (the tables the UI reads); a missing youtube_user row clears both. Used
 * by the service after a remote change and by the sync entity adapter (src/platform/sync/entities.ts).
 * Stars for videos this device has not fetched yet are applied when the videos arrive
 * (electron/ipc/youtube.ts upsertVideos, mergeYouTubeSeed).
 */
export async function mirrorYoutubeUserRow(db: DatabaseAdapter, videoId: string): Promise<void> {
  const u = await db.get<{ is_starred: number; position_seconds: number; last_watched: string | null; title: string; channel_name: string; thumbnail_url: string }>('SELECT * FROM youtube_user WHERE video_id = ?', [videoId])
  if (!u) {
    await db.run('DELETE FROM youtube_watch_history WHERE video_id = ?', [videoId])
    await db.run('UPDATE youtube_videos SET is_starred = 0 WHERE video_id = ?', [videoId])
    return
  }
  await db.run('UPDATE youtube_videos SET is_starred = ? WHERE video_id = ?', [u.is_starred ? 1 : 0, videoId])
  if (u.last_watched) {
    await db.run(`
      INSERT INTO youtube_watch_history (video_id, position_seconds, last_watched, title, channel_name, thumbnail_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        position_seconds = excluded.position_seconds,
        last_watched     = excluded.last_watched,
        title            = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END,
        channel_name     = CASE WHEN excluded.channel_name != '' THEN excluded.channel_name ELSE channel_name END,
        thumbnail_url    = CASE WHEN excluded.thumbnail_url != '' THEN excluded.thumbnail_url ELSE thumbnail_url END
    `, [videoId, u.position_seconds, u.last_watched, u.title, u.channel_name, u.thumbnail_url])
  } else {
    await db.run('DELETE FROM youtube_watch_history WHERE video_id = ?', [videoId])
  }
}

export function createYoutubeService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  let handleRenamesApplied = false
  async function applyHandleRenames(): Promise<void> {
    if (handleRenamesApplied) return
    handleRenamesApplied = true
    for (const [from, to] of Object.entries(HANDLE_RENAMES)) {
      try {
        await db().run('UPDATE youtube_videos SET channel_handle = ? WHERE channel_handle = ?', [to, from])
        await db().run('DELETE FROM youtube_sync WHERE channel_handle = ? AND EXISTS (SELECT 1 FROM youtube_sync WHERE channel_handle = ?)', [from, to])
        await db().run('UPDATE youtube_sync SET channel_handle = ? WHERE channel_handle = ?', [to, from])
      } catch { /* table shapes are stable; a failure here must never block the video list */ }
    }
  }

  async function loadAll(): Promise<VideoEntry[]> {
    await applyHandleRenames()
    const rows = await db().all<VideoRow>('SELECT * FROM youtube_videos ORDER BY published DESC')
    return rows.map((row) => ({
      videoId:         row.video_id,
      title:           row.title,
      published:       row.published,
      channelName:     row.channel_name,
      channelHandle:   row.channel_handle,
      thumbnailUrl:    row.thumbnail_url,
      type:            row.type,
      isLiveNow:       Boolean(row.is_live_now),
      durationSeconds: row.duration_seconds ?? 0,
      isStarred:       Boolean(row.is_starred),
      description:     row.description ?? '',
    }))
  }

  // ── user data (stars + resume positions) ─────────────────────────────────────────────
  // youtube_videos.is_starred and youtube_watch_history are what the UI reads (unchanged); the
  // synced copy is youtube_user (v45), written alongside them here and mirrored back by
  // `applyUserRow` when a change arrives from another device.

  async function toggleStar(videoId: string): Promise<{ isStarred: boolean }> {
    const row = await db().get<{ is_starred: number; title: string; channel_name: string; thumbnail_url: string }>('SELECT is_starred, title, channel_name, thumbnail_url FROM youtube_videos WHERE video_id = ?', [videoId])
    const newVal = row ? (row.is_starred ? 0 : 1) : 0
    await db().run('UPDATE youtube_videos SET is_starred = ? WHERE video_id = ?', [newVal, videoId])
    await db().run(`
      INSERT INTO youtube_user (video_id, is_starred, position_seconds, last_watched, title, channel_name, thumbnail_url, updated_at)
      VALUES (?, ?, 0, NULL, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        is_starred = excluded.is_starred,
        title = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END,
        channel_name = CASE WHEN excluded.channel_name != '' THEN excluded.channel_name ELSE channel_name END,
        thumbnail_url = CASE WHEN excluded.thumbnail_url != '' THEN excluded.thumbnail_url ELSE thumbnail_url END,
        updated_at = excluded.updated_at
    `, [videoId, newVal, row?.title ?? '', row?.channel_name ?? '', row?.thumbnail_url ?? '', ctx.now()])
    await pruneUserRow(videoId)
    ctx.events.emit('data:changed', { entity: 'youtube_user', id: videoId, op: 'upsert' })
    return { isStarred: Boolean(newVal) }
  }

  async function savePosition(videoId: string, seconds: number, meta: { title: string; channelName: string; thumbnailUrl: string }): Promise<void> {
    const lastWatched = new Date(ctx.now()).toISOString()
    await db().run(`
      INSERT INTO youtube_watch_history (video_id, position_seconds, last_watched, title, channel_name, thumbnail_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        position_seconds = excluded.position_seconds,
        last_watched     = excluded.last_watched,
        title            = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END,
        channel_name     = CASE WHEN excluded.channel_name != '' THEN excluded.channel_name ELSE channel_name END,
        thumbnail_url    = CASE WHEN excluded.thumbnail_url != '' THEN excluded.thumbnail_url ELSE thumbnail_url END
    `, [videoId, seconds, lastWatched, meta.title, meta.channelName, meta.thumbnailUrl])
    await db().run(`
      INSERT INTO youtube_user (video_id, is_starred, position_seconds, last_watched, title, channel_name, thumbnail_url, updated_at)
      VALUES (?, COALESCE((SELECT is_starred FROM youtube_videos WHERE video_id = ?), 0), ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        position_seconds = excluded.position_seconds,
        last_watched     = excluded.last_watched,
        title            = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END,
        channel_name     = CASE WHEN excluded.channel_name != '' THEN excluded.channel_name ELSE channel_name END,
        thumbnail_url    = CASE WHEN excluded.thumbnail_url != '' THEN excluded.thumbnail_url ELSE thumbnail_url END,
        updated_at       = excluded.updated_at
    `, [videoId, videoId, seconds, lastWatched, meta.title, meta.channelName, meta.thumbnailUrl, ctx.now()])
    ctx.events.emit('data:changed', { entity: 'youtube_user', id: videoId, op: 'upsert' })
  }

  async function getPosition(videoId: string): Promise<number> {
    const row = await db().get<{ position_seconds: number }>('SELECT position_seconds FROM youtube_watch_history WHERE video_id = ?', [videoId])
    return row?.position_seconds ?? 0
  }

  async function getWatchHistory(): Promise<WatchHistoryEntry[]> {
    const rows = await db().all<WatchHistoryRow>('SELECT * FROM youtube_watch_history ORDER BY last_watched DESC')
    return rows.map((row) => ({
      videoId:         row.video_id,
      positionSeconds: row.position_seconds,
      lastWatched:     row.last_watched,
      title:           row.title,
      channelName:     row.channel_name,
      thumbnailUrl:    row.thumbnail_url,
    }))
  }

  /** A youtube_user row with nothing left in it (not starred, no position) is removed. */
  async function pruneUserRow(videoId: string): Promise<void> {
    await db().run('DELETE FROM youtube_user WHERE video_id = ? AND is_starred = 0 AND last_watched IS NULL', [videoId])
  }

  async function removeFromHistory(videoId: string): Promise<void> {
    await db().run('DELETE FROM youtube_watch_history WHERE video_id = ?', [videoId])
    await db().run('UPDATE youtube_user SET position_seconds = 0, last_watched = NULL, updated_at = ? WHERE video_id = ?', [ctx.now(), videoId])
    await pruneUserRow(videoId)
    const still = await db().get('SELECT 1 FROM youtube_user WHERE video_id = ?', [videoId])
    ctx.events.emit('data:changed', { entity: 'youtube_user', id: videoId, op: still ? 'upsert' : 'delete' })
  }

  async function clearWatchHistory(): Promise<void> {
    await db().run('DELETE FROM youtube_watch_history')
    await db().run('UPDATE youtube_user SET position_seconds = 0, last_watched = NULL, updated_at = ?', [ctx.now()])
    await db().run('DELETE FROM youtube_user WHERE is_starred = 0 AND last_watched IS NULL')
    ctx.events.emit('data:changed', { entity: 'youtube_user', op: 'bulk' })
  }

  /** Clears the fetched video cache. Stars survive in youtube_user and are re-applied when the
   *  videos are fetched again (electron/ipc/youtube.ts upsertVideos, mergeYouTubeSeed). */
  async function clearAll(): Promise<void> {
    await db().run('DELETE FROM youtube_videos')
    await db().run('DELETE FROM youtube_sync')
    await db().run("DELETE FROM settings WHERE key LIKE 'ytHandle:%'")
    ctx.events.emit('data:changed', { entity: 'youtube_user', op: 'bulk' })
  }

  /** Mirror a youtube_user row (as applied by sync from another device) into the tables the UI
   *  reads. */
  async function applyUserRow(videoId: string): Promise<void> {
    await mirrorYoutubeUserRow(db(), videoId)
  }

  async function getTranscript(videoId: string): Promise<TranscriptSegment[]> {
    const rows = await db().all<{ start_ms: number; dur_ms: number; text: string }>(
      'SELECT start_ms, dur_ms, text FROM youtube_transcript_segments WHERE video_id = ? ORDER BY start_ms ASC',
      [videoId],
    )
    return rows.map((r) => ({ startMs: r.start_ms, durMs: r.dur_ms, text: r.text }))
  }

  /** Videos whose transcript segments are present locally. Checks the segments themselves (not
   *  the metadata's segment_count) because on iOS the bundled index carries metadata for every
   *  transcript while the segments arrive per channel pack (D-007); on desktop both agree. */
  async function getTranscriptStatus(): Promise<string[]> {
    const rows = await db().all<{ video_id: string }>(`
      SELECT t.video_id FROM youtube_transcripts t
      WHERE t.segment_count > 0 AND EXISTS (SELECT 1 FROM youtube_transcript_segments s WHERE s.video_id = t.video_id)
    `)
    return rows.map((r) => r.video_id)
  }

  /** Per channel: how many transcripts exist in the index and how many are downloaded — drives
   *  the on-demand transcript pack UI (Phase 17). */
  async function getTranscriptAvailability(): Promise<Array<{ channelHandle: string; channelName: string; available: number; downloaded: number }>> {
    return db().all(`
      SELECT v.channel_handle AS channelHandle, MAX(v.channel_name) AS channelName,
             COUNT(*) AS available,
             SUM(CASE WHEN EXISTS (SELECT 1 FROM youtube_transcript_segments s WHERE s.video_id = t.video_id) THEN 1 ELSE 0 END) AS downloaded
      FROM youtube_transcripts t JOIN youtube_videos v ON v.video_id = t.video_id
      WHERE t.segment_count > 0 AND t.error IS NULL
      GROUP BY v.channel_handle ORDER BY v.channel_handle
    `)
  }

  /** Full-text search over stored transcript captions (FTS5). Returns one row per matching
   *  video with a representative snippet, its timestamp, and how many segments matched. */
  async function searchTranscripts(query: string, videoLimit = 5, perVideoLimit = 1): Promise<TranscriptSearchResultEntry[]> {
    // Tokenize to letters/numbers + prefix-match each token (mirrors buildFtsMatch in
    // src/lib/youtubeSearch.ts, kept in sync; tested there).
    const tokens = (query.trim().toLowerCase().match(/[\p{L}\p{N}]+/gu)) ?? []
    if (tokens.length === 0) return []
    const match = tokens.map((t) => `${t}*`).join(' ')
    type Row = { videoId: string; snippet: string; startMs: number; title: string; channelName: string; rank: number }
    let rows: Row[]
    try {
      // bm25() ranks each matching segment (more negative = stronger match). We order by it
      // so the FIRST row per video is its best-matching line — used as the snippet + rank.
      //
      // A single common word ("the*") can match 40%+ of the 2.7M transcript segments — ORDER
      // BY on bm25() (a computed expression, not an indexed column) forces SQLite to evaluate
      // it for every single match before it can sort, ~2.5s for a query like that. The `cand`
      // CTE below bounds that cost: it computes bm25() (which MUST be evaluated in the same
      // scan as the MATCH constraint — a rowid JOIN from outside can't compute it correctly)
      // but stops after CANDIDATE_CAP matches, before any ORDER BY forces a full scan. Ranking
      // only that bounded candidate set is then cheap.
      //
      // CANDIDATE_CAP must stay well above the match count of any realistic search term or it
      // silently truncates ranking (confirmed: 5000 was too low — cut off the true #2 result
      // for a 6.6k-match query). Checked actual match counts for the most common single
      // content words in this corpus (god* 122k, christ* 45k, yeshua* 37k, love* 34k) — 200k
      // gives comfortable headroom above all of them while still bounding true worst case
      // stopword-style queries ("the*"/"a*", each ~1.19M matches) down to ~450ms from ~2.5s.
      const CANDIDATE_CAP = 200_000
      rows = await db().all<Row>(`
        WITH cand AS (
          SELECT rowid, bm25(youtube_transcripts_fts) AS rank
          FROM youtube_transcripts_fts
          WHERE youtube_transcripts_fts MATCH ?
          LIMIT ${CANDIDATE_CAP}
        )
        SELECT s.video_id AS videoId, s.text AS snippet, s.start_ms AS startMs,
               v.title AS title, v.channel_name AS channelName,
               cand.rank AS rank
        FROM cand
        JOIN youtube_transcript_segments s ON s.id = cand.rowid
        JOIN youtube_videos v ON v.video_id = s.video_id
        ORDER BY cand.rank
      `, [match])
    } catch {
      rows = [] // malformed FTS expression — fall through to LIKE fallback
    }
    // Fuzzy fallback: if FTS returns nothing, do token-level LIKE matching so minor typos
    // and out-of-order words still find results.
    if (rows.length === 0 && tokens.length > 0) {
      try {
        const conditions = tokens.map(() => 'LOWER(s.text) LIKE ?').join(' AND ')
        const params: string[] = tokens.map((t) => `%${t}%`)
        rows = await db().all<Row>(`
          SELECT s.video_id AS videoId, s.text AS snippet, s.start_ms AS startMs,
                 v.title AS title, v.channel_name AS channelName,
                 0 AS rank
          FROM youtube_transcript_segments s
          JOIN youtube_videos v ON v.video_id = s.video_id
          WHERE ${conditions}
          ORDER BY s.start_ms
          LIMIT ${videoLimit * perVideoLimit * 10}
        `, params)
      } catch { rows = [] }
    }
    // Collect up to `perVideoLimit` best segments per video, then trim to `videoLimit` distinct
    // videos. Callers like the in-tab search box pass a large videoLimit (up to the size of the
    // whole local video list) just to know WHICH videos match, for filtering — not to display
    // all of them at once — so this loop must stay O(rows), not scan/rebuild `results` per row:
    // it previously did a linear results.find()/results.filter() per repeat-video row, which is
    // O(rows * results.length) and was the dominant cost of a broad in-tab search.
    const results: TranscriptSearchResultEntry[] = []
    const byVideo = new Map<string, { bestRank: number; count: number; segs: TranscriptSearchResultEntry[] }>()
    for (const r of rows) {
      const entry: TranscriptSearchResultEntry = { videoId: r.videoId, snippet: r.snippet, startMs: r.startMs, matchCount: 1, title: r.title, channelName: r.channelName, rank: r.rank }
      const ex = byVideo.get(r.videoId)
      if (!ex) {
        if (byVideo.size >= videoLimit) continue
        byVideo.set(r.videoId, { bestRank: r.rank, count: 1, segs: [entry] })
        results.push(entry)
      } else {
        ex.count++
        ex.segs[0].matchCount = ex.count // same object reference as the entry already in `results`
        if (perVideoLimit > 1 && ex.segs.length < perVideoLimit) {
          ex.segs.push(entry)
          results.push(entry)
        }
      }
    }

    // Widen each snippet with a few neighbouring caption lines for readable context (tactiq
    // segments are short ~5-10 word lines), centered on the best-matching line. Only for the
    // top-ranked results actually likely to be rendered — a large videoLimit search can produce
    // thousands of matches used purely for filtering, and widening every one of them would mean
    // thousands of extra queries for snippets nothing ever displays.
    const WIDEN_CAP = 100
    for (const r of results.slice(0, WIDEN_CAP)) {
      try {
        const rows2 = await db().all<{ text: string }>(
          'SELECT text FROM youtube_transcript_segments WHERE video_id = ? AND start_ms BETWEEN ? AND ? ORDER BY start_ms',
          [r.videoId, Math.max(0, r.startMs - 12000), r.startMs + 12000],
        )
        const joined = rows2.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim()
        if (joined.length > r.snippet.length) r.snippet = joined.slice(0, 400)
      } catch { /* keep single-line snippet */ }
    }
    return results
  }

  return {
    loadAll, toggleStar, savePosition, getPosition, getWatchHistory, removeFromHistory,
    clearWatchHistory, clearAll, applyUserRow, getTranscript, getTranscriptStatus, getTranscriptAvailability, searchTranscripts,
  }
}

export type YoutubeService = ReturnType<typeof createYoutubeService>
