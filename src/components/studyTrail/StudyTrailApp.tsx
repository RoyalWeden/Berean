import { useEffect, useState } from 'react'
import { useStudyTrailStore } from '@/store/studyTrailSlice'
import type { TrailSession, TrailSessionDetail } from '@/types/studyTrail'

// First real slice of the Study Trail window's UI — session list + lifecycle controls, wired
// to the actual IPC layer built in Phase 0. The Map/Review tabs and diagram rendering (the
// bulk of the visual design from the approved mockup) are a follow-up pass; this proves the
// window itself opens, lists real sessions, and start/pause/resume genuinely work end to end.
export default function StudyTrailApp() {
  const [sessions, setSessions] = useState<TrailSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TrailSessionDetail | null>(null)
  const [newName, setNewName] = useState('')
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
    if (!selectedId) { setDetail(null); return }
    let cancelled = false
    const load = () => window.studyTrail.getSession(selectedId).then((d) => { if (!cancelled) setDetail(d) })
    load()
    const interval = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [selectedId])

  useEffect(() => {
    window.app.onFocusTrailSession?.((id) => setSelectedId(id))
  }, [])

  async function handleStart() {
    const name = newName.trim() || 'Untitled study'
    await startTrailSession(name)
    setNewName('')
    await refresh()
    setSelectedId(useStudyTrailStore.getState().currentTrailSessionId)
  }

  return (
    <div style={{
      display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif',
      background: '#17151a', color: '#ece6d8',
    }}>
      <div style={{ width: 230, borderRight: '1px solid #423d49', padding: 14, overflowY: 'auto' }}>
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
            onClick={() => setSelectedId(s.id)}
            style={{
              padding: '9px 10px', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
              background: selectedId === s.id ? 'rgba(215,171,82,0.14)' : 'transparent',
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

      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {!detail ? (
          <div style={{ color: '#7d7869', fontSize: 13 }}>Select a session to view its trail.</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{detail.session.name}</h2>
              {detail.session.id === currentTrailSessionId && (
                <button
                  onClick={() => (trailSessionStatus === 'live' ? pauseTrailSession() : resumeTrailSession())}
                  style={{ background: 'transparent', border: '1px solid #423d49', borderRadius: 8, padding: '5px 10px', color: '#ece6d8', cursor: 'pointer', fontSize: 11.5 }}
                >
                  {trailSessionStatus === 'live' ? '⏸ Pause' : '▶ Resume'}
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#b7b0a0', marginBottom: 18 }}>
              {detail.nodes.length} chapter stop{detail.nodes.length === 1 ? '' : 's'} · {detail.connections.length} connection{detail.connections.length === 1 ? '' : 's'}
            </div>
            {detail.nodes.map((n) => (
              <div key={n.id} style={{ marginBottom: 14, paddingLeft: 12, borderLeft: '2px solid #423d49' }}>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600 }}>{n.bookId} {n.chapter}</div>
                {n.cachedSubnote && <div style={{ fontSize: 11, color: '#7d7869' }}>{n.cachedSubnote}</div>}
                {detail.connections.filter((c) => c.fromNodeId === n.id).map((c) => (
                  <div key={c.id} style={{ fontSize: 11.5, color: c.weight === 'glance' ? '#5a564d' : '#b7b0a0', marginTop: 4 }}>
                    → {c.toKind === 'lexicon' ? c.toStrongsNum : `${c.toBookId} ${c.toChapter}`}
                    {c.reasonText ? ` · ${c.reasonText}` : c.clarityTier === 3 ? ' · reason unclear' : ''}
                    {c.weight === 'glance' ? ' (glance)' : ''}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
