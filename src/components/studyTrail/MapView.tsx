import { useEffect, useRef, useState } from 'react'
import { Pencil, Copy } from 'lucide-react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, navigateTrailRef, type TrailRef } from './trailNav'
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

// REMOVED (was OriginBadgeLine, the always-visible "via X" line above a node) — round-tripped
// through tier-1-only, then tier-2/3-with-hedge, then back to tier-1-only, and per this round's
// direct feedback it's gone entirely now: "i dont think the 'via Strong's G3619 occurrence' and
// such should be showing outside of the hover thing... only really main text and chapters and
// strongs and such should be showing outside of the hover thing." The full "via ..." fact for
// every tier still lives in the hover card (TrailHoverContent.tsx's OriginLine) — this was a
// deliberate simplification to keep the always-visible area clean, not an oversight.

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
  /** Branch chaining (v31) — hangs off ANOTHER connection (fromConnectionId set), not directly
   *  off its chapter node; renders nested under its parent row instead of as a sibling. */
  isChainedBranch?: boolean
  /** At least one other connection is chained off THIS one — needs to render its own nested
   *  sub-shelf beneath it. */
  hasChainChildren?: boolean
}

// Walks a chain's FULL descendant tree (however deep the underlying chain_depth actually goes)
// into one flat, chronologically-ordered list. Replaces an earlier per-level recursive-nesting
// design — per direct feedback ("one indent for the whole chain, then flat... this can just be
// straight down") a chain reads as one branch off its chapter, not a staircase of indents per
// hop. Also used for the "chain" badge stat (maxDepth/span) so both concerns share one walk.
function flattenChain(connId: string, rowsForConnection: Map<string, AnnotatedConn[]> | undefined): AnnotatedConn[] {
  const kids = rowsForConnection?.get(connId) ?? []
  const out: AnnotatedConn[] = []
  for (const k of kids) {
    out.push(k)
    out.push(...flattenChain(k.id, rowsForConnection))
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

// The connection's OWN user-written note, as its own separate floating bubble (see
// TrailHoverCard's secondaryContent) — never merged into the auto-detected-facts hover card.
// Only rendered at all when there's actually something to show (a blank note popover has
// nothing worth a second bubble for). Its own copy button per direct feedback: "the copy
// button... should be in the note when the user hovers over the connection... that'll have a
// copy button" — copying no longer requires opening the editor popover at all.
function TrailNoteBubbleContent({ conn }: { conn: TrailConnection }) {
  const replace = useWordReplace()
  async function copy() {
    const lines = [conn.userNote?.trim(), ...conn.tiesFrom, ...conn.tiesTo].filter(Boolean) as string[]
    try { await navigator.clipboard.writeText(lines.join('\n')) } catch { /* clipboard unavailable — no-op */ }
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.04em' }}>Your note</span>
        <button
          onClick={copy} title="Copy this note"
          style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 0, display: 'flex' }}
        ><Copy size={11} /></button>
      </div>
      {conn.userNote && <div style={{ fontSize: 12, color: 'rgb(var(--color-text-primary))', lineHeight: 1.4, marginBottom: (conn.tiesFrom.length || conn.tiesTo.length) ? 6 : 0 }}>{replace(conn.userNote)}</div>}
      {conn.tiesFrom.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-secondary))', marginBottom: 2 }}>From: {conn.tiesFrom.join(', ')}</div>
      )}
      {conn.tiesTo.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-secondary))' }}>To: {conn.tiesTo.join(', ')}</div>
      )}
    </div>
  )
}

function ConnRow({ conn, refFor, onOpenPrompt, openMenu, registerPoint, rowsForConnection, onHoverKey, originBookId, originChapter }: {
  conn: AnnotatedConn
  refFor: (conn: TrailConnection) => TrailRef | null
  onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; x: number; y: number }) => void
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  /** Branch chaining (v31) — connId → the connections chained directly off it. Only read by a
   *  ROOT row (one not itself chained off another) — see flattenChain above; a row rendered
   *  INSIDE that flat list never looks up its own children again (would double-render). */
  rowsForConnection?: Map<string, AnnotatedConn[]>
  onHoverKey?: (key: string | null) => void
  /** The chapter this row's connection actually originates FROM — its parent NodeBlock's own
   *  book/chapter. Used to render the full "Jeremiah 23:3" origin reference (not just a bare
   *  "v.3") per direct feedback: "when the chapter or whatever comes from a verse, this should
   *  be seen not just in the hover but also in the branch showing something like 'Jeremiah
   *  23:3'." */
  originBookId?: string
  originChapter?: number
}) {
  const [expandedCollapsed, setExpandedCollapsed] = useState(false)
  const replace = useWordReplace()
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  // Full "Jeremiah 23:3" origin reference (not just a bare "v.3") whenever the origin
  // chapter is known — always true for a top-level row (its parent NodeBlock IS that
  // chapter); still falls back to the bare verse number for the rare caller that can't
  // supply it (e.g. a glance-group's expanded list, several chapters removed from any one
  // origin) rather than showing nothing at all.
  const originLabel = (v: number) => originBookId && originChapter != null
    ? `${bookLabel(originBookId)} ${originChapter}:${v}`
    : `v.${v}`
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
            ? `${originLabel(conn.originVersePinFrom)} → ${chapterDestLabel}`
            : chapterDestLabel
  // "back to step N" text was tried and explicitly rejected ("i dont like the text 'back to
  // step 6'") — reverted to the plain ↺ prefix; the arrow itself (now curved/subtle, see
  // TrailConnectorOverlay's arc routing) carries the "this is a return" signal instead of text.
  const label = conn.isReturn
    ? `↺ ${baseLabel}`
    : conn.isSameChapterBranch
      ? conn.originVersePinFrom != null ? `↳ ${originLabel(conn.originVersePinFrom)} → v.${conn.toVerse ?? '?'}` : `↳ v.${conn.toVerse ?? '?'}`
      : baseLabel
  const ref = refFor(conn)

  // One flat list for the whole chain, one indent level — see flattenChain above. A very long
  // chain (rare, but a real risk once nothing caps depth) still gets a soft cap so the list
  // itself can't run away; raised generously (8, vs. the old 2-LEVEL nesting cap) since the
  // actual complaint was indentation depth, not list length.
  const FLAT_CHAIN_VISIBLE_CAP = 8
  const fullChain = conn.hasChainChildren ? flattenChain(conn.id, rowsForConnection) : []
  const visibleChain = expandedCollapsed ? fullChain : fullChain.slice(0, FLAT_CHAIN_VISIBLE_CAP)
  const collapsedChainCount = expandedCollapsed ? 0 : Math.max(0, fullChain.length - FLAT_CHAIN_VISIBLE_CAP)
  const chainItems = groupForRender(visibleChain)
  const isPromotedChain = fullChain.length > 0 && (
    fullChain.length >= BRANCH_PROMOTE_DEPTH_THRESHOLD ||
    (fullChain[fullChain.length - 1].createdAt - conn.createdAt) >= BRANCH_PROMOTE_DWELL_MS
  )
  const hasNested = chainItems.length > 0 || collapsedChainCount > 0

  return (
    <div onMouseEnter={() => onHoverKey?.(`row:${conn.id}`)} onMouseLeave={() => onHoverKey?.(null)}>
    <TrailHoverCard
      content={<TrailConnectionHoverContent conn={conn} />}
      secondaryContent={(conn.userNote || conn.tiesFrom.length > 0 || conn.tiesTo.length > 0) ? <TrailNoteBubbleContent conn={conn} /> : undefined}
    >
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
            title={`A ${fullChain.length + 1}-hop word-study chain`}
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
        {/* The inline "· {reason}" text (e.g. "· a search for 'eze2'") was removed per direct
            feedback — it's exactly the kind of "via ..." reasoning that should now only ever
            show in the hover card, not always-visible next to the row. */}
        {needsInput ? (
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
        {/* Unified reason/note trigger — ALWAYS present now, not gated to tier-3 needsInput the
            way the "?" badge above is. Opens the same popover pre-filled with whatever's
            already stored; the "?" badge stays as its own distinct always-nagging affordance
            for a genuinely unresolved ambiguous jump, this is the calm "add a note anytime" one. */}
        <button
          onClick={() => onOpenPrompt(conn)}
          title={conn.reasonText || conn.ties.length > 0 ? 'Edit your note for this connection' : 'Add a note for this connection'}
          style={{
            background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer',
            padding: 0, flexShrink: 0, opacity: 0.55, display: 'flex', alignItems: 'center',
          }}
        ><Pencil size={10.5} /></button>
      </div>
    </TrailHoverCard>
    {hasNested && (
      // Fully flat, no indent at all — per direct feedback ("straight down"), a chain hop
      // renders as a plain sibling row at the EXACT same level as the one before it, not
      // nested one step in. The chaining data (fromConnectionId) still exists and still drives
      // correct arrow-origin behavior (see pushRowEdges) — it just no longer implies any visual
      // indentation of its own.
      <>
        {chainItems.map((it) => it.type === 'single'
          ? <ConnRow key={it.item.id} conn={it.item} onHoverKey={onHoverKey} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} originBookId={originBookId} originChapter={originChapter} />
          : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        {collapsedChainCount > 0 && (
          <button
            onClick={() => setExpandedCollapsed(true)}
            style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))', border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer', margin: '2px 0' }}
          >+{collapsedChainCount} more</button>
        )}
      </>
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

// Revisit promotion is unconditional now (see studyTrailSlice.ts) — a rapid back-and-forth
// between chapters produces a real run of promoted nodes, which would otherwise look like N
// separate full spine entries for what was really one quick flurry of checking. Collapses a
// CONSECUTIVE run (in spine order) of nodes sharing the same non-null clusterId into one
// compact summary, mirroring GlanceGroupRow's collapse/expand pattern one level up.
type NodeRenderItem = { type: 'single'; node: TrailNode; index: number } | { type: 'cluster'; nodes: TrailNode[]; startIndex: number }

function groupNodesForRender(nodes: TrailNode[]): NodeRenderItem[] {
  const out: NodeRenderItem[] = []
  let i = 0
  while (i < nodes.length) {
    const n = nodes[i]
    if (n.clusterId) {
      let j = i + 1
      while (j < nodes.length && nodes[j].clusterId === n.clusterId) j++
      if (j - i >= 2) {
        out.push({ type: 'cluster', nodes: nodes.slice(i, j), startIndex: i })
        i = j
        continue
      }
    }
    out.push({ type: 'single', node: n, index: i })
    i++
  }
  return out
}

function NodeClusterGroup({
  nodes, registerPoint, onHoverKey, connectionsByNodeId, nodeOrderIndex,
  onOpenPrompt, refFor, openMenu, originConnByNodeId, jumpToOrigin, rowsForConnection,
}: {
  nodes: TrailNode[]
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  onHoverKey?: (key: string | null) => void
  connectionsByNodeId: Map<string, AnnotatedConn[]>
  nodeOrderIndex: Map<string, number>
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; x: number; y: number }) => void
  originConnByNodeId: Map<string, TrailConnection>
  jumpToOrigin: (conn: TrailConnection) => void
  rowsForConnection: Map<string, AnnotatedConn[]>
}) {
  const [expanded, setExpanded] = useState(false)
  if (expanded) {
    return (
      <div>
        {nodes.map((n) => (
          <NodeBlock
            key={n.id} node={n} connections={connectionsByNodeId.get(n.id) ?? []} gapToNextMs={null} isLast={false}
            step={(nodeOrderIndex.get(n.id) ?? -1) + 1} registerPoint={registerPoint} onHoverKey={onHoverKey}
            onOpenPrompt={onOpenPrompt} refFor={refFor} openMenu={openMenu}
            originConn={originConnByNodeId.get(n.id)}
            onJumpToOrigin={originConnByNodeId.has(n.id) ? () => jumpToOrigin(originConnByNodeId.get(n.id)!) : undefined}
            gutterWidth={0} rowsForConnection={rowsForConnection}
          />
        ))}
        <button onClick={() => setExpanded(false)} style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0 8px 21px' }}>▾ collapse</button>
      </div>
    )
  }
  const first = nodes[0], last = nodes[nodes.length - 1]
  const spanMs = (last.anchorEndedAt ?? last.anchorStartedAt) - first.anchorStartedAt
  // No separate summary row anymore — per direct feedback ("i dont like having the bounced
  // between as a separate bullet... show these things better and more simply without so much
  // text"), the collapsed state renders the FIRST and LAST node of the run as ordinary bullets
  // (full connections, hover card, context menu — nothing lost), with everything in between
  // hidden until expanded, and a small "⇄ Nx" badge on the last one standing in for the whole
  // "bounced between X and Y over 3m" sentence (still available via the badge's tooltip).
  return (
    <div>
      <NodeBlock
        node={first} connections={connectionsByNodeId.get(first.id) ?? []} gapToNextMs={null} isLast={false}
        step={(nodeOrderIndex.get(first.id) ?? -1) + 1} registerPoint={registerPoint} onHoverKey={onHoverKey}
        onOpenPrompt={onOpenPrompt} refFor={refFor} openMenu={openMenu}
        originConn={originConnByNodeId.get(first.id)}
        onJumpToOrigin={originConnByNodeId.has(first.id) ? () => jumpToOrigin(originConnByNodeId.get(first.id)!) : undefined}
        gutterWidth={0} rowsForConnection={rowsForConnection}
      />
      <NodeBlock
        node={last} connections={connectionsByNodeId.get(last.id) ?? []} gapToNextMs={null} isLast={false}
        step={(nodeOrderIndex.get(last.id) ?? -1) + 1} registerPoint={registerPoint} onHoverKey={onHoverKey}
        onOpenPrompt={onOpenPrompt} refFor={refFor} openMenu={openMenu}
        originConn={originConnByNodeId.get(last.id)}
        onJumpToOrigin={originConnByNodeId.has(last.id) ? () => jumpToOrigin(originConnByNodeId.get(last.id)!) : undefined}
        gutterWidth={0} rowsForConnection={rowsForConnection}
        bounceBadge={{ count: nodes.length - 1, spanMs, onExpand: () => setExpanded(true) }}
      />
    </div>
  )
}

function NodeBlock({
  node, connections, gapToNextMs, isLast, onOpenPrompt, refFor, openMenu, originConn, registerPoint, boundaryLabel, onJumpToOrigin,
  keyboardFocused, dimmed, searchMatched, blockRef, gutterWidth, step, onHoverKey, rowsForConnection, onDeleteNode, bounceBadge,
}: {
  node: TrailNode; connections: AnnotatedConn[]; gapToNextMs: number | null; isLast: boolean
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; x: number; y: number }) => void
  originConn?: TrailConnection
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  boundaryLabel?: string
  onJumpToOrigin?: () => void
  /** Right-click "Delete" on this node's bullet — removes the node and its directly-attached
   *  branch connections, with a confirmation step (see TrailRefContextMenu). */
  onDeleteNode?: (nodeId: string) => void
  /** A collapsed cluster's summary badge, rendered inline in this node's header instead of a
   *  separate row — see NodeClusterGroup. */
  bounceBadge?: { count: number; spanMs: number; onExpand: () => void }
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
      {/* v36 — a user-marked topic break: a plain divider on the main spine (not a new
          sub-spine), same visual language as the session boundaryLabel above but distinct
          styling (accent-tinted) so it's clearly a deliberate user marker, not an automatic
          session/date grouping. */}
      {node.isTopicBreak && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px', paddingLeft: 21,
          fontSize: 10.5, fontWeight: 700, color: 'rgb(var(--color-accent))', textTransform: 'uppercase', letterSpacing: '.05em',
        }}>
          <span style={{ flexShrink: 0 }}>New topic</span>
          <span style={{ flex: 1, height: 1, background: 'rgb(var(--color-accent) / 0.35)' }} />
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
        {/* OriginBadgeLine (the always-visible "via X" line) was removed per direct feedback:
            "i dont think the 'via Strong's G3619 occurrence' and such should be showing
            outside of the hover thing... only really main text and chapters and strongs and
            such should be showing outside of the hover thing" — keeps the always-visible area
            clean (bare chapter/verse/Strong's-number labels only) so the connection lines
            themselves read more clearly; the full "via ..." fact is still one hover away, see
            TrailNodeHoverContent below. */}
        <TrailHoverCard content={<TrailNodeHoverContent node={node} originConn={originConn} />}>
          <div
            onClick={(e) => trailRefClick(nodeRef, e)}
            onContextMenu={(e) => openTrailRefMenu(openMenu, nodeRef, e, onJumpToOrigin, onDeleteNode ? () => onDeleteNode(node.id) : undefined)}
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
            {isRevisit && !bounceBadge && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
                borderRadius: 999, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.03em',
              }}>revisit</span>
            )}
            {/* Replaces the old standalone "↺ Bounced between X and Y over 3m · 2x" text row —
                per direct feedback ("i dont like having the bounced between as a separate
                bullet... show these things better and more simply without so much text"), a
                quick back-and-forth collapses into a small badge right on the node it ended on
                instead of its own row. Full detail (span, count, both chapters) lives in the
                title tooltip; clicking expands the individual bounce visits, same as before. */}
            {bounceBadge && (
              <button
                onClick={(e) => { e.stopPropagation(); bounceBadge.onExpand() }}
                title={`Bounced ${bounceBadge.count}x over ${formatGap(bounceBadge.spanMs)}`}
                style={{
                  fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-accent))', background: 'rgb(var(--color-accent) / 0.14)',
                  border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer', letterSpacing: '.01em',
                }}
              >⇄ {bounceBadge.count}x</button>
            )}
          </div>
        </TrailHoverCard>
        {node.cachedSubnote && <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 1 }}>{replace(node.cachedSubnote)}</div>}
        <div style={{ marginTop: 4 }}>
          {items.map((it) => it.type === 'single'
            ? <ConnRow key={it.item.id} conn={it.item} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} rowsForConnection={rowsForConnection} onHoverKey={onHoverKey} originBookId={node.bookId} originChapter={node.chapter} />
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
  const { pointsRef, registerPoint } = useTrailConnectorPoints()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const needsInputCount = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length

  // Open scrolled to the MOST RECENT event by default, not the earliest — per direct feedback
  // ("when opening any of the timeline things, even in everything, it should scroll to the
  // bottom by default"). Same idiom as AiLookupPanel.tsx's chat auto-scroll. Keyed on the node
  // count so it re-fires once data actually finishes loading (detail starts empty on mount).
  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight })
  }, [detail.nodes.length])

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
  const { menu, menuRef, openMenu: openMenuRaw, closeMenu } = useTrailRefMenu()
  // Right-clicking a row/node to open its context menu, then dismissing the menu by clicking
  // elsewhere WITHOUT first moving the mouse back over the original row, never fires that
  // row's own onMouseLeave — hoveredKey was getting stuck pointing at it forever, leaving
  // every OTHER edge dimmed to 15% opacity permanently ("when i rightclick, it removes all the
  // lines and stuff and they dont come back"). Clearing it the moment a menu opens closes that
  // gap regardless of how the menu later gets dismissed.
  function openMenu(data: Parameters<typeof openMenuRaw>[0]) {
    setHoveredKey(null)
    openMenuRaw(data)
  }

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

  // Node ids that have a SPECIFIC traced arrival (an isForwardBranch row, below) — the plain
  // generic spine arrow between chronologically-adjacent nodes is suppressed for these (see the
  // spine-edge loop): "if a user gets to a chapter from a branch, then dont show the arrow from
  // the previous chapter if it came from the branch" — showing both was redundant/confusing
  // once the specific traced line already tells the real story.
  const nodesWithTracedArrival = new Set<string>()

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
          nodesWithTracedArrival.add(next!.id)
        } else {
          const target = nodeByKey.get(`${c.trailSessionId}:${c.toBookId}:${c.toChapter}`)
          annotated = { ...annotated, isReturn: !!target }
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
    // Suppressed when the arrival already has its own specific traced line (the `origin:${c.id}`
    // edge from the causing row, built below) — showing the generic spine arrow ALONGSIDE the
    // specific one was exactly the redundant "arrow from the previous chapter" the branch-traced
    // line already makes clear.
    if (nodesWithTracedArrival.has(detail.nodes[i + 1].id)) continue
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
        // Deliberately its own quieter visual class, independent of clarity-tier color — per
        // direct feedback ("curved and slightly transparent... discrete"), a return shouldn't
        // shout as loud as a fresh forward move. Muted gray, low opacity, thinner than the
        // 1.75 default, on top of the arc-rounded routing above.
        lanedRaw.push({
          key: `return:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`,
          color: 'rgb(var(--color-text-muted))', arrow: true, opacity: 0.45, strokeWidth: 1.25,
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
        color: 'rgb(var(--color-text-muted))', dashed: true, opacity: 0.25, strokeWidth: 1,
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
      <div ref={scrollContainerRef} onWheel={onWheelZoom} style={{ overflow: 'auto' }}>
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
        {groupNodesForRender(detail.nodes).map((item) => {
          if (item.type === 'cluster') {
            return (
              <NodeClusterGroup
                key={`cluster:${item.nodes[0].id}`}
                nodes={item.nodes}
                registerPoint={registerPoint}
                onHoverKey={setHoveredKey}
                connectionsByNodeId={rowsForNode}
                nodeOrderIndex={nodeOrderIndex}
                onOpenPrompt={setPromptConn}
                refFor={refFor}
                openMenu={openMenu}
                originConnByNodeId={originConnByNodeId}
                jumpToOrigin={jumpToOrigin}
                rowsForConnection={rowsForConnection}
              />
            )
          }
          const { node: n, index: i } = item
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
              onDeleteNode={(nodeId) => window.studyTrail.deleteNode(nodeId).then(onChanged)}
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
            // Best-effort match on book/chapter — a connection doesn't store the destination
            // node's id directly, only where it points. Ambiguous only in the rare case of two
            // nodes for the same chapter (a revisit); the checkbox is a minor per-arrival detail
            // anyway, not worth a schema change to disambiguate perfectly.
            nodeId={detail.nodes.find((n) => n.bookId === promptConn.toBookId && n.chapter === promptConn.toChapter)?.id}
            nodeIsTopicBreak={detail.nodes.find((n) => n.bookId === promptConn.toBookId && n.chapter === promptConn.toChapter)?.isTopicBreak}
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
