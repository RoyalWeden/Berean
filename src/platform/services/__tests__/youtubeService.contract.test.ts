import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createYoutubeService } from '../youtubeService'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

async function seedVideo(db: DatabaseAdapter, v: Partial<{
  video_id: string; title: string; published: string; channel_name: string; channel_handle: string
  thumbnail_url: string; type: string; is_live_now: number; fetched_at: string
  duration_seconds: number; is_starred: number; description: string
}> = {}) {
  const row = {
    video_id: 'vid1', title: 'Title', published: '2026-01-01T00:00:00.000Z',
    channel_name: 'Channel', channel_handle: '@channel', thumbnail_url: 'https://t/1.jpg',
    type: 'video', is_live_now: 0, fetched_at: '2026-01-01T00:00:00.000Z',
    duration_seconds: 120, is_starred: 0, description: '',
    ...v,
  }
  await db.run(
    `INSERT INTO youtube_videos (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, is_live_now, fetched_at, duration_seconds, is_starred, description)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.video_id, row.title, row.published, row.channel_name, row.channel_handle, row.thumbnail_url, row.type, row.is_live_now, row.fetched_at, row.duration_seconds, row.is_starred, row.description],
  )
}

async function seedTranscript(db: DatabaseAdapter, videoId: string, segmentCount: number, error: string | null = null) {
  await db.run(
    'INSERT INTO youtube_transcripts (video_id, lang, source, fetched_at, segment_count, duration_ms, error) VALUES (?,?,?,?,?,?,?)',
    [videoId, 'en', 'tactiq', Date.now(), segmentCount, 0, error],
  )
}

async function seedSegment(db: DatabaseAdapter, videoId: string, startMs: number, text: string) {
  await db.run('INSERT INTO youtube_transcript_segments (video_id, start_ms, dur_ms, text) VALUES (?,?,?,?)', [videoId, startMs, 1000, text])
}

describe('youtubeService', () => {
  let db: DatabaseAdapter
  let svc: ReturnType<typeof createYoutubeService>
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    db = await migratedUserDb()
    const rec = recordingEvents()
    changes = rec.changes
    svc = createYoutubeService(makeContext({ userDb: db, events: rec.events }))
  })

  describe('loadAll', () => {
    it('maps rows, orders by published DESC, and applies handle renames once', async () => {
      await seedVideo(db, { video_id: 'a', published: '2026-01-01T00:00:00.000Z', channel_handle: '@michaelfollowsyah', is_starred: 1, is_live_now: 1 })
      await seedVideo(db, { video_id: 'b', published: '2026-02-01T00:00:00.000Z' })
      // youtube_sync row under the old handle only — should be renamed, not deleted.
      await db.run('INSERT INTO youtube_sync (channel_handle, last_full_sync, last_refresh) VALUES (?,?,?)', ['@michaelfollowsyah', '2025-01-01', null])

      const videos = await svc.loadAll()
      expect(videos.map((v) => v.videoId)).toEqual(['b', 'a']) // published DESC
      const a = videos.find((v) => v.videoId === 'a')!
      expect(a).toMatchObject({ channelHandle: '@michael4yeshua', isStarred: true, isLiveNow: true, durationSeconds: 120, description: '' })

      const syncRows = await db.all<{ channel_handle: string }>('SELECT channel_handle FROM youtube_sync')
      expect(syncRows.map((r) => r.channel_handle)).toEqual(['@michael4yeshua'])
    })

    it('deletes the stale youtube_sync row when both old and new handle rows already exist', async () => {
      await db.run('INSERT INTO youtube_sync (channel_handle, last_full_sync, last_refresh) VALUES (?,?,?)', ['@michaelfollowsyah', '2025-01-01', null])
      await db.run('INSERT INTO youtube_sync (channel_handle, last_full_sync, last_refresh) VALUES (?,?,?)', ['@michael4yeshua', '2025-06-01', null])
      await svc.loadAll()
      const syncRows = await db.all<{ channel_handle: string; last_full_sync: string }>('SELECT channel_handle, last_full_sync FROM youtube_sync')
      expect(syncRows).toEqual([{ channel_handle: '@michael4yeshua', last_full_sync: '2025-06-01' }])
    })

    it('returns [] when no videos are stored', async () => {
      expect(await svc.loadAll()).toEqual([])
    })
  })

  describe('toggleStar', () => {
    it('flips is_starred and emits an upsert', async () => {
      await seedVideo(db, { video_id: 'a', is_starred: 0 })
      expect(await svc.toggleStar('a')).toEqual({ isStarred: true })
      expect(await svc.toggleStar('a')).toEqual({ isStarred: false })
      expect(changes).toEqual([
        { entity: 'youtube_user', id: 'a', op: 'upsert' },
        { entity: 'youtube_user', id: 'a', op: 'upsert' },
      ])
    })

    it('toggling a video not in the DB is a no-op write that still reports unstarred', async () => {
      expect(await svc.toggleStar('missing')).toEqual({ isStarred: false })
    })
  })

  describe('savePosition / getPosition', () => {
    it('inserts then updates, keeping non-empty meta when a later save sends blanks', async () => {
      await svc.savePosition('a', 42, { title: 'My Video', channelName: 'Chan', thumbnailUrl: 'https://t/a.jpg' })
      expect(await svc.getPosition('a')).toBe(42)
      await svc.savePosition('a', 99, { title: '', channelName: '', thumbnailUrl: '' })
      expect(await svc.getPosition('a')).toBe(99)
      const row = await db.get<{ title: string; channel_name: string; thumbnail_url: string }>('SELECT title, channel_name, thumbnail_url FROM youtube_watch_history WHERE video_id = ?', ['a'])
      expect(row).toEqual({ title: 'My Video', channel_name: 'Chan', thumbnail_url: 'https://t/a.jpg' })
      expect(changes.map((c) => c.op)).toEqual(['upsert', 'upsert'])
    })

    it('getPosition returns 0 for an unwatched video', async () => {
      expect(await svc.getPosition('nope')).toBe(0)
    })
  })

  describe('getWatchHistory / removeFromHistory / clearWatchHistory', () => {
    it('lists ordered by last_watched DESC and removes/clears with events', async () => {
      await svc.savePosition('a', 10, { title: 'A', channelName: 'C', thumbnailUrl: '' })
      await new Promise((r) => setTimeout(r, 2))
      await svc.savePosition('b', 20, { title: 'B', channelName: 'C', thumbnailUrl: '' })

      const hist = await svc.getWatchHistory()
      expect(hist.map((h) => h.videoId)).toEqual(['b', 'a'])
      expect(hist[0]).toMatchObject({ videoId: 'b', positionSeconds: 20, title: 'B' })

      await svc.removeFromHistory('a')
      expect((await svc.getWatchHistory()).map((h) => h.videoId)).toEqual(['b'])

      await svc.clearWatchHistory()
      expect(await svc.getWatchHistory()).toEqual([])

      expect(changes.filter((c) => c.entity === 'youtube_user').map((c) => c.op)).toEqual(['upsert', 'upsert', 'delete', 'bulk'])
    })
  })

  describe('clearAll', () => {
    it('wipes videos, sync bookkeeping and only the ytHandle: settings keys', async () => {
      await seedVideo(db, { video_id: 'a' })
      await db.run('INSERT INTO youtube_sync (channel_handle, last_full_sync, last_refresh) VALUES (?,?,?)', ['@channel', null, null])
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['ytHandle:@channel', '"UC123"'])
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['theme', '"dark"'])

      await svc.clearAll()

      expect(await db.all('SELECT * FROM youtube_videos')).toEqual([])
      expect(await db.all('SELECT * FROM youtube_sync')).toEqual([])
      expect(await db.get('SELECT * FROM settings WHERE key = ?', ['ytHandle:@channel'])).toBeUndefined()
      expect(await db.get('SELECT * FROM settings WHERE key = ?', ['theme'])).toBeDefined()
      expect(changes).toEqual([{ entity: 'youtube_user', op: 'bulk' }])
    })
  })

  describe('getTranscript / getTranscriptStatus', () => {
    it('returns ordered segments and an empty array for a video with none', async () => {
      await seedTranscript(db, 'a', 2)
      await seedSegment(db, 'a', 5000, 'second line')
      await seedSegment(db, 'a', 1000, 'first line')
      expect(await svc.getTranscript('a')).toEqual([
        { startMs: 1000, durMs: 1000, text: 'first line' },
        { startMs: 5000, durMs: 1000, text: 'second line' },
      ])
      expect(await svc.getTranscript('missing')).toEqual([])
    })

    it('only lists videos with segment_count > 0', async () => {
      await seedTranscript(db, 'has-segments', 3)
      await seedTranscript(db, 'no-transcript', 0, 'no transcript available')
      expect(await svc.getTranscriptStatus()).toEqual(['has-segments'])
    })
  })

  describe('searchTranscripts', () => {
    it('returns [] for an empty/whitespace query', async () => {
      expect(await svc.searchTranscripts('   ')).toEqual([])
    })

    it('ranks FTS matches, widens the snippet with neighbouring segments, and honours videoLimit/perVideoLimit', async () => {
      await seedVideo(db, { video_id: 'v1', title: 'Torah Talk', channel_name: 'C1' })
      await seedVideo(db, { video_id: 'v2', title: 'Feast Days', channel_name: 'C2' })
      await seedTranscript(db, 'v1', 3)
      await seedSegment(db, 'v1', 10000, 'before context')
      await seedSegment(db, 'v1', 20000, 'keeping the sabbath command')
      await seedSegment(db, 'v1', 30000, 'after context')
      await seedTranscript(db, 'v2', 1)
      await seedSegment(db, 'v2', 5000, 'sabbath rest for the feast')

      const results = await svc.searchTranscripts('sabbath', 5, 1)
      expect(results.map((r) => r.videoId).sort()).toEqual(['v1', 'v2'])
      const v1 = results.find((r) => r.videoId === 'v1')!
      expect(v1.title).toBe('Torah Talk')
      expect(v1.channelName).toBe('C1')
      // widened snippet should now include the neighbouring segments within +/-12s
      expect(v1.snippet).toContain('before context')
      expect(v1.snippet).toContain('after context')

      const limited = await svc.searchTranscripts('sabbath', 1, 1)
      expect(limited).toHaveLength(1)
    })

    it('captures matchCount and up to perVideoLimit segments per video', async () => {
      await seedVideo(db, { video_id: 'v1', title: 'T', channel_name: 'C' })
      await seedTranscript(db, 'v1', 3)
      await seedSegment(db, 'v1', 1000, 'grace grace grace')
      await seedSegment(db, 'v1', 100000, 'more about grace')
      await seedSegment(db, 'v1', 200000, 'grace again here')

      const results = await svc.searchTranscripts('grace', 5, 2)
      const forV1 = results.filter((r) => r.videoId === 'v1')
      expect(forV1).toHaveLength(2) // perVideoLimit caps stored segments...
      expect(forV1[0].matchCount).toBe(3) // ...but matchCount reflects every match
    })

    it('falls back to LIKE substring matching when FTS finds no prefix match', async () => {
      await seedVideo(db, { video_id: 'v1', title: 'T', channel_name: 'C' })
      await seedTranscript(db, 'v1', 1)
      await seedSegment(db, 'v1', 1000, 'shalom to you all')
      // "halo*" never prefix-matches the single FTS token "shalom", but LIKE '%halo%' does
      // (shalom contains "halo" as a substring) — exercises the fallback path.
      const results = await svc.searchTranscripts('halo', 5, 1)
      expect(results.map((r) => r.videoId)).toEqual(['v1'])
    })
  })
})
