import { useEffect, useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, type TrailRef } from './trailNav'

function connRef(conn: TrailConnection): TrailRef | null {
  if (conn.toKind === 'lexicon' && conn.toStrongsNum) return { kind: 'lexicon', strongsNum: conn.toStrongsNum }
  if ((conn.toKind === 'chapter' || conn.toKind === 'compare') && conn.toBookId && conn.toChapter != null) {
    return { kind: 'chapter', bookId: conn.toBookId, chapter: conn.toChapter, verse: conn.toVerse }
  }
  return null
}

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

function ConnectionRow({ conn, onOpenPrompt, openMenu }: {
  conn: TrailConnection; onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
}) {
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  const label = isLexicon
    ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare' ? `compare · ${bookName(conn.toBookId ?? '')} ${conn.toChapter}`
    : conn.toKind === 'note' ? 'note'
    : conn.toKind === 'video' ? 'video'
    : `${bookName(conn.toBookId ?? '')} ${conn.toChapter}${conn.toVerse ? `:${conn.toVerse}` : ''}`
  const ref = connRef(conn)
  return (
    <TrailHoverCard content={<TrailConnectionHoverContent conn={conn} />}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <LineSwatch weight={conn.weight} tier={conn.clarityTier} clustered={!!conn.clusterId} />
      <span style={{
        width: 7, height: 7, flexShrink: 0, borderRadius: isLexicon ? 1 : '50%',
        transform: isLexicon ? 'rotate(45deg)' : undefined,
        background: TIER_COLOR[conn.clarityTier] ?? 'rgb(var(--color-text-muted))',
        opacity: conn.weight === 'glance' ? 0.5 : 1,
      }} />
      <span
        onClick={ref ? (e) => trailRefClick(ref, e) : undefined}
        onContextMenu={ref ? (e) => openTrailRefMenu(openMenu, ref, e) : undefined}
        style={{ fontSize: 12, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1, cursor: ref ? 'pointer' : undefined }}
      >{label}</span>
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
    </TrailHoverCard>
  )
}

function SessionBlock({ detail, onOpenPrompt, openMenu }: {
  detail: TrailSessionDetail; onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
}) {
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
            <TrailHoverCard content={<TrailNodeHoverContent node={n} />}>
              <div
                onClick={(e) => trailRefClick({ kind: 'chapter', bookId: n.bookId, chapter: n.chapter }, e)}
                onContextMenu={(e) => openTrailRefMenu(openMenu, { kind: 'chapter', bookId: n.bookId, chapter: n.chapter }, e)}
                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))', cursor: 'pointer', display: 'inline-block' }}
              >
                {bookName(n.bookId)} {n.chapter}
              </div>
            </TrailHoverCard>
            {detail.connections.filter((c) => c.fromNodeId === n.id).map((c) => (
              <ConnectionRow key={c.id} conn={c} onOpenPrompt={onOpenPrompt} openMenu={openMenu} />
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
  const { menu, menuRef, openMenu, closeMenu } = useTrailRefMenu()

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
        details.map((d) => <SessionBlock key={d.session.id} detail={d} onOpenPrompt={setPromptConn} openMenu={openMenu} />)
      )}
      {promptConn && (
        <ReasonPromptPopover
          connection={promptConn}
          onClose={() => setPromptConn(null)}
          onSaved={() => { setPromptConn(null); loadAll() }}
        />
      )}
      <TrailRefContextMenu menu={menu} menuRef={menuRef} onClose={closeMenu} />
    </div>
  )
}
