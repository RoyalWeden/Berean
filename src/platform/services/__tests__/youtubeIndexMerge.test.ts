import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices } from '..'
import { consoleLogger, defaultUuid, type ServiceContext } from '../context'
import { mergeYoutubeIndex, mergeTranscriptPack } from '../youtubeIndexMerge'

// Vite cannot resolve `node:sqlite`; load it the way nodeSqliteAdapter does.
const { DatabaseSync } = (process as unknown as { getBuiltinModule: (m: string) => { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): unknown }; close(): void } } }).getBuiltinModule('node:sqlite')

/** The iOS path of D-007: bundled index merged at boot, transcript packs merged on download. */
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'berean-yt-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function writeIndex(path: string, seedVersion: number) {
  rmSync(path, { force: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE youtube_videos (video_id TEXT, title TEXT, published TEXT, channel_name TEXT, channel_handle TEXT, thumbnail_url TEXT, type TEXT, is_live_now INTEGER, fetched_at TEXT, duration_seconds INTEGER, is_starred INTEGER, description TEXT);
    CREATE TABLE youtube_sync (channel_handle TEXT, last_full_sync TEXT, last_refresh TEXT);
    CREATE TABLE youtube_transcripts (video_id TEXT, lang TEXT, source TEXT, fetched_at INTEGER, segment_count INTEGER, duration_ms INTEGER, error TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO youtube_videos VALUES ('v1', 'Sabbath', '2026-01-01', 'Ch A', '@a', 't', 'video', 0, 'f', 100, 1, ''), ('v2', 'Feasts', '2026-01-02', 'Ch A', '@a', 't', 'video', 0, 'f', 200, 0, ''), ('v3', 'Other', '2026-01-03', 'Ch B', '@b', 't', 'video', 0, 'f', 50, 0, '');
    INSERT INTO youtube_sync VALUES ('@a', 's', 'r'), ('@b', 's', 'r');
    INSERT INTO youtube_transcripts VALUES ('v1', 'en', 'tactiq', 1, 2, 5000, NULL), ('v2', 'en', 'tactiq', 1, 1, 1000, NULL), ('v3', 'en', 'tactiq', 1, 1, 1000, NULL);
  `)
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('seed_version', String(seedVersion))
  db.close()
}
function writePack(path: string) {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE youtube_transcripts (video_id TEXT, lang TEXT, source TEXT, fetched_at INTEGER, segment_count INTEGER, duration_ms INTEGER, error TEXT);
    CREATE TABLE youtube_transcript_segments (id INTEGER, video_id TEXT, start_ms INTEGER, dur_ms INTEGER, text TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO youtube_transcripts VALUES ('v1', 'en', 'tactiq', 1, 2, 5000, NULL), ('v2', 'en', 'tactiq', 1, 1, 1000, NULL);
    INSERT INTO youtube_transcript_segments VALUES (1, 'v1', 0, 2000, 'remember the sabbath day'), (2, 'v1', 2000, 3000, 'to keep it holy'), (3, 'v2', 0, 1000, 'the feasts of Yehovah');
    INSERT INTO meta VALUES ('channel_handle', '@a'), ('channel_name', 'Ch A');
  `)
  db.close()
}

async function harness() {
  const db = await migratedUserDb('yt')
  const rec = recordingEvents()
  const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: rec.events, now: () => 1_700_000_000_000, uuid: defaultUuid, isDev: true, log: consoleLogger }
  return { db, services: createServices(ctx) }
}

describe('youtube index + transcript packs (D-007)', () => {
  it('merges the index once per seed version, keeps synced stars, and reports transcripts as not downloaded', async () => {
    const { db, services } = await harness()
    const index = join(dir, 'youtube_index.db'); writeIndex(index, 3)
    // a star that arrived via iCloud before the index was merged
    await db.run("INSERT INTO youtube_user (video_id, is_starred, position_seconds, last_watched, updated_at) VALUES ('v2', 1, 0, NULL, 1)")
    expect(await mergeYoutubeIndex(db, index)).toEqual({ merged: true, seedVersion: 3 })
    const videos = await services.youtube.loadAll()
    expect(videos.map((v) => [v.videoId, v.isStarred])).toEqual([['v3', false], ['v2', true], ['v1', true]])
    expect(await services.youtube.getTranscriptStatus()).toEqual([])          // metadata only, nothing downloaded
    expect(await services.youtube.getTranscriptAvailability()).toEqual([
      { channelHandle: '@a', channelName: 'Ch A', available: 2, downloaded: 0 },
      { channelHandle: '@b', channelName: 'Ch B', available: 1, downloaded: 0 },
    ])
    expect(await mergeYoutubeIndex(db, index)).toEqual({ merged: false, seedVersion: 3 })   // same version: no-op
    writeIndex(index, 4)
    expect((await mergeYoutubeIndex(db, index)).merged).toBe(true)
    expect(await db.get("SELECT value FROM settings WHERE key = 'youtubeSeedVersion'")).toEqual({ value: '4' })
  })

  it('merges a channel pack: segments, FTS search and status update; re-merging does not duplicate', async () => {
    const { db, services } = await harness()
    const index = join(dir, 'youtube_index.db'); writeIndex(index, 3)
    await mergeYoutubeIndex(db, index)
    const pack = join(dir, 'a.db'); writePack(pack)
    expect(await mergeTranscriptPack(db, pack)).toEqual({ videos: 2, segments: 3, channelHandle: '@a' })
    expect((await services.youtube.getTranscript('v1')).map((s) => s.text)).toEqual(['remember the sabbath day', 'to keep it holy'])
    expect((await services.youtube.getTranscriptStatus()).sort()).toEqual(['v1', 'v2'])
    expect((await services.youtube.getTranscriptAvailability())[0]).toEqual({ channelHandle: '@a', channelName: 'Ch A', available: 2, downloaded: 2 })
    const hits = await services.youtube.searchTranscripts('sabbath')
    expect(hits.map((h) => h.videoId)).toEqual(['v1'])
    await mergeTranscriptPack(db, pack)
    expect(await db.get('SELECT COUNT(*) AS n FROM youtube_transcript_segments')).toEqual({ n: 3 })
  })
})
