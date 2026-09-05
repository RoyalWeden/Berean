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
import { styled } from './trailStyle'

// Kept only for the hover card's own tier chip. Lines and bullets no longer read from it — see
// trailStyle.ts's note on why clarity tier stopped being the map's primary colour axis.
export const TIER_COLOR: Record<number, string> = { 1: '#4fc3ae', 2: 'rgb(var(--color-accent))', 3: '#e08468' }

// ── Indent geometry (shared) ────────────────────────────────────────────────
// ConnRow / TangentBullet marginLeft = INDENT_STEP * (depth + 1). The dot-center insets are
// measured from each row's own left edge: an off-spine bullet is a 7px dot as the first child
// of a `gap:8` flex row (center = 4.5); a spine node dot is 11px centered in a 12px column
// (center = 6). The faint indent guide lines use these so a line lands exactly under each
// bullet column at every zoom (all of it lives inside the same `scale(zoom)` wrapper).
export const INDENT_STEP = 22
export const OFFSPINE_DOT_INSET = 4.5
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
export type NodeRenderItem =
  | { type: 'single'; node: TrailNode; index: number }
  | { type: 'cluster'; nodes: TrailNode[]; startIndex: number }
  | { type: 'run'; nodes: TrailNode[]; startIndex: number }

/** The shortest run of straight-through reading worth collapsing. Two chapters in a row is just
 *  reading; four is a pattern, and showing it as four identical stops buries whatever else
 *  happened that session. */
const READ_THROUGH_MIN = 4

export function groupNodesForRender(
  nodes: TrailNode[],
  opts: { hasBranches?: (nodeId: string) => boolean } = {},
): NodeRenderItem[] {
  const out: NodeRenderItem[] = []
  const busy = opts.hasBranches ?? (() => false)
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
    // ── Reading straight through ────────────────────────────────────────────
    // The most common thing anyone does with a Bible, and previously the noisiest thing on the
    // map: reading Genesis 1–12 in one sitting produced twelve identical full-size stops, which
    // buried the two cross-references that were the actual study. A run of consecutive chapters in
    // one book, none of them revisited and none of them carrying a branch of their own, collapses
    // into its first and last stop with a "read through N chapters" badge — expandable, nothing
    // lost. A chapter you stopped to look something up in breaks the run, because that stop is
    // exactly what the map exists to show.
    if (!n.revisitOfNodeId && !busy(n.id)) {
      let j = i + 1
      while (
        j < nodes.length &&
        nodes[j].trailSessionId === n.trailSessionId &&
        nodes[j].bookId === n.bookId &&
        nodes[j].chapter === nodes[j - 1].chapter + 1 &&
        !nodes[j].revisitOfNodeId &&
        !nodes[j].isTopicBreak &&
        !nodes[j].clusterId &&
        !busy(nodes[j].id)
      ) j++
      if (j - i >= READ_THROUGH_MIN) {
        out.push({ type: 'run', nodes: nodes.slice(i, j), startIndex: i })
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
// Bumped from 3 to 5 per feedback ("give the revisit lines more levels so its easier to
// discern") — more concurrent revisit chains now get their own lane before any of them has to
// share the last one as an overflow (faint, brought to full strength on hover). Still a hard
// cap, not a computed reservation — see the comment above.
export const MAX_GUTTER_LANES = 5
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
  /** The stop a session kept coming back to — its home base. Maps that node's id to how many
   *  times the chapter was visited. See the computation below for what qualifies. */
  anchorNodes: Map<string, number>
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
  //
  // EXCEPT when a later connection to the same node carries the user's own data (verse ties /
  // a marked branch / a note) and the earlier one has none: a quick revisit of the same chapter
  // (nodeNearest reusing the existing node rather than minting a new one) can leave TWO+
  // connections resolving to the same target here, and plain earliest-wins would let an old,
  // untouched connection permanently shadow a tie the user just set (via the verse-tie picker,
  // or the note popover) on the newer one — the map then never renders it as a branch at all,
  // no matter how many times the data reloads. Only overrides the tiebreak when the earlier
  // connection genuinely has nothing of its own to lose.
  // A LATER connection carrying real user data (a branch/tie or a note) always wins over
  // whatever's already claimed the node — not just over an untouched earlier one. Tying the
  // SAME two chapters again later in the same session (a second, separate re-engagement) used to
  // still lose to the first tie (both "have user data", so the old `!existingHasUserData` guard
  // never let the second one through), which is exactly why it silently fell back to reading as
  // a plain revisit instead of getting its own branch — the first tie kept permanent ownership
  // of that arrival node forever. A later connection with NO user data of its own still never
  // overrides an existing tied one, so an untouched revisit still can't steal a real branch away.
  const originConnByNodeId = new Map<string, TrailConnection>()
  for (const c of [...detail.connections].sort((a, b) => a.createdAt - b.createdAt)) {
    const target = arrivalNodeFor(c)
    if (!target) continue
    const existing = originConnByNodeId.get(target.id)
    if (!existing || renderAsBranch(c) || hasNote(c)) originConnByNodeId.set(target.id, c)
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
    // All three segments of a branch arrival are the SAME move — you left a verse, crossed to
    // another verse, and landed. They now share one style ('deeper') end to end. The last leg used
    // to be dashed and muted, which made a single continuous hop change colour and line style
    // twice on its way across.
    pushEdge(styled('deeper', { key: `tangent-stub:${n.id}`, from: `node:${fromNode.id}`, to: `tangent-origin:${n.id}`, curved: false }))
    pushEdge(styled('deeper', { key: `tangent-hop:${n.id}`, from: `tangent-origin:${n.id}`, to: `tangent-dest:${n.id}`, curved: false }))
    pushEdge(styled('deeper', { key: `tangent-arrive:${n.id}`, from: `tangent-dest:${n.id}`, to: `node:${n.id}`, curved: false }))
  }

  // Shared per-row edge logic — `stubFrom` is the point key this row's own short connector
  // starts at (its chapter node for a top-level row, its PARENT row's point for a chained one).
  function pushRowEdges(c: AnnotatedConn, stubFrom: string) {
    pushEdge(styled(c.weight === 'glance' ? 'glance' : 'deeper', { key: `stub:${c.id}`, from: stubFrom, to: `row:${c.id}`, curved: false }))
    // Skip the plain return/revisit line entirely when this SAME connection is already a
    // branch/tie (renderAsBranch) — that gets the full 3-segment tangent-stub/hop/arrive path
    // (pushed in the loop above, over `originConnByNodeId`), which already draws origin→dest as
    // its own real path. Drawing the plain backlink edge ON TOP of that too was exactly the
    // "back-and-forth chapters + a picker tie looks wonky" complaint — two lines for one move.
    if (c.isReturn && c.toBookId && c.toChapter != null && !renderAsBranch(c)) {
      const target = nodeBefore(chapterIndex, c.trailSessionId, c.toBookId, c.toChapter, c.createdAt)
      if (target) {
        const fromIdx = nodeOrderIndex.get(c.fromNodeId)!, toIdx = nodeOrderIndex.get(target.id)!
        // Its own quieter visual class, independent of clarity-tier color — a return shouldn't
        // shout as loud as a fresh forward move. No verse-tie label any more (used to show
        // "Luke 4:18-19 ⇄ Isaiah 61:1-2" right on the hairline via verseTieLabel()) — per direct
        // feedback that reads as clutter on a plain revisit line regardless of whether a tie is
        // involved; a tie's own verse detail belongs on the tangent bullets, not repeated here.
        pushLaned(styled('back', {
          key: `return:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`,
          minIdx: Math.min(fromIdx, toIdx), maxIdx: Math.max(fromIdx, toIdx),
        }))
      }
    }
    if (c.isForwardBranch) {
      // Always a confidently-traced, SAME-DEPTH continuation (a plain read whose specific origin
      // is worth tracing rather than the generic spine arrow), so same-depth styling.
      //
      // FOUND (per the stray-blue-line investigation): this used to prefer arrivalNodeFor(c) —
      // a time-nearest lookup — over `next` (nextNodeById.get(fromNodeId)), on the theory that
      // `next` was the less reliable of the two. But `isForwardBranch` is ONLY ever set (above,
      // in the loop that builds `annotated`) after ALREADY VERIFYING next.trailSessionId/
      // bookId/chapter match this exact connection's destination — and that same verified `next`
      // is what claimTracedArrival() marks as this node's arrival target right there. Preferring
      // arrivalNodeFor(c) here instead re-derives the target through a SEPARATE, weaker
      // heuristic (nearest in TIME, not verified against this connection at all) that can
      // disagree with the already-verified `next` whenever the destination chapter has more
      // than one visit in this session — silently drawing to a different (and, being a nearest-
      // in-time rather than adjacent-in-order lookup, potentially FAR AWAY) node than the one
      // just claimed. `next` is now primary, matching what was verified/claimed above;
      // arrivalNodeFor(c) is only the fallback for the rare case `next` itself is somehow gone.
      const next = nextNodeById.get(c.fromNodeId)
      const target = next ?? arrivalNodeFor(c)
      if (target) {
        pushEdge(styled('deeper', {
          key: `origin:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`, curved: true,
          ...(next == null ? { usedFallbackTarget: true } : {}),
        }))
      }
    }
  }

  for (const n of detail.nodes) {
    const items = groupForRender(rowsForNode.get(n.id) ?? [])
    for (const it of items) {
      if (it.type === 'single') {
        pushRowEdges(it.item, `node:${n.id}`)
      } else {
        pushEdge(styled('glance', { key: `stub:${it.key}`, from: `node:${n.id}`, to: it.key, curved: false }))
      }
    }
  }

  // ── Revisit backlinks, one line PER CHAPTER ───────────────────────────────
  // Previously every promoted revisit drew its own arc back to the original, so a chapter visited
  // five times produced four overlapping arcs saying the same thing, and a session with a few such
  // chapters became unreadable — "a lot of the revisit lines are overlapping, its hard to tell
  // whats going on."
  //
  // A chapter's visits are now ONE line: first visit to last, in a single lane, with the
  // intermediate visits recorded as ticks on it (`ticks`, drawn by TrailConnectorOverlay). That's
  // the same information — "these stops are all the same chapter" — as one object instead of N-1
  // crossing ones, and the lane count drops from "number of revisits" to "number of revisited
  // chapters", which is what makes the gutter legible again.
  for (const [, bucket] of chapterIndex) {
    const visits = bucket.filter((n) => nodeOrderIndex.has(n.id))
    if (visits.length < 2) continue
    // Only chapters whose repeat visits were actually RECORDED as revisits, and still count as
    // one under the caller's time window — two unrelated readings a week apart aren't a backlink.
    const linked = visits.filter((n, i) => i === 0 || (n.revisitOfNodeId && isRevisitWithinWindow(n)))
    if (linked.length < 2) continue
    const first = linked[0], last = linked[linked.length - 1]
    const idxs = linked.map((n) => nodeOrderIndex.get(n.id)!)
    const base = styled('back', {
      key: `revisit-chain:${first.id}`,
      from: `node:${last.id}`, to: `node:${first.id}`,
      arrow: false, // an identity link ("same chapter"), not a step in the reading order
      ticks: linked.slice(1, -1).map((n) => `node:${n.id}`),
      minIdx: Math.min(...idxs), maxIdx: Math.max(...idxs),
    })
    // Per direct feedback, the always-on "×N" label read as clutter — the same information
    // (plus the actual first/last visit dates) now lives in a hover tooltip instead (see
    // TrailConnectorOverlay's revisitCount/firstVisitAt/lastVisitAt handling), and the line
    // itself communicates "how much" at a glance via weight/saturation instead of text:
    //   - MORE REVISITS → thicker + more opaque (capped so a chapter visited a dozen times
    //     doesn't run away visually past a handful of visits).
    //   - an OLDER original visit → more muted, independent of count — a chapter you first
    //     read months ago and still bounce back to should read differently from one you
    //     started yesterday, even at the same revisit count.
    // Deliberately applied AFTER styled('back', …) above: styled() always wins ties against
    // its own input object (by design — see trailStyle.ts's header comment), so per-instance
    // overrides like these have to be layered on top of its result, not passed into it.
    const countStep = Math.min(linked.length - 2, 4) // 0 (2 visits) .. 4 (6+ visits)
    const daysSinceFirstVisit = (Date.now() - first.anchorStartedAt) / 86_400_000
    const recencyMute = Math.max(0.55, 1 - daysSinceFirstVisit / 90)
    pushLaned({
      ...base,
      strokeWidth: base.strokeWidth + countStep * 0.4,
      opacity: Math.min(0.85, base.opacity + countStep * 0.08) * recencyMute,
      revisitCount: linked.length,
      firstVisitAt: first.anchorStartedAt,
      lastVisitAt: last.anchorStartedAt,
    })
  }

  // Chained branch rows get the same per-row edges, but their short local stub starts from their
  // PARENT connection's own row point instead of a chapter node.
  for (const [parentConnId, children] of rowsForConnection) {
    for (const it of groupForRender(children)) {
      if (it.type === 'single') pushRowEdges(it.item, `row:${parentConnId}`)
      else {
        pushEdge(styled('glance', { key: `stub:${it.key}`, from: `row:${parentConnId}`, to: it.key, curved: false }))
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
  // CONTINUOUS, always. Every consecutive pair of stops in the same session gets a segment; a
  // branch that already explains the arrival demotes its segment to 'forward-quiet' instead of
  // deleting it. Omitting the segment (what this did before) left the faint indent guide line
  // showing through the gap, which is what read as "some of the main spine lines dont fully
  // connect or are switching colors in part of the line".
  for (let i = 0; i < detail.nodes.length - 1; i++) {
    // Skip across a session boundary (merged all-sessions timeline) — chronologically adjacent
    // nodes from two DIFFERENT sessions shouldn't read as one continuous read-through.
    if (detail.nodes[i].trailSessionId !== detail.nodes[i + 1].trailSessionId) continue
    // When a branch already carries the arrival, the spine segment is DROPPED, not merely
    // quietened. Drawing a faint parallel copy alongside the branch path read as the spine
    // "starting and then stopping" — per direct feedback, "i dont like that it looks like it
    // starts and stops, so just dont show that start." (The earlier "broken spine" complaint had a
    // different cause: a full-height guide line showing through the gap, since removed. With that
    // gone, an omitted segment simply reads as the branch owning that stretch, which it does.)
    if (nodesWithTracedArrival.has(detail.nodes[i + 1].id)) continue
    const gapMs = effectiveGapMs(detail.nodes[i].anchorEndedAt ?? detail.nodes[i].anchorStartedAt, detail.nodes[i + 1].anchorStartedAt, detail.pausedIntervals)
    pushEdge(styled('forward', {
      key: `spine:${detail.nodes[i].id}`, from: `node:${detail.nodes[i].id}`, to: `node:${detail.nodes[i + 1].id}`,
      // A long break still reads as one — the gap chip between the two stops says how long, this
      // just stops the line claiming they were consecutive moments.
      dashed: gapMs >= GAP_CHIP_THRESHOLD_MS,
    }))
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

  // ── Home base ─────────────────────────────────────────────────────────────
  // A very common shape: you settle on one passage, go out to a cross-reference or a word, come
  // back, go out again. The chapter you keep returning to IS the study, but on a plain timeline it
  // looks like several unrelated stops that happen to share a name. Marking the session's
  // most-returned-to chapter says what was actually going on at a glance.
  //
  // Per session (Everything merges several), and only from three visits up — coming back once is
  // just navigation. Ties are broken by whichever was reached first, so the marker doesn't move
  // around as later visits accumulate.
  const anchorNodes = new Map<string, number>()
  {
    const bySession = new Map<string, Map<string, TrailNode[]>>()
    for (const [, bucket] of chapterIndex) {
      const first = bucket[0]
      if (!first) continue
      let m = bySession.get(first.trailSessionId)
      if (!m) { m = new Map(); bySession.set(first.trailSessionId, m) }
      m.set(`${first.bookId}:${first.chapter}`, bucket)
    }
    for (const [, chapters] of bySession) {
      let best: TrailNode[] | null = null
      for (const bucket of chapters.values()) {
        if (bucket.length < 3) continue
        if (!best || bucket.length > best.length ||
            (bucket.length === best.length && bucket[0].anchorStartedAt < best[0].anchorStartedAt)) {
          best = bucket
        }
      }
      if (best) anchorNodes.set(best[0].id, best.length)
    }
  }

  return {
    nodeById, nextNodeById, nodeOrderIndex, chapterIndex, originConnByNodeId, anchorNodes,
    rowsForNode, rowsForConnection, nodesWithTracedArrival,
    edges, maxLane, gutterWidth, maxRenderDepth,
    hourLabelForNodeId, hourMarkers,
    isRevisitWithinWindow, arrivalNodeFor,
  }
}


