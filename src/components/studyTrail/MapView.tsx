import { useEffect, useRef, useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, navigateTrailRef, originDisplayText, type TrailRef } from './trailNav'
import { useWordReplace } from './useWordReplace'
import { effectiveGapMs, gapSegmentHeight, formatGap, GAP_CHIP_THRESHOLD_MS } from './trailTime'
import TrailConnectorOverlay, { useTrailConnectorPoints, GUTTER_BASE, LANE_SPACING, type TrailEdge } from './TrailConnectorOverlay'
import { BRANCH_PROMOTE_DEPTH_THRESHOLD, BRANCH_PROMOTE_DWELL_MS } from '@/store/studyTrailSlice'

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

// Whether an origin is confident enough to state OUTRIGHT (always-visible line, and — for a
// forward connection — its own distinct traced branch line) rather than just being available
// on hover. Tier 1 ("clear") origins are things Berean can name with certainty — a Strong's
// occurrence click, an AI Lookup suggestion, a TSKe/Classic cross-ref. A search result is only
// tier 2 ("soft") on purpose: clicking a search hit doesn't necessarily mean THAT specific
// search caused the study direction the way clicking a specific word lookup does — it's
// available in the hover card same as everything else, just not asserted as fact inline.
function isConfidentOrigin(conn: TrailConnection): boolean {
  return conn.clarityTier === 1 && !isLowSignalOrigin(conn)
}

// Per the confused-reviewer persona's brief: someone who can't reliably trace an SVG line
// should never be REQUIRED to — a plain sentence should always be available, even for the
// less-certain tiers, so an arrow becomes an optional visual confirmation of something the
// text already said, not the only source of truth. Tier 1 reads as a plain fact ("via ...");
// tier 2/3 are hedged ("possibly via ...") since Study Trail itself isn't fully sure — hedging
// honestly, not asserting a guess as fact, is what makes it safe to show these more often.
function OriginBadgeLine({ conn }: { conn: TrailConnection }) {
  const replace = useWordReplace()
  const hedge = conn.clarityTier === 1 ? '' : 'possibly '
  return (
    <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))', marginBottom: 6, opacity: 0.85 }}>
      {hedge}via {replace(originDisplayText(conn))}
    </div>
  )
}

type AnnotatedConn = TrailConnection & {
  isReturn?: boolean
  /** A forward chapter-connection (destination IS the literal next spine node) whose origin
   *  is specific enough to trace — gets its own row + direct line to that next node, in
   *  addition to (not instead of) the plain spine arrow every chapter gets. */
  isForwardBranch?: boolean
  /** A cross-ref click that landed on a DIFFERENT verse in the SAME chapter the user is
   *  already anchored on — the destination "node" is literally the node this row lives under.
   *  Not a return (nothing was left and come back to) and not a forward branch (no new node),
   *  just a same-chapter cross-ref worth tracing on its own row. See the sameChapter branch in
   *  studyTrailSlice.ts's recorder for how this connection gets created. */
  isSameChapterBranch?: boolean
  /** 1-based chronological step number of an isReturn row's TARGET node — lets the row say
   *  "↺ back to step 4" in plain text (confused-reviewer persona: confirming a return should
   *  never REQUIRE successfully tracing the arrow, just reading two numbers). */
  returnTargetStep?: number
  /** Branch chaining (v31) — hangs off ANOTHER connection (fromConnectionId set), not directly
   *  off its chapter node; renders nested under its parent row instead of as a sibling. */
  isChainedBranch?: boolean
  /** At least one other connection is chained off THIS one — needs to render its own nested
   *  sub-shelf beneath it. */
  hasChainChildren?: boolean
}

// A branch CHAIN staying entirely within lexicon-land has no chapter to "promote" into (see
// studyTrailSlice.ts's BRANCH_PROMOTE_* comment) — whether it's substantial enough to flag is
// purely this live walk over already-stored chain_depth/createdAt data, never a persisted fact.
function chainStats(connId: string, rowsForConnection: Map<string, AnnotatedConn[]> | undefined, rootCreatedAt: number): { maxDepth: number; maxCreatedAt: number } {
  const kids = rowsForConnection?.get(connId) ?? []
  let maxDepth = 0, maxCreatedAt = rootCreatedAt
  for (const k of kids) {
    const sub = chainStats(k.id, rowsForConnection, rootCreatedAt)
    maxDepth = Math.max(maxDepth, 1 + sub.maxDepth)
    maxCreatedAt = Math.max(maxCreatedAt, k.createdAt, sub.maxCreatedAt)
  }
  return { maxDepth, maxCreatedAt }
}

function ConnRow({ conn, refFor, onOpenPrompt, openMenu, registerPoint, rowsForConnection, depth = 0, onHoverKey }: {
  conn: AnnotatedConn
  refFor: (conn: TrailConnection) => TrailRef | null
  onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; x: number; y: number }) => void
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  /** Branch chaining (v31) — connId → the connections chained directly off it. Passed down so
   *  a row can render its own nested "branch shelf" beneath it. */
  rowsForConnection?: Map<string, AnnotatedConn[]>
  /** VISUAL nesting depth (not the same as conn.chainDepth — a reconverging hop always renders
   *  at depth 1 regardless of its true chain_depth, see the branch-shelf rendering below). 0 =
   *  this row itself is top-level, directly under its chapter node. */
  depth?: number
  onHoverKey?: (key: string | null) => void
}) {
  const [expandedCollapsed, setExpandedCollapsed] = useState(false)
  const replace = useWordReplace()
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  // "v.17 → Isa 52" instead of just "Isaiah 52" with a stray v.17 chip floating next to it —
  // when the SPECIFIC verse on this row's own (origin) chapter is known (a cross-ref click
  // always knows this; see NavOrigin's cross-ref.fromVerse and the recorder's automatic
  // originVersePinFrom capture), it belongs IN the row label, not reassembled by the reader.
  // No book/chapter prefix on the origin side — this row already lives directly under that
  // chapter's own node block, so which chapter v.17 belongs to is never in question.
  const destVerseSuffix = conn.toVerse
    ? conn.toVerseEnd && conn.toVerseEnd !== conn.toVerse ? `:${conn.toVerse}–${conn.toVerseEnd}` : `:${conn.toVerse}`
    : ''
  const chapterDestLabel = `${bookLabel(conn.toBookId ?? '')} ${conn.toChapter}${destVerseSuffix}`
  const baseLabel = isLexicon
    ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare'
      ? `compare · ${bookLabel(conn.toBookId ?? '')} ${conn.toChapter}`
      : conn.toKind === 'note'
        ? 'note'
        : conn.toKind === 'video'
          ? 'video'
          : conn.originVersePinFrom != null
            ? `v.${conn.originVersePinFrom} → ${chapterDestLabel}`
            : chapterDestLabel
  const label = conn.isReturn
    ? `↺ back to step ${conn.returnTargetStep ?? '?'} — ${baseLabel}`
    : conn.isSameChapterBranch
      ? conn.originVersePinFrom != null ? `↳ v.${conn.originVersePinFrom} → v.${conn.toVerse ?? '?'}` : `↳ v.${conn.toVerse ?? '?'}`
      : baseLabel
  const ref = refFor(conn)

  // Branch-shelf nesting — a chain hop that RECONVERGES (its destination is a real chapter,
  // toKind:'chapter') always surfaces to visual depth 1 regardless of its true chainDepth, per
  // the "a branch closing back toward the main spine should read as coming back, not stay
  // buried at max indent" rule. An INTERIOR hop (stays in lexicon-land) nests one level deeper
  // each time, but only up to visual depth 2 by default — a 3rd nested level (a 4th word in a
  // chain) collapses under a "+N more" toggle instead of nesting further, so a chain can never
  // run away visually no matter how deep the underlying data actually goes.
  const children = rowsForConnection?.get(conn.id) ?? []
  const reconvergingChildren = children.filter((c) => c.toKind === 'chapter')
  const interiorChildren = children.filter((c) => c.toKind !== 'chapter')
  const canExpandInterior = depth < 2 || expandedCollapsed
  const visibleInterior = canExpandInterior ? interiorChildren : []
  const collapsedInteriorCount = canExpandInterior ? 0 : interiorChildren.length
  const reconvergeItems = groupForRender(reconvergingChildren)
  const interiorItems = groupForRender(visibleInterior)
  // Only the chain's own ROOT (depth 0, chainDepth 0) shows the badge — a mid-chain row already
  // reads as "inside" a chain from its nesting alone.
  const chain = depth === 0 && conn.hasChainChildren ? chainStats(conn.id, rowsForConnection, conn.createdAt) : null
  const isPromotedChain = !!chain && (chain.maxDepth >= BRANCH_PROMOTE_DEPTH_THRESHOLD || (chain.maxCreatedAt - conn.createdAt) >= BRANCH_PROMOTE_DWELL_MS)
  const hasNested = reconvergeItems.length > 0 || interiorItems.length > 0 || collapsedInteriorCount > 0

  return (
    <div onMouseEnter={() => onHoverKey?.(`row:${conn.id}`)} onMouseLeave={() => onHoverKey?.(null)}>
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
        {isPromotedChain && (
          <span
            title={`A ${chain!.maxDepth + 1}-hop word-study chain`}
            style={{
              fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
              borderRadius: 999, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.03em',
            }}
          >chain</span>
        )}
        {conn.versePinFrom != null && (
          <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))' }}>
            v.{conn.versePinFrom}{conn.versePinTo && conn.versePinTo !== conn.versePinFrom ? `–${conn.versePinTo}` : ''}
          </span>
        )}
        {conn.reasonText && !isLowSignalOrigin(conn) && !conn.isForwardBranch ? (
          <span style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))', fontStyle: 'italic' }}>· {replace(conn.reasonText)}</span>
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
    {hasNested && (
      <div style={{ marginLeft: 15, borderLeft: '1px solid rgb(var(--color-surface-4))', paddingLeft: 8 }}>
        {reconvergeItems.map((it) => it.type === 'single'
          ? <ConnRow key={it.item.id} conn={it.item} depth={1} rowsForConnection={rowsForConnection} onHoverKey={onHoverKey} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} />
          : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        {interiorItems.map((it) => it.type === 'single'
          ? <ConnRow key={it.item.id} conn={it.item} depth={depth + 1} rowsForConnection={rowsForConnection} onHoverKey={onHoverKey} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} />
          : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        {collapsedInteriorCount > 0 && (
          <button
            onClick={() => setExpandedCollapsed(true)}
            style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))', border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer', margin: '2px 0' }}
          >+{collapsedInteriorCount} more</button>
        )}
      </div>
    )}
    </div>
  )
}

function GlanceGroupRow({ items, refFor, openMenu, registerPoint, groupKey }: {
  items: AnnotatedConn[]
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; x: number; y: number }) => void
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
  node, connections, gapToNextMs, isLast, onOpenPrompt, refFor, openMenu, originConn, registerPoint, boundaryLabel, onJumpToOrigin,
  keyboardFocused, dimmed, searchMatched, blockRef, gutterWidth, step, onHoverKey, rowsForConnection,
}: {
  node: TrailNode; connections: AnnotatedConn[]; gapToNextMs: number | null; isLast: boolean
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; x: number; y: number }) => void
  originConn?: TrailConnection
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  boundaryLabel?: string
  onJumpToOrigin?: () => void
  /** Currently selected via ArrowUp/ArrowDown keyboard navigation. */
  keyboardFocused?: boolean
  /** A search filter is active and this node/its rows don't match it. */
  dimmed?: boolean
  /** A search filter is active and this node DOES match it. */
  searchMatched?: boolean
  blockRef?: (el: HTMLDivElement | null) => void
  /** Width (px) of the reserved right-hand gutter column laned return/revisit edges route
   *  through — 0 means no laned edges exist this render, so no column is reserved at all. */
  gutterWidth: number
  /** 1-based chronological position in the session — per the confused-reviewer persona: a
   *  return row can say "back to step 4" in plain text, so confirming it never REQUIRES
   *  successfully tracing the arrow, just reading two numbers. */
  step: number
  /** Hover-to-isolate: reports this node's point key on enter/leave so MapView can dim every
   *  edge not touching it — the design persona's "highest-value 30-minute fix" for making a
   *  dense graph legible without any topology change. */
  onHoverKey?: (key: string | null) => void
  /** Branch chaining (v31) — connId → the connections chained directly off it, threaded down to
   *  every top-level ConnRow so it can render its own nested branch shelf. */
  rowsForConnection?: Map<string, AnnotatedConn[]>
}) {
  const replace = useWordReplace()
  const nodeRef: TrailRef = { kind: 'chapter', bookId: node.bookId, chapter: node.chapter }
  const items = groupForRender(connections)
  const isRevisit = !!node.revisitOfNodeId
  // Shown for every tier now except the genuinely low-signal ones (tab-switch, plain reading)
  // — isConfidentOrigin still separately gates whether a forward connection ALSO earns its own
  // traced branch line (see rowsForNode below), so this widening doesn't reintroduce the
  // duplicate-line clutter that gate was built to prevent; it only widens the plain-text badge.
  const showOrigin = originConn && !isLowSignalOrigin(originConn)
  return (
    <div
      ref={blockRef}
      onMouseEnter={() => onHoverKey?.(`node:${node.id}`)}
      onMouseLeave={() => onHoverKey?.(null)}
      style={{
        opacity: dimmed ? 0.3 : 1, borderRadius: 8, transition: 'opacity 120ms, box-shadow 120ms',
        boxShadow: keyboardFocused ? '0 0 0 2px rgb(var(--color-accent))' : searchMatched ? '0 0 0 2px rgb(var(--color-accent) / 0.4)' : 'none',
      }}
    >
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
            onContextMenu={(e) => openTrailRefMenu(openMenu, nodeRef, e, onJumpToOrigin)}
            style={{
              fontFamily: 'ui-monospace, monospace', fontSize: isRevisit ? 12 : 13.5, fontWeight: 600, cursor: 'pointer',
              color: isRevisit ? 'rgb(var(--color-text-secondary))' : 'rgb(var(--color-text-primary))',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{
              fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', opacity: 0.7,
              minWidth: 14, textAlign: 'right', flexShrink: 0,
            }}>{step}</span>
            {bookLabel(node.bookId)} {node.chapter}
            {isRevisit && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
                borderRadius: 999, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.03em',
              }}>revisit</span>
            )}
          </div>
        </TrailHoverCard>
        {node.cachedSubnote && <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 1 }}>{replace(node.cachedSubnote)}</div>}
        <div style={{ marginTop: 4 }}>
          {items.map((it) => it.type === 'single'
            ? <ConnRow key={it.item.id} conn={it.item} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} rowsForConnection={rowsForConnection} onHoverKey={onHoverKey} />
            : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        </div>
      </div>
      {gutterWidth > 0 && (
        // Reserved space for laned return/revisit edges to route through — a fixed width
        // shared by EVERY row (registering the point from each row is harmless/idempotent
        // since they all land at the same x once layout resolves; simpler and more robust
        // than assuming any one particular row is guaranteed to render).
        <div ref={registerPoint('gutter:x')} style={{ width: gutterWidth, flexShrink: 0 }} />
      )}
      </div>
    </div>
  )
}

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2

export default function MapView({
  detail, onChanged, boundaryLabelForNodeId, zoom: zoomProp, onZoomChange,
}: {
  detail: TrailSessionDetail; onChanged: () => void; boundaryLabelForNodeId?: Map<string, string>
  /** Zoom is normally OWNED by StudyTrailApp (rendered in its title bar, top-right, so it
   *  applies consistently whether you're looking at one session or the merged Everything
   *  timeline) — these are optional purely so MapView still works if ever mounted standalone
   *  without a controlling parent. */
  zoom?: number
  onZoomChange?: (zoom: number) => void
}) {
  const [promptConn, setPromptConn] = useState<TrailConnection | null>(null)
  const { menu, menuRef, openMenu, closeMenu } = useTrailRefMenu()
  const { pointsRef, registerPoint } = useTrailConnectorPoints()
  const containerRef = useRef<HTMLDivElement>(null)
  const needsInputCount = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length

  const [ownZoom, setOwnZoom] = useState(1)
  const zoom = zoomProp ?? ownZoom
  const setZoom = onZoomChange ?? setOwnZoom

  // Quick filter/highlight while looking at a (possibly long) spine — not a replacement for
  // the Review tab's cross-session search, just a way to spot things without scrolling/reading
  // every row. Matches against the chapter label and every connection's label/reasonText.
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Hover-to-isolate — the design persona's highest-value/lowest-effort fix: hovering any node
  // or connection row dims every edge that doesn't touch it, no topology change required. Wired
  // into the edges array just before it's passed to the overlay (see below).
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // Basic ArrowUp/ArrowDown spine navigation — Enter opens the focused chapter. Ignored
  // whenever an input/textarea has focus (renaming a session, typing in the search box above,
  // etc.) so it never hijacks normal typing.
  const [keyboardFocusId, setKeyboardFocusId] = useState<string | null>(null)
  const nodeBlockRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
      if (detail.nodes.length === 0) return
      e.preventDefault()
      if (e.key === 'Enter') {
        if (keyboardFocusId) navigateTrailRef({ kind: 'chapter', bookId: detail.nodes.find((n) => n.id === keyboardFocusId)!.bookId, chapter: detail.nodes.find((n) => n.id === keyboardFocusId)!.chapter }, false)
        return
      }
      const curIdx = keyboardFocusId ? detail.nodes.findIndex((n) => n.id === keyboardFocusId) : -1
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(detail.nodes.length - 1, curIdx + 1)
        : Math.max(0, curIdx === -1 ? detail.nodes.length - 1 : curIdx - 1)
      const nextId = detail.nodes[nextIdx].id
      setKeyboardFocusId(nextId)
      nodeBlockRefs.current.get(nextId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detail.nodes, keyboardFocusId])

  // Real proportional zoom (a CSS transform on the whole spine), not just a spacing/font-size
  // slider — trackpad pinch and Ctrl+scroll both arrive as wheel events with ctrlKey=true (the
  // standard way browsers report pinch gestures), so a single wheel listener covers both. The
  // scaled content sits inside its own scrollable viewport (below) so zooming in doesn't clip
  // against the panel's outer scroll area.
  function onWheelZoom(e: React.WheelEvent) {
    if (!e.ctrlKey) return // a plain (non-pinch) wheel scroll should keep scrolling normally
    e.preventDefault()
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom - e.deltaY * 0.01)))
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
  // 1-based chronological position — lets a return row read "back to step 4" in plain text
  // instead of requiring the arrow to be traced (confused-reviewer persona). Declared here
  // (rather than just below, where it's also used for lane min/max idx) so the rowsForNode
  // build below can already resolve a return's target step while annotating isReturn.
  const nodeOrderIndex = new Map<string, number>()
  detail.nodes.forEach((n, i) => nodeOrderIndex.set(n.id, i))

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

  // "Scroll to where this came from" — tries the exact originating ROW first (a branch stop
  // like a Strong's lookup, if one is actually rendered as its own row); falls back to the
  // originating CHAPTER's own spine dot when the origin was a plain forward connection with no
  // distinct row (the common "just kept reading onward" case), so the action is always useful
  // even when there's nothing more specific to point at.
  function jumpToOrigin(conn: TrailConnection) {
    const el = pointsRef.current.get(`row:${conn.id}`) ?? pointsRef.current.get(`node:${conn.fromNodeId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function refFor(conn: TrailConnection): TrailRef | null {
    if (conn.toKind === 'lexicon' && conn.toStrongsNum) return { kind: 'lexicon', strongsNum: conn.toStrongsNum }
    if ((conn.toKind === 'chapter' || conn.toKind === 'compare') && conn.toBookId && conn.toChapter != null) {
      return { kind: 'chapter', bookId: conn.toBookId, chapter: conn.toChapter, verse: conn.toVerse }
    }
    return null
  }

  // Connections actually rendered as rows under each node: every non-chapter connection, plus
  // chapter-connections that are a ROUND TRIP (destination isn't the literal next spine node),
  // PLUS forward chapter-connections whose origin is something specific enough to be worth
  // tracing (a Strong's lookup, a cross-ref, a search — anything that isn't just plain
  // sequential reading or a tab-switch). That last category used to be silently skipped
  // entirely (the plain spine arrow already implies "next chapter," so a row felt redundant)
  // — but that's exactly what read as "no indication of where I got that from": the ORIGIN
  // BADGE LINE said "via Strong's G3942 occurrence" in text, yet no actual LINE traced back to
  // that specific lookup, only the generic straight spine progression every chapter gets. Now
  // a specific-origin forward connection gets its own row too (marked `isForwardBranch`, no ↺
  // prefix — it's not a return, just a traceable cause) feeding a direct edge in the overlay
  // below, alongside the spine arrow it doesn't replace.
  //
  // A round-trip connection (destination matches an EARLIER/different existing node) is
  // annotated `isReturn` so ConnRow can prefix it with ↺ instead of implying a fresh move —
  // and feeds a laned return edge in the overlay (built below).
  // Branch chaining (v31) — a connection with fromConnectionId set hangs off ANOTHER
  // connection, not directly off its chapter node; it's excluded from rowsForNode's top-level
  // bucket below and instead rendered nested under its parent row (see ConnRow's own recursive
  // rendering of rowsForConnection.get(its own id)).
  const rowsForConnection = new Map<string, AnnotatedConn[]>()
  const hasChainChildrenIds = new Set<string>()
  for (const c of detail.connections) {
    if (!c.fromConnectionId) continue
    hasChainChildrenIds.add(c.fromConnectionId)
  }

  const rowsForNode = new Map<string, AnnotatedConn[]>()
  for (const n of detail.nodes) rowsForNode.set(n.id, [])
  for (const c of detail.connections) {
    let annotated: AnnotatedConn = { ...c, isChainedBranch: !!c.fromConnectionId, hasChainChildren: hasChainChildrenIds.has(c.id) }
    if (c.toKind === 'chapter' && c.toBookId && c.toChapter != null) {
      // A cross-ref that landed in the SAME chapter as its own fromNode (see the sameChapter
      // branch in studyTrailSlice.ts) — the "target" resolves to the very node this row is
      // rendered under, which is neither a forward move nor a round trip, just a same-chapter
      // branch. Checked first so it can never fall through into the isReturn self-loop case.
      const selfTarget = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
      if (selfTarget && selfTarget.id === c.fromNodeId) {
        annotated = { ...annotated, isSameChapterBranch: true }
      } else {
        const next = nextNodeById.get(c.fromNodeId)
        const isForward = next && next.trailSessionId === c.trailSessionId && next.bookId === c.toBookId && next.chapter === c.toChapter
        if (isForward) {
          if (!isConfidentOrigin(c) && !annotated.isChainedBranch) continue // no row at all — matches prior behavior exactly
          annotated = { ...annotated, isForwardBranch: true }
        } else {
          const target = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
          annotated = { ...annotated, isReturn: !!target, returnTargetStep: target ? nodeOrderIndex.get(target.id)! + 1 : undefined }
        }
      }
    }
    if (annotated.isChainedBranch) {
      const bucket = rowsForConnection.get(c.fromConnectionId!) ?? []
      bucket.push(annotated)
      rowsForConnection.set(c.fromConnectionId!, bucket)
      continue
    }
    const bucket = rowsForNode.get(c.fromNodeId)
    if (bucket) bucket.push(annotated)
  }

  // The connected-lines engine's edge list — built from the same data that drives the rows
  // above, so the diagram can never drift out of sync with what's actually displayed.
  //
  // Return/revisit edges get routed through a shared right-hand GUTTER instead of a bezier
  // bulge — a bulge can't reliably clear content of unbounded width, and two such edges whose
  // vertical spans overlap would just visually merge. Each gets a "lane" (a git-graph-style
  // greedy interval-packing assignment: the lowest lane number whose reserved node-index range
  // doesn't overlap this edge's own span) and routes as a vertical line confined to that lane,
  // jogging horizontally only at the very top/bottom — it can never cross an intervening
  // chapter's text again. Forward-branch edges stay short (row → the very next node) and don't
  // need a lane.
  interface LanedEdge extends TrailEdge { minIdx: number; maxIdx: number }
  const lanedRaw: LanedEdge[] = []

  const edges: TrailEdge[] = []
  for (let i = 0; i < detail.nodes.length - 1; i++) {
    // Skip across a session boundary (merged all-sessions timeline) — chronologically
    // adjacent nodes from two DIFFERENT sessions shouldn't visually read as one continuous
    // read-through just because they happen to be time-adjacent.
    if (detail.nodes[i].trailSessionId !== detail.nodes[i + 1].trailSessionId) continue
    edges.push({ key: `spine:${detail.nodes[i].id}`, from: `node:${detail.nodes[i].id}`, to: `node:${detail.nodes[i + 1].id}`, color: 'rgb(var(--color-accent))', arrow: true })
  }

  // Shared per-row edge logic — called for every row regardless of whether it's a top-level
  // row (stub from its chapter node) or a chained branch row (stub from its PARENT row's own
  // point instead, per the v31 branch-chaining work: "arrows connect from the true branch," not
  // a generic/frozen point). `stubFrom` is the point key this row's own short connector starts
  // at; isReturn/isForwardBranch edges are identical either way since they're keyed off the
  // row's own `row:${c.id}` point, which exists regardless of nesting depth.
  function pushRowEdges(c: AnnotatedConn, stubFrom: string) {
    const color = TIER_COLOR[c.clarityTier] ?? 'rgb(var(--color-text-muted))'
    edges.push({ key: `stub:${c.id}`, from: stubFrom, to: `row:${c.id}`, color, dashed: c.weight === 'glance', curved: false, opacity: 0.5 })
    if (c.isReturn && c.toBookId && c.toChapter != null) {
      const target = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
      if (target) {
        const fromIdx = nodeOrderIndex.get(c.fromNodeId)!, toIdx = nodeOrderIndex.get(target.id)!
        lanedRaw.push({
          key: `return:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`, color, arrow: true,
          minIdx: Math.min(fromIdx, toIdx), maxIdx: Math.max(fromIdx, toIdx),
        })
      }
    }
    if (c.isForwardBranch) {
      // The specific-origin trace for an otherwise-plain forward move — short (always the
      // very next node), so a direct curved line is fine, no lane needed. Also how a branch
      // CHAIN's terminal hop reconverges into the spine — the target is still "the next node
      // after the chain's ROOT chapter" (fromNodeId always stays the root), which is correct
      // because arriving at a new chapter only ever happens right when this connection is
      // written, so it's always the true next spine entry chronologically.
      const target = nextNodeById.get(c.fromNodeId)
      if (target) edges.push({ key: `origin:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`, color, curved: true, arrow: true, opacity: 0.85 })
    }
  }

  for (const n of detail.nodes) {
    const items = groupForRender(rowsForNode.get(n.id) ?? [])
    for (const it of items) {
      if (it.type === 'single') {
        pushRowEdges(it.item, `node:${n.id}`)
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
      const fromIdx = nodeOrderIndex.get(n.id)!, toIdx = nodeOrderIndex.get(n.revisitOfNodeId)!
      lanedRaw.push({
        key: `revisit-link:${n.id}`, from: `node:${n.id}`, to: `node:${n.revisitOfNodeId}`,
        color: 'rgb(var(--color-text-muted))', dashed: true, opacity: 0.35,
        minIdx: Math.min(fromIdx, toIdx), maxIdx: Math.max(fromIdx, toIdx),
      })
    }
  }

  // Chained branch rows (excluded from rowsForNode above) get the same per-row edges, but
  // their short local stub starts from their PARENT connection's own row point instead of a
  // chapter node — this is the "arrows properly connect... originate from the TRUE last stop"
  // fix: no generic/frozen point is ever used, TrailConnectorOverlay measures real registered
  // DOM elements live regardless of nesting depth.
  for (const [parentConnId, children] of rowsForConnection) {
    for (const it of groupForRender(children)) {
      if (it.type === 'single') pushRowEdges(it.item, `row:${parentConnId}`)
      else {
        const color = TIER_COLOR[it.items[0].clarityTier] ?? 'rgb(var(--color-text-muted))'
        edges.push({ key: `stub:${it.key}`, from: `row:${parentConnId}`, to: it.key, color, dashed: true, curved: false, opacity: 0.4 })
      }
    }
  }

  // Greedy lane packing (standard interval-scheduling — same idea git-graph tools use for
  // branch lanes): process by start index, give each edge the lowest lane whose
  // previously-assigned span doesn't overlap this one.
  lanedRaw.sort((a, b) => a.minIdx - b.minIdx)
  const laneEnds: number[] = []
  for (const e of lanedRaw) {
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] >= e.minIdx) lane++
    laneEnds[lane] = e.maxIdx
    edges.push({ ...e, lane })
  }
  const maxLane = laneEnds.length > 0 ? laneEnds.length - 1 : -1
  const gutterWidth = maxLane >= 0 ? GUTTER_BASE + maxLane * LANE_SPACING : 0

  // Hover-to-isolate — dim every edge that doesn't touch the hovered node/row, no topology
  // change required. hoveredKey/onHoverKey are reported by NodeBlock and ConnRow below.
  const touchesHover = (e: TrailEdge) => !hoveredKey || e.from === hoveredKey || e.to === hoveredKey
  const finalEdges = hoveredKey ? edges.map((e) => touchesHover(e) ? e : { ...e, opacity: (e.opacity ?? 1) * 0.15 }) : edges

  const q = searchQuery.trim().toLowerCase()
  const matchedNodeIds = new Set<string>()
  if (q) {
    for (const n of detail.nodes) {
      const nodeText = `${bookLabel(n.bookId)} ${n.chapter}`.toLowerCase()
      const rowMatch = (rowsForNode.get(n.id) ?? []).some((c) =>
        (c.toStrongsNum ?? '').toLowerCase().includes(q) ||
        (c.reasonText ?? '').toLowerCase().includes(q) ||
        (c.toBookId ? bookLabel(c.toBookId).toLowerCase() : '').includes(q))
      if (nodeText.includes(q) || rowMatch) matchedNodeIds.add(n.id)
    }
  }
  function jumpToFirstMatch() {
    const first = detail.nodes.find((n) => matchedNodeIds.has(n.id))
    if (first) nodeBlockRefs.current.get(first.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ marginBottom: 10 }}>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') jumpToFirstMatch() }}
          placeholder="Filter this timeline… (chapter, Strong's number, reason)"
          style={{
            width: '100%', fontSize: 12, padding: '6px 9px', background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, color: 'rgb(var(--color-text-primary))',
          }}
        />
      </div>
      <div onWheel={onWheelZoom} style={{ overflow: 'auto' }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 'max-content' }}>
          <div ref={containerRef} style={{ position: 'relative' }}>
            <TrailConnectorOverlay containerRef={containerRef} pointsRef={pointsRef} edges={finalEdges} zoom={zoom} />
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
              onJumpToOrigin={originConnByNodeId.has(n.id) ? () => jumpToOrigin(originConnByNodeId.get(n.id)!) : undefined}
              step={i + 1}
              onHoverKey={setHoveredKey}
              keyboardFocused={keyboardFocusId === n.id}
              dimmed={!!q && !matchedNodeIds.has(n.id)}
              searchMatched={!!q && matchedNodeIds.has(n.id)}
              blockRef={(el) => { if (el) nodeBlockRefs.current.set(n.id, el); else nodeBlockRefs.current.delete(n.id) }}
              gutterWidth={gutterWidth}
              rowsForConnection={rowsForConnection}
            />
          )
        })}
        {detail.nodes.length === 0 && (
          <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>Nothing recorded yet — navigate around the app while this session is live.</div>
        )}

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
