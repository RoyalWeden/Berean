import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { useStudyTrailStore, installStudyTrailStateSync } from '@/store/studyTrailSlice'
import { applyThemeToDocument } from '@/lib/applyTheme'
import type { TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import MapView from './MapView'
import ReviewView from './ReviewView'
import EverythingView from './EverythingView'

type MainTab = 'map' | 'review'

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
    window.app.onFocusTrailSession?.((id) => { setSelectedId(id); setMainTab('map') })
  }, [])

  async function handleStart() {
    const name = newName.trim() || 'Untitled study'
    await startTrailSession(name)
    setNewName('')
    await refresh()
    setSelectedId(useStudyTrailStore.getState().currentTrailSessionId)
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
          <button
            onClick={() => (trailSessionStatus === 'live' ? pauseTrailSession() : resumeTrailSession())}
            style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: '4px 10px', color: 'rgb(var(--color-text-primary))', cursor: 'pointer', fontSize: 11, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {trailSessionStatus === 'live' ? '⏸ Pause' : '▶ Resume'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Session rail */}
        <div style={{ width: 220, borderRight: '1px solid rgb(var(--color-surface-4))', padding: 14, overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgb(var(--color-text-muted))', marginBottom: 8 }}>
            Sessions
          </div>
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
              padding: '9px 10px', borderRadius: 9, cursor: 'pointer', marginBottom: 6,
              background: selectedId === null && mainTab === 'map' ? 'rgb(var(--color-accent) / 0.14)' : 'transparent',
              border: '1px dashed rgb(var(--color-surface-4))',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: selectedId === null ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-primary))' }}>
              Everything
            </div>
            <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>every session, all at once</div>
          </div>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => { setSelectedId(s.id); setMainTab('map') }}
              style={{
                padding: '9px 10px', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                background: selectedId === s.id && mainTab === 'map' ? 'rgb(var(--color-accent) / 0.14)' : 'transparent',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', display: 'inline-block',
                  background: s.status === 'live' ? '#4fc3ae' : s.status === 'paused' ? '#e08468' : 'rgb(var(--color-text-muted))',
                }} />
                {s.name}
                {s.possiblyAccidental && <span style={{ fontSize: 9, color: 'rgb(var(--color-text-muted))', fontWeight: 400 }}> (possibly accidental)</span>}
              </div>
              <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>{s.status}</div>
            </div>
          ))}
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
