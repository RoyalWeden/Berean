import { ipcMain, net, BrowserWindow, app } from 'electron'
import type { WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { getBereanDb } from '../db/berean'

// API key is in electron/youtube-key.ts (gitignored — never commit that file).
// Vite bundles it into the compiled output so end-users never see the source.
import { YOUTUBE_API_KEY } from '../youtube-key'

// ─── Channel list ─────────────────────────────────────────────────────────────
export const CHANNELS = [
  '@matthewforyeshua',
  '@andrewrepent',
  '@SpiritofTruth.Remnant',
  '@matthew953',
  '@antonio-praiseyah3137',
  '@matthewg44yehovah',
  '@marinaforyehovah',
  '@TheNarrowWay_144',
  '@a.k.a.watchmenwakeup',
  '@TheWrathOfGodIsComing',
  '@joseph_amoz',
  '@meg__yeshua',
  '@Tee4Yahovah',
  '@kathiholmes144',
  '@s2milne',
  '@Chefsammysosa',
  '@Dub4Yah',
  '@sandrakluey1856',
  '@yahsavesthroughyeshua',
  '@Brittneyapeculiarwoman',
  '@seekhimearly',
  '@aWatchmanInEphraim144',
  '@Lookingforlostsheep',
  '@vladimirputin1519',
  '@Help.Gather.Yahs.People',
  '@MikePhillips-g4o',
  '@kaylapsalm684',
  '@Lylah-h5l',
  '@OutofTheMouthofBabe144',
  '@JacobTheServant98',
  '@tishacobb2810',
  '@YahovasSling',
  '@Yeshua_1s_King',
  '@Vinny-h1v',
  '@Keepthe10CommandmentsEatClean',
  '@KeyofDavid-kz5jn',
  '@womenrepent',
  '@repentandkeepthe10commandments',
  '@YESHUA1994-w8x',
  '@yaravilla3516',
  '@PeculiarPeople_',
  '@Michael-Rebecca-7',
  '@evelynblair544',
  '@michaelfollowsyah',
  '@Sara.I.Lawrence',
  '@RoyalLawYeshua',
  '@CalledToBeSaintsforYeshua',
  '@PraiseYahforever12',
  '@hollyavila',
  '@Nathan-pl2xj',
  '@DavidAJShepherd',
  '@repent-obey',
  '@Yahsaves144',
  '@straitisthegatedotnet',
  '@oftheolivebranch5815',
  '@It-shall-come-to-pass',
  '@LukeGamage20',
  '@darrelbigdaddywhite',
  '@Watchman4433',
  '@chrisavila7944',
  '@kyannarepent',
  '@rickyfransley',
  '@NickJohnson768',
]
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── InnerTube constants ──────────────────────────────────────────────────────

const TAB_PARAMS = {
  video: 'EgZ2aWRlb3PyBgQKAjoA',
  short: 'EgZzaG9ydHPyBgUKA5oBAA==',
  live:  'EgdzdHJlYW1z8gYECgJ6AA==',
} as const

const INNERTUBE_HEADERS = {
  'Content-Type': 'application/json',
  'X-YouTube-Client-Name': '1',
  'X-YouTube-Client-Version': '2.20240614.07.00',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://www.youtube.com',
  'Referer': 'https://www.youtube.com/',
}

const INNERTUBE_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: '2.20240614.07.00', hl: 'en', gl: 'US' },
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
}

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0')
}

function tryParseRelativeDate(text: string): string | null {
  // Abbreviated: "3mo ago", "1y ago", "2w ago", "3d ago", "5h ago"
  const abbrev = text.match(/(\d+)\s*(mo|y|w|d|h|m|s)\b/)
  if (abbrev) {
    const n = parseInt(abbrev[1])
    const ms: Record<string, number> = {
      s: 1_000, m: 60_000, h: 3_600_000,
      d: 86_400_000, w: 604_800_000, mo: 2_592_000_000, y: 31_536_000_000,
    }
    if (ms[abbrev[2]]) return new Date(Date.now() - n * ms[abbrev[2]]).toISOString()
  }
  // Full words: "3 months ago", "Streamed 9 hours ago", etc.
  const full = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?/)
  if (!full) return null
  const n = parseInt(full[1])
  const ms: Record<string, number> = {
    second: 1_000, minute: 60_000, hour: 3_600_000,
    day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
  }
  return new Date(Date.now() - n * (ms[full[2]] ?? 0)).toISOString()
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await net.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function loadAll(): VideoEntry[] {
  const rows = getBereanDb()
    .prepare('SELECT * FROM youtube_videos ORDER BY published DESC')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all() as any[]
  return rows.map((row) => ({
    videoId:         row.video_id,
    title:           row.title,
    published:       row.published,
    channelName:     row.channel_name,
    channelHandle:   row.channel_handle,
    thumbnailUrl:    row.thumbnail_url,
    type:            row.type as VideoEntry['type'],
    isLiveNow:       Boolean(row.is_live_now),
    durationSeconds: row.duration_seconds ?? 0,
    isStarred:       Boolean(row.is_starred),
    description:     row.description ?? '',
  }))
}

function toggleStar(videoId: string): { isStarred: boolean } {
  const db = getBereanDb()
  const row = db.prepare('SELECT is_starred FROM youtube_videos WHERE video_id = ?').get(videoId) as { is_starred: number } | undefined
  const newVal = row ? (row.is_starred ? 0 : 1) : 0
  db.prepare('UPDATE youtube_videos SET is_starred = ? WHERE video_id = ?').run(newVal, videoId)
  return { isStarred: Boolean(newVal) }
}

function savePosition(videoId: string, seconds: number, meta: { title: string; channelName: string; thumbnailUrl: string }): void {
  getBereanDb().prepare(`
    INSERT INTO youtube_watch_history (video_id, position_seconds, last_watched, title, channel_name, thumbnail_url)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      last_watched     = excluded.last_watched,
      title            = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END,
      channel_name     = CASE WHEN excluded.channel_name != '' THEN excluded.channel_name ELSE channel_name END,
      thumbnail_url    = CASE WHEN excluded.thumbnail_url != '' THEN excluded.thumbnail_url ELSE thumbnail_url END
  `).run(videoId, seconds, new Date().toISOString(), meta.title, meta.channelName, meta.thumbnailUrl)
}

function getPosition(videoId: string): number {
  const row = getBereanDb()
    .prepare('SELECT position_seconds FROM youtube_watch_history WHERE video_id = ?')
    .get(videoId) as { position_seconds: number } | undefined
  return row?.position_seconds ?? 0
}

function getWatchHistory(): WatchHistoryEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getBereanDb().prepare('SELECT * FROM youtube_watch_history ORDER BY last_watched DESC').all() as any[])
    .map((row) => ({
      videoId:         row.video_id,
      positionSeconds: row.position_seconds,
      lastWatched:     row.last_watched,
      title:           row.title,
      channelName:     row.channel_name,
      thumbnailUrl:    row.thumbnail_url,
    }))
}

function removeFromHistory(videoId: string): void {
  getBereanDb().prepare('DELETE FROM youtube_watch_history WHERE video_id = ?').run(videoId)
}

function clearWatchHistory(): void {
  getBereanDb().prepare('DELETE FROM youtube_watch_history').run()
}

async function fetchDescription(videoId: string): Promise<string> {
  const row = getBereanDb()
    .prepare('SELECT description FROM youtube_videos WHERE video_id = ?')
    .get(videoId) as { description: string } | undefined
  if (row?.description) return row.description

  try {
    const resp = await fetchWithTimeout(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: INNERTUBE_HEADERS,
        body: JSON.stringify({ videoId, context: INNERTUBE_CONTEXT }),
      },
      12_000,
    )
    if (!resp.ok) return ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any
    const desc: string = data?.videoDetails?.shortDescription ?? ''
    if (desc) {
      getBereanDb().prepare('UPDATE youtube_videos SET description = ? WHERE video_id = ?').run(desc, videoId)
    }
    return desc
  } catch { return '' }
}

// Returns number of newly-inserted rows (existing rows updated in-place).
function upsertVideos(videos: VideoEntry[]): number {
  if (videos.length === 0) return 0
  const db = getBereanDb()
  const now = new Date().toISOString()
  const check = db.prepare('SELECT 1 FROM youtube_videos WHERE video_id = ?')
  // is_starred: never overwritten (user preference). duration/description: keep existing if new value is absent.
  const insert = db.prepare(`
    INSERT INTO youtube_videos
      (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, is_live_now, duration_seconds, description, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title            = excluded.title,
      published        = excluded.published,
      channel_name     = excluded.channel_name,
      channel_handle   = excluded.channel_handle,
      thumbnail_url    = excluded.thumbnail_url,
      type             = excluded.type,
      is_live_now      = excluded.is_live_now,
      duration_seconds = CASE WHEN excluded.duration_seconds > 0 THEN excluded.duration_seconds ELSE duration_seconds END,
      description      = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
      fetched_at       = excluded.fetched_at
  `)
  let added = 0
  db.transaction((vids: VideoEntry[]) => {
    for (const v of vids) {
      const isNew = !check.get(v.videoId)
      insert.run(v.videoId, v.title, v.published, v.channelName, v.channelHandle, v.thumbnailUrl, v.type, v.isLiveNow ? 1 : 0, v.durationSeconds ?? 0, v.description ?? '', now)
      if (isNew) added++
    }
  })(videos)
  return added
}

// Reset is_live_now for a channel then mark specific videos as live.
function updateLiveStatus(channelHandle: string, liveIds: Set<string>): number {
  const db = getBereanDb()
  db.prepare('UPDATE youtube_videos SET is_live_now = 0 WHERE channel_handle = ?').run(channelHandle)
  if (liveIds.size > 0) {
    const placeholders = Array.from({ length: liveIds.size }, () => '?').join(',')
    db.prepare(`UPDATE youtube_videos SET is_live_now = 1 WHERE video_id IN (${placeholders})`).run(...liveIds)
  }
  return liveIds.size
}

function getExistingVideoIds(channelHandle: string): Set<string> {
  const rows = getBereanDb()
    .prepare('SELECT video_id FROM youtube_videos WHERE channel_handle = ?')
    .all(channelHandle) as { video_id: string }[]
  return new Set(rows.map((r) => r.video_id))
}

function markSynced(channelHandle: string, kind: 'full' | 'refresh'): void {
  const db = getBereanDb()
  const col = kind === 'full' ? 'last_full_sync' : 'last_refresh'
  db.prepare(`INSERT INTO youtube_sync (channel_handle, ${col}) VALUES (?, ?)
    ON CONFLICT(channel_handle) DO UPDATE SET ${col} = excluded.${col}`)
    .run(channelHandle, new Date().toISOString())
}

function clearAll(): void {
  const db = getBereanDb()
  db.prepare('DELETE FROM youtube_videos').run()
  db.prepare('DELETE FROM youtube_sync').run()
  db.prepare("DELETE FROM settings WHERE key LIKE 'ytHandle:%'").run()
}

// ─── Channel ID resolution (cached in settings table) ─────────────────────────

function loadCachedChannelId(handle: string): string | null {
  try {
    const row = getBereanDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`ytHandle:${handle}`) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as string | null) : null
  } catch { return null }
}

function saveChannelId(handle: string, id: string | null): void {
  try {
    getBereanDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(`ytHandle:${handle}`, JSON.stringify(id))
  } catch { /* non-critical */ }
}

async function resolveHandle(handle: string): Promise<string | null> {
  const persisted = loadCachedChannelId(handle)
  if (persisted !== null) return persisted || null

  try {
    const resp = await fetchWithTimeout(`https://www.youtube.com/${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
    }, 12_000)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()
    const patterns = [
      /"externalId":"(UC[\w-]{22})"/,
      /"channelId":"(UC[\w-]{22})"/,
      /\/channel\/(UC[\w-]{22})["\/]/,
      /"browse_id":"(UC[\w-]{22})"/,
    ]
    let id: string | null = null
    for (const pat of patterns) {
      const m = html.match(pat)
      if (m) { id = m[1]; break }
    }
    saveChannelId(handle, id)
    return id
  } catch { return null }
}

// ─── YouTube Data API v3 helpers (Full Sync) ──────────────────────────────────

async function fetchPlaylistPage(
  playlistId: string,
  maxResults = 50,
  pageToken?: string,
): Promise<{ items: any[]; nextPageToken?: string }> {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const params: Record<string, string> = {
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: String(maxResults),
    key: YOUTUBE_API_KEY,
  }
  if (pageToken) params.pageToken = pageToken
  const resp = await fetchWithTimeout(
    `https://www.googleapis.com/youtube/v3/playlistItems?${new URLSearchParams(params)}`,
    {},
    15_000,
  )
  if (!resp.ok) throw new Error(`playlistItems ${resp.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await resp.json()
  return { items: data.items ?? [], nextPageToken: data.nextPageToken }
}

// Returns type, live status, duration, and description for each video ID via videos.list in batches of 50.
async function fetchVideoDetails(videoIds: string[]): Promise<Map<string, { type: VideoEntry['type']; isLiveNow: boolean; durationSeconds: number; description: string }>> {
  const result = new Map<string, { type: VideoEntry['type']; isLiveNow: boolean; durationSeconds: number; description: string }>()
  if (videoIds.length === 0) return result

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    try {
      const resp = await fetchWithTimeout(
        `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
          part: 'snippet,contentDetails,liveStreamingDetails',
          id: batch.join(','),
          key: YOUTUBE_API_KEY,
        })}`,
        {},
        15_000,
      )
      if (!resp.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await resp.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of (data.items ?? []) as any[]) {
        const isLiveNow     = item.snippet?.liveBroadcastContent === 'live'
        const isPastLive    = !!item.liveStreamingDetails && !isLiveNow
        const durationSeconds = parseIsoDuration(item.contentDetails?.duration ?? 'PT0S')
        const isShort       = !isLiveNow && !isPastLive && durationSeconds > 0 && durationSeconds <= 60
        const type: VideoEntry['type'] = (isLiveNow || isPastLive) ? 'live' : isShort ? 'short' : 'video'
        const description: string = item.snippet?.description ?? ''
        result.set(item.id as string, { type, isLiveNow, durationSeconds, description })
      }
    } catch { /* skip batch */ }
  }
  return result
}

// ─── InnerTube helpers (Refresh — free, no API quota) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* walkContent(obj: any, depth = 0): Generator<any> {
  if (depth > 30 || !obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const v of obj) yield* walkContent(v, depth + 1)
    return
  }
  if (obj.videoRenderer)     { yield obj.videoRenderer;     return }
  if (obj.gridVideoRenderer) { yield obj.gridVideoRenderer; return }
  if (obj.reelItemRenderer)  { yield obj.reelItemRenderer;  return }
  if (obj.shortsLockupViewModel) {
    const vm = obj.shortsLockupViewModel
    const videoId: string =
      vm?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
      vm?.onTap?.innertubeCommand?.navigationEndpoint?.reelWatchEndpoint?.videoId ??
      (vm?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url as string | undefined)
        ?.match(/\/shorts\/([\w-]+)/)?.[1] ?? ''
    const title: string = vm?.overlayMetadata?.primaryText?.content ?? vm?.accessibilityText ?? ''
    if (videoId) yield { videoId, title: { runs: [{ text: title || videoId }] }, __noDate: true }
    return
  }
  for (const v of Object.values(obj)) yield* walkContent(v, depth + 1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCurrentlyLive(renderer: any): boolean {
  const overlays: unknown[] = renderer?.thumbnailOverlays ?? []
  if (overlays.some((o: any) => o?.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE')) return true // eslint-disable-line @typescript-eslint/no-explicit-any
  const badges: unknown[] = renderer?.badges ?? renderer?.ownerBadges ?? []
  return badges.some((b: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    b?.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW' ||
    (b?.metadataBadgeRenderer?.label as string | undefined)?.toUpperCase().includes('LIVE'),
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDate(renderer: any): string {
  const candidates: string[] = [
    renderer?.publishedTimeText?.simpleText,
    ...(renderer?.publishedTimeText?.runs ?? []).map((r: any) => r?.text ?? ''), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...(renderer?.videoInfo?.runs ?? []).map((r: any) => r?.text ?? ''), // eslint-disable-line @typescript-eslint/no-explicit-any
    renderer?.publishedTime,
  ].filter(Boolean) as string[]
  for (const text of candidates) {
    const d = tryParseRelativeDate(text)
    if (d) return d
  }
  if (isCurrentlyLive(renderer)) return new Date().toISOString()
  return new Date(0).toISOString()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEntry(renderer: any, channelHandle: string, requestedType: VideoEntry['type']): VideoEntry | null {
  const videoId: string = renderer?.videoId ?? ''
  const title: string =
    renderer?.title?.runs?.[0]?.text ??
    renderer?.headline?.runs?.[0]?.text ?? ''
  if (!videoId || !title) return null

  const liveNow = isCurrentlyLive(renderer)
  const type: VideoEntry['type'] = liveNow ? 'live' : requestedType
  const channelName: string =
    renderer?.ownerText?.runs?.[0]?.text ??
    renderer?.shortBylineText?.runs?.[0]?.text ??
    channelHandle

  return {
    videoId,
    title:           decodeXml(title),
    published:       liveNow ? new Date().toISOString() : extractDate(renderer),
    channelName:     decodeXml(channelName) || channelHandle,
    channelHandle,
    thumbnailUrl:    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    type,
    isLiveNow:       liveNow,
    durationSeconds: 0,
    isStarred:       false,
    description:     '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseInnerTubeResponse(data: any, channelHandle: string, type: VideoEntry['type']): VideoEntry[] {
  const tabs: unknown[] =
    data?.contents?.twoColumnBrowseResultsRenderer?.tabs ??
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabContent: any =
    (tabs as any[]).find((t) => t?.tabRenderer?.selected === true)?.tabRenderer?.content ?? // eslint-disable-line @typescript-eslint/no-explicit-any
    (tabs as any[]).find((t) => t?.tabRenderer?.content != null)?.tabRenderer?.content // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!tabContent) return []
  const videos: VideoEntry[] = []
  for (const renderer of walkContent(tabContent)) {
    const entry = extractEntry(renderer, channelHandle, type)
    if (entry) videos.push(entry)
  }
  return videos
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseContinuationResponse(data: any, channelHandle: string, type: VideoEntry['type']): VideoEntry[] {
  const items: unknown[] =
    data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ?? []
  const videos: VideoEntry[] = []
  for (const renderer of walkContent(items)) {
    const entry = extractEntry(renderer, channelHandle, type)
    if (entry) videos.push(entry)
  }
  return videos
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findContinuationToken(data: any, depth = 0): string | null {
  if (depth > 30 || !data || typeof data !== 'object') return null
  if (data.continuationItemRenderer) {
    const token = data.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
    if (typeof token === 'string') return token
  }
  const values = Array.isArray(data) ? data : Object.values(data)
  for (const v of values) {
    const found = findContinuationToken(v, depth + 1)
    if (found) return found
  }
  return null
}

async function browseTab(
  channelId: string,
  channelHandle: string,
  type: keyof typeof TAB_PARAMS,
  maxPages = 2,
): Promise<VideoEntry[]> {
  const resp = await fetchWithTimeout(
    'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
    {
      method: 'POST',
      headers: INNERTUBE_HEADERS,
      body: JSON.stringify({ browseId: channelId, params: TAB_PARAMS[type], context: INNERTUBE_CONTEXT }),
    },
    12_000,
  )
  if (!resp.ok) throw new Error(`InnerTube ${resp.status}`)
  const data = await resp.json()
  const videos = parseInnerTubeResponse(data, channelHandle, type)
  let token = findContinuationToken(data)
  for (let page = 1; page < maxPages && token; page++) {
    try {
      const contResp = await fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
        {
          method: 'POST',
          headers: INNERTUBE_HEADERS,
          body: JSON.stringify({ continuation: token, context: INNERTUBE_CONTEXT }),
        },
        12_000,
      )
      if (!contResp.ok) break
      const contData = await contResp.json()
      videos.push(...parseContinuationResponse(contData, channelHandle, type))
      token = findContinuationToken(contData)
    } catch { break }
  }
  return videos
}

// RSS gives exact ISO dates for the 15 most recent videos.
async function fetchRssVideos(channelId: string, channelHandle: string): Promise<VideoEntry[]> {
  const resp = await fetchWithTimeout(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml,*/*' } },
    8_000,
  )
  if (!resp.ok) throw new Error(`RSS ${resp.status}`)
  const xml = await resp.text()
  const entries: VideoEntry[] = []
  const re = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const e = m[1]
    const videoId   = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]
    const titleRaw  = e.match(/<title>([^<]+)<\/title>/)?.[1]
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1]
    const chanName  = e.match(/<name>([^<]+)<\/name>/)?.[1]
    if (videoId && titleRaw && published) {
      entries.push({
        videoId,
        title:           decodeXml(titleRaw),
        published,
        channelName:     chanName ? decodeXml(chanName) : channelHandle,
        channelHandle,
        thumbnailUrl:    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        type:            'video',
        isLiveNow:       false,
        durationSeconds: 0,
        isStarred:       false,
        description:     '',
      })
    }
  }
  return entries
}

// ─── Full Sync (dev + API key only) ──────────────────────────────────────────

async function fullSync(sender: WebContents): Promise<{ added: number }> {
  let totalAdded = 0

  for (let i = 0; i < CHANNELS.length; i++) {
    const handle = CHANNELS[i]
    sender.send('youtube:progress', { done: i, total: CHANNELS.length, phase: `Syncing ${handle}…` })

    try {
      const channelId = await resolveHandle(handle)
      if (!channelId) continue

      // Uploads playlist ID = replace 'UC' prefix with 'UU'
      const uploadsId = 'UU' + channelId.substring(2)

      // Fetch all pages of the uploads playlist (1 API unit per page of 50)
      const allItems: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
      let pageToken: string | undefined
      do {
        const { items, nextPageToken } = await fetchPlaylistPage(uploadsId, 50, pageToken)
        allItems.push(...items)
        pageToken = nextPageToken
        if (allItems.length >= 1000) break // safety cap
      } while (pageToken)

      // Fetch video details for type + live detection (1 API unit per 50 videos)
      const videoIds = allItems
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => item.snippet?.resourceId?.videoId as string | undefined)
        .filter((id): id is string => Boolean(id))
      const detailsMap = await fetchVideoDetails(videoIds)

      // Build VideoEntry objects from playlist items + details
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videos: VideoEntry[] = allItems.flatMap((item: any): VideoEntry[] => {
        const videoId: string = item.snippet?.resourceId?.videoId ?? ''
        if (!videoId) return []
        const details = detailsMap.get(videoId)
        const title = decodeXml(item.snippet?.title ?? videoId)
        const published =
          item.contentDetails?.videoPublishedAt ??
          item.snippet?.publishedAt ??
          new Date(0).toISOString()
        const channelName = decodeXml(item.snippet?.videoOwnerChannelTitle ?? handle)
        const thumbnailUrl =
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

        return [{
          videoId,
          title,
          published,
          channelName,
          channelHandle:   handle,
          thumbnailUrl,
          type:            details?.type ?? 'video',
          isLiveNow:       details?.isLiveNow ?? false,
          durationSeconds: details?.durationSeconds ?? 0,
          isStarred:       false,
          description:     details?.description ?? '',
        }]
      })

      // Also check InnerTube live tab for any currently-broadcasting streams
      // (live streams don't appear in the uploads playlist until they end)
      const currentlyLiveIds = new Set(videos.filter((v) => v.isLiveNow).map((v) => v.videoId))
      try {
        const liveEntries = await browseTab(channelId, handle, 'live', 1)
        const existingInSet = new Set(videos.map((v) => v.videoId))
        for (const lv of liveEntries.filter((v) => v.isLiveNow)) {
          currentlyLiveIds.add(lv.videoId)
          if (!existingInSet.has(lv.videoId)) videos.push(lv)
        }
      } catch { /* live tab may not exist */ }

      totalAdded += upsertVideos(videos)
      updateLiveStatus(handle, currentlyLiveIds)
      markSynced(handle, 'full')
    } catch (err) {
    }

    sender.send('youtube:progress', { done: i + 1, total: CHANNELS.length, phase: `Synced ${handle}` })
  }

  // Fill missing details (duration=0 or no description) for any pre-existing videos
  sender.send('youtube:progress', { done: CHANNELS.length, total: CHANNELS.length, phase: 'Filling missing details…' })
  await fillMissingDetails(sender)

  sender.send('youtube:progress', { done: CHANNELS.length, total: CHANNELS.length, phase: 'Done' })
  return { added: totalAdded }
}

// Fetch and backfill details for videos that have duration_seconds=0 or empty description.
async function fillMissingDetails(sender: WebContents): Promise<void> {
  const db = getBereanDb()
  const missingIds = (db.prepare(
    "SELECT video_id FROM youtube_videos WHERE duration_seconds = 0 OR description = ''"
  ).all() as { video_id: string }[]).map((r) => r.video_id)

  if (missingIds.length === 0) return

  sender.send('youtube:progress', { done: 0, total: missingIds.length, phase: `Fetching details for ${missingIds.length} videos…` })

  const detailsMap = await fetchVideoDetails(missingIds)

  const updateStmt = db.prepare(`
    UPDATE youtube_videos
    SET
      duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
      type             = CASE WHEN ? > 0 THEN ? ELSE type END,
      is_live_now      = ?,
      description      = CASE WHEN ? != '' THEN ? ELSE description END
    WHERE video_id = ?
  `)

  db.transaction(() => {
    for (const [vid, d] of detailsMap.entries()) {
      updateStmt.run(
        d.durationSeconds, d.durationSeconds,
        d.durationSeconds, d.type,
        d.isLiveNow ? 1 : 0,
        d.description, d.description,
        vid,
      )
    }
  })()
  sender.send('youtube:progress', { done: missingIds.length, total: missingIds.length, phase: `Filled details for ${detailsMap.size} videos` })
}

// ─── Refresh (all users — free InnerTube + RSS, no API quota) ────────────────

async function refresh(sender: WebContents): Promise<{ added: number; liveUpdated: number }> {
  let totalAdded = 0
  let totalLiveUpdated = 0
  let done = 0

  sender.send('youtube:progress', { done: 0, total: CHANNELS.length, phase: 'Checking channels…' })

  await Promise.all(CHANNELS.map(async (handle) => {
    try {
      const channelId = await resolveHandle(handle)
      if (!channelId) return

      const existingIds = getExistingVideoIds(handle)
      const seenIds = new Set<string>(existingIds)
      const newVideos: VideoEntry[] = []

      function addNew(entries: VideoEntry[]) {
        for (const v of entries) {
          if (!seenIds.has(v.videoId)) { seenIds.add(v.videoId); newVideos.push(v) }
        }
      }

      // Browse Videos + Shorts + Live tabs via InnerTube (free, 2 pages each)
      await Promise.all(
        (['video', 'short', 'live'] as const).map(async (type) => {
          try { addNew(await browseTab(channelId, handle, type, 2)) }
          catch { /* tab absent */ }
        }),
      )

      // Upgrade approximate dates → exact ISO dates for 15 most recent via RSS
      try {
        for (const rv of await fetchRssVideos(channelId, handle)) {
          const existing = newVideos.find((v) => v.videoId === rv.videoId)
          if (existing) {
            existing.published = rv.published
            if (existing.type === 'video') existing.channelName = rv.channelName
          } else if (!existingIds.has(rv.videoId)) {
            // RSS entry not yet in DB and not captured by InnerTube
            seenIds.add(rv.videoId)
            newVideos.push(rv)
          } else {
            // Already in DB — update its published date to the exact one from RSS
            const db = getBereanDb()
            db.prepare('UPDATE youtube_videos SET published = ? WHERE video_id = ? AND published < ?')
              .run(rv.published, rv.videoId, new Date(Date.now() - 60_000).toISOString())
          }
        }
      } catch { /* supplemental, ignore */ }

      totalAdded += upsertVideos(newVideos)

      // Update live status for this channel using InnerTube live tab (free)
      try {
        const liveVideos = await browseTab(channelId, handle, 'live', 1)
        const liveIds = new Set(liveVideos.filter((v) => v.isLiveNow).map((v) => v.videoId))

        // Upsert any currently-live videos not yet in DB
        const liveNew = liveVideos.filter((v) => v.isLiveNow && !seenIds.has(v.videoId))
        if (liveNew.length > 0) {
          totalAdded += upsertVideos(liveNew)
          liveNew.forEach((v) => seenIds.add(v.videoId))
        }

        totalLiveUpdated += updateLiveStatus(handle, liveIds)
      } catch { /* live tab absent */ }

      markSynced(handle, 'refresh')
    } catch (err) {
    }

    done++
    sender.send('youtube:progress', { done, total: CHANNELS.length, phase: `Updated ${done}/${CHANNELS.length}` })
  }))

  return { added: totalAdded, liveUpdated: totalLiveUpdated }
}

// ─── Transcript helpers ───────────────────────────────────────────────────────

function parseTsMs(ts: string): number {
  const [h, m, s] = ts.split(':')
  return Math.round((parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)) * 1000)
}

const ENTITY_MAP: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

/** Decode HTML entities (incl. double-encoded) in caption text before storing. */
function decodeHtmlEntities(text: string): string {
  if (!text || text.indexOf('&') === -1) return text
  const once = (s: string) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole
  })
  let out = once(text)
  if (out.indexOf('&') !== -1) out = once(out)
  return out
}

// ─── Transcript extraction JS — runs inside the BrowserWindow renderer ────────

/** Extracts timestamped transcript rows from the tactiq.io result page. */
const EXTRACT_JS = `
(function() {
  const codes = Array.from(document.querySelectorAll('li code')).filter(el =>
    /^\\d{2}:\\d{2}:\\d{2}\\.\\d{3}$/.test((el.textContent || '').trim())
  );
  // tactiq renders an error heading when a video has no captions available.
  const bodyText = (document.body && document.body.innerText || '');
  const noTranscript = /Couldn't get transcript|Couldn't video ID|No transcript|transcript is not available/i.test(bodyText);
  return {
    count: codes.length,
    noTranscript,
    bodyPreview: bodyText.slice(0, 200).replace(/\\s+/g, ' '),
    rows: codes.map(code => ({
      ts: code.textContent.trim(),
      text: (code.parentElement.textContent || '').replace(code.textContent, '').trim()
    }))
  };
})()
`

type ExtractResult = {
  count: number
  noTranscript: boolean
  bodyPreview: string
  rows: Array<{ ts: string; text: string }>
}

type Seg = { start_ms: number; dur_ms: number; text: string }

/** Outcome of one extraction: rows found, permanently absent, or a transient timeout. */
type ExtractOutcome =
  | { kind: 'ok'; segs: Seg[] }
  | { kind: 'none'; reason: string }    // no transcript available — record so it isn't retried
  | { kind: 'timeout'; reason: string } // transient — leave unrecorded so the next run retries it

/** Run one video through a BrowserWindow worker: load page, poll for rows. */
async function extractOneVideo(
  win: BrowserWindow,
  video_id: string,
  warmedUp: boolean,
  apiStatus: { code: number },
): Promise<ExtractOutcome> {
  // On first use, warm up by visiting the form page so tactiq.io sets its cookies/session.
  if (!warmedUp) {
    await win.loadURL('https://tactiq.io/tools/youtube-transcript').catch(() => {})
    await new Promise((r) => setTimeout(r, 1500))
  }

  apiStatus.code = 0 // reset before this video's API call fires
  const url = `https://tactiq.io/tools/run/youtube_transcript?yt=${encodeURIComponent(`https://www.youtube.com/watch?v=${video_id}`)}`
  console.log(`[transcript] Loading ${video_id}`)

  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 1000))

  const deadline = Date.now() + 30_000
  let attempt = 0

  while (Date.now() < deadline) {
    attempt++
    const result = await win.webContents.executeJavaScript(EXTRACT_JS).catch((e: unknown) => {
      console.log(`[transcript] ${video_id} JS exec error attempt ${attempt}: ${e}`)
      return null
    }) as ExtractResult | null

    if (result) {
      if (attempt === 1) console.log(`[transcript] ${video_id} attempt 1: rows=${result.count} body="${result.bodyPreview}"`)

      if (result.count > 0) {
        console.log(`[transcript] ${video_id} ✓ ${result.count} rows — first: [${result.rows[0]?.ts}] "${result.rows[0]?.text?.slice(0, 60)}"`)
        const segs = result.rows.map((r) => ({ start_ms: parseTsMs(r.ts), dur_ms: 0, text: decodeHtmlEntities(r.text) }))
        for (let j = 0; j < segs.length - 1; j++) segs[j].dur_ms = segs[j + 1].start_ms - segs[j].start_ms
        return { kind: 'ok', segs }
      }

      // tactiq explicitly reported no transcript → permanent, stop polling.
      if (result.noTranscript) {
        console.log(`[transcript] ${video_id} ✗ no transcript available (tactiq error state)`)
        return { kind: 'none', reason: 'no transcript available' }
      }
    }

    // 418 is tactiq's own "this video genuinely has no captions" signal — permanent, record it
    // so it isn't retried. Any OTHER non-2xx (429 = rate-limited, 5xx = tactiq's own backend
    // trouble, etc.) is NOT a statement about the video at all — it means the request itself
    // failed, and treating it as permanent was the actual bug behind most of the missing
    // transcripts: a big batch (many Lives/Shorts, several parallel workers) rate-limits
    // heavily against tactiq, and every 429 was being written as a permanent "no transcript"
    // row — one that fetchTranscripts' candidate query then excludes forever (LEFT JOIN
    // ... WHERE t.video_id IS NULL), so a video that was simply rate-limited for one request
    // could never be attempted again. Confirmed against real data: ~5400 of ~12000 stored
    // transcript rows were exactly this — "no transcript (API 429)" — overwhelmingly on the
    // newly-eligible Lives/Shorts batch. Anything but 418 now falls through as a transient
    // timeout instead, so the next "Get transcripts" run retries it.
    if (apiStatus.code === 418) {
      console.log(`[transcript] ${video_id} ✗ API returned 418 — no transcript available`)
      return { kind: 'none', reason: 'no transcript (API 418)' }
    }
    if (apiStatus.code >= 400) {
      console.log(`[transcript] ${video_id} ✗ API returned ${apiStatus.code} — transient, will retry on next run`)
      return { kind: 'timeout', reason: `API ${apiStatus.code}` }
    }

    await new Promise((r) => setTimeout(r, 800))
  }

  console.log(`[transcript] ${video_id} ✗ timeout after ${attempt} attempts (retryable on next run)`)
  return { kind: 'timeout', reason: `timeout after ${attempt} attempts` }
}

async function fetchTranscripts(
  sender: WebContents,
  batchSize: number,
  workerCount = 3,
): Promise<{ fetched: number; skipped: number; errors: number }> {
  const db = getBereanDb()
  // `type = 'video'` used to exclude Shorts and Lives entirely — tactiq's transcript tool has
  // no such restriction (it just reads YouTube's own caption track for a video_id), so this was
  // silently skipping every Short and every completed livestream. The only real constraint is a
  // CURRENTLY live stream (is_live_now) — its captions aren't finalized yet, so it's excluded;
  // a past/completed livestream (type='live', is_live_now=0) gets captions the same as a normal
  // video once it ends and is fair game here. The >=60s floor stays for type='video' (skips
  // near-empty micro-clips not worth transcribing) but never applied to Shorts, which are
  // legitimately under 60s by definition — that floor would otherwise exclude all of them too.
  const candidates = db.prepare(`
    SELECT v.video_id, v.title FROM youtube_videos v
    LEFT JOIN youtube_transcripts t USING(video_id)
    WHERE t.video_id IS NULL
      AND v.is_live_now = 0
      AND (v.type != 'video' OR v.duration_seconds IS NULL OR v.duration_seconds >= 60)
    ORDER BY v.published DESC
    LIMIT ?
  `).all(batchSize) as Array<{ video_id: string; title: string }>

  console.log(`[transcript] Starting batch: ${candidates.length} candidates, ${workerCount} workers`)
  if (candidates.length === 0) {
    console.log('[transcript] No candidates — all eligible videos already have transcript rows in DB (including error rows). Use Clear Transcripts to retry.')
    sender.send('youtube:progress', { done: 0, total: 0, phase: 'No candidates' })
    return { fetched: 0, skipped: 0, errors: 0 }
  }
  candidates.forEach((c, i) => console.log(`[transcript]   [${i}] ${c.video_id} — ${c.title?.slice(0, 60)}`))

  const insertMeta = db.prepare(
    'INSERT OR REPLACE INTO youtube_transcripts (video_id, lang, source, fetched_at, segment_count, duration_ms, error) VALUES (?,?,?,?,?,?,?)'
  )
  const deleteSeg = db.prepare('DELETE FROM youtube_transcript_segments WHERE video_id = ?')
  const insertSeg = db.prepare(
    'INSERT INTO youtube_transcript_segments (video_id, start_ms, dur_ms, text) VALUES (?,?,?,?)'
  )

  // Shared queue and counters (accessed from multiple workers via closure)
  let queueIdx = 0
  let fetched = 0, skipped = 0, errors = 0
  const total = candidates.length
  const now = Date.now()

  // Worker pool: N hidden BrowserWindows each pulling from the shared queue
  const actualWorkers = Math.min(workerCount, total)
  console.log(`[transcript] Spawning ${actualWorkers} BrowserWindow workers`)

  const runWorker = async (workerId: number) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        javascript: true,
        // Use a dedicated session partition so the app-wide CSP header handler
        // (registered on session.defaultSession in main.ts) does NOT apply here.
        // That CSP injects `script-src 'self'` which blocks tactiq.io from loading
        // reCAPTCHA/Firebase → AppCheck fails → /transcript API never resolves.
        partition: `transcript-worker-${workerId}`,
      },
    })
    // tactiq.io's transcript tool embeds/plays the actual YouTube video to extract captions —
    // `show: false` only hides the window, it doesn't silence it, so a batch fetch (especially
    // with multiple workers) was audibly playing several videos' audio at once in the
    // background. Muted at the WebContents level, independent of window visibility.
    win.webContents.setAudioMuted(true)
    console.log(`[transcript] Worker ${workerId} ready`)
    let warmedUp = false
    // Tracks the status of the latest POST to the tactiq transcript API for the current video.
    // Only 418 (tactiq's own "no captions" signal) is permanent — see extractOneVideo's own
    // comment for why every other non-2xx (429 rate-limit, 5xx, etc.) must NOT be treated the
    // same way.
    const apiStatus = { code: 0 }

    // Capture the transcript API response status (only the POST, not the OPTIONS preflight).
    win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      const { url, statusCode, method } = details
      if (method === 'POST' && url.includes('tactiq-apps-prod.tactiq.io/transcript')) {
        apiStatus.code = statusCode
        console.log(`[transcript] W${workerId} API /transcript → ${statusCode}`)
      }
    })

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Claim next item from the queue
        const myIdx = queueIdx++
        if (myIdx >= total) break

        const { video_id, title } = candidates[myIdx]
        const doneCount = fetched + skipped + errors
        sender.send('youtube:progress', {
          done: doneCount, total,
          phase: `W${workerId}: ${title?.slice(0, 40) || video_id}`,
        })

        const result = await extractOneVideo(win, video_id, warmedUp, apiStatus)
        warmedUp = true

        if (result.kind === 'ok') {
          const { segs } = result
          const duration_ms = segs[segs.length - 1]?.start_ms ?? 0
          db.transaction(() => {
            insertMeta.run(video_id, 'en', 'tactiq', now, segs.length, duration_ms, null)
            deleteSeg.run(video_id)
            for (const seg of segs) insertSeg.run(video_id, seg.start_ms, seg.dur_ms, seg.text)
          })()
          fetched++
          console.log(`[transcript] W${workerId} stored ${segs.length} segs for ${video_id} (${fetched}/${total} done)`)
        } else if (result.kind === 'none') {
          // Permanently no transcript — record an error row so it isn't retried every run.
          insertMeta.run(video_id, 'en', 'tactiq', now, 0, 0, result.reason)
          skipped++
        } else {
          // Transient timeout — do NOT record a row, so the next "Get Transcripts" retries it.
          errors++
          // A 429 means THIS worker just got rate-limited by tactiq — immediately hitting it
          // again on the very next candidate just compounds the problem across a big batch
          // (this is exactly how ~45% of a 12k-video run ended up rate-limited). Back off a
          // few seconds before this worker claims another item; the other workers aren't
          // paused, so overall throughput only dips, it doesn't stall.
          if (result.reason.includes('429')) {
            console.log(`[transcript] W${workerId} rate-limited (429) — backing off 5s`)
            await new Promise((r) => setTimeout(r, 5000))
          }
        }

        sender.send('youtube:progress', { done: fetched + skipped + errors, total, phase: `W${workerId} done: ${video_id}` })
      }
    } finally {
      console.log(`[transcript] Worker ${workerId} finished`)
      win.destroy()
    }
  }

  await Promise.all(Array.from({ length: actualWorkers }, (_, i) => runWorker(i + 1)))

  console.log(`[transcript] Batch complete — fetched=${fetched} skipped=${skipped} errors=${errors}`)
  sender.send('youtube:progress', { done: total, total, phase: 'Done' })
  return { fetched, skipped, errors }
}

function getTranscriptStatus(): Set<string> {
  const rows = getBereanDb()
    .prepare('SELECT video_id FROM youtube_transcripts WHERE segment_count > 0')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all() as Array<{ video_id: string }>
  return new Set(rows.map((r) => r.video_id))
}

/** Returns the stored transcript segments for a video (empty array if none). */
function getTranscript(videoId: string): Array<{ startMs: number; durMs: number; text: string }> {
  const rows = getBereanDb()
    .prepare('SELECT start_ms, dur_ms, text FROM youtube_transcript_segments WHERE video_id = ? ORDER BY start_ms ASC')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all(videoId) as Array<{ start_ms: number; dur_ms: number; text: string }>
  return rows.map((r) => ({ startMs: r.start_ms, durMs: r.dur_ms, text: r.text }))
}

function clearTranscripts(): void {
  const db = getBereanDb()
  db.transaction(() => {
    db.prepare('DELETE FROM youtube_transcript_segments').run()
    db.prepare('DELETE FROM youtube_transcripts').run()
  })()
}

export interface YoutubeVideoSearchResult {
  videoId: string
  title: string
  channelName: string
  thumbnailUrl: string
  type: string
  published: string
}

/** Full-text search over stored video titles/channel names (already-synced, allowlisted-channel
 *  library only — no live YouTube-wide search). Exported as a plain function, same reuse reason
 *  as searchVerses/getLexiconEntry elsewhere — electron/ipc/aiLookup.ts calls this directly for
 *  "find me a video about X" style questions (Round 11), same as the `youtube:searchVideos` IPC
 *  handler below (which now just calls this), used by FloatingSearch. */
export function searchYoutubeVideos(query: string, limit = 8): YoutubeVideoSearchResult[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const pat = `%${trimmed.toLowerCase()}%`
  // Primary: exact substring match anywhere in title or channel name
  let rows = getBereanDb()
    .prepare(`SELECT video_id, title, channel_name, thumbnail_url, type, published
              FROM youtube_videos
              WHERE LOWER(title) LIKE ? OR LOWER(channel_name) LIKE ?
              ORDER BY published DESC
              LIMIT ?`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all(pat, pat, limit) as any[]
  // Fuzzy fallback: each whitespace-separated token appears anywhere in title/channel.
  // This handles "Moses Torah" finding "Torah of Moses" and minor partial-word queries.
  if (rows.length === 0) {
    const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length > 1) {
      try {
        const conditions = tokens.map(() => '(LOWER(title) LIKE ? OR LOWER(channel_name) LIKE ?)').join(' AND ')
        const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`])
        rows = getBereanDb()
          .prepare(`SELECT video_id, title, channel_name, thumbnail_url, type, published
                    FROM youtube_videos
                    WHERE ${conditions}
                    ORDER BY published DESC
                    LIMIT ${limit}`)
          .all(...params) as any[]
      } catch { /* ignore */ }
    }
  }
  return rows.map((r) => ({
    videoId:     r.video_id   as string,
    title:       r.title      as string,
    channelName: r.channel_name as string,
    thumbnailUrl: r.thumbnail_url as string,
    type:        r.type       as string,
    published:   r.published  as string,
  }))
}

// ─── IPC registration ─────────────────────────────────────────────────────────

export function registerYouTubeHandlers(ipc: typeof ipcMain): void {
  // Load all stored videos from DB (instant, no network)
  ipc.handle('youtube:loadAll', () => loadAll())

  // Refresh: InnerTube + RSS, free, available to all users
  ipc.handle('youtube:refresh', async (event) => refresh(event.sender))

  // Full Sync: YouTube Data API, dev mode + API key required
  ipc.handle('youtube:fullSync', async (event) => {
    if (!is.dev) return { error: 'unavailable in production' }
    if (!YOUTUBE_API_KEY) return { error: 'no API key' }
    return fullSync(event.sender)
  })

  // Clear all stored video data
  ipc.handle('youtube:clearAll', () => {
    clearAll()
    return { success: true }
  })

  ipc.handle('youtube:toggleStar', (_e, videoId: string) => toggleStar(videoId))
  ipc.handle('youtube:savePosition', (_e, videoId: string, seconds: number, meta: { title: string; channelName: string; thumbnailUrl: string }) => {
    savePosition(videoId, seconds, meta)
  })
  ipc.handle('youtube:getPosition', (_e, videoId: string) => getPosition(videoId))
  ipc.handle('youtube:getWatchHistory', () => getWatchHistory())
  ipc.handle('youtube:removeFromHistory', (_e, videoId: string) => { removeFromHistory(videoId) })
  ipc.handle('youtube:clearWatchHistory', () => { clearWatchHistory() })
  ipc.handle('youtube:fetchDescription', async (_e, videoId: string) => fetchDescription(videoId))

  // Transcript fetch: scrapes tactiq.io via hidden BrowserWindows — dev only.
  // Michael runs this during development; production builds read the already-stored data.
  ipc.handle('youtube:fetchTranscripts', async (event, batchSize = 10, workerCount = 3) => {
    if (!is.dev) return { error: 'unavailable in production' }
    return fetchTranscripts(event.sender, Math.max(1, Math.min(10000, batchSize)), Math.max(1, Math.min(16, workerCount)))
  })
  ipc.handle('youtube:clearTranscripts', () => {
    if (!is.dev) return { error: 'unavailable in production' }
    clearTranscripts()
    return { success: true }
  })
  ipc.handle('youtube:getTranscriptStatus', () => {
    return Array.from(getTranscriptStatus())
  })
  ipc.handle('youtube:getTranscript', (_e, videoId: string) => getTranscript(videoId))

  // Full-text transcript search (FTS5). Returns one row per matching video with a
  // representative snippet, its timestamp, and how many segments matched.
  ipc.handle('youtube:searchTranscripts', (_e, query: string, videoLimit = 5, perVideoLimit = 1) => {
    // Tokenize to letters/numbers + prefix-match each token (mirrors buildFtsMatch in
    // src/lib/youtubeSearch.ts, kept in sync; tested there).
    const tokens = (query.trim().toLowerCase().match(/[\p{L}\p{N}]+/gu)) ?? []
    if (tokens.length === 0) return []
    const match = tokens.map((t) => `${t}*`).join(' ')
    let rows: Array<{ videoId: string; snippet: string; startMs: number; title: string; channelName: string; rank: number }>
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
      rows = getBereanDb().prepare(`
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
      `).all(match) as Array<{ videoId: string; snippet: string; startMs: number; title: string; channelName: string; rank: number }>
    } catch {
      rows = [] // malformed FTS expression — fall through to LIKE fallback
    }
    // Fuzzy fallback: if FTS returns nothing, do token-level LIKE matching so minor typos
    // and out-of-order words still find results.
    if (rows.length === 0 && tokens.length > 0) {
      try {
        const conditions = tokens.map(() => 'LOWER(s.text) LIKE ?').join(' AND ')
        const params: string[] = tokens.map((t) => `%${t}%`)
        rows = getBereanDb().prepare(`
          SELECT s.video_id AS videoId, s.text AS snippet, s.start_ms AS startMs,
                 v.title AS title, v.channel_name AS channelName,
                 0 AS rank
          FROM youtube_transcript_segments s
          JOIN youtube_videos v ON v.video_id = s.video_id
          WHERE ${conditions}
          ORDER BY s.start_ms
          LIMIT ${videoLimit * perVideoLimit * 10}
        `).all(...params) as Array<{ videoId: string; snippet: string; startMs: number; title: string; channelName: string; rank: number }>
      } catch { rows = [] }
    }
    // Collect up to `perVideoLimit` best segments per video, then trim to `videoLimit` distinct
    // videos. Callers like the in-tab search box pass a large videoLimit (up to the size of the
    // whole local video list) just to know WHICH videos match, for filtering — not to display
    // all of them at once — so this loop must stay O(rows), not scan/rebuild `results` per row:
    // it previously did a linear results.find()/results.filter() per repeat-video row, which is
    // O(rows * results.length) and was the dominant cost of a broad in-tab search.
    type ResultEntry = { videoId: string; snippet: string; startMs: number; matchCount: number; title: string; channelName: string; rank: number }
    const results: ResultEntry[] = []
    const byVideo = new Map<string, { bestRank: number; count: number; segs: ResultEntry[] }>()
    for (const r of rows) {
      const entry = { videoId: r.videoId, snippet: r.snippet, startMs: r.startMs, matchCount: 1, title: r.title, channelName: r.channelName, rank: r.rank }
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
    const ctxStmt = getBereanDb().prepare(`
      SELECT text FROM youtube_transcript_segments
      WHERE video_id = ? AND start_ms BETWEEN ? AND ?
      ORDER BY start_ms
    `)
    for (const r of results.slice(0, WIDEN_CAP)) {
      try {
        const rows2 = ctxStmt.all(r.videoId, Math.max(0, r.startMs - 12000), r.startMs + 12000) as Array<{ text: string }>
        const joined = rows2.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim()
        if (joined.length > r.snippet.length) r.snippet = joined.slice(0, 400)
      } catch { /* keep single-line snippet */ }
    }
    return results
  })

  // Rebuild youtube_seed.db from the current dev DB — dev only.
  // Run after fetchTranscripts to package updated data for the next app release.
  // After running, bump SEED_VERSION in electron/db/berean.ts before building.
  ipc.handle('youtube:buildSeed', () => {
    if (!is.dev) return { error: 'unavailable in production' }
    try {
      const seedPath = join(app.getAppPath(), 'data', 'youtube_seed.db')
      if (existsSync(seedPath)) unlinkSync(seedPath)

      // Create schema in the new seed DB
      const seed = new Database(seedPath)
      seed.pragma('journal_mode = WAL')
      seed.exec(`
        CREATE TABLE youtube_videos (
          video_id TEXT PRIMARY KEY, title TEXT NOT NULL, published TEXT NOT NULL,
          channel_name TEXT NOT NULL, channel_handle TEXT NOT NULL,
          thumbnail_url TEXT NOT NULL, type TEXT NOT NULL,
          is_live_now INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          is_starred INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE youtube_sync (
          channel_handle TEXT PRIMARY KEY, last_full_sync TEXT, last_refresh TEXT
        );
        CREATE TABLE youtube_transcripts (
          video_id TEXT PRIMARY KEY, lang TEXT NOT NULL DEFAULT 'en',
          source TEXT NOT NULL DEFAULT 'timedtext', fetched_at INTEGER NOT NULL,
          segment_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
          error TEXT
        );
        CREATE TABLE youtube_transcript_segments (
          id INTEGER PRIMARY KEY, video_id TEXT NOT NULL,
          start_ms INTEGER NOT NULL, dur_ms INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL
        );
      `)
      seed.close()

      // Bulk-copy from live DB via ATTACH
      const db = getBereanDb()
      const esc = seedPath.replace(/'/g, "''")
      db.exec(`ATTACH '${esc}' AS newseed`)
      db.transaction(() => {
        db.prepare(`INSERT OR IGNORE INTO newseed.youtube_videos
          SELECT video_id, title, published, channel_name, channel_handle,
                 thumbnail_url, type, is_live_now, fetched_at,
                 duration_seconds, is_starred, description
          FROM youtube_videos`).run()
        db.prepare(`INSERT OR IGNORE INTO newseed.youtube_sync
          SELECT channel_handle, last_full_sync, last_refresh FROM youtube_sync`).run()
        db.prepare(`INSERT OR IGNORE INTO newseed.youtube_transcripts
          SELECT video_id, lang, source, fetched_at, segment_count, duration_ms, error
          FROM youtube_transcripts`).run()
        // Segments: omit the `id` so the seed gets fresh rowids (no FTS triggers in seed)
        db.prepare(`INSERT INTO newseed.youtube_transcript_segments (video_id, start_ms, dur_ms, text)
          SELECT video_id, start_ms, dur_ms, text FROM youtube_transcript_segments`).run()
      })()
      db.exec('DETACH newseed')

      const videoCount = (db.prepare('SELECT COUNT(*) AS n FROM youtube_videos').get() as { n: number }).n
      const transcriptCount = (db.prepare('SELECT COUNT(*) AS n FROM youtube_transcripts').get() as { n: number }).n
      const segmentCount = (db.prepare('SELECT COUNT(*) AS n FROM youtube_transcript_segments').get() as { n: number }).n

      return { success: true, videos: videoCount, transcripts: transcriptCount, segments: segmentCount }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Full-text search over stored video titles/channel names — used by FloatingSearch, and (via
  // the exported searchYoutubeVideos above) by AI Lookup's "find me a video about X" (Round 11).
  ipc.handle('youtube:searchVideos', (_e, query: string, limit = 8) => searchYoutubeVideos(query, limit))
}
