import { useRef, useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, originDisplayText, type TrailRef } from './trailNav'
import { effectiveGapMs, gapSegmentHeight, formatGap, GAP_CHIP_THRESHOLD_MS } from './trailTime'
import TrailConnectorOverlay, { useTrailConnectorPoints, type TrailEdge } from './TrailConnectorOverlay'

// The Map: a time-ordered vertical spine of chapter-anchor nodes, each with its off-spine
// connections listed underneath it, all physically connected by a measured SVG overlay
// (TrailConnectorOverlay) — every spine dot, branch-row marker, and round-trip target is a
// registered "point," and the overlay draws real curves between them, recomputed on every
// render plus a ResizeObserver on the container. Previously each row's own tiny 28px line
// swatch floated independently, touching neither the spine dot above it nor the row's own
// marker — "make sure the dots are connected to the lines too."
//
// Also: real elapsed-time spacing + gap chips between spine nodes (the spine "breathes"
// instead of every visit looking equally close together); round-trip detection (a
// chapter-connection whose destination is an ALREADY-EXISTING spine node, not the literal next
// one, renders as a ↺ "return to" row AND a curved return edge with an arrowhead back into
// that node — the fix for a lexicon/search detour permanently dragging the anchor forward now
// shows up here as an honest round trip); an always-visible "via X [tier]" origin line above
// every node; rich hover cards; click / Cmd+click / right-click navigation; and collapsing of
// clustered glance connections into one summarized row.
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
    // The connecting LINE itself is now drawn by TrailConnectorOverlay (spine-dot to
    // spine-dot) — this just reserves the vertical space the gap math calls for, and hosts
    // the "42m later" chip when the gap is big enough to call out.
    <div style={{ position: 'relative', flex: 1, width: 2, minHeight: height }}>
      {showChip && (
        // Anchored near the TOP of this connector (not vertically centered) — the column
        // stretches to match whatever tall content sits beside it, so a centered chip used to
        // drift down into unrelated row content several items below instead of reading as
        // "attached to the incoming spine segment."
        <div style={{
          position: 'absolute', top: 10, left: 6, whiteSpace: 'nowrap', zIndex: 1,
          fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-2))',
          border: '1px solid rgb(var(--color-surface-4))', borderRadius: 999, padding: '1px 6px',
        }}>{formatGap(gapMs!)} later</div>
      )}
    </div>
  )
}

// Always-visible "how did I get here" line above a node — NOT hover-only. Landing on a
// chapter via a Strong's occurrence (or any other tangent) previously showed nothing at all
// about where it came from unless you happened to hover the right thing; this makes the
// origin part of the node's normal, always-on display.
// Origin kinds this routine/low-decision-value that they'd rather stay hover-only — reading
// onward and switching between already-open tabs are normal navigation flow, not really an
// "origin story" worth taking up permanent visual space for. The full text is still always in
// the hover card (TrailNodeHoverContent) regardless.
const LOW_SIGNAL_ORIGIN_TAGS = new Set(['tab-switch', 'reading'])
export function isLowSignalOrigin(conn: TrailConnection): boolean {
  return conn.reasonTags.some((t) => LOW_SIGNAL_ORIGIN_TAGS.has(t))
}

function OriginBadgeLine({ conn }: { conn: TrailConnection }) {
  const color = TIER_COLOR[conn.clarityTier] ?? 'rgb(var(--color-text-muted))'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgb(var(--color-text-muted))', marginBottom: 6, opacity: 0.85 }}>
      <span>via {originDisplayText(conn)}</span>
      <span style={{
        fontSize: 9, fontWeight: 700, color, background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, borderRadius: 999, padding: '0 5px',
        textTransform: 'uppercase', letterSpacing: '.03em',
      }}>{conn.clarityTier === 1 ? 'clear' : conn.clarityTier === 2 ? 'soft' : 'ambiguous'}</span>
    </div>
  )
}

type AnnotatedConn = TrailConnection & { isReturn?: boolean }

function ConnRow({ conn, refFor, onOpenPrompt, openMenu, registerPoint }: {
  conn: AnnotatedConn
  refFor: (conn: TrailConnection) => TrailRef | null
  onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
  registerPoint: (key: string) => (el: HTMLElement | null) => void
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span
          ref={registerPoint(`row:${conn.id}`)}
          style={{
            width: 7, height: 7, flexShrink: 0,
            borderRadius: isLexicon ? 1 : '50%',
            transform: isLexicon ? 'rotate(45deg)' : undefined,
            background: TIER_COLOR[conn.clarityTier] ?? 'rgb(var(--color-text-muted))',
            opacity: conn.weight === 'glance' ? 0.5 : 1,
          }}
        />
        <span
          onClick={ref ? (e) => trailRefClick(ref, e) : undefined}
          onContextMenu={ref ? (e) => openTrailRefMenu(openMenu, ref, e) : undefined}
          style={{
            fontSize: 12, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1,
            cursor: ref ? 'pointer' : undefined,
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

function GlanceGroupRow({ items, refFor, openMenu, registerPoint, groupKey }: {
  items: AnnotatedConn[]
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  groupKey: string
}) {
  const [expanded, setExpanded] = useState(false)
  const first = items[0], last = items[items.length - 1]
  const labelFor = (c: TrailConnection) => c.toKind === 'lexicon' ? `Strong's ${c.toStrongsNum}` : `${bookLabel(c.toBookId ?? '')} ${c.toChapter}`
  if (expanded) {
    return (
      <div>
        {items.map((c) => <ConnRow key={c.id} conn={c} refFor={refFor} onOpenPrompt={() => {}} openMenu={openMenu} registerPoint={registerPoint} />)}
        <button onClick={() => setExpanded(false)} style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}>▾ collapse</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: 0.55 }}>
      <span ref={registerPoint(groupKey)} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgb(var(--color-text-muted))', flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, color: 'rgb(var(--color-text-secondary))' }}>
        {labelFor(first)} → {labelFor(last)}
      </span>
      <button onClick={() => setExpanded(true)} style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))', border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer' }}>
        ▸ {items.length} glances
      </button>
    </div>
  )
}

type RenderItem = { type: 'single'; item: AnnotatedConn } | { type: 'glanceGroup'; key: string; items: AnnotatedConn[] }

function groupForRender(conns: AnnotatedConn[]): RenderItem[] {
  const out: RenderItem[] = []
  const consumedClusters = new Set<string>()
  for (const c of conns) {
    if (c.weight === 'glance' && c.clusterId) {
      if (consumedClusters.has(c.clusterId)) continue
      const group = conns.filter((x) => x.clusterId === c.clusterId && x.weight === 'glance')
      if (group.length >= 2) {
        consumedClusters.add(c.clusterId)
        out.push({ type: 'glanceGroup', key: `grp:${c.clusterId}`, items: group })
        continue
      }
    }
    out.push({ type: 'single', item: c })
  }
  return out
}

function NodeBlock({
  node, connections, gapToNextMs, isLast, onOpenPrompt, refFor, openMenu, originConn, registerPoint, boundaryLabel,
}: {
  node: TrailNode; connections: AnnotatedConn[]; gapToNextMs: number | null; isLast: boolean
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; x: number; y: number }) => void
  originConn?: TrailConnection
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  boundaryLabel?: string
}) {
  const nodeRef: TrailRef = { kind: 'chapter', bookId: node.bookId, chapter: node.chapter }
  const items = groupForRender(connections)
  const isRevisit = !!node.revisitOfNodeId
  const showOrigin = originConn && !isLowSignalOrigin(originConn)
  return (
    <div>
      {boundaryLabel && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px', paddingLeft: 21,
          fontSize: 10.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em',
        }}>
          <span style={{ flexShrink: 0 }}>{boundaryLabel}</span>
          <span style={{ flex: 1, height: 1, background: 'rgb(var(--color-surface-4))' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginBottom: isLast ? 0 : 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
        {/* A promoted revisit's own dot is smaller/dimmer than a first-time chapter stop —
            still a full, real spine entry (own connections, own hover card), just visually
            marked as "seen before" at a glance. See the revisit-link edge built in MapView
            below for the quiet dashed connector back to the original mention. */}
        <div
          ref={registerPoint(`node:${node.id}`)}
          style={{
            width: isRevisit ? 7 : 9, height: isRevisit ? 7 : 9, background: 'rgb(var(--color-accent))',
            borderRadius: 2, marginTop: isRevisit ? 5 : 4, flexShrink: 0, opacity: isRevisit ? 0.7 : 1,
          }}
        />
        {!isLast && <GapConnector gapMs={gapToNextMs} />}
      </div>
      <div style={{ paddingBottom: 24, flex: 1, minWidth: 0 }}>
        {showOrigin && <OriginBadgeLine conn={originConn!} />}
        <TrailHoverCard content={<TrailNodeHoverContent node={node} originConn={originConn} />}>
          <div
            onClick={(e) => trailRefClick(nodeRef, e)}
            onContextMenu={(e) => openTrailRefMenu(openMenu, nodeRef, e)}
            style={{
              fontFamily: 'ui-monospace, monospace', fontSize: isRevisit ? 12 : 13.5, fontWeight: 600, cursor: 'pointer',
              color: isRevisit ? 'rgb(var(--color-text-secondary))' : 'rgb(var(--color-text-primary))',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {bookLabel(node.bookId)} {node.chapter}
            {isRevisit && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
                borderRadius: 999, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.03em',
              }}>revisit</span>
            )}
          </div>
        </TrailHoverCard>
        {node.cachedSubnote && <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 1 }}>{node.cachedSubnote}</div>}
        <div style={{ marginTop: 4 }}>
          {items.map((it) => it.type === 'single'
            ? <ConnRow key={it.item.id} conn={it.item} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} />
            : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        </div>
      </div>
      </div>
    </div>
  )
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1

export default function MapView({ detail, onChanged, boundaryLabelForNodeId }: { detail: TrailSessionDetail; onChanged: () => void; boundaryLabelForNodeId?: Map<string, string> }) {
  const [promptConn, setPromptConn] = useState<TrailConnection | null>(null)
  const { menu, menuRef, openMenu, closeMenu } = useTrailRefMenu()
  const { pointsRef, registerPoint } = useTrailConnectorPoints()
  const containerRef = useRef<HTMLDivElement>(null)
  const needsInputCount = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length

  // Real proportional zoom (a CSS transform on the whole spine), not just a spacing/font-size
  // slider — trackpad pinch and Ctrl+scroll both arrive as wheel events with ctrlKey=true (the
  // standard way browsers report pinch gestures), so a single wheel listener covers both. The
  // scaled content sits inside its own scrollable viewport (below) so zooming in doesn't clip
  // against the panel's outer scroll area.
  const [zoom, setZoom] = useState(1)
  function onWheelZoom(e: React.WheelEvent) {
    if (!e.ctrlKey) return // a plain (non-pinch) wheel scroll should keep scrolling normally
    e.preventDefault()
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - e.deltaY * 0.01)))
  }

  // key = `${bookId}:${chapter}` — lets a connection tell whether its destination is the
  // literal next spine node (a forward move, no separate row needed — the spine geometry
  // already shows it) or an EARLIER/different existing node (a round trip back to it). Keyed
  // by trailSessionId too (not just bookId:chapter) — MapView also renders a merged
  // ALL-sessions timeline (EverythingView's "one continuous spine" mode), where the same
  // chapter genuinely visited in two DIFFERENT sessions must never look like a round trip
  // between them.
  const nodeByKey = new Map<string, TrailNode>()
  for (const n of detail.nodes) nodeByKey.set(`${n.trailSessionId}:${n.bookId}:${n.chapter}`, n)
  const nextNodeById = new Map<string, TrailNode | undefined>()
  detail.nodes.forEach((n, i) => nextNodeById.set(n.id, detail.nodes[i + 1]))

  // The EARLIEST connection that ever led to a given chapter — its "origin story," shown
  // above the node always (OriginBadgeLine) and in its hover card, regardless of how many
  // times the chapter's been revisited since. The very first node of the session has none
  // (nothing led to it — it's where the session started).
  const originConnByNodeId = new Map<string, TrailConnection>()
  for (const c of [...detail.connections].sort((a, b) => a.createdAt - b.createdAt)) {
    if (c.toKind !== 'chapter' || !c.toBookId || c.toChapter == null) continue
    const target = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
    if (target && !originConnByNodeId.has(target.id)) originConnByNodeId.set(target.id, c)
  }

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
  // annotated `isReturn` so ConnRow can prefix it with ↺ instead of implying a fresh move —
  // and feeds a curved return edge in the overlay (built below).
  const rowsForNode = new Map<string, AnnotatedConn[]>()
  for (const n of detail.nodes) rowsForNode.set(n.id, [])
  for (const c of detail.connections) {
    const bucket = rowsForNode.get(c.fromNodeId)
    if (!bucket) continue
    if (c.toKind === 'chapter' && c.toBookId && c.toChapter != null) {
      const next = nextNodeById.get(c.fromNodeId)
      const isForward = next && next.trailSessionId === c.trailSessionId && next.bookId === c.toBookId && next.chapter === c.toChapter
      if (isForward) continue
      const target = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
      bucket.push({ ...c, isReturn: !!target })
      continue
    }
    bucket.push(c)
  }

  // The connected-lines engine's edge list — built from the same data that drives the rows
  // above, so the diagram can never drift out of sync with what's actually displayed.
  const edges: TrailEdge[] = []
  for (let i = 0; i < detail.nodes.length - 1; i++) {
    // Skip across a session boundary (merged all-sessions timeline) — chronologically
    // adjacent nodes from two DIFFERENT sessions shouldn't visually read as one continuous
    // read-through just because they happen to be time-adjacent.
    if (detail.nodes[i].trailSessionId !== detail.nodes[i + 1].trailSessionId) continue
    edges.push({ key: `spine:${detail.nodes[i].id}`, from: `node:${detail.nodes[i].id}`, to: `node:${detail.nodes[i + 1].id}`, color: 'rgb(var(--color-accent))', arrow: true })
  }
  for (const n of detail.nodes) {
    const items = groupForRender(rowsForNode.get(n.id) ?? [])
    for (const it of items) {
      if (it.type === 'single') {
        const c = it.item
        const color = TIER_COLOR[c.clarityTier] ?? 'rgb(var(--color-text-muted))'
        // Straight, not curved — these are short local connectors (node → its own row); a
        // curve crossing through adjacent text was adding shape/crowding for little benefit
        // at this density. Curves stay reserved for return edges, which travel further and
        // genuinely benefit from routing around intervening rows.
        edges.push({ key: `stub:${c.id}`, from: `node:${n.id}`, to: `row:${c.id}`, color, dashed: c.weight === 'glance', curved: false, opacity: 0.5 })
        if (c.isReturn && c.toBookId && c.toChapter != null) {
          const target = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
          if (target) edges.push({ key: `return:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`, color, curved: true, arrow: true })
        }
      } else {
        const color = TIER_COLOR[it.items[0].clarityTier] ?? 'rgb(var(--color-text-muted))'
        edges.push({ key: `stub:${it.key}`, from: `node:${n.id}`, to: it.key, color, dashed: true, curved: false, opacity: 0.4 })
      }
    }
    // The quiet "same chapter as" backlink for a promoted revisit — deliberately muted/thin/
    // dashed (structural chrome, not a clarity-tier signal, hence gray not TIER_COLOR) and
    // never arrowed, since it signals identity ("this is the same chapter"), not a direction
    // of travel the way the primary forward spine edge into this node already does.
    if (n.revisitOfNodeId && detail.nodes.some((on) => on.id === n.revisitOfNodeId)) {
      edges.push({
        key: `revisit-link:${n.id}`, from: `node:${n.id}`, to: `node:${n.revisitOfNodeId}`,
        color: 'rgb(var(--color-text-muted))', dashed: true, curved: true, opacity: 0.35,
      })
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Zoom controls — fixed to the viewport corner of the scrollable pane, not the scaled
          content, so they stay a constant size and position regardless of zoom level. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 2, display: 'flex', justifyContent: 'flex-end', gap: 4,
        marginBottom: 6, WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: 2 }}>
          <button onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} title="Zoom out" style={zoomBtnStyle}>−</button>
          <button onClick={() => setZoom(1)} title="Reset zoom" style={{ ...zoomBtnStyle, width: 44, fontSize: 10.5 }}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} title="Zoom in" style={zoomBtnStyle}>+</button>
        </div>
      </div>
      <div onWheel={onWheelZoom} style={{ overflow: 'auto' }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 'max-content' }}>
          <div ref={containerRef} style={{ position: 'relative' }}>
            <TrailConnectorOverlay containerRef={containerRef} pointsRef={pointsRef} edges={edges} zoom={zoom} />
            <div style={{ position: 'relative', zIndex: 1 }}>
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
              originConn={originConnByNodeId.get(n.id)}
              registerPoint={registerPoint}
              boundaryLabel={boundaryLabelForNodeId?.get(n.id)}
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
          </div>
        </div>
      </div>
    </div>
  )
}

const zoomBtnStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, width: 24, height: 24, lineHeight: '22px', textAlign: 'center',
  color: 'rgb(var(--color-text-secondary))', background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
}
