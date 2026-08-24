import { useEffect, useState } from 'react'
import { useStudyTrailStore } from '@/store/studyTrailSlice'
import type { TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import MapView from './MapView'
import ReviewView from './ReviewView'

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

  async function refresh() {
    const rows = await window.studyTrail.listSessions()
    setSessions(rows)
  }
  useEffect(() => { refresh() }, [])

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
      background: '#17151a', color: '#ece6d8',
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
        borderBottom: '1px solid #2a2730', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, marginRight: 10 }}>Study Trail</span>
        <div style={{ display: 'flex', border: '1px solid #423d49', borderRadius: 8, overflow: 'hidden' }}>
          {(['map', 'review'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMainTab(t)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '4px 12px', cursor: 'pointer', border: 'none',
                background: mainTab === t ? 'rgba(215,171,82,0.16)' : 'transparent',
                color: mainTab === t ? '#d7ab52' : '#b7b0a0', textTransform: 'capitalize',
              }}
            >{t}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {selectedSession && selectedSession.id === currentTrailSessionId && (
          <button
            onClick={() => (trailSessionStatus === 'live' ? pauseTrailSession() : resumeTrailSession())}
            style={{ background: 'transparent', border: '1px solid #423d49', borderRadius: 8, padding: '4px 10px', color: '#ece6d8', cursor: 'pointer', fontSize: 11 }}
          >
            {trailSessionStatus === 'live' ? '⏸ Pause' : '▶ Resume'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Session rail */}
        <div style={{ width: 220, borderRight: '1px solid #2a2730', padding: 14, overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7d7869', marginBottom: 8 }}>
            Sessions
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New session name…"
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart() }}
              style={{ flex: 1, background: '#26232b', border: '1px solid #423d49', borderRadius: 7, padding: '6px 8px', color: '#ece6d8', fontSize: 12 }}
            />
            <button onClick={handleStart} style={{ background: '#d7ab52', border: 'none', borderRadius: 7, padding: '0 10px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
              +
            </button>
          </div>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => { setSelectedId(s.id); setMainTab('map') }}
              style={{
                padding: '9px 10px', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                background: selectedId === s.id && mainTab === 'map' ? 'rgba(215,171,82,0.14)' : 'transparent',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', display: 'inline-block',
                  background: s.status === 'live' ? '#4fc3ae' : s.status === 'paused' ? '#e08468' : '#7d7869',
                }} />
                {s.name}
                {s.possiblyAccidental && <span style={{ fontSize: 9, color: '#7d7869', fontWeight: 400 }}> (possibly accidental)</span>}
              </div>
              <div style={{ fontSize: 10.5, color: '#7d7869' }}>{s.status}</div>
            </div>
          ))}
          {sessions.length === 0 && <div style={{ fontSize: 11.5, color: '#7d7869' }}>No sessions yet — start one above.</div>}
        </div>

        {/* Main pane */}
        <div style={{ flex: 1, padding: 20, overflowY: 'auto', minWidth: 0 }}>
          {mainTab === 'review' ? (
            <ReviewView sessions={sessions} />
          ) : !detail ? (
            <div style={{ color: '#7d7869', fontSize: 13 }}>Select a session to view its trail.</div>
          ) : (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{detail.session.name}</h2>
              <div style={{ fontSize: 12, color: '#b7b0a0', marginBottom: 16 }}>
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
