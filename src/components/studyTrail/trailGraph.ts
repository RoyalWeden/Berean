// The Study Trail's PURE graph layer — everything that turns a TrailSessionDetail into "which
// rows hang under which node" and "which lines get drawn between which points," with no React,
// no DOM and no measurement in it at all. Extracted out of MapView.tsx (which had grown to
// 2600+ lines with all of this inline in its render body) for two reasons: it's the only part
// of the Map that can actually be unit-tested, and it's where the arrow-targeting bugs lived.
//
// ── The bug this extraction was done to fix ──────────────────────────────────
// The old code indexed nodes as `nodeByKey: Map<'session:book:chapter', TrailNode>`, filled by
// iterating `detail.nodes` (order_index ASC) with a plain `.set()` — i.e. LAST WRITE WINS. Since
// revisit promotion is unconditional (studyTrailSlice.ts's commitChapterArrival), any chapter
// visited more than once has several nodes, and that map always resolved to the LATEST one. So
// every consumer — a return edge's target, a node's "origin story" connection, the same-chapter
// self-check — silently pointed at the most FUTURE visit of that chapter rather than the visit
// that was actually involved. That is exactly the reported "some of the arrows point wrongly to
// future arrows."
//
// The replacement is a per-chapter LIST plus two explicit time-aware resolvers:
//   • nodeNearest — the visit whose anchor opened closest in time to some moment (used for "the
//     node a connection actually LANDED on").
//   • nodeBefore  — the latest visit that already existed at some moment (used for a RETURN,
//     which by definition targets something that was already on the spine when the jump happened
//     and therefore can never legitimately resolve to a later node).
// There is deliberately no "just give me the node for this chapter" accessor any more: every
// call site has to say WHEN it means, because that was the whole defect.

import type { TrailConnection, TrailNode, TrailSessionDetail } from '@/types/studyTrail'
import type { TrailEdge } from './TrailConnectorOverlay'
import { GUTTER_BASE, LANE_SPACING } from './TrailConnectorOverlay'
import { effectiveGapMs, GAP_CHIP_THRESHOLD_MS } from './trailTime'

export const TIER_COLOR: Record<number, string> = { 1: '#4fc3ae', 2: 'rgb(var(--color-accent))', 3: '#e08468' }

// ── Indent geometry (shared) ────────────────────────────────────────────────
// ConnRow / TangentBullet marginLeft = INDENT_STEP * (depth + 1). The dot-center insets are
// measured from each row's own left edge: an off-spine bullet is a 7px dot as the first child
// of a `gap:8` flex row (center ≈ 3.5); a spine node dot is 9px centered in a 12px column
// (center = 6). The faint indent guide lines use these so a line lands exactly under each
// bullet column at every zoom (all of it lives inside the same `scale(zoom)` wrapper).
export const INDENT_STEP = 22
export const OFFSPINE_DOT_INSET = 3.5
export const SPINE_DOT_INSET = 6
// A node's sub-bullets (ConnRow) don't hang off the block's own left edge — they render
// INSIDE the spine row's label column, which starts after the 12px dot column + the spine
// row's own `gap: 3`. So a ConnRow at depth d actually sits at
// `gutterWidth + SPINE_LABEL_COL_INSET + INDENT_STEP*(d+1) + OFFSPINE_DOT_INSET` from the
// content's left edge.
export const SPINE_LABEL_COL_INSET = 15

// ── Branch / note predicates (shared) ──────────────────────────────────────
/** The connection's own free-text note (NOT its verse ties) is non-empty. */
export const hasNote = (c?: TrailConnection | null): boolean => !!c?.userNote?.trim()
/** The user hand-entered at least one to/from verse tie on this connection. */
export const hasUserVerseTies = (c: TrailConnection): boolean => c.tiesFrom.length > 0 || c.tiesTo.length > 0
/** Render this connection with the full branch treatment (origin/destination tangent bullets +
 *  the 3-segment edge into the arrival node) — either it's a recorded branch, or the user
 *  hand-entered verse ties, which should be shown that way rather than buried in a hover note. */
export const renderAsBranch = (c: TrailConnection): boolean => c.isBranch || hasUserVerseTies(c)
/** Whether the hover "your note" bubble has anything to show for a connection: its own note
 *  always, plus its verse ties ONLY when they aren't already drawn as a branch stub. */
export const showNoteBubble = (c?: TrailConnection | null): boolean =>
  !!c && (hasNote(c) || (!renderAsBranch(c) && hasUserVerseTies(c)))

const LOW_SIGNAL_ORIGIN_TAGS = new Set(['tab-switch', 'reading'])
export function isLowSignalOrigin(conn: TrailConnection): boolean {
  return conn.reasonTags.some((t) => LOW_SIGNAL_ORIGIN_TAGS.has(t))
}

// Whether an origin is confident enough to state OUTRIGHT (its own distinct traced branch line)
// rather than just being available on hover. Tier 1 ("clear") origins are things Berean can name
// with certainty — a Strong's occurrence click, an AI Lookup suggestion, a TSKe/Classic
// cross-ref. A search result is only tier 2 ("soft") on purpose: clicking a search hit doesn't
// necessarily mean THAT specific search caused the study direction the way clicking a specific
// word lookup does.
export function isConfidentOrigin(conn: TrailConnection): boolean {
  return conn.clarityTier === 1 && !isLowSignalOrigin(conn)
}

export type AnnotatedConn = TrailConnection & {
  isReturn?: boolean
  /** A forward chapter-connection (destination IS the literal next spine node) whose origin
   *  is specific enough to trace — gets its own row + direct line to that next node, in
   *  addition to (not instead of) the plain spine arrow every chapter gets. */
  isForwardBranch?: boolean
  /** A cross-ref click that landed on a DIFFERENT verse in the SAME chapter the user is
   *  already anchored on — the destination "node" is literally the node this row lives under.
   *  Not a return (nothing was left and come back to) and not a forward branch (no new node),
   *  just a same-chapter cross-ref worth tracing on its own row. */
  isSameChapterBranch?: boolean
  /** Branch chaining (v31) — hangs off ANOTHER connection (fromConnectionId set), not directly
   *  off its chapter node; renders nested under its parent row instead of as a sibling. */
  isChainedBranch?: boolean
  /** At least one other connection is chained off THIS one — needs to render its own nested
   *  sub-shelf beneath it. */
  hasChainChildren?: boolean
}

// Walks a chain's FULL descendant tree (however deep the underlying chain_depth actually goes)
// into one flat, chronologically-ordered list. Per direct feedback ("one indent for the whole
// chain, then flat... this can just be straight down") a chain reads as one branch off its
// chapter, not a staircase of indents per hop. Also used for the "chain" badge stat.
export function flattenChain(connId: string, rowsForConnection: Map<string, AnnotatedConn[]> | undefined): AnnotatedConn[] {
  const kids = rowsForConnection?.get(connId) ?? []
  const out: AnnotatedConn[] = []
  for (const k of kids) {
    out.push(k)
    out.push(...flattenChain(k.id, rowsForConnection))
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

export type RenderItem = { type: 'single'; item: AnnotatedConn } | { type: 'glanceGroup'; key: string; items: AnnotatedConn[] }

export function groupForRender(conns: AnnotatedConn[]): RenderItem[] {
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
export type NodeRenderItem = { type: 'single'; node: TrailNode; index: number } | { type: 'cluster'; nodes: TrailNode[]; startIndex: number }

export function groupNodesForRender(nodes: TrailNode[]): NodeRenderItem[] {
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

// ── Time-aware chapter → node resolution ────────────────────────────────────
// Replaces the old last-write-wins `nodeByKey`. See this file's header for why.

export type ChapterNodeIndex = Map<string, TrailNode[]>

const chapterKey = (sessionId: string, bookId: string, chapter: number) => `${sessionId}:${bookId}:${chapter}`

export function buildChapterIndex(nodes: TrailNode[]): ChapterNodeIndex {
  const idx: ChapterNodeIndex = new Map()
  for (const n of nodes) {
    const k = chapterKey(n.trailSessionId, n.bookId, n.chapter)
    const bucket = idx.get(k)
    if (bucket) bucket.push(n)
    else idx.set(k, [n])
  }
  // Chronological within a chapter regardless of how the caller ordered `nodes` — Everything
  // merges several sessions and re-sorts by anchorStartedAt, an individual session comes back
  // ordered by order_index, and both must resolve identically.
  for (const bucket of idx.values()) bucket.sort((a, b) => a.anchorStartedAt - b.anchorStartedAt)
  return idx
}

/** The visit of this chapter whose anchor opened CLOSEST IN TIME to `atMs`. Use for "which node
 *  did this connection actually land on". */
export function nodeNearest(idx: ChapterNodeIndex, sessionId: string, bookId: string, chapter: number, atMs: number): TrailNode | undefined {
  const bucket = idx.get(chapterKey(sessionId, bookId, chapter))
  if (!bucket || bucket.length === 0) return undefined
  let best = bucket[0]
  let bestDelta = Math.abs(best.anchorStartedAt - atMs)
  for (let i = 1; i < bucket.length; i++) {
    const d = Math.abs(bucket[i].anchorStartedAt - atMs)
    if (d < bestDelta) { bestDelta = d; best = bucket[i] }
  }
  return best
}

/** The LATEST visit of this chapter that already existed at `atMs`. Use for a RETURN: you can
 *  only go back to somewhere you had already been, so a return that resolves to a node created
 *  after the jump is by definition the wrong node — which is precisely what the old map did. */
export function nodeBefore(idx: ChapterNodeIndex, sessionId: string, bookId: string, chapter: number, atMs: number): TrailNode | undefined {
  const bucket = idx.get(chapterKey(sessionId, bookId, chapter))
  if (!bucket || bucket.length === 0) return undefined
  let best: TrailNode | undefined
  for (const n of bucket) {
    if (n.anchorStartedAt <= atMs) best = n
    else break
  }
  return best
}

// ── Gutter geometry ─────────────────────────────────────────────────────────
// Return/revisit backlinks route through a fixed-width gutter on the LEFT of the spine. It is
// deliberately a HARD CAP, not a computed reservation: the previous design sized the gutter from
// the overlay's own bow formula, so the more revisits a session accumulated the wider the whole
// view got, eventually forcing horizontal scrolling on the Everything timeline. Michael's
// constraint is that the trail must never scroll sideways, so the gutter is now a constant and
// the overlay routes inside it instead of bowing to whatever width it likes.
export const MAX_GUTTER_LANES = 3
export const GUTTER_WIDTH = GUTTER_BASE + (MAX_GUTTER_LANES - 1) * LANE_SPACING + 10

export interface TrailGraph {
  nodeById: Map<string, TrailNode>
  nextNodeById: Map<string, TrailNode | undefined>
  nodeOrderIndex: Map<string, number>
  chapterIndex: ChapterNodeIndex
  /** The earliest connection that ever led to a given node — its "origin story". */
  originConnByNodeId: Map<string, TrailConnection>
  rowsForNode: Map<string, AnnotatedConn[]>
  rowsForConnection: Map<string, AnnotatedConn[]>
  nodesWithTracedArrival: Set<string>
  edges: TrailEdge[]
  maxLane: number
  gutterWidth: number
  maxRenderDepth: number
  hourLabelForNodeId: Map<string, string>
  hourMarkers: Array<{ id: string; label: string }>
  /** Whether a recorded revisit still counts as one under the caller's current time window. */
  isRevisitWithinWindow: (n: TrailNode) => boolean
  arrivalNodeFor: (c: TrailConnection) => TrailNode | undefined
}

export interface BuildTrailGraphOptions {
  /** Live "revisit window" slider — a chapter re-arrival past this gap renders as a plain
   *  independent bullet instead of the backlink/badge treatment. undefined = no cutoff. */
  revisitWindowMs?: number
  /** Everything view renders its own date dividers; when a node already has one, the hour
   *  marker drops the redundant date prefix. */
  boundaryLabelForNodeId?: Map<string, string>
}

interface LanedEdge extends TrailEdge { minIdx: number; maxIdx: number }

export function buildTrailGraph(detail: TrailSessionDetail, opts: BuildTrailGraphOptions = {}): TrailGraph {
  const { revisitWindowMs, boundaryLabelForNodeId } = opts

  const chapterIndex = buildChapterIndex(detail.nodes)
  const nodeById = new Map<string, TrailNode>()
  for (const n of detail.nodes) nodeById.set(n.id, n)
  const nextNodeById = new Map<string, TrailNode | undefined>()
  detail.nodes.forEach((n, i) => nextNodeById.set(n.id, detail.nodes[i + 1]))
  // 1-based chronological position — lets a return row read "back to step 4" in plain text
  // instead of requiring the arrow to be traced.
  const nodeOrderIndex = new Map<string, number>()
  detail.nodes.forEach((n, i) => nodeOrderIndex.set(n.id, i))

  // ── Hour markers ─────────────────────────────────────────────────────────
  // The spine isn't linear time (gaps are log-scaled), so an hour marker can only ATTACH to a
  // chapter stop — the first stop that falls in each new clock hour.
  const hourLabelForNodeId = new Map<string, string>()
  {
    let prevHourStart: number | null = null
    let prevDayKey: string | null = null
    for (const n of detail.nodes) {
      const d = new Date(n.anchorStartedAt)
      const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime()
      if (prevHourStart != null && hourStart === prevHourStart) continue
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const h12 = ((d.getHours() + 11) % 12) + 1
      const time = `${h12} ${d.getHours() < 12 ? 'AM' : 'PM'}`
      const dayRolled = prevDayKey != null && dayKey !== prevDayKey
      const label = (dayRolled && !boundaryLabelForNodeId?.has(n.id))
        ? `${d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} · ${time}`
        : time
      hourLabelForNodeId.set(n.id, label)
      prevHourStart = hourStart
      prevDayKey = dayKey
    }
  }
  const hourMarkers = detail.nodes.map((n) => n.id).filter((id) => hourLabelForNodeId.has(id)).map((id) => ({ id, label: hourLabelForNodeId.get(id)! }))

  /** The node a connection actually LANDED on. */
  function arrivalNodeFor(c: TrailConnection): TrailNode | undefined {
    if (c.toKind !== 'chapter' || !c.toBookId || c.toChapter == null) return undefined
    return nodeNearest(chapterIndex, c.trailSessionId, c.toBookId, c.toChapter, c.createdAt)
  }

  function isRevisitWithinWindow(n: TrailNode): boolean {
    if (!n.revisitOfNodeId) return false
    if (revisitWindowMs == null) return true
    const original = nodeById.get(n.revisitOfNodeId)
    if (!original) return true
    const gapMs = n.anchorStartedAt - (original.anchorEndedAt ?? original.anchorStartedAt)
    return gapMs <= revisitWindowMs
  }

  // The EARLIEST connection that ever led to a given chapter node — its "origin story," shown in
  // the node's hover card and used to build the 3-segment branch-arrival path. Resolved with
  // `arrivalNodeFor` (time-nearest), NOT the old last-write-wins chapter map: attaching a
  // session's first Genesis-1 connection to its THIRD Genesis-1 node is what made tangent stubs
  // originate "from something far in the past."
  const originConnByNodeId = new Map<string, TrailConnection>()
  for (const c of [...detail.connections].sort((a, b) => a.createdAt - b.createdAt)) {
    const target = arrivalNodeFor(c)
    if (target && !originConnByNodeId.has(target.id)) originConnByNodeId.set(target.id, c)
  }

  // Branch chaining (v31) — a connection with fromConnectionId set hangs off ANOTHER connection,
  // not directly off its chapter node; it's excluded from rowsForNode's top-level bucket and
  // instead rendered nested under its parent row.
  const rowsForConnection = new Map<string, AnnotatedConn[]>()
  const hasChainChildrenIds = new Set<string>()
  for (const c of detail.connections) {
    if (!c.fromConnectionId) continue
    hasChainChildrenIds.add(c.fromConnectionId)
  }

  // Node ids that have a SPECIFIC traced arrival — the plain generic spine arrow between
  // chronologically-adjacent nodes is suppressed for these, since showing both was redundant.
  // A spine arrow is only ever suppressed once a REPLACEMENT edge is proven to exist (see the
  // reconciliation pass after the edge build): the old code could suppress and then emit
  // nothing, leaving an arrival node with no incoming line at all.
  const nodesWithTracedArrival = new Set<string>()
  /** arrival node id → the edge keys that actually land on it. */
  const tracedArrivalEdgeKeys = new Map<string, string[]>()
  const claimTracedArrival = (nodeId: string, edgeKey: string) => {
    nodesWithTracedArrival.add(nodeId)
    const list = tracedArrivalEdgeKeys.get(nodeId)
    if (list) list.push(edgeKey)
    else tracedArrivalEdgeKeys.set(nodeId, [edgeKey])
  }

  const rowsForNode = new Map<string, AnnotatedConn[]>()
  for (const n of detail.nodes) rowsForNode.set(n.id, [])
  for (const c of detail.connections) {
    let annotated: AnnotatedConn = { ...c, isChainedBranch: !!c.fromConnectionId, hasChainChildren: hasChainChildrenIds.has(c.id) }
    if (c.toKind === 'chapter' && c.toBookId && c.toChapter != null) {
      // A cross-ref that landed in the SAME chapter as its own fromNode — the destination is
      // literally the node this row is rendered under, which is neither a forward move nor a
      // round trip. Compared directly against fromNode's own book/chapter rather than via a map
      // lookup, so a later revisit of that same chapter can't steal the identity check.
      const fromNode = nodeById.get(c.fromNodeId)
      if (fromNode && fromNode.bookId === c.toBookId && fromNode.chapter === c.toChapter) {
        annotated = { ...annotated, isSameChapterBranch: true }
      } else {
        // Any branch path that lands on a real chapter node makes the plain straight spine
        // arrow into that node redundant — the branch itself already visibly joins the two
        // stops. `arrivalNodeFor` is position-robust: it survives a later revisit promotion
        // splicing the spine between fromNode and the real landing.
        const isBranchish = renderAsBranch(annotated) || annotated.isChainedBranch
        const arrival = isBranchish ? arrivalNodeFor(c) : undefined
        if (arrival) {
          const arrivalIdx = nodeOrderIndex.get(arrival.id) ?? -1
          const fromIdx = nodeOrderIndex.get(c.fromNodeId) ?? -1
          if (arrivalIdx > 0 && fromIdx >= 0 && fromIdx <= arrivalIdx - 1) {
            // The dedicated 3-segment pass fully OWNS the rendering only for the node's own
            // origin connection (and never for a nested chained row) — there, emit no ConnRow.
            if (renderAsBranch(annotated) && !annotated.isChainedBranch && originConnByNodeId.get(arrival.id)?.id === c.id) {
              claimTracedArrival(arrival.id, `tangent-arrive:${arrival.id}`)
              continue
            }
            claimTracedArrival(arrival.id, `origin:${c.id}`)
          }
        }
        const next = nextNodeById.get(c.fromNodeId)
        const isForward = next && next.trailSessionId === c.trailSessionId && next.bookId === c.toBookId && next.chapter === c.toChapter
        if (isForward) {
          // A cross-CHAPTER tangent whose destination is a brand-new node right away — fully
          // handled by the dedicated TangentBullet + edge-building pass instead.
          if (renderAsBranch(annotated)) {
            claimTracedArrival(next!.id, `tangent-arrive:${next!.id}`)
            continue
          }
          if (!isConfidentOrigin(c) && !annotated.isChainedBranch) continue // no row at all
          annotated = { ...annotated, isForwardBranch: true }
          claimTracedArrival(next!.id, `origin:${c.id}`)
        } else {
          // A RETURN targets a node that already existed when the jump was made — resolved with
          // `nodeBefore`, never with "whatever the newest node for that chapter is." This is the
          // fix for return arrows pointing at a FUTURE visit of the chapter.
          const target = nodeBefore(chapterIndex, c.trailSessionId, c.toBookId, c.toChapter, c.createdAt)
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

  // ── Edges ─────────────────────────────────────────────────────────────────
  // COLOR encodes depth change (accent = deeper, text-secondary = same depth, muted =
  // reconverging), DASH encodes confidence (glance) or backwards-travel, ARROWHEADS mark an
  // actual step in the reading order, and CURVATURE is reserved for edges reaching across other
  // content. Return/revisit edges route through the fixed-width left gutter in a packed lane.
  const lanedRaw: LanedEdge[] = []
  const edges: TrailEdge[] = []

  // Built first (so the spine pass can consult it), filled by the passes below.
  const emittedEdgeKeys = new Set<string>()
  const pushEdge = (e: TrailEdge) => { emittedEdgeKeys.add(e.key); edges.push(e) }
  const pushLaned = (e: LanedEdge) => { emittedEdgeKeys.add(e.key); lanedRaw.push(e) }

  // The dedicated 3-segment path for a branch-node ARRIVAL: the node it left from → the
  // origin-verse bullet → the destination-verse bullet → the arrival node itself. Runs BEFORE
  // the spine pass so the reconciliation below knows which arrivals really got a replacement.
  for (const n of detail.nodes) {
    const originConn = originConnByNodeId.get(n.id)
    if (!originConn || !renderAsBranch(originConn)) continue
    // The connection's own recorded fromNode is now trustworthy: with time-aware resolution the
    // origin connection attached to this node is the one that actually landed here, so its
    // fromNodeId really is where the reader departed from. (The old code substituted "the
    // previous spine node" for user verse-ties as a workaround for the resolver bug — that
    // heuristic re-rooted genuinely long-range ties to the wrong stop and is gone.)
    const fromNode = nodeById.get(originConn.fromNodeId)
    if (!fromNode) continue
    // Solid accent, arrowed — "going one level deeper."
    pushEdge({ key: `tangent-stub:${n.id}`, from: `node:${fromNode.id}`, to: `tangent-origin:${n.id}`, color: 'rgb(var(--color-accent))', curved: false, arrow: true, opacity: 0.75 })
    // Origin verse → destination verse — the actual cross-ref hop itself.
    pushEdge({ key: `tangent-hop:${n.id}`, from: `tangent-origin:${n.id}`, to: `tangent-dest:${n.id}`, color: 'rgb(var(--color-accent))', arrow: true, curved: false, opacity: 0.75 })
    // Dashed/muted reconverge into the arrival node. Straight, not curved — over the short
    // vertical distance typical of this hop a bezier's fixed control offset overshoots and reads
    // as a squiggle.
    pushEdge({ key: `tangent-arrive:${n.id}`, from: `tangent-dest:${n.id}`, to: `node:${n.id}`, color: 'rgb(var(--color-text-muted))', curved: false, arrow: true, opacity: 0.5, dashed: true })
  }

  // Shared per-row edge logic — `stubFrom` is the point key this row's own short connector
  // starts at (its chapter node for a top-level row, its PARENT row's point for a chained one).
  function pushRowEdges(c: AnnotatedConn, stubFrom: string) {
    const color = c.weight === 'glance' ? (TIER_COLOR[c.clarityTier] ?? 'rgb(var(--color-text-muted))') : 'rgb(var(--color-accent))'
    pushEdge({ key: `stub:${c.id}`, from: stubFrom, to: `row:${c.id}`, color, dashed: c.weight === 'glance', curved: false, arrow: true, opacity: c.weight === 'glance' ? 0.5 : 0.75 })
    if (c.isReturn && c.toBookId && c.toChapter != null) {
      const target = nodeBefore(chapterIndex, c.trailSessionId, c.toBookId, c.toChapter, c.createdAt)
      if (target) {
        const fromIdx = nodeOrderIndex.get(c.fromNodeId)!, toIdx = nodeOrderIndex.get(target.id)!
        // Its own quieter visual class, independent of clarity-tier color — a return shouldn't
        // shout as loud as a fresh forward move.
        pushLaned({
          key: `return:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`,
          color: 'rgb(var(--color-text-muted))', arrow: true, dashed: true, opacity: 0.45, strokeWidth: 1.25,
          label: verseTieLabel(c),
          minIdx: Math.min(fromIdx, toIdx), maxIdx: Math.max(fromIdx, toIdx),
        })
      }
    }
    if (c.isForwardBranch) {
      // Always a confidently-traced, SAME-DEPTH continuation (a plain read whose specific origin
      // is worth tracing rather than the generic spine arrow), so same-depth styling. Targets the
      // connection's REAL destination via arrivalNodeFor — the old `nextNodeById.get(fromNodeId)`
      // pointed at "whatever node happens to follow the source," which a spliced revisit node
      // makes flatly wrong.
      const target = arrivalNodeFor(c) ?? nextNodeById.get(c.fromNodeId)
      if (target) pushEdge({ key: `origin:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`, color: 'rgb(var(--color-text-secondary))', curved: true, arrow: true, opacity: 0.6 })
    }
  }

  for (const n of detail.nodes) {
    const items = groupForRender(rowsForNode.get(n.id) ?? [])
    for (const it of items) {
      if (it.type === 'single') {
        pushRowEdges(it.item, `node:${n.id}`)
      } else {
        const color = TIER_COLOR[it.items[0].clarityTier] ?? 'rgb(var(--color-text-muted))'
        pushEdge({ key: `stub:${it.key}`, from: `node:${n.id}`, to: it.key, color, dashed: true, curved: false, arrow: true, opacity: 0.4 })
      }
    }
    // The quiet "same chapter as" backlink for a promoted revisit — muted/thin/dashed
    // (structural chrome, not a clarity-tier signal) and never arrowed, since it signals identity
    // ("this is the same chapter"), not a direction of travel.
    if (n.revisitOfNodeId && nodeById.has(n.revisitOfNodeId) && isRevisitWithinWindow(n)) {
      const fromIdx = nodeOrderIndex.get(n.id)!, toIdx = nodeOrderIndex.get(n.revisitOfNodeId)!
      pushLaned({
        key: `revisit-link:${n.id}`, from: `node:${n.id}`, to: `node:${n.revisitOfNodeId}`,
        color: 'rgb(var(--color-text-muted))', dashed: true, opacity: 0.25, strokeWidth: 1,
        label: revisitLabelFor(n),
        minIdx: Math.min(fromIdx, toIdx), maxIdx: Math.max(fromIdx, toIdx),
      })
    }
  }

  // Chained branch rows get the same per-row edges, but their short local stub starts from their
  // PARENT connection's own row point instead of a chapter node.
  for (const [parentConnId, children] of rowsForConnection) {
    for (const it of groupForRender(children)) {
      if (it.type === 'single') pushRowEdges(it.item, `row:${parentConnId}`)
      else {
        const color = TIER_COLOR[it.items[0].clarityTier] ?? 'rgb(var(--color-text-muted))'
        pushEdge({ key: `stub:${it.key}`, from: `row:${parentConnId}`, to: it.key, color, dashed: true, curved: false, opacity: 0.4 })
      }
    }
  }

  // Reconciliation: a spine arrow is only worth suppressing if the replacement it was suppressed
  // in favour of actually got emitted. Any arrival whose claimed edges all fell through (the row
  // was dropped as a low-signal origin, a glance group swallowed it, a branch's own pass bailed
  // out) gets its generic spine arrow back rather than silently ending up with no incoming line.
  for (const [nodeId, keys] of tracedArrivalEdgeKeys) {
    if (!keys.some((k) => emittedEdgeKeys.has(k))) nodesWithTracedArrival.delete(nodeId)
  }

  // ── Main spine ────────────────────────────────────────────────────────────
  for (let i = 0; i < detail.nodes.length - 1; i++) {
    // Skip across a session boundary (merged all-sessions timeline) — chronologically adjacent
    // nodes from two DIFFERENT sessions shouldn't read as one continuous read-through.
    if (detail.nodes[i].trailSessionId !== detail.nodes[i + 1].trailSessionId) continue
    if (nodesWithTracedArrival.has(detail.nodes[i + 1].id)) continue
    // Dashed instead of solid across a long gap — the same "break in time" cue as GapDivider.
    const gapMs = effectiveGapMs(detail.nodes[i].anchorEndedAt ?? detail.nodes[i].anchorStartedAt, detail.nodes[i + 1].anchorStartedAt, detail.pausedIntervals)
    pushEdge({
      key: `spine:${detail.nodes[i].id}`, from: `node:${detail.nodes[i].id}`, to: `node:${detail.nodes[i + 1].id}`,
      color: 'rgb(var(--color-text-secondary))', arrow: true, dashed: gapMs >= GAP_CHIP_THRESHOLD_MS,
    })
  }

  // ── Lane packing ──────────────────────────────────────────────────────────
  // Greedy interval scheduling (the same idea git-graph tools use): process by start index, give
  // each edge the lowest lane whose previously-assigned span doesn't overlap this one. Capped at
  // MAX_GUTTER_LANES so the gutter — and therefore the whole view's width — is a constant.
  // Overflow is NOT dropped: it renders faintly in the last lane and comes back to full strength
  // when either endpoint is hovered, so a busy session still shows every backlink.
  lanedRaw.sort((a, b) => a.minIdx - b.minIdx)
  const laneEnds: number[] = []
  for (const e of lanedRaw) {
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] >= e.minIdx) lane++
    const overflow = lane >= MAX_GUTTER_LANES
    const assigned = overflow ? MAX_GUTTER_LANES - 1 : lane
    laneEnds[lane] = e.maxIdx
    const { minIdx: _min, maxIdx: _max, ...edge } = e
    edges.push({ ...edge, lane: assigned, ...(overflow ? { overflowLane: true, opacity: (edge.opacity ?? 1) * 0.55 } : {}) })
  }
  const maxLane = Math.min(MAX_GUTTER_LANES - 1, laneEnds.length > 0 ? laneEnds.length - 1 : -1)
  const gutterWidth = laneEnds.length > 0 ? GUTTER_WIDTH : 0

  // Deepest indent level actually RENDERED anywhere in this view — drives how many faint
  // indent-level guide lines get drawn. -1 means "nothing off-spine".
  let maxRenderDepth = -1
  for (const bucket of rowsForNode.values())
    for (const c of bucket) maxRenderDepth = Math.max(maxRenderDepth, c.chainDepth)
  for (const bucket of rowsForConnection.values())
    for (const c of bucket) maxRenderDepth = Math.max(maxRenderDepth, c.chainDepth)
  for (const n of detail.nodes) {
    const oc = originConnByNodeId.get(n.id)
    if (oc && renderAsBranch(oc)) maxRenderDepth = Math.max(maxRenderDepth, oc.chainDepth ?? 0)
  }

  return {
    nodeById, nextNodeById, nodeOrderIndex, chapterIndex, originConnByNodeId,
    rowsForNode, rowsForConnection, nodesWithTracedArrival,
    edges, maxLane, gutterWidth, maxRenderDepth,
    hourLabelForNodeId, hourMarkers,
    isRevisitWithinWindow, arrivalNodeFor,
  }
}

/** The verse pair that ties the two ends of a return together, rendered as the gutter hairline's
 *  own label ("Rev 12:6 ⇄ Hos 2:14") so a backlink says WHY it exists without being traced by
 *  eye. Falls back to whichever half is known, then to nothing at all. */
function verseTieLabel(c: TrailConnection): string | undefined {
  const from = c.tiesFrom[0]?.trim() || (c.originVersePinFrom != null ? `v${c.originVersePinFrom}` : '')
  const to = c.tiesTo[0]?.trim() || (c.versePinFrom != null ? `v${c.versePinFrom}` : '')
  if (from && to) return `${from} ⇄ ${to}`
  return from || to || undefined
}

function revisitLabelFor(n: TrailNode): string | undefined {
  return n.originLabel?.trim() || undefined
}
