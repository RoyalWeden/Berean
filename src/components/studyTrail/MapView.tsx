import { useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, type TrailRef } from './trailNav'
import { effectiveGapMs, gapSegmentHeight, formatGap, GAP_CHIP_THRESHOLD_MS } from './trailTime'

// The Map: a time-ordered vertical spine of chapter-anchor nodes, each with its off-spine
// connections listed underneath it. Plain inline SVG/DOM (consistent with the rest of the
// app's icon/diagram usage, no graph-layout library — the shape is one time-ordered spine per
// session with branches, not a general graph).
//
// This pass adds: real elapsed-time spacing + gap chips between spine nodes (the spine
// "breathes" instead of every visit looking equally close together); round-trip detection (a
// chapter-connection whose destination is an ALREADY-EXISTING spine node, not the literal next
// one, renders as a ↺ "return to" row instead of implying a fresh forward move — the fix for a
// lexicon/search detour permanently dragging the anchor forward now shows up here as an
// honest round trip rather than either a lost branch or a duplicate node); rich hover cards;
// click / Cmd+click / right-click navigation on every chapter/Strong's label; and collapsing
// of clustered glance connections into one summarized row.
//
// Legend: solid = main path, dashed = tangent/soft, thick = revisited, diamond = lexicon/word
// stop, square = chapter stop, ↺ = round trip back to an earlier stop.

const TIER_COLOR: Record<number, string> = { 1: '#4fc3ae', 2: 'rgb(var(--color-accent))', 3: '#e08468' }

function bookLabel(bookId: string): string {
  return bookName(bookId)
}

function GapConnector({ gapMs }: { gapMs: number | null }) {
  const height = gapMs == null ? 18 : gapSegmentHeight(gapMs)
  const showChip = gapMs != null && gapMs >= GAP_CHIP_THRESHOLD_MS
  return (
    <div style={{ position: 'relative', flex: 1, width: 2, minHeight: height, background: 'rgb(var(--color-surface-4))', opacity: showChip ? 0.35 : 1 }}>
      {showChip && (
        <div style={{
          position: 'absolute', top: '50%', left: 6, transform: 'translateY(-50%)', whiteSpace: 'nowrap',
          fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-2))',
          border: '1px solid rgb(var(--color-surface-4))', borderRadius: 999, padding: '1px 6px',
        }}>{formatGap(gapMs!)} later</div>
      )}
    </div>
  )
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

type AnnotatedConn = TrailConnection & { isReturn?: boolean }

function ConnRow({ conn, refFor, onOpenPrompt, openMenu }: {
  conn: AnnotatedConn
  refFor: (conn: TrailConnection) => TrailRef | null
  onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
}) {
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  const baseLabel = isLexicon
    ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare'
      ? `compare · ${bookLabel(conn.toBookId ?? '')} ${conn.toChapter}`
      : conn.toKind === 'note'
        ? 'note'
        : conn.toKind === 'video'
          ? 'video'
          : `${bookLabel(conn.toBookId ?? '')} ${conn.toChapter}${conn.toVerse ? `:${conn.toVerse}` : ''}`
  const label = conn.isReturn ? `↺ ${baseLabel}` : baseLabel
  const ref = refFor(conn)
  return (
    <TrailHoverCard content={<TrailConnectionHoverContent conn={conn} />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
        <LineSwatch weight={conn.weight} tier={conn.clarityTier} clustered={!!conn.clusterId} />
        <span style={{
          width: 7, height: 7, flexShrink: 0,
          borderRadius: isLexicon ? 1 : '50%',
          transform: isLexicon ? 'rotate(45deg)' : undefined,
          background: TIER_COLOR[conn.clarityTier] ?? 'rgb(var(--color-text-muted))',
          opacity: conn.weight === 'glance' ? 0.5 : 1,
        }} />
        <span
          onClick={ref ? (e) => trailRefClick(ref, e) : undefined}
          onContextMenu={ref ? (e) => openTrailRefMenu(openMenu, ref, e) : undefined}
          style={{
            fontSize: 12, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1,
            cursor: ref ? 'pointer' : undefined, textDecoration: ref ? undefined : undefined,
          }}
          onMouseEnter={(e) => { if (ref) (e.currentTarget as HTMLElement).style.textDecoration = 'underline' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none' }}
        >{label}</span>
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
    </TrailHoverCard>
  )
}

function GlanceGroupRow({ items, refFor, openMenu }: {
  items: AnnotatedConn[]
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const first = items[0], last = items[items.length - 1]
  const labelFor = (c: TrailConnection) => c.toKind === 'lexicon' ? `Strong's ${c.toStrongsNum}` : `${bookLabel(c.toBookId ?? '')} ${c.toChapter}`
  if (expanded) {
    return (
      <div>
        {items.map((c) => <ConnRow key={c.id} conn={c} refFor={refFor} onOpenPrompt={() => {}} openMenu={openMenu} />)}
        <button onClick={() => setExpanded(false)} style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>▾ collapse</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: 0.55 }}>
      <svg width="14" height="10" style={{ flexShrink: 0 }}><line x1={1} y1={5} x2={13} y2={5} stroke="rgb(var(--color-text-muted))" strokeWidth={2} strokeDasharray="3 3" strokeLinecap="round" /></svg>
      <span style={{ fontSize: 11.5, color: 'rgb(var(--color-text-secondary))' }}>
        {labelFor(first)} → {labelFor(last)}
      </span>
      <button onClick={() => setExpanded(true)} style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))', border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer' }}>
        ▸ {items.length} glances
      </button>
    </div>
  )
}

type RenderItem = { type: 'single'; item: AnnotatedConn } | { type: 'glanceGroup'; items: AnnotatedConn[] }

function groupForRender(conns: AnnotatedConn[]): RenderItem[] {
  const out: RenderItem[] = []
  const consumedClusters = new Set<string>()
  for (const c of conns) {
    if (c.weight === 'glance' && c.clusterId) {
      if (consumedClusters.has(c.clusterId)) continue
      const group = conns.filter((x) => x.clusterId === c.clusterId && x.weight === 'glance')
      if (group.length >= 2) {
        consumedClusters.add(c.clusterId)
        out.push({ type: 'glanceGroup', items: group })
        continue
      }
    }
    out.push({ type: 'single', item: c })
  }
  return out
}

function NodeBlock({
  node, connections, gapToNextMs, isLast, onOpenPrompt, refFor, openMenu,
}: {
  node: TrailNode; connections: AnnotatedConn[]; gapToNextMs: number | null; isLast: boolean
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
}) {
  const nodeRef: TrailRef = { kind: 'chapter', bookId: node.bookId, chapter: node.chapter }
  const items = groupForRender(connections)
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: isLast ? 0 : 4 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
        <div style={{ width: 9, height: 9, background: 'rgb(var(--color-accent))', borderRadius: 2, marginTop: 4, flexShrink: 0 }} />
        {!isLast && <GapConnector gapMs={gapToNextMs} />}
      </div>
      <div style={{ paddingBottom: 16, flex: 1, minWidth: 0 }}>
        <TrailHoverCard content={<TrailNodeHoverContent node={node} />}>
          <div
            onClick={(e) => trailRefClick(nodeRef, e)}
            onContextMenu={(e) => openTrailRefMenu(openMenu, nodeRef, e)}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))', cursor: 'pointer', display: 'inline-block' }}
          >
            {bookLabel(node.bookId)} {node.chapter}
          </div>
        </TrailHoverCard>
        {node.cachedSubnote && <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 1 }}>{node.cachedSubnote}</div>}
        <div style={{ marginTop: 4 }}>
          {items.map((it, i) => it.type === 'single'
            ? <ConnRow key={it.item.id} conn={it.item} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} />
            : <GlanceGroupRow key={`grp-${i}`} items={it.items} refFor={refFor} openMenu={openMenu} />)}
        </div>
      </div>
    </div>
  )
}

export default function MapView({ detail, onChanged }: { detail: TrailSessionDetail; onChanged: () => void }) {
  const [promptConn, setPromptConn] = useState<TrailConnection | null>(null)
  const { menu, menuRef, openMenu, closeMenu } = useTrailRefMenu()
  const needsInputCount = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length

  // key = `${bookId}:${chapter}` — lets a connection tell whether its destination is the
  // literal next spine node (a forward move, no separate row needed — the spine geometry
  // already shows it) or an EARLIER/different existing node (a round trip back to it).
  const nodeByKey = new Map<string, TrailNode>()
  for (const n of detail.nodes) nodeByKey.set(`${n.bookId}:${n.chapter}`, n)
  const nextNodeById = new Map<string, TrailNode | undefined>()
  detail.nodes.forEach((n, i) => nextNodeById.set(n.id, detail.nodes[i + 1]))

  function refFor(conn: TrailConnection): TrailRef | null {
    if (conn.toKind === 'lexicon' && conn.toStrongsNum) return { kind: 'lexicon', strongsNum: conn.toStrongsNum }
    if ((conn.toKind === 'chapter' || conn.toKind === 'compare') && conn.toBookId && conn.toChapter != null) {
      return { kind: 'chapter', bookId: conn.toBookId, chapter: conn.toChapter, verse: conn.toVerse }
    }
    return null
  }

  // Connections actually rendered as rows under each node: every non-chapter connection, plus
  // chapter-connections that are a ROUND TRIP (destination isn't the literal next spine node).
  // A plain forward chapter-connection is already fully represented by the spine itself
  // (this node → the next block down) and would just duplicate that as a redundant row. A
  // round-trip connection (destination matches an EARLIER/different existing node) is
  // annotated `isReturn` so ConnRow can prefix it with ↺ instead of implying a fresh move.
  const rowsForNode = new Map<string, AnnotatedConn[]>()
  for (const n of detail.nodes) rowsForNode.set(n.id, [])
  for (const c of detail.connections) {
    const bucket = rowsForNode.get(c.fromNodeId)
    if (!bucket) continue
    if (c.toKind === 'chapter' && c.toBookId && c.toChapter != null) {
      const next = nextNodeById.get(c.fromNodeId)
      const isForward = next && next.bookId === c.toBookId && next.chapter === c.toChapter
      if (isForward) continue
      const target = nodeByKey.get(`${c.toBookId}:${c.toChapter}`)
      bucket.push({ ...c, isReturn: !!target })
      continue
    }
    bucket.push(c)
  }

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
      {detail.nodes.map((n, i) => {
        const next = detail.nodes[i + 1]
        const gapToNextMs = next ? effectiveGapMs(n.anchorEndedAt ?? n.anchorStartedAt, next.anchorStartedAt, detail.pausedIntervals) : null
        return (
          <NodeBlock
            key={n.id}
            node={n}
            connections={rowsForNode.get(n.id) ?? []}
            gapToNextMs={gapToNextMs}
            isLast={i === detail.nodes.length - 1}
            onOpenPrompt={setPromptConn}
            refFor={refFor}
            openMenu={openMenu}
          />
        )
      })}
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
        <span>↺ round trip</span>
        <span>hover any label for detail · click to open · right-click for tab options</span>
      </div>

      {promptConn && (
        <ReasonPromptPopover
          connection={promptConn}
          onClose={() => setPromptConn(null)}
          onSaved={() => { setPromptConn(null); onChanged() }}
        />
      )}
      <TrailRefContextMenu menu={menu} menuRef={menuRef} onClose={closeMenu} />
    </div>
  )
}
