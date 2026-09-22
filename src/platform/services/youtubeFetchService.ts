import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'

/**
 * YouTube channel fetching — the desktop network layer of electron/ipc/youtube.ts (Refresh via
 * InnerTube + RSS, Full Sync via the Data API, description fetch, video search) ported to the
 * shared services: async over `DatabaseAdapter`, with `fetch` injected so the phone can route
 * requests through Capacitor's native HTTP (no CORS in a WebView) and tests can stub it. The
 * parsing code is the desktop's, statement for statement; the desktop keeps its own copy for
 * now (Phase 20 consolidates). Behaviour preserved: Full Sync needs an API key and is dev-only;
 * Refresh is free and available to everyone; stars are never overwritten by a fetch (and a
 * star synced before the video was fetched is applied on insert, v45).
 */
export const CHANNELS = [
  '@matthewforyeshua', '@andrewrepent', '@SpiritofTruth.Remnant', '@matthew953', '@antonio-praiseyah3137',
  '@matthewg44yehovah', '@marinaforyehovah', '@TheNarrowWay_144', '@a.k.a.watchmenwakeup', '@TheWrathOfGodIsComing',
  '@joseph_amoz', '@meg__yeshua', '@Tee4Yahovah', '@kathiholmes144', '@s2milne', '@Chefsammysosa', '@Dub4Yah',
  '@sandrakluey1856', '@yahsavesthroughyeshua', '@Brittneyapeculiarwoman', '@seekhimearly', '@aWatchmanInEphraim144',
  '@Lookingforlostsheep', '@vladimirputin1519', '@Help.Gather.Yahs.People', '@MikePhillips-g4o', '@kaylapsalm684',
  '@Lylah-h5l', '@OutofTheMouthofBabe144', '@JacobTheServant98', '@tishacobb2810', '@YahovasSling', '@Yeshua_1s_King',
  '@Vinny-h1v', '@Keepthe10CommandmentsEatClean', '@KeyofDavid-kz5jn', '@womenrepent', '@repentandkeepthe10commandments',
  '@YESHUA1994-w8x', '@yaravilla3516', '@PeculiarPeople_', '@Michael-Rebecca-7', '@evelynblair544', '@michael4yeshua',
  '@Sara.I.Lawrence', '@RoyalLawYeshua', '@CalledToBeSaintsforYeshua', '@PraiseYahforever12', '@hollyavila', '@Nathan-pl2xj',
  '@DavidAJShepherd', '@repent-obey', '@Yahsaves144', '@straitisthegatedotnet', '@oftheolivebranch5815', '@It-shall-come-to-pass',
  '@LukeGamage20', '@darrelbigdaddywhite', '@Watchman4433', '@chrisavila7944', '@kyannarepent', '@rickyfransley', '@NickJohnson768',
]

export interface VideoEntry {
  videoId: string
  title: string
  published: string
  channelName: string
  channelHandle: string
  thumbnailUrl: string
  type: 'video' | 'short' | 'live'
  isLiveNow: boolean
  durationSeconds: number
  isStarred: boolean
  description: string
}
export interface YoutubeVideoSearchResult { videoId: string; title: string; channelName: string; thumbnailUrl: string; type: string; published: string }
export interface FetchProgress { done: number; total: number; phase: string }
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const TAB_PARAMS = { video: 'EgZ2aWRlb3PyBgQKAjoA', short: 'EgZzaG9ydHPyBgUKA5oBAA==', live: 'EgdzdHJlYW1z8gYECgJ6AA==' } as const
const INNERTUBE_HEADERS = {
  'Content-Type': 'application/json',
  'X-YouTube-Client-Name': '1',
  'X-YouTube-Client-Version': '2.20240614.07.00',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://www.youtube.com',
  'Referer': 'https://www.youtube.com/',
}
const INNERTUBE_CONTEXT = { client: { clientName: 'WEB', clientVersion: '2.20240614.07.00', hl: 'en', gl: 'US' } }

export function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
}
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0')
}
export function tryParseRelativeDate(text: string, now = Date.now()): string | null {
  const abbrev = text.match(/(\d+)\s*(mo|y|w|d|h|m|s)\b/)
  if (abbrev) {
    const n = parseInt(abbrev[1])
    const ms: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000, y: 31_536_000_000 }
    if (ms[abbrev[2]]) return new Date(now - n * ms[abbrev[2]]).toISOString()
  }
  const full = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?/)
  if (!full) return null
  const n = parseInt(full[1])
  const ms: Record<string, number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 }
  return new Date(now - n * (ms[full[2]] ?? 0)).toISOString()
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function* walkContent(obj: any, depth = 0): Generator<any> {
  if (depth > 30 || !obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) { for (const v of obj) yield* walkContent(v, depth + 1); return }
  if (obj.videoRenderer) { yield obj.videoRenderer; return }
  if (obj.gridVideoRenderer) { yield obj.gridVideoRenderer; return }
  if (obj.reelItemRenderer) { yield obj.reelItemRenderer; return }
  if (obj.shortsLockupViewModel) {
    const vm = obj.shortsLockupViewModel
    const videoId: string =
      vm?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
      vm?.onTap?.innertubeCommand?.navigationEndpoint?.reelWatchEndpoint?.videoId ??
      (vm?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url as string | undefined)?.match(/\/shorts\/([\w-]+)/)?.[1] ?? ''
    const title: string = vm?.overlayMetadata?.primaryText?.content ?? vm?.accessibilityText ?? ''
    if (videoId) yield { videoId, title: { runs: [{ text: title || videoId }] }, __noDate: true }
    return
  }
  for (const v of Object.values(obj)) yield* walkContent(v, depth + 1)
}
function isCurrentlyLive(renderer: any): boolean {
  const overlays: unknown[] = renderer?.thumbnailOverlays ?? []
  if (overlays.some((o: any) => o?.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE')) return true
  const badges: unknown[] = renderer?.badges ?? renderer?.ownerBadges ?? []
  return badges.some((b: any) => b?.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW' || (b?.metadataBadgeRenderer?.label as string | undefined)?.toUpperCase().includes('LIVE'))
}
function extractDate(renderer: any): string {
  const candidates: string[] = [
    renderer?.publishedTimeText?.simpleText,
    ...(renderer?.publishedTimeText?.runs ?? []).map((r: any) => r?.text ?? ''),
    ...(renderer?.videoInfo?.runs ?? []).map((r: any) => r?.text ?? ''),
    renderer?.publishedTime,
  ].filter(Boolean) as string[]
  for (const text of candidates) { const d = tryParseRelativeDate(text); if (d) return d }
  if (isCurrentlyLive(renderer)) return new Date().toISOString()
  return new Date(0).toISOString()
}
export function extractEntry(renderer: any, channelHandle: string, requestedType: VideoEntry['type']): VideoEntry | null {
  const videoId: string = renderer?.videoId ?? ''
  const title: string = renderer?.title?.runs?.[0]?.text ?? renderer?.headline?.runs?.[0]?.text ?? ''
  if (!videoId || !title) return null
  const liveNow = isCurrentlyLive(renderer)
  const type: VideoEntry['type'] = liveNow ? 'live' : requestedType
  const channelName: string = renderer?.ownerText?.runs?.[0]?.text ?? renderer?.shortBylineText?.runs?.[0]?.text ?? channelHandle
  return {
    videoId, title: decodeXml(title), published: liveNow ? new Date().toISOString() : extractDate(renderer),
    channelName: decodeXml(channelName) || channelHandle, channelHandle,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, type, isLiveNow: liveNow, durationSeconds: 0, isStarred: false, description: '',
  }
}
export function parseInnerTubeResponse(data: any, channelHandle: string, type: VideoEntry['type']): VideoEntry[] {
  const tabs: unknown[] = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? data?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? []
  const tabContent: any = (tabs as any[]).find((t) => t?.tabRenderer?.selected === true)?.tabRenderer?.content ?? (tabs as any[]).find((t) => t?.tabRenderer?.content != null)?.tabRenderer?.content
  if (!tabContent) return []
  const videos: VideoEntry[] = []
  for (const renderer of walkContent(tabContent)) { const entry = extractEntry(renderer, channelHandle, type); if (entry) videos.push(entry) }
  return videos
}
function parseContinuationResponse(data: any, channelHandle: string, type: VideoEntry['type']): VideoEntry[] {
  const items: unknown[] = data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ?? []
  const videos: VideoEntry[] = []
  for (const renderer of walkContent(items)) { const entry = extractEntry(renderer, channelHandle, type); if (entry) videos.push(entry) }
  return videos
}
function findContinuationToken(data: any, depth = 0): string | null {
  if (depth > 30 || !data || typeof data !== 'object') return null
  if (data.continuationItemRenderer) {
    const token = data.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
    if (typeof token === 'string') return token
  }
  const values = Array.isArray(data) ? data : Object.values(data)
  for (const v of values) { const found = findContinuationToken(v, depth + 1); if (found) return found }
  return null
}
export function parseRssVideos(xml: string, channelHandle: string): VideoEntry[] {
  const entries: VideoEntry[] = []
  const re = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const e = m[1]
    const videoId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]
    const titleRaw = e.match(/<title>([^<]+)<\/title>/)?.[1]
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1]
    const chanName = e.match(/<name>([^<]+)<\/name>/)?.[1]
    if (videoId && titleRaw && published) {
      entries.push({ videoId, title: decodeXml(titleRaw), published, channelName: chanName ? decodeXml(chanName) : channelHandle, channelHandle, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, type: 'video', isLiveNow: false, durationSeconds: 0, isStarred: false, description: '' })
    }
  }
  return entries
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface YoutubeFetchOptions {
  fetch: FetchLike
  /** YouTube Data API key — Full Sync only (dev). */
  apiKey?: string | null
  onProgress?: (p: FetchProgress) => void
  channels?: string[]
}

export function createYoutubeFetchService(ctx: ServiceContext, o: YoutubeFetchOptions) {
  const db = (): DatabaseAdapter => ctx.userDb
  const channels = o.channels ?? CHANNELS
  const progress = (p: FetchProgress) => { try { o.onProgress?.(p) } catch { /* listeners must not break a sync */ } }

  async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try { return await o.fetch(url, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) }
  }

  // ── DB helpers (same SQL as desktop) ─────────────────────────────────────────────────────
  async function upsertVideos(videos: VideoEntry[]): Promise<number> {
    if (videos.length === 0) return 0
    const now = new Date().toISOString()
    let added = 0
    await db().transaction(async (tx) => {
      for (const v of videos) {
        const isNew = !(await tx.get('SELECT 1 FROM youtube_videos WHERE video_id = ?', [v.videoId]))
        await tx.run(`
          INSERT INTO youtube_videos
            (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, is_live_now, duration_seconds, description, fetched_at, is_starred)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT is_starred FROM youtube_user WHERE video_id = ?), 0))
          ON CONFLICT(video_id) DO UPDATE SET
            title = excluded.title, published = excluded.published, channel_name = excluded.channel_name,
            channel_handle = excluded.channel_handle, thumbnail_url = excluded.thumbnail_url, type = excluded.type,
            is_live_now = excluded.is_live_now,
            duration_seconds = CASE WHEN excluded.duration_seconds > 0 THEN excluded.duration_seconds ELSE duration_seconds END,
            description = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
            fetched_at = excluded.fetched_at
        `, [v.videoId, v.title, v.published, v.channelName, v.channelHandle, v.thumbnailUrl, v.type, v.isLiveNow ? 1 : 0, v.durationSeconds ?? 0, v.description ?? '', now, v.videoId])
        if (isNew) added++
      }
    })
    return added
  }
  async function updateLiveStatus(channelHandle: string, liveIds: Set<string>): Promise<number> {
    await db().run('UPDATE youtube_videos SET is_live_now = 0 WHERE channel_handle = ?', [channelHandle])
    if (liveIds.size > 0) {
      const ph = Array.from({ length: liveIds.size }, () => '?').join(',')
      await db().run(`UPDATE youtube_videos SET is_live_now = 1 WHERE video_id IN (${ph})`, [...liveIds])
    }
    return liveIds.size
  }
  async function getExistingVideoIds(channelHandle: string): Promise<Set<string>> {
    return new Set((await db().all<{ video_id: string }>('SELECT video_id FROM youtube_videos WHERE channel_handle = ?', [channelHandle])).map((r) => r.video_id))
  }
  async function markSynced(channelHandle: string, kind: 'full' | 'refresh'): Promise<void> {
    const col = kind === 'full' ? 'last_full_sync' : 'last_refresh'
    await db().run(`INSERT INTO youtube_sync (channel_handle, ${col}) VALUES (?, ?) ON CONFLICT(channel_handle) DO UPDATE SET ${col} = excluded.${col}`, [channelHandle, new Date().toISOString()])
  }
  async function loadCachedChannelId(handle: string): Promise<string | null> {
    try { const row = await db().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [`ytHandle:${handle}`]); return row ? (JSON.parse(row.value) as string | null) : null } catch { return null }
  }
  async function saveChannelId(handle: string, id: string | null): Promise<void> {
    try { await db().run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [`ytHandle:${handle}`, JSON.stringify(id)]) } catch { /* non-critical */ }
  }

  // ── network ───────────────────────────────────────────────────────────────────────────
  async function resolveHandle(handle: string): Promise<string | null> {
    const persisted = await loadCachedChannelId(handle)
    if (persisted !== null) return persisted || null
    try {
      const resp = await fetchWithTimeout(`https://www.youtube.com/${handle}`, { headers: { 'User-Agent': INNERTUBE_HEADERS['User-Agent'], 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity' } }, 12_000)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const html = await resp.text()
      let id: string | null = null
      for (const pat of [/"externalId":"(UC[\w-]{22})"/, /"channelId":"(UC[\w-]{22})"/, /\/channel\/(UC[\w-]{22})["/]/, /"browse_id":"(UC[\w-]{22})"/]) {
        const m = html.match(pat); if (m) { id = m[1]; break }
      }
      await saveChannelId(handle, id)
      return id
    } catch { return null }
  }
  async function browseTab(channelId: string, channelHandle: string, type: keyof typeof TAB_PARAMS, maxPages = 2): Promise<VideoEntry[]> {
    const resp = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', headers: INNERTUBE_HEADERS, body: JSON.stringify({ browseId: channelId, params: TAB_PARAMS[type], context: INNERTUBE_CONTEXT }) }, 12_000)
    if (!resp.ok) throw new Error(`InnerTube ${resp.status}`)
    const data = await resp.json()
    const videos = parseInnerTubeResponse(data, channelHandle, type)
    let token = findContinuationToken(data)
    for (let page = 1; page < maxPages && token; page++) {
      try {
        const contResp = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', headers: INNERTUBE_HEADERS, body: JSON.stringify({ continuation: token, context: INNERTUBE_CONTEXT }) }, 12_000)
        if (!contResp.ok) break
        const contData = await contResp.json()
        videos.push(...parseContinuationResponse(contData, channelHandle, type))
        token = findContinuationToken(contData)
      } catch { break }
    }
    return videos
  }
  async function fetchRssVideos(channelId: string, channelHandle: string): Promise<VideoEntry[]> {
    const resp = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml,*/*' } }, 8_000)
    if (!resp.ok) throw new Error(`RSS ${resp.status}`)
    return parseRssVideos(await resp.text(), channelHandle)
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function fetchPlaylistPage(playlistId: string, maxResults = 50, pageToken?: string): Promise<{ items: any[]; nextPageToken?: string }> {
    const params: Record<string, string> = { part: 'snippet,contentDetails', playlistId, maxResults: String(maxResults), key: o.apiKey ?? '' }
    if (pageToken) params.pageToken = pageToken
    const resp = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/playlistItems?${new URLSearchParams(params)}`, {}, 15_000)
    if (!resp.ok) throw new Error(`playlistItems ${resp.status}`)
    const data: any = await resp.json()
    return { items: data.items ?? [], nextPageToken: data.nextPageToken }
  }
  async function fetchVideoDetails(videoIds: string[]) {
    const result = new Map<string, { type: VideoEntry['type']; isLiveNow: boolean; durationSeconds: number; description: string; liveDate: string | null }>()
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50)
      try {
        const resp = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'snippet,contentDetails,liveStreamingDetails', id: batch.join(','), key: o.apiKey ?? '' })}`, {}, 15_000)
        if (!resp.ok) continue
        const data: any = await resp.json()
        for (const item of (data.items ?? []) as any[]) {
          const isLiveNow = item.snippet?.liveBroadcastContent === 'live'
          const isPastLive = !!item.liveStreamingDetails && !isLiveNow
          const durationSeconds = parseIsoDuration(item.contentDetails?.duration ?? 'PT0S')
          const isShort = !isLiveNow && !isPastLive && durationSeconds > 0 && durationSeconds <= 60
          const type: VideoEntry['type'] = (isLiveNow || isPastLive) ? 'live' : isShort ? 'short' : 'video'
          const description: string = item.snippet?.description ?? ''
          const liveDate: string | null = (isLiveNow || isPastLive) ? (item.liveStreamingDetails?.actualStartTime ?? item.liveStreamingDetails?.scheduledStartTime ?? null) : null
          result.set(item.id as string, { type, isLiveNow, durationSeconds, description, liveDate })
        }
      } catch { /* skip batch */ }
    }
    return result
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  async function fetchDescription(videoId: string): Promise<string> {
    const row = await db().get<{ description: string }>('SELECT description FROM youtube_videos WHERE video_id = ?', [videoId])
    if (row?.description) return row.description
    try {
      const resp = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: INNERTUBE_HEADERS, body: JSON.stringify({ videoId, context: INNERTUBE_CONTEXT }) }, 12_000)
      if (!resp.ok) return ''
      const data = await resp.json() as { videoDetails?: { shortDescription?: string } }
      const desc = data?.videoDetails?.shortDescription ?? ''
      if (desc) await db().run('UPDATE youtube_videos SET description = ? WHERE video_id = ?', [desc, videoId])
      return desc
    } catch { return '' }
  }

  /** Refresh — free (InnerTube + RSS); every user. */
  async function refresh(): Promise<{ added: number; liveUpdated: number }> {
    let totalAdded = 0, totalLiveUpdated = 0, done = 0
    progress({ done: 0, total: channels.length, phase: 'Checking channels…' })
    await Promise.all(channels.map(async (handle) => {
      try {
        const channelId = await resolveHandle(handle)
        if (!channelId) return
        const existingIds = await getExistingVideoIds(handle)
        const seenIds = new Set<string>(existingIds)
        const newVideos: VideoEntry[] = []
        const addNew = (entries: VideoEntry[]) => { for (const v of entries) if (!seenIds.has(v.videoId)) { seenIds.add(v.videoId); newVideos.push(v) } }
        const liveDateCorrections: VideoEntry[] = []
        await Promise.all((['video', 'short', 'live'] as const).map(async (type) => {
          try {
            const entries = await browseTab(channelId, handle, type, 2)
            addNew(entries)
            if (type === 'live') for (const v of entries) if (existingIds.has(v.videoId)) liveDateCorrections.push(v)
          } catch { /* tab absent */ }
        }))
        if (liveDateCorrections.length > 0) {
          await db().transaction(async (tx) => { for (const v of liveDateCorrections) await tx.run("UPDATE youtube_videos SET published = ? WHERE video_id = ? AND type = 'live' AND published != ?", [v.published, v.videoId, v.published]) })
        }
        try {
          for (const rv of await fetchRssVideos(channelId, handle)) {
            const existing = newVideos.find((v) => v.videoId === rv.videoId)
            if (existing) {
              if (existing.type !== 'live') existing.published = rv.published
              if (existing.type === 'video') existing.channelName = rv.channelName
            } else if (!existingIds.has(rv.videoId)) {
              seenIds.add(rv.videoId); newVideos.push(rv)
            } else {
              await db().run("UPDATE youtube_videos SET published = ? WHERE video_id = ? AND published < ? AND type != 'live'", [rv.published, rv.videoId, new Date(Date.now() - 60_000).toISOString()])
            }
          }
        } catch { /* supplemental */ }
        totalAdded += await upsertVideos(newVideos)
        try {
          const liveVideos = await browseTab(channelId, handle, 'live', 1)
          const liveIds = new Set(liveVideos.filter((v) => v.isLiveNow).map((v) => v.videoId))
          const liveNew = liveVideos.filter((v) => v.isLiveNow && !seenIds.has(v.videoId))
          if (liveNew.length > 0) { totalAdded += await upsertVideos(liveNew); liveNew.forEach((v) => seenIds.add(v.videoId)) }
          totalLiveUpdated += await updateLiveStatus(handle, liveIds)
        } catch { /* live tab absent */ }
        await markSynced(handle, 'refresh')
      } catch { /* channel failed — others continue */ }
      done++
      progress({ done, total: channels.length, phase: `Updated ${done}/${channels.length}` })
    }))
    ctx.events.emit('data:changed', { entity: 'youtube_video', op: 'bulk' })
    return { added: totalAdded, liveUpdated: totalLiveUpdated }
  }

  /** Full Sync — Data API (quota), dev + key only, like desktop. */
  async function fullSync(): Promise<{ added: number } | { error: string }> {
    if (!ctx.isDev) return { error: 'unavailable in production' }
    if (!o.apiKey) return { error: 'no API key' }
    let totalAdded = 0
    for (let i = 0; i < channels.length; i++) {
      const handle = channels[i]
      progress({ done: i, total: channels.length, phase: `Syncing ${handle}…` })
      try {
        const channelId = await resolveHandle(handle)
        if (!channelId) continue
        const uploadsId = 'UU' + channelId.substring(2)
        const allItems: unknown[] = []
        let pageToken: string | undefined
        do {
          const { items, nextPageToken } = await fetchPlaylistPage(uploadsId, 50, pageToken)
          allItems.push(...items); pageToken = nextPageToken
          if (allItems.length >= 1000) break
        } while (pageToken)
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const videoIds = (allItems as any[]).map((item) => item.snippet?.resourceId?.videoId as string | undefined).filter((id): id is string => Boolean(id))
        const detailsMap = await fetchVideoDetails(videoIds)
        const videos: VideoEntry[] = (allItems as any[]).flatMap((item): VideoEntry[] => {
          const videoId: string = item.snippet?.resourceId?.videoId ?? ''
          if (!videoId) return []
          const details = detailsMap.get(videoId)
          return [{
            videoId, title: decodeXml(item.snippet?.title ?? videoId),
            published: details?.liveDate ?? item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? new Date(0).toISOString(),
            channelName: decodeXml(item.snippet?.videoOwnerChannelTitle ?? handle), channelHandle: handle,
            thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            type: details?.type ?? 'video', isLiveNow: details?.isLiveNow ?? false, durationSeconds: details?.durationSeconds ?? 0, isStarred: false, description: details?.description ?? '',
          }]
        })
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const currentlyLiveIds = new Set(videos.filter((v) => v.isLiveNow).map((v) => v.videoId))
        try {
          const liveEntries = await browseTab(channelId, handle, 'live', 1)
          const existingInSet = new Set(videos.map((v) => v.videoId))
          for (const lv of liveEntries.filter((v) => v.isLiveNow)) { currentlyLiveIds.add(lv.videoId); if (!existingInSet.has(lv.videoId)) videos.push(lv) }
        } catch { /* live tab may not exist */ }
        totalAdded += await upsertVideos(videos)
        await updateLiveStatus(handle, currentlyLiveIds)
        await markSynced(handle, 'full')
      } catch { /* next channel */ }
      progress({ done: i + 1, total: channels.length, phase: `Synced ${handle}` })
    }
    progress({ done: channels.length, total: channels.length, phase: 'Filling missing details…' })
    await fillMissingDetails()
    progress({ done: channels.length, total: channels.length, phase: 'Done' })
    ctx.events.emit('data:changed', { entity: 'youtube_video', op: 'bulk' })
    return { added: totalAdded }
  }

  async function fillMissingDetails(): Promise<void> {
    const missingIds = (await db().all<{ video_id: string }>("SELECT video_id FROM youtube_videos WHERE duration_seconds = 0 OR description = ''")).map((r) => r.video_id)
    if (missingIds.length === 0) return
    progress({ done: 0, total: missingIds.length, phase: `Fetching details for ${missingIds.length} videos…` })
    const detailsMap = await fetchVideoDetails(missingIds)
    await db().transaction(async (tx) => {
      for (const [vid, d] of detailsMap.entries()) {
        await tx.run(`UPDATE youtube_videos SET
            duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
            type = CASE WHEN ? > 0 THEN ? ELSE type END,
            is_live_now = ?,
            description = CASE WHEN ? != '' THEN ? ELSE description END
          WHERE video_id = ?`, [d.durationSeconds, d.durationSeconds, d.durationSeconds, d.type, d.isLiveNow ? 1 : 0, d.description, d.description, vid])
      }
    })
    progress({ done: missingIds.length, total: missingIds.length, phase: `Filled details for ${detailsMap.size} videos` })
  }

  /** Title / channel search over stored videos (FloatingSearch, AI Lookup). */
  async function searchVideos(query: string, limit = 8): Promise<YoutubeVideoSearchResult[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    const pat = `%${trimmed.toLowerCase()}%`
    type Row = { video_id: string; title: string; channel_name: string; thumbnail_url: string; type: string; published: string }
    let rows = await db().all<Row>(`SELECT video_id, title, channel_name, thumbnail_url, type, published FROM youtube_videos WHERE LOWER(title) LIKE ? OR LOWER(channel_name) LIKE ? ORDER BY published DESC LIMIT ?`, [pat, pat, limit])
    if (rows.length === 0) {
      const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
      if (tokens.length > 1) {
        try {
          const conditions = tokens.map(() => '(LOWER(title) LIKE ? OR LOWER(channel_name) LIKE ?)').join(' AND ')
          rows = await db().all<Row>(`SELECT video_id, title, channel_name, thumbnail_url, type, published FROM youtube_videos WHERE ${conditions} ORDER BY published DESC LIMIT ${Number(limit)}`, tokens.flatMap((t) => [`%${t}%`, `%${t}%`]))
        } catch { /* ignore */ }
      }
    }
    return rows.map((r) => ({ videoId: r.video_id, title: r.title, channelName: r.channel_name, thumbnailUrl: r.thumbnail_url, type: r.type, published: r.published }))
  }

  return { refresh, fullSync, fetchDescription, searchVideos, resolveHandle, browseTab, fetchRssVideos, upsertVideos }
}

export type YoutubeFetchService = ReturnType<typeof createYoutubeFetchService>
