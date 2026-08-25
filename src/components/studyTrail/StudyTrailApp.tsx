import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useStudyTrailStore, installStudyTrailStateSync } from '@/store/studyTrailSlice'
import { applyThemeToDocument } from '@/lib/applyTheme'
import type { TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import MapView, { ZOOM_MIN, ZOOM_MAX } from './MapView'
import ReviewView from './ReviewView'
import EverythingView from './EverythingView'

type MainTab = 'map' | 'review'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TrailSessionDetail | null>(null)
  const [newName, setNewName] = useState('')
  const [mainTab, setMainTab] = useState<MainTab>('map')
  const currentTrailSessionId = useStudyTrailStore((s) => s.currentTrailSessionId)
  const trailSessionStatus = useStudyTrailStore((s) => s.trailSessionStatus)
  const startTrailSession = useStudyTrailStore((s) => s.startTrailSession)
  const pauseTrailSession = useStudyTrailStore((s) => s.pauseTrailSession)
  const resumeTrailSession = useStudyTrailStore((s) => s.resumeTrailSession)
  const endTrailSession = useStudyTrailStore((s) => s.endTrailSession)
  const deleteTrailSession = useStudyTrailStore((s) => s.deleteTrailSession)
  const deleteTrailSessions = useStudyTrailStore((s) => s.deleteTrailSessions)
  const activateExistingSession = useStudyTrailStore((s) => s.activateExistingSession)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoveredDeleteId, setHoveredDeleteId] = useState<string | null>(null)
  // Right-click on a session row (or its name specifically) → Rename / Delete. Inline rename
  // reuses the same "swap to an input" idiom as the new-session button above.
  const [sessionCtxMenu, setSessionCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Owned here (not inside MapView) so it applies consistently in the title bar whether
  // you're looking at one session's Map or the merged Everything timeline.
  const [zoom, setZoom] = useState(1)
  const ZOOM_STEP = 0.1
  // Auto-select whatever session is actually live/paused the FIRST time we learn about it —
  // otherwise reopening the window always lands on "Everything" by default, which looked
  // exactly like "nothing got tracked while the window was closed" even though every
  // navigation was recorded correctly in the DB the whole time. Only fires once (the ref
  // guard) so deliberately switching to Everything later while a session stays live isn't
  // fought by this on every store update.
  const autoSelectedRef = useRef(false)

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
    setSessions(rows)
  }
  useEffect(() => { refresh() }, [])
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
    if (currentTrailSessionId) {
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
  const orderedSessions = [...sessions].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1
    if (b.status === 'live' && a.status !== 'live') return 1
    return b.createdAt - a.createdAt
  })

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
          {(['map', 'review'] as const).map((t) => (
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
        {mainTab === 'map' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2, marginLeft: 8, background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: 2, WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}>
            <button onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} title="Zoom out" style={zoomBtnStyle}>−</button>
            <button onClick={() => setZoom(1)} title="Reset zoom" style={{ ...zoomBtnStyle, width: 42, fontSize: 10.5 }}>{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} title="Zoom in" style={zoomBtnStyle}>+</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Session rail */}
        <div style={{ width: 220, borderRight: '1px solid rgb(var(--color-surface-4))', padding: 14, overflowY: 'auto', flexShrink: 0 }}>
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
          {orderedSessions.map((s) => {
            const isHovered = hoveredId === s.id
            const isXHovered = hoveredDeleteId === s.id
            return (
            <div
              key={s.id}
              onClick={() => { if (selectMode) { toggleSelected({} as React.MouseEvent, s.id) } else { setSelectedId(s.id); setMainTab('map') } }}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId((h) => h === s.id ? null : h)}
              onContextMenu={(e) => openSessionMenu(e, s.id)}
              style={{
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
          })}
          {sessions.length === 0 && <div style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))' }}>No sessions yet — start one above.</div>}
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
              <button className="trail-ctx-btn" onClick={() => { setSessionCtxMenu(null); requestDeleteConfirm(s.id) }} style={{ ...sessionMenuBtnStyle, color: '#e08468' }}>Delete</button>
            </div>
          )
        })()}

        {/* Main pane */}
        <div style={{ flex: 1, padding: 20, overflowY: 'auto', minWidth: 0 }}>
          {mainTab === 'review' ? (
            <ReviewView sessions={sessions} />
          ) : selectedId === null ? (
            <EverythingView sessions={sessions} zoom={zoom} onZoomChange={setZoom} />
          ) : !detail ? (
            <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
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
                    display: 'block', fontSize: 17, fontWeight: 700, margin: '0 0 4px', background: 'rgb(var(--color-surface-2))',
                    border: '1px solid rgb(var(--color-accent))', borderRadius: 6, padding: '2px 6px', color: 'rgb(var(--color-text-primary))',
                  }}
                />
              ) : (
                <h2
                  onDoubleClick={() => startRename(detail.session.id, detail.session.name)}
                  onContextMenu={(e) => openSessionMenu(e, detail.session.id)}
                  title="Double-click or right-click to rename"
                  style={{ margin: '0 0 4px', fontSize: 17, cursor: 'text' }}
                >{detail.session.name}</h2>
              )}
              <div style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))', marginBottom: 16 }}>
                {detail.nodes.length} chapter stop{detail.nodes.length === 1 ? '' : 's'} · {detail.connections.length} connection{detail.connections.length === 1 ? '' : 's'}
              </div>
              <MapView
                detail={detail}
                onChanged={() => window.studyTrail.getSession(detail.session.id).then((d) => d && setDetail(d))}
                zoom={zoom}
                onZoomChange={setZoom}
              />
            </>
          )}
        </div>
      </div>
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
