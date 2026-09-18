import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useStudyTrailStore, installStudyTrailStateSync, LOOSE_SESSION_ID } from '@/store/studyTrailSlice'
import { Scissors, Plus, Minus, ListChecks, ChevronLeft, ChevronRight, CalendarDays, CalendarCheck, Play, X } from 'lucide-react'
import { applyThemeToDocument } from '@/lib/applyTheme'
import type { TrailSession, TrailSessionDetail, TrailTag } from '@/types/studyTrail'
import MapView, { ZOOM_MIN, ZOOM_MAX, pickControlSide, CTRL_W } from './MapView'
import ThreadsView from './ThreadsView'
import TrailSearchView from './TrailSearchView'
import EverythingView from './EverythingView'
import TrailMapHeader from './TrailMapHeader'
import TrailHoverCard from './TrailHoverCard'
import SessionHoverContent from './SessionHoverContent'
import { DEFAULT_REVISIT_WINDOW_MS } from './trailTime'
import {
  readTrailWindowPrefs, setTrailWindowPrefs, EVERYTHING_SCROLL_KEY,
  TRAIL_ZOOM_MIN, TRAIL_ZOOM_MAX, type TrailHeaderPos,
} from './trailWindowPrefs'
import {
  IconButton, Toolbar, Button, SegmentedControl, ListRow, Chip, TextField, Checkbox,
  MenuSurface, MenuItem, MenuSeparator, MenuLabel, SectionLabel, ActionPillGroup, cx,
} from '@/components/ui'

// 'review' is gone — it was a per-session recap list that Michael said outright he wouldn't use.
// Threads answers "what have I been chasing across sessions"; Search covers every stop, jump,
// note and session in the trail. See ThreadsView.tsx / TrailSearchView.tsx.
type MainTab = 'map' | 'threads' | 'search'
const MAIN_TABS: MainTab[] = ['map', 'threads', 'search']
const isMainTab = (v: unknown): v is MainTab => MAIN_TABS.includes(v as MainTab)

// Remembered across window close/reopen (see trailWindowPrefs.ts). null = "first run", so the
// existing live-session auto-select still runs; a stored object means the user had an explicit
// view open last time and we restore it instead.
const storedWindowPrefs = readTrailWindowPrefs()
const clampZoom = (z: number) => Math.min(TRAIL_ZOOM_MAX, Math.max(TRAIL_ZOOM_MIN, z))

// 6am-6am "day" bucketing for the session-rail calendar redesign — a session started at 1am
// belongs to the PREVIOUS day's timeline, matching how the day-view itself is framed (6am to
// 6am, not midnight to midnight). Deliberately a fixed 6am cutoff, not the app's own sunset-
// aware daily-note anchor (EverythingView's dayKeyFor) — the user's own ask specified "6am-6am"
// literally, not "whenever the daily note rolls over."
const DAY_VIEW_START_HOUR = 6
function dayKeyFor(ms: number): string {
  const d = new Date(ms - DAY_VIEW_START_HOUR * 3_600_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7) // "YYYY-MM"
}
/** The real Date this dayKey's 6am window STARTS at (local time). */
function dayKeyToStart(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y, m - 1, d, DAY_VIEW_START_HOUR, 0, 0, 0)
}
// Abbreviated ("Sep 2026", not "September 2026") per feedback on the calendar's visual refresh
// ("abbreviate the names") — frees up room for the larger text used throughout that redesign.
function fmtMonthHeading(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  const sameYear = y === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short' } : { month: 'short', year: 'numeric' })
}
function fmtDayHeading(dayKey: string): string {
  const start = dayKeyToStart(dayKey)
  const todayKey = dayKeyFor(Date.now())
  const yesterdayKey = dayKeyFor(Date.now() - 86_400_000)
  if (dayKey === todayKey) return 'Today'
  if (dayKey === yesterdayKey) return 'Yesterday'
  const sameYear = start.getFullYear() === new Date().getFullYear()
  return start.toLocaleDateString([], sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtLastUsed(ms: number): string {
  const diff = Date.now() - ms
  const min = diff / 60_000
  if (min < 1) return 'just now'
  if (min < 60) return `${Math.round(min)}m ago`
  const hr = min / 60
  if (hr < 24) return `${Math.round(hr)}h ago`
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

// The Study Trail window's React root. Session rail + a Map (default) / Review toggle in the
// title bar, mirroring the plan's Phase 2 layout. Live-refresh is a 2s poll while a session is
// selected — no push channel yet (see the plan's "studyTrail:newEvent" — deferred), so this
// stays an honest v1 rather than a fake "live" claim.
export default function StudyTrailApp() {
  const [sessions, setSessions] = useState<TrailSession[]>([])
  // Restored from the previous window session (trailWindowPrefs). selectedId is reconciled
  // against the real sessions list once it loads (see the reconcile effect below) — a stored
  // id whose session is gone falls back to null ("Everything").
  const [selectedId, setSelectedId] = useState<string | null>(storedWindowPrefs?.selectedId ?? null)
  const [detail, setDetail] = useState<TrailSessionDetail | null>(null)
  const [newName, setNewName] = useState('')
  // A stored 'review' from a previous version falls back to the map rather than to a tab that
  // no longer exists.
  const [mainTab, setMainTab] = useState<MainTab>(isMainTab(storedWindowPrefs?.mainTab) ? storedWindowPrefs!.mainTab as MainTab : 'map')
  const currentTrailSessionId = useStudyTrailStore((s) => s.currentTrailSessionId)
  const trailSessionStatus = useStudyTrailStore((s) => s.trailSessionStatus)
  const startTrailSession = useStudyTrailStore((s) => s.startTrailSession)
  const pauseTrailSession = useStudyTrailStore((s) => s.pauseTrailSession)
  const resumeTrailSession = useStudyTrailStore((s) => s.resumeTrailSession)
  const endTrailSession = useStudyTrailStore((s) => s.endTrailSession)
  const deleteTrailSession = useStudyTrailStore((s) => s.deleteTrailSession)
  const deleteTrailSessions = useStudyTrailStore((s) => s.deleteTrailSessions)
  const activateExistingSession = useStudyTrailStore((s) => s.activateExistingSession)
  const splitProposal = useStudyTrailStore((s) => s.splitProposal)
  const acceptSplitProposal = useStudyTrailStore((s) => s.acceptSplitProposal)
  const clearSplitProposal = useStudyTrailStore((s) => s.clearSplitProposal)
  const [tags, setTags] = useState<TrailTag[]>([])
  const [tagEditorFor, setTagEditorFor] = useState<string | null>(null)
  const [newTagName, setNewTagName] = useState('')
  // Which tags the rail is filtered to (empty = show everything). Per direct feedback the rail
  // needs tags on sessions, and the point of tagging is being able to narrow to them afterwards.
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set())
  const [dragSessionId, setDragSessionId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // Right-click on a session row (or its name specifically) → Rename / Delete. Inline rename
  // reuses the same "swap to an input" idiom as the new-session button above.
  const [sessionCtxMenu, setSessionCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Owned here (not inside MapView) so it applies consistently in a floating pill whether
  // you're looking at one session's Map or the merged Everything timeline.
  const [zoom, setZoom] = useState(() => clampZoom(storedWindowPrefs?.zoom ?? 1))
  // Live per-side clear space around the active MapView's trail content — drives which side the
  // floating header pill and zoom pill sit on (default left; swap right if they'd cover the
  // spine/branches). Reported up from MapView / EverythingView.
  const [layoutRoom, setLayoutRoom] = useState<{ left: number; right: number }>({ left: 9999, right: 9999 })
  const headerSide = pickControlSide(layoutRoom, CTRL_W.header)
  const zoomSide = pickControlSide(layoutRoom, CTRL_W.zoom)
  // The old live current-hour badge (top-right, window-level) is gone — per direct feedback,
  // replaced by TrailTimeRail, a left-edge indicator MapView/EverythingView now render
  // themselves ("something actually on the map... on the left side"), so there's nothing left
  // for this window to own/position here.
  // Collapse-to-chip + drag-to-reposition for the floating session header — per feedback ("the
  // header block in the map is getting in the way... is there a way for it to minimize/collapse
  // and be moved around"). headerPos is null until the user actually drags it once; until then
  // the existing headerSide auto left/right placement (below) still applies.
  const [headerCollapsed, setHeaderCollapsed] = useState(() => storedWindowPrefs?.headerCollapsed ?? false)
  const [headerPos, setHeaderPos] = useState<TrailHeaderPos | null>(() => storedWindowPrefs?.headerPos ?? null)
  const headerDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  // Timeline filter, hosted here beside the session name (per direct feedback) rather than as
  // its own strip inside MapView. Cleared whenever the selected session changes.
  const [trailFilter, setTrailFilter] = useState('')
  useEffect(() => { setTrailFilter('') }, [selectedId])
  // Auto-select whatever session is actually live/paused the FIRST time we learn about it —
  // otherwise reopening the window always lands on "Everything" by default, which looked
  // exactly like "nothing got tracked while the window was closed" even though every
  // navigation was recorded correctly in the DB the whole time. Only fires once (the ref
  // guard) so deliberately switching to Everything later while a session stays live isn't
  // fought by this on every store update.
  // A view restored from trailWindowPrefs counts as "already decided" — the live-session
  // auto-select below must not yank away from it. A real deep-link (window.app.onFocusTrailSession)
  // still wins: it calls setSelectedId itself on top of this.
  const autoSelectedRef = useRef(storedWindowPrefs != null)
  // One-shot reconcile of a restored selectedId against the real sessions list.
  const reconciledRestoreRef = useRef(false)
  const restoredSelectedIdRef = useRef<string | null>(storedWindowPrefs?.selectedId ?? null)
  const sessionsLoadedRef = useRef(false)

  // Delete/clear UI — three modes, per how Michael asked for this: (1) a per-row × that needs
  // a second confirming click within a few seconds (no modal — a plain inline "Delete? Yes /
  // Cancel" swap, auto-reverts if ignored), (2) a "Select" toggle that turns each row into a
  // checkbox for a batch delete, (3) accidental/empty sessions get a one-click "Dismiss" with
  // no confirm step at all, since there's nothing real in them to lose.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmRevertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // No "New session name…" placeholder sitting there by default — just a plain "+ New
  // session" button; clicking it swaps in an empty, auto-focused input so the user is
  // immediately typing the name with nothing to clear first.
  const [creatingSession, setCreatingSession] = useState(false)
  const newSessionInputRef = useRef<HTMLInputElement>(null)

  // Session-rail redesign: a scrolling month list you pick a day from, rather than one long
  // flat session list — per feedback ("it will turn into a huge list and hard to traverse
  // through... i think instead it should be turned into this... a scrolling date thing"). Day
  // view then shows a 6am-6am timeline with each session as a positioned bar. 'Everything' and
  // the live session (if any) always stay pinned above this, unchanged.
  const [railView, setRailView] = useState<'month' | 'day'>(() => storedWindowPrefs?.railView ?? 'month')
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(() => storedWindowPrefs?.railSelectedDayKey ?? null)

  // Follow the main window's theme — same shared applyThemeToDocument ViewerApp.tsx/App.tsx/
  // FloatingShell.tsx all use. This window is a separate renderer/document, so even though
  // useAppStore's persisted theme/themePreset values are already correct on load (Electron
  // windows on the same origin share localStorage), nothing was ever calling this to actually
  // apply them to THIS document's <html> classes — every color in this window was hardcoded
  // dark-theme hex instead of the app's `rgb(var(--color-*))` tokens, so it always rendered
  // dark regardless of the real theme. Unlike ViewerApp, there's no separate "force light/dark
  // for presenting" override setting here — always follows the app.
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const glassAppearance = useAppStore((s) => s.glassAppearance)
  const askChapterJumpReason = useAppStore((s) => s.studyTrailAskChapterJumpReason)
  const setAskChapterJumpReason = useAppStore((s) => s.setStudyTrailAskChapterJumpReason)
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  useEffect(() => {
    applyThemeToDocument({
      theme, themePreset, systemIsDark, systemAccentColor,
      backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance,
    })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance])

  async function refresh() {
    const rows = await window.studyTrail.listSessions()
    sessionsLoadedRef.current = true
    setSessions(rows)
  }
  useEffect(() => { refresh() }, [])

  // Once the real sessions list has loaded, drop a restored selectedId whose session no longer
  // exists (deleted while the window was closed) — fall back to the Everything view. Only ever
  // touches the exact id we restored, never a value set since (e.g. by a deep-link).
  useEffect(() => {
    if (reconciledRestoreRef.current || !sessionsLoadedRef.current) return
    reconciledRestoreRef.current = true
    const restored = restoredSelectedIdRef.current
    if (restored != null && selectedId === restored && !sessions.some((s) => s.id === restored)) {
      setSelectedId(null)
    }
  }, [sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the current view (which session / Everything, Map vs Review, zoom) so reopening the
  // window lands back where the user left off. Scroll position is saved separately from inside
  // MapView (see trailWindowPrefs.setTrailScroll).
  useEffect(() => {
    setTrailWindowPrefs({ selectedId, mainTab, zoom, headerCollapsed, headerPos, railView, railSelectedDayKey: selectedDayKey })
  }, [selectedId, mainTab, zoom, headerCollapsed, headerPos, railView, selectedDayKey])
  useEffect(() => { installStudyTrailStateSync() }, [])
  // Keeps the session rail itself (status dot, "3m ago", possiblyAccidental) live while you
  // keep studying, not just the currently-open Map/Everything content — a slow poll as a
  // fallback safety net (the push listener below is the fast path, see broadcastDataChanged's
  // comment in electron/ipc/studyTrail.ts).
  useEffect(() => {
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [])
  // Push-based near-instant refresh — per direct feedback ("want it faster / near-instant"),
  // this fires the moment anything is actually written, rather than waiting on the poll above.
  useEffect(() => window.studyTrail.onDataChanged(() => refresh()), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Live-refresh while a session is active — the poll is a fallback safety net; onDataChanged
  // (below) is the fast path that actually makes this feel near-instant.
  useEffect(() => {
    if (!selectedId || mainTab !== 'map') { return }
    let cancelled = false
    const load = () => window.studyTrail.getSession(selectedId).then((d) => { if (!cancelled) setDetail(d) })
    load()
    const interval = setInterval(load, 2000)
    const unsub = window.studyTrail.onDataChanged((id) => { if (id === undefined || id === selectedId) load() })
    return () => { cancelled = true; clearInterval(interval); unsub?.() }
  }, [selectedId, mainTab])

  useEffect(() => {
    window.app.onFocusTrailSession?.((id) => { setSelectedId(id); setMainTab('map'); autoSelectedRef.current = true })
  }, [])

  useEffect(() => {
    if (autoSelectedRef.current) return
    // The implicit loose bucket is never individually selectable — when it's the recording
    // target (no user session), the window stays on the Everything timeline by default.
    if (currentTrailSessionId && currentTrailSessionId !== LOOSE_SESSION_ID) {
      autoSelectedRef.current = true
      setSelectedId(currentTrailSessionId)
      setMainTab('map')
    }
  }, [currentTrailSessionId])

  useEffect(() => { if (creatingSession) newSessionInputRef.current?.focus() }, [creatingSession])
  useEffect(() => { if (renamingId) renameInputRef.current?.select() }, [renamingId])
  useEffect(() => {
    if (!sessionCtxMenu) return
    const close = () => setSessionCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [sessionCtxMenu])

  const refreshTags = useCallback(() => {
    window.studyTrail.listTags().then(setTags).catch(() => {})
  }, [])
  useEffect(() => { refreshTags() }, [refreshTags])
  useEffect(() => window.studyTrail.onDataChanged(() => refreshTags()), [refreshTags])

  const tagsForSession = useCallback(
    (id: string) => tags.filter((t) => t.sessionIds.includes(id)),
    [tags],
  )

  async function toggleSessionTag(sessionId: string, tagId: string) {
    const current = tagsForSession(sessionId).map((t) => t.id)
    const next = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId]
    await window.studyTrail.setSessionTags(sessionId, next)
    refreshTags()
  }

  async function addTagToSession(sessionId: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const { id } = await window.studyTrail.createTag(trimmed)
    const current = tagsForSession(sessionId).map((t) => t.id)
    if (!current.includes(id)) await window.studyTrail.setSessionTags(sessionId, [...current, id])
    setNewTagName('')
    refreshTags()
  }

  /** Merge `fromId`'s stops into `intoId` and drop the emptied session. */
  async function mergeInto(intoId: string, fromId: string) {
    setSessionCtxMenu(null)
    await window.studyTrail.mergeSessions(intoId, fromId)
    if (selectedId === fromId) setSelectedId(intoId)
    await refresh()
  }

  /** Splits the currently-open session at a stop — everything from it onward becomes a new
   *  session, which is then selected so the result is immediately visible. */
  async function handleSplitHere(nodeId: string) {
    if (!selectedId) return
    const res = await window.studyTrail.splitSession(selectedId, nodeId)
    await refresh()
    if (res.success && res.id) setSelectedId(res.id)
  }

  /** Commits a drag-reorder of the rail. Sends the FULL ordered id list (not just the moved
   *  one) so sort_order stays dense and every row ends up hand-placed together — a partial
   *  update would leave un-placed sessions falling back to recency and jumping around. */
  async function commitReorder(draggedId: string, beforeId: string | null) {
    const ids = orderedSessions.map((s) => s.id).filter((id) => id !== draggedId)
    const at = beforeId ? ids.indexOf(beforeId) : ids.length
    ids.splice(at < 0 ? ids.length : at, 0, draggedId)
    await window.studyTrail.reorderSessions(ids)
    await refresh()
  }

  function openSessionMenu(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    setSessionCtxMenu({ id, x: e.clientX, y: e.clientY })
  }
  function startRename(id: string, currentName: string) {
    setSessionCtxMenu(null)
    setRenamingId(id)
    setRenameValue(currentName)
  }
  async function commitRename() {
    const id = renamingId
    const name = renameValue.trim()
    setRenamingId(null)
    if (!id || !name) return
    await window.studyTrail.renameSession(id, name)
    await refresh()
  }

  // Drag-to-reposition for the floating session header (see headerCollapsed/headerPos above).
  // Plain window-level mousemove/mouseup (not pointer capture) matches how this codebase already
  // handles the handful of other drag interactions in Study Trail — simple, and fine here since
  // there's exactly one drag target on screen at a time.
  function handleHeaderDragStart(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    const container = e.currentTarget.closest('[data-trail-map-viewport]') as HTMLElement | null
    const containerRect = container?.getBoundingClientRect()
    const current = headerPos ?? { x: 0, y: 0 }
    headerDragRef.current = { startX: e.clientX, startY: e.clientY, originX: current.x, originY: current.y }
    const bounds = containerRect ?? { width: window.innerWidth, height: window.innerHeight }
    function onMove(ev: MouseEvent) {
      const drag = headerDragRef.current
      if (!drag) return
      const nextX = Math.max(0, Math.min(bounds.width - 40, drag.originX + (ev.clientX - drag.startX)))
      const nextY = Math.max(0, Math.min(bounds.height - 40, drag.originY + (ev.clientY - drag.startY)))
      setHeaderPos({ x: nextX, y: nextY })
    }
    function onUp() {
      headerDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function handleStart() {
    const name = newName.trim() || 'Untitled study'
    await startTrailSession(name)
    setNewName('')
    setCreatingSession(false)
    await refresh()
    setSelectedId(useStudyTrailStore.getState().currentTrailSessionId)
    // Land on today's day-view timeline so the just-created (live, growing) session shows up
    // immediately as its own bar there — per direct feedback, a new session should show in the
    // timeline itself rather than only ever appearing as the separate pinned "live session" row
    // above the calendar until the user happens to browse to today's day view on their own.
    // Inlined rather than calling openDay() (defined further down this file) since it's just
    // these same two setters — no ordering/hoisting concerns either way, but this keeps the
    // dependency direction obvious.
    setSelectedDayKey(dayKeyFor(Date.now()))
    setRailView('day')
  }

  function requestDeleteConfirm(id: string) {
    if (confirmRevertTimer.current) clearTimeout(confirmRevertTimer.current)
    setConfirmDeleteId(id)
    confirmRevertTimer.current = setTimeout(() => setConfirmDeleteId(null), 4000)
  }
  function requestDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    requestDeleteConfirm(id)
  }
  async function confirmDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (confirmRevertTimer.current) clearTimeout(confirmRevertTimer.current)
    setConfirmDeleteId(null)
    await deleteTrailSession(id)
    if (selectedId === id) { setSelectedId(null); setDetail(null) }
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    await refresh()
  }
  function cancelDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmRevertTimer.current) clearTimeout(confirmRevertTimer.current)
    setConfirmDeleteId(null)
  }
  async function resumeEnded(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await activateExistingSession(id)
    await refresh()
    setSelectedId(id)
    setMainTab('map')
  }
  async function dismissAccidental(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await deleteTrailSession(id)
    if (selectedId === id) { setSelectedId(null); setDetail(null) }
    await refresh()
  }
  function toggleSelected(e: React.ChangeEvent<HTMLInputElement> | React.MouseEvent, id: string) {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  async function bulkDelete() {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    await deleteTrailSessions(ids)
    if (selectedId && ids.includes(selectedId)) { setSelectedId(null); setDetail(null) }
    setSelectedIds(new Set())
    setSelectMode(false)
    await refresh()
  }

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null
  // Live session pinned to top; everything else stays in stable creation order (newest
  // first) regardless of status changes — starting/pausing/ending a session must never
  // reshuffle other rows. Sorting here (rather than trusting IPC order alone) also survives
  // any timing quirk in when `refresh()` resolves relative to a pause/start pair.
  // Split out the live session (if any) so it can render pinned above the scrolling list —
  // see the sticky wrapper below. Everything else keeps the existing stable order.
  const liveSession = sessions.find((s) => s.status === 'live')
  const orderedSessions = [...sessions].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1
    if (b.status === 'live' && a.status !== 'live') return 1
    return b.createdAt - a.createdAt
  })
  // Tag filter narrows the rail (ALL selected tags must be present — an OR filter across several
  // tags just reads as "show me more", which is what no filter already does).
  const passesTagFilter = (s: TrailSession) => {
    if (tagFilter.size === 0) return true
    const own = new Set(tags.filter((t) => t.sessionIds.includes(s.id)).map((t) => t.id))
    for (const id of tagFilter) if (!own.has(id)) return false
    return true
  }
  const restSessions = (liveSession ? orderedSessions.filter((s) => s.id !== liveSession.id) : orderedSessions).filter(passesTagFilter)

  // Group restSessions into day buckets (dayKeyFor's 6am-6am scheme), then those days into
  // month buckets — the data behind both the month-scroll list and the day timeline. Ordered
  // newest-first throughout, matching restSessions' own order. A day/month with zero sessions
  // (after the tag filter) never appears at all — no empty 30-day grid to scroll past.
  const sessionsByDay = new Map<string, TrailSession[]>()
  for (const s of restSessions) {
    const key = dayKeyFor(s.createdAt)
    const list = sessionsByDay.get(key)
    if (list) list.push(s); else sessionsByDay.set(key, [s])
  }
  const dayKeysSorted = [...sessionsByDay.keys()].sort().reverse()
  const monthsSorted = [...new Set(dayKeysSorted.map(monthKeyOf))]
  const daysByMonth = new Map<string, string[]>()
  for (const dk of dayKeysSorted) {
    const mk = monthKeyOf(dk)
    const list = daysByMonth.get(mk)
    if (list) list.push(dk); else daysByMonth.set(mk, [dk])
  }
  const selectedDaySessions = selectedDayKey ? (sessionsByDay.get(selectedDayKey) ?? []) : []
  const selectedDayIdx = selectedDayKey ? dayKeysSorted.indexOf(selectedDayKey) : -1
  // dayKeysSorted is NEWEST-first, so "next day" (forward in time) is the PREVIOUS array index.
  const nextDayKey = selectedDayIdx > 0 ? dayKeysSorted[selectedDayIdx - 1] : null
  const prevDayKey = selectedDayIdx >= 0 && selectedDayIdx < dayKeysSorted.length - 1 ? dayKeysSorted[selectedDayIdx + 1] : null
  // What Select mode's flat checkbox list draws from — per feedback, "it should show what is in
  // the visible area (so if it is on a specific day, it should only be for a specific day, but
  // if the user is outside that then it should be everything)".
  const selectModeSessions = railView === 'day' && selectedDayKey ? selectedDaySessions : restSessions

  // Per feedback ("i am unable to unselect a session") — clicking an already-selected session
  // (in either the day-view bar or a plain row) now deselects it back to "Everything", instead
  // of clicking it again being a no-op. Clicking a DIFFERENT session still just selects it, same
  // as before.
  function selectSessionToggle(id: string) {
    if (selectedId === id && mainTab === 'map') { setSelectedId(null); return }
    setSelectedId(id)
    setMainTab('map')
  }

  function openDay(key: string) {
    setSelectedDayKey(key)
    setRailView('day')
  }

  // Extracted so the live session's row can render TWICE-ish — once pinned in the sticky group
  // above the scrolling list, once as a no-op skip when there isn't one — without duplicating
  // this whole block. `pinned` only affects the key/wrapper, not the row's own look.
  function renderSessionRow(s: TrailSession | undefined, pinned: boolean) {
    if (!s) return null
    const dot = (
      <span
        className={cx('w-[5px] h-[5px] rounded-full inline-block flex-shrink-0', s.status === 'live' && 'trail-live-dot')}
        style={{ background: s.status === 'live' ? 'rgb(var(--trail-cool))' : s.status === 'paused' ? 'rgb(var(--trail-warm))' : 'rgb(var(--color-text-muted))' }}
      />
    )
    // Native HTML5 drag, the same idiom TagManagerPanel / TabBar / NotesFolderView already
    // use in this app — no dnd library is a dependency and adding one for a 20-row list
    // would be out of proportion. Dropping on a row inserts BEFORE it; the drop target's own
    // top border is the insertion indicator.
    const dragProps = {
      draggable: !selectMode,
      onDragStart: (e: React.DragEvent) => { setDragSessionId(s.id); e.dataTransfer.effectAllowed = 'move' },
      onDragEnd: () => { setDragSessionId(null); setDragOverId(null) },
      onDragOver: (e: React.DragEvent) => { if (dragSessionId && dragSessionId !== s.id) { e.preventDefault(); setDragOverId(s.id) } },
      onDragLeave: () => setDragOverId((d) => (d === s.id ? null : d)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const dragged = dragSessionId
        setDragSessionId(null); setDragOverId(null)
        if (dragged && dragged !== s.id) void commitReorder(dragged, s.id)
      },
      onContextMenu: (e: React.MouseEvent) => openSessionMenu(e, s.id),
      style: {
        borderTop: dragOverId === s.id ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
        opacity: dragSessionId === s.id ? 0.45 : undefined,
      } as React.CSSProperties,
    }
    // Renaming swaps the whole row for a plain TextField in place — ListRow's title lives
    // inside a real <button>, and nesting a text input inside a button isn't valid markup.
    if (renamingId === s.id) {
      return (
        <div key={pinned ? `pinned:${s.id}` : s.id} className="flex items-center gap-2 px-2.5 py-1" {...dragProps}>
          {dot}
          <TextField
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setRenamingId(null)
            }}
            onBlur={commitRename}
            wrapperClassName="flex-1"
          />
        </div>
      )
    }
    const alwaysShowTrailing = selectMode || s.possiblyAccidental || s.status === 'ended' || confirmDeleteId === s.id
    return (
      <ListRow
        key={pinned ? `pinned:${s.id}` : s.id}
        {...dragProps}
        onClick={() => { if (selectMode) { toggleSelected({} as React.MouseEvent, s.id) } else { selectSessionToggle(s.id) } }}
        selected={selectedId === s.id && mainTab === 'map' && !selectMode}
        leading={dot}
        title={s.name}
        subtitle={
          <span className="flex items-center gap-1.5">
            <span>{s.status} · {fmtLastUsed(s.updatedAt)}</span>
            {tagsForSession(s.id).map((t) => (
              <Chip key={t.id} static size="sm">{t.name}</Chip>
            ))}
          </span>
        }
        trailing={selectMode ? (
          <Checkbox checked={selectedIds.has(s.id)} onChange={(e) => toggleSelected(e, s.id)} onClick={(e) => e.stopPropagation()} />
        ) : (
          confirmDeleteId === s.id ? (
            <span className="flex items-center gap-1">
              <Button variant="destructive" size="sm" onClick={(e) => confirmDelete(e, s.id)}>Delete</Button>
              <Button variant="secondary" size="sm" onClick={cancelDelete}>Cancel</Button>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              {s.possiblyAccidental && (
                <Button variant="ghost" size="sm" onClick={(e) => dismissAccidental(e, s.id)} title="Empty/accidental session — dismiss without confirming">Dismiss</Button>
              )}
              {s.status === 'ended' && !s.possiblyAccidental && (
                <Button variant="ghost" size="sm" icon={Play} onClick={(e) => resumeEnded(e, s.id)} title="Pick this session back up — pauses whatever's currently active">Resume</Button>
              )}
              <IconButton icon={X} label="Delete this session" size={20} danger onClick={(e) => requestDelete(e, s.id)} tooltip={false} />
            </span>
          )
        )}
        trailingAlways={alwaysShowTrailing}
      />
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif',
      background: 'rgb(var(--color-surface-1))', color: 'rgb(var(--color-text-primary))',
    }}>
      {/* Slow, low-amplitude breathe on the live-session dot — a small indicator like this
          reads better as a gentle pulse than a sharp blink. */}
      <style>{`
        @keyframes trail-live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .trail-live-dot { animation: trail-live-pulse 2s ease-in-out infinite; }
      `}</style>
      {/* Title bar — the whole strip is a drag region (titleBarStyle: 'hiddenInset' on this
          BrowserWindow gives no native drag handling beyond the tiny traffic-light inset area
          itself, so without an explicit -webkit-app-region: drag somewhere the window couldn't
          be dragged at all); every primitive button/field/segmented-control below already bakes
          in 'no-drag' so they keep receiving clicks normally. Left padding clears the macOS
          traffic lights, same 78px ViewerApp.tsx uses for the same trafficLightPosition. */}
      <Toolbar
        size="md"
        style={{ paddingLeft: 78, WebkitAppRegion: 'drag', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
      >
        <span className="text-subhead font-semibold mr-2.5">Study Trail</span>
        {/* REMOVED: the persistent "paused" pill. Per direct feedback, "pausing a session doesnt
            pause everything" — recording continues into the loose-stops bucket whenever no user
            session is live, so a window-level banner claiming the Study Trail as a whole was
            paused was simply untrue. Each session row in the rail still shows its own status,
            which is the accurate scope for that fact. */}
        <SegmentedControl
          aria-label="View"
          value={mainTab}
          onChange={setMainTab}
          options={MAIN_TABS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
        />
        <div className="flex-1" />
        {/* Opt-in "ask why I jumped chapters" arrival prompt (StudyTrailArrivalPrompt.tsx,
            mounted in the main Bible-reader window) — off by default since it's an
            interruption. Setting lives on the shared useAppStore (see
            setStudyTrailAskChapterJumpReason), so it's a real persisted preference, not
            session-local state, and syncs to the main window via the same localStorage
            persist theme/wordReplacer already rely on. */}
        <Button
          variant="secondary"
          selected={askChapterJumpReason}
          onClick={() => setAskChapterJumpReason(!askChapterJumpReason)}
          title="Ask why you jumped chapters — a dismissible prompt appears in the main window on tier-2/3 chapter jumps"
        >
          Ask why?
        </Button>
        {selectedSession && selectedSession.id === currentTrailSessionId && (
          <>
            <Button
              variant="secondary"
              onClick={() => (trailSessionStatus === 'live' ? pauseTrailSession() : resumeTrailSession())}
            >
              {trailSessionStatus === 'live' ? 'Pause' : 'Resume'}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => { await endTrailSession(); await refresh() }}
              title="End this session — it stops recording and moves to 'ended'"
            >
              End
            </Button>
          </>
        )}
      </Toolbar>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Session rail */}
        <div style={{ position: 'relative', width: 220, borderRight: '1px solid rgb(var(--color-surface-4))', flexShrink: 0 }}>
          <div style={{ padding: 14, overflowY: 'auto', height: '100%' }}>
          {/* Sticky group — new-session input (when active), the month-view control row,
              Everything, and the live session (if any) all stay visible while scrolling a long
              session list. Per direct feedback: "the new session, everything, and the live
              session should all be pinned at the top of the session bar so that when scrolling
              in the sessions they can still be seen." Negative top/margin compensates for this
              rail's own 14px padding so the sticky group's background reaches the true
              scroll-container edge with no gap. */}
          {/* Per feedback ("the background for the months/plus/select should be translucent so
              i can still see the timeline in the background... it shouldnt be black") — the
              OUTER sticky wrapper itself must stay background-less now; the opaque backdrop
              moved to an INNER wrapper around just the Everything/live-session block below.
              The day-view button row (further down) is a sibling of that inner wrapper, not
              nested inside it, so its own per-button translucent backgrounds actually show the
              scrolling timeline through them once this whole sticky group reaches the top and
              the timeline scrolls underneath it — they were previously nested INSIDE the opaque
              wrapper, so their translucency only ever blended with that solid backdrop (which
              reads as near-black in a dark theme) instead of the timeline. */}
          <div style={{ position: 'sticky', top: -14, marginTop: -14, paddingTop: 14, zIndex: 2 }}>
          <div style={{ background: 'rgb(var(--color-surface-1))' }}>
          {/* Month view (or select mode, which uses the same flat-list layout): +/select sit
              inline in their own row, not floating — per feedback ("on the months page, those
              buttons should be inline on their own row"). Day view's own floating version is
              rendered further down, under that view's date heading. Icon-only, no "Sessions"/
              "Select" text labels, per the earlier feedback that removed those. */}
          {railView !== 'day' && (
            <div className="flex items-center gap-1.5 mb-2">
              <IconButton icon={Plus} label="New session" size={24} active onClick={() => setCreatingSession(true)} />
              <span className="flex-1" />
              {sessions.length > 0 && (
                <IconButton
                  icon={ListChecks} label={selectMode ? 'Cancel selecting' : 'Select multiple to delete'} size={24}
                  active={selectMode}
                  onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()) }}
                />
              )}
            </div>
          )}
          {selectMode && selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" className="w-full mb-2" onClick={bulkDelete}>
              Delete {selectedIds.size} session{selectedIds.size === 1 ? '' : 's'}
            </Button>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2.5">
              {tags.map((t) => {
                const on = tagFilter.has(t.id)
                return (
                  <Chip
                    key={t.id}
                    selected={on}
                    count={t.sessionIds.length}
                    onClick={() => setTagFilter((prev) => {
                      const next = new Set(prev)
                      if (next.has(t.id)) next.delete(t.id)
                      else next.add(t.id)
                      return next
                    })}
                  >{t.name}</Chip>
                )
              })}
            </div>
          )}
          {/* "Everything" — the default (selectedId starts null): not in any particular
              session, just show what's been tracked across all of them. Pinned above the
              individual session list, same idea as the plan's "Sessions/Everything toggle". */}
          <ListRow
            onClick={() => { setSelectedId(null); setMainTab('map') }}
            current={selectedId === null && mainTab === 'map'}
            className="border border-dashed border-separator mb-1.5"
            title="Everything"
            subtitle="every session, all at once"
          />
          {/* The name-input and the live session's own row now share this ONE slot right below
              Everything, instead of the input living in a separate spot near the +/Select
              buttons above and just vanishing once you hit Enter — per direct feedback, typing
              the name belongs "in the block right below Everything... not a separate thing that
              then goes away." Confirming (Enter → handleStart) makes creatingSession false and
              liveSession non-null on the very next render, so this slot morphs straight from the
              input into that session's real row in place, rather than the input disappearing and
              a same-looking-but-different block popping in somewhere else. */}
          {creatingSession ? (
            <TextField
              ref={newSessionInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleStart()
                else if (e.key === 'Escape') { setCreatingSession(false); setNewName('') }
              }}
              onBlur={() => { if (!newName.trim()) setCreatingSession(false) }}
              placeholder="New session name…"
            />
          ) : renderSessionRow(liveSession, true)}
          </div>
          {/* Day view's date/nav + Months/+/Select — per feedback ("the day and the buttons
              should be floating below the everything button"), this now lives in the SAME
              pinned/sticky group as Everything and the live session above, rather than being
              its own separately-sticky element fighting them for the same top:0 spot. Each
              button gets its OWN translucent pill background now, not one shared band. */}
          {railView === 'day' && selectedDayKey && (
            <div className="mt-1.5">
              <div className="flex items-center gap-1 mb-1.5">
                {/* text-shadow (not a background pill) keeps this legible over whatever
                    scrolls underneath without turning the translucent-background request
                    into another opaque box. */}
                <div className="text-subhead font-semibold flex-1 truncate" style={{ textShadow: '0 1px 4px rgb(var(--color-surface-1))' }}>
                  {fmtDayHeading(selectedDayKey)}
                </div>
                <ActionPillGroup>
                  {selectedDayKey !== dayKeyFor(Date.now()) && (
                    <IconButton icon={CalendarCheck} label="Jump to today" size={20} onClick={() => setSelectedDayKey(dayKeyFor(Date.now()))} />
                  )}
                  <IconButton icon={ChevronLeft} label="Earlier day" size={20} disabled={!prevDayKey} onClick={() => prevDayKey && setSelectedDayKey(prevDayKey)} />
                  <IconButton icon={ChevronRight} label="Later day" size={20} disabled={!nextDayKey} onClick={() => nextDayKey && setSelectedDayKey(nextDayKey)} />
                </ActionPillGroup>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" icon={CalendarDays} onClick={() => setRailView('month')} title="Back to the month calendar">Months</Button>
                <span className="flex-1" />
                <IconButton icon={Plus} label="New session" size={24} active onClick={() => setCreatingSession(true)} />
                {sessions.length > 0 && (
                  <IconButton
                    icon={ListChecks} label={selectMode ? 'Cancel selecting' : 'Select multiple to delete'} size={24}
                    active={selectMode}
                    onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()) }}
                  />
                )}
              </div>
            </div>
          )}
          </div>
          {sessions.length === 0 && <div className="text-footnote text-text-muted">No sessions yet — start one above.</div>}
          {sessions.length > 0 && restSessions.length === 0 && tagFilter.size > 0 && (
            <div className="text-footnote text-text-muted">No sessions with those tags.</div>
          )}
          {restSessions.length === 0 && tagFilter.size === 0 && sessions.length > 0 && (
            <div className="text-footnote text-text-muted">No past sessions yet.</div>
          )}
          {/* Select mode (bulk delete) deliberately keeps the OLD flat, checkbox-per-row list —
              a spatial calendar/timeline has no natural place for a checkbox, and bulk-cleanup
              is an occasional maintenance action orthogonal to day-to-day browsing, not
              something that needs the calendar's own affordances. Normal browsing (below) is
              the new month/day calendar. Per feedback, the list it selects FROM matches what
              was visible when select mode was turned on: on a specific day, just that day's
              sessions; otherwise (month view), everything. */}
          {selectMode && selectModeSessions.map((s) => renderSessionRow(s, false))}
          {/* Month-scroll list — replaces the old flat, ever-growing session list. Per feedback:
              "it will turn into a huge list and hard to traverse... a scrolling date thing, the
              user can scroll through the months... then click on one of the days." Empty days/
              months (after the tag filter) never render at all. */}
          {!selectMode && restSessions.length > 0 && railView === 'month' && monthsSorted.map((mk) => (
            <div key={mk} className="mb-4">
              <SectionLabel className="mb-1">{fmtMonthHeading(mk)}</SectionLabel>
              {(daysByMonth.get(mk) ?? []).map((dk) => {
                const daySessions = sessionsByDay.get(dk) ?? []
                return (
                  <ListRow
                    key={dk}
                    onClick={() => openDay(dk)}
                    title={fmtDayHeading(dk)}
                    meta={`${daySessions.length} session${daySessions.length === 1 ? '' : 's'}`}
                  />
                )
              })}
            </div>
          ))}
          {/* Day view — a 6am-6am timeline with each session for that day as a positioned bar,
              spanning createdAt→updatedAt (clipped to the window). A live/still-updating
              session's bar grows on its own as `sessions` keeps refreshing (see the existing
              2s poll above) — no separate timer needed here. */}
          {/* Gated only on railView/selectedDayKey (not !selectMode) — the header (date, nav
              arrows, and the floating Months/+/Select band) must stay reachable even while
              select mode's flat list (rendered separately above) is what's actually showing, so
              select mode can still be turned off from here. Only the timeline drawing itself is
              swapped out for that flat list. */}
          {railView === 'day' && selectedDayKey && (() => {
            const PX_PER_MIN = 0.9 // modest bump alongside the rest of the calendar's larger text
            const winStart = dayKeyToStart(selectedDayKey).getTime()
            const winEnd = winStart + 24 * 3_600_000
            const totalHeight = 24 * 60 * PX_PER_MIN
            // selectedDaySessions is built from restSessions, which deliberately EXCLUDES the
            // live session (it's pinned separately above, and selectModeSessions also reads
            // selectedDaySessions — a live session showing up as bulk-delete-selectable there
            // would be wrong). But per direct feedback, creating a new session should show it as
            // a bar on TODAY'S timeline right away, not only as that separate pinned block — so
            // just for this display list, fold it back in when it belongs to the day being
            // shown, without touching selectedDaySessions/restSessions themselves.
            const daySessions = [
              ...selectedDaySessions,
              ...(liveSession && dayKeyFor(liveSession.createdAt) === selectedDayKey && passesTagFilter(liveSession) ? [liveSession] : []),
            ].sort((a, b) => a.createdAt - b.createdAt)
            // Per feedback ("make sure to not show sessions intersecting each other on the
            // timeline... that shouldnt be possible") — only one session can ever actually be
            // live/recording at a time, so two sessions overlapping on this timeline can only
            // mean `updatedAt` (bumped by ANY edit — a rename, a tag change — not just active
            // recording) makes an already-inactive session's raw span look like it reaches
            // further than it really did. Clip each session's displayed end to the NEXT
            // session's start (chronologically), so a bar can never visually reach into where
            // the next one begins, regardless of what its own updatedAt claims.
            const endFor = new Map<string, number>()
            for (let i = 0; i < daySessions.length; i++) {
              const s = daySessions[i]
              const next = daySessions[i + 1]
              const rawEnd = Math.max(s.updatedAt, s.createdAt)
              endFor.set(s.id, next ? Math.min(rawEnd, next.createdAt) : rawEnd)
            }
            // Lane-packing is now just a defensive fallback (ties on the same createdAt, or
            // otherwise-inconsistent data) — the clip above already makes real overlap
            // impossible in the normal case, so this should almost always resolve to 1 lane.
            const laneEndTimes: number[] = []
            const laneOf = new Map<string, number>()
            for (const s of daySessions) {
              let lane = laneEndTimes.findIndex((endT) => endT <= s.createdAt)
              if (lane === -1) { lane = laneEndTimes.length; laneEndTimes.push(0) }
              laneEndTimes[lane] = endFor.get(s.id)!
              laneOf.set(s.id, lane)
            }
            const laneCount = Math.max(1, laneEndTimes.length)
            return (
              <div>
                {!selectMode && (
                <div style={{ position: 'relative', height: totalHeight, marginLeft: 38 }}>
                  {/* Hour ticks every 3 hours (6am, 9am, noon, 3pm, 6pm, 9pm, midnight, 3am) —
                      enough to orient without crowding a 1080px-tall column. */}
                  {Array.from({ length: 8 }, (_, i) => i * 3).map((h) => {
                    const t = new Date(winStart + h * 3_600_000)
                    return (
                      <div key={h} style={{ position: 'absolute', top: h * 60 * PX_PER_MIN, left: -38, width: 34, fontSize: 9, color: 'rgb(var(--color-text-muted))', textAlign: 'right' }}>
                        {t.toLocaleTimeString([], { hour: 'numeric' })}
                        <span style={{ display: 'inline-block', width: 4, height: 1, background: 'rgb(var(--color-surface-4))', marginLeft: 3, verticalAlign: 'middle' }} />
                      </div>
                    )
                  })}
                  {daySessions.map((s) => {
                    const clipStart = Math.max(s.createdAt, winStart)
                    const clipEnd = Math.min(endFor.get(s.id)!, winEnd)
                    const top = (clipStart - winStart) / 60_000 * PX_PER_MIN
                    const height = Math.max(16, (clipEnd - clipStart) / 60_000 * PX_PER_MIN)
                    const lane = laneOf.get(s.id) ?? 0
                    const selected = selectedId === s.id && mainTab === 'map'
                    const color = s.status === 'live' ? 'rgb(var(--trail-cool))' : s.status === 'paused' ? 'rgb(var(--trail-warm))' : 'rgb(var(--color-text-secondary))'
                    return renamingId === s.id ? (
                      <div key={s.id} style={{ position: 'absolute', top, height, left: `${(lane / laneCount) * 100}%`, width: `calc(${100 / laneCount}% - 4px)` }}>
                        <TextField
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenamingId(null) }}
                          onBlur={commitRename}
                          className="font-semibold h-full"
                        />
                      </div>
                    ) : (
                      // Per feedback ("show some hover thing... like some details" — and "i
                      // dont want a plain browser tooltip"): TrailHoverCard (the same rich
                      // hover-card component the map already uses) replaces the old plain
                      // title= tooltip here.
                      <TrailHoverCard key={s.id} content={<SessionHoverContent session={s} tags={tagsForSession(s.id)} />}>
                      <div
                        onClick={() => selectSessionToggle(s.id)}
                        onDoubleClick={() => startRename(s.id, s.name)}
                        onContextMenu={(e) => openSessionMenu(e, s.id)}
                        style={{
                          position: 'absolute', top, height, left: `${(lane / laneCount) * 100}%`, width: `calc(${100 / laneCount}% - 4px)`,
                          borderRadius: 6, cursor: 'pointer', overflow: 'hidden', padding: '2px 6px',
                          background: selected ? 'rgb(var(--color-accent) / 0.22)' : `${color}1f`,
                          borderLeft: `3px solid ${color}`,
                          boxShadow: selected ? '0 0 0 1px rgb(var(--color-accent))' : undefined,
                        }}
                      >
                        <div className="text-caption" style={{ fontWeight: 600, color: 'rgb(var(--color-text-primary))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.name}
                        </div>
                        {height >= 30 && (
                          <div className="text-caption2" style={{ color: 'rgb(var(--color-text-muted))' }}>
                            {new Date(s.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                      </TrailHoverCard>
                    )
                  })}
                </div>
                )}
              </div>
            )
          })()}
          </div>
        </div>

        {sessionCtxMenu && (() => {
          const s = sessions.find((x) => x.id === sessionCtxMenu.id)
          if (!s) return null
          return (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: sessionCtxMenu.y, left: sessionCtxMenu.x, zIndex: 'var(--z-menu)' as unknown as number }}>
              <MenuSurface className="min-w-[160px]">
                <MenuItem label="Rename" onClick={() => startRename(s.id, s.name)} />
                <MenuItem label="Tags…" onClick={() => { setSessionCtxMenu(null); setTagEditorFor(s.id) }} />
                {/* Merge is one-way and irreversible, so it names the target explicitly rather than
                    offering a vague "merge" that could go either direction. Splitting back apart
                    afterwards is possible (right-click a stop on the map), which is what makes this
                    safe enough to offer without a confirmation step. */}
                {sessions.length > 1 && (
                  <>
                    <MenuSeparator />
                    <MenuLabel>Merge into</MenuLabel>
                    <div className="max-h-40 overflow-y-auto">
                      {sessions.filter((o) => o.id !== s.id).map((o) => (
                        <MenuItem key={o.id} label={o.name} onClick={() => mergeInto(o.id, s.id)} />
                      ))}
                    </div>
                  </>
                )}
                <MenuSeparator />
                <MenuItem danger label="Delete" onClick={() => { setSessionCtxMenu(null); requestDeleteConfirm(s.id) }} />
              </MenuSurface>
            </div>
          )
        })()}

        {/* Tag editor for one session — a plain checklist of every existing tag plus a "type a
            new one" field, mirroring how verse tags are picked elsewhere in the app. */}
        {tagEditorFor && (() => {
          const s = sessions.find((x) => x.id === tagEditorFor)
          if (!s) return null
          const own = new Set(tagsForSession(s.id).map((t) => t.id))
          return (
            <div
              onClick={(e) => e.stopPropagation()}
              className="fixed inset-0 z-critical flex items-center justify-center bg-black/20"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setTagEditorFor(null) }}
            >
              <div className="w-[300px] max-h-[70vh] overflow-y-auto p-3.5 material-elevated rounded-sheet">
                <div className="text-subhead font-semibold mb-0.5">Tags</div>
                <div className="text-footnote text-text-muted mb-2.5">{s.name}</div>
                {tags.length === 0 && <div className="text-footnote text-text-muted mb-2">No tags yet.</div>}
                {tags.map((t) => (
                  <Checkbox
                    key={t.id}
                    className="w-full py-1"
                    checked={own.has(t.id)}
                    onChange={() => toggleSessionTag(s.id, t.id)}
                    label={
                      <span className="flex items-center w-full" style={{ color: t.color ?? undefined }}>
                        {t.name}
                        <span className="flex-1" />
                        <span className="text-caption2 text-text-muted">{t.sessionIds.length}</span>
                      </span>
                    }
                  />
                ))}
                <TextField
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addTagToSession(s.id, newTagName) }}
                  placeholder="New tag…"
                  wrapperClassName="mt-2.5"
                />
                <Button variant="secondary" className="w-full mt-2.5" onClick={() => setTagEditorFor(null)}>Done</Button>
              </div>
            </div>
          )
        })()}

        {/* Main pane — flex column + overflow:hidden (not auto) so THIS div never scrolls
            itself; MapView's own internal scroll container is the single source of truth for
            scrolling (see its own comment) — a second, ALSO-scrollable ancestor here meant
            MapView's onScroll/checkAtBottom (and the "Latest" button it drives) rarely fired,
            since the browser let this outer div do the scrolling in practice instead. */}
        <div style={{ flex: 1, padding: '16px 20px 16px 10px', overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* This div is what actually fills the remaining height and hands MapView a real
              bounded ancestor to scroll within — see the "Main pane" comment above. Threads and
              Search own their scrolling internally, so they get overflow:hidden here. */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Banner fallback for a session-split proposal — per direct feedback, "both: toast now,
              banner as fallback." The toast in the main window auto-dismisses to "keep current";
              this stays put until it's answered, so a proposal raised while you were reading is
              still actionable next time you look at the trail. */}
          {splitProposal && (
            <div className="flex items-center gap-2.5 mb-2.5 px-2.5 py-1.5 rounded-card bg-accent-muted border border-accent/35">
              <Scissors size={13} className="text-accent flex-shrink-0" />
              <span className="text-footnote text-text-secondary flex-1">
                Split here into a new trail — {splitProposal.reason}?
              </span>
              <Button variant="ghost" selected size="sm" onClick={() => { void acceptSplitProposal().then(refresh) }}>Split</Button>
              <Button variant="secondary" size="sm" onClick={clearSplitProposal}>Dismiss</Button>
            </div>
          )}
          {mainTab === 'threads' ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Opening a session from Threads or Search jumps straight back to the map with it
                  selected — the two tabs are ways IN to the map, not dead ends. */}
              <ThreadsView onOpenSession={(id) => { setSelectedId(id); setMainTab('map') }} />
            </div>
          ) : mainTab === 'search' ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <TrailSearchView onOpenSession={(id) => { setSelectedId(id); setMainTab('map') }} />
            </div>
          ) : selectedId === null ? (
            <EverythingView
              sessions={sessions} zoom={zoom} onZoomChange={setZoom} revisitWindowMs={DEFAULT_REVISIT_WINDOW_MS}
              onLayoutRoomChange={setLayoutRoom} layoutRoom={layoutRoom}
              headerCollapsed={headerCollapsed} onToggleHeaderCollapsed={() => setHeaderCollapsed((c) => !c)}
              headerPos={headerPos} onHeaderDragStart={handleHeaderDragStart}
            />
          ) : !detail ? (
            <div className="text-body text-text-muted">Loading…</div>
          ) : (
            <div data-trail-map-viewport style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Floating session header — a small shrink-wrapped pill (name + filter + stats).
                  NOT a full-width strip. Defaults to the top-LEFT (per direct feedback "put it
                  back on the left"); flips to the top-right only when the trail's spine/branches
                  would sit under it there (headerSide, from the measured layoutRoom) — unless the
                  user has dragged it to an explicit spot (headerPos), which always wins. The
                  trail scrolls under it. Collapse/drag handled by the shared TrailMapHeader. */}
              <TrailMapHeader
                side={headerSide}
                collapsed={headerCollapsed}
                onToggleCollapsed={() => setHeaderCollapsed((c) => !c)}
                pos={headerPos}
                onDragStart={handleHeaderDragStart}
                title={
                  renamingId === detail.session.id ? (
                    <TextField
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        else if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={commitRename}
                      className="text-title3 font-semibold"
                      wrapperClassName="block w-full"
                    />
                  ) : (
                    <h2
                      onDoubleClick={() => startRename(detail.session.id, detail.session.name)}
                      onContextMenu={(e) => openSessionMenu(e, detail.session.id)}
                      title="Double-click or right-click to rename"
                      className="m-0 text-title3 font-semibold cursor-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                    >{detail.session.name}</h2>
                  )
                }
                filterValue={trailFilter}
                onFilterChange={setTrailFilter}
                statsLine={<>{detail.nodes.length} chapter stop{detail.nodes.length === 1 ? '' : 's'} · {detail.connections.length} connection{detail.connections.length === 1 ? '' : 's'}</>}
              />
              <div style={{ flex: 1, minHeight: 0 }}>
                <MapView
                  detail={detail}
                  onChanged={() => window.studyTrail.getSession(detail.session.id).then((d) => d && setDetail(d))}
                  scrollKey={selectedId ?? EVERYTHING_SCROLL_KEY}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  revisitWindowMs={DEFAULT_REVISIT_WINDOW_MS}
                  filterValue={trailFilter}
                  onFilterChange={setTrailFilter}
                  topInset={8}
                  onLayoutRoomChange={setLayoutRoom}
                  onSplitHere={handleSplitHere}
                />
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
      {/* Floating zoom pill, bottom-right — per the plan: moved here from the title bar
          ("put the zoom ... to actually be a floating pill at the bottom right of the
          window"). Only shown on the Map tab (Review doesn't use MapView, so it means
          nothing there). The "revisit within" slider that used to live alongside this was
          removed per direct feedback (useless UI, nobody adjusted it) — the revisit window
          is now just DEFAULT_REVISIT_WINDOW_MS (see trailTime.ts), no control needed. */}
      {mainTab === 'map' && (
        <div
          className={cx('fixed bottom-5 flex flex-col gap-2', zoomSide === 'left' ? 'items-start' : 'items-end')}
          // Same side as MapView's Recenter/Latest cluster (both decided from `layoutRoom` with
          // CTRL_W.zoom); on the left, `left: 240` clears the 220px session rail.
          style={{ left: zoomSide === 'left' ? 240 : undefined, right: zoomSide === 'left' ? undefined : 20 }}
        >
          <ActionPillGroup className="material-control shadow-2">
            {/* Multiplicative steps, matching the wheel — a fixed ±0.1 felt like a lurch at the
                bottom of the range and like nothing at the top. */}
            <IconButton icon={Minus} label="Zoom out" size={24} tooltip={{ shortcut: '⌘−' }} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.15))} />
            <Button variant="ghost" size="sm" className="w-12" onClick={() => setZoom(1)} title="Reset zoom (⌘0)">{Math.round(zoom * 100)}%</Button>
            <IconButton icon={Plus} label="Zoom in" size={24} tooltip={{ shortcut: '⌘+' }} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.15))} />
          </ActionPillGroup>
        </div>
      )}
    </div>
  )
}
