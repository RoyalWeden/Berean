import { useEffect, useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'

// The default landing view — everything recorded across EVERY session, with no session
// selected. Answers "I'm not in any particular session right now, just show me what's been
// tracked" rather than forcing a session pick first. Reuses MapView's node/connection styling
// (a lightweight local copy, not an import — MapView takes a single TrailSessionDetail and
// this merges several, tagging each node with which session it belongs to) grouped by session,
// most recently updated first.

const TIER_COLOR: Record<number, string> = { 1: '#4fc3ae', 2: 'rgb(var(--color-accent))', 3: '#e08468' }

function LineSwatch({ weight, tier, clustered }: { weight: string; tier: number; clustered: boolean }) {
  const color = TIER_COLOR[tier] ?? 'rgb(var(--color-text-muted))'
  return (
    <svg width="28" height="10" style={{ flexShrink: 0 }}>
      <line x1={1} y1={5} x2={27} y2={5} stroke={color} strokeWidth={clustered ? 3.5 : 2}
        strokeDasharray={weight === 'glance' ? '3 3' : undefined} strokeLinecap="round" />
    </svg>
  )
}

function ConnectionRow({ conn, onOpenPrompt }: { conn: TrailConnection; onOpenPrompt: (c: TrailConnection) => void }) {
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  const label = isLexicon
    ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare' ? `compare · ${bookName(conn.toBookId ?? '')} ${conn.toChapter}`
    : conn.toKind === 'note' ? 'note'
    : conn.toKind === 'video' ? 'video'
    : `${bookName(conn.toBookId ?? '')} ${conn.toChapter}${conn.toVerse ? `:${conn.toVerse}` : ''}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <LineSwatch weight={conn.weight} tier={conn.clarityTier} clustered={!!conn.clusterId} />
      <span style={{
        width: 7, height: 7, flexShrink: 0, borderRadius: isLexicon ? 1 : '50%',
        transform: isLexicon ? 'rotate(45deg)' : undefined,
        background: TIER_COLOR[conn.clarityTier] ?? 'rgb(var(--color-text-muted))',
        opacity: conn.weight === 'glance' ? 0.5 : 1,
      }} />
      <span style={{ fontSize: 12, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1 }}>{label}</span>
      {conn.reasonText ? (
        <span style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))', fontStyle: 'italic' }}>· {conn.reasonText}</span>
      ) : needsInput ? (
        <button
          onClick={() => onOpenPrompt(conn)}
          title="Why did you jump here?"
          style={{
            fontSize: 10, fontWeight: 700, color: '#e08468', background: 'rgba(224,132,104,0.14)',
            border: '1px solid rgba(224,132,104,0.4)', borderRadius: 999, width: 15, height: 15,
            lineHeight: '13px', cursor: 'pointer', flexShrink: 0,
          }}
        >?</button>
      ) : null}
      {conn.weight === 'glance' && <span style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>(glance)</span>}
    </div>
  )
}

function SessionBlock({ detail, onOpenPrompt }: { detail: TrailSessionDetail; onOpenPrompt: (c: TrailConnection) => void }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%', display: 'inline-block',
          background: detail.session.status === 'live' ? '#4fc3ae' : detail.session.status === 'paused' ? '#e08468' : 'rgb(var(--color-text-muted))',
        }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--color-text-primary))' }}>{detail.session.name}</span>
        <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>{detail.session.status}</span>
      </div>
      {detail.nodes.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))', paddingLeft: 11 }}>Nothing recorded in this session.</div>
      ) : (
        detail.nodes.map((n: TrailNode) => (
          <div key={n.id} style={{ paddingLeft: 11, marginBottom: 6 }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))' }}>
              {bookName(n.bookId)} {n.chapter}
            </div>
            {detail.connections.filter((c) => c.fromNodeId === n.id).map((c) => (
              <ConnectionRow key={c.id} conn={c} onOpenPrompt={onOpenPrompt} />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

export default function EverythingView({ sessions }: { sessions: TrailSession[] }) {
  const [details, setDetails] = useState<TrailSessionDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [promptConn, setPromptConn] = useState<TrailConnection | null>(null)

  async function loadAll() {
    setLoading(true)
    const rows = await Promise.all(sessions.map((s) => window.studyTrail.getSession(s.id)))
    setDetails(rows.filter((r): r is TrailSessionDetail => !!r).sort((a, b) => b.session.updatedAt - a.session.updatedAt))
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [sessions.map((s) => s.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalConnections = details.reduce((n, d) => n + d.connections.length, 0)

  if (loading) return <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Everything</h2>
      <div style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))', marginBottom: 18 }}>
        {sessions.length} session{sessions.length === 1 ? '' : 's'} · {totalConnections} connection{totalConnections === 1 ? '' : 's'} total
      </div>
      {details.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>No sessions yet — start one from the rail on the left.</div>
      ) : (
        details.map((d) => <SessionBlock key={d.session.id} detail={d} onOpenPrompt={setPromptConn} />)
      )}
      {promptConn && (
        <ReasonPromptPopover
          connection={promptConn}
          onClose={() => setPromptConn(null)}
          onSaved={() => { setPromptConn(null); loadAll() }}
        />
      )}
    </div>
  )
}
