import { describe, it, expect } from 'vitest'
import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { consoleLogger, defaultUuid, type ServiceContext } from '../context'
import { createYoutubeFetchService, parseRssVideos, parseInnerTubeResponse, parseIsoDuration, tryParseRelativeDate } from '../youtubeFetchService'

/** Fake YouTube: channel page (id), InnerTube browse (videos/shorts/live), RSS, Data API. */
function fakeYoutube(opts: { liveNow?: boolean } = {}) {
  const calls: string[] = []
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const renderer = (videoId: string, title: string, when: string, live = false) => ({ videoRenderer: { videoId, title: { runs: [{ text: title }] }, publishedTimeText: { simpleText: when }, ownerText: { runs: [{ text: 'Test Channel' }] }, ...(live ? { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] } : {}) } })
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url)
    if (url === 'https://www.youtube.com/@test') return new Response('<html>"externalId":"UCabcdefghijklmnopqrstuv"</html>', { status: 200 })
    if (url.includes('youtubei/v1/browse')) {
      const body = JSON.parse(String(init?.body))
      const params = body.params as string | undefined
      const items = params === 'EgZ2aWRlb3PyBgQKAjoA' ? [renderer('vid1', 'First &amp; best', '3 days ago'), renderer('vid2', 'Second', '2 weeks ago')]
        : params === 'EgdzdHJlYW1z8gYECgJ6AA==' ? (opts.liveNow ? [renderer('live1', 'Live now', 'Streamed', true)] : [])
        : []
      return json({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { items } } }] } } })
    }
    if (url.includes('feeds/videos.xml')) return new Response(`<feed><entry><yt:videoId>vid1</yt:videoId><title>First &amp; best</title><published>2026-09-18T10:00:00+00:00</published><author><name>Test Channel</name></author></entry><entry><yt:videoId>rss9</yt:videoId><title>Only in RSS</title><published>2026-09-20T10:00:00+00:00</published><author><name>Test Channel</name></author></entry></feed>`, { status: 200 })
    if (url.includes('youtubei/v1/player')) return json({ videoDetails: { shortDescription: 'A description' } })
    return new Response('nope', { status: 404 })
  }
  return { fetch, calls }
}

async function harness(fetch: (url: string, init?: RequestInit) => Promise<Response>, progress: string[] = []) {
  const db = await migratedUserDb('yt-fetch')
  const rec = recordingEvents()
  const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: rec.events, now: () => Date.now(), uuid: defaultUuid, isDev: false, log: consoleLogger }
  const svc = createYoutubeFetchService(ctx, { fetch, channels: ['@test'], onProgress: (p) => progress.push(p.phase) })
  return { db, svc, changes: rec.changes }
}

describe('youtubeFetchService (shared port of the desktop network layer)', () => {
  it('parsers match the desktop rules', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
    expect(parseIsoDuration('PT45S')).toBe(45)
    const now = Date.parse('2026-09-21T12:00:00Z')
    expect(tryParseRelativeDate('3 days ago', now)).toBe(new Date(now - 3 * 86_400_000).toISOString())
    expect(tryParseRelativeDate('2mo ago', now)).toBe(new Date(now - 2 * 2_592_000_000).toISOString())
    expect(tryParseRelativeDate('yesterday', now)).toBeNull()
    const rss = parseRssVideos('<entry><yt:videoId>x</yt:videoId><title>A &amp; B</title><published>2026-01-01T00:00:00Z</published><name>Ch</name></entry>', '@h')
    expect(rss).toMatchObject([{ videoId: 'x', title: 'A & B', published: '2026-01-01T00:00:00Z', channelName: 'Ch', type: 'video' }])
    expect(parseInnerTubeResponse({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { items: [{ videoRenderer: { videoId: 'v', title: { runs: [{ text: 'T' }] } } }] } } }] } } }, '@h', 'short')).toMatchObject([{ videoId: 'v', type: 'short' }])
  })

  it('refresh resolves the channel, merges InnerTube + RSS, exact-dates from RSS, marks synced, reports progress', async () => {
    const yt = fakeYoutube()
    const progress: string[] = []
    const { db, svc, changes } = await harness(yt.fetch, progress)
    const r = await svc.refresh()
    expect(r.added).toBe(3)
    const rows = await db.all<{ video_id: string; title: string; published: string; channel_name: string }>('SELECT video_id, title, published, channel_name FROM youtube_videos ORDER BY video_id')
    expect(rows.map((x) => x.video_id)).toEqual(['rss9', 'vid1', 'vid2'])
    expect(rows[1]).toMatchObject({ title: 'First & best', published: '2026-09-18T10:00:00+00:00', channel_name: 'Test Channel' })   // RSS upgraded the relative date
    expect(await db.get("SELECT value FROM settings WHERE key = 'ytHandle:@test'")).toEqual({ value: '"UCabcdefghijklmnopqrstuv"' })
    expect((await db.get<{ last_refresh: string }>("SELECT last_refresh FROM youtube_sync WHERE channel_handle = '@test'"))?.last_refresh).toBeTruthy()
    expect(progress[0]).toBe('Checking channels…'); expect(progress.at(-1)).toBe('Updated 1/1')
    expect(changes.some((c) => c.entity === 'youtube_video')).toBe(true)
    // second refresh: nothing new, channel id cached (no channel-page fetch)
    yt.calls.length = 0
    expect((await svc.refresh()).added).toBe(0)
    expect(yt.calls.some((u) => u === 'https://www.youtube.com/@test')).toBe(false)
  })

  it('keeps stars on refresh (including one synced before the video existed) and marks live streams', async () => {
    const yt = fakeYoutube({ liveNow: true })
    const { db, svc } = await harness(yt.fetch)
    await db.run("INSERT INTO youtube_user (video_id, is_starred, position_seconds, last_watched, updated_at) VALUES ('vid2', 1, 0, NULL, 1)")
    const r = await svc.refresh()
    expect(r.liveUpdated).toBe(1)
    expect(await db.get("SELECT is_starred FROM youtube_videos WHERE video_id = 'vid2'")).toEqual({ is_starred: 1 })
    expect(await db.get("SELECT is_live_now, type FROM youtube_videos WHERE video_id = 'live1'")).toEqual({ is_live_now: 1, type: 'live' })
    await db.run("UPDATE youtube_videos SET is_starred = 1 WHERE video_id = 'vid1'")
    await svc.refresh()
    expect(await db.get("SELECT is_starred FROM youtube_videos WHERE video_id = 'vid1'")).toEqual({ is_starred: 1 })
  })

  it('fullSync is refused outside dev or without a key; fetchDescription caches; searchVideos matches like desktop', async () => {
    const yt = fakeYoutube()
    const { db, svc } = await harness(yt.fetch)
    expect(await svc.fullSync()).toEqual({ error: 'unavailable in production' })
    await svc.refresh()
    expect(await svc.fetchDescription('vid1')).toBe('A description')
    expect(await db.get("SELECT description FROM youtube_videos WHERE video_id = 'vid1'")).toEqual({ description: 'A description' })
    expect((await svc.searchVideos('best')).map((v) => v.videoId)).toEqual(['vid1'])
    expect((await svc.searchVideos('channel second')).map((v) => v.videoId)).toEqual(['vid2'])   // token fallback
    expect(await svc.searchVideos('   ')).toEqual([])
  })
})
