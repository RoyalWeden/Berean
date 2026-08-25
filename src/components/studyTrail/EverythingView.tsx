import { useEffect, useState } from 'react'
import type { TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import MapView from './MapView'

// The default landing view — everything recorded across EVERY session, with no session
// selected. Answers "I'm not in any particular session right now, just show me what's been
// tracked" rather than forcing a session pick first (or making you click into each one).
//
// Per the "one continuous spine" design decision: every node from every session is merged
// into a single true chronological timeline and rendered through MapView itself (not a
// separate, simpler copy of it) — a session boundary shows as a small inline divider label,
// but the spine itself is one real timeline, with the exact same gap-spacing, round-trip
// curves, origin lines, and connector overlay as an individual session's Map view. MapView
// itself is what keeps round-trip/forward-edge detection session-scoped (via each node's own
// trailSessionId) so two different sessions that happen to both visit the same chapter never
// look like a round trip between them.

function fmtBoundaryDate(ms: number): string {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function EverythingView({ sessions, zoom, onZoomChange }: {
  sessions: TrailSession[]
  zoom?: number
  onZoomChange?: (zoom: number) => void
}) {
  const [details, setDetails] = useState<TrailSessionDetail[]>([])
  const [loading, setLoading] = useState(true)

  async function loadAll(showLoading: boolean) {
    if (showLoading) setLoading(true)
    const rows = await Promise.all(sessions.map((s) => window.studyTrail.getSession(s.id)))
    setDetails(rows.filter((r): r is TrailSessionDetail => !!r))
    if (showLoading) setLoading(false)
  }

  useEffect(() => { loadAll(true) }, [sessions.map((s) => s.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // This view previously only reloaded when the SET of sessions changed (a session created/
  // deleted) — new nodes/connections streaming into an already-open session while you keep
  // studying never showed up here until you switched away and back. Per direct feedback
  // ("make sure that the study trail auto updates as i am studying"), poll the same way the
  // per-session Map view already does (StudyTrailApp.tsx's own 2s interval) — no push channel
  // yet (deferred, see that file's comment), so a short poll while this view is open is the
  // honest v1 rather than a fake "live" claim. `showLoading: false` so this never flashes
  // "Loading…" over content that's already on screen.
  useEffect(() => {
    const interval = setInterval(() => loadAll(false), 2000)
    return () => clearInterval(interval)
  }, [sessions.map((s) => s.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalConnections = details.reduce((n, d) => n + d.connections.length, 0)
  const totalNodes = details.reduce((n, d) => n + d.nodes.length, 0)

  if (loading) return <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>

  // Merge every session's nodes/connections/pausedIntervals into one chronologically-sorted
  // timeline. Nodes are globally-unique UUIDs (not per-session sequence numbers), so a plain
  // concat + sort is safe — no id collisions to worry about across sessions.
  const mergedNodes: TrailNode[] = details.flatMap((d) => d.nodes).sort((a, b) => a.anchorStartedAt - b.anchorStartedAt)
  const mergedConnections = details.flatMap((d) => d.connections)
  const mergedPausedIntervals = details.flatMap((d) => d.pausedIntervals)
  const sessionById = new Map(sessions.map((s) => [s.id, s]))

  const boundaryLabelForNodeId = new Map<string, string>()
  let lastSessionId: string | null = null
  for (const n of mergedNodes) {
    if (n.trailSessionId !== lastSessionId) {
      const s = sessionById.get(n.trailSessionId)
      boundaryLabelForNodeId.set(n.id, `${s?.name ?? 'Session'} — ${fmtBoundaryDate(n.anchorStartedAt)}`)
      lastSessionId = n.trailSessionId
    }
  }

  const merged: TrailSessionDetail = {
    // MapView never reads `session` itself (only nodes/connections/pausedIntervals) — this is
    // just a placeholder to satisfy the shared type.
    session: details[0]?.session ?? { id: 'merged', name: 'Everything', status: 'ended', possiblyAccidental: false, recapUserEdited: false, createdAt: 0, updatedAt: 0 },
    nodes: mergedNodes,
    connections: mergedConnections,
    pausedIntervals: mergedPausedIntervals,
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Everything</h2>
      <div style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))', marginBottom: 18 }}>
        {sessions.length} session{sessions.length === 1 ? '' : 's'} · {totalNodes} chapter stop{totalNodes === 1 ? '' : 's'} · {totalConnections} connection{totalConnections === 1 ? '' : 's'} total
      </div>
      {mergedNodes.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>No sessions yet — start one from the rail on the left.</div>
      ) : (
        <MapView detail={merged} onChanged={() => loadAll(true)} boundaryLabelForNodeId={boundaryLabelForNodeId} zoom={zoom} onZoomChange={onZoomChange} />
      )}
    </div>
  )
}
