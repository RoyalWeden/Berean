import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, RotateCcw, GitBranch, ArrowLeftRight, ArrowDown, Trash2, Crosshair, StickyNote } from 'lucide-react'
import { bookName, bookChapterVerseLabel, parseRef } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent, TrailVersePreview } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, navigateTrailRef, type TrailRef } from './trailNav'
import { useWordReplace } from './useWordReplace'
import { effectiveGapMs, gapSegmentHeight, formatGap, GAP_CHIP_THRESHOLD_MS } from './trailTime'
import TrailConnectorOverlay, { useTrailConnectorPoints, GUTTER_BASE, LANE_SPACING, type TrailEdge } from './TrailConnectorOverlay'
import { BRANCH_PROMOTE_DEPTH_THRESHOLD, BRANCH_PROMOTE_DWELL_MS, LOOSE_SESSION_ID } from '@/store/studyTrailSlice'

// Whether the "why'd you jump here" edit popup is currently open — read by every TrailHoverCard
// in the spine (via useContext, not prop-drilled through every ConnRow/NodeBlock/GlanceGroupRow/
// NodeClusterGroup call site) so hover cards uniformly disappear and stay hidden while the popup
// is up. Per direct feedback: "when i click the edit button, the hover thing should go away and
// shouldnt show until i close out of the whyd you jump here thing."
const HoverDisabledContext = createContext(false)

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

// ── Indent geometry (shared) ────────────────────────────────────────────────
// ConnRow / TangentBullet marginLeft = INDENT_STEP * (depth + 1). The dot-center insets are
// measured from each row's own left edge: an off-spine bullet is a 7px dot as the first child
// of a `gap:8` flex row (center ≈ 3.5); a spine node dot is 9px centered in a 12px column
// (center = 6). The faint indent guide lines below use these so a line lands exactly under
// each bullet column at every zoom (all of it lives inside the same `scale(zoom)` wrapper).
const INDENT_STEP = 22
const OFFSPINE_DOT_INSET = 3.5
const SPINE_DOT_INSET = 6
// A node's sub-bullets (ConnRow) don't hang off the block's own left edge — they render
// INSIDE the spine row's label column, which starts after the 12px dot column + the spine
// row's own `gap: 3`. So a ConnRow at depth d actually sits at
// `gutterWidth + SPINE_LABEL_COL_INSET + INDENT_STEP*(d+1) + OFFSPINE_DOT_INSET` from the
// content's left edge. The guide lines (and a branch node's TangentBullet indent, which is
// otherwise measured from the block's own edge) add this same offset so every off-spine
// bullet at a given depth shares one x and the guide line lands on all of them.
const SPINE_LABEL_COL_INSET = 15

// ── Branch / note predicates (shared) ──────────────────────────────────────
/** The connection's own free-text note (NOT its verse ties) is non-empty. */
const hasNote = (c?: TrailConnection | null): boolean => !!c?.userNote?.trim()
/** The user hand-entered at least one to/from verse tie on this connection. */
const hasUserVerseTies = (c: TrailConnection): boolean => c.tiesFrom.length > 0 || c.tiesTo.length > 0
/** Render this connection with the full branch treatment (origin/destination tangent bullets +
 *  the 3-segment edge into the arrival node) — either it's a recorded branch, or the user
 *  hand-entered verse ties, which should be shown that way rather than buried in a hover note. */
const renderAsBranch = (c: TrailConnection): boolean => c.isBranch || hasUserVerseTies(c)
/** Whether the hover "your note" bubble has anything to show for a connection: its own note
 *  always, plus its verse ties ONLY when they aren't already drawn as a branch stub. */
const showNoteBubble = (c?: TrailConnection | null): boolean =>
  !!c && (hasNote(c) || (!renderAsBranch(c) && hasUserVerseTies(c)))

/** Parse a free-text tie string ("Mark 13:1-5") into a clickable chapter ref, or null. */
function tieToRef(s?: string): TrailRef | null {
  const p = s?.trim() ? parseRef(s.trim()) : null
  return p ? { kind: 'chapter', bookId: p.bookId, chapter: p.chapter, verse: p.verse } : null
}
/** Display label for a tie: the canonical ref label when parseable, else the raw string. */
function tieLabel(ref: TrailRef | null, raw?: string): string | undefined {
  if (ref && ref.kind === 'chapter') return bookChapterVerseLabel(ref.bookId, ref.chapter, ref.verse)
  return raw?.trim() || undefined
}

function bookLabel(bookId: string): string {
  return bookName(bookId)
}

function GapConnector({ gapMs }: { gapMs: number | null }) {
  // Only reserves a small fixed connecting stub now — for a gap big enough to show its own
  // GapDivider row (below), that row owns the rest of the reserved height itself, so the two
  // don't stack and double the visual gap. For a small gap (no divider shown), this still
  // grows to gapSegmentHeight, same as before.
  const showsDivider = gapMs != null && gapMs >= GAP_CHIP_THRESHOLD_MS
  // A null gapMs only ever means "adjacent to a tangent bullet" (see the isBranchNode/
  // nextIsBranchNode force-to-null at the call site). Per direct feedback ("look at all the
  // gaps and make them uniform... tangent gaps should be about half [the main spine gap]"),
  // this reserves NO artificial chrome at all for that case — natural stacking (this node's own
  // row height plus the tangent bullet's own padding, see TANGENT_BULLET_PAD) is what makes
  // every tangent-adjacent step (node→bullet, bullet→bullet, bullet→arrival) consistent with
  // each other, instead of three different bespoke constants each producing a different gap.
  const height = showsDivider ? 18 : gapMs == null ? TANGENT_EXTRA_GAP : gapSegmentHeight(gapMs)
  return <div style={{ flex: 1, width: 2, minHeight: height }} />
}

// A full-width row between two node blocks for a long gap — guaranteed not to overlap
// anything (it's its own block-level row in normal flow, not an overlay), and the dashed rule
// itself is the "break in time" visual cue per direct feedback ("the line at this region
// either shows like zig zag or is like dots or something to show a break in time"). Reserves
// the gap's own full height and centers its label vertically within it — per direct feedback
// ("the gap label needs to show in the vertical middle of the gap").
function GapDivider({ gapMs, minWidth, gutterWidth = 0 }: { gapMs: number; minWidth?: number; gutterWidth?: number }) {
  // No left padding/inset — per direct feedback ("the minutes later divider should go across
  // the entire thing horizontally"), this now spans edge-to-edge (through the left gutter too),
  // not just the bullet/text column's own width; the fixed 21px inset was tuned before that
  // gutter reservation existed.
  // `width: '100%'` alone only reaches as wide as this row's own containing block — which is
  // the `width: 'max-content'` zoom wrapper in MapView, i.e. exactly as wide as the WIDEST row
  // actually rendered, not the visible scroll viewport. Per direct feedback ("the blank area on
  // the right of the timeline still needs to have the horizontal line"): when every row happens
  // to be narrower than the viewport, there's leftover blank space to the right the line never
  // reached. `minWidth` (the scroll container's own live clientWidth, normalized back to local/
  // pre-zoom units by MapView) forces this row at least that wide regardless of content width.
  //
  // The left dash segment used to be `flex: 1`, splitting the row exactly in half — which only
  // lands the "Nm later" label on top of the main spine when the spine happens to sit at the
  // row's own midpoint. It doesn't: NodeBlock's own left gutter spacer (gutterWidth, reserved
  // for the return/revisit-link lanes) plus its ~3.5px bullet inset is what actually pushes the
  // spine's dashed vertical line to `gutterWidth + 3.5` from this row's left edge (see the
  // matching `left: gutterWidth + 3.5` used for the between-node arrow below). Per direct
  // feedback ("the entire component... needs to be shifted left so it is on top of the main
  // spine line... the label should be on top of that"), the left segment is now a FIXED width
  // matching that same offset instead of an even flex split, so the label always lands exactly
  // over the spine regardless of how wide the gutter reservation is this session.
  // Round 12: the label still wasn't landing on the spine after making this segment fixed-width
  // — found a real, separate bug on top of that fix. The row below is `display:flex, gap:8`,
  // and CSS `gap` inserts its 8px BETWEEN every pair of flex children, including between this
  // dash and the label that follows it — so the label's actual left edge was landing at
  // `leftDashWidth + 8`, not `leftDashWidth`, no matter how precisely leftDashWidth itself was
  // computed. Subtracting the row's own gap back out of the dash's width (floored at 0) cancels
  // that out, so the LABEL's left edge — not the dash's — is what actually lands at
  // `gutterWidth + 3.5`, matching the spine guide line's own `left: gutterWidth + 3.5` exactly.
  const ROW_GAP = 8
  const leftDashWidth = Math.max(0, gutterWidth + SPINE_DOT_INSET - ROW_GAP)
  if (window.__bereanTrailDebug) {
    // Per direct feedback ("give me the actual leftDashWidth value you see for a real session")
    // — logs the raw gutterWidth this divider actually received alongside the final (gap-
    // corrected) dash width, so it's directly checkable against the spine's own real position
    // rather than assumed. Not deduped (GapDivider instances are cheap/few per render, and each
    // one's gutterWidth is session-shared so they're all identical anyway — a single set of
    // lines per render is already quiet).
    console.log('[TrailDebug] GapDivider', { gutterWidth, leftDashWidth, rowGap: ROW_GAP })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: gapSegmentHeight(gapMs), width: '100%', minWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: ROW_GAP }}>
        <span style={{ flex: `0 0 ${leftDashWidth}px`, height: 0, borderTop: '1px dashed rgb(var(--color-surface-4))' }} />
        <span style={{
          fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', flexShrink: 0,
          letterSpacing: '.02em',
        }}>{formatGap(gapMs)} later</span>
        <span style={{ flex: 1, height: 0, borderTop: '1px dashed rgb(var(--color-surface-4))' }} />
      </div>
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
// Exported (this used to be MapView-local only) so StudyTrailArrivalPrompt.tsx's bottom-right
// toast can reuse this exact "verse connections + note" content for its own hover-to-expand
// area, instead of building a second, parallel note display — per direct feedback, one look
// for "here's the note/ties for this connection" everywhere it shows up.
export function TrailNoteBubbleContent({ conn }: { conn: TrailConnection }) {
  const replace = useWordReplace()
  // The to/from verse ties now render as the branch stub (origin/destination tangent bullets)
  // whenever they're set — so they're only shown here for connections that AREN'T drawn as a
  // branch (a same-chapter cross-ref, a return hop, a lexicon lookup — nothing to hang a stub on).
  const showTies = !renderAsBranch(conn)
  async function copy() {
    const lines = [
      conn.userNote?.trim(),
      ...(showTies ? conn.tiesFrom : []),
      ...(showTies ? conn.tiesTo : []),
    ].filter(Boolean) as string[]
    try { await navigator.clipboard.writeText(lines.join('\n')) } catch { /* clipboard unavailable — no-op */ }
  }
  // Per direct feedback ("the user should also be able to delete the note") — clears the same
  // fields ReasonPromptPopover's own Delete button does; the existing onDataChanged broadcast
  // (see electron/ipc/studyTrail.ts) is what makes this bubble disappear once the DB catches up,
  // no separate refresh callback needed here.
  function deleteNote() {
    window.studyTrail.clearConnectionNote(conn.id).catch(() => {})
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.04em' }}>Your note</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={copy} title="Copy this note"
            style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 0, display: 'flex' }}
          ><Copy size={11} /></button>
          <button
            onClick={deleteNote} title="Delete this note"
            style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 0, display: 'flex' }}
          ><Trash2 size={11} /></button>
        </span>
      </div>
      {conn.userNote && <div style={{ fontSize: 12, color: 'rgb(var(--color-text-primary))', lineHeight: 1.4, marginBottom: (showTies && (conn.tiesFrom.length || conn.tiesTo.length)) ? 6 : 0 }}>{replace(conn.userNote)}</div>}
      {showTies && conn.tiesFrom.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-secondary))', marginBottom: 2 }}>From: {conn.tiesFrom.join(', ')}</div>
      )}
      {showTies && conn.tiesTo.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-secondary))' }}>To: {conn.tiesTo.join(', ')}</div>
      )}
    </div>
  )
}

// A lightweight tangent bullet — used for the origin/destination pair shown above a
// cross-chapter branch's own spine-point node (see NodeBlock). Now carries the same hover card
// as an ordinary ConnRow (per direct feedback: "put the hover thing for tangents too") — still
// no click-to-navigate/context menu, since both bullets describe the SAME connection between
// them and the full detail (note, tie-ins, edit) already lives on the node/ConnRow they sit
// beside; this is just the same at-a-glance preview. Visually matches ConnRow's own dot+text so
// a tangent bullet looks the same whether it came from a same-chapter or cross-chapter hop, per
// direct feedback unifying the two.
// The baseline source of spacing for every tangent-adjacent step (node→first bullet, bullet→
// bullet, last bullet→arrival node) — 14px top + 14px bottom gives 28px between two stacked
// bullets. Raised from 8 per direct feedback ("make all the tangent related gaps bigger").
const TANGENT_BULLET_PAD = 14

// A small additional reservation (on top of TANGENT_BULLET_PAD) for the two transitions that
// don't get it "for free" from a bullet's own padding alone — node→first-bullet and last-
// bullet→arrival-node — so those two steps grow in step with bullet→bullet instead of staying
// pinned at zero forever. Kept the same uniform value everywhere it's used so all four tangent
// transitions still track each other.
const TANGENT_EXTRA_GAP = 10

// Extra breathing room between two ordinary, back-to-back main-spine nodes (no tangent
// involved, no real elapsed-time gap large enough to earn its own scaled height) — per direct
// feedback ("increase the gap for the main spine"), kept clearly bigger than a tangent step.
const MAIN_SPINE_GAP = 44

function TangentBullet({ label, indent, pointKey, registerPoint, hoverContent, targetRef, openMenu, onHoverKey, dimmed, conn, onOpenPrompt }: {
  label: string; indent: number; pointKey: string
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  /** What this SPECIFIC bullet's own hover card should show — the origin bullet and the
   *  destination bullet describe two different verses, so each gets its own content rather
   *  than sharing one (previously both showed the connection's destination, even when hovering
   *  the origin bullet — see TrailVersePreview's own comment). */
  hoverContent: React.ReactNode
  /** The verse THIS bullet represents — clicking/right-clicking navigates there, same as any
   *  other clickable reference in the trail. Named targetRef, not `ref` — React (18) treats a
   *  prop literally named `ref` specially even on a plain function component, which would
   *  silently strip it/warn instead of passing it through as a normal value. */
  targetRef: TrailRef | null
  openMenu?: (data: { ref: TrailRef; tangentToggle?: { active: boolean; onToggle: () => void }; x: number; y: number }) => void
  onHoverKey?: (key: string | null) => void
  dimmed?: boolean
  /** The connection both bullets in a pair are two ends of — needed for the note bubble/note
   *  button and the tangent-toggle context-menu item, all three of which act on the connection
   *  itself, not on either bullet individually. */
  conn?: TrailConnection
  onOpenPrompt?: (c: TrailConnection) => void
}) {
  const hoverDisabled = useContext(HoverDisabledContext)
  return (
    <div onMouseEnter={() => onHoverKey?.(pointKey)} onMouseLeave={() => onHoverKey?.(null)} style={{ opacity: dimmed ? 0.25 : 1, transition: 'opacity 120ms' }}>
    <TrailHoverCard
      disabled={hoverDisabled}
      content={hoverContent}
      secondaryContent={showNoteBubble(conn) ? <TrailNoteBubbleContent conn={conn!} /> : undefined}
    >
      {/* Click/cursor moved to the WHOLE row (dot + label), not just the label text — per direct
          feedback ("turn the cursor into the pointing when over the tangents too"), hovering the
          dot itself is a perfectly reasonable place to click a bullet, matching how the main
          spine's own node dot is clickable too. */}
      <div
        onClick={targetRef ? (e) => trailRefClick(targetRef, e) : undefined}
        onContextMenu={targetRef && openMenu ? (e) => openTrailRefMenu(openMenu, targetRef, e, undefined, undefined, undefined, conn ? {
          active: conn.isBranch,
          onToggle: () => window.studyTrail.updateConnectionReason(conn.id, { isBranch: !conn.isBranch }),
        } : undefined) : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `${TANGENT_BULLET_PAD}px 0`, marginLeft: indent, cursor: targetRef ? 'pointer' : undefined }}
        onMouseEnter={(e) => { if (targetRef) (e.currentTarget.querySelector('span:last-child') as HTMLElement)?.style.setProperty('text-decoration', 'underline') }}
        onMouseLeave={(e) => { (e.currentTarget.querySelector('span:last-child') as HTMLElement)?.style.setProperty('text-decoration', 'none') }}
      >
        <span ref={registerPoint(pointKey)} style={{ width: 7, height: 7, flexShrink: 0, borderRadius: '50%', background: 'rgb(var(--color-text-muted))', opacity: 0.7 }} />
        <span style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))' }}>{label}</span>
      </div>
    </TrailHoverCard>
    </div>
  )
}

function ConnRow({ conn, refFor, onOpenPrompt, openMenu, registerPoint, rowsForConnection, onHoverKey, originBookId, originChapter, hoverChain }: {
  conn: AnnotatedConn
  refFor: (conn: TrailConnection) => TrailRef | null
  onOpenPrompt: (c: TrailConnection) => void
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; x: number; y: number }) => void
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
  /** See NodeBlock's own hoverChain prop — same full hover-trace point-key set, threaded down
   *  so a same-chapter tangent row dims/pronounces exactly like everything else. */
  hoverChain?: Set<string> | null
}) {
  const replace = useWordReplace()
  const isLexicon = conn.toKind === 'lexicon'
  const needsInput = conn.clarityTier === 3 && !conn.reasonText && !conn.dismissedPromptAt
  const destVerseSuffix = conn.toVerse
    ? conn.toVerseEnd && conn.toVerseEnd !== conn.toVerse ? `:${conn.toVerse}–${conn.toVerseEnd}` : `:${conn.toVerse}`
    : ''
  // bookChapterVerseLabel (not a plain `${bookLabel} ${chapter}` join) so multi-level editions
  // like Recognitions of Clement or Shepherd of Hermas read as "Recognitions, Book 1, 2" —
  // comma-separated, book AND chapter both shown — instead of the old bare-space join, which
  // for those books read as an ambiguous run-together "Recognitions, Book 1 2".
  const chapterDestLabel = `${bookChapterVerseLabel(conn.toBookId ?? '', conn.toChapter ?? 0)}${destVerseSuffix}`
  // Each tangent bullet shows ONLY its own destination reference now — per the confirmed branch
  // model, "Deuteronomy 32:1" and "Isaiah 1:2" are two separate stacked bullets, never one
  // combined "32:1 → Isaiah 1:2" line. The origin verse isn't repeated here at all: it's simply
  // whichever bullet (a node or an earlier tangent bullet) sits right above this one — that's
  // what the origin already visually IS, no need to restate it inline.
  const label = isLexicon
    ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare'
      ? `compare · ${bookChapterVerseLabel(conn.toBookId ?? '', conn.toChapter ?? 0)}`
      : conn.toKind === 'note'
        ? 'note'
        : conn.toKind === 'video'
          ? 'video'
          : conn.isSameChapterBranch
            ? `v.${conn.toVerse ?? '?'}${conn.toVerseEnd && conn.toVerseEnd !== conn.toVerse ? `–${conn.toVerseEnd}` : ''}`
            : chapterDestLabel
  // "back to step N" text was tried and explicitly rejected ("i dont like the text 'back to
  // step 6'") — the arrow itself (curved/subtle, see TrailConnectorOverlay's routing) carries
  // the "this is a return" signal, this is just a small icon, not spelled-out text. Uses the
  // same lucide icons the rest of the app already uses for these concepts (RotateCcw for
  // revisit/return, GitBranch — literally Study Trail's own sidebar icon, see Ribbon.tsx — for
  // a branch/tangent) instead of bespoke unicode characters, per direct feedback ("make sure
  // that all the icons are using the same icons in the rest of the app").
  const labelIcon: 'return' | 'branch' | null = conn.isReturn ? 'return' : conn.isSameChapterBranch ? 'branch' : null
  const ref = refFor(conn)
  // Indent by actual chain depth — chainDepth (already tracked per connection: 0 = a fresh
  // sibling hanging directly off the anchor, 1+ = nested that many levels deeper) maps directly
  // to render depth (+1, since even a depth-0/sibling tangent is one indent step in from its
  // main bullet). No cap, per direct feedback — nest as deep as it actually goes.
  const indent = INDENT_STEP * (conn.chainDepth + 1)

  // DIRECT children only, each rendered as its own recursive <ConnRow> — no more flattening to
  // one shared indent level. Per the confirmed branch model, each further hop nests one visual
  // level deeper than whichever bullet it actually chained off (a real call-stack shape), not a
  // flat sibling list under the chain's root. chainDepth already carries the true depth (see
  // `indent` above), so a child's own recursive render just works without passing depth down
  // separately.
  const directChildren = (rowsForConnection?.get(conn.id) ?? []).slice().sort((a, b) => a.createdAt - b.createdAt)
  const childItems = groupForRender(directChildren)
  const fullChain = conn.hasChainChildren ? flattenChain(conn.id, rowsForConnection) : []
  const isPromotedChain = fullChain.length > 0 && (
    fullChain.length >= BRANCH_PROMOTE_DEPTH_THRESHOLD ||
    (fullChain[fullChain.length - 1].createdAt - conn.createdAt) >= BRANCH_PROMOTE_DWELL_MS
  )
  const hasNested = childItems.length > 0

  const hoverDisabled = useContext(HoverDisabledContext)
  const hoverDimmed = !!hoverChain && !hoverChain.has(`row:${conn.id}`)
  return (
    <div onMouseEnter={() => onHoverKey?.(`row:${conn.id}`)} onMouseLeave={() => onHoverKey?.(null)} style={{ opacity: hoverDimmed ? 0.3 : 1, transition: 'opacity 120ms' }}>
    <TrailHoverCard
      disabled={hoverDisabled}
      content={<TrailConnectionHoverContent conn={conn} onEditNote={() => onOpenPrompt(conn)} />}
      secondaryContent={showNoteBubble(conn) ? <TrailNoteBubbleContent conn={conn} /> : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', marginLeft: indent }}>
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
          onContextMenu={ref ? (e) => openTrailRefMenu(openMenu, ref, e, undefined, () => window.studyTrail.deleteConnection(conn.id), undefined, {
            active: conn.isBranch,
            onToggle: () => window.studyTrail.updateConnectionReason(conn.id, { isBranch: !conn.isBranch }),
          }) : undefined}
          style={{
            fontSize: 12, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1,
            cursor: ref ? 'pointer' : undefined, display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={(e) => { if (ref) (e.currentTarget as HTMLElement).style.textDecoration = 'underline' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none' }}
        >
          {labelIcon === 'return' && <RotateCcw size={11} style={{ opacity: 0.7, flexShrink: 0 }} />}
          {labelIcon === 'branch' && <GitBranch size={11} style={{ opacity: 0.7, flexShrink: 0 }} />}
          {label}
          {hasNote(conn) && (
            <StickyNote size={11} aria-label="Has a note" style={{ opacity: 0.5, marginLeft: 3, flexShrink: 0, color: 'rgb(var(--color-text-muted))' }} />
          )}
        </span>
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
        {/* The always-visible row-level pencil that used to live here was removed — per direct
            feedback ("the revisit item has the pencil icon outside of the hover popup but it
            should only be inside the hover popup thing"), the note-edit trigger now lives
            exclusively inside the hover card (TrailConnectionHoverContent's own EditNoteBtn),
            not duplicated as a second always-visible affordance on the row itself. */}
      </div>
    </TrailHoverCard>
    {hasNested && (
      // Each DIRECT child recurses through ConnRow again, so its own `indent` (chainDepth+1)
      // naturally nests one level deeper than this row — per the confirmed model, a real
      // call-stack shape, not a flat sibling list under the chain's root.
      childItems.map((it) => it.type === 'single'
        ? <ConnRow key={it.item.id} conn={it.item} onHoverKey={onHoverKey} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} rowsForConnection={rowsForConnection} originBookId={originBookId} originChapter={originChapter} hoverChain={hoverChain} />
        : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)
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
  const labelFor = (c: TrailConnection) => c.toKind === 'lexicon' ? `Strong's ${c.toStrongsNum}` : bookChapterVerseLabel(c.toBookId ?? '', c.toChapter ?? 0)
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
  onOpenPrompt, refFor, openMenu, originConnByNodeId, jumpToOrigin, rowsForConnection, hoverChain, gutterWidth,
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
  /** Was missing entirely before — every node rendered through this cluster (a "bounced Nx"
   *  run of revisits) never dimmed no matter what was hovered elsewhere, since hoverChain
   *  defaults to undefined when not passed. Per direct feedback ("i hovered over an item that
   *  had a revisit and it is highlighting everything else too... it should dim everything past
   *  it including the revisit stuff"). */
  hoverChain?: Set<string> | null
  /** Same reserved left-gutter width every main-spine NodeBlock gets — a "bounced Nx" run is
   *  still on the main spine, so its nodes' dots must line up vertically with every other spine
   *  dot. Was hardcoded to 0 here, which (once the gutter grew for the revisit-link lanes those
   *  very bounces create) planted the whole collapsed cluster `gutterWidth` px left of the
   *  spine — the "revisit rows drift further left the more I revisit" bug. */
  gutterWidth: number
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
            gutterWidth={gutterWidth} rowsForConnection={rowsForConnection} hoverChain={hoverChain}
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
        gutterWidth={gutterWidth} rowsForConnection={rowsForConnection} hoverChain={hoverChain}
      />
      <NodeBlock
        node={last} connections={connectionsByNodeId.get(last.id) ?? []} gapToNextMs={null} isLast={false}
        step={(nodeOrderIndex.get(last.id) ?? -1) + 1} registerPoint={registerPoint} onHoverKey={onHoverKey}
        onOpenPrompt={onOpenPrompt} refFor={refFor} openMenu={openMenu}
        originConn={originConnByNodeId.get(last.id)}
        onJumpToOrigin={originConnByNodeId.has(last.id) ? () => jumpToOrigin(originConnByNodeId.get(last.id)!) : undefined}
        gutterWidth={gutterWidth} rowsForConnection={rowsForConnection} hoverChain={hoverChain}
        bounceBadge={{ count: nodes.length - 1, spanMs, onExpand: () => setExpanded(true) }}
      />
    </div>
  )
}

function NodeBlock({
  node, connections, gapToNextMs, isLast, onOpenPrompt, refFor, openMenu, originConn, registerPoint, boundaryLabel, onJumpToOrigin,
  keyboardFocused, dimmed, searchMatched, blockRef, gutterWidth, step, onHoverKey, rowsForConnection, onDeleteNode, onToggleTopicBreak, bounceBadge,
  isBranchNode, branchDepth, originVerseLabel, originVerseRef, destVerseLabel, destVerseRef, hoverChain, revisitAllowed = true, selected,
}: {
  node: TrailNode; connections: AnnotatedConn[]; gapToNextMs: number | null; isLast: boolean
  /** Part of the current marquee selection (drag-select in the timeline). */
  selected?: boolean
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; topicBreak?: { active: boolean; onToggle: () => void }; x: number; y: number }) => void
  originConn?: TrailConnection
  registerPoint: (key: string) => (el: HTMLElement | null) => void
  boundaryLabel?: string
  onJumpToOrigin?: () => void
  /** Right-click "Delete" on this node's bullet — removes the node and its directly-attached
   *  branch connections, with a confirmation step (see TrailRefContextMenu). */
  onDeleteNode?: (nodeId: string) => void
  /** Right-click toggle for marking/unmarking this node as a topic break (a divider on the
   *  main spine) — the direct, popup-free way to add one, per direct feedback. */
  onToggleTopicBreak?: (nodeId: string, current: boolean) => void
  /** A collapsed cluster's summary badge, rendered inline in this node's header instead of a
   *  separate row — see NodeClusterGroup. */
  bounceBadge?: { count: number; spanMs: number; onExpand: () => void }
  /** This node was reached via a user-marked tangent/branch connection (not a normal spine
   *  continuation) — per direct feedback describing the exact expected look: "deuteronomy 32
   *  is on the main branch then deuteronomy 32:1 goes on the side branch, isaiah 1:2 is the
   *  next entry on that same side branch." Rendered indented, with a small mini-bullet showing
   *  the specific verse the branch left FROM stacked right above this node's own title. */
  isBranchNode?: boolean
  /** How many branch hops deep (0 = first hop off main) — additional indentation per level, so
   *  a tangent-off-a-tangent reads as visibly nested further, not just flat. */
  branchDepth?: number
  /** "Deuteronomy 32:1" — the specific verse this branch departed FROM, when known. */
  originVerseLabel?: string
  /** The same verse as originVerseLabel, structured as a clickable TrailRef — lets the origin
   *  tangent bullet navigate/right-click like any other reference (per direct feedback: "make
   *  sure to show the tangents as clickable to go to the verse"). */
  originVerseRef?: TrailRef | null
  /** Destination tangent bullet label — computed by MapView (a hand-entered "To" verse tie, or
   *  the arrival chapter + landed-on verse). Falls back to the inline chapter/verse build when
   *  not provided (NodeClusterGroup's non-branch NodeBlocks). */
  destVerseLabel?: string
  /** Destination tangent bullet's clickable ref. */
  destVerseRef?: TrailRef | null
  /** The full hover-trace chain of point keys (node:/row:/tangent-origin:/tangent-dest:) built
   *  by MapView when something is hovered — null when nothing is hovered. Everything NOT in
   *  this set dims out; per direct feedback ("pronounce the arrows that led to that point and
   *  dim everything else out — other lines and labels and bullets"), that includes this node's
   *  own bullet/label whenever it isn't part of whatever's being traced. */
  hoverChain?: Set<string> | null
  /** Whether a recorded revisit (node.revisitOfNodeId) still counts as one at render time — the
   *  revisit time-window slider's live gate (see isRevisitWithinWindow in MapView). Defaults to
   *  true (always honor a recorded revisit) for callers — NodeClusterGroup's own bounce-cluster
   *  path — that don't have an opinion here. */
  revisitAllowed?: boolean
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
  const hoverDisabled = useContext(HoverDisabledContext)
  const nodeRef: TrailRef = { kind: 'chapter', bookId: node.bookId, chapter: node.chapter }
  const items = groupForRender(connections)
  const isRevisit = !!node.revisitOfNodeId && revisitAllowed
  // A chapter ARRIVAL never indents — only the tangent bullets that led to it (the two
  // TangentBullet rows above) do. Per direct feedback: "luke 4 should be indented back to the
  // main spine and not looking indented like how it is" — the node itself always sits flush at
  // the spine's own left edge, whether it was reached plainly or via a tangent.
  const indent = 0
  // + SPINE_LABEL_COL_INSET: these tangent bullets render as direct children of the block's
  // own left edge, but a same-depth ConnRow sits one dot-column + gap further in (inside the
  // spine row's label column). Matching that offset keeps every off-spine bullet at a given
  // depth on one x — and on the same faint guide line.
  const tangentIndent = isBranchNode ? SPINE_LABEL_COL_INSET + INDENT_STEP * ((branchDepth ?? 0) + 1) : 0
  const hoverDimmed = !!hoverChain && !hoverChain.has(`node:${node.id}`)
  return (
    // Left gutter — per the plan's "revisit arcs move to a left gutter": the WHOLE block (its
    // tangent bullets included, not just this node's own row) shifts right by gutterWidth,
    // reserving space on the left for the laned return/revisit-link edges built in MapView to
    // route through, so they can arc in from the left with nothing — no text, no bullets — ever
    // in their way. One shared spacer here (not one per row) keeps every node's own tangent
    // bullets aligned with its own main-row dot, since both now live inside this same shifted
    // wrapper.
    <div style={{ display: 'flex' }}>
      {gutterWidth > 0 && <div ref={registerPoint('gutter:x')} style={{ width: gutterWidth, flexShrink: 0 }} />}
      <div
        ref={blockRef}
        style={{
          flex: 1, minWidth: 0,
          // hoverDimmed dropped from here — per direct feedback ("hovering over deut 32:29 is
          // dimming deut 32:29 and the previous tangent item isaiah 1:3, that shouldn't be
          // happening"): this wrapper is the ANCESTOR of both this node's own tangent-origin/
          // tangent-dest bullets below (each already independently opacity-managed against the
          // exact same hoverChain) AND its own plain spine-point row. Applying hoverDimmed HERE
          // multiplied a 0.3 opacity onto the whole subtree regardless of what each child's own
          // (correctly-computed) opacity said — dimming the tangent bullets even while hovering
          // one of them, since `node:${node.id}` itself (as opposed to its own tangent-dest/
          // origin) isn't always part of the pronounced chain for that hover. Only `dimmed`
          // (the unrelated search-match dim, where dimming the WHOLE node together is actually
          // correct) stays here; hover-driven dimming moves to the specific row it's about
          // below, next to the other two already-independent bullets.
          opacity: dimmed ? 0.3 : 1, borderRadius: 8, transition: 'opacity 120ms, box-shadow 120ms',
          boxShadow: selected ? '0 0 0 2px rgb(var(--color-accent))' : keyboardFocused ? '0 0 0 2px rgb(var(--color-accent))' : searchMatched ? '0 0 0 2px rgb(var(--color-accent) / 0.4)' : 'none',
          background: selected ? 'rgb(var(--color-accent) / 0.16)' : undefined,
          marginLeft: indent,
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
      {/* Two full, equally-styled tangent bullets — the verse departed FROM and the verse
          arrived AT — as siblings at this tangent's own indent, both distinct from (and sitting
          right above) this node's own plain "Isaiah 11"-style spine-point row below. Per direct
          feedback: "show Isaiah 11:13 as a sibling of the tangent instead of a spine point, and
          it also needs a spine point to Isaiah 11" — the node itself stays the bare-chapter
          spine point; these two rows are the actual tangent hop that led to it. */}
      {isBranchNode && originVerseLabel && (
        <div style={{ marginBottom: 2 }}>
          <TangentBullet
            label={originVerseLabel} indent={tangentIndent} pointKey={`tangent-origin:${node.id}`} registerPoint={registerPoint}
            hoverContent={originVerseRef?.kind === 'chapter'
              ? <TrailVersePreview bookId={originVerseRef.bookId} chapter={originVerseRef.chapter} verse={originVerseRef.verse!} onEditNote={originConn ? () => onOpenPrompt(originConn) : undefined} />
              : null}
            targetRef={originVerseRef ?? null} openMenu={openMenu} onHoverKey={onHoverKey}
            dimmed={!!hoverChain && !hoverChain.has(`tangent-origin:${node.id}`)}
            conn={originConn} onOpenPrompt={onOpenPrompt}
          />
          <TangentBullet
            label={destVerseLabel ?? `${bookChapterVerseLabel(node.bookId, node.chapter)}${originConn?.toVerse != null ? `:${originConn.toVerse}${originConn.toVerseEnd && originConn.toVerseEnd !== originConn.toVerse ? `–${originConn.toVerseEnd}` : ''}` : ''}`}
            indent={tangentIndent}
            pointKey={`tangent-dest:${node.id}`}
            registerPoint={registerPoint}
            hoverContent={originConn ? <TrailConnectionHoverContent conn={originConn} onEditNote={() => onOpenPrompt(originConn)} /> : null}
            targetRef={destVerseRef ?? (originConn ? refFor(originConn) : null)}
            openMenu={openMenu}
            onHoverKey={onHoverKey}
            dimmed={!!hoverChain && !hoverChain.has(`tangent-dest:${node.id}`)}
            conn={originConn} onOpenPrompt={onOpenPrompt}
          />
        </div>
      )}
      {/* gap: 3 (was 12, then 6) — per direct feedback ("move the main spine labels ... closer
          to the bullet more"), the label sits right next to its own bullet. */}
      {/* onMouseEnter/onMouseLeave own hover claim moved HERE from the outer wrapper — per direct
          feedback ("sometimes when i go from hovering over one bullet to the next it doesnt
          update the dimness correctly... typically when i go from a tangent to a main spine").
          React's onMouseEnter/onMouseLeave don't bubble, so when the outer wrapper owned this,
          it fired ENTER once on first crossing into the whole NodeBlock, then never again —
          leaving a child TangentBullet (which sets hoveredKey to null on its own leave) had
          nothing to restore `node:${node.id}`, since re-entering THIS row from a sibling child
          within the same still-hovered outer block doesn't re-trigger the outer's enter. Giving
          this row (a sibling to the tangent bullets and nested ConnRows, not their ancestor) its
          own enter/leave pair fixes it: every hoverable region here is now a flat sibling, so
          moving between any two of them correctly fires leave(prev) then enter(next). */}
      <div
        onMouseEnter={() => onHoverKey?.(`node:${node.id}`)}
        onMouseLeave={() => onHoverKey?.(null)}
        style={{
          display: 'flex', gap: 3, marginBottom: isLast ? 0 : (gapToNextMs == null ? 0 : MAIN_SPINE_GAP),
          opacity: hoverDimmed ? 0.3 : 1, transition: 'opacity 120ms',
        }}
      >
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
      {/* maxWidth caps how far this stretches — `flex:1` alone lets it grow to match whatever
          the WIDEST row anywhere in the whole spine happens to need (a long note preview, a
          long Strong's list, etc.), dragging the gutter column (registered right after this
          div) far out to the right of THIS row's own short text along with it — which is
          exactly why laned edges (revisit-links, branch-return arrows) were swinging out into
          a wide loop well past nearby text instead of hugging close to the actual content. */}
      <div style={{ paddingBottom: (!isLast && gapToNextMs == null) ? TANGENT_EXTRA_GAP : 24, flex: 1, minWidth: 0, maxWidth: 'var(--trail-row-max, 460px)' }}>
        {/* OriginBadgeLine (the always-visible "via X" line) was removed per direct feedback:
            "i dont think the 'via Strong's G3619 occurrence' and such should be showing
            outside of the hover thing... only really main text and chapters and strongs and
            such should be showing outside of the hover thing" — keeps the always-visible area
            clean (bare chapter/verse/Strong's-number labels only) so the connection lines
            themselves read more clearly; the full "via ..." fact is still one hover away, see
            TrailNodeHoverContent below. */}
        <TrailHoverCard
          disabled={hoverDisabled}
          content={<TrailNodeHoverContent node={node} originConn={originConn} onEditNote={originConn ? () => onOpenPrompt(originConn) : undefined} />}
          secondaryContent={showNoteBubble(originConn) ? <TrailNoteBubbleContent conn={originConn!} /> : undefined}
        >
          <div
            onClick={(e) => trailRefClick(nodeRef, e)}
            onContextMenu={(e) => openTrailRefMenu(
              openMenu, nodeRef, e, onJumpToOrigin,
              onDeleteNode ? () => onDeleteNode(node.id) : undefined,
              onToggleTopicBreak ? { active: node.isTopicBreak, onToggle: () => onToggleTopicBreak(node.id, node.isTopicBreak) } : undefined,
              originConn ? {
                active: originConn.isBranch,
                onToggle: () => window.studyTrail.updateConnectionReason(originConn.id, { isBranch: !originConn.isBranch }),
              } : undefined,
            )}
            style={{
              fontFamily: 'ui-monospace, monospace', fontSize: isRevisit ? 12 : 13.5, fontWeight: 600, cursor: 'pointer',
              color: isRevisit ? 'rgb(var(--color-text-secondary))' : 'rgb(var(--color-text-primary))',
              // isRevisit italicizes the WHOLE row (step number + reference), not just the
              // REVISIT pill — per direct feedback, the pill alone read as an inconsistent
              // "half italic" row; the label itself should read as a revisit too.
              fontStyle: isRevisit ? 'italic' : 'normal',
              display: 'flex', alignItems: 'center', gap: 6,
              // whiteSpace:nowrap — without it, a book/chapter label long enough to hit the
              // ancestor's 460px maxWidth (multi-level editions like Recognitions/Hermas are the
              // common case, and got noticeably longer with the "Book N" formatting fix above)
              // wraps its text onto a second line instead of just overflowing horizontally. That
              // second line pushes the REVISIT/bounce badge down with it and grows this row's
              // height past what the fixed-width dot column (vertically centered for a single
              // line) expects — the "REVISIT badge row overlaps/misaligns with the node above it"
              // indenting bug. Overflowing sideways here is harmless (this row already isn't
              // clipped), so nowrap is a strict improvement over letting it wrap.
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-muted))', opacity: 0.7,
              minWidth: 14, textAlign: 'right', flexShrink: 0,
            }}>{step}</span>
            {bookChapterVerseLabel(node.bookId, node.chapter)}
            {hasNote(originConn) && (
              <StickyNote size={11} aria-label="Has a note" style={{ opacity: 0.5, flexShrink: 0, color: 'rgb(var(--color-text-muted))' }} />
            )}
            {isRevisit && !bounceBadge && (
              <span style={{
                fontSize: 9, fontWeight: 700, fontStyle: 'italic', color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
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
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-accent))', background: 'rgb(var(--color-accent) / 0.14)',
                  border: 'none', borderRadius: 999, padding: '1px 6px', cursor: 'pointer', letterSpacing: '.01em',
                }}
              ><ArrowLeftRight size={10} /> {bounceBadge.count}x</button>
            )}
          </div>
        </TrailHoverCard>
        {node.cachedSubnote && <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 1 }}>{replace(node.cachedSubnote)}</div>}
        <div style={{ marginTop: 4 }}>
          {items.map((it) => it.type === 'single'
            ? <ConnRow key={it.item.id} conn={it.item} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} rowsForConnection={rowsForConnection} onHoverKey={onHoverKey} originBookId={node.bookId} originChapter={node.chapter} hoverChain={hoverChain} />
            : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        </div>
      </div>
      </div>
    </div>
    </div>
  )
}

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2

// Approx rendered widths of the floating controls, for the left-vs-right placement decision.
export const CTRL_W = { header: 236, zoom: 108, latest: 88 }
/** Prefer the LEFT side; fall back to the right only if the control wouldn't fit clear of the
 *  spine/branches there (per direct feedback). `room` is MapView's reported per-side clearance. */
export function pickControlSide(room: { left: number; right: number } | undefined, w: number): 'left' | 'right' {
  if (!room) return 'left'
  const need = w + 16
  if (room.left >= need) return 'left'
  if (room.right >= need) return 'right'
  return room.left >= room.right ? 'left' : 'right'
}

export default function MapView({
  detail, onChanged, boundaryLabelForNodeId, zoom: zoomProp, onZoomChange, revisitWindowMs,
  filterValue, onFilterChange, topInset = 0, onLayoutRoomChange, onCurrentHourChange,
}: {
  detail: TrailSessionDetail; onChanged: () => void; boundaryLabelForNodeId?: Map<string, string>
  /** Reports the live clear space (px) on each side of the trail's SOLID content (spine +
   *  branch bullets — faint arcs don't count) so the parent can decide which side to float its
   *  own header / zoom controls on. Per direct feedback: those controls default to the left and
   *  "swap to the right if they will get in the way of the main spine/branches". */
  onLayoutRoomChange?: (room: { left: number; right: number }) => void
  /** Reports the clock hour of whichever chapter stop is currently at the top of the scroll
   *  view (advances as you scroll) — the parent shows it INSIDE the session header pill so
   *  there's one floating thing, not a separate hour pill the user couldn't spot. */
  onCurrentHourChange?: (hour: string | null) => void
  /** Extra top padding inside the scroll area — used when the parent floats its session-header
   *  bar over the top of the map (StudyTrailApp) so the first stop isn't pinned flush to the
   *  window edge. Kept small on purpose: the whole point of floating the header is that trail
   *  content is allowed to scroll UNDER it, reclaiming that vertical space. */
  topInset?: number
  /** Timeline filter, hoisted into the parent's title row (per direct feedback: "the filter
   *  timeline thing should be moved to the right of the name of the session"). When
   *  onFilterChange is supplied MapView renders NO input of its own and reads filterValue
   *  instead; Enter in the parent's input dispatches `berean:trailFilterSubmit` to jump to the
   *  first match. Uncontrolled (own input) when omitted, for a standalone mount. */
  filterValue?: string
  onFilterChange?: (v: string) => void
  /** Zoom is normally OWNED by StudyTrailApp (rendered in its title bar, top-right, so it
   *  applies consistently whether you're looking at one session or the merged Everything
   *  timeline) — these are optional purely so MapView still works if ever mounted standalone
   *  without a controlling parent. */
  zoom?: number
  onZoomChange?: (zoom: number) => void
  /** How much real elapsed time still counts a chapter re-arrival as a REVISIT (dashed backlink
   *  + badge) rather than a fresh, independent bullet — owned by StudyTrailApp's floating
   *  slider (1h–1wk), same reasoning as `zoom` above. undefined = no cutoff (always treat a
   *  recorded revisit as a revisit), for the same standalone-mount fallback reason as zoom. */
  revisitWindowMs?: number
}) {
  const [promptConn, setPromptConn] = useState<TrailConnection | null>(null)
  const { pointsRef, registerPoint } = useTrailConnectorPoints()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const needsInputCount = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length

  // Tracks the scroll viewport's own live width so GapDivider (below) can force its dashed line
  // at least that wide — the timeline's content wrapper is `width: max-content` (sized to its
  // widest row), so a GapDivider row narrower than the viewport otherwise leaves the visible
  // blank area to its right with no line through it. See GapDivider's own comment.
  const [viewportWidth, setViewportWidth] = useState(0)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    ro.observe(el)
    setViewportWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Open scrolled to the MOST RECENT event by default, not the earliest — per direct feedback
  // ("when opening any of the timeline things, even in everything, it should scroll to the
  // bottom by default"). Same idiom as AiLookupPanel.tsx's chat auto-scroll. Keyed on the node
  // count so it re-fires once data actually finishes loading (detail starts empty on mount) —
  // but ONLY when the user was already at/near the bottom (see isAtBottomRef below); a new node
  // streaming in via the push update while they've scrolled up to review earlier history must
  // not yank them back down.
  const isAtBottomRef = useRef(true)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const NEAR_BOTTOM_PX = 40
  function checkAtBottom() {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    isAtBottomRef.current = atBottom
    setShowScrollToLatest(!atBottom)
  }
  // Suppresses the app-wide scrollbar auto-reveal (src/lib/scrollbarAutoHide.ts) for OUR OWN
  // programmatic scrolls (Latest/Recenter) — that global listener treats ANY native 'scroll'
  // event as "the user is actively scrolling" and reveals the (normally invisible-at-rest)
  // thumb for ~900ms, including scroll events a `scrollTo({behavior:'smooth'})` animation fires
  // on its own. Per direct feedback ("don't show scrollbars on programmatic scroll if they
  // weren't already showing"). Fixed entirely within this file rather than touching that shared,
  // app-wide script: a capture-phase listener on `window` — an ANCESTOR of `document`, where the
  // global listener is registered, and capture fires ancestor-first — intercepts our own scroll
  // events and calls stopImmediatePropagation() on them while `suppressFlashRef` is armed, so
  // they never reach the global listener at all. Scoped to exactly this one container (checks
  // `e.target`), so a manual scroll anywhere — including THIS container, once the programmatic
  // scroll has finished — behaves exactly as before.
  const suppressFlashRef = useRef(false)
  useEffect(() => {
    function onScrollCapture(e: Event) {
      if (suppressFlashRef.current && e.target === scrollContainerRef.current) e.stopImmediatePropagation()
    }
    window.addEventListener('scroll', onScrollCapture, true)
    return () => window.removeEventListener('scroll', onScrollCapture, true)
  }, [])
  function scrollToSuppressingFlash(run: () => void) {
    const el = scrollContainerRef.current
    suppressFlashRef.current = true
    run()
    const clear = () => { suppressFlashRef.current = false; el?.removeEventListener('scrollend', clear) }
    el?.addEventListener('scrollend', clear)
    // Fallback in case `scrollend` never fires (older engines, or the scroll was a no-op because
    // we were already there) — a smooth scroll never legitimately takes anywhere near this long.
    setTimeout(clear, 1000)
  }

  function scrollToLatest() {
    const el = scrollContainerRef.current
    if (!el) return
    scrollToSuppressingFlash(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }))
  }
  // Horizontal placement model (reworked per direct feedback: "center the content block ... the
  // revisit lines on the right should sit on the left side instead of being in the center"):
  // the whole content block — the left revisit/return-arc gutter, the spine, every indent
  // column, the labels — is CENTERED in the viewport. `pad` (computed in the render body from
  // the live content width vs viewport width) is symmetric and collapses to 0 the moment the
  // content is wider than the viewport, so:
  //   • narrow content  → equal pad both sides → block sits centered, scrollWidth == clientWidth,
  //                        no scrollbar, nothing to overscroll into on either side;
  //   • wide content     → pad 0 → native scroll range is exactly the two content edges, and the
  //                        browser clamps there — scrolling past the block is structurally
  //                        impossible (this is what replaces the old clampLeftOverscroll hack and
  //                        the asymmetric left padding that caused the repeated "i can scroll the
  //                        left too far" regressions).
  // "Centered" for the recenter button / target therefore just means "scrolled to the middle of
  // whatever scroll range exists" — no spine-anchor measurement needed.
  const CENTER_TOLERANCE_PX = 40
  const [nearCenter, setNearCenter] = useState(true)
  function centerScrollTarget(el: HTMLElement): number {
    return Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  }
  // `behavior: 'auto'` (instant) is what the session-open / zoom / tab-return effects use — no
  // visible motion; the recenter BUTTON keeps the animated 'smooth' path (and its flash
  // suppression). When the content fits the viewport, scrollWidth == clientWidth → target 0 → a
  // no-op, which is correct (the block is already centered by `pad`).
  function recenterHorizontal(behavior: 'smooth' | 'auto' = 'smooth') {
    const el = scrollContainerRef.current
    if (!el) return
    const target = centerScrollTarget(el)
    if (behavior === 'auto') {
      el.scrollLeft = target
    } else {
      scrollToSuppressingFlash(() => el.scrollTo({ left: target, behavior: 'smooth' }))
    }
  }
  function checkCentered() {
    const el = scrollContainerRef.current
    if (!el) { setNearCenter(true); return }
    setNearCenter(Math.abs(el.scrollLeft - centerScrollTarget(el)) <= CENTER_TOLERANCE_PX)
  }
  useEffect(() => { checkCentered() }) // eslint-disable-line react-hooks/exhaustive-deps
  // Kept fresh for the zoom / tab-return recenter effects below, which need to know whether the
  // spine was ALREADY centered at the moment the trigger fired (per direct feedback: re-center
  // on zoom and on tab return, "but only do when it was already centered before").
  const nearCenterRef = useRef(nearCenter)
  useEffect(() => { nearCenterRef.current = nearCenter }, [nearCenter])
  // Centers `el` inside `scrollContainerRef` — used instead of the native `el.scrollIntoView()`
  // for every jump-to-node action below (arrow-key nav, "scroll to where this came from",
  // search's jump-to-first-match). Native scrollIntoView miscalculates badly here: the whole
  // spine sits inside a `transform: scale(zoom)` wrapper (see the render below), and on a
  // session with enough content BEFORE the target node to make the scaled child's rendered
  // (visual) height diverge a lot from its layout height, Chromium's built-in algorithm has been
  // seen to overshoot the scroll target completely off the end of the scrollable range — reported
  // as "the outline scrolls way past the chapter content, it's not reachable" on a session where
  // Zechariah 4 was deep in a long spine. Computing the delta ourselves in plain getBoundingClientRect
  // (visual/client) pixels sidesteps the transform entirely — a scrollTop delta of N always moves
  // the container's own viewport by exactly N visual px, regardless of what's scaled inside it —
  // and clamping the result to [0, scrollHeight - clientHeight] makes "scrolls past the content"
  // structurally impossible no matter what the underlying miscalculation might have been.
  // Double rAF (not a single one, not a bare call) waits for TWO real paint cycles first, so a
  // node that just became visible via search/filter/glance-group-expand has actually settled into
  // its final layout position before we measure it — a same-tick call was the "race" this also
  // fixes: measuring against still-animating/pre-layout geometry silently reintroduces the exact
  // overshoot this is meant to prevent.
  function scrollNodeIntoView(el: HTMLElement | null | undefined, behavior: ScrollBehavior = 'smooth') {
    if (!el) return
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (!container || !el.isConnected) return
      const cRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const target = container.scrollTop + (elRect.top - cRect.top) - (cRect.height - elRect.height) / 2
      const clamped = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight))
      container.scrollTo({ top: clamped, behavior })
    }))
  }
  useEffect(() => {
    if (isAtBottomRef.current) scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight })
  }, [detail.nodes.length])
  // Auto-recenter HORIZONTALLY the first time a session actually has real node data to center
  // on — per direct feedback ("center the timeline automatically when first opening any
  // session, not just via the recenter button"). Guarded by `centeredSessionRef` so this fires
  // exactly once per genuine session-open (keyed on `detail.session.id`, which changes whenever
  // StudyTrailApp swaps to a different session or into/out of the merged Everything timeline —
  // MapView itself is never remounted on a plain session switch, see recenterHorizontal's own
  // comment on why that matters elsewhere), not on every later data update (a new node/connection
  // streaming into the session you already have open must never yank the horizontal scroll
  // out from under you).
  //
  // useLayoutEffect + instant `behavior: 'auto'`, NOT useEffect + a smooth scroll — per direct
  // feedback ("should already BE centered on first render, no visible motion; the manual recenter
  // BUTTON should stay animated, this specific path shouldn't be"). useLayoutEffect fires
  // synchronously after this commit's DOM mutations but BEFORE the browser paints, and the node
  // dots' ref callbacks (registerPoint) already fired as part of THIS SAME commit — so the anchor
  // point is already resolvable with no rAF/layout-settle wait needed here (unlike
  // scrollNodeIntoView's jump-to-node cases, which can involve content still animating/expanding
  // after a click). Setting `scrollLeft` directly (inside recenterHorizontal's `behavior: 'auto'`
  // branch) never animates and therefore never paints an intermediate, off-center frame at all.
  const centeredSessionRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (detail.nodes.length === 0) return
    if (centeredSessionRef.current === detail.session.id) return
    centeredSessionRef.current = detail.session.id
    recenterHorizontal('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.session.id, detail.nodes.length])

  const [ownZoom, setOwnZoom] = useState(1)
  const zoom = zoomProp ?? ownZoom
  const setZoom = onZoomChange ?? setOwnZoom

  // Live width of the content block (containerRef), in local/pre-transform units — drives the
  // symmetric centering pad below. Re-measured on zoom change (getBoundingClientRect is
  // post-transform) and whenever the content itself reflows (ResizeObserver).
  const [contentWidth, setContentWidth] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setContentWidth(el.getBoundingClientRect().width / zoom)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [zoom])

  // Re-center horizontally after a zoom change — but ONLY if the spine was already centered
  // before the zoom (per direct feedback: "if it was centered before and the user zooms, make
  // sure to recenter... but only do when it was already centered before"). A zoom that happens
  // while the user has deliberately scrolled off-center is left where it is. `nearCenter` here
  // is still the pre-zoom value on the render that triggers this effect (checkCentered's own
  // state update for the new zoom hasn't committed yet). rAF lets the scaled layout settle
  // first so recenterHorizontal measures the anchor at its final position.
  const prevZoomRef = useRef(zoom)
  useEffect(() => {
    if (prevZoomRef.current === zoom) return
    prevZoomRef.current = zoom
    if (!nearCenter) return
    const id = requestAnimationFrame(() => recenterHorizontal('auto'))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // Quick filter/highlight while looking at a (possibly long) spine — not a replacement for
  // the Review tab's cross-session search, just a way to spot things without scrolling/reading
  // every row. Matches against the chapter label and every connection's label/reasonText.
  const [ownSearchQuery, setOwnSearchQuery] = useState('')
  const controlledFilter = onFilterChange != null
  const searchQuery = controlledFilter ? (filterValue ?? '') : ownSearchQuery
  const setSearchQuery = controlledFilter ? onFilterChange! : setOwnSearchQuery
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Hover-to-isolate — the design persona's highest-value/lowest-effort fix: hovering any node
  // or connection row dims every edge that doesn't touch it, no topology change required. Wired
  // into the edges array just before it's passed to the overlay (see below).
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const lastVisibilityLogRef = useRef<string | null>(null)
  const { menu, menuRef, openMenu: openMenuRaw, closeMenu } = useTrailRefMenu()
  // Right-clicking a row/node to open its context menu, then dismissing the menu by clicking
  // elsewhere WITHOUT first moving the mouse back over the original row, never fires that
  // row's own onMouseLeave — hoveredKey was getting stuck pointing at it forever, leaving
  // every OTHER edge dimmed to 15% opacity permanently ("when i rightclick, it removes all the
  // lines and stuff and they dont come back"). Clearing it the moment a menu opens closes that
  // gap regardless of how the menu later gets dismissed.
  function openMenu(data: Parameters<typeof openMenuRaw>[0]) {
    // Per direct feedback ("the connecting lines are going invisible when i rightclick the
    // items... put a log for what happens") — logs the actual hoveredKey transition right-click
    // causes, so a report of lines vanishing on right-click can be matched against whether
    // hoveredKey really did clear here (working as this function intends) or something else
    // entirely is dimming things afterward (a stuck menu-open state, a stale hoverChain, etc.).
    if (window.__bereanTrailDebug) console.log('[TrailDebug] openMenu — clearing hoveredKey', { prevHoveredKey: hoveredKey, ref: data.ref })
    setHoveredKey(null)
    openMenuRaw(data)
  }
  // ROOT CAUSE of "the connecting lines are going invisible when i rightclick the items" (the
  // debug log above confirmed it): right-clicking never moves the cursor, so the very row whose
  // menu you just opened is still sitting under the mouse — its own onMouseEnter had already
  // fired before the click, and nothing stopped it from firing AGAIN (a re-render moving/
  // resizing the row under a stationary cursor is enough to resynthesize one) while the menu is
  // still open, re-setting hoveredKey right back and re-triggering the aggressive
  // dim-everything-else effect for as long as the menu stays up — openMenu's own clear only
  // wins for one render. Route every onHoverKey call through this instead of setHoveredKey
  // directly: while a menu is open, a new (non-null) hover claim is ignored outright — clearing
  // back to null (a real mouseleave) still goes through, so nothing gets stuck once the menu
  // closes and the cursor genuinely leaves.
  function handleHoverKey(key: string | null) {
    if (menu && key) return
    setHoveredKey(key)
  }
  // Generalizes the fix above to its actual root cause rather than patching one trigger at a
  // time — per direct feedback ("some items in the study trail going invisible... seems when i
  // go to a new scripture"): navigating in the separate MAIN Bible window never fires a
  // mouseleave in THIS window's DOM at all (it's a different renderer), so hoveredKey stayed
  // stuck pointing at whatever was hovered before focus moved away, leaving every other edge
  // dimmed to 15% opacity indefinitely. Clearing on window blur covers that case and any other
  // way focus can leave this window without the cursor visibly moving off the hovered element.
  // Also snap the spine back to center when focus RETURNS to this window/tab — but only if it
  // was centered when focus left (per direct feedback: recenter "on tab return... but only do
  // when it was already centered before"). Layout/scroll can drift while the window is
  // backgrounded (font metrics, a zoom prop change from the main window, etc.); this keeps a
  // deliberately-centered view centered without disturbing one the user had scrolled off.
  const wasCenteredOnBlurRef = useRef(true)
  useEffect(() => {
    const onBlur = () => {
      setHoveredKey(null)
      wasCenteredOnBlurRef.current = nearCenterRef.current
    }
    const onFocus = () => {
      if (!wasCenteredOnBlurRef.current) return
      requestAnimationFrame(() => recenterHorizontal('auto'))
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus) }
  }, [])

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
      scrollNodeIntoView(nodeBlockRefs.current.get(nextId))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detail.nodes, keyboardFocusId])

  // ── Marquee drag-select ───────────────────────────────────────────────────
  // Drag a rectangle over the timeline (from empty space — starting on a node keeps that
  // node's own click) to select multiple chapter stops, then reassign them to another session
  // or delete them. Works the same in a single session's Map and in the merged Everything view.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeStartRef = useRef<{ x: number; y: number; moved: boolean; additive: boolean } | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [moveTargets, setMoveTargets] = useState<TrailSession[]>([])
  const [busySelection, setBusySelection] = useState(false)
  // Clear any selection when the session/timeline being viewed changes.
  useEffect(() => { setSelectedNodeIds(new Set()); setMarquee(null); setMoveMenuOpen(false) }, [detail.session.id])
  // Validate selection against the current node set (a node deleted elsewhere shouldn't linger).
  useEffect(() => {
    setSelectedNodeIds((prev) => {
      const valid = new Set([...prev].filter((id) => detail.nodes.some((n) => n.id === id)))
      return valid.size === prev.size ? prev : valid
    })
  }, [detail.nodes])

  // Base selection to union with while an additive (Shift/Cmd) drag is in progress.
  const marqueeBaseRef = useRef<Set<string>>(new Set())
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const autoScrollRafRef = useRef(0)

  function recomputeMarqueeSelection() {
    const s = marqueeStartRef.current
    if (!s) return
    const p = lastPointerRef.current
    const rect = {
      x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y),
      x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y),
    }
    setMarquee(rect)
    const hit = new Set<string>(s.additive ? marqueeBaseRef.current : [])
    for (const [id, el] of nodeBlockRefs.current) {
      const r = el.getBoundingClientRect()
      // "Anything it touches" — any overlap counts.
      if (r.left < rect.x1 && r.right > rect.x0 && r.top < rect.y1 && r.bottom > rect.y0) hit.add(id)
    }
    setSelectedNodeIds(hit)
  }

  function onMarqueeMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    // Only a real control (a button/link/field, a hover card, the filter input, a menu) blocks
    // a marquee start. Everything else on the timeline — the whitespace of a chapter row, the
    // gutter, the padding, the area below the last stop — begins a drag box. A plain click
    // (no drag) still runs a chapter's own navigation; the box only forms once you actually
    // move. This is looser than "gaps between rows only", which left almost nothing grabbable
    // on a dense spine ("i dont see a drag select thing").
    // `.no-drag` covers the note/reason popovers (TrailPopoverShell) — they portal to
    // document.body but stay React children of this container, so a React synthetic mousedown
    // inside one still bubbles here; without this, dragging a popover's header started a marquee
    // behind it ("selection box shows when i drag a popup around").
    if (t.closest('button, a, input, textarea, select, [role="menu"], [role="dialog"], .no-drag, [contenteditable="true"]')) return
    e.preventDefault() // don't start a native text selection (doesn't block a later click)
    marqueeStartRef.current = { x: e.clientX, y: e.clientY, moved: false, additive: e.shiftKey || e.metaKey }
    marqueeBaseRef.current = new Set(selectedNodeIds)
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
  }

  useEffect(() => {
    // Auto-scroll the timeline while the pointer is held near the top/bottom edge mid-drag, so
    // a selection can extend past what's currently on screen.
    function tickAutoScroll() {
      autoScrollRafRef.current = 0
      const s = marqueeStartRef.current
      const el = scrollContainerRef.current
      if (!s || !s.moved || !el) return
      const r = el.getBoundingClientRect()
      const EDGE = 48, SPEED = 14
      const y = lastPointerRef.current.y
      let dy = 0
      if (y < r.top + EDGE) dy = -SPEED * (1 - Math.max(0, y - r.top) / EDGE)
      else if (y > r.bottom - EDGE) dy = SPEED * (1 - Math.max(0, r.bottom - y) / EDGE)
      if (dy !== 0) {
        el.scrollTop += dy
        recomputeMarqueeSelection()
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll)
      }
    }
    function onMove(e: MouseEvent) {
      const s = marqueeStartRef.current
      if (!s) return
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      if (!s.moved && Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) < 4) return
      s.moved = true
      document.body.style.userSelect = 'none'
      recomputeMarqueeSelection()
      if (!autoScrollRafRef.current) autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll)
    }
    function onUp() {
      const s = marqueeStartRef.current
      marqueeStartRef.current = null
      setMarquee(null)
      document.body.style.userSelect = ''
      if (autoScrollRafRef.current) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = 0 }
      // A plain click on empty space (no drag) clears the current selection.
      if (s && !s.moved && !s.additive) { setSelectedNodeIds(new Set()); setMoveMenuOpen(false) }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shift/Cmd-click a chapter stop to add or remove just that one from the selection.
  function onTrailNodeClickCapture(e: React.MouseEvent, nodeId: string) {
    if (!(e.shiftKey || e.metaKey)) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId)
      return next
    })
  }

  async function deleteSelection() {
    if (busySelection || selectedNodeIds.size === 0) return
    setBusySelection(true)
    try {
      for (const id of selectedNodeIds) await window.studyTrail.deleteNode(id)
      setSelectedNodeIds(new Set())
      onChanged()
    } finally { setBusySelection(false) }
  }
  async function openMoveMenu() {
    const all = await window.studyTrail.listAllSessions().catch(() => [] as TrailSession[])
    // Offer every session except the one currently being viewed (moving into it is a no-op);
    // the loose bucket shows as "Loose stops".
    setMoveTargets(all.filter((s) => s.id !== detail.session.id))
    setMoveMenuOpen(true)
  }
  async function moveSelectionTo(targetSessionId: string) {
    if (busySelection || selectedNodeIds.size === 0) return
    setBusySelection(true)
    try {
      await window.studyTrail.moveNodes([...selectedNodeIds], targetSessionId)
      setSelectedNodeIds(new Set())
      setMoveMenuOpen(false)
      onChanged()
    } finally { setBusySelection(false) }
  }
  async function moveSelectionToNewSession() {
    const name = window.prompt('New session name:')?.trim()
    if (!name) return
    const s = await window.studyTrail.startSession(name).catch(() => null)
    if (s) await moveSelectionTo(s.id)
  }

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
  const nodeById = new Map<string, TrailNode>()
  for (const n of detail.nodes) nodeById.set(n.id, n)
  const nextNodeById = new Map<string, TrailNode | undefined>()
  detail.nodes.forEach((n, i) => nextNodeById.set(n.id, detail.nodes[i + 1]))
  // 1-based chronological position — lets a return row read "back to step 4" in plain text
  // instead of requiring the arrow to be traced (confused-reviewer persona). Declared here
  // (rather than just below, where it's also used for lane min/max idx) so the rowsForNode
  // build below can already resolve a return's target step while annotating isReturn.
  const nodeOrderIndex = new Map<string, number>()
  detail.nodes.forEach((n, i) => nodeOrderIndex.set(n.id, i))

  // ── Hour markers ─────────────────────────────────────────────────────────
  // The spine isn't linear time (gaps are log-scaled), so an hour marker can only ATTACH to a
  // chapter stop — the first stop that falls in each new clock hour. Surfaced as a live line
  // INSIDE the session-header pill (reported up via onCurrentHourChange): whichever hour marker
  // is currently at the top of the scroll view, advancing as you scroll. 12-hour clock; date
  // shown when the day rolls over — unless a date DIVIDER is already rendered above this node
  // (Everything view's own boundaryLabel), in which case it drops the date to avoid repeating.
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
  // Ordered [nodeId, label] for the hour markers — read by the scroll tracker below to pick the
  // one currently at the top of the view.
  const hourMarkers = detail.nodes.map((n) => n.id).filter((id) => hourLabelForNodeId.has(id)).map((id) => ({ id, label: hourLabelForNodeId.get(id)! }))
  const firstHour = hourMarkers[0]?.label ?? null

  // The node a connection actually LANDED on: among the nodes for its destination chapter, the
  // one whose anchor opened closest in time to the jump itself. Position-robust where a naive
  // `nextNodeById.get(fromNodeId)` isn't — a later revisit promotion can splice a same-chapter
  // node between the connection's fromNode and the real arrival, so "the node right after
  // fromNode in spine order" stops being the arrival. Used to recognise a user verse-tie branch
  // as the arrival path into its chapter even when that's happened.
  function arrivalNodeFor(c: TrailConnection): TrailNode | undefined {
    if (c.toKind !== 'chapter' || !c.toBookId || c.toChapter == null) return undefined
    let best: TrailNode | undefined
    let bestDelta = Infinity
    for (const nn of detail.nodes) {
      if (nn.trailSessionId !== c.trailSessionId || nn.bookId !== c.toBookId || nn.chapter !== c.toChapter) continue
      const d = Math.abs(nn.anchorStartedAt - c.createdAt)
      if (d < bestDelta) { bestDelta = d; best = nn }
    }
    return best
  }

  // Gates whether a recorded revisit (n.revisitOfNodeId) still COUNTS as one at render time —
  // per the plan's revisit time-window slider: `revisitOfNodeId` itself is never rewritten (the
  // recorder's own judgment call stands), but a chapter re-arrival past the user's current
  // slider setting renders as a plain independent bullet instead of the dashed-backlink/badge
  // treatment, live-adjustable without touching the database at all. undefined revisitWindowMs
  // (no controlling parent) means "no cutoff" — always honor whatever was recorded.
  function isRevisitWithinWindow(n: TrailNode): boolean {
    if (!n.revisitOfNodeId) return false
    if (revisitWindowMs == null) return true
    const original = nodeById.get(n.revisitOfNodeId)
    if (!original) return true
    const gapMs = n.anchorStartedAt - (original.anchorEndedAt ?? original.anchorStartedAt)
    return gapMs <= revisitWindowMs
  }

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
    scrollNodeIntoView(el)
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
        // Any branch path that lands on a real chapter node makes the plain straight spine
        // arrow into that node redundant — the branch itself already visibly joins the two
        // stops. Per direct feedback: "remove the main spine connector if there is branch
        // connectors that connect the two main spine bullets." Covers recorded cross-refs,
        // user verse-ties, AND chained lexicon/branch hops (isChainedBranch). `arrivalNodeFor`
        // is position-robust — survives a later revisit promotion splicing the spine between
        // fromNode and the real landing (the "from arrow points from something far in the past"
        // case). `fromNodeId` is always the chain's ROOT chapter node, so `fromIdx <=
        // arrivalIdx - 1` confirms the branch genuinely spans from an earlier stop.
        const isBranchish = renderAsBranch(annotated) || annotated.isChainedBranch
        const arrival = isBranchish ? arrivalNodeFor(c) : undefined
        if (arrival) {
          const arrivalIdx = nodeOrderIndex.get(arrival.id) ?? -1
          const fromIdx = nodeOrderIndex.get(c.fromNodeId) ?? -1
          if (arrivalIdx > 0 && fromIdx >= 0 && fromIdx <= arrivalIdx - 1) {
            nodesWithTracedArrival.add(arrival.id)
            // The dedicated 3-segment pass fully OWNS the rendering only for the node's own
            // origin connection (and never for a nested chained row) — there, emit no ConnRow.
            // Otherwise keep the ConnRow so the branch stays visible, just minus the duplicate
            // straight arrow.
            if (renderAsBranch(annotated) && !annotated.isChainedBranch && originConnByNodeId.get(arrival.id)?.id === c.id) continue
          }
        }
        const next = nextNodeById.get(c.fromNodeId)
        const isForward = next && next.trailSessionId === c.trailSessionId && next.bookId === c.toBookId && next.chapter === c.toChapter
        if (isForward) {
          // A cross-CHAPTER tangent whose destination is a brand-new node right away — fully
          // handled by the dedicated TangentBullet + edge-building pass below instead (the
          // node's own arrival gets the origin/destination bullet pair above it, connected by
          // its own dedicated lines) — no ConnRow for it at all, this connection's only other
          // job is already done via originConnByNodeId. Suppresses the generic spine arrow the
          // same way the old isForwardBranch path did.
          if (renderAsBranch(annotated)) {
            nodesWithTracedArrival.add(next!.id)
            continue
          }
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

  // The full edge language, rethought as one coherent set of rules (per direct feedback: "lets
  // rethink the style of the lines... i want it actually to make sense") instead of each edge
  // kind picking its own color/dash/arrow combination ad hoc:
  //   • COLOR encodes this edge's own depth change: accent = going deeper (main→tangent, or a
  //     tangent chaining off an earlier tangent), text-secondary = same depth (an ordinary
  //     main→main read, or a confidently-traced same-depth continuation), faint text-muted =
  //     shallower/reconverging (any return to a shallower depth, automatic or explicit).
  //   • DASH encodes confidence/weight, independent of color: a normal connection is solid, a
  //     low-confidence "glance" connection is dashed, thinner, and fainter. A reconverge/return
  //     is ALSO always dashed, but for a different reason (it's a jump backward in the reading
  //     order, not a forward step) — those two are the only edges allowed to be dashed.
  //   • ARROWHEADS are always shown — every edge here is an actual step in the reading order,
  //     so direction always matters. (The one deliberate exception is the revisit "same chapter
  //     as" identity backlink, which isn't a travel step at all — see its own comment below.)
  //   • CURVATURE is reserved for edges that visually reach across other content (a lane-routed
  //     return, or a short reconverge into the next node); a same-row/stacked-bullet hop stays
  //     a straight line.
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
    // Dashed instead of solid across a long gap — the same visual "break in time" cue as
    // GapDivider's own dashed rule (and threshold), reinforcing it right on the connecting
    // line itself, not just the label between the two nodes.
    const gapMs = effectiveGapMs(detail.nodes[i].anchorEndedAt ?? detail.nodes[i].anchorStartedAt, detail.nodes[i + 1].anchorStartedAt, detail.pausedIntervals)
    edges.push({
      // Muted, not accent — per the confirmed depth-change model, plain reading-onward (both
      // sides depth 0, no tangent involved) is a "same depth" hop, which stays the normal muted
      // color; only a stub INTO a tangent (going deeper — see pushRowEdges above) gets accent.
      key: `spine:${detail.nodes[i].id}`, from: `node:${detail.nodes[i].id}`, to: `node:${detail.nodes[i + 1].id}`,
      color: 'rgb(var(--color-text-secondary))', arrow: true, dashed: gapMs >= GAP_CHIP_THRESHOLD_MS,
    })
  }

  // The dedicated 3-segment path for a branch-node ARRIVAL (a cross-chapter tangent whose
  // destination is a brand-new node, suppressed out of rowsForNode/isForwardBranch above): the
  // node it left from → the origin-verse bullet → the destination-verse bullet → the arrival
  // node itself. Replaces the old single long "reconverge" line that skipped straight from the
  // departure chapter to the arrival chapter with no visible stop at either verse, per direct
  // feedback: "there needs to be connecting lines going this route: Isaiah 11 → Isaiah 11:2 →
  // Luke 4:18 → Luke 4. It should not have been just the single line of: Isaiah 11 → Luke 4."
  for (const n of detail.nodes) {
    const originConn = originConnByNodeId.get(n.id)
    if (!originConn || !renderAsBranch(originConn)) continue
    // A user verse-tie branch departs from wherever the reader actually WAS — the previous
    // main-spine stop, i.e. the node immediately before this one — not the (possibly long-ago,
    // revisit-displaced) node the underlying connection happens to be recorded against. Per
    // direct feedback: "the from arrow ... should be coming from the previous main spine instead
    // of something far in the past from a revisit." A recorded cross-ref branch keeps its own
    // true fromNode (its recorder already resolves the promoted/current node at capture time).
    const idx = nodeOrderIndex.get(n.id) ?? 0
    const prevSpine = idx > 0 && detail.nodes[idx - 1].trailSessionId === n.trailSessionId ? detail.nodes[idx - 1] : undefined
    const fromNode = (hasUserVerseTies(originConn) && prevSpine) ? prevSpine : nodeById.get(originConn.fromNodeId)
    if (!fromNode) continue
    // Solid accent, arrowed — "going one level deeper," the same treatment every other tangent
    // stub gets.
    edges.push({ key: `tangent-stub:${n.id}`, from: `node:${fromNode.id}`, to: `tangent-origin:${n.id}`, color: 'rgb(var(--color-accent))', curved: false, arrow: true, opacity: 0.75 })
    // Origin verse → destination verse — the actual cross-ref hop itself.
    edges.push({ key: `tangent-hop:${n.id}`, from: `tangent-origin:${n.id}`, to: `tangent-dest:${n.id}`, color: 'rgb(var(--color-accent))', arrow: true, curved: false, opacity: 0.75 })
    // Dashed/muted reconverge into the arrival node — "returning to the spine," same visual
    // language as every other depth-decrease edge in this diagram.
    // Straight, not curved — over the short vertical distance typical of this hop, the curved
    // bezier's fixed ±28 control-point offset can exceed the actual gap and overshoot, reading
    // as a squiggle/zigzag rather than a clean line. Per direct feedback ("looks odd because
    // its squiggly instead of being straight").
    edges.push({ key: `tangent-arrive:${n.id}`, from: `tangent-dest:${n.id}`, to: `node:${n.id}`, color: 'rgb(var(--color-text-muted))', curved: false, arrow: true, opacity: 0.5, dashed: true })
  }

  // Shared per-row edge logic — called for every row regardless of whether it's a top-level
  // row (stub from its chapter node) or a chained branch row (stub from its PARENT row's own
  // point instead, per the v31 branch-chaining work: "arrows connect from the true branch," not
  // a generic/frozen point). `stubFrom` is the point key this row's own short connector starts
  // at; isReturn/isForwardBranch edges are identical either way since they're keyed off the
  // row's own `row:${c.id}` point, which exists regardless of nesting depth.
  function pushRowEdges(c: AnnotatedConn, stubFrom: string) {
    // Accent-colored — per the confirmed depth-change model, a stub edge (parent node/row →
    // this tangent bullet) is always "going one level deeper," which gets its own distinct
    // accent color (as opposed to a plain same-depth spine hop, which stays muted — see the
    // main spine edge below).
    const color = c.weight === 'glance' ? (TIER_COLOR[c.clarityTier] ?? 'rgb(var(--color-text-muted))') : 'rgb(var(--color-accent))'
    edges.push({ key: `stub:${c.id}`, from: stubFrom, to: `row:${c.id}`, color, dashed: c.weight === 'glance', curved: false, arrow: true, opacity: c.weight === 'glance' ? 0.5 : 0.75 })
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
          color: 'rgb(var(--color-text-muted))', arrow: true, dashed: true, opacity: 0.45, strokeWidth: 1.25,
          minIdx: Math.min(fromIdx, toIdx), maxIdx: Math.max(fromIdx, toIdx),
        })
      }
    }
    if (c.isForwardBranch) {
      // isForwardBranch now only ever fires for a NON-branch connection (any c.isBranch=true
      // connection whose destination is a fresh next node is fully diverted to the dedicated
      // tangent-stub/tangent-hop/tangent-arrive pass above instead — see that pass's own
      // comment) — so this is always a confidently-traced, SAME-DEPTH continuation (a plain
      // read, just one whose specific origin is worth tracing rather than the generic spine
      // arrow). Same-depth styling to match: solid text-secondary, not the dashed/muted
      // "reconverging" look this used to (incorrectly) always carry. Short (always the very
      // next node), so a direct curved line is fine, no lane needed.
      const target = nextNodeById.get(c.fromNodeId)
      if (target) edges.push({ key: `origin:${c.id}`, from: `row:${c.id}`, to: `node:${target.id}`, color: 'rgb(var(--color-text-secondary))', curved: true, arrow: true, opacity: 0.6 })
    }
  }

  for (const n of detail.nodes) {
    const items = groupForRender(rowsForNode.get(n.id) ?? [])
    for (const it of items) {
      if (it.type === 'single') {
        pushRowEdges(it.item, `node:${n.id}`)
      } else {
        const color = TIER_COLOR[it.items[0].clarityTier] ?? 'rgb(var(--color-text-muted))'
        edges.push({ key: `stub:${it.key}`, from: `node:${n.id}`, to: it.key, color, dashed: true, curved: false, arrow: true, opacity: 0.4 })
      }
    }
    // The quiet "same chapter as" backlink for a promoted revisit — deliberately muted/thin/
    // dashed (structural chrome, not a clarity-tier signal, hence gray not TIER_COLOR) and
    // never arrowed, since it signals identity ("this is the same chapter"), not a direction
    // of travel the way the primary forward spine edge into this node already does.
    if (n.revisitOfNodeId && detail.nodes.some((on) => on.id === n.revisitOfNodeId) && isRevisitWithinWindow(n)) {
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
  // TrailConnectorOverlay's own laned-edge curve can bow out considerably further left than
  // this lane-count-only formula reserves (its extraBow grows with how much vertical distance
  // a given return has to clear, which isn't known here) — per direct feedback ("the entire
  // timeline should be shifted right so that the entire revisit arrow thing can be seen"), a
  // curve bowing further than the reserved column was getting clipped by the scroll
  // container's own left edge (you can't scroll to negative x). A generous flat allowance
  // covers the common case without needing this file and the overlay's bow math to stay in
  // exact sync — a little extra unused margin costs nothing.
  // Trimmed back slightly from 220 — per direct feedback ("i think the entire timeline can be
  // moved to the left slightly"), that first pass over-reserved; this still comfortably covers
  // the overlay's own bow formula (see TrailConnectorOverlay's extraBow) for the vertical runs
  // actually seen in practice.
  // BUG FOUND ("the more times I revisit, the further left the main spine moves"): this
  // reservation was still using the OLD unbounded LINEAR bow formula (105 + vertRun·0.45) long
  // after TrailConnectorOverlay's own extraBow was reworked to a CAPPED, sub-linear one
  // (min(cap, base + scale·√(vertRun−60)) — see its REVISIT_BOW_* / RETURN_BOW_* constants,
  // caps 85 / 180). A revisit spanning many nodes therefore reserved 800–1000+px of gutter for
  // a curve the overlay now hard-caps at ≤180px — and since the whole content column is shifted
  // right by gutterWidth while a collapsed "bounced Nx" revisit cluster is not (NodeClusterGroup
  // used to force gutterWidth:0 — also fixed), the spine drifted that far right of the revisit
  // rows, growing every time another (later, longer-spanning) revisit bumped the estimate.
  // Fix: mirror the overlay's ACTUAL current formula, per laned edge, and take the max — so the
  // reservation tracks the real (bounded) curve instead of a removed one. Keep the three
  // base/scale/cap pairs in sync with TrailConnectorOverlay if either side is retuned.
  const ROW_HEIGHT_ESTIMATE = 90
  const overlayBowFor = (spanItems: number, arrow: boolean) => {
    const vertRun = spanItems * ROW_HEIGHT_ESTIMATE
    // Mirror of TrailConnectorOverlay's REVISIT_BOW_* / RETURN_BOW_* — keep in sync.
    const base = arrow ? 66 : 26
    const scale = arrow ? 8 : 4.5
    const cap = arrow ? 180 : 100
    return Math.min(cap, base + scale * Math.sqrt(Math.max(0, vertRun - 60)))
  }
  const maxExtraBow = lanedRaw.reduce((m, e) => Math.max(m, overlayBowFor(e.maxIdx - e.minIdx, !!e.arrow)), 0)
  // + safety margin: covers the estimate-vs-measured row-height slack and the little the bezier
  // belly sits left of laneX. Over-reserving a bit costs nothing (unused blank gutter); under-
  // reserving clips the arc against the scroll container's un-scrollable left edge.
  // Reserve exactly the deepest arc's own (bounded) bow — no arbitrary cap. An earlier round
  // clamped this to 40px to pull the trail left, but that squashed every arc onto the laneX>=24
  // floor so they all bowed the SAME amount and merged; per direct feedback ("make the revisit
  // arcs more varied ... easier to follow") they need real room to spread. `maxExtraBow`
  // mirrors the overlay's actual capped sqrt formula, so this tracks the real curve, not the
  // old removed unbounded one. (Still far under the ~220px the very first pass over-reserved.)
  const EXTRA_BOW_RESERVE = maxLane >= 0 ? maxExtraBow + 20 : 0
  const gutterWidth = maxLane >= 0 ? GUTTER_BASE + maxLane * LANE_SPACING + EXTRA_BOW_RESERVE : 0

  // Deepest indent level actually RENDERED anywhere in this view — drives how many faint
  // indent-level guide lines get drawn (see the "staff lines" comment near the JSX below). Every
  // ConnRow that survives into rowsForNode / rowsForConnection renders at its own
  // `INDENT_STEP*(chainDepth+1)`, and a branch node's tangent bullets sit at that same depth. So
  // walk exactly those buckets (plus the branch nodes) rather than filtering raw connections —
  // the earlier `c.isBranch`-only filter missed non-branch rows that still indent (lexicon
  // lookups, cross-refs, returns). -1 means "nothing off-spine" → only the spine line is drawn.
  let maxRenderDepth = -1
  for (const bucket of rowsForNode.values())
    for (const c of bucket) maxRenderDepth = Math.max(maxRenderDepth, c.chainDepth)
  for (const bucket of rowsForConnection.values())
    for (const c of bucket) maxRenderDepth = Math.max(maxRenderDepth, c.chainDepth)
  for (const n of detail.nodes) {
    const oc = originConnByNodeId.get(n.id)
    if (oc && renderAsBranch(oc)) maxRenderDepth = Math.max(maxRenderDepth, oc.chainDepth ?? 0)
  }

  // Hover-to-trace — per direct feedback ("really pronounce the arrows that led to that point
  // and dim everything else out"), this walks the FULL causal chain backward from whatever's
  // hovered (not just the edges directly touching it): starting at the hovered point, repeatedly
  // follow "whichever edge(s) end here" back to their own `from` point, and keep going from
  // there, until the walk runs out of predecessors (the session's very first node). Every edge
  // and every point visited along the way gets pronounced (full opacity, thicker stroke);
  // everything else — other lines, AND (via hoverChainPointKeys passed down to
  // NodeBlock/ConnRow/TangentBullet below) their labels and bullets — dims out.
  // A return/revisit-link edge points chronologically BACKWARD (its `to` is an EARLIER node
  // than its `from`) — the opposite of every other edge here. Feeding it into the generic
  // backward-walk below (which treats "whatever an edge's `from` is" as an ancestor of whatever
  // it points `to`) has it exactly backwards: hovering the REVISITED node discovers this edge
  // (since the edge's `to` IS that node) and then incorrectly treats the LATER row that pointed
  // back to it as an "ancestor," continuing the walk from there into thingsafter the hover
  // point — per direct feedback ("i highlight on a revisited item and it also is highlighting
  // too much" / "it should dim everything past it including the revisit stuff"). Excluded from
  // the general walk entirely; handled as its own direct, single-hop case below instead (hovering
  // one of its two endpoints pronounces just that one arc, never chased further).
  const isBackwardEdge = (key: string) => key.startsWith('return:') || key.startsWith('revisit-link:')
  const edgesByTo = new Map<string, TrailEdge[]>()
  for (const e of edges) {
    if (isBackwardEdge(e.key)) continue
    const bucket = edgesByTo.get(e.to) ?? []
    bucket.push(e)
    edgesByTo.set(e.to, bucket)
  }
  const hoverChainEdgeKeys = new Set<string>()
  const hoverChainPointKeys = new Set<string>()
  if (hoveredKey) {
    hoverChainPointKeys.add(hoveredKey)
    // Direct, single-hop only: a return/revisit-link edge pronounces when the hovered point is
    // literally one of its own two ends, without chasing anything further through it.
    for (const e of edges) {
      if (!isBackwardEdge(e.key)) continue
      if (e.from === hoveredKey || e.to === hoveredKey) hoverChainEdgeKeys.add(e.key)
    }
    const stack = [hoveredKey]
    // A tangent's origin/destination bullets (tangent-origin:ID / tangent-dest:ID) are the two
    // ends of the same hop, chronologically origin-then-dest — origin is dest's CAUSAL ANCESTOR,
    // dest is origin's DESCENDANT (something that happens AFTER it). Per direct feedback ("make
    // sure to dim the tangent parts that are after the one that is getting hovered"): hovering
    // dest should pronounce origin (an ancestor — the ordinary backward walk below already finds
    // it via the tangent-hop edge, `tangent-origin → tangent-dest`, same as any other edge, no
    // special-casing needed), but hovering ORIGIN must NOT pull dest in — dest is forward of it,
    // and should dim like anything else after the hover point. An earlier round deliberately made
    // this symmetric (see git blame) per different feedback at the time; this reverses that half
    // of it back per the current, more specific ask.
    while (stack.length) {
      const cur = stack.pop()!
      for (const e of edgesByTo.get(cur) ?? []) {
        if (hoverChainEdgeKeys.has(e.key)) continue
        hoverChainEdgeKeys.add(e.key)
        if (!hoverChainPointKeys.has(e.from)) {
          hoverChainPointKeys.add(e.from)
          stack.push(e.from)
        }
      }
    }
  }
  // Safety net for "when i rightclick one of the items, all the connection lines are not
  // visible" — if hoveredKey is somehow stuck pointing at a key that doesn't actually touch
  // anything in THIS render's edge graph (stale from a prior render, a point that no longer
  // exists, a timing edge case around a right-click), dimming everything to 12% opacity reads
  // as "all the lines disappeared." Treat that specific case as if nothing were hovered at all
  // — every edge stays at normal opacity — rather than let one orphaned key blank out the whole
  // diagram.
  const hoveredKeyIsLive = !!hoveredKey && edges.some((e) => e.from === hoveredKey || e.to === hoveredKey)
  // REFACTORED per direct feedback ("the right click is still hiding the connection lines")
  // after the previous fix (suppressing new hover claims at the SETTER while a menu is open)
  // still wasn't enough — rather than keep chasing exactly which event re-sets hoveredKey while
  // a menu is up, gate the OUTPUT directly: whenever any context menu is open, dimming is off,
  // full stop, regardless of what hoveredKey happens to hold. This can't be defeated by a stray
  // re-fired mouseenter, a stale key, or any other path into hoveredKey — the single place that
  // actually paints the dim effect refuses to do it at all while `menu` is truthy.
  const hoverActive = hoveredKeyIsLive && !menu
  if (window.__bereanTrailDebug && hoveredKey) {
    // Confirms (or rules out) the exact "lines disappear on right-click" mechanism this safety
    // net guards against — if hoveredKeyIsLive is ever false here right after a right-click,
    // that's the bug caught in the act; if it stays true throughout, the disappearing-lines
    // report has a different cause and this rules the orphaned-key theory out.
    console.log('[TrailDebug] hover chain', {
      hoveredKey, live: hoveredKeyIsLive,
      chainPoints: [...hoverChainPointKeys], chainEdges: [...hoverChainEdgeKeys],
    })
  }
  const finalEdges = hoverActive
    ? edges.map((e) => hoverChainEdgeKeys.has(e.key)
        ? { ...e, opacity: 1, strokeWidth: (e.strokeWidth ?? (e.thick ? 3 : 1.75)) * 1.35 }
        : { ...e, opacity: (e.opacity ?? 1) * 0.12 })
    : edges
  // Per direct feedback ("the connecting lines are going invisible when i rightclick the
  // items... put a log for what happens") — unlike the hover-chain log above (gated on
  // hoveredKey being truthy, so it goes silent the instant openMenu clears it), this fires on
  // every render regardless, so the render right after a right-click — where lines are reported
  // vanishing — actually shows up: whether hoveredKey truly went back to null (openMenu's own
  // fix working), whether `menu` is open, and how many edges ended up dimmed either way. If
  // dimmedCount is ever > 0 while hoveredKey is null here, the dimming isn't coming from this
  // hover mechanism at all and the bug is somewhere else entirely.
  if (window.__bereanTrailDebug) {
    const dimmedCount = finalEdges.filter((e) => (e.opacity ?? 1) < 0.5).length
    // Deduped the same way as TrailConnectorOverlay's missing-endpoint warning — only logs when
    // this specific combination actually changes, not on every render, so it stays readable.
    const logKey = `${hoveredKey}:${hoveredKeyIsLive}:${!!menu}:${dimmedCount}`
    if (lastVisibilityLogRef.current !== logKey) {
      lastVisibilityLogRef.current = logKey
      console.log('[TrailDebug] right-click/edge-visibility check', {
        hoveredKey, hoveredKeyIsLive, menuOpen: !!menu, totalEdges: finalEdges.length, dimmedCount,
      })
    }
  }

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
    if (first) scrollNodeIntoView(nodeBlockRefs.current.get(first.id))
  }
  const jumpToFirstMatchRef = useRef(jumpToFirstMatch)
  jumpToFirstMatchRef.current = jumpToFirstMatch
  // Enter in the parent-hosted filter input asks us to scroll to the first match.
  useEffect(() => {
    const h = () => jumpToFirstMatchRef.current()
    window.addEventListener('berean:trailFilterSubmit', h)
    return () => window.removeEventListener('berean:trailFilterSubmit', h)
  }, [])

  // Symmetric padding that centers the whole content block in the viewport (see the "Horizontal
  // placement model" comment above). `containerRef` wraps every NodeBlock; its own width is the
  // content's true width and is independent of this padding (padding sits on containerRef's
  // PARENT), so measuring it to compute `pad` never feeds back. When the content is wider than
  // the viewport, `pad` is 0 and the browser clamps scrollLeft to the two content edges — no
  // overscroll either side, no clamp hack needed.
  // The `- H_SAFETY/zoom` keeps the laid-out content a few CSS px narrower than the viewport so
  // sub-pixel rounding of the widest row (or the full-width GapDivider line) can never spill
  // past the edge and spawn a spurious horizontal scrollbar — the one Michael kept seeing on
  // the dense Everything timeline.
  const H_SAFETY = 10
  const pad = viewportWidth > 0 && contentWidth > 0
    ? Math.max(0, (viewportWidth / zoom - contentWidth - H_SAFETY / zoom) / 2)
    : 0
  // Cap how wide any single row's content may get so `gutterWidth + row` can't itself exceed
  // the viewport (a big arc gutter + a 460px note preview did, on Everything). Applied via a CSS
  // var so it reaches every NodeBlock/ConnRow without prop-drilling. Never below 200 (rows stay
  // usable even in a very narrow window / very deep gutter).
  const rowMaxWidth = Math.round(Math.min(460, Math.max(200, (viewportWidth || 700) / zoom - gutterWidth - 40)))
  // Pull the content as far left as it will go — consume the ENTIRE centring slack so the trail
  // hugs the left edge instead of sitting centred with dead space on its left. Per direct
  // feedback ("move it as far left as possible").
  const centreNudge = pad

  // Live per-side clear space around the trail's SOLID content, reported up so the parent can
  // place its floating header / zoom controls on whichever side won't cover the spine/branches
  // (default left). `left` = viewport-left → spine-dot column (faint arcs in the gutter don't
  // count as "in the way"); `right` = widest rendered row's right edge → viewport-right.
  const [layoutRoom, setLayoutRoom] = useState<{ left: number; right: number }>({ left: 9999, right: 9999 })
  useEffect(() => {
    const v = scrollContainerRef.current, c = containerRef.current
    if (!v || !c) return
    let raf = 0
    const measure = () => {
      raf = 0
      const vr = v.getBoundingClientRect()
      // Bound the ACTUAL node rows currently on screen — not containerRef, whose width is padded
      // out to the viewport by the full-width GapDivider chrome (which isn't "spine/branches").
      // blockRef sits just RIGHT of the gutter spacer, so its left edge is already the spine
      // column (no gutterWidth to add); its right edge covers the node + all its branch rows.
      let minLeft = Infinity, maxRight = 0
      for (const el of nodeBlockRefs.current.values()) {
        const r = el.getBoundingClientRect()
        if (r.bottom < vr.top || r.top > vr.bottom) continue
        minLeft = Math.min(minLeft, r.left - vr.left)
        maxRight = Math.max(maxRight, r.right - vr.left)
      }
      const spineLeft = minLeft === Infinity ? gutterWidth * zoom : minLeft
      const contentRight = maxRight || vr.width
      setLayoutRoom((prev) => {
        const next = { left: Math.max(0, Math.round(spineLeft)), right: Math.max(0, Math.round(vr.width - contentRight)) }
        return next.left === prev.left && next.right === prev.right ? prev : next
      })
    }
    const sched = () => { if (!raf) raf = requestAnimationFrame(measure) }
    sched()
    v.addEventListener('scroll', sched, { passive: true })
    const ro = new ResizeObserver(sched)
    ro.observe(v); ro.observe(c)
    window.addEventListener('resize', sched)
    return () => {
      v.removeEventListener('scroll', sched)
      ro.disconnect()
      window.removeEventListener('resize', sched)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [gutterWidth, zoom, detail.nodes.length, contentWidth, viewportWidth])
  useEffect(() => { onLayoutRoomChange?.(layoutRoom) }, [layoutRoom]) // eslint-disable-line react-hooks/exhaustive-deps
  // Decided with the ZOOM pill's width (the wider of the two) so Recenter/Latest and the zoom
  // pill always end up on the same side and can stack cleanly.
  const latestSide = pickControlSide(layoutRoom, CTRL_W.zoom)

  // ── Current-hour tracker (fed into the parent's header pill) ──────────────
  // `firstHour` is the synchronous fallback so the pill's hour line shows immediately; the
  // effect then refines it to whichever marker is at the top of the view, live on scroll.
  const hourMarkersRef = useRef(hourMarkers)
  hourMarkersRef.current = hourMarkers
  const hourRafRef = useRef(0)
  useEffect(() => {
    onCurrentHourChange?.(firstHour)
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const measure = () => {
      hourRafRef.current = 0
      const markers = hourMarkersRef.current
      if (markers.length === 0) { onCurrentHourChange?.(null); return }
      const sTop = scroller.getBoundingClientRect().top + topInset
      let active = markers[0].label
      for (const m of markers) {
        const el = nodeBlockRefs.current.get(m.id)
        if (!el) continue
        if (el.getBoundingClientRect().top - sTop <= 12) active = m.label
        else break
      }
      onCurrentHourChange?.(active)
    }
    const schedule = () => { if (!hourRafRef.current) hourRafRef.current = requestAnimationFrame(measure) }
    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      ro.disconnect()
      if (hourRafRef.current) cancelAnimationFrame(hourRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstHour, detail.nodes.length, zoom, topInset])

  // Single shared "suppress hover UI" condition — per direct feedback ("right-click should hide
  // ALL hover UI... find wherever menuOpen/hoveredKey state already exists and add a single
  // shared condition that all the relevant hover-driven components check, rather than
  // duplicating the logic in each one"). HoverDisabledContext already existed for the "why'd you
  // jump here" edit popup (promptConn); ORing in `!!menu` here means every TrailHoverCard in the
  // spine (which all read this same context as their `disabled` prop) now also hides the instant
  // the right-click context menu opens, with zero changes needed in any of the individual
  // NodeBlock/ConnRow/TangentBullet/GlanceGroupRow call sites.
  return (
    <HoverDisabledContext.Provider value={!!promptConn || !!menu}>
    {/* flex column + minHeight:0 down this whole chain (through the scroll container below) is
        what actually makes ITS OWN `overflow: auto` the one that scrolls — without a real
        bounded height, the browser just grows this div to fit its content and an ANCESTOR ends
        up scrolling instead (see StudyTrailApp.tsx's "Main pane", which previously had its own
        overflow:auto too), so this component's onScroll/checkAtBottom (and the "Latest" button
        it drives) never fired in practice. */}
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* When the parent hosts the filter (next to the session title), MapView renders no
          input of its own — it just consumes filterValue + listens for the submit event. */}
      {!controlledFilter && (
        <div style={{ marginBottom: 8, flexShrink: 0 }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') jumpToFirstMatch() }}
            placeholder="Filter timeline…"
            style={{
              width: '100%', maxWidth: 260, fontSize: 12, padding: '5px 9px', background: 'rgb(var(--color-surface-2))',
              border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, color: 'rgb(var(--color-text-primary))',
            }}
          />
        </div>
      )}
      <div ref={scrollContainerRef} onWheel={onWheelZoom} onMouseDown={onMarqueeMouseDown} onScroll={() => { checkAtBottom(); checkCentered() }} style={{ overflow: 'auto', position: 'relative', flex: 1, minHeight: 0, paddingTop: topInset }}>
        {/* Symmetric `pad` (local units, inside the transform so it scales with zoom) centers the
            whole content block — gutter + spine + indents + labels — in the viewport. It
            collapses to 0 once the content is wider than the viewport, so the native scroll
            range then spans exactly the two content edges (nothing to overscroll into, no clamp
            hack). Replaces the old asymmetric left/right centering padding that repeatedly let
            the timeline scroll past its own leftmost content. */}
        <div style={{
          transform: `scale(${zoom})`, transformOrigin: 'top left', width: 'max-content',
          paddingLeft: pad - centreNudge, paddingRight: pad + centreNudge,
        }}>
          <div ref={containerRef} style={{ position: 'relative', ['--trail-row-max' as string]: `${rowMaxWidth}px` } as React.CSSProperties}>
            {/* Faint indent-level guide lines — per direct feedback ("really faint lines like
                on a musical paper that show the indent levels so the user can follow which
                level things are at", plus "there needs to be one for the main spine, for the
                tangent and for all the tangent columns"). One line under the chapter-dot spine
                column (at SPINE_DOT_INSET, the 9px dot's own centre in its 12px column — slightly
                darker so the main line reads as the anchor), plus one under EVERY indent level
                actually rendered (maxRenderDepth, which now counts non-branch rows too), each at
                that depth's own `SPINE_LABEL_COL_INSET + INDENT_STEP*(depth+1) + OFFSPINE_DOT_INSET`
                — the exact centre of that column's bullets, which hang inside the spine row's
                label column (see SPINE_LABEL_COL_INSET). All of this lives inside the same `scale(zoom)` wrapper
                as the bullets, so gutterWidth is used un-multiplied and alignment holds at every
                zoom. Purely decorative: behind everything, never intercepts a click. */}
            {detail.nodes.length > 0 && (
              <div
                key="guide:spine"
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: gutterWidth + SPINE_DOT_INSET,
                  width: 1, background: 'rgb(var(--color-surface-4) / 0.3)', pointerEvents: 'none', zIndex: 0,
                }}
              />
            )}
            {maxRenderDepth >= 0 && Array.from({ length: maxRenderDepth + 1 }, (_, depth) => (
              <div
                key={`guide:${depth}`}
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: gutterWidth + SPINE_LABEL_COL_INSET + INDENT_STEP * (depth + 1) + OFFSPINE_DOT_INSET,
                  width: 1, background: 'rgb(var(--color-surface-4) / 0.15)', pointerEvents: 'none', zIndex: 0,
                }}
              />
            ))}
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
                onHoverKey={handleHoverKey}
                connectionsByNodeId={rowsForNode}
                nodeOrderIndex={nodeOrderIndex}
                onOpenPrompt={setPromptConn}
                refFor={refFor}
                openMenu={openMenu}
                originConnByNodeId={originConnByNodeId}
                jumpToOrigin={jumpToOrigin}
                rowsForConnection={rowsForConnection}
                hoverChain={hoverActive ? hoverChainPointKeys : null}
                gutterWidth={gutterWidth}
              />
            )
          }
          const { node: n, index: i } = item
          const next = detail.nodes[i + 1]
          const originConn = originConnByNodeId.get(n.id)
          const isBranchNode = !!originConn && renderAsBranch(originConn)
          const nextOriginConn = next ? originConnByNodeId.get(next.id) : undefined
          const nextIsBranchNode = !!nextOriginConn && renderAsBranch(nextOriginConn)
          const rawGapToNextMs = next ? effectiveGapMs(n.anchorEndedAt ?? n.anchorStartedAt, next.anchorStartedAt, detail.pausedIntervals) : null
          // Only the UPCOMING node being a tangent arrival forces tight spacing — that's the
          // node→bullet stack right before it, already fully handled by the dedicated
          // TangentBullet/3-segment-edge mechanism, not by this GapConnector at all. Whether
          // THIS node (`n`) itself was reached via a tangent is irrelevant to its own outgoing
          // gap: once a tangent has reconverged and landed on n, leaving n for a plain next
          // read is an ordinary main-spine hop and deserves the full main-spine gap. Per direct
          // feedback ("the gap from Luke 4 to Isaiah 1 needs a lot larger gap because that is
          // the main spine") — the old `isBranchNode ||` here was incorrectly keeping that
          // outgoing gap tight just because n itself had arrived via a branch.
          const gapToNextMs = nextIsBranchNode ? null : rawGapToNextMs
          const showGapDivider = gapToNextMs != null && gapToNextMs >= GAP_CHIP_THRESHOLD_MS
          // For a user verse-tie branch, "departed from" is the previous main-spine node (matches
          // the tangent-stub edge's own origin, fixed above) — not the connection's possibly
          // long-ago / revisit-displaced recorded fromNode.
          const originNode = originConn
            ? ((hasUserVerseTies(originConn) && i > 0 && detail.nodes[i - 1].trailSessionId === n.trailSessionId)
                ? detail.nodes[i - 1]
                : nodeById.get(originConn.fromNodeId))
            : undefined
          // The specific verse this branch departed FROM, for the origin tangent bullet's label,
          // click-to-navigate ref and hover preview. Priority: the structured originVersePinFrom
          // pin, then a hand-entered "From" verse tie, then — when ties exist only on the "To"
          // side — the departed chapter with no verse (so the stub still has both endpoints).
          let originVerseRef: TrailRef | null = null
          let originVerseLabel: string | undefined
          if (originConn) {
            const fromTieRef = tieToRef(originConn.tiesFrom[0])
            if (originConn.originVersePinFrom != null && originNode) {
              originVerseRef = { kind: 'chapter', bookId: originNode.bookId, chapter: originNode.chapter, verse: originConn.originVersePinFrom }
              originVerseLabel = bookChapterVerseLabel(originNode.bookId, originNode.chapter, originConn.originVersePinFrom)
            } else if (fromTieRef || originConn.tiesFrom[0]) {
              originVerseRef = fromTieRef
              originVerseLabel = tieLabel(fromTieRef, originConn.tiesFrom[0])
            } else if (originNode) {
              originVerseRef = { kind: 'chapter', bookId: originNode.bookId, chapter: originNode.chapter }
              originVerseLabel = bookChapterVerseLabel(originNode.bookId, originNode.chapter)
            }
          }
          // The destination tangent bullet: a hand-entered "To" verse tie wins, otherwise the
          // arrival chapter + the connection's own landed-on verse range (what NodeBlock used to
          // build inline).
          const toTieRef = originConn ? tieToRef(originConn.tiesTo[0]) : null
          const destVerseRef: TrailRef | null = toTieRef ?? (originConn ? refFor(originConn) : null)
          const destVerseLabel = toTieRef
            ? tieLabel(toTieRef, originConn!.tiesTo[0])
            : `${bookChapterVerseLabel(n.bookId, n.chapter)}${originConn?.toVerse != null ? `:${originConn.toVerse}${originConn.toVerseEnd && originConn.toVerseEnd !== originConn.toVerse ? `–${originConn.toVerseEnd}` : ''}` : ''}`
          return (
            <div key={n.id} data-trailnode={n.id} onClickCapture={(e) => onTrailNodeClickCapture(e, n.id)}>
            <NodeBlock
              node={n}
              selected={selectedNodeIds.has(n.id)}
              connections={rowsForNode.get(n.id) ?? []}
              gapToNextMs={gapToNextMs}
              isLast={i === detail.nodes.length - 1}
              onOpenPrompt={setPromptConn}
              refFor={refFor}
              openMenu={openMenu}
              originConn={originConn}
              registerPoint={registerPoint}
              boundaryLabel={boundaryLabelForNodeId?.get(n.id)}
              onJumpToOrigin={originConnByNodeId.has(n.id) ? () => jumpToOrigin(originConnByNodeId.get(n.id)!) : undefined}
              onDeleteNode={(nodeId) => window.studyTrail.deleteNode(nodeId).then(onChanged)}
              onToggleTopicBreak={(nodeId, current) => window.studyTrail.setNodeTopicBreak(nodeId, !current).then(onChanged)}
              step={i + 1}
              onHoverKey={handleHoverKey}
              keyboardFocused={keyboardFocusId === n.id}
              dimmed={!!q && !matchedNodeIds.has(n.id)}
              searchMatched={!!q && matchedNodeIds.has(n.id)}
              blockRef={(el) => { if (el) nodeBlockRefs.current.set(n.id, el); else nodeBlockRefs.current.delete(n.id) }}
              gutterWidth={gutterWidth}
              rowsForConnection={rowsForConnection}
              isBranchNode={isBranchNode}
              branchDepth={originConn?.chainDepth}
              originVerseLabel={originVerseLabel}
              originVerseRef={originVerseRef}
              destVerseLabel={destVerseLabel}
              destVerseRef={destVerseRef}
              hoverChain={hoverActive ? hoverChainPointKeys : null}
              revisitAllowed={isRevisitWithinWindow(n)}
            />
            {/* Stay a touch inside the H_SAFETY-narrowed content box so the full-width dashed
                line never spills past the edge and spawns a horizontal scrollbar. */}
            {showGapDivider && <GapDivider gapMs={gapToNextMs!} minWidth={Math.max(0, viewportWidth - 16) / zoom} gutterWidth={gutterWidth} />}
            </div>
          )
        })}
        {detail.nodes.length === 0 && (
          <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>Nothing recorded yet — navigate around the app while this session is live.</div>
        )}

        {promptConn && (
          <ReasonPromptPopover
            connection={promptConn}
            originBookId={nodeById.get(promptConn.fromNodeId)?.bookId}
            originChapter={nodeById.get(promptConn.fromNodeId)?.chapter}
            onClose={() => setPromptConn(null)}
            onSaved={() => { setPromptConn(null); onChanged() }}
          />
        )}
        <TrailRefContextMenu menu={menu} menuRef={menuRef} onClose={closeMenu} />
            </div>
          </div>
        </div>

        {/* Marquee rectangle while dragging */}
        {marquee && (
          <div style={{
            position: 'fixed', left: marquee.x0, top: marquee.y0,
            width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0,
            border: '1.5px solid rgb(var(--color-accent))', background: 'rgb(var(--color-accent) / 0.15)',
            borderRadius: 3, zIndex: 80, pointerEvents: 'none',
          }} />
        )}

        {/* Selection action bar */}
        {selectedNodeIds.size > 0 && (
          <div style={{
            position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
            background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
            borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.35)', fontSize: 12,
          }}>
            <span style={{ color: 'rgb(var(--color-text-secondary))', fontWeight: 600 }}>
              {selectedNodeIds.size} selected
            </span>
            <div style={{ position: 'relative' }}>
              <button
                className="trail-ctx-btn"
                disabled={busySelection}
                onClick={() => (moveMenuOpen ? setMoveMenuOpen(false) : openMoveMenu())}
                style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '4px 9px', color: 'rgb(var(--color-text-primary))', cursor: 'pointer' }}
              >Move to session ▾</button>
              {moveMenuOpen && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, minWidth: 180, maxHeight: 260, overflowY: 'auto',
                  background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
                  borderRadius: 9, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', padding: 5,
                }}>
                  {moveTargets.length === 0 && (
                    <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', padding: '6px 8px' }}>No other sessions</div>
                  )}
                  {moveTargets.map((s) => (
                    <button
                      key={s.id}
                      className="trail-ctx-btn"
                      disabled={busySelection}
                      onClick={() => moveSelectionTo(s.id)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 6, padding: '5px 8px', color: 'rgb(var(--color-text-primary))', cursor: 'pointer', fontSize: 12 }}
                    >{s.id === LOOSE_SESSION_ID ? 'Loose stops' : s.name}</button>
                  ))}
                  <div style={{ height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' }} />
                  <button
                    className="trail-ctx-btn"
                    disabled={busySelection}
                    onClick={moveSelectionToNewSession}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 6, padding: '5px 8px', color: 'rgb(var(--color-accent))', cursor: 'pointer', fontSize: 12 }}
                  >+ New session…</button>
                </div>
              )}
            </div>
            <button
              className="trail-ctx-btn"
              disabled={busySelection}
              onClick={deleteSelection}
              style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '4px 9px', color: '#e08468', cursor: 'pointer' }}
            >Delete</button>
            <button
              className="trail-ctx-btn"
              onClick={() => { setSelectedNodeIds(new Set()); setMoveMenuOpen(false) }}
              style={{ background: 'transparent', border: 'none', borderRadius: 7, padding: '4px 6px', color: 'rgb(var(--color-text-muted))', cursor: 'pointer' }}
            >Clear</button>
          </div>
        )}
      </div>

      {/* Recenter + Latest — window-fixed, stacked just above StudyTrailApp's own zoom pill in
          the SAME bottom corner. Default left; flips right when the trail's spine/branches would
          sit under it (latestSide, from the measured layoutRoom — decided with the zoom pill's
          own width so the two always land on the same side). On the left, `left: 240` clears the
          220px session rail; the zoom pill uses the matching offset. */}
      <div style={{
        position: 'fixed', bottom: 56, zIndex: 50, display: 'flex', flexDirection: 'column', gap: 8,
        ...(latestSide === 'left' ? { left: 240, alignItems: 'flex-start' } : { right: 24, alignItems: 'flex-end' }),
      }}>
        {detail.nodes.length > 0 && !nearCenter && (
          <button
            onClick={() => recenterHorizontal()}
            title="Recenter the timeline"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
              color: 'rgb(var(--color-text-secondary))', background: 'rgb(var(--color-surface-2))',
              border: '1px solid rgb(var(--color-surface-4))', borderRadius: 999, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            }}
          ><Crosshair size={14} /></button>
        )}
        {showScrollToLatest && (
          <button
            onClick={scrollToLatest}
            title="Scroll to latest"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11.5, fontWeight: 600, color: 'rgb(var(--color-surface-1))', background: 'rgb(var(--color-accent))',
              border: 'none', borderRadius: 999, padding: '7px 12px', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          ><ArrowDown size={13} /> Latest</button>
        )}
      </div>
    </div>
    </HoverDisabledContext.Provider>
  )
}
