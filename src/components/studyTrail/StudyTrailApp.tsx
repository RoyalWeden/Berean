import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useStudyTrailStore, installStudyTrailStateSync } from '@/store/studyTrailSlice'
import { applyThemeToDocument } from '@/lib/applyTheme'
import type { TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import MapView from './MapView'
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

  // Live-refresh while a session is active — no push channel yet (deferred, see plan), so a
  // short poll while the window is open is the honest v1 rather than a fake "live" claim.
  useEffect(() => {
    if (!selectedId || mainTab !== 'map') { return }
    let cancelled = false
    const load = () => window.studyTrail.getSession(selectedId).then((d) => { if (!cancelled) setDetail(d) })
    load()
    const interval = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(interval) }
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

  async function handleStart() {
    const name = newName.trim() || 'Untitled study'
    await startTrailSession(name)
    setNewName('')
    await refresh()
    setSelectedId(useStudyTrailStore.getState().currentTrailSessionId)
  }

  function requestDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (confirmRevertTimer.current) clearTimeout(confirmRevertTimer.current)
    setConfirmDeleteId(id)
    confirmRevertTimer.current = setTimeout(() => setConfirmDeleteId(null), 4000)
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

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif',
      background: 'rgb(var(--color-surface-1))', color: 'rgb(var(--color-text-primary))',
    }}>
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
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New session name…"
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart() }}
              style={{ flex: 1, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
            />
            <button onClick={handleStart} style={{ background: 'rgb(var(--color-accent))', border: 'none', borderRadius: 7, padding: '0 10px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
              +
            </button>
          </div>
          {/* "Everything" — the default (selectedId starts null): not in any particular
              session, just show what's been tracked across all of them. Pinned above the
              individual session list, same idea as the plan's "Sessions/Everything toggle". */}
          <div
            onClick={() => { setSelectedId(null); setMainTab('map') }}
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
          {sessions.map((s) => {
            const isHovered = hoveredId === s.id
            const isXHovered = hoveredDeleteId === s.id
            return (
            <div
              key={s.id}
              onClick={() => { if (selectMode) { toggleSelected({} as React.MouseEvent, s.id) } else { setSelectedId(s.id); setMainTab('map') } }}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId((h) => h === s.id ? null : h)}
              style={{
                padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 1, display: 'flex', alignItems: 'flex-start', gap: 7,
                background: selectedId === s.id && mainTab === 'map' && !selectMode
                  ? 'rgb(var(--color-accent) / 0.14)'
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
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                    background: s.status === 'live' ? '#4fc3ae' : s.status === 'paused' ? '#e08468' : 'rgb(var(--color-text-muted))',
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
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

        {/* Main pane */}
        <div style={{ flex: 1, padding: 20, overflowY: 'auto', minWidth: 0 }}>
          {mainTab === 'review' ? (
            <ReviewView sessions={sessions} />
          ) : selectedId === null ? (
            <EverythingView sessions={sessions} />
          ) : !detail ? (
            <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{detail.session.name}</h2>
              <div style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))', marginBottom: 16 }}>
                {detail.nodes.length} chapter stop{detail.nodes.length === 1 ? '' : 's'} · {detail.connections.length} connection{detail.connections.length === 1 ? '' : 's'}
              </div>
              <MapView
                detail={detail}
                onChanged={() => window.studyTrail.getSession(detail.session.id).then((d) => d && setDetail(d))}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
