import { useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'

// The Map: a time-ordered vertical spine of chapter-anchor nodes (the "main bullets" from the
// mockup), each with its off-spine connections listed underneath it as small rows. A true
// curved branching diagram (per the original mockup) is a larger investment than this pass
// covers — this renders the same information (which chapter, when, what it connects to, how
// certain the reason is) as a clean readable list with real SVG swatches for line style, rather
// than freehand curves. Solid = main path / full connection, dashed = a soft/tangent
// connection, thick = clustered (revisited more than once), diamond = lexicon/word stop,
// square = chapter stop — same legend as the plan.

const TIER_COLOR: Record<number, string> = { 1: '#4fc3ae', 2: 'rgb(var(--color-accent))', 3: '#e08468' }

// bookName() is the same synchronous, no-DB-lookup helper the rest of the app already uses for
// this (parseRef.ts's own ID_TO_NAME table) — trail rows only ever carry a bookId, but that
// table doesn't need a DB round-trip, so there's no reason this window should ever have shown
// raw ids ("JHN 17") instead of full names ("John 17").
function bookLabel(bookId: string): string {
  return bookName(bookId)
}

function LineSwatch({ weight, tier, clustered }: { weight: string; tier: number; clustered: boolean }) {
  const color = TIER_COLOR[tier] ?? 'rgb(var(--color-text-muted))'
  return (
    <svg width="28" height="10" style={{ flexShrink: 0 }}>
      <line
        x1={1} y1={5} x2={27} y2={5}
        stroke={color}
        strokeWidth={clustered ? 3.5 : 2}
        strokeDasharray={weight === 'glance' ? '3 3' : undefined}
        strokeLinecap="round"
      />
    </svg>
  )
}

function ConnectionRow({
  conn, onOpenPrompt,
}: { conn: TrailConnection; onOpenPrompt: (c: TrailConnection) => void }) {
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  const label = isLexicon
    ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare'
      ? `compare · ${bookLabel(conn.toBookId ?? '')} ${conn.toChapter}`
      : conn.toKind === 'note'
        ? 'note'
        : conn.toKind === 'video'
          ? 'video'
          : `${bookLabel(conn.toBookId ?? '')} ${conn.toChapter}${conn.toVerse ? `:${conn.toVerse}` : ''}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <LineSwatch weight={conn.weight} tier={conn.clarityTier} clustered={!!conn.clusterId} />
      <span style={{
        width: 7, height: 7, flexShrink: 0,
        borderRadius: isLexicon ? 1 : '50%',
        transform: isLexicon ? 'rotate(45deg)' : undefined,
        background: TIER_COLOR[conn.clarityTier] ?? 'rgb(var(--color-text-muted))',
        opacity: conn.weight === 'glance' ? 0.5 : 1,
      }} />
      <span style={{ fontSize: 12, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1 }}>{label}</span>
      {conn.versePinFrom != null && (
        <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>
          v.{conn.versePinFrom}{conn.versePinTo && conn.versePinTo !== conn.versePinFrom ? `–${conn.versePinTo}` : ''}
        </span>
      )}
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
      ) : conn.dismissedPromptAt ? (
        <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>reason unclear</span>
      ) : null}
      {conn.weight === 'glance' && <span style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>(glance)</span>}
      {conn.clusterId && <span style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>revisited</span>}
    </div>
  )
}

function NodeBlock({ node, connections, onOpenPrompt }: {
  node: TrailNode; connections: TrailConnection[]; onOpenPrompt: (c: TrailConnection) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
        <div style={{ width: 9, height: 9, background: 'rgb(var(--color-accent))', borderRadius: 2, marginTop: 4 }} />
        <div style={{ flex: 1, width: 2, background: 'rgb(var(--color-surface-4))', minHeight: 18 }} />
      </div>
      <div style={{ paddingBottom: 16, flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))' }}>
          {bookLabel(node.bookId)} {node.chapter}
        </div>
        {node.cachedSubnote && <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 1 }}>{node.cachedSubnote}</div>}
        <div style={{ marginTop: 4 }}>
          {connections.map((c) => <ConnectionRow key={c.id} conn={c} onOpenPrompt={onOpenPrompt} />)}
        </div>
      </div>
    </div>
  )
}

export default function MapView({ detail, onChanged }: { detail: TrailSessionDetail; onChanged: () => void }) {
  const [promptConn, setPromptConn] = useState<TrailConnection | null>(null)
  const needsInputCount = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length

  return (
    <div>
      {needsInputCount > 0 && (
        <div style={{ fontSize: 11, color: '#e08468', marginBottom: 10 }}>
          {needsInputCount} connection{needsInputCount === 1 ? '' : 's'} could use a reason — click a <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13,
            borderRadius: 999, background: 'rgba(224,132,104,0.14)', border: '1px solid rgba(224,132,104,0.4)', fontSize: 9, fontWeight: 700,
          }}>?</span> below (never required — dismiss any of them any time).
        </div>
      )}
      {detail.nodes.map((n) => (
        <NodeBlock
          key={n.id}
          node={n}
          connections={detail.connections.filter((c) => c.fromNodeId === n.id)}
          onOpenPrompt={setPromptConn}
        />
      ))}
      {detail.nodes.length === 0 && (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>Nothing recorded yet — navigate around the app while this session is live.</div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 20, paddingTop: 12, borderTop: '1px solid rgb(var(--color-surface-4))', fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>
        <span><svg width="16" height="8"><line x1={1} y1={4} x2={15} y2={4} stroke="#4fc3ae" strokeWidth={2} /></svg> clear</span>
        <span><svg width="16" height="8"><line x1={1} y1={4} x2={15} y2={4} stroke="rgb(var(--color-accent))" strokeWidth={2} strokeDasharray="3 3" /></svg> soft</span>
        <span><svg width="16" height="8"><line x1={1} y1={4} x2={15} y2={4} stroke="#e08468" strokeWidth={2} strokeDasharray="3 3" /></svg> ambiguous</span>
        <span><svg width="16" height="8"><line x1={1} y1={4} x2={15} y2={4} stroke="rgb(var(--color-text-muted))" strokeWidth={3.5} /></svg> revisited</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, background: 'rgb(var(--color-text-muted))', borderRadius: 1, transform: 'rotate(45deg)', display: 'inline-block' }} /> word stop
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, background: 'rgb(var(--color-accent))', borderRadius: 2, display: 'inline-block' }} /> chapter stop
        </span>
      </div>

      {promptConn && (
        <ReasonPromptPopover
          connection={promptConn}
          onClose={() => setPromptConn(null)}
          onSaved={() => { setPromptConn(null); onChanged() }}
        />
      )}
    </div>
  )
}
