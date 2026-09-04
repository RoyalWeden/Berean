import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useStudyTrailStore, installStudyTrailStateSync, LOOSE_SESSION_ID } from '@/store/studyTrailSlice'
import { Scissors } from 'lucide-react'
import { applyThemeToDocument } from '@/lib/applyTheme'
import type { TrailSession, TrailSessionDetail, TrailTag } from '@/types/studyTrail'
import MapView, { ZOOM_MIN, ZOOM_MAX, pickControlSide, CTRL_W } from './MapView'
import ThreadsView from './ThreadsView'
import TrailSearchView from './TrailSearchView'
import EverythingView from './EverythingView'
import { DEFAULT_REVISIT_WINDOW_MS } from './trailTime'
import {
  readTrailWindowPrefs, setTrailWindowPrefs, EVERYTHING_SCROLL_KEY,
  TRAIL_ZOOM_MIN, TRAIL_ZOOM_MAX,
} from './trailWindowPrefs'

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
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoveredDeleteId, setHoveredDeleteId] = useState<string | null>(null)
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
  // Live clock hour of whatever's at the top of the trail — shown as a line inside the header
  // pill so there's ONE floating thing (per direct feedback the separate hour pill "i cant see").
  const [currentHour, setCurrentHour] = useState<string | null>(null)
  // Timeline filter, hosted here beside the session name (per direct feedback) rather than as
  // its own strip inside MapView. Cleared whenever the selected session changes.
  const [trailFilter, setTrailFilter] = useState('')
  useEffect(() => { setTrailFilter('') }, [selectedId])
  const ZOOM_STEP = 0.1
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
      backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity,
    })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity])

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
    setTrailWindowPrefs({ selectedId, mainTab, zoom })
  }, [selectedId, mainTab, zoom])
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

  async function handleStart() {
    const name = newName.trim() || 'Untitled study'
    await startTrailSession(name)
    setNewName('')
    setCreatingSession(false)
    await refresh()
    setSelectedId(useStudyTrailStore.getState().currentTrailSessionId)
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

  // Extracted so the live session's row can render TWICE-ish — once pinned in the sticky group
  // above the scrolling list, once as a no-op skip when there isn't one — without duplicating
  // this whole block. `pinned` only affects the key/wrapper, not the row's own look.
  function renderSessionRow(s: TrailSession | undefined, pinned: boolean) {
    if (!s) return null
    const isHovered = hoveredId === s.id
    const isXHovered = hoveredDeleteId === s.id
    return (
      <div
        key={pinned ? `pinned:${s.id}` : s.id}
        // Native HTML5 drag, the same idiom TagManagerPanel / TabBar / NotesFolderView already
        // use in this app — no dnd library is a dependency and adding one for a 20-row list
        // would be out of proportion. Dropping on a row inserts BEFORE it; the drop target's own
        // top border is the insertion indicator.
        draggable={!selectMode}
        onDragStart={(e) => { setDragSessionId(s.id); e.dataTransfer.effectAllowed = 'move' }}
        onDragEnd={() => { setDragSessionId(null); setDragOverId(null) }}
        onDragOver={(e) => { if (dragSessionId && dragSessionId !== s.id) { e.preventDefault(); setDragOverId(s.id) } }}
        onDragLeave={() => setDragOverId((d) => (d === s.id ? null : d))}
        onDrop={(e) => {
          e.preventDefault()
          const dragged = dragSessionId
          setDragSessionId(null); setDragOverId(null)
          if (dragged && dragged !== s.id) void commitReorder(dragged, s.id)
        }}
        onClick={() => { if (selectMode) { toggleSelected({} as React.MouseEvent, s.id) } else { setSelectedId(s.id); setMainTab('map') } }}
        onMouseEnter={() => setHoveredId(s.id)}
        onMouseLeave={() => setHoveredId((h) => h === s.id ? null : h)}
        onContextMenu={(e) => openSessionMenu(e, s.id)}
        style={{
          borderTop: dragOverId === s.id ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
          opacity: dragSessionId === s.id ? 0.45 : undefined,
          padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 1, display: 'flex', alignItems: 'flex-start', gap: 7,
          // Selected + hover need to layer, not pick one or the other — a selected row
          // hovered previously looked visually identical to an un-hovered selected row
          // (no feedback at all). Bump selected's own tint up a notch on hover instead
          // of falling through to the plain hover shade.
          background: selectedId === s.id && mainTab === 'map' && !selectMode
            ? isHovered ? 'rgb(var(--color-accent) / 0.22)' : 'rgb(var(--color-accent) / 0.14)'
            : isHovered ? 'rgb(var(--color-surface-3))' : 'transparent',
        }}
      >
        {selectMode && (
          <input
            type="checkbox"
            checked={selectedIds.has(s.id)}
            onChange={(e) => toggleSelected(e, s.id)}
            onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 3, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              className={s.status === 'live' ? 'trail-live-dot' : undefined}
              style={{
                width: 5, height: 5, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                background: s.status === 'live' ? '#4fc3ae' : s.status === 'paused' ? '#e08468' : 'rgb(var(--color-text-muted))',
              }}
            />
            {renamingId === s.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') setRenamingId(null)
                }}
                onBlur={commitRename}
                style={{
                  flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, background: 'rgb(var(--color-surface-1))',
                  border: '1px solid rgb(var(--color-accent))', borderRadius: 5, padding: '1px 4px', color: 'rgb(var(--color-text-primary))',
                }}
              />
            ) : (
              <span
                onContextMenu={(e) => openSessionMenu(e, s.id)}
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >{s.name}</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{s.status} · {fmtLastUsed(s.updatedAt)}</span>
            {s.possiblyAccidental && (
              <button
                onClick={(e) => dismissAccidental(e, s.id)}
                title="Empty/accidental session — dismiss without confirming"
                style={{ fontSize: 9.5, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))', border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer' }}
              >dismiss</button>
            )}
            {s.status === 'ended' && !s.possiblyAccidental && (
              <button
                onClick={(e) => resumeEnded(e, s.id)}
                title="Pick this session back up — pauses whatever's currently active"
                style={{ fontSize: 9.5, color: 'rgb(var(--color-accent))', background: 'rgb(var(--color-accent) / 0.14)', border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer' }}
              >▶ resume</button>
            )}
          </div>
          {tagsForSession(s.id).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
              {tagsForSession(s.id).map((t) => (
                <span
                  key={t.id}
                  style={{
                    fontSize: 9, padding: '0 5px', borderRadius: 999, lineHeight: '14px',
                    background: t.color ? `${t.color}22` : 'rgb(var(--color-surface-3))',
                    color: t.color ?? 'rgb(var(--color-text-muted))',
                  }}
                >{t.name}</span>
              ))}
            </div>
          )}
        </div>
        {!selectMode && (
          confirmDeleteId === s.id ? (
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                onClick={(e) => confirmDelete(e, s.id)}
                style={{ fontSize: 10, fontWeight: 700, color: '#e08468', background: 'rgba(224,132,104,0.14)', border: '1px solid rgba(224,132,104,0.4)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer' }}
              >Delete</button>
              <button
                onClick={cancelDelete}
                style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '2px 6px', cursor: 'pointer' }}
              >Cancel</button>
            </div>
          ) : (isHovered || isXHovered) ? (
            <button
              onClick={(e) => requestDelete(e, s.id)}
              onMouseEnter={() => setHoveredDeleteId(s.id)}
              onMouseLeave={() => setHoveredDeleteId((h) => h === s.id ? null : h)}
              title="Delete this session"
              style={{
                fontSize: 13, lineHeight: 1, color: isXHovered ? '#e08468' : 'rgb(var(--color-text-muted))',
                background: isXHovered ? 'rgba(224,132,104,0.14)' : 'transparent', borderRadius: 5,
                border: 'none', cursor: 'pointer', padding: '1px 5px', flexShrink: 0,
              }}
            >×</button>
          ) : (
            // Reserves the same width as the × button so rows don't jiggle horizontally
            // when the hover state toggles it in and out.
            <span style={{ width: 18, flexShrink: 0 }} />
          )
        )}
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif',
      background: 'rgb(var(--color-surface-1))', color: 'rgb(var(--color-text-primary))',
    }}>
      {/* Real :hover (not JS mouseenter/leave state) for every plain context-menu-style button
          in this window, including TrailRefContextMenu's — that one portals to document.body,
          but a global style tag still reaches it since it's just a class selector, not scoped
          to this subtree. */}
      <style>{`
        .trail-ctx-btn:hover { background: rgb(var(--color-surface-3)); }
        /* Slow, low-amplitude breathe on the live-session dot — a small indicator like this
           reads better as a gentle pulse than a sharp blink. */
        @keyframes trail-live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .trail-live-dot { animation: trail-live-pulse 2s ease-in-out infinite; }
        .trail-everything-row:not([data-selected="true"]):hover { background: rgb(var(--color-surface-3)) !important; }
        .trail-everything-row[data-selected="true"]:hover { background: rgb(var(--color-accent) / 0.22) !important; }
      `}</style>
      {/* Title bar — the whole strip is a drag region (titleBarStyle: 'hiddenInset' on this
          BrowserWindow gives no native drag handling beyond the tiny traffic-light inset area
          itself, so without an explicit -webkit-app-region: drag somewhere the window couldn't
          be dragged at all) with interactive children explicitly opted back OUT of it (a
          descendant marked 'no-drag' still receives clicks normally — otherwise every button
          here would silently stop responding to clicks, since 'drag' consumes mouse-down). Left
          padding clears the macOS traffic lights, same 78px ViewerApp.tsx uses for the same
          trafficLightPosition. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px 8px 78px',
        borderBottom: '1px solid rgb(var(--color-surface-4))', flexShrink: 0,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
        <span style={{ fontSize: 12.5, fontWeight: 700, marginRight: 10 }}>Study Trail</span>
        {/* Persistent paused indicator — visible regardless of which session is being VIEWED,
            since this reflects whether the ACTIVE (recording) session is paused, which is
            easy to lose track of once you've clicked away from it. */}
        {currentTrailSessionId && trailSessionStatus === 'paused' && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#e08468',
            background: 'rgba(224,132,104,0.14)', border: '1px solid rgba(224,132,104,0.4)', borderRadius: 999,
            padding: '2px 8px', marginRight: 10, WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}>⏸ Study Trail paused</span>
        )}
        <div style={{ display: 'flex', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, overflow: 'hidden', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {MAIN_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setMainTab(t)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '4px 12px', cursor: 'pointer', border: 'none',
                background: mainTab === t ? 'rgb(var(--color-accent) / 0.16)' : 'transparent',
                color: mainTab === t ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))', textTransform: 'capitalize',
              }}
            >{t}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {/* Opt-in "ask why I jumped chapters" arrival prompt (StudyTrailArrivalPrompt.tsx,
            mounted in the main Bible-reader window) — off by default since it's an
            interruption. Setting lives on the shared useAppStore (see
            setStudyTrailAskChapterJumpReason), so it's a real persisted preference, not
            session-local state, and syncs to the main window via the same localStorage
            persist theme/wordReplacer already rely on. */}
        <button
          onClick={() => setAskChapterJumpReason(!askChapterJumpReason)}
          title="Ask why you jumped chapters — a dismissible prompt appears in the main window on tier-2/3 chapter jumps"
          style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '4px 10px',
            cursor: 'pointer', borderRadius: 8, WebkitAppRegion: 'no-drag', marginRight: 8,
            border: `1px solid ${askChapterJumpReason ? 'rgb(var(--color-accent))' : 'rgb(var(--color-surface-4))'}`,
            background: askChapterJumpReason ? 'rgb(var(--color-accent) / 0.14)' : 'transparent',
            color: askChapterJumpReason ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
          } as React.CSSProperties}
        >
          {askChapterJumpReason ? '● ' : '○ '}Ask why?
        </button>
        {selectedSession && selectedSession.id === currentTrailSessionId && (
          <>
            <button
              onClick={() => (trailSessionStatus === 'live' ? pauseTrailSession() : resumeTrailSession())}
              style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: '4px 10px', color: 'rgb(var(--color-text-primary))', cursor: 'pointer', fontSize: 11, WebkitAppRegion: 'no-drag', marginRight: 6 } as React.CSSProperties}
            >
              {trailSessionStatus === 'live' ? '⏸ Pause' : '▶ Resume'}
            </button>
            <button
              onClick={async () => { await endTrailSession(); await refresh() }}
              title="End this session — it stops recording and moves to 'ended'"
              style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: '4px 10px', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', fontSize: 11, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              ■ End
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Session rail */}
        <div style={{ width: 220, borderRight: '1px solid rgb(var(--color-surface-4))', padding: 14, overflowY: 'auto', flexShrink: 0 }}>
          {/* Sticky group — header, new-session control, Everything, and the live session (if
              any) all stay visible while scrolling a long session list. Per direct feedback:
              "the new session, everything, and the live session should all be pinned at the
              top of the session bar so that when scrolling in the sessions they can still be
              seen." Negative top/margin compensates for this rail's own 14px padding so the
              sticky group's background reaches the true scroll-container edge with no gap. */}
          <div style={{ position: 'sticky', top: -14, marginTop: -14, paddingTop: 14, background: 'rgb(var(--color-surface-1))', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgb(var(--color-text-muted))', flex: 1 }}>
              Sessions
            </div>
            {sessions.length > 0 && (
              <button
                onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()) }}
                title={selectMode ? 'Cancel selecting' : 'Select multiple to delete'}
                style={{
                  fontSize: 10, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer',
                  color: selectMode ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))', padding: '2px 4px',
                }}
              >{selectMode ? 'Cancel' : 'Select'}</button>
            )}
          </div>
          {selectMode && selectedIds.size > 0 && (
            <button
              onClick={bulkDelete}
              style={{
                width: '100%', marginBottom: 8, fontSize: 11, fontWeight: 600, padding: '6px 8px', cursor: 'pointer',
                background: 'rgba(224,132,104,0.14)', border: '1px solid rgba(224,132,104,0.4)', borderRadius: 7, color: '#e08468',
              }}
            >Delete {selectedIds.size} session{selectedIds.size === 1 ? '' : 's'}</button>
          )}
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {tags.map((t) => {
                const on = tagFilter.has(t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => setTagFilter((prev) => {
                      const next = new Set(prev)
                      if (next.has(t.id)) next.delete(t.id)
                      else next.add(t.id)
                      return next
                    })}
                    title={`${t.sessionIds.length} session${t.sessionIds.length === 1 ? '' : 's'}`}
                    style={{
                      fontSize: 9.5, padding: '1px 7px', borderRadius: 999, cursor: 'pointer',
                      background: on ? 'rgb(var(--color-accent) / 0.18)' : 'rgb(var(--color-surface-3))',
                      border: `1px solid ${on ? 'rgb(var(--color-accent) / 0.5)' : 'transparent'}`,
                      color: on ? 'rgb(var(--color-accent))' : (t.color ?? 'rgb(var(--color-text-muted))'),
                    }}
                  >{t.name}</button>
                )
              })}
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            {creatingSession ? (
              <input
                ref={newSessionInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStart()
                  else if (e.key === 'Escape') { setCreatingSession(false); setNewName('') }
                }}
                onBlur={() => { if (!newName.trim()) setCreatingSession(false) }}
                style={{ width: '100%', background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-accent))', borderRadius: 7, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
              />
            ) : (
              <button
                onClick={() => setCreatingSession(true)}
                style={{
                  width: '100%', background: 'transparent', border: '1px dashed rgb(var(--color-surface-4))', borderRadius: 7,
                  padding: '6px 8px', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: 'rgb(var(--color-text-secondary))',
                }}
              >+ New session</button>
            )}
          </div>
          {/* "Everything" — the default (selectedId starts null): not in any particular
              session, just show what's been tracked across all of them. Pinned above the
              individual session list, same idea as the plan's "Sessions/Everything toggle". */}
          <div
            onClick={() => { setSelectedId(null); setMainTab('map') }}
            className="trail-everything-row"
            data-selected={selectedId === null && mainTab === 'map'}
            style={{
              padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 6,
              background: selectedId === null && mainTab === 'map' ? 'rgb(var(--color-accent) / 0.14)' : 'transparent',
              border: '1px dashed rgb(var(--color-surface-4))',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: selectedId === null ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-primary))' }}>
              Everything
            </div>
            <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>every session, all at once</div>
          </div>
          {renderSessionRow(liveSession, true)}
          </div>
          {restSessions.map((s) => renderSessionRow(s, false))}
          {sessions.length === 0 && <div style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))' }}>No sessions yet — start one above.</div>}
          {sessions.length > 0 && restSessions.length === 0 && tagFilter.size > 0 && (
            <div style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))' }}>No sessions with those tags.</div>
          )}
        </div>

        {sessionCtxMenu && (() => {
          const s = sessions.find((x) => x.id === sessionCtxMenu.id)
          if (!s) return null
          return (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed', top: sessionCtxMenu.y, left: sessionCtxMenu.x, zIndex: 10001, minWidth: 150,
                background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
                borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', padding: 5,
              }}
            >
              <button className="trail-ctx-btn" onClick={() => startRename(s.id, s.name)} style={sessionMenuBtnStyle}>Rename</button>
              <button className="trail-ctx-btn" onClick={() => { setSessionCtxMenu(null); setTagEditorFor(s.id) }} style={sessionMenuBtnStyle}>Tags…</button>
              {/* Merge is one-way and irreversible, so it names the target explicitly rather than
                  offering a vague "merge" that could go either direction. Splitting back apart
                  afterwards is possible (right-click a stop on the map), which is what makes this
                  safe enough to offer without a confirmation step. */}
              {sessions.length > 1 && (
                <div style={{ borderTop: '1px solid rgb(var(--color-surface-4))', marginTop: 4, paddingTop: 4 }}>
                  <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'rgb(var(--color-text-muted))', padding: '2px 8px 4px' }}>Merge into</div>
                  <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                    {sessions.filter((o) => o.id !== s.id).map((o) => (
                      <button key={o.id} className="trail-ctx-btn" onClick={() => mergeInto(o.id, s.id)} style={sessionMenuBtnStyle}>{o.name}</button>
                    ))}
                  </div>
                </div>
              )}
              <button className="trail-ctx-btn" onClick={() => { setSessionCtxMenu(null); requestDeleteConfirm(s.id) }} style={{ ...sessionMenuBtnStyle, color: '#e08468', marginTop: 4 }}>Delete</button>
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
              style={{
                position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.35)',
              }}
              onMouseDown={(e) => { if (e.target === e.currentTarget) setTagEditorFor(null) }}
            >
              <div style={{
                width: 300, maxHeight: '70vh', overflowY: 'auto', padding: 14, borderRadius: 12,
                background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
                boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Tags</div>
                <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginBottom: 10 }}>{s.name}</div>
                {tags.length === 0 && <div style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))', marginBottom: 8 }}>No tags yet.</div>}
                {tags.map((t) => (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={own.has(t.id)} onChange={() => toggleSessionTag(s.id, t.id)} />
                    <span style={{ color: t.color ?? 'rgb(var(--color-text-primary))' }}>{t.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>{t.sessionIds.length}</span>
                  </label>
                ))}
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addTagToSession(s.id, newTagName) }}
                  placeholder="New tag…"
                  style={{
                    width: '100%', marginTop: 10, fontSize: 12, padding: '5px 8px', borderRadius: 7,
                    background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))',
                    color: 'rgb(var(--color-text-primary))',
                  }}
                />
                <button
                  onClick={() => setTagEditorFor(null)}
                  style={{
                    width: '100%', marginTop: 10, fontSize: 12, fontWeight: 600, padding: '6px 8px', borderRadius: 7,
                    cursor: 'pointer', background: 'rgb(var(--color-accent) / 0.16)', border: 'none', color: 'rgb(var(--color-accent))',
                  }}
                >Done</button>
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
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '7px 10px',
              borderRadius: 9, background: 'rgb(var(--color-accent) / 0.12)',
              border: '1px solid rgb(var(--color-accent) / 0.35)',
            }}>
              <Scissors size={13} style={{ color: 'rgb(var(--color-accent))', flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: 'rgb(var(--color-text-secondary))', flex: 1 }}>
                Split here into a new trail — {splitProposal.reason}?
              </span>
              <button
                onClick={() => { void acceptSplitProposal().then(refresh) }}
                style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 7, cursor: 'pointer', background: 'rgb(var(--color-accent) / 0.2)', border: 'none', color: 'rgb(var(--color-accent))' }}
              >Split</button>
              <button
                onClick={clearSplitProposal}
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 7, cursor: 'pointer', background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', color: 'rgb(var(--color-text-muted))' }}
              >Dismiss</button>
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
            <EverythingView sessions={sessions} zoom={zoom} onZoomChange={setZoom} revisitWindowMs={DEFAULT_REVISIT_WINDOW_MS} onLayoutRoomChange={setLayoutRoom} layoutRoom={layoutRoom} onCurrentHourChange={setCurrentHour} currentHour={currentHour} />
          ) : !detail ? (
            <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Floating session header — a small shrink-wrapped pill (name + filter + stats +
                  a live current-hour line). NOT a full-width strip. Defaults to the top-LEFT
                  (per direct feedback "put it back on the left"); flips to the top-right only
                  when the trail's spine/branches would sit under it there (headerSide, from the
                  measured layoutRoom). The trail scrolls under it. */}
              <div style={{
                position: 'absolute', top: 0, zIndex: 6, width: 'fit-content', maxWidth: 260,
                ...(headerSide === 'left' ? { left: 0 } : { right: 0 }),
                display: 'flex', flexDirection: 'column', gap: 4,
                background: 'rgb(var(--color-surface-1) / 0.7)',
                backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgb(var(--color-surface-4) / 0.6)', borderRadius: 10,
                boxShadow: '0 4px 14px rgba(0,0,0,0.18)', padding: '7px 9px',
              }}>
              {renamingId === detail.session.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={commitRename}
                  style={{
                    display: 'block', fontSize: 15, fontWeight: 700, background: 'rgb(var(--color-surface-2))',
                    border: '1px solid rgb(var(--color-accent))', borderRadius: 6, padding: '2px 6px', color: 'rgb(var(--color-text-primary))',
                  }}
                />
              ) : (
                <h2
                  onDoubleClick={() => startRename(detail.session.id, detail.session.name)}
                  onContextMenu={(e) => openSessionMenu(e, detail.session.id)}
                  title="Double-click or right-click to rename"
                  style={{ margin: 0, fontSize: 15, fontWeight: 700, cursor: 'text', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >{detail.session.name}</h2>
              )}
              <input
                value={trailFilter}
                onChange={(e) => setTrailFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') window.dispatchEvent(new CustomEvent('berean:trailFilterSubmit')) }}
                placeholder="Filter timeline…"
                style={{
                  width: '100%', fontSize: 12, padding: '4px 9px', background: 'rgb(var(--color-surface-2))',
                  border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, color: 'rgb(var(--color-text-primary))',
                }}
              />
              <div style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))' }}>
                {detail.nodes.length} chapter stop{detail.nodes.length === 1 ? '' : 's'} · {detail.connections.length} connection{detail.connections.length === 1 ? '' : 's'}
              </div>
              {currentHour && (
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em', color: 'rgb(var(--color-text-muted))' }}>
                  {currentHour}
                </div>
              )}
              </div>
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
                  onCurrentHourChange={setCurrentHour}
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
        <div style={{
          position: 'fixed', bottom: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 50,
          // Same side as MapView's Recenter/Latest cluster (both decided from `layoutRoom` with
          // CTRL_W.zoom); on the left, `left: 240` clears the 220px session rail.
          ...(zoomSide === 'left' ? { left: 240, alignItems: 'flex-start' } : { right: 20, alignItems: 'flex-end' }),
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2, background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: 2,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}>
            <button onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} title="Zoom out" style={zoomBtnStyle}>−</button>
            <button onClick={() => setZoom(1)} title="Reset zoom" style={{ ...zoomBtnStyle, width: 42, fontSize: 10.5 }}>{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} title="Zoom in" style={zoomBtnStyle}>+</button>
          </div>
        </div>
      )}
    </div>
  )
}

const zoomBtnStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, width: 22, height: 22, lineHeight: '20px', textAlign: 'center',
  color: 'rgb(var(--color-text-secondary))', background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
}

const sessionMenuBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', fontSize: 12, padding: '6px 8px',
  background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
  color: 'rgb(var(--color-text-primary))',
}
