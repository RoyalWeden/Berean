import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner, CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'
import {
  ArrowLeft, RefreshCw, Search, X, ChevronDown,
  ExternalLink, Download, Star, RotateCcw, Maximize2, Minimize2, Paperclip, Link2,
  NotepadText, Clock, ChevronRight, Edit3, Eye, Undo2, Redo2, Plus, LayoutGrid,
  BookOpen, BookMarked, Trash2, Captions, SlidersHorizontal,
} from 'lucide-react'
import NoteEditor from '@/components/notes/pm/NoteEditorPM'
import { IconButton, Button, ControlGroup, OverflowGroup, OverflowSection, SearchField, TextField, SectionLabel, EmptyState, MenuSurface, MenuItem, Toolbar, OptionCard, RefChip, SegmentedControl, Select, ListRow, DisclosureRow, cx } from '@/components/ui'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import YouTubeSecondaryPanel from './YouTubeSecondaryPanel'
import TouchYouTubePlayer from './TouchYouTubePlayer'
import { capabilities } from '@/lib/platformCapabilities'
import TranscriptViewer, { type TranscriptSegment } from './TranscriptViewer'
import { filterVideosBySearch, rankVideosBySearch, highlightSnippet, type SearchScope, type TranscriptMatchInfo } from '@/lib/youtubeSearch'
import type { ParsedRef } from '@/lib/parseRef'
import { getTranslationForBook } from '@/lib/parseRef'
import { useAppStore } from '@/store'
import { YOUTUBE_LAYOUTS, getLayoutStyle, needsPanelWrapper, panelSide, suggestLayout, type LayoutDef } from '@/lib/youtubeLayouts'
import { progressWidth } from '@/lib/progressBar'
import { YOUTUBE_LOADING_TITLE, rememberYouTubeTitles, youtubeTitleFor } from '@/lib/youtubeTitle'
import type { YouTubeLayout, YouTubePanelState, YouTubeTabState } from '@/types'

// Thumbnail 404 fallback chain — see thumbFallback's own comment (below, in the component) for
// why this is needed at all. Ordered by how universally YouTube guarantees each size exists;
// `default.jpg` (120x90, YouTube's oldest/most basic thumbnail size) is the last resort since
// it's generated for essentially every video, unlike the higher-resolution sizes.
const THUMB_FALLBACK_CHAIN = ['mqdefault', 'default']

/** Returns the URL to try at the given fallback `level` (0 = the original URL, unmodified;
 *  1.. = swap in THUMB_FALLBACK_CHAIN[level - 1]), or null once the chain is exhausted. */
function thumbnailUrlAtLevel(originalUrl: string, level: number): string | null {
  if (level === 0) return originalUrl
  const quality = THUMB_FALLBACK_CHAIN[level - 1]
  if (!quality) return null
  return originalUrl.replace(/\/(?:maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg(\?.*)?$/, `/${quality}.jpg$1`)
}

interface VideoNoteLink {
  noteId: string
  noteTitle: string
  timestamp: number   // seconds; 0 = whole-video link (no ?t=)
  label: string       // the markdown link label text
}

function parseVideoNotes(notes: { id: string; title: string; content: string }[], videoId: string): VideoNoteLink[] {
  const results: VideoNoteLink[] = []
  const ytRe = /\[([^\]]+)\]\(https?:\/\/(?:youtu\.be\/([a-zA-Z0-9_-]{11})|(?:www\.)?youtube\.com\/watch\?[^)]*v=([a-zA-Z0-9_-]{11}))([^)]*)\)/g
  for (const note of notes) {
    ytRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ytRe.exec(note.content)) !== null) {
      const vid = m[2] ?? m[3]
      if (vid !== videoId) continue
      const tMatch = m[4]?.match(/[?&]t=(\d+)/)
      results.push({
        noteId: note.id,
        noteTitle: note.title || 'Untitled',
        timestamp: tMatch ? parseInt(tMatch[1], 10) : 0,
        label: m[1],
      })
    }
  }
  // sort: whole-video links first, then by timestamp ascending
  results.sort((a, b) => {
    if ((a.timestamp === 0) !== (b.timestamp === 0)) return a.timestamp === 0 ? -1 : 1
    return a.timestamp - b.timestamp
  })
  return results
}

function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

interface VideoEntry {
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

const PAGE_SIZE = 30

type SortOption = 'relevance' | 'newest' | 'oldest' | 'channel' | 'shortest' | 'longest'
type TypeFilter = 'all' | 'video' | 'short' | 'live'
type DurationFilter = 'any' | 'shorts' | '1to5' | '5to15' | '15to30' | '30to60' | 'over60'
type WatchFilter = 'all' | 'inprogress' | 'unseen'

function timeAgo(isoDate: string, isLiveNow = false): string {
  if (isLiveNow) return 'Live now'
  const ts = new Date(isoDate).getTime()
  if (ts === 0 || ts < 0) return '—'
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function formatDateFull(isoDate: string): string {
  if (!isoDate || isoDate === new Date(0).toISOString()) return ''
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatDuration(s: number): string {
  if (s <= 0) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function sortVideos(videos: VideoEntry[], sort: SortOption): VideoEntry[] {
  const copy = [...videos]
  // 'relevance' is handled by rankVideosBySearch when a query is active; with no query
  // there's nothing to rank against, so fall back to newest-first here.
  if (sort === 'newest' || sort === 'relevance') copy.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
  else if (sort === 'oldest')   copy.sort((a, b) => new Date(a.published).getTime() - new Date(b.published).getTime())
  else if (sort === 'shortest') copy.sort((a, b) => (a.durationSeconds || Infinity) - (b.durationSeconds || Infinity))
  else if (sort === 'longest')  copy.sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0))
  else copy.sort((a, b) => a.channelName.localeCompare(b.channelName) || new Date(b.published).getTime() - new Date(a.published).getTime())
  return copy
}

function buildRecommendations(current: VideoEntry, all: VideoEntry[]): VideoEntry[] {
  const others = all.filter((v) => v.videoId !== current.videoId)
  const channelVids = others
    .filter((v) => v.channelHandle === current.channelHandle)
    .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
    .slice(0, 4)
  const usedIds = new Set([current.videoId, ...channelVids.map((v) => v.videoId)])
  const words = current.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4)
  const similar = others
    .filter((v) => {
      if (usedIds.has(v.videoId)) return false
      return words.some((w) => v.title.toLowerCase().includes(w))
    })
    .sort((a, b) => {
      const sa = words.filter((w) => a.title.toLowerCase().includes(w)).length
      const sb = words.filter((w) => b.title.toLowerCase().includes(w)).length
      return sb - sa
    })
    .slice(0, 4)
  const out: VideoEntry[] = []
  const max = Math.max(channelVids.length, similar.length)
  for (let i = 0; i < max; i++) {
    if (channelVids[i]) out.push(channelVids[i])
    if (similar[i]) out.push(similar[i])
  }
  return out.slice(0, 8)
}

const TYPE_LABEL: Record<TypeFilter, string> = { all: 'All', video: 'Videos', short: 'Shorts', live: 'Lives' }
const SORT_LABEL: Record<SortOption, string> = {
  relevance: 'Best match', newest: 'Newest first', oldest: 'Oldest first',
  channel: 'By channel', shortest: 'Shortest first', longest: 'Longest first',
}
const DURATION_LABEL: Record<DurationFilter, string> = {
  any:     'Any length',
  shorts:  '< 1 min',
  '1to5':  '1–5 min',
  '5to15': '5–15 min',
  '15to30':'15–30 min',
  '30to60':'30–60 min',
  over60:  '> 1 hour',
}
const WATCH_LABEL: Record<WatchFilter, string> = {
  all: 'All', inprogress: 'In progress', unseen: 'Unseen',
}

// ── Panel slot: type-picker when empty, content panel when chosen ───────────
function PanelSlot({
  panel, label, onSet, onClear,
}: {
  panel: YouTubePanelState | null
  label: string
  onSet: (p: YouTubePanelState) => void
  onClear: () => void
}) {
  // No panel chosen yet → show the 3 visual type buttons
  if (!panel) {
    const TYPES: { type: 'notes' | 'scripture' | 'lexicon'; label: string; icon: typeof NotepadText; desc: string }[] = [
      { type: 'notes',     label: 'Notes',     icon: NotepadText,  desc: 'Search & view a note' },
      { type: 'scripture', label: 'Scripture', icon: BookOpen,  desc: 'Open a chapter' },
      { type: 'lexicon',   label: 'Lexicon',   icon: BookMarked, desc: 'Look up a word' },
    ]
    return (
      <div className="flex flex-col h-full overflow-hidden bg-surface-3">
        <Toolbar size="sm">
          <span className="flex-1 text-footnote font-medium text-text-muted">{label}</span>
          <IconButton icon={X} label="Remove panel" size={20} danger onClick={onClear} />
        </Toolbar>
        <div className="flex-1 flex flex-col justify-center gap-2 p-3">
          <p className="text-caption text-text-muted text-center mb-1">Choose what this panel shows</p>
          {TYPES.map(({ type, label: tl, icon: Icon, desc }) => (
            <OptionCard key={type}
              icon={Icon}
              title={tl}
              description={desc}
              onClick={() => { onSet({ type } as YouTubePanelState) }}
              className="w-full flex-row items-center"
            />
          ))}
        </div>
      </div>
    )
  }

  // Panel type chosen → render the self-contained content panel.
  // onBack returns to the type picker (clears content + type).
  return (
    <YouTubeSecondaryPanel
      panel={panel}
      label={label}
      onUpdate={onSet}
      onBack={() => onClear()}
      onClose={onClear}
    />
  )
}

export default function YouTubeTab({ floating = false }: { floating?: boolean }) {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const autoPiP = useAppStore((s) => s.autoPiP)
  // 'throttled' on battery power / under thermal pressure (see store/index.ts,
  // electron/powerAwareness.ts) — stretches the polling intervals below so a video left
  // playing doesn't keep spending CPU on style re-injection / transcript-sync polling at full
  // cadence while the system is already under load (e.g. screen-sharing in a video call).
  const resourceMode = useAppStore((s) => s.resourceMode)
  const pollMultiplier = resourceMode === 'throttled' ? 2 : 1
  const pendingYouTubeVideo = useAppStore((s) => s.pendingYouTubeVideo)
  const clearPendingYouTubeVideo = useAppStore((s) => s.clearPendingYouTubeVideo)
  const renameTab = useAppStore((s) => s.renameTab)
  const ytTabId = useAppStore((s) => s.activeTabId['youtube'])
  const youtubeHomeToken = useAppStore((s) => s.youtubeHomeToken)
  const setYoutubeIsPlaying = useAppStore((s) => s.setYoutubeIsPlaying)
  const youtubeNoteBack = useAppStore((s) => s.youtubeNoteBack)
  const setYoutubeNoteBack = useAppStore((s) => s.setYoutubeNoteBack)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const pendingYouTubeSearch = useAppStore((s) => s.pendingYouTubeSearch)
  const clearYouTubeSearch = useAppStore((s) => s.clearYouTubeSearch)
  // Was `const tabs = useAppStore((s) => s.tabs)` — subscribed to the whole `tabs` record (all
  // 5 spaces, re-rendering this component on any tab-state write anywhere in the app) but the
  // value was never actually read anywhere in this file; every real read below goes through
  // `useAppStore.getState().tabs[...]` snapshots instead. Removed rather than narrowed.

  // ─── YouTube layout state ────────────────────────────────────────────────────
  // Read initial layout from persisted tab state; fallback to 'video-full'
  const [ytLayout, setYtLayout] = useState<YouTubeLayout>(() => {
    const s = useAppStore.getState()
    const tab = s.tabs['youtube'].find((t) => t.id === s.activeTabId['youtube'])
    return (tab?.state as YouTubeTabState | undefined)?.youtubeLayout ?? 'video-full'
  })
  const [panelA, setPanelA] = useState<YouTubePanelState | null>(() => {
    const s = useAppStore.getState()
    const tab = s.tabs['youtube'].find((t) => t.id === s.activeTabId['youtube'])
    return (tab?.state as YouTubeTabState | undefined)?.panelA ?? null
  })
  const [panelB, setPanelB] = useState<YouTubePanelState | null>(() => {
    const s = useAppStore.getState()
    const tab = s.tabs['youtube'].find((t) => t.id === s.activeTabId['youtube'])
    return (tab?.state as YouTubeTabState | undefined)?.panelB ?? null
  })
  const [showLayoutPicker, setShowLayoutPicker] = useState(false)
  const layoutPickerRef = useRef<HTMLDivElement>(null)
  const [videos, setVideos] = useState<VideoEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null)
  const [search, setSearch] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('both')
  const [transcriptMatchIds, setTranscriptMatchIds] = useState<Set<string>>(new Set())
  // Per-video transcript match details (bm25 rank, count, segments) for ranking + display
  // `segments` holds up to 3 matching lines (with their timestamps) for the card list view.
  const [transcriptMatchInfo, setTranscriptMatchInfo] = useState<Map<string, { rank: number; matchCount: number; segments: Array<{ snippet: string; startMs: number }> }>>(new Map())
  const [sort, setSort] = useState<SortOption>('newest')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [channelSearch, setChannelSearch] = useState('')
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('any')
  const [watchFilter, setWatchFilter] = useState<WatchFilter>('all')
  const [starredOnly, setStarredOnly] = useState(false)
  const [page, setPage] = useState(1)
  // Additional filters panel
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  // YouTubeTab is a single shared instance reused across every YouTube tab (PanelLayout.tsx
  // renders one, not one per tab) — same architecture, and the same class of bug just fixed
  // in NotesPanel.tsx/LexiconPanel.tsx this session: activeVideoId was never persisted to
  // tab.state.videoId at all, so switching tabs and back always landed on the browse/home
  // view regardless of what video had been open. skipNextYtPersistRef guards the one stale
  // persist-effect run that happens mid-switch, before the restore effect below catches up —
  // see NotesPanel.tsx's skipNextPersistRef comment for the full explanation.
  const skipNextYtPersistRef = useRef(false)
  // Browse/grid list scroll position — persisted the same way as activeVideoId above (the
  // ActivePanel wrapper keys this component by ytTab.id, so switching between two different
  // YouTube tabs unmounts+remounts it entirely; without this, returning to a tab always
  // snapped the grid back to the top).
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const lastGridScrollTopRef = useRef(0)
  const [gridRestoreScrollTop, setGridRestoreScrollTop] = useState<number | null>(null)
  const ytTabIdRef = useRef(ytTabId)
  ytTabIdRef.current = ytTabId
  // playerSrc is locked in once per video open — never updated by poll — prevents auto-resume bug
  const [playerSrc, setPlayerSrc] = useState<string>('')
  const [videoMaximized, setVideoMaximized] = useState(false)
  // Fallback level reached per video (0/unset = original URL still being tried). Thumbnail
  // URLs are constructed by GUESSING `hqdefault.jpg` exists (electron/ipc/youtube.ts) — true for
  // most normal uploads, but not guaranteed for every video (old uploads, some Shorts, unlisted/
  // live-only videos can lack hqdefault), hence the observed 404s. On error, step down through
  // progressively-more-universal thumbnail sizes before giving up — YouTube guarantees
  // `default.jpg` exists for every video with a thumbnail at all.
  const [thumbFallback, setThumbFallback] = useState<Map<string, number>>(new Map())
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showChannelMenu, setShowChannelMenu] = useState(false)
  const [showDurationMenu, setShowDurationMenu] = useState(false)
  const [showWatchMenu, setShowWatchMenu] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [watchFallback, setWatchFallback] = useState(false)
  // Developer-only tooling (transcript fetch/clear, Full Sync, the transcript-coverage filter, …):
  // a dev build OR the Berean Dev identity (electron/devTools.ts) — never a packaged production
  // build. `devTools` is absent on iOS/web, so fall back to the older `isDev` (dev-build-only;
  // strictly narrower, so the fallback never over-shows anything).
  const [showDevTools, setShowDevTools] = useState(false)
  const [transcriptBatchSize, setTranscriptBatchSize] = useState(10)
  const [transcriptWorkers, setTranscriptWorkers] = useState(3)
  const [fetchingTranscripts, setFetchingTranscripts] = useState(false)
  const [transcriptResult, setTranscriptResult] = useState<{ fetched: number; skipped: number; errors: number } | null>(null)
  const [transcriptIds, setTranscriptIds] = useState<Set<string>>(new Set())
  const [transcriptOnly, setTranscriptOnly] = useState(false)
  const [showTranscriptMenu, setShowTranscriptMenu] = useState(false)
  const transcriptMenuRef = useRef<HTMLDivElement>(null)
  // Trigger-button refs for the three toolbar dropdowns below (Channel/Sort/Transcript tools).
  // The toolbar itself is portaled into ShellHeader's fixed-height, overflow-hidden slot (see
  // TabHeaderPortal) — a plain `position: absolute` menu nested in that portaled content gets
  // clipped by the slot the moment it extends past the 44px header row. These refs let each
  // menu instead be portaled straight to document.body (position: fixed, matching the pattern
  // ShellHeader.tsx's own nav-history dropdown already uses) so it renders above everything,
  // unclipped, positioned from the trigger's live on-screen rect.
  const channelBtnRef = useRef<HTMLButtonElement>(null)
  const sortBtnRef = useRef<HTMLButtonElement>(null)
  const transcriptBtnRef = useRef<HTMLButtonElement>(null)
  const moreFiltersBtnRef = useRef<HTMLButtonElement>(null)
  // Active video's transcript + live playback time for the synced transcript panel
  const [activeTranscript, setActiveTranscript] = useState<TranscriptSegment[]>([])
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [showTranscript, setShowTranscript] = useState(false)
  const timePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [videoDescription, setVideoDescription] = useState('')
  const [historyMap, setHistoryMap] = useState<Record<string, number>>({})
  const [videoEnded, setVideoEnded] = useState(false)
  // Touch player (iPhone) callbacks — stable identities so the embed's message listener is not
  // re-registered on every render. Position saves reuse the desktop rule (within 10 s of the
  // end → 0, so the next open starts fresh).
  const touchPosRef = useRef(0)
  const touchPlayerReady = useCallback(() => setPlayerReady(true), [])
  const touchPlayerBlocked = useCallback(() => { setPlayerReady(true); void import('@/platform/ios/plugins').then((m) => m.BereanWebView.hide()).catch(() => {}) }, [])
  const touchPlayerEnded = useCallback(() => setVideoEnded(true), [])
  const touchPlayerPosition = useCallback((seconds: number) => { touchPosRef.current = seconds }, [])
  useEffect(() => {
    if (!capabilities.nativeVideoPlayer || !activeVideoId) return
    const id = activeVideoId
    const save = () => {
      const pos = touchPosRef.current
      if (!(pos > 0)) return
      const video = videos.find((v) => v.videoId === id)
      const duration = video?.durationSeconds ?? 0
      const effectivePos = duration > 0 && pos >= duration - 10 ? 0 : pos
      historyMapRef.current = { ...historyMapRef.current, [id]: effectivePos }
      window.youtube.savePosition(id, effectivePos, { title: video?.title ?? '', channelName: video?.channelName ?? '', thumbnailUrl: video?.thumbnailUrl ?? '' }).catch(() => {})
    }
    const timer = setInterval(save, 5000)
    document.addEventListener('visibilitychange', save)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', save); save(); touchPosRef.current = 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideoId])
  const [showEndOverlay, setShowEndOverlay] = useState(false)
  const [recommendations, setRecommendations] = useState<VideoEntry[]>([])
  const [isPiPActive, setIsPiPActive] = useState(false)
  const [copyToast, setCopyToast] = useState(false)
  const [videoMenu, setVideoMenu] = useState<{ video: VideoEntry; x: number; y: number } | null>(null)
  useEffect(() => {
    function onClose() { setVideoMenu(null) }
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
  }, [])
  const [videoNotes, setVideoNotes] = useState<VideoNoteLink[]>([])
  const [inlinePanelNoteId, setInlinePanelNoteId] = useState<string | null>(null)
  const [inlinePanelContent, setInlinePanelContent] = useState('')
  const [inlinePanelEditing, setInlinePanelEditing] = useState(false)
  const inlineSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inlinePanelCommandsRef = useRef<{ undo: () => void; redo: () => void } | null>(null)

  const webviewRef = useRef<HTMLElement>(null)
  const hasLoadedRef = useRef(false)
  const positionPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Ref keeps historyMap readable inside effects without causing re-runs
  const historyMapRef = useRef<Record<string, number>>({})
  useEffect(() => { historyMapRef.current = historyMap }, [historyMap])
  // Resume point latched once per video open. Reading historyMapRef on every render would hand
  // the player a new startTime after each 5 s position save and remount it (playback restarted).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const touchStartTime = useMemo(() => (activeVideoId ? historyMapRef.current[activeVideoId] ?? 0 : 0), [activeVideoId])
  // Persists across video changes within the session — skips embed attempt on revisit
  const embedBlockedRef = useRef<Set<string>>(new Set())
  // Always holds the latest saveCurrentPosition so unmount cleanup is never stale
  const saveCurrentPositionRef = useRef<() => Promise<void>>(() => Promise.resolve())
  // Tracks whether the webview video is currently in PiP mode
  const isPiPRef = useRef(false)

  // ─── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => { (window.app.devTools ?? window.app.isDev)?.().then(setShowDevTools).catch(() => {}) }, [])
  useEffect(() => { window.youtube.onProgress?.((p) => setProgress(p)) }, [])

  // Persist embed-blocked set across sessions so we skip the 3s timeout on revisit
  useEffect(() => {
    try {
      const list: string[] = JSON.parse(localStorage.getItem('berean:embedBlocked') ?? '[]')
      list.forEach((id) => embedBlockedRef.current.add(id))
    } catch { /* ignore */ }
  }, [])

  const markEmbedBlocked = useCallback((videoId: string) => {
    embedBlockedRef.current.add(videoId)
    try {
      const list: string[] = JSON.parse(localStorage.getItem('berean:embedBlocked') ?? '[]')
      if (!list.includes(videoId)) {
        list.push(videoId)
        localStorage.setItem('berean:embedBlocked', JSON.stringify(list))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    window.youtube.getWatchHistory().then((history) => {
      const map: Record<string, number> = {}
      for (const h of history) map[h.videoId] = h.positionSeconds
      setHistoryMap(map)
    }).catch(() => {})
  }, [])

  // Sync historyMap when Settings removes entries
  useEffect(() => {
    const handler = () => {
      window.youtube.getWatchHistory().then((history) => {
        const map: Record<string, number> = {}
        for (const h of history) map[h.videoId] = h.positionSeconds
        setHistoryMap(map)
      }).catch(() => {})
    }
    window.addEventListener('berean:watchHistoryChanged', handler)
    return () => window.removeEventListener('berean:watchHistoryChanged', handler)
  }, [])

  // Allow Settings watch-history (and other callers) to jump to a video at an optional timestamp
  useEffect(() => {
    const handler = (e: Event) => {
      const { videoId, startTime = 0 } = (e as CustomEvent<{ videoId: string; startTime?: number }>).detail
      if (startTime > 0) {
        historyMapRef.current = { ...historyMapRef.current, [videoId]: startTime }
        setHistoryMap((prev) => ({ ...prev, [videoId]: startTime }))
      }
      setActiveVideoId(videoId)
    }
    window.addEventListener('berean:openYouTubeVideo', handler)
    return () => window.removeEventListener('berean:openYouTubeVideo', handler)
  }, [])


  // Sync layout+panels+active video from tab state when the active YouTube tab changes.
  // The videoId restore is new — see skipNextYtPersistRef's comment above for why switching
  // tabs previously always landed back on the browse view.
  useEffect(() => {
    if (!ytTabId) return
    skipNextYtPersistRef.current = true
    const tab = useAppStore.getState().tabs['youtube'].find((t) => t.id === ytTabId)
    const state = tab?.state as YouTubeTabState | undefined
    setActiveVideoId(state?.videoId ?? null)
    setGridRestoreScrollTop(state?.scrollTop ?? null)
    if (!state) return
    if (state.youtubeLayout) setYtLayout(state.youtubeLayout)
    setPanelA(state.panelA ?? null)
    setPanelB(state.panelB ?? null)
  }, [ytTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the active video to tab state so switching away and back restores it. Skips
  // exactly one run right after a tab switch — see skipNextYtPersistRef's comment.
  useEffect(() => {
    if (!ytTabId) return
    if (skipNextYtPersistRef.current) { skipNextYtPersistRef.current = false; return }
    useAppStore.getState().updateTabState('youtube', ytTabId, { videoId: activeVideoId })
  }, [activeVideoId, ytTabId])

  // Apply the restored grid scroll position once the video list has finished its initial load
  // (the grid is empty/loading right after mount, so restoring immediately would be a no-op).
  useEffect(() => {
    if (gridRestoreScrollTop == null || loading) return
    const t = setTimeout(() => {
      if (gridScrollRef.current) gridScrollRef.current.scrollTop = gridRestoreScrollTop
      setGridRestoreScrollTop(null)
    }, 50)
    return () => clearTimeout(t)
  }, [gridRestoreScrollTop, loading])

  // Flush the grid's latest scroll position when this instance unmounts (switching away to a
  // different YouTube tab, or out of the space entirely). Reads through a ref kept fresh every
  // render so this always saves against whichever tab was actually showing, regardless of
  // whether ActivePanel's key={ytTab.id} truly remounts this component or not.
  useEffect(() => {
    return () => {
      if (ytTabIdRef.current) {
        useAppStore.getState().updateTabState('youtube', ytTabIdRef.current, { scrollTop: lastGridScrollTopRef.current })
      }
    }
  }, [])

  // Global top bar's back button reached the browse/home position for this tab (see
  // youtubeHomeToken's registration in the store, mirroring notesHomeToken/lexiconHomeToken).
  //
  // Tracks the last SEEN token, not a "have I run before" boolean — see NotesPanel.tsx's
  // identical fix (lastSeenNotesHomeTokenRef) for why a boolean-ref "skip the first call"
  // guard is unsafe under React 18 StrictMode's dev-only double-invoke of a genuine mount's
  // effects.
  const lastSeenYoutubeHomeTokenRef = useRef(youtubeHomeToken)
  useEffect(() => {
    if (youtubeHomeToken === lastSeenYoutubeHomeTokenRef.current) return
    lastSeenYoutubeHomeTokenRef.current = youtubeHomeToken
    handleBack()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeHomeToken])

  // Layout picker close on outside click
  useEffect(() => {
    if (!showLayoutPicker) return
    function onDown(e: MouseEvent) {
      if (layoutPickerRef.current && !layoutPickerRef.current.contains(e.target as Node)) {
        setShowLayoutPicker(false)
      }
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [showLayoutPicker])

  // Close panel A: if panel B exists, promote it to A and collapse to a single-panel layout.
  function closePanelA() {
    if (panelB) {
      // Promote B → A, collapse to single-panel layout
      setPanelA(panelB)
      setPanelB(null)
      setYtLayout(suggestLayout(true, false, 'side-right'))
    } else {
      setPanelA(null)
      setYtLayout('video-full')
    }
  }
  // Close panel B: drop it, collapse to a single-panel layout (panelA stays).
  function closePanelB() {
    setPanelB(null)
    setYtLayout(suggestLayout(!!panelA, false, 'side-right'))
  }

  // Helper to add a panel (A first, B if A is taken, then replace A)
  function addPanel(panel: YouTubePanelState) {
    if (!panelA) {
      setPanelA(panel)
      const next = suggestLayout(true, false, ytLayout)
      setYtLayout(next)
    } else if (!panelB) {
      setPanelB(panel)
      const next = suggestLayout(true, true, ytLayout)
      setYtLayout(next)
    } else {
      // Both panels taken → replace panelA, keep panelB
      setPanelA(panel)
    }
  }

  // Listen for external panel-add events from TabBar drop handler
  useEffect(() => {
    function onAddPanel(e: Event) {
      const detail = (e as CustomEvent<{ tabId: string; panel: YouTubePanelState }>).detail
      if (detail.tabId !== ytTabId) return
      addPanel(detail.panel)
    }
    window.addEventListener('berean:youtubeAddPanel', onAddPanel)
    return () => window.removeEventListener('berean:youtubeAddPanel', onAddPanel)
  }, [ytTabId, panelA, panelB, ytLayout]) // eslint-disable-line react-hooks/exhaustive-deps

  // Store-based video navigation (from note timestamp links — works even when YouTubeTab is not mounted)
  useEffect(() => {
    if (!pendingYouTubeVideo) return
    const { videoId, startTime } = pendingYouTubeVideo
    if (videoId === activeVideoId && playerReady && webviewRef.current) {
      // Video already playing — seek directly instead of reloading the player
      if (startTime > 0) {
        const js = watchFallback
          ? `(()=>{var v=document.querySelector("video");if(v){v.currentTime=${startTime};v.play().catch(function(){});}null;})()`
          : `(()=>{var f=document.querySelector("iframe");if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:"command",func:"seekTo",args:[${startTime},true]}),"*");f.contentWindow.postMessage(JSON.stringify({event:"command",func:"playVideo",args:""}),"*");}null;})()`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(webviewRef.current as any).executeJavaScript(js).catch(() => {})
      }
    } else {
      if (startTime > 0) {
        historyMapRef.current = { ...historyMapRef.current, [videoId]: startTime }
        setHistoryMap((prev) => ({ ...prev, [videoId]: startTime }))
      }
      setActiveVideoId(videoId)
    }
    clearPendingYouTubeVideo()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingYouTubeVideo, clearPendingYouTubeVideo])

  // Share loaded titles with the store/history dropdown, which only ever have a
  // video id to work with (see lib/youtubeTitle.ts).
  useEffect(() => { rememberYouTubeTitles(videos) }, [videos])

  // Rename the YouTube tab to the video title once it's known. When the video
  // isn't in `videos` yet (freshly opened, list still loading) show a loading
  // placeholder rather than leaving the PREVIOUS video's title in place — this
  // effect re-runs on `videos` and corrects it as soon as metadata lands.
  useEffect(() => {
    if (!activeVideoId || !ytTabId) return
    const video = videos.find((v) => v.videoId === activeVideoId)
    renameTab('youtube', ytTabId, video ? video.title : (youtubeTitleFor(activeVideoId) ?? YOUTUBE_LOADING_TITLE))
  }, [activeVideoId, videos, ytTabId, renameTab])

  // ─── Player lifecycle ────────────────────────────────────────────────────────

  // Reset all player state when video changes
  useEffect(() => {
    setPlayerReady(false)
    setVideoEnded(false)
    setVideoDescription('')
    setRecommendations([])
    setVideoMaximized(false)
    setYoutubeIsPlaying(false)
    if (!activeVideoId) {
      setIsPiPActive(false)
      isPiPRef.current = false
    }
    // Skip embed attempt immediately if this video is already known to block embedding
    setWatchFallback(activeVideoId ? embedBlockedRef.current.has(activeVideoId) : false)
    if (positionPollRef.current) clearInterval(positionPollRef.current)
  }, [activeVideoId, setYoutubeIsPlaying])

  // Delay the "Up next" overlay by 400ms so rapid Back navigation never triggers a flash.
  // The timeout is cancelled if videoEnded is cleared before it fires.
  useEffect(() => {
    if (!videoEnded) { setShowEndOverlay(false); return }
    const t = setTimeout(() => setShowEndOverlay(true), 400)
    return () => clearTimeout(t)
  }, [videoEnded])

  // Build playerSrc. Embed mode: data: wrapper HTML we fully control (clean layout, no CSS
  // fighting). Watch fallback: direct YouTube watch URL when embedding is blocked (Error 153).
  useEffect(() => {
    if (!activeVideoId) { setPlayerSrc(''); return }
    const savedPos = Math.floor(historyMapRef.current[activeVideoId] ?? 0)
    if (watchFallback || embedBlockedRef.current.has(activeVideoId)) {
      setPlayerSrc(
        `https://www.youtube.com/watch?v=${activeVideoId}&autoplay=1` +
        (savedPos > 5 ? `&t=${savedPos}` : '')
      )
    } else {
      const embedSrc =
        `https://www.youtube.com/embed/${activeVideoId}` +
        `?autoplay=1&rel=0&modestbranding=1&enablejsapi=1` +
        (savedPos > 5 ? `&start=${savedPos}` : '')
      // Wrapper page intercepts IFrame API messages for position tracking and error detection.
      // onError fires with code 101/150 when embedding is disabled (shows as "Error 153" in UI).
      const html =
        '<!DOCTYPE html><html><head><style>' +
        '*{margin:0;padding:0;box-sizing:border-box}' +
        'html,body{width:100%;height:100%;background:#000;overflow:hidden}' +
        'iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}' +
        '</style></head><body>' +
        `<iframe src="${embedSrc}" allow="autoplay;fullscreen;picture-in-picture;encrypted-media" allowfullscreen></iframe>` +
        '<script>window.__yt={t:0,ended:false,playing:false,error:0};' +
        'window.addEventListener("message",function(e){try{' +
        'var d=typeof e.data==="string"?JSON.parse(e.data):e.data;if(!d)return;' +
        'if(d.event==="onStateChange"){if(d.info===1)window.__yt.playing=true;if(d.info===0)window.__yt.ended=true;}' +
        'if(d.event==="onError")window.__yt.error=d.info||1;' +
        'if(d.event==="infoDelivery"&&d.info&&typeof d.info.currentTime==="number")window.__yt.t=d.info.currentTime;' +
        '}catch(x){}});' +
        '</script></body></html>'
      setPlayerSrc(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    }
  }, [activeVideoId, watchFallback]) // eslint-disable-line react-hooks/exhaustive-deps

  // Readiness poll. Embed mode: watches IFrame API state; on error or 5s timeout → watch
  // fallback. Watch fallback: uses executeJavaScript setProperty('important') — the highest
  // possible CSS priority — to force the player to fill the webview viewport.
  useEffect(() => {
    if (!activeVideoId || !playerSrc) return
    const wv = webviewRef.current
    if (!wv) return

    // ── Fastest signal: Electron fires 'media-started-playing' the instant ─────
    // audio or video begins. This removes the loading overlay immediately without
    // waiting for a poll tick (which can take up to 500ms).
    const onMediaStarted = () => {
      setPlayerReady(true)
    }
    wv.addEventListener('media-started-playing', onMediaStarted)

    // Register play/playing event listeners immediately on dom-ready, before the poll interval
    // fires. This captures the 'play' event even if it fires during the poll's first IPC round-trip.
    const onDomReady = () => {}
    wv.addEventListener('dom-ready', onDomReady)

    const setupPlayMonitor = async () => {
      if (playerSrc.startsWith('data:')) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (wv as any).executeJavaScript(
          '(()=>{if(!window.__bereanPlayMonitor){window.__bereanPlayMonitor=true;' +
          '["play","playing"].forEach(function(e){document.addEventListener(e,function(evt){' +
          'if(evt.target&&evt.target.nodeName==="VIDEO")window.__bereanReady=true;},true);});' +
          'var v=document.querySelector("video");if(v&&!v.paused)window.__bereanReady=true;}null;})()'
        )
      } catch { /* ignore */ }
    }

    // insertCSS injects a persistent stylesheet at dom-ready — before YouTube's own JS runs.
    // This prevents elements from ever flashing visible; CSS class rules apply to future
    // instances of those selectors too, which handles YouTube recreating removed elements.
    const injectCSS = async () => {
      if (playerSrc.startsWith('data:')) return // embed wrapper has no YouTube DOM
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (wv as any).insertCSS(
          'ytd-masthead,#masthead-container,tp-yt-app-drawer,ytd-mini-guide-renderer,' +
          '#guide-inner-content,#secondary,ytd-watch-next-secondary-results-renderer,' +
          '#related,#chat,ytd-live-chat-frame,ytd-watch-metadata,#above-the-fold,' +
          '#description,#info,#info-contents,#structured-description,' +
          'ytd-structured-description-content-renderer,#actions,#action-buttons,' +
          'ytd-merch-shelf-renderer,#clarify-box,#panels,' +
          'ytd-engagement-panel-section-list-renderer,ytd-comments,#comments,' +
          'tp-yt-paper-dialog,ytd-consent-bump-v2-lightbox,ytd-miniplayer,' +
          '.ytp-size-button,.ytp-autonav-toggle-button,' +
          '[aria-label*="Autoplay"],[aria-label*="autoplay"],[title*="Autoplay"],[title*="autoplay"],' +
          '[aria-label*="Theater"],[aria-label*="theater"],[title*="Theater"],[title*="theater"],' +
          '.ytp-endscreen-element,' +
          '.ytp-suggestion-set,.ytp-ce-element,.iv-branding,.ytp-chrome-top-buttons,' +
          '.annotation,.ytp-autonav-endscreen,.ytp-endscreen' +
          '{display:none!important;visibility:hidden!important;pointer-events:none!important;}' +
          /* Force the controls bar and progress bar to span the full viewport width */ +
          '#movie_player .ytp-chrome-bottom{width:100vw!important;left:0!important;right:0!important;box-sizing:border-box!important;}' +
          '#movie_player .ytp-progress-bar-padding,.ytp-timed-markers-progress-bar-padding{width:100%!important;}' +
          '#movie_player .ytp-progress-bar-container,#movie_player .ytp-progress-bar,#movie_player .ytp-progress-list{width:100%!important;left:0!important;right:0!important;}' +
          '#movie_player .ytp-scrubber-container{width:100%!important;}'
        )
      } catch { /* ignore */ }
    }

    let pollInterval: ReturnType<typeof setInterval> | null = null

    const startPoll = () => {
      if (pollInterval) return
      let count = 0
      const tick = async () => {
        count++
        try {
          if (!watchFallback) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const state = await (wv as any).executeJavaScript('(()=>{return window.__yt||null;})()')
            if (state?.error) {
              markEmbedBlocked(activeVideoId)
              if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
              setWatchFallback(true)
            } else if (state?.playing || (typeof state?.t === 'number' && state.t > 0)) {
              // playing flag OR currentTime advancing — either means the video is live.
              if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
              setPlayerReady(true)
            } else if (count >= 6) {
              markEmbedBlocked(activeVideoId)
              if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
              setWatchFallback(true)
            }
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ready = await (wv as any).executeJavaScript(`(()=>{
              // Play-event monitor: set __bereanReady once and keep it — survives buffering pauses.
              // Checked FIRST so an error in style injection cannot prevent it running.
              if(!window.__bereanPlayMonitor){
                window.__bereanPlayMonitor=true;
                ['play','playing'].forEach(function(e){
                  document.addEventListener(e,function(evt){
                    if(evt.target&&evt.target.nodeName==='VIDEO') window.__bereanReady=true;
                  },true);
                });
              }
              // Style injection — wrapped so any error here cannot prevent the readiness return below.
              try{
                var hide=[
                  'ytd-masthead','#masthead-container','tp-yt-app-drawer',
                  'ytd-mini-guide-renderer','#guide-inner-content',
                  '#secondary','ytd-watch-next-secondary-results-renderer','#related',
                  '#chat','ytd-live-chat-frame',
                  'ytd-watch-metadata','#above-the-fold','#description',
                  '#info','#info-contents','#structured-description',
                  'ytd-structured-description-content-renderer',
                  '#actions','#action-buttons',
                  'ytd-merch-shelf-renderer','#clarify-box','#panels',
                  'ytd-engagement-panel-section-list-renderer',
                  'ytd-comments','#comments',
                  'tp-yt-paper-dialog','ytd-consent-bump-v2-lightbox','ytd-miniplayer'
                ];
                hide.forEach(function(s){var el=document.querySelector(s);if(el)el.style.setProperty('display','none','important')});
                document.querySelectorAll('.ytp-endscreen-element,.ytp-suggestion-set,.ytp-ce-element,.iv-branding,.ytp-chrome-top-buttons,.annotation,.ytp-autonav-endscreen,.ytp-endscreen').forEach(function(el){el.style.setProperty('display','none','important')});
                var cancelBtn=document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button');
                if(cancelBtn)cancelBtn.click();
                var rmBtn=function(el){el.style.setProperty('display','none','important');el.style.setProperty('visibility','hidden','important');el.style.setProperty('pointer-events','none','important');try{el.remove();}catch(ex){}};
                var rmBtns=function(){
                  ['.ytp-size-button','.ytp-autonav-toggle-button'].forEach(function(s){try{document.querySelectorAll(s).forEach(rmBtn);}catch(ex){}});
                  document.querySelectorAll('button,div[role="button"]').forEach(function(el){var lbl=(el.getAttribute('aria-label')||el.getAttribute('title')||'').toLowerCase();if(lbl.indexOf('autoplay')>=0||lbl.indexOf('autonav')>=0||lbl.indexOf('theater')>=0||lbl.indexOf('cinema')>=0)rmBtn(el);});
                };
                rmBtns();
                if(!window.__bereanKeyBlocker){
                  window.__bereanKeyBlocker=true;
                  document.addEventListener('keydown',function(e){if((e.key==='t'||e.key==='T')&&!e.ctrlKey&&!e.metaKey)e.stopImmediatePropagation();},true);
                }
                if(!window.__bereanButtonObserver){
                  window.__bereanButtonObserver=true;
                  var bmo=new MutationObserver(function(){rmBtns();});
                  if(document.body) bmo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','title']});
                }
                if(document.body) document.body.style.setProperty('overflow','hidden','important');
                var p=document.getElementById('movie_player');
                if(p){
                  p.style.setProperty('position','fixed','important');
                  p.style.setProperty('top','0','important');
                  p.style.setProperty('left','0','important');
                  p.style.setProperty('right','0','important');
                  p.style.setProperty('bottom','0','important');
                  p.style.setProperty('width','100vw','important');
                  p.style.setProperty('height','100vh','important');
                  p.style.setProperty('margin','0','important');
                  p.style.setProperty('z-index','999999','important');
                  var hp=p.querySelector('.html5-video-player');
                  if(hp){
                    hp.style.setProperty('position','absolute','important');
                    hp.style.setProperty('top','0','important');
                    hp.style.setProperty('left','0','important');
                    hp.style.setProperty('right','0','important');
                    hp.style.setProperty('bottom','0','important');
                    hp.style.setProperty('width','100%','important');
                    hp.style.setProperty('height','100%','important');
                    hp.style.setProperty('margin','0','important');
                  }
                  var vc=p.querySelector('.html5-video-container');
                  if(vc){
                    vc.style.setProperty('position','absolute','important');
                    vc.style.setProperty('top','0','important');
                    vc.style.setProperty('left','0','important');
                    vc.style.setProperty('right','0','important');
                    vc.style.setProperty('bottom','0','important');
                    vc.style.setProperty('width','100%','important');
                    vc.style.setProperty('height','100%','important');
                    vc.style.setProperty('margin','0','important');
                  }
                }
                var v=document.querySelector('video');
                if(v){
                  v.style.setProperty('position','absolute','important');
                  v.style.setProperty('top','0','important');
                  v.style.setProperty('left','0','important');
                  v.style.setProperty('width','100%','important');
                  v.style.setProperty('height','100%','important');
                  v.style.setProperty('object-fit','contain','important');
                  v.style.setProperty('object-position','center center','important');
                }
              // Fix progress bar width — YouTube sets .ytp-chrome-bottom width via JS to the
              // player's layout width, which may be narrower than the viewport. Force full width.
              try{
                var cb=p&&p.querySelector('.ytp-chrome-bottom');
                if(cb){
                  cb.style.setProperty('width','100vw','important');
                  cb.style.setProperty('left','0','important');
                  cb.style.setProperty('right','0','important');
                  cb.style.setProperty('box-sizing','border-box','important');
                }
                ['ytp-progress-bar-padding','ytp-timed-markers-progress-bar-padding','ytp-scrubber-container','ytp-progress-bar-container','ytp-progress-bar','ytp-progress-list'].forEach(function(cls){
                  if(p){p.querySelectorAll('.'+cls).forEach(function(el){el.style.setProperty('width','100%','important');el.style.setProperty('left','0','important');el.style.setProperty('right','0','important');});}
                });
              }catch(barErr){}
              }catch(styleErr){}
              // Readiness: use the persistent flag (survives buffering) or currentTime advancing.
              // Check v.paused as well for the current-tick snapshot.
              var vid=document.querySelector('video');
              if(vid&&(!vid.paused||vid.currentTime>0.5)) window.__bereanReady=true;
              return !!(document.getElementById('movie_player') && window.__bereanReady);
            })()`)
            if (ready || count >= 16) {
              if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
              setPlayerReady(true)
            }
          }
        } catch (e) {
        }
      }
      tick() // run immediately on dom-ready, don't wait for first interval tick
      // 200ms interval (was 500ms) reduces max detection lag from ~500ms to ~200ms
      pollInterval = setInterval(tick, 200)
    }

    wv.addEventListener('dom-ready', setupPlayMonitor)
    wv.addEventListener('dom-ready', injectCSS)
    wv.addEventListener('dom-ready', startPoll)
    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('dom-ready', setupPlayMonitor)
      wv.removeEventListener('dom-ready', injectCSS)
      wv.removeEventListener('dom-ready', startPoll)
      wv.removeEventListener('media-started-playing', onMediaStarted)
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [activeVideoId, playerSrc, watchFallback])

  // Block YouTube's autoplay navigating to a different video than what the user selected
  useEffect(() => {
    if (!activeVideoId || !playerSrc) return
    const wv = webviewRef.current
    if (!wv) return
    const handleWillNavigate = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        const url = new URL(e.url)
        const vid = url.searchParams.get('v')
        if (vid && vid !== activeVideoId) e.preventDefault()
      } catch { /* ignore */ }
    }
    wv.addEventListener('will-navigate', handleWillNavigate)
    return () => wv.removeEventListener('will-navigate', handleWillNavigate)
  }, [activeVideoId, playerSrc])

  // After playerReady on watch URL: keep re-applying chrome removal for 60 s.
  // First tick is immediate so styles are confirmed right at the moment of fade-in.
  useEffect(() => {
    if (!playerReady || !watchFallback || !activeVideoId) return
    // Same guard as the transcript/position pollers below — this tab stays mounted (hidden via
    // CSS, not unmounted) for PiP continuity when the user switches to another space, so without
    // this check the 1s style-injection poll would keep running forever even while the user is
    // reading Scripture elsewhere.
    if (activeSpace !== 'youtube' && !isPiPActive) return
    const wv = webviewRef.current
    if (!wv) return
    let count = 0
    const applyStyles = async () => {
      count++
      if (count > 60) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (wv as any).executeJavaScript(`(()=>{
          var hide=['#secondary','ytd-watch-next-secondary-results-renderer','#related',
            '#chat','ytd-live-chat-frame','ytd-watch-metadata','#above-the-fold',
            '#description','#info','#info-contents','ytd-comments','#comments',
            '#actions','#action-buttons','ytd-merch-shelf-renderer','#panels',
            'ytd-engagement-panel-section-list-renderer'];
          hide.forEach(function(s){var el=document.querySelector(s);if(el)el.style.setProperty('display','none','important')});
          document.querySelectorAll('.ytp-endscreen-element,.ytp-suggestion-set,.ytp-ce-element,.ytp-autonav-endscreen,.ytp-endscreen').forEach(function(el){el.style.setProperty('display','none','important')});
          var cancelBtn=document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button');
          if(cancelBtn)cancelBtn.click();
          var rmBtn=function(el){el.style.setProperty('display','none','important');el.style.setProperty('visibility','hidden','important');el.style.setProperty('pointer-events','none','important');try{el.remove();}catch(ex){}};
          var rmBtns=function(){
            ['.ytp-size-button','.ytp-autonav-toggle-button'].forEach(function(s){try{document.querySelectorAll(s).forEach(rmBtn);}catch(ex){}});
            document.querySelectorAll('button,div[role="button"]').forEach(function(el){var lbl=(el.getAttribute('aria-label')||el.getAttribute('title')||'').toLowerCase();if(lbl.indexOf('autoplay')>=0||lbl.indexOf('autonav')>=0||lbl.indexOf('theater')>=0||lbl.indexOf('cinema')>=0)rmBtn(el);});
          };
          rmBtns();
          if(!window.__bereanKeyBlocker){
            window.__bereanKeyBlocker=true;
            document.addEventListener('keydown',function(e){if((e.key==='t'||e.key==='T')&&!e.ctrlKey&&!e.metaKey)e.stopImmediatePropagation();},true);
          }
          if(!window.__bereanButtonObserver){
            window.__bereanButtonObserver=true;
            var bmo=new MutationObserver(function(){rmBtns();});
            bmo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','title']});
          }
          document.body.style.setProperty('overflow','hidden','important');
          var p=document.getElementById('movie_player');
          if(p){
            p.style.setProperty('position','fixed','important');
            p.style.setProperty('top','0','important');
            p.style.setProperty('left','0','important');
            p.style.setProperty('right','0','important');
            p.style.setProperty('bottom','0','important');
            p.style.setProperty('width','100vw','important');
            p.style.setProperty('height','100vh','important');
            p.style.setProperty('margin','0','important');
            p.style.setProperty('z-index','999999','important');
            var hp=p.querySelector('.html5-video-player');
            if(hp){
              hp.style.setProperty('position','absolute','important');
              hp.style.setProperty('top','0','important');
              hp.style.setProperty('left','0','important');
              hp.style.setProperty('right','0','important');
              hp.style.setProperty('bottom','0','important');
              hp.style.setProperty('width','100%','important');
              hp.style.setProperty('height','100%','important');
              hp.style.setProperty('margin','0','important');
            }
            var vc=p.querySelector('.html5-video-container');
            if(vc){
              vc.style.setProperty('position','absolute','important');
              vc.style.setProperty('top','0','important');
              vc.style.setProperty('left','0','important');
              vc.style.setProperty('right','0','important');
              vc.style.setProperty('bottom','0','important');
              vc.style.setProperty('width','100%','important');
              vc.style.setProperty('height','100%','important');
              vc.style.setProperty('margin','0','important');
            }
          }
          var v=document.querySelector('video');
          if(v){
            v.style.setProperty('position','absolute','important');
            v.style.setProperty('top','0','important');
            v.style.setProperty('left','0','important');
            v.style.setProperty('width','100%','important');
            v.style.setProperty('height','100%','important');
            v.style.setProperty('object-fit','contain','important');
            v.style.setProperty('object-position','center center','important');
          }
          // Block YouTube's SPA navigation (pushState) to other videos — will-navigate only fires
          // for full navigations, not in-page pushState which is how autoplay actually works.
          var _navId='${activeVideoId}';
          if(window.__bereanNavId!==_navId){
            window.__bereanNavId=_navId;
            var _origPush=history.pushState.bind(history);
            history.pushState=function(s,t,url){
              if(url){try{var u=new URL(String(url),location.href);var vid=u.searchParams.get('v');if(vid&&vid!==_navId)return;}catch(ex){}}
              return _origPush(s,t,url);
            };
          }
          null;
        })()`)
      } catch { /* ignore */ }
    }
    applyStyles() // immediate first run at fade-in moment
    const interval = setInterval(applyStyles, 1000 * pollMultiplier)
    return () => clearInterval(interval)
  }, [playerReady, watchFallback, activeVideoId, activeSpace, isPiPActive, pollMultiplier])

  // Pause immediately when the video ends; reset saved position to 0 so next open starts fresh
  useEffect(() => {
    if (!videoEnded || !webviewRef.current || !activeVideoId) return
    const wv = webviewRef.current
    const js = watchFallback
      ? '(()=>{var v=document.querySelector("video");if(v)v.pause();null;})()'
      : '(()=>{var f=document.querySelector("iframe");if(f&&f.contentWindow)f.contentWindow.postMessage(JSON.stringify({event:"command",func:"pauseVideo",args:""}), "*");null;})()'
    ;(wv as any).executeJavaScript(js).catch(() => {})
    const video = videos.find((v) => v.videoId === activeVideoId)
    setHistoryMap((prev) => ({ ...prev, [activeVideoId]: 0 }))
    window.youtube.savePosition(activeVideoId, 0, {
      title: video?.title ?? '', channelName: video?.channelName ?? '', thumbnailUrl: video?.thumbnailUrl ?? '',
    }).catch(() => {})
  }, [videoEnded, watchFallback, activeVideoId, videos])

  // Auto-PiP: enter PiP when the user navigates away from the YouTube space while a video plays;
  // exit PiP when they return. userGesture:true is required — PiP API rejects without activation.
  useEffect(() => {
    if (!playerReady || !activeVideoId || !webviewRef.current) return
    const wv = webviewRef.current as any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (activeSpace !== 'youtube') {
      if (!autoPiP) return
      wv.executeJavaScript(
        '(()=>{var v=document.querySelector("video");if(v&&!v.paused){return v.requestPictureInPicture().then(function(){return true;}).catch(function(){return false;});}return false;})()',
        true
      ).then((started: boolean) => { if (started) { isPiPRef.current = true; setIsPiPActive(true); useAppStore.getState().bumpYoutubePipToken() } }).catch(() => {})
    } else if (isPiPRef.current) {
      wv.executeJavaScript(
        '(()=>{if(document.pictureInPictureElement)document.exitPictureInPicture().catch(function(){});null;})()',
        true
      ).then(() => { isPiPRef.current = false; setIsPiPActive(false) }).catch(() => {})
    }
  }, [activeSpace, playerReady, activeVideoId, autoPiP])

  // Cmd+Shift+P: manual PiP toggle (userGesture:true required for PiP API)
  useEffect(() => {
    function handler() {
      if (!webviewRef.current || !playerReady) return
      const wv = webviewRef.current as any // eslint-disable-line @typescript-eslint/no-explicit-any
      if (isPiPRef.current) {
        wv.executeJavaScript(
          '(()=>{if(document.pictureInPictureElement)document.exitPictureInPicture().catch(function(){});null;})()',
          true
        ).then(() => { isPiPRef.current = false; setIsPiPActive(false) }).catch(() => {})
      } else {
        wv.executeJavaScript(
          '(()=>{var v=document.querySelector("video");if(v)v.requestPictureInPicture().catch(function(){});null;})()',
          true
        ).then(() => { isPiPRef.current = true; setIsPiPActive(true); useAppStore.getState().bumpYoutubePipToken() }).catch(() => {})
      }
    }
    window.addEventListener('berean:togglePiP', handler)
    return () => window.removeEventListener('berean:togglePiP', handler)
  }, [playerReady])

  // Detect when the user clicks the native macOS PiP "Return Inline" button — poll for pip exit
  useEffect(() => {
    if (!isPiPActive || !playerReady) return
    const interval = setInterval(async () => {
      if (!webviewRef.current) return
      try {
        const inPiP = await (webviewRef.current as any).executeJavaScript( // eslint-disable-line @typescript-eslint/no-explicit-any
          '(()=>{return !!document.pictureInPictureElement;})()'
        )
        if (!inPiP) {
          isPiPRef.current = false
          setIsPiPActive(false)
          setActiveSpace('youtube')
        }
      } catch { /* ignore */ }
    }, 500)
    return () => clearInterval(interval)
  }, [isPiPActive, playerReady, setActiveSpace])

  // Save current playback position — used on back, tab close, and unmount.
  // Reads {pos, ended} from the DOM directly so it catches the ended state even when the
  // React videoEnded flag hasn't updated yet (one render behind). Also applies a near-end
  // buffer: if the video was watched within the last 10 s, save 0 (start fresh next open).
  const saveCurrentPosition = useCallback(async () => {
    if (!activeVideoId || !playerReady || !webviewRef.current) return
    if (videoEnded) return
    try {
      const video = videos.find((v) => v.videoId === activeVideoId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (webviewRef.current as any).executeJavaScript(
        watchFallback
          ? '(()=>{const v=document.querySelector("video");return v?{pos:v.currentTime,ended:v.ended}:{pos:0,ended:false};})()'
          : '(()=>{const yt=window.__yt;return yt?{pos:yt.t,ended:yt.ended}:{pos:0,ended:false};})()'
      )
      if (!result || result.ended) return
      const pos: number = result.pos ?? 0
      if (typeof pos === 'number' && pos > 0) {
        const duration = video?.durationSeconds ?? 0
        // Treat "within 10 s of end" as completed — next open starts from the beginning.
        const effectivePos = duration > 0 && pos >= duration - 10 ? 0 : pos
        setHistoryMap((prev) => ({ ...prev, [activeVideoId]: effectivePos }))
        window.youtube.savePosition(activeVideoId, effectivePos, {
          title: video?.title ?? '', channelName: video?.channelName ?? '', thumbnailUrl: video?.thumbnailUrl ?? '',
        }).catch(() => {})
      }
    } catch { /* ignore */ }
  }, [activeVideoId, playerReady, videos, watchFallback, videoEnded])

  // Keep ref fresh so the unmount cleanup always calls the latest version (with correct videoEnded)
  useEffect(() => { saveCurrentPositionRef.current = saveCurrentPosition }, [saveCurrentPosition])

  // Save position before any tab switch or close (Cmd+W dispatches this event too)
  useEffect(() => {
    const handler = () => { saveCurrentPositionRef.current() }
    window.addEventListener('berean:saveScrollBeforeTabChange', handler)
    return () => window.removeEventListener('berean:saveScrollBeforeTabChange', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Save position when this component unmounts (tab switch / navigation away).
  // Uses the ref so the cleanup always runs the latest saveCurrentPosition — never a stale closure.
  useEffect(() => {
    return () => { saveCurrentPositionRef.current() }
  }, [activeVideoId])

  // Record open in history immediately when video is opened
  useEffect(() => {
    if (!activeVideoId) return
    const video = videos.find((v) => v.videoId === activeVideoId)
    if (!video) return
    const pos = historyMapRef.current[activeVideoId] ?? 0
    window.youtube.savePosition(activeVideoId, pos, {
      title: video.title, channelName: video.channelName, thumbnailUrl: video.thumbnailUrl,
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideoId])

  // Load notes that contain links to the current video
  useEffect(() => {
    setVideoNotes([])
    setInlinePanelNoteId(null)
    if (!activeVideoId) return
    window.notes.getNotes(100000, 0).then((notes) => {
      setVideoNotes(parseVideoNotes(notes, activeVideoId))
    }).catch(() => {})
  }, [activeVideoId])

  // Load the downloaded transcript for the active video
  useEffect(() => {
    setActiveTranscript([])
    setCurrentTimeMs(0)
    if (!activeVideoId) return
    window.youtube.getTranscript?.(activeVideoId)
      .then((segs) => setActiveTranscript(segs ?? []))
      .catch(() => setActiveTranscript([]))
  }, [activeVideoId])

  // Poll live playback time (~400ms) while a transcript is loaded, to drive the synced
  // highlight. Reads window.__yt.t (embed wrapper) or video.currentTime (watch fallback).
  // Only while the transcript UI is actually visible (activeSpace) or the video is in PiP —
  // this panel stays mounted (and the webview keeps running) even after switching to Bible/
  // Notes/Lexicon, so without this gate the poll kept firing into the hidden webview forever
  // as long as a transcript was loaded, regardless of whether anyone could see the highlight.
  useEffect(() => {
    if (timePollRef.current) { clearInterval(timePollRef.current); timePollRef.current = null }
    if (!activeVideoId || !playerReady || activeTranscript.length === 0) return
    if (activeSpace !== 'youtube' && !isPiPActive) return
    const wv = webviewRef.current
    if (!wv) return
    timePollRef.current = setInterval(async () => {
      try {
        const t = await (wv as any).executeJavaScript( // eslint-disable-line @typescript-eslint/no-explicit-any
          watchFallback
            ? '(()=>{const v=document.querySelector("video");return v?v.currentTime:0;})()'
            : '(()=>{return (window.__yt&&window.__yt.t)||0;})()'
        )
        if (typeof t === 'number') setCurrentTimeMs(Math.round(t * 1000))
      } catch { /* ignore */ }
    }, 400 * pollMultiplier)
    return () => { if (timePollRef.current) { clearInterval(timePollRef.current); timePollRef.current = null } }
  }, [activeVideoId, playerReady, watchFallback, activeTranscript.length, activeSpace, isPiPActive, pollMultiplier])

  // Seek the player to a given time (seconds) and resume playback.
  const seekTo = useCallback((seconds: number) => {
    const wv = webviewRef.current
    if (!wv) return
    const js = watchFallback
      ? `(()=>{var v=document.querySelector("video");if(v){v.currentTime=${seconds};v.play().catch(function(){});}null;})()`
      : `(()=>{var f=document.querySelector("iframe");if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:"command",func:"seekTo",args:[${seconds},true]}),"*");f.contentWindow.postMessage(JSON.stringify({event:"command",func:"playVideo",args:""}),"*");}null;})()`
    ;(wv as any).executeJavaScript(js).catch(() => {}) // eslint-disable-line @typescript-eslint/no-explicit-any
    setCurrentTimeMs(Math.round(seconds * 1000))
  }, [watchFallback])

  // Load inline panel note content when a note is selected
  useEffect(() => {
    setInlinePanelEditing(false)
    if (!inlinePanelNoteId) { setInlinePanelContent(''); return }
    window.notes.getNote(inlinePanelNoteId).then((n) => setInlinePanelContent(n?.content ?? '')).catch(() => {})
  }, [inlinePanelNoteId])

  // Fetch description when opening a video
  useEffect(() => {
    if (!activeVideoId) return
    const video = videos.find((v) => v.videoId === activeVideoId)
    if (video?.description) { setVideoDescription(video.description); return }
    window.youtube.fetchDescription(activeVideoId).then((desc) => {
      setVideoDescription(desc)
      if (desc) setVideos((prev) => prev.map((v) => v.videoId === activeVideoId ? { ...v, description: desc } : v))
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideoId])

  // Poll every 2s: save playback position + detect video end.
  // videoEnded stays in the dep array so the effect re-runs on every flip.
  // When videoEnded=true the poll keeps running at reduced duty: it only watches for the user
  // scrubbing back manually (pos < duration-2) so it can clear videoEnded and restart normal
  // detection for the second play-through — without requiring the "Watch again" button.
  useEffect(() => {
    if (!activeVideoId || !playerReady) return
    // Same reasoning as the transcript-time poll above — only keep polling while the video is
    // actually visible (active space) or tracked via PiP; auto-PiP already engages whenever a
    // playing video is backgrounded (see the berean:togglePiP effect), so a video that's
    // neither visible nor in PiP is paused/idle and doesn't need position tracked every 2s —
    // the explicit saveCurrentPosition callback (on back/close/unmount) still covers that case.
    if (activeSpace !== 'youtube' && !isPiPActive) return
    const video = videos.find((v) => v.videoId === activeVideoId)
    // Watch fallback: pull paused + duration so we can detect near-end-while-paused
    const js = watchFallback
      ? '(()=>{const v=document.querySelector("video");return v?{t:v.currentTime,d:isFinite(v.duration)?v.duration:0,ended:v.ended,paused:v.paused}:null;})()'
      : '(()=>{return window.__yt||null;})()'
    positionPollRef.current = setInterval(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (webviewRef.current as any)?.executeJavaScript(js)
        if (!result) return
        const pos: number = result.t ?? 0
        const ended: boolean = result.ended ?? false
        const paused: boolean = result.paused ?? false
        const rawDur: number = result.d ?? 0
        const duration = rawDur > 0 ? rawDur : (video?.durationSeconds ?? 0)

        if (videoEnded) {
          // User scrubbed back in the player without clicking "Watch again" — restart the cycle
          if (pos > 0 && duration > 0 && pos < duration - 2) setVideoEnded(false)
          return
        }

        setYoutubeIsPlaying(!paused)

        if (pos > 0) {
          setHistoryMap((prev) => ({ ...prev, [activeVideoId]: pos }))
          window.youtube.savePosition(activeVideoId, pos, {
            title: video?.title ?? '', channelName: video?.channelName ?? '', thumbnailUrl: video?.thumbnailUrl ?? '',
          }).catch(() => {})
        }
        // ended flag OR near-end while paused (user let video reach the last 1.5 s and it stalled)
        const nearEnd = duration > 0 && pos >= duration - 1.5
        if ((ended || (nearEnd && paused)) && video) {
          clearInterval(positionPollRef.current!)
          setYoutubeIsPlaying(false)
          setRecommendations(buildRecommendations(video, videos))
          setVideoEnded(true)
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => { if (positionPollRef.current) clearInterval(positionPollRef.current) }
  }, [activeVideoId, playerReady, videos, watchFallback, videoEnded, setYoutubeIsPlaying, activeSpace, isPiPActive])


  // ─── Data loading ────────────────────────────────────────────────────────────

  const refreshTranscriptIds = useCallback(async () => {
    const ids = await window.youtube.getTranscriptStatus?.().catch(() => [] as string[]) ?? []
    setTranscriptIds(new Set(ids))
  }, [])

  // Auto-pick the most useful sort: 'Best match' (relevance) while searching, back to
  // 'Newest' when the query is cleared. The user can still override via the Sort menu.
  const prevSearchActive = useRef(false)
  useEffect(() => {
    const active = search.trim().length > 0
    if (active && !prevSearchActive.current) setSort('relevance')
    else if (!active && prevSearchActive.current && sort === 'relevance') setSort('newest')
    prevSearchActive.current = active
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up a query pushed in from the floating search bar's "YouTube" button —
  // feed it into the tab's own search box (which drives title + transcript search,
  // filtering, and ranking). Reset to the video list so results are visible.
  useEffect(() => {
    if (!pendingYouTubeSearch) return
    const term = pendingYouTubeSearch
    clearYouTubeSearch()
    setActiveVideoId(null)
    setSearch(term)
    setPage(1)
  }, [pendingYouTubeSearch, clearYouTubeSearch])

  // Debounced transcript FTS search: when the scope includes transcripts, resolve the set
  // of videoIds whose transcript matches the current query (used by filterVideosBySearch).
  useEffect(() => {
    const q = search.trim()
    if (!q || searchScope === 'title') { setTranscriptMatchIds(new Set()); setTranscriptMatchInfo(new Map()); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        // Request up to 3 matching segments per video so the card can show them all
        const matches = await window.youtube.searchTranscripts?.(q, 1000, 3) ?? []
        if (cancelled) return
        setTranscriptMatchIds(new Set(matches.map((m) => m.videoId)))
        // Group multiple segments per video — first entry's rank + matchCount represents the video
        const infoMap = new Map<string, { rank: number; matchCount: number; segments: Array<{ snippet: string; startMs: number }> }>()
        for (const m of matches) {
          const ex = infoMap.get(m.videoId)
          if (!ex) {
            infoMap.set(m.videoId, { rank: m.rank, matchCount: m.matchCount, segments: [{ snippet: m.snippet, startMs: m.startMs }] })
          } else {
            ex.matchCount = m.matchCount // keep latest (most accurate) count
            ex.segments.push({ snippet: m.snippet, startMs: m.startMs })
          }
        }
        setTranscriptMatchInfo(infoMap)
      } catch {
        if (!cancelled) { setTranscriptMatchIds(new Set()); setTranscriptMatchInfo(new Map()) }
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, searchScope])

  const loadFromDb = useCallback(async () => {
    setLoading(true)
    try {
      const [entries] = await Promise.all([window.youtube.loadAll(), refreshTranscriptIds()])
      setVideos(entries)
      if (entries.length === 0) await doRefresh()
    } finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hasLoadedRef.current) { hasLoadedRef.current = true; loadFromDb() }
  }, [loadFromDb])
  // Stars / resume positions changed on another device: re-read the list (no refresh from YouTube).
  const youtubeEpoch = useAppStore((s) => s.dataEpochs.youtube)
  useEffect(() => {
    if (!youtubeEpoch) return
    void window.youtube.loadAll().then(setVideos).catch(() => {})
  }, [youtubeEpoch])

  const doRefresh = useCallback(async () => {
    setLoading(true)
    setProgress({ done: 0, total: 0, phase: 'Refreshing…' })
    try {
      await window.youtube.refresh()
      const entries = await window.youtube.loadAll()
      setVideos(entries)
      setPage(1)
    } finally { setLoading(false); setProgress(null) }
  }, [])

  const doFullSync = useCallback(async () => {
    setSyncing(true)
    setProgress({ done: 0, total: 0, phase: 'Starting full sync…' })
    try {
      await window.youtube.fullSync()
      const [entries, history] = await Promise.all([window.youtube.loadAll(), window.youtube.getWatchHistory()])
      setVideos(entries)
      setPage(1)
      const map: Record<string, number> = {}
      for (const h of history) map[h.videoId] = h.positionSeconds
      setHistoryMap(map)
    } finally { setSyncing(false); setProgress(null) }
  }, [])

  const doFetchTranscripts = useCallback(async () => {
    setFetchingTranscripts(true)
    setTranscriptResult(null)
    setProgress({ done: 0, total: 0, phase: 'Starting transcript fetch…' })
    try {
      const result = await window.youtube.fetchTranscripts(transcriptBatchSize, transcriptWorkers)
      if ('error' in result) { console.error('fetchTranscripts:', result.error); return }
      setTranscriptResult(result)
      await refreshTranscriptIds()
    } finally { setFetchingTranscripts(false); setProgress(null) }
  }, [transcriptBatchSize, refreshTranscriptIds])

  const doClearTranscripts = useCallback(async () => {
    await window.youtube.clearTranscripts()
    setTranscriptResult(null)
    setTranscriptIds(new Set())
  }, [])

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleBack = useCallback(async () => {
    if (positionPollRef.current) clearInterval(positionPollRef.current)
    await saveCurrentPosition()
    setYoutubeIsPlaying(false)
    setActiveVideoId(null)
  }, [saveCurrentPosition, setYoutubeIsPlaying])

  const handleBackAndFilter = useCallback(async (channelHandle: string) => {
    await handleBack()
    setChannelFilter(channelHandle)
    setPage(1)
  }, [handleBack])

  const handleToggleStar = useCallback(async (videoId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const result = await window.youtube.toggleStar(videoId)
    setVideos((prev) => prev.map((v) => v.videoId === videoId ? { ...v, isStarred: result.isStarred } : v))
  }, [])

  // Build a markdown timestamp or plain link and either copy to clipboard (when on YouTube tab)
  // or dispatch to the focused NoteEditor (when in PiP / other space).
  const insertTimestamp = useCallback(async (mode: 'timestamp' | 'link' = 'timestamp') => {
    if (!activeVideoId) return
    try {
      let secs = 0
      if (mode === 'timestamp' && capabilities.nativeVideoPlayer) {
        secs = Math.floor(touchPosRef.current) // native player position (TouchYouTubePlayer)
      } else if (mode === 'timestamp' && webviewRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawPos = await (webviewRef.current as any).executeJavaScript(
          watchFallback
            ? '(()=>{var v=document.querySelector("video");return v?v.currentTime:0;})()'
            : '(()=>{return window.__yt?window.__yt.t:0;})()'
        )
        secs = Math.floor(rawPos ?? 0)
      }
      const video = videos.find((v) => v.videoId === activeVideoId)
      let text: string
      if (mode === 'timestamp') {
        const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
        const timeStr = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
        const label = video ? `${video.channelName} — ${video.title} — ${timeStr}` : timeStr
        text = `[${label}](https://youtu.be/${activeVideoId}?t=${secs})`
      } else {
        const label = video ? `${video.channelName} — ${video.title}` : activeVideoId
        text = `[${label}](https://youtu.be/${activeVideoId})`
      }
      if (activeSpace === 'youtube') {
        await navigator.clipboard.writeText(text)
        setCopyToast(true)
        setTimeout(() => setCopyToast(false), 2000)
      } else {
        window.dispatchEvent(new CustomEvent('berean:insertTimestamp', { detail: { text } }))
      }
    } catch { /* ignore */ }
  }, [activeVideoId, watchFallback, videos, activeSpace])

  // Cmd+Shift+L fires berean:requestTimestamp from App.tsx
  useEffect(() => {
    function handler() { insertTimestamp() }
    window.addEventListener('berean:requestTimestamp', handler)
    return () => window.removeEventListener('berean:requestTimestamp', handler)
  }, [insertTimestamp])

  async function createVideoNote() {
    if (!activeVideoId) return
    const video = videos.find(v => v.videoId === activeVideoId)
    const label = video ? `${video.channelName} — ${video.title}` : activeVideoId
    const link = `[${label}](https://youtu.be/${activeVideoId})`
    const initialContent = `${link}\n\n`
    const title = video ? video.title.slice(0, 60) : 'Video Note'
    const result = await window.notes.createNote({ title, content: initialContent, type: 'youtube' })
    if (result.success && result.note) {
      setInlinePanelNoteId(result.note.id)
      setInlinePanelContent(initialContent)
      setInlinePanelEditing(true)
      // Refresh video notes list so the new note appears immediately
      window.notes.getNotes(100000, 0).then((notes) => {
        setVideoNotes(parseVideoNotes(notes, activeVideoId))
      }).catch(() => {})
    }
  }

  function handleInlinePanelContentChange(newContent: string) {
    setInlinePanelContent(newContent)
    if (!inlinePanelNoteId) return
    if (inlineSaveTimer.current) clearTimeout(inlineSaveTimer.current)
    inlineSaveTimer.current = setTimeout(() => {
      window.notes.updateNote(inlinePanelNoteId, { content: newContent }).catch(() => {})
    }, 600)
  }

  function handleInlineVerseRefClick(ref: ParsedRef) {
    const store = useAppStore.getState()
    store.ensureTab('bible')
    const fresh = useAppStore.getState()
    const scriptureTabId = fresh.activeTabId['scripture']
    if (!scriptureTabId) return
    const translationOverride = getTranslationForBook(ref.bookId)
    fresh.updateTabState('scripture', scriptureTabId, {
      bookId: ref.bookId,
      chapter: ref.chapter,
      targetVerse: ref.verse,
      scrollPosition: 0,
      ...(translationOverride ? { translation: translationOverride.toUpperCase() } : {}),
    })
  }

  function handleInlineWikilinkClick(title: string) {
    window.notes.getNotes(100000, 0).then((notes) => {
      const note = notes.find((n) => (n.title || 'Untitled').toLowerCase() === title.toLowerCase())
      if (note) {
        useAppStore.getState().ensureTab('note')
        useAppStore.getState().requestOpenNote(note.id)
      }
    }).catch(() => {})
  }

  function handleInlineLexiconRefClick(strongsId: string) {
    const store = useAppStore.getState()
    const fromNote = inlinePanelNoteId
      ? { noteId: inlinePanelNoteId, title: videoNotes.find((n) => n.noteId === inlinePanelNoteId)?.noteTitle ?? '' }
      : undefined
    // ensureTab first — openLexiconEntry's pending value is picked up by
    // whichever Lexicon tab is active at that moment.
    store.ensureTab('lexicon')
    store.openLexiconEntry(strongsId, fromNote)
  }

  // ─── Filtering + sorting ─────────────────────────────────────────────────────

  const channelNames = useMemo(
    () => Array.from(new Set(videos.map((v) => v.channelHandle))).sort(),
    [videos]
  )

  const filtered = useMemo(() => {
    // First apply the non-text filters (type, channel, duration, starred, watch, transcript-only).
    const base = videos.filter((v) => {
      const matchesType    = typeFilter === 'all' || v.type === typeFilter
      const matchesChannel = channelFilter === 'all' || v.channelHandle === channelFilter
      const matchesStarred = !starredOnly || v.isStarred
      const pos = historyMap[v.videoId] ?? 0
      const matchesWatch   =
        watchFilter === 'all' ||
        (watchFilter === 'inprogress' && pos > 0) ||
        (watchFilter === 'unseen'     && pos === 0)
      const d = v.durationSeconds
      const matchesDuration =
        durationFilter === 'any'     ||
        (durationFilter === 'shorts'  && d > 0    && d <= 60)   ||
        (durationFilter === '1to5'    && d > 60   && d <= 300)  ||
        (durationFilter === '5to15'   && d > 300  && d <= 900)  ||
        (durationFilter === '15to30'  && d > 900  && d <= 1800) ||
        (durationFilter === '30to60'  && d > 1800 && d <= 3600) ||
        (durationFilter === 'over60'  && d > 3600)
      const matchesTranscriptOnly = !transcriptOnly || transcriptIds.has(v.videoId)
      return matchesType && matchesChannel && matchesDuration && matchesStarred && matchesWatch && matchesTranscriptOnly
    })
    // Then apply the text search with the chosen scope (title / transcript / both).
    return filterVideosBySearch(base, search, searchScope, transcriptMatchIds)
  }, [videos, typeFilter, channelFilter, starredOnly, watchFilter, search, searchScope, transcriptMatchIds, durationFilter, historyMap, transcriptOnly, transcriptIds])

  // 'relevance' sort + an active query → rank by title + transcript bm25. Any other sort
  // (or no query) uses the plain field sort, so the user can override relevance while searching.
  const sorted = useMemo(() => {
    if (search.trim() && sort === 'relevance') {
      const info: Map<string, TranscriptMatchInfo> = new Map(
        Array.from(transcriptMatchInfo.entries()).map(([id, m]) => [id, { rank: m.rank, matchCount: m.matchCount }])
      )
      return rankVideosBySearch(filtered, search, searchScope, info)
    }
    return sortVideos(filtered, sort)
  }, [filtered, sort, search, searchScope, transcriptMatchInfo])
  const paged  = sorted.slice(0, page * PAGE_SIZE)
  const hasMore = paged.length < sorted.length

  const closeMenus = useCallback(() => {
    setShowSortMenu(false); setShowChannelMenu(false)
    setShowDurationMenu(false); setShowWatchMenu(false)
    setShowTranscriptMenu(false); setShowMoreFilters(false)
    setChannelSearch('')
  }, [])

  // ─── Player view ─────────────────────────────────────────────────────────────

  if (activeVideoId) {
    const activeVideo = videos.find((v) => v.videoId === activeVideoId)

    // Floating tabs never show secondary panels — force full-width video.
    const effectiveLayout: YouTubeLayout = floating ? 'video-full' : ytLayout
    const layoutStyle = getLayoutStyle(effectiveLayout)
    const stackedPanels = needsPanelWrapper(effectiveLayout)
    const panelWrapperSide = panelSide(effectiveLayout)

    return (
      <div className="flex flex-col h-full bg-surface-1">
        {/* Header — active gated on activeSpace since this panel stays mounted
             (hidden via CSS) even when not the active tab, to keep PiP/playback alive.
             Two zones: context (video identity) and actions (grouped controls, folding into
             ONE "…" via OverflowGroup + `extraItems` — replaces the separate HeaderOverflowMenu,
             which would otherwise have produced a second "…" button alongside the fold menu). */}
        <TabHeaderPortal floating={floating} active={activeSpace === 'youtube'} className="min-w-0" zone="context">
          {/* No local "← Back" button — TabHeaderPortal's shared HomeButton (now youtube-aware,
              see store's youtubeHomeToken) covers "back to browse", and the shared TopBar
              back/forward buttons cover video-to-video history, matching Notes/Lexicon. */}
          {youtubeNoteBack && (
            <Button
              variant="ghost" size="sm" icon={ArrowLeft}
              onClick={() => {
                useAppStore.getState().requestOpenNote(youtubeNoteBack.noteId)
                setYoutubeNoteBack(null)
                useAppStore.getState().ensureTab('note')
              }}
              className="flex-shrink-0 max-w-[140px]"
              title={`Back to "${youtubeNoteBack.title}"`}
            >
              <span className="truncate">{youtubeNoteBack.title}</span>
            </Button>
          )}
          <span className="flex-1 min-w-0 text-footnote font-medium text-text-primary truncate">
            {activeVideo?.title ?? ''}
          </span>
        </TabHeaderPortal>
        <TabHeaderPortal floating={floating} active={activeSpace === 'youtube'} className="min-w-0" zone="actions">
          <div data-overflow-fill className="flex flex-1 min-w-0 justify-end">
          <OverflowGroup className="justify-end"
            label="More"
            extraItems={[
              ...(playerReady && !videoEnded ? [
                {
                  key: 'copy-link',
                  label: 'Copy video link (no timestamp)',
                  icon: Link2,
                  onSelect: () => insertTimestamp('link'),
                },
                {
                  key: 'insert-timestamp',
                  label: activeSpace === 'youtube' ? 'Copy timestamp link' : 'Insert timestamp link into active note',
                  icon: Paperclip,
                  shortcut: '⌘⇧L',
                  onSelect: () => insertTimestamp('timestamp'),
                },
              ] : []),
              {
                key: 'open-external',
                label: 'Open in browser',
                icon: ExternalLink,
                onSelect: () => window.app.openExternal(`https://www.youtube.com/watch?v=${activeVideoId}`),
              },
            ]}
          >
            <OverflowSection priority="last" items={[
              { key: 'star', label: activeVideo?.isStarred ? 'Unstar' : 'Star this video', icon: Star, checked: activeVideo?.isStarred, onSelect: () => handleToggleStar(activeVideoId) },
              { key: 'maximize', label: videoMaximized ? 'Restore' : 'Maximize video', icon: videoMaximized ? Minimize2 : Maximize2, onSelect: () => setVideoMaximized((v) => !v) },
            ]}>
              <ControlGroup>
                <IconButton
                  icon={Star}
                  label={activeVideo?.isStarred ? 'Unstar' : 'Star this video'}
                  size={28}
                  iconClassName={activeVideo?.isStarred ? 'text-warning fill-warning' : undefined}
                  onClick={() => handleToggleStar(activeVideoId)}
                />
                <IconButton
                  icon={videoMaximized ? Minimize2 : Maximize2}
                  label={videoMaximized ? 'Restore' : 'Maximize video'}
                  size={28}
                  onClick={() => setVideoMaximized((v) => !v)}
                />
              </ControlGroup>
            </OverflowSection>
            {/* Layout button — hidden in floating tabs. Own popover (not a portal), so it's
                items-less: when folded it renders as its own stacked block instead of a plain
                MenuItem, keeping the same `absolute` positioning working unchanged. */}
            {!floating && (
              <OverflowSection>
                <div className="relative" ref={layoutPickerRef}>
                  <IconButton
                    icon={LayoutGrid}
                    label="Change layout"
                    size={28}
                    active={showLayoutPicker}
                    onClick={() => setShowLayoutPicker((v) => !v)}
                  />
                  {showLayoutPicker && (
                    <div className="material-popover absolute right-0 top-full mt-1 z-menu rounded-menu p-3 w-[340px]">
                      <SectionLabel className="mb-2">Layout</SectionLabel>
                      <div className="grid grid-cols-2 gap-1.5">
                        {YOUTUBE_LAYOUTS.map((def) => (
                          <OptionCard
                            key={def.id}
                            title={def.label}
                            description={<>{def.description}{def.requiresBoth && <span className="block text-micro text-warning mt-0.5">Needs 2 panels</span>}</>}
                            selected={ytLayout === def.id}
                            onClick={() => { setYtLayout(def.id); setShowLayoutPicker(false) }}
                          />
                        ))}
                      </div>
                      {/* Active panels summary */}
                      {(panelA || panelB) && (
                        <div className="mt-2 pt-2 border-t border-separator">
                          <SectionLabel className="mb-1.5">Active panels</SectionLabel>
                          <div className="flex flex-col gap-1">
                            {panelA && (
                              <div className="flex items-center justify-between gap-2 text-caption">
                                <span className="text-text-secondary">Panel A: <span className="font-medium capitalize">{panelA.type}</span></span>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setPanelA(null); if (!panelB) setYtLayout('video-full') }}>Remove</Button>
                              </div>
                            )}
                            {panelB && (
                              <div className="flex items-center justify-between gap-2 text-caption">
                                <span className="text-text-secondary">Panel B: <span className="font-medium capitalize">{panelB.type}</span></span>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setPanelB(null); setYtLayout(suggestLayout(!!panelA, false, ytLayout)) }}>Remove</Button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </OverflowSection>
            )}
          </OverflowGroup>
          </div>
        </TabHeaderPortal>

        {/* ── Layout container: wraps video column + optional secondary panels ─ */}
        <div className={`flex-1 min-h-0 overflow-hidden ${layoutStyle.containerClass}`}>

        {/* ── Video column ─────────────────────────────────────────────────── */}
        <div className={`flex flex-col overflow-hidden ${layoutStyle.videoClass}`}>

        {/* ── Video container ──────────────────────────────────────────────────
             The webview uses position:absolute (inset 0) to fill this div.
             height:100% on <webview> does not resolve reliably in Electron —
             absolute positioning is the correct technique.
             Inside the webview, .html5-video-player is position:fixed so it
             pins to the webview's own viewport regardless of YouTube's layout,
             and setSize() drives the actual pixel dimensions. */}
        <div
          className={`relative overflow-hidden rounded-card ${videoMaximized ? 'flex-1 min-h-0' : 'flex-shrink-0'}`}
          style={!videoMaximized ? { height: '56vh', minHeight: '240px' } : undefined}
        >
          {/* Webview — invisible until playerReady to avoid flash of unstyled YouTube chrome.
              Also hidden while showLayoutPicker (or any other locally-portaled menu that can
              overlap the video area) is open: Electron's <webview> is a separate native
              compositor layer that always paints above normal DOM content regardless of CSS
              z-index, so a popover positioned "over" it (like the layout picker) rendered
              behind it instead. Reusing the same opacity toggle already used for the
              playerReady loading state — confirmed to actually hide the webview, since the
              loading spinner already relies on it to cover the webview while loading. */}
          {/* iPhone: no <webview> in WKWebView — a plain IFrame embed reports state to this
              window instead (TouchYouTubePlayer). webviewRef stays null, so every Electron-only
              effect below (polls, executeJavaScript, PiP) no-ops. */}
          {playerSrc && capabilities.nativeVideoPlayer && activeVideoId && (
            <TouchYouTubePlayer
              videoId={activeVideoId}
              startTime={touchStartTime}
              onReady={touchPlayerReady}
              onEnded={touchPlayerEnded}
              onPosition={touchPlayerPosition}
              onEmbedBlocked={touchPlayerBlocked}
            />
          )}
          {playerSrc && !capabilities.nativeVideoPlayer && (
            <webview
              ref={webviewRef}
              src={playerSrc}
              partition="persist:youtube"
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex',
                opacity: (playerReady && !showLayoutPicker) ? 1 : 0,
                pointerEvents: showLayoutPicker ? 'none' : 'auto',
                transition: 'opacity 0.25s ease',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            />
          )}

          {/* Loading spinner — covers the invisible webview until ready */}
          {(!playerReady || !playerSrc) && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-1">
              <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-text-muted animate-spin" />
            </div>
          )}

          {/* Floating copy toast */}
          {copyToast && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-overlay px-4 py-2 material-control text-footnote font-medium text-text-primary pointer-events-none animate-fade-in-up">
              Copied to clipboard
            </div>
          )}

          {/* Ended overlay — recommendations grid (delayed 400ms so rapid Back never flashes it) */}
          {showEndOverlay && (
            <div className="absolute inset-0 bg-surface-1/97 flex flex-col p-4 overflow-y-auto z-raised">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <p className="text-subhead font-semibold text-text-primary">Up next</p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost" size="sm" icon={RotateCcw}
                    onClick={() => {
                      setVideoEnded(false)
                      if (webviewRef.current) {
                        const js = watchFallback
                          ? '(()=>{var v=document.querySelector("video");if(v){v.currentTime=0;v.play().catch(function(){});}null;})()'
                          : '(()=>{var f=document.querySelector("iframe");if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:"command",func:"seekTo",args:[0,true]}),"*");f.contentWindow.postMessage(JSON.stringify({event:"command",func:"playVideo",args:""}),"*");}if(window.__yt){window.__yt.ended=false;window.__yt.t=0;}null;})()'
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ;(webviewRef.current as any).executeJavaScript(js).catch(() => {})
                      }
                    }}
                  >
                    Watch again
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleBack}>Back to list</Button>
                </div>
              </div>
              {recommendations.length === 0
                ? (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="rounded-card overflow-hidden bg-surface-elevated border border-border animate-pulse">
                        <div className="w-full aspect-video bg-surface-3" />
                        <div className="p-1.5 space-y-1">
                          <div className="h-2 bg-surface-3 rounded-chip w-full" />
                          <div className="h-2 bg-surface-3 rounded-chip w-2/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                )
                : (
                  <div className="grid gap-3 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                    {recommendations.map((rec) => (
                      <button
                        key={rec.videoId}
                        onClick={() => { setVideoEnded(false); setActiveVideoId(rec.videoId) }}
                        className="text-left group rounded-card overflow-hidden bg-surface-elevated border border-border hover:border-accent/50 transition-[border-color] duration-base ease-mac cursor-pointer"
                      >
                        <div className="relative w-full aspect-video bg-surface-4">
                          {(() => {
                            const level = thumbFallback.get(rec.videoId) ?? 0
                            const src = thumbnailUrlAtLevel(rec.thumbnailUrl, level)
                            // No "No preview" placeholder text needed here (unlike the main
                            // grid) — this card already has a title/channel-name label below the
                            // image, so an empty tinted box reads fine on its own; previously
                            // this had NO onError handling at all, so a 404 rendered a literal
                            // broken-image icon.
                            if (!src) return null
                            return (
                              <img
                                src={src}
                                alt={rec.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                onError={() => setThumbFallback((prev) => new Map(prev).set(rec.videoId, level + 1))}
                              />
                            )
                          })()}
                          {rec.channelHandle === activeVideo?.channelHandle && (
                            <div className="absolute top-1 right-1 text-micro font-semibold px-1 py-0.5 rounded-chip bg-accent text-white">SAME CH</div>
                          )}
                        </div>
                        <div className="p-1.5">
                          <p className="text-caption2 font-medium text-text-primary line-clamp-2 leading-tight">{rec.title}</p>
                          <p className="text-micro text-text-muted mt-0.5 truncate">{rec.channelName}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              }
            </div>
          )}
        </div>

        {/* ── Info strip + description — hidden in maximized mode ──────────── */}
        {!videoMaximized && (
          // When a note is open: flex column so the note editor fills all remaining space to the
          // bottom. When no note: scrollable so long descriptions are accessible.
          <div className={`material-panel flex-1 min-h-0 ${inlinePanelNoteId ? 'flex flex-col' : 'overflow-y-auto'}`}>
            {/* Channel / date row — always compact */}
            <div className="px-4 pt-3 pb-2 border-t border-separator flex-shrink-0">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Button
                  variant="ghost" size="sm"
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) window.app.openExternal(`https://www.youtube.com/${activeVideo?.channelHandle}`)
                    else if (activeVideo) handleBackAndFilter(activeVideo.channelHandle)
                  }}
                  tooltip="Filter by channel (⌘+click to open in browser)"
                  className="max-w-[60%]"
                >
                  <span className="truncate">{activeVideo?.channelName ?? ''}</span>
                </Button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {activeVideo?.published && (
                    <span className="text-caption2 text-text-muted">{formatDateFull(activeVideo.published)}</span>
                  )}
                  <IconButton
                    icon={ExternalLink}
                    label="Open channel in browser"
                    size={20}
                    onClick={() => activeVideo && window.app.openExternal(`https://www.youtube.com/${activeVideo.channelHandle}`)}
                  />
                </div>
              </div>
            </div>
            {/* ── Synced transcript — highlights the line at the current playback time ─ */}
            {!inlinePanelNoteId && activeTranscript.length > 0 && (
              <div className="border-t border-separator">
                <DisclosureRow
                  open={showTranscript}
                  onClick={() => setShowTranscript((v) => !v)}
                  icon={Captions}
                  className="!h-auto px-4 pt-2.5 pb-1.5"
                  title={<span className="text-caption2 font-semibold text-text-muted uppercase tracking-wider">Transcript</span>}
                  trailing={<span className="text-micro text-text-quaternary">{activeTranscript.length} lines · click to jump</span>}
                />
                {showTranscript && (
                  <div style={{ height: '320px' }}>
                    <TranscriptViewer segments={activeTranscript} currentTimeMs={currentTimeMs} onSeek={seekTo} />
                  </div>
                )}
              </div>
            )}

            {/* Description — hidden while a note is open to free up vertical space */}
            {!inlinePanelNoteId && (
              videoDescription
                ? (
                  <div className="px-4 py-3">
                    <SectionLabel className="mb-2">Description</SectionLabel>
                    <p className="text-footnote text-text-secondary whitespace-pre-wrap leading-relaxed">{videoDescription}</p>
                  </div>
                )
                : <div className="h-4" />
            )}

            {/* ── Linked notes ─────────────────────────────────────────────── */}
            {/* Always show the notes section (with a "New note" button) */}
            <div className={`border-t border-separator flex min-h-0 ${inlinePanelNoteId ? 'flex-1' : ''}`}>
              {/* Left: note list */}
              <div className={`flex flex-col ${inlinePanelNoteId ? 'w-48 flex-shrink-0 border-r border-separator' : 'flex-1'} overflow-y-auto`}>
                  <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-shrink-0">
                    <SectionLabel className="flex-1">
                      Video notes {videoNotes.length > 0 && `(${videoNotes.length})`}
                    </SectionLabel>
                    <IconButton icon={Plus} label="New note for this video" size={20} onClick={createVideoNote} />
                  </div>
                  {videoNotes.length === 0 && (
                    <div className="px-4 pb-4 flex flex-col items-center gap-2 text-center">
                      <p className="text-caption2 text-text-muted">No notes linked to this video yet</p>
                      <Button variant="ghost" size="sm" icon={Plus} selected onClick={createVideoNote}>New note</Button>
                    </div>
                  )}
                {videoNotes.length > 0 && (
                  <div className="px-1.5 pb-3 space-y-0.5 flex-1">
                    {/* Whole-video links */}
                    {videoNotes.filter(n => n.timestamp === 0).map((n) => (
                      <ListRow key={`${n.noteId}-0`} dense
                        leading={<NotepadText size={12} />}
                        title={n.noteTitle}
                        selected={inlinePanelNoteId === n.noteId}
                        onClick={() => setInlinePanelNoteId(inlinePanelNoteId === n.noteId ? null : n.noteId)}
                        trailing={
                          <IconButton icon={ExternalLink} label="Open in Notes tab" size={20} tooltip={false}
                            onMouseDown={(e) => { e.stopPropagation(); useAppStore.getState().ensureTab('note'); useAppStore.getState().requestOpenNote(n.noteId) }} />
                        }
                      />
                    ))}
                    {/* Timestamped links */}
                    {videoNotes.filter(n => n.timestamp > 0).map((n, i) => (
                      <ListRow key={`${n.noteId}-${i}`} dense
                        leading={
                          <RefChip
                            size="xs"
                            onMouseDown={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              if (webviewRef.current) {
                                const js = watchFallback
                                  ? `(()=>{var v=document.querySelector("video");if(v){v.currentTime=${n.timestamp};v.play().catch(function(){});}null;})()`
                                  : `(()=>{var f=document.querySelector("iframe");if(f&&f.contentWindow){f.contentWindow.postMessage(JSON.stringify({event:"command",func:"seekTo",args:[${n.timestamp},true]}),"*");f.contentWindow.postMessage(JSON.stringify({event:"command",func:"playVideo",args:""}),"*");}null;})()`
                                ;(webviewRef.current as any).executeJavaScript(js).catch(() => {}) // eslint-disable-line @typescript-eslint/no-explicit-any
                              }
                            }}
                          >
                            <Clock size={8} />{fmtSecs(n.timestamp)}
                          </RefChip>
                        }
                        title={n.noteTitle}
                        selected={inlinePanelNoteId === n.noteId}
                        onClick={() => setInlinePanelNoteId(inlinePanelNoteId === n.noteId ? null : n.noteId)}
                        trailing={
                          <IconButton icon={ExternalLink} label="Open in Notes tab" size={20} tooltip={false}
                            onMouseDown={(e) => { e.stopPropagation(); useAppStore.getState().ensureTab('note'); useAppStore.getState().requestOpenNote(n.noteId) }} />
                        }
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Right: inline note editor / preview — uses NoteEditor for full feature parity */}
                {inlinePanelNoteId && (
                  <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    {/* Panel header */}
                    <div className="flex items-center px-2 py-1 border-b border-separator flex-shrink-0 gap-0.5">
                      <span className="text-caption2 font-medium text-text-secondary truncate flex-1 min-w-0 px-1">
                        {videoNotes.find(n => n.noteId === inlinePanelNoteId)?.noteTitle ?? 'Note'}
                      </span>
                      {/* Undo / Redo — only meaningful in edit mode */}
                      {inlinePanelEditing && (
                        <>
                          <IconButton icon={Undo2} label="Undo" tooltip={{ shortcut: '⌘Z' }} size={20} onClick={() => inlinePanelCommandsRef.current?.undo()} />
                          <IconButton icon={Redo2} label="Redo" tooltip={{ shortcut: '⌘⇧Z' }} size={20} onClick={() => inlinePanelCommandsRef.current?.redo()} />
                        </>
                      )}
                      {/* Edit / Preview toggle */}
                      <IconButton
                        icon={inlinePanelEditing ? Eye : Edit3}
                        label={inlinePanelEditing ? 'Preview' : 'Edit note'}
                        size={20}
                        selected={inlinePanelEditing}
                        onClick={() => setInlinePanelEditing(v => !v)}
                      />
                      <IconButton
                        icon={ExternalLink}
                        label="Open in Notes tab"
                        size={20}
                        onClick={() => { useAppStore.getState().ensureTab('note'); useAppStore.getState().requestOpenNote(inlinePanelNoteId) }}
                      />
                      <IconButton icon={X} label="Close" size={20} onClick={() => setInlinePanelNoteId(null)} />
                    </div>

                    {/* flex-1 min-h-0 so NoteEditor fills remaining height after the panel header */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <NoteEditor
                        content={inlinePanelContent}
                        tabId={ytTabId ?? undefined}
                        onChange={handleInlinePanelContentChange}
                        mode={inlinePanelEditing ? 'edit' : 'view'}
                        onCommandsRef={(cmds) => { inlinePanelCommandsRef.current = cmds }}
                        onVerseRefClick={handleInlineVerseRefClick}
                        onWikilinkClick={handleInlineWikilinkClick}
                        onLexiconRefClick={handleInlineLexiconRefClick}
                      />
                    </div>
                  </div>
                )}
            </div>
          </div>
        )}

        </div>{/* end video column */}

        {/* ── Secondary panels ─────────────────────────────────────────────── */}
        {/* Closing panelA in a 2-panel layout promotes panelB to panelA and
            collapses to a single-panel layout. Closing panelB just drops it. */}
        {effectiveLayout !== 'video-full' && (
          stackedPanels ? (
            // Stacked: panelA + panelB in a nested flex-col column
            <div className={`flex flex-col overflow-hidden border-l border-separator ${panelWrapperSide === 'right' ? layoutStyle.panelAClass : layoutStyle.videoClass}`}>
              <div className="flex-1 min-h-0 overflow-hidden">
                <PanelSlot panel={panelA} label="Panel A" onSet={setPanelA} onClear={closePanelA} />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden border-t border-separator">
                <PanelSlot panel={panelB} label="Panel B" onSet={setPanelB} onClear={closePanelB} />
              </div>
            </div>
          ) : effectiveLayout === 'three-col' || effectiveLayout === 'three-col-wide-video' ? (
            // Three-column: panelA left | video center | panelB right
            <>
              <div className={`overflow-hidden border-l border-separator order-first ${layoutStyle.panelAClass}`}>
                <PanelSlot panel={panelA} label="Left panel" onSet={setPanelA} onClear={closePanelA} />
              </div>
              <div className={`overflow-hidden border-l border-separator ${layoutStyle.panelBClass}`}>
                <PanelSlot panel={panelB} label="Right panel" onSet={setPanelB} onClear={closePanelB} />
              </div>
            </>
          ) : (
            // Single secondary panel (side-right/left, stack-below/above, wide-*)
            <div className={`overflow-hidden border-l border-separator ${layoutStyle.panelAClass}`}>
              <PanelSlot panel={panelA} label="Panel" onSet={setPanelA} onClear={closePanelA} />
            </div>
          )
        )}

        </div>{/* end layout container */}
      </div>
    )
  }

  // ─── List view ────────────────────────────────────────────────────────────────

  const isFiltered = durationFilter !== 'any' || watchFilter !== 'all' || starredOnly || typeFilter !== 'all' || channelFilter !== 'all'
  const moreFiltersActive = starredOnly || watchFilter !== 'all' || durationFilter !== 'any'
  const moreFiltersCount = [starredOnly, watchFilter !== 'all', durationFilter !== 'any'].filter(Boolean).length

  return (
    <div className="flex flex-col h-full bg-surface-3" onClick={closeMenus}>
      {/* Toolbar — portaled into the shared top bar instead of drawing its own second header
           row. Two zones: context (the browse search field — a bare input like every other
           tab's context-zone search, never folds since it isn't part of any OverflowGroup) and
           actions (the filter/view controls). The portal target (ShellHeader's slot) is a fixed
           44px-tall, overflow-hidden row, so the actions zone can't wrap to a second line without
           getting clipped — OverflowGroup folds trailing controls into a "…" popover once the
           row is too narrow instead (nothing hidden, nothing scrolls sideways; see its own
           comment). */}
      <TabHeaderPortal floating={floating} active={activeSpace === 'youtube'} zone="context">
        <SearchField
          value={search}
          onValueChange={(v) => { setSearch(v); setPage(1) }}
          placeholder="Search title, channel, or transcript…"
          bare
          wrapperClassName="flex-1 min-w-[100px]"
        />
      </TabHeaderPortal>
      <TabHeaderPortal floating={floating} active={activeSpace === 'youtube'} zone="actions">
      {/* data-overflow-fill: this row takes the toolbar's remaining width so it folds (global.css). */}
      <div data-overflow-fill className="flex flex-1 min-w-0 justify-end">
      <OverflowGroup label="More filters" className="justify-end">
        {/* Search scope — only shown while searching: Title / Transcript / Both */}
        {search && (
          <SegmentedControl
            aria-label="Search scope"
            className="flex-shrink-0"
            value={searchScope}
            onChange={(s) => { setSearchScope(s); setPage(1) }}
            options={(['title', 'transcript', 'both'] as SearchScope[]).map((s) => ({
              value: s,
              label: s[0].toUpperCase() + s.slice(1),
              title: s === 'title' ? 'Search titles & channels' : s === 'transcript' ? 'Search transcript text' : 'Search titles & transcripts',
            }))}
          />
        )}

        {/* Type filter */}
        <SegmentedControl
          aria-label="Video type"
          className="flex-shrink-0"
          value={typeFilter}
          onChange={(t) => { setTypeFilter(t); setPage(1) }}
          options={(['all', 'video', 'short', 'live'] as TypeFilter[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
        />

        {/* View controls — filters/channel/sort are all "narrow the video list" siblings, so
             they share one grouped container instead of three independently-chromed buttons. */}
        <ControlGroup>
        {/* More filters — a floating popover (never an inline panel that pushes the grid down;
             same portal-to-body pattern as Channel/Sort/Transcript tools below). "Search in" is
             deliberately left out — it's already the SegmentedControl just above, shown whenever
             `search` is active, so repeating it here would just be a second control for the
             same state. */}
        <div onClick={(e) => e.stopPropagation()}>
          <Button
            ref={moreFiltersBtnRef}
            variant="ghost" size="sm" icon={SlidersHorizontal} selected={showMoreFilters || moreFiltersActive}
            onClick={() => { setShowMoreFilters((v) => !v); setShowChannelMenu(false); setShowSortMenu(false) }}
          >
            Filters
            {moreFiltersCount > 0 && (
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent text-white text-micro font-semibold">
                {moreFiltersCount}
              </span>
            )}
            <ChevronDown size={9} className={`transition-transform ${showMoreFilters ? 'rotate-180' : ''}`} />
          </Button>
          {showMoreFilters && moreFiltersBtnRef.current && createPortal(
            <MenuPositioner
              x={moreFiltersBtnRef.current.getBoundingClientRect().right}
              y={moreFiltersBtnRef.current.getBoundingClientRect().bottom + 4}
              align="right"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="material-popover rounded-menu w-64 p-3 space-y-3">
                {/* Starred */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption2 text-text-muted font-medium whitespace-nowrap">Starred</span>
                  <SegmentedControl
                    aria-label="Starred"
                    value={starredOnly ? 'starred' : 'all'}
                    onChange={(v) => { setStarredOnly(v === 'starred'); setPage(1) }}
                    options={[
                      { value: 'all', label: 'All' },
                      { value: 'starred', label: 'Starred', icon: Star },
                    ]}
                  />
                </div>

                {/* Progress / watch filter */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption2 text-text-muted font-medium whitespace-nowrap">Progress</span>
                  <SegmentedControl
                    aria-label="Watch progress"
                    value={watchFilter}
                    onChange={(opt) => { setWatchFilter(opt); setPage(1) }}
                    options={(Object.keys(WATCH_LABEL) as WatchFilter[]).map((opt) => ({ value: opt, label: WATCH_LABEL[opt] }))}
                  />
                </div>

                {/* Length / duration filter */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption2 text-text-muted font-medium whitespace-nowrap">Length</span>
                  <SegmentedControl
                    aria-label="Video length"
                    value={durationFilter}
                    onChange={(opt) => { setDurationFilter(opt); setPage(1) }}
                    options={(Object.keys(DURATION_LABEL) as DurationFilter[]).map((opt) => ({ value: opt, label: DURATION_LABEL[opt] }))}
                  />
                </div>
              </div>
            </MenuPositioner>,
            document.body
          )}
        </div>

        {/* Channel filter */}
        <div onClick={(e) => e.stopPropagation()}>
          <Button
            ref={channelBtnRef}
            variant="ghost" size="sm" icon={ChevronDown} iconTrailing selected={showChannelMenu}
            onClick={() => { setShowChannelMenu((v) => !v); setShowSortMenu(false); setShowDurationMenu(false); setShowWatchMenu(false); setShowMoreFilters(false) }}
            className="max-w-[120px]"
          >
            <span className="truncate">{channelFilter === 'all' ? 'All channels' : channelFilter.replace('@', '')}</span>
          </Button>
          {showChannelMenu && channelBtnRef.current && createPortal(
            <MenuPositioner
              x={channelBtnRef.current.getBoundingClientRect().right}
              y={channelBtnRef.current.getBoundingClientRect().bottom + 4}
              align="right"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuSurface className="w-max max-w-[280px] flex flex-col overflow-hidden" style={{ maxHeight: '300px' }}>
                <div className="-m-1 mb-1 p-1.5 border-b border-separator flex-shrink-0">
                  <SearchField
                    autoFocus
                    value={channelSearch}
                    onValueChange={setChannelSearch}
                    placeholder="Filter channels…"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="overflow-y-auto flex-1">
                  {!channelSearch && (
                    <MenuItem
                      label="All channels"
                      active={channelFilter === 'all'}
                      onClick={() => { setChannelFilter('all'); setShowChannelMenu(false); setChannelSearch(''); setPage(1) }}
                    />
                  )}
                  {channelNames
                    .filter((h) => !channelSearch || h.toLowerCase().includes(channelSearch.toLowerCase()))
                    .map((handle) => (
                      <MenuItem key={handle}
                        label={handle.replace('@', '')}
                        active={channelFilter === handle}
                        onClick={() => { setChannelFilter(handle); setShowChannelMenu(false); setChannelSearch(''); setPage(1) }}
                      />
                    ))}
                </div>
              </MenuSurface>
            </MenuPositioner>,
            document.body
          )}
        </div>

        {/* Duration filter moved to More Filters panel */}

        {/* Sort */}
        <div onClick={(e) => e.stopPropagation()}>
          <Button
            ref={sortBtnRef}
            variant="ghost" size="sm" icon={ChevronDown} iconTrailing selected={showSortMenu}
            onClick={() => { setShowSortMenu((v) => !v); setShowChannelMenu(false); setShowDurationMenu(false); setShowWatchMenu(false); setShowMoreFilters(false) }}
          >
            {SORT_LABEL[sort]}
          </Button>
          {showSortMenu && sortBtnRef.current && createPortal(
            <MenuPositioner
              x={sortBtnRef.current.getBoundingClientRect().right}
              y={sortBtnRef.current.getBoundingClientRect().bottom + 4}
              align="right"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuSurface className="w-[130px]">
                {(Object.keys(SORT_LABEL) as SortOption[])
                  // 'Best match' only applies while searching — hide it otherwise.
                  .filter((opt) => opt !== 'relevance' || search.trim().length > 0)
                  .map((opt) => (
                    <MenuItem key={opt}
                      label={SORT_LABEL[opt]}
                      active={sort === opt}
                      onClick={() => { setSort(opt); setShowSortMenu(false); setPage(1) }}
                    />
                  ))}
              </MenuSurface>
            </MenuPositioner>,
            document.body
          )}
        </div>
        </ControlGroup>

        {/* Clear all filters */}
        {isFiltered && (
          <IconButton
            icon={X} label="Clear all filters" size={20} danger
            onClick={(e) => {
              e.stopPropagation()
              setTypeFilter('all'); setChannelFilter('all'); setDurationFilter('any')
              setWatchFilter('all'); setStarredOnly(false); setPage(1)
            }}
          />
        )}

        {/* Refresh */}
        <IconButton
          icon={RefreshCw} label="Check for new videos" size={28} disabled={loading || syncing}
          iconClassName={loading && !syncing ? 'animate-spin' : ''}
          onClick={doRefresh}
        />

        {showDevTools && (
          <Button variant="ghost" size="sm" icon={Download} selected disabled={loading || syncing} onClick={doFullSync} className="flex-shrink-0">
            {syncing ? 'Syncing…' : 'Full Sync'}
          </Button>
        )}

        {/* Transcript filter toggle — dev only (a debugging aid for transcript coverage) */}
        {showDevTools && (
          <Button
            variant="ghost" size="sm" icon={Captions} selected={transcriptOnly}
            onClick={(e) => { e.stopPropagation(); setTranscriptOnly((v) => !v); setPage(1) }}
            title={transcriptOnly ? 'Showing only videos with transcripts' : 'Show only videos with transcripts'}
            className="flex-shrink-0"
          >
            {transcriptIds.size > 0 ? transcriptIds.size : ''}
          </Button>
        )}

        {/* Transcript tools — dev only (fetch/clear stored transcripts). Collapsed into a
             single popover; production builds never see it — electron/ipc/youtube.ts refuses
             fetchTranscripts/clearTranscripts outside devToolsEnabled() regardless. */}
        {showDevTools && (
        <div className="flex-shrink-0" ref={transcriptMenuRef}>
            <Button
              ref={transcriptBtnRef}
              variant="ghost" size="sm" icon={Captions} iconTrailing={false} selected={showTranscriptMenu || fetchingTranscripts}
              onClick={(e) => { e.stopPropagation(); setShowTranscriptMenu((v) => !v) }}
              tooltip="Transcript tools (dev only)"
            >
              {fetchingTranscripts && progress
                ? `${progress.done}/${progress.total}`
                : 'Transcripts'}
              <ChevronDown size={10} className={`transition-transform ${showTranscriptMenu ? 'rotate-180' : ''}`} />
            </Button>

            {showTranscriptMenu && transcriptBtnRef.current && createPortal(
              <MenuPositioner
                x={transcriptBtnRef.current.getBoundingClientRect().right}
                y={transcriptBtnRef.current.getBoundingClientRect().bottom + 4}
                align="right"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="material-popover rounded-menu w-56 p-3 space-y-3">
                  <SectionLabel>Fetch transcripts</SectionLabel>

                  {/* Batch size */}
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-caption text-text-secondary">Videos per run</span>
                    <TextField
                      type="number" min={1} max={10000} value={transcriptBatchSize}
                      onChange={(e) => setTranscriptBatchSize(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
                      disabled={fetchingTranscripts}
                      size="sm"
                      className="w-20 text-center"
                    />
                  </label>

                  {/* Worker count */}
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-caption text-text-secondary">Parallel workers</span>
                    <TextField
                      type="number" min={1} max={16} value={transcriptWorkers}
                      onChange={(e) => setTranscriptWorkers(Math.max(1, Math.min(16, parseInt(e.target.value) || 1)))}
                      disabled={fetchingTranscripts}
                      size="sm"
                      className="w-20 text-center"
                    />
                  </label>

                  {/* Progress bar while fetching */}
                  {fetchingTranscripts && progress && progress.total > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-micro text-text-muted">
                        <span className="truncate">{progress.phase}</span>
                        <span className="tabular-nums flex-shrink-0">{progress.done}/{progress.total}</span>
                      </div>
                      <div className="h-1 rounded-full bg-surface-4 overflow-hidden">
                        <div className="h-full bg-success transition-[width] duration-base ease-mac" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="success" size="sm" icon={Captions}
                      onClick={doFetchTranscripts}
                      disabled={loading || syncing || fetchingTranscripts}
                      className="flex-1"
                    >
                      {fetchingTranscripts ? 'Fetching…' : 'Get transcripts'}
                    </Button>
                    <IconButton icon={Trash2} label="Clear all stored transcripts" size={24} danger disabled={fetchingTranscripts} onClick={doClearTranscripts} />
                  </div>

                  {/* Status footer */}
                  <div className="flex items-center justify-between text-micro text-text-muted pt-1 border-t border-separator">
                    <span>{transcriptIds.size} downloaded</span>
                    {transcriptResult && (
                      <span className="tabular-nums">✓{transcriptResult.fetched} · skip {transcriptResult.skipped} · err {transcriptResult.errors}</span>
                    )}
                  </div>
                </div>
              </MenuPositioner>,
              document.body
            )}
          </div>
        )}
      </OverflowGroup>
      </div>
      </TabHeaderPortal>

      {/* Progress bar — only shown while a sync is actively running (total > 0) */}
      {progress && progress.total > 0 && (
        <div className="px-3 py-1.5 border-b border-separator bg-surface-2 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-caption2 text-text-muted truncate max-w-[75%]">{progress.phase}</span>
            <span className="text-caption2 text-text-muted flex-shrink-0 ml-2 tabular-nums">
              {progress.done}/{progress.total}
            </span>
          </div>
          {/* Track — overflow-hidden clips the fill; no rounded-full on the inner bar
              to avoid border-radius consuming the visual fill at small percentages */}
          <div className="h-[3px] bg-surface-4 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-200 ease-out"
              style={{ width: progressWidth(progress.done, progress.total) }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div
        ref={gridScrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => { lastGridScrollTopRef.current = (e.currentTarget as HTMLDivElement).scrollTop }}
      >
        {loading && videos.length === 0 && (
          <div className="px-6 py-8 flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            {progress && <p className="text-footnote text-text-muted">{progress.phase}</p>}
          </div>
        )}

        {!loading && videos.length === 0 && (
          <EmptyState
            title="No videos stored yet."
            action={
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={doRefresh}>Load recent videos</Button>
                {showDevTools && <Button variant="secondary" size="sm" onClick={doFullSync}>Full Sync (fetch all history)</Button>}
              </div>
            }
          />
        )}

        {!loading && filtered.length === 0 && videos.length > 0 && (
          <EmptyState title="No videos match your filters" compact />
        )}

        {paged.length > 0 && (
          <>
            <div className="p-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {paged.map((video) => {
                const watchedPos = historyMap[video.videoId] ?? 0
                const watchPct = video.durationSeconds > 0 ? Math.min(100, (watchedPos / video.durationSeconds) * 100) : 0
                return (
                  <div
                    key={video.videoId}
                    onClick={() => setActiveVideoId(video.videoId)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setVideoMenu({ video, x: e.clientX, y: e.clientY })
                    }}
                    className="text-left group rounded-card overflow-hidden bg-surface-2 border border-separator hover:border-accent/50 hover:bg-surface-hover transition-[border-color,background-color] duration-base ease-mac cursor-pointer relative"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-video bg-surface-4 overflow-hidden">
                      {(() => {
                        const level = thumbFallback.get(video.videoId) ?? 0
                        const src = thumbnailUrlAtLevel(video.thumbnailUrl, level)
                        if (!src) return <div className="w-full h-full flex items-center justify-center text-text-muted text-footnote">No preview</div>
                        return (
                          <img
                            src={src}
                            alt={video.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            onError={() => setThumbFallback((prev) => new Map(prev).set(video.videoId, level + 1))}
                          />
                        )
                      })()}

                      {/* Duration + downloaded-transcript badge. The chip marks that THIS app
                          has the transcript stored locally (not YouTube's live captions). */}
                      {((video.durationSeconds > 0 && !video.isLiveNow) || transcriptIds.has(video.videoId)) && (
                        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                          {video.durationSeconds > 0 && !video.isLiveNow && (
                            <span className="text-micro font-mono px-1 py-0.5 rounded-chip bg-black/70 text-white">
                              {formatDuration(video.durationSeconds)}
                            </span>
                          )}
                          {transcriptIds.has(video.videoId) && (
                            <span title="Transcript downloaded" className="flex items-center px-1 py-0.5 rounded-chip bg-success/80 text-white">
                              <Captions size={10} />
                            </span>
                          )}
                        </div>
                      )}

                      {video.type !== 'video' && (
                        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                          {video.isLiveNow && <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />}
                          <span className={cx('text-micro font-semibold px-1.5 py-0.5 rounded-chip text-white', video.type === 'short' ? 'bg-accent' : 'bg-destructive')}>
                            {video.type === 'short' ? 'SHORT' : video.isLiveNow ? 'LIVE NOW' : 'LIVE'}
                          </span>
                        </div>
                      )}

                      {/* Watch progress bar */}
                      {watchPct > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
                          <div className="h-full bg-destructive" style={{ width: `${watchPct}%` }} />
                        </div>
                      )}

                      {/* Play overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                          <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[12px] border-l-gray-800 border-b-[6px] border-b-transparent ml-1" />
                        </div>
                      </div>
                    </div>

                    {/* Card info */}
                    <div className="p-2.5">
                      <p className="text-footnote font-medium text-text-primary leading-tight line-clamp-2 mb-1">
                        {video.title}
                      </p>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-caption2 text-accent truncate">{video.channelName}</span>
                        <span className="text-caption2 flex-shrink-0" style={{ color: video.isLiveNow ? 'rgb(var(--color-destructive))' : 'rgb(var(--color-text-muted))' }}>
                          {timeAgo(video.published, video.isLiveNow)}
                        </span>
                      </div>
                      {watchedPos > 0 && (
                        <p className="text-micro text-text-muted mt-0.5">
                          Watched to {formatDuration(Math.floor(watchedPos))}
                        </p>
                      )}
                      {/* Transcript-match snippets — one row per matching segment (up to 3),
                          each clickable to open the video at that exact timestamp */}
                      {search.trim() && searchScope !== 'title' && transcriptMatchInfo.has(video.videoId) && (() => {
                        const info = transcriptMatchInfo.get(video.videoId)!
                        return (
                          <div className="mt-1.5 rounded-card border border-success/20 overflow-hidden">
                            {info.segments.map((seg, si) => (
                              <button
                                key={si}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // Navigate to video at this timestamp
                                  const seekSec = Math.floor(seg.startMs / 1000)
                                  historyMapRef.current = { ...historyMapRef.current, [video.videoId]: seekSec }
                                  setHistoryMap((prev) => ({ ...prev, [video.videoId]: seekSec }))
                                  setActiveVideoId(video.videoId)
                                }}
                                className="group w-full text-left flex items-start gap-1.5 px-1.5 py-1 bg-success/10 hover:bg-success/20 active:bg-success/30 transition-colors border-b border-success/10 last:border-b-0 cursor-pointer"
                                title={`Jump to ${formatDuration(Math.floor(seg.startMs / 1000))}`}
                              >
                                <Captions size={9} className="text-success flex-shrink-0 mt-[2px]" />
                                <p className="flex-1 min-w-0 text-caption2 leading-snug text-text-secondary group-hover:text-text-primary line-clamp-3 transition-colors">
                                  <span className="font-mono text-success/80 mr-1">{formatDuration(Math.floor(seg.startMs / 1000))}</span>
                                  {highlightSnippet(seg.snippet, search, 240).map((part, pi) =>
                                    part.match
                                      ? <mark key={pi} className="bg-[rgb(var(--highlight-amber)/0.35)] text-text-primary rounded-chip px-0.5">{part.text}</mark>
                                      : <span key={pi}>{part.text}</span>
                                  )}
                                </p>
                                {/* Play triangle — visible on hover */}
                                <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor"
                                  className="flex-shrink-0 self-center text-success opacity-0 group-hover:opacity-100 transition-opacity mt-[1px]">
                                  <path d="M0 0L7 4L0 8V0Z"/>
                                </svg>
                              </button>
                            ))}
                            {info.matchCount > info.segments.length && (
                              <div className="px-1.5 py-0.5 flex items-center gap-1 bg-success/5">
                                <span className="text-micro text-success/60">+{info.matchCount - info.segments.length} more matches in this video</span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Star button (hover) */}
                    <IconButton
                      icon={Star}
                      label={video.isStarred ? 'Unstar' : 'Star'}
                      size={24}
                      tooltip={false}
                      iconClassName={video.isStarred ? 'text-warning fill-warning' : 'text-white'}
                      onClick={(e) => handleToggleStar(video.videoId, e)}
                      className="absolute top-1.5 right-1.5 !rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                    />
                    {video.isStarred && (
                      <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center group-hover:hidden">
                        <Star size={12} className="text-warning fill-warning" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="px-4 pb-6 flex flex-col items-center gap-2">
              {hasMore && !loading && (
                <Button variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)}>
                  Show more ({sorted.length - paged.length} remaining)
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Video right-click context menu */}
      {videoMenu && (
        <>
          <div className="fixed inset-0 z-menu" onClick={() => setVideoMenu(null)} onContextMenu={(e) => { e.preventDefault(); setVideoMenu(null) }} />
          <MenuPositioner x={videoMenu.x} y={videoMenu.y}>
            <MenuSurface className="min-w-[230px]">
              {[
                {
                  icon: Link2, label: 'Copy link for note',
                  action: async () => {
                    await navigator.clipboard.writeText(`[${videoMenu.video.title}](https://youtu.be/${videoMenu.video.videoId})`)
                    setCopyToast(true); setTimeout(() => setCopyToast(false), 2000)
                  },
                },
                {
                  icon: ExternalLink, label: 'Copy video URL',
                  action: async () => {
                    await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoMenu.video.videoId}`)
                    setCopyToast(true); setTimeout(() => setCopyToast(false), 2000)
                  },
                },
                {
                  icon: Plus, label: 'Open in new tab',
                  action: () => useAppStore.getState().openYouTubeVideoInNewTab(videoMenu.video.videoId),
                },
                {
                  icon: Maximize2, label: 'Open in floating tab',
                  action: () => window.app.openFloatingTab('youtube', { videoId: videoMenu.video.videoId }),
                },
              ].map((item) => (
                <MenuItem
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => { item.action(); setVideoMenu(null) }}
                />
              ))}
            </MenuSurface>
          </MenuPositioner>
        </>
      )}
    </div>
  )
}
