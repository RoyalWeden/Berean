import { useEffect, useState } from 'react'
import type { TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import { LOOSE_SESSION_ID } from '@/store/studyTrailSlice'
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

export default function EverythingView({ sessions, zoom, onZoomChange, revisitWindowMs }: {
  sessions: TrailSession[]
  zoom?: number
  onZoomChange?: (zoom: number) => void
  revisitWindowMs?: number
}) {
  const [details, setDetails] = useState<TrailSessionDetail[]>([])
  const [allSessions, setAllSessions] = useState<TrailSession[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  async function loadAll(showLoading: boolean) {
    if (showLoading) setLoading(true)
    // listAllSessions (not the `sessions` prop) so the implicit "Loose stops" bucket — every
    // stop recorded while the user had no session of their own — is merged into the timeline
    // too. It's filtered out of the session rail, so it only ever appears here.
    const all = await window.studyTrail.listAllSessions().catch(() => [] as TrailSession[])
    setAllSessions(all)
    const rows = await Promise.all(all.map((s) => window.studyTrail.getSession(s.id)))
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
  // Push-based near-instant refresh — the poll above is a fallback; per direct feedback
  // ("want it faster / near-instant"), this reacts the moment anything is actually written.
  useEffect(() => window.studyTrail.onDataChanged(() => loadAll(false)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalConnections = details.reduce((n, d) => n + d.connections.length, 0)
  const totalNodes = details.reduce((n, d) => n + d.nodes.length, 0)

  if (loading) return <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>

  // Merge every session's nodes/connections/pausedIntervals into one chronologically-sorted
  // timeline. Nodes are globally-unique UUIDs (not per-session sequence numbers), so a plain
  // concat + sort is safe — no id collisions to worry about across sessions.
  const mergedNodes: TrailNode[] = details.flatMap((d) => d.nodes).sort((a, b) => a.anchorStartedAt - b.anchorStartedAt)
  const mergedConnections = details.flatMap((d) => d.connections)
  const mergedPausedIntervals = details.flatMap((d) => d.pausedIntervals)
  const sessionById = new Map(allSessions.map((s) => [s.id, s]))

  const boundaryLabelForNodeId = new Map<string, string>()
  let lastSessionId: string | null = null
  for (const n of mergedNodes) {
    if (n.trailSessionId !== lastSessionId) {
      const s = sessionById.get(n.trailSessionId)
      // The implicit bucket renders as a plain "Loose stops" divider (no session name to
      // show — the user never named it) so a run of un-sessioned stops still reads as its
      // own stretch of the timeline.
      const label = s?.id === LOOSE_SESSION_ID || !s ? 'Loose stops' : s.name
      boundaryLabelForNodeId.set(n.id, `${label} — ${fmtBoundaryDate(n.anchorStartedAt)}`)
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
    // flex column filling the full height handed down by StudyTrailApp's "Main pane" — MapView
    // needs a genuinely bounded ancestor chain for ITS OWN internal scroll container to be the
    // one that actually scrolls (see MapView.tsx's own comment on this).
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 4px', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Everything</h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') window.dispatchEvent(new CustomEvent('berean:trailFilterSubmit')) }}
          placeholder="Filter timeline…"
          style={{
            width: 200, flexShrink: 0, fontSize: 12, padding: '4px 9px', background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, color: 'rgb(var(--color-text-primary))',
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))', marginBottom: 18, flexShrink: 0 }}>
        {sessions.length} session{sessions.length === 1 ? '' : 's'} · {totalNodes} chapter stop{totalNodes === 1 ? '' : 's'} · {totalConnections} connection{totalConnections === 1 ? '' : 's'} total
      </div>
      {mergedNodes.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>No sessions yet — start one from the rail on the left.</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <MapView detail={merged} onChanged={() => loadAll(true)} boundaryLabelForNodeId={boundaryLabelForNodeId} zoom={zoom} onZoomChange={onZoomChange} revisitWindowMs={revisitWindowMs} filterValue={filter} onFilterChange={setFilter} />
        </div>
      )}
    </div>
  )
}
