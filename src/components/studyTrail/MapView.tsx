import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, RotateCcw, GitBranch, ArrowLeftRight, ArrowDown, Trash2, Crosshair, NotepadText, Pencil, StickyNote, Heading, BookOpen, Clock } from 'lucide-react'
import { bookName, bookChapterVerseLabel, parseRef } from '@/lib/parseRef'
import type { TrailConnection, TrailNode, TrailSession, TrailSessionDetail, TrailStickyNote as TrailStickyNoteData } from '@/types/studyTrail'
import ReasonPromptPopover from './ReasonPromptPopover'
import TrailHoverCard from './TrailHoverCard'
import TrailSelectedInfoCard from './TrailSelectedInfoCard'
import { TrailNodeHoverContent, TrailConnectionHoverContent, TrailVersePreview } from './TrailHoverContent'
import { useTrailRefMenu, openTrailRefMenu, TrailRefContextMenu } from './TrailRefContextMenu'
import { trailRefClick, navigateTrailRef, type TrailRef } from './trailNav'
import { useWordReplace } from './useWordReplace'
import { effectiveGapMs, gapSegmentHeight, formatGap, GAP_CHIP_THRESHOLD_MS } from './trailTime'
import TrailConnectorOverlay, { useTrailConnectorPoints, type TrailEdge } from './TrailConnectorOverlay'
import {
  buildTrailGraph, groupForRender, groupNodesForRender, flattenChain,
  renderAsBranch, hasUserVerseTies, hasNote, showNoteBubble, isLowSignalOrigin,
  TIER_COLOR, INDENT_STEP, OFFSPINE_DOT_INSET, SPINE_DOT_INSET, SPINE_LABEL_COL_INSET,
  type AnnotatedConn,
} from './trailGraph'
import { bulletCss, bulletKindForConnection, TIER_DOT, FONT, ICON, CARET_COLLAPSED_ROTATE } from './trailStyle'
import { BRANCH_PROMOTE_DEPTH_THRESHOLD, BRANCH_PROMOTE_DWELL_MS, LOOSE_SESSION_ID } from '@/store/studyTrailSlice'
import { getTrailScroll, setTrailScroll, EVERYTHING_SCROLL_KEY } from './trailWindowPrefs'
import { useTrailCollapse } from './useTrailCollapse'
import { TrailSectionHeader, TrailAnnotation } from './TrailStickyNote'

// Whether the "why'd you jump here" edit popup is currently open — read by every TrailHoverCard
// in the spine (via useContext, not prop-drilled through every ConnRow/NodeBlock/GlanceGroupRow/
// NodeClusterGroup call site) so hover cards uniformly disappear and stay hidden while the popup
// is up. Per direct feedback: "when i click the edit button, the hover thing should go away and
// shouldnt show until i close out of the whyd you jump here thing."
const HoverDisabledContext = createContext(false)

// Interaction model for the whole spine, shared by context rather than prop-drilled through
// NodeClusterGroup / GlanceGroupRow / every nested ConnRow. Per direct feedback the three
// gestures are deliberately distinct, because a stray click must never jump the main window:
//   • click the ROW AREA      → expand/collapse that stop's branches
//   • Cmd/Ctrl+click a LABEL  → navigate the main window (see trailNav.ts)
//   • click the exact BULLET  → pin it: its causal chain stays pronounced and everything else
//                               dims, until it's clicked again or Escape is pressed
interface TrailInteraction {
  isCollapsed: (scope: 'branch' | 'section', key: string) => boolean
  toggleCollapsed: (scope: 'branch' | 'section', key: string) => void
  pinnedKey: string | null
  togglePinned: (key: string) => void
  /** Local units available to the content column — indentation is budgeted against this so a
   *  deeply-nested chain stops indenting rather than forcing a horizontal scrollbar. */
  contentWidth: number
}
const TrailInteractionContext = createContext<TrailInteraction>({
  isCollapsed: () => false, toggleCollapsed: () => {}, pinnedKey: null, togglePinned: () => {}, contentWidth: 0,
})

// Indentation is capped at a fraction of the available width, then stops growing entirely. Per
// direct feedback: "multiple levels of indents is fine and such" but "i dont want to have to
// horizontally scroll at all." Past the budget a row keeps its depth badge (see ConnRow) instead
// of another 22px step, so a runaway 12-hop word-study chain stays on screen.
const INDENT_BUDGET_FRACTION = 0.4
function budgetedIndent(depth: number, contentWidth: number): { indent: number; overBudget: boolean } {
  const raw = INDENT_STEP * depth
  const budget = contentWidth > 0 ? contentWidth * INDENT_BUDGET_FRACTION : Infinity
  if (raw <= budget) return { indent: raw, overBudget: false }
  return { indent: Math.max(INDENT_STEP, Math.floor(budget / INDENT_STEP) * INDENT_STEP), overBudget: true }
}

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



/** Parse a free-text tie string ("Mark 13:1-5") into a clickable chapter ref, or null. */
function tieToRef(s?: string): TrailRef | null {
  const p = s?.trim() ? parseRef(s.trim()) : null
  return p ? { kind: 'chapter', bookId: p.bookId, chapter: p.chapter, verse: p.verse } : null
}
/** Display label for a tie: the raw stored string when there is one, else the canonical
 *  single-verse ref label. RAW wins now (was the other way around) — a tie set through the
 *  verse-tie picker is always the FULL compact range string ("Luke 4:18-19,22,25-30"), and
 *  `tieToRef` above only ever keeps the parsed ref's first verse (it exists for click-to-
 *  navigate, where a single target verse is all that's needed) — falling back to that
 *  ref-derived label here silently truncated a multi-verse tie down to its first verse. Every
 *  raw tie string is already the canonical, fully-formatted display form (either the picker's
 *  range string, or a legacy single-verse/verse-range pin), so there's no normalization left
 *  for the ref-derived form to add now that free-typed manual entry is gone. */
function tieLabel(ref: TrailRef | null, raw?: string): string | undefined {
  return raw?.trim() || (ref && ref.kind === 'chapter' ? bookChapterVerseLabel(ref.bookId, ref.chapter, ref.verse) : undefined)
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

// The time-gap marker between two stops. REBUILT as a compact chip, per direct feedback: "the
// time gap divider things take up a lot of space horizontally.. i think those should get
// refactored to look nicer."
//
// It also silently broke horizontal centring, which is the other half of "i notice that not in
// every session is the main spine centered". The old version was a full-bleed dashed rule forced
// to at least the scroll viewport's width, and `contentWidth` is measured from the container that
// holds it — so any session containing one long pause reported content as wide as the window,
// which drove the centring padding to zero. Only sessions with no long gaps stayed centred, which
// is exactly the "some sessions but not others" symptom. A chip that shrink-wraps its own text
// can't do that, so centring now behaves the same in every session.
function GapDivider({ gapMs, gutterWidth = 0 }: { gapMs: number; gutterWidth?: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', minHeight: gapSegmentHeight(gapMs),
      // Sits directly on the spine's own column so it reads as a break IN the line, not as a
      // separate full-width band across the map.
      paddingLeft: gutterWidth + SPINE_DOT_INSET - 5,
    }}>
      <span style={{
        fontSize: FONT.meta, fontWeight: 600, letterSpacing: '.02em', lineHeight: '17px',
        color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-2))',
        border: '1px solid rgb(var(--color-surface-4))', borderRadius: 999, padding: '0 7px',
        whiteSpace: 'nowrap',
      }}>{formatGap(gapMs)}</span>
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

// REMOVED (was OriginBadgeLine, the always-visible "via X" line above a node) — round-tripped
// through tier-1-only, then tier-2/3-with-hedge, then back to tier-1-only, and per this round's
// direct feedback it's gone entirely now: "i dont think the 'via Strong's G3619 occurrence' and
// such should be showing outside of the hover thing... only really main text and chapters and
// strongs and such should be showing outside of the hover thing." The full "via ..." fact for
// every tier still lives in the hover card (TrailHoverContent.tsx's OriginLine) — this was a
// deliberate simplification to keep the always-visible area clean, not an oversight.



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
export function TrailNoteBubbleContent({ conn, onEdit }: { conn: TrailConnection; onEdit?: () => void }) {
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
          {onEdit && (
            <button
              onClick={onEdit} title="Edit this note"
              style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 0, display: 'flex' }}
            ><Pencil size={11} /></button>
          )}
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
const TANGENT_BULLET_PAD = 9

// A small additional reservation (on top of TANGENT_BULLET_PAD) for the two transitions that
// don't get it "for free" from a bullet's own padding alone — node→first-bullet and last-
// bullet→arrival-node — so those two steps grow in step with bullet→bullet instead of staying
// pinned at zero forever. Kept the same uniform value everywhere it's used so all four tangent
// transitions still track each other.
const TANGENT_EXTRA_GAP = 8

// Extra breathing room between two ordinary, back-to-back main-spine nodes (no tangent
// involved, no real elapsed-time gap large enough to earn its own scaled height) — per direct
// feedback ("increase the gap for the main spine"), kept clearly bigger than a tangent step.
// Trimmed 44 -> 28 alongside gapSegmentHeight, same reasoning: with larger type the rows carry
// their own separation and this was mostly dead space.
const MAIN_SPINE_GAP = 28

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
      secondaryContent={showNoteBubble(conn) ? <TrailNoteBubbleContent conn={conn!} onEdit={onOpenPrompt ? () => onOpenPrompt(conn!) : undefined} /> : undefined}
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
        {/* A tangent bullet is a VERSE — same shape/colour rule as everywhere else on the map
            (trailStyle.ts); it used to be its own bespoke muted grey dot. */}
        <span ref={registerPoint(pointKey)} style={bulletCss('verse')} />
        <span style={{ fontSize: FONT.row, color: 'rgb(var(--color-text-secondary))' }}>{label}</span>
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
      : conn.toKind === 'note' || conn.toKind === 'video' || conn.toKind === 'pdf' || conn.toKind === 'search'
        // Side stops (a note, a video, a PDF, a search — see recordSideStop) carry what they
        // actually were in reasonText; falling back to the bare kind only when that's missing,
        // which is the case for the handful of pre-existing rows written before it was set.
        ? (conn.reasonText?.trim() || conn.toKind)
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
  const { isCollapsed, toggleCollapsed, pinnedKey, togglePinned, contentWidth } = useContext(TrailInteractionContext)
  const { indent, overBudget } = budgetedIndent(conn.chainDepth + 1, contentWidth)

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
  const collapsed = hasNested && isCollapsed('branch', conn.id)
  // Count of what's hidden, so a folded branch still says how much it stands for rather than
  // just vanishing.
  // What the fold pill counts: the whole sub-tree, not just the direct children — the pill is
  // answering "how much is under here", and a chain of single children would otherwise always
  // read "1".
  const branchCount = (fullChain.length || directChildren.length) || 0

  const hoverDisabled = useContext(HoverDisabledContext)
  const rowKey = `row:${conn.id}`
  const pinned = pinnedKey === rowKey
  const hoverDimmed = !!hoverChain && !hoverChain.has(rowKey)
  return (
    <div onMouseEnter={() => onHoverKey?.(rowKey)} onMouseLeave={() => onHoverKey?.(null)} style={{ opacity: hoverDimmed ? 0.3 : 1, transition: 'opacity 120ms' }}>
    <TrailHoverCard
      disabled={hoverDisabled}
      content={<TrailConnectionHoverContent conn={conn} onEditNote={() => onOpenPrompt(conn)} />}
      secondaryContent={showNoteBubble(conn) ? <TrailNoteBubbleContent conn={conn} onEdit={() => onOpenPrompt(conn)} /> : undefined}
    >
      <div
        onClick={hasNested ? () => toggleCollapsed('branch', conn.id) : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', marginLeft: indent,
          cursor: hasNested ? 'pointer' : 'default',
        }}
      >
        {/* Clicking the bullet ITSELF pins this stop instead of folding it — the two gestures sit
            millimetres apart on purpose (bullet = "show me what led here", row = "fold this
            away"), so the bullet stops the click from reaching the row's own handler. Shape and
            colour come from trailStyle.ts; this used to paint itself the connection's clarity-tier
            colour, which is why the map read as randomly multicoloured. */}
        <span
          ref={registerPoint(rowKey)}
          onClick={(e) => { e.stopPropagation(); togglePinned(rowKey) }}
          title="Highlight what led here"
          style={{
            ...bulletCss(bulletKindForConnection(conn.toKind), { dim: conn.weight === 'glance' }),
            cursor: 'pointer',
            boxShadow: pinned ? '0 0 0 3px rgb(var(--color-accent) / 0.45)' : undefined,
          }}
        />
        <span
          onClick={ref ? (e) => { trailRefClick(ref, e) } : undefined}
          onContextMenu={ref ? (e) => openTrailRefMenu(openMenu, ref, e, undefined, () => window.studyTrail.deleteConnection(conn.id), undefined, {
            active: conn.isBranch,
            onToggle: () => window.studyTrail.updateConnectionReason(conn.id, { isBranch: !conn.isBranch }),
          }) : undefined}
          style={{
            fontSize: FONT.row, color: 'rgb(var(--color-text-primary))', opacity: conn.weight === 'glance' ? 0.6 : 1,
            cursor: ref ? 'pointer' : undefined, display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
          onMouseEnter={(e) => { if (ref) (e.currentTarget as HTMLElement).style.textDecoration = 'underline' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none' }}
        >
          {labelIcon === 'return' && <RotateCcw size={ICON.sm} style={{ opacity: 0.7, flexShrink: 0 }} />}
          {labelIcon === 'branch' && <GitBranch size={ICON.sm} style={{ opacity: 0.7, flexShrink: 0 }} />}
          {label}
          {hasNote(conn) && (
            <NotepadText size={ICON.sm} aria-label="Has a note" style={{ opacity: 0.5, marginLeft: 3, flexShrink: 0, color: 'rgb(var(--color-text-muted))' }} />
          )}
        </span>
        {/* Past the indent budget the row stops stepping right and says its depth in words
            instead — the alternative is a horizontal scrollbar, which is explicitly out. */}
        {overBudget && (
          <span
            title={`${conn.chainDepth + 1} levels deep`}
            style={{ fontSize: 9, color: 'rgb(var(--color-text-muted))', opacity: 0.8, flexShrink: 0 }}
          >↳{conn.chainDepth + 1}</span>
        )}
        {/* The collapse affordance. The previous version was a bare ▾ caret to the left of the
            row — per direct feedback, "i dont like that tiny caret thing to the left of the items
            with branches, it looks ugly" and "it isnt clear that the branches stuff is
            collapsable". A labelled pill saying what it holds is both prettier and
            self-explanatory, and it reads the same whether folded or not. */}
        {hasNested && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleCollapsed('branch', conn.id) }}
            title={collapsed ? 'Show what came off this' : 'Fold this branch away'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, cursor: 'pointer',
              fontSize: FONT.badge, lineHeight: '18px', padding: '0 8px', borderRadius: 999,
              background: collapsed ? 'rgb(var(--color-accent) / 0.14)' : 'rgb(var(--color-surface-3))',
              border: 'none', color: collapsed ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
            }}
          >
            <GitBranch size={ICON.sm} />
            {branchCount}
            <span style={{ transform: collapsed ? CARET_COLLAPSED_ROTATE : undefined, transition: 'transform 120ms', display: 'inline-block' }}>▾</span>
          </button>
        )}
        {isPromotedChain && (
          <span
            title={`A ${fullChain.length + 1}-hop word-study chain`}
            style={{
              fontSize: FONT.badge, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
              borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '.03em',
            }}
          >chain</span>
        )}
        {/* Clarity tier, demoted from "the colour of the connecting line" to a 4px dot. Tier 1
            (Berean knows exactly why this jump happened) is the normal case and shows nothing. */}
        {TIER_DOT[conn.clarityTier] && (
          <span
            title={conn.clarityTier === 3 ? "Berean isn't sure why you came here" : 'Inferred cause'}
            style={{ width: 4, height: 4, borderRadius: 999, flexShrink: 0, background: TIER_DOT[conn.clarityTier]!, opacity: 0.7 }}
          />
        )}
        {conn.versePinFrom != null && (
          <span style={{ fontSize: FONT.meta, color: 'rgb(var(--color-text-muted))' }}>
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
          <span style={{ fontSize: FONT.meta, color: 'rgb(var(--color-text-muted))' }}>reason unclear</span>
        ) : null}
        {conn.weight === 'glance' && <span style={{ fontSize: FONT.meta, color: 'rgb(var(--color-text-muted))' }}>(glance)</span>}
        {conn.clusterId && <span style={{ fontSize: FONT.meta, color: 'rgb(var(--color-text-muted))' }}>revisited</span>}
        {/* The always-visible row-level pencil that used to live here was removed — per direct
            feedback ("the revisit item has the pencil icon outside of the hover popup but it
            should only be inside the hover popup thing"), the note-edit trigger now lives
            exclusively inside the hover card (TrailConnectionHoverContent's own EditNoteBtn),
            not duplicated as a second always-visible affordance on the row itself. */}
      </div>
    </TrailHoverCard>
    {hasNested && !collapsed && (
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
      {/* A collapsed run of glances — a 'jump' bullet, hollow, because none of them were dwelt on. */}
      <span ref={registerPoint(groupKey)} style={{ ...bulletCss('jump', { revisit: true }), opacity: 0.7 }} />
      <span style={{ fontSize: FONT.row, color: 'rgb(var(--color-text-secondary))' }}>
        {labelFor(first)} → {labelFor(last)}
      </span>
      <button onClick={() => setExpanded(true)} style={{ fontSize: FONT.badge, fontWeight: 700, color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))', border: 'none', borderRadius: 999, padding: '2px 8px', cursor: 'pointer' }}>
        ▸ {items.length} glances
      </button>
    </div>
  )
}

function NodeClusterGroup({
  nodes, registerPoint, onHoverKey, connectionsByNodeId, nodeOrderIndex,
  onOpenPrompt, refFor, openMenu, originConnByNodeId, jumpToOrigin, rowsForConnection, hoverChain, gutterWidth,
  variant = 'bounce',
}: {
  nodes: TrailNode[]
  /** 'bounce' = a rapid run of revisits of the same chapter; 'run' = reading straight through
   *  consecutive chapters of one book. Same collapse mechanics, different badge — see
   *  groupNodesForRender. */
  variant?: 'bounce' | 'run'
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
        bounceBadge={{ count: variant === 'run' ? nodes.length : nodes.length - 1, spanMs, onExpand: () => setExpanded(true), variant }}
      />
    </div>
  )
}

function NodeBlock({
  node, connections, gapToNextMs, isLast, onOpenPrompt, refFor, openMenu, originConn, registerPoint, boundaryLabel, onJumpToOrigin,
  keyboardFocused, dimmed, searchMatched, blockRef, gutterWidth, step, onHoverKey, rowsForConnection, onDeleteNode, onToggleTopicBreak, onSplitHere, onAddSticky, bounceBadge, anchorVisits,
  isBranchNode, branchDepth, originVerseLabel, originVerseRef, destVerseLabel, destVerseRef, hoverChain, revisitAllowed = true, selected,
}: {
  node: TrailNode; connections: AnnotatedConn[]; gapToNextMs: number | null; isLast: boolean
  /** Part of the current marquee selection (drag-select in the timeline). */
  selected?: boolean
  onOpenPrompt: (c: TrailConnection) => void
  refFor: (conn: TrailConnection) => TrailRef | null
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; topicBreak?: { active: boolean; onToggle: () => void }; nodeActions?: { onSplitHere?: () => void; onAddSection?: () => void; onAddNote?: () => void }; x: number; y: number }) => void
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
  /** Right-click "Start a new session here" — everything from this stop onward moves into a new
   *  session. Absent in the merged Everything view, where "after this stop" spans sessions and
   *  the operation wouldn't mean anything coherent. */
  onSplitHere?: (nodeId: string) => void
  /** Places a v39 sticky (a section header, or a free annotation) at this stop. */
  onAddSticky?: (nodeId: string, kind: 'section' | 'annotation') => void
  /** How many times this session came back to this chapter — shown as a "home base" marker on
   *  the first visit when it's the session's most-returned-to passage. */
  anchorVisits?: number
  /** A collapsed cluster's summary badge, rendered inline in this node's header instead of a
   *  separate row — see NodeClusterGroup. */
  bounceBadge?: { count: number; spanMs: number; onExpand: () => void; variant?: 'bounce' | 'run' }
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
  const rowElRef = useRef<HTMLDivElement>(null)
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
  const { isCollapsed, toggleCollapsed, pinnedKey, togglePinned } = useContext(TrailInteractionContext)
  const nodeKey = `node:${node.id}`
  const pinned = pinnedKey === nodeKey
  const hasRows = items.length > 0
  // A node's own branch shelf folds under the same persisted scope as a ConnRow's — keyed by the
  // node id so the two can never collide with a connection id.
  const rowsCollapsed = hasRows && isCollapsed('branch', nodeKey)
  // Everything under this stop, however deep — what the fold pill counts.
  const branchTotal = connections.length + connections.reduce((n, c) => n + flattenChain(c.id, rowsForConnection).length, 0)

  // ── Pace ────────────────────────────────────────────────────────────────
  // Per direct feedback ("i want the thinking path to be clear and clearly show what was
  // happening while i was studying... sometimes we study fast or slow and stuff"), dwell is shown
  // TWICE, because Michael asked for "a combination of bar and changing row height":
  //   • a weight/height bar in the dot column, so a skim and a long sit are distinguishable at a
  //     glance without reading any numbers, and
  //   • a modest, hard-clamped increase in the row's own bottom padding, so the spine's vertical
  //     rhythm IS the pace of the study.
  // Both are sqrt-scaled and capped: linear scaling would let one 40-minute stop dwarf an entire
  // afternoon of shorter ones and push everything else off screen.
  const dwellMs = Math.max(0, (node.anchorEndedAt ?? node.anchorStartedAt) - node.anchorStartedAt)
  const dwellUnit = Math.min(1, Math.sqrt(dwellMs / (20 * 60_000)))
  const dwellExtraPad = Math.round(dwellUnit * 12)
  const dwellLabel = dwellMs >= 30_000 ? formatGap(dwellMs) : null

  const hoverDimmed = !!hoverChain && !hoverChain.has(nodeKey)
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
        // Clock icon + heavier rule (2px, not 1px) than the topic-break divider below — per
        // feedback ("make it more clear where the time break is"), this is an ACTUAL elapsed-
        // time boundary (a new day or a new session), not just a reading-topic change, so it
        // should read as more structurally significant at a glance, not merely differently
        // colored. The label itself now carries a clock time too (see EverythingView's
        // fmtClock), not just a date/session name.
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px', paddingLeft: 21,
          fontSize: FONT.badge, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em',
        }}>
          <Clock size={11} style={{ flexShrink: 0, opacity: 0.85 }} />
          <span style={{ flexShrink: 0 }}>{boundaryLabel}</span>
          <span style={{ flex: 1, height: 2, background: 'rgb(var(--color-surface-4))' }} />
        </div>
      )}
      {/* v36 — a user-marked topic break: a plain divider on the main spine (not a new
          sub-spine), same visual language as the session boundaryLabel above but distinct
          styling (accent-tinted) so it's clearly a deliberate user marker, not an automatic
          session/date grouping. */}
      {node.isTopicBreak && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px', paddingLeft: 21,
          fontSize: FONT.badge, fontWeight: 700, color: 'rgb(var(--color-accent))', textTransform: 'uppercase', letterSpacing: '.05em',
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
      {/* This whole bullet column used to sit OUTSIDE the TrailHoverCard below (that one only
          ever wrapped the reference-text column next to it) — despite the comment right here
          already claiming "own hover card". Per feedback ("hovering over the bullets... isnt
          showing the hover thing"): the visible round/square dot is exactly this column's own
          content, so hovering it never triggered anything. Fixed with its own TrailHoverCard
          instance (same content as the text column's) rather than restructuring the existing
          one across ~130 lines of sibling content — two independent hover-card triggers over
          adjacent parts of the same row is a small, safe addition. */}
      <TrailHoverCard
        disabled={hoverDisabled}
        content={<TrailNodeHoverContent node={node} originConn={originConn} onEditNote={originConn ? () => onOpenPrompt(originConn) : undefined} />}
      >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
        {/* A promoted revisit's own dot is smaller/dimmer than a first-time chapter stop —
            still a full, real spine entry (own connections, own hover card), just visually
            marked as "seen before" at a glance. See the revisit-link edge built in MapView
            below for the quiet dashed connector back to the original mention. */}
        {/* A revisit keeps the full 9px square and goes HOLLOW rather than shrinking — the old
            7px-and-faded treatment conflated "I've been here before" with "this mattered less".
            See trailStyle.ts. */}
        <div
          ref={registerPoint(nodeKey)}
          onClick={(e) => { e.stopPropagation(); togglePinned(nodeKey) }}
          title={isRevisit ? 'Been here before — click to highlight what led here' : 'Highlight what led here'}
          style={{
            ...bulletCss('chapter', { revisit: isRevisit }),
            marginTop: 4, cursor: 'pointer',
            boxShadow: pinned ? '0 0 0 3px rgb(var(--color-accent) / 0.45)' : undefined,
          }}
        />
        {/* Dwell BAR removed entirely — per direct feedback, it wasn't connecting anything (it
            was never a real edge, just a duration indicator) and just read as visual noise off
            the bullet regardless of color. The dwell TIME itself is still shown, plainly, as
            text next to the reference label below (dwellLabel) — that's the one place it needs
            to live. */}
        {!isLast && <GapConnector gapMs={gapToNextMs} />}
      </div>
      </TrailHoverCard>
      {/* maxWidth caps how far this stretches — `flex:1` alone lets it grow to match whatever
          the WIDEST row anywhere in the whole spine happens to need (a long note preview, a
          long Strong's list, etc.), dragging the gutter column (registered right after this
          div) far out to the right of THIS row's own short text along with it — which is
          exactly why laned edges (revisit-links, branch-return arrows) were swinging out into
          a wide loop well past nearby text instead of hugging close to the actual content. */}
      <div style={{ paddingBottom: ((!isLast && gapToNextMs == null) ? TANGENT_EXTRA_GAP : 14) + (hasRows ? 0 : dwellExtraPad), flex: 1, minWidth: 0, maxWidth: 'var(--trail-row-max, 460px)' }}>
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
          secondaryContent={showNoteBubble(originConn) ? <TrailNoteBubbleContent conn={originConn!} onEdit={() => onOpenPrompt(originConn!)} /> : undefined}
        >
          <div
            ref={rowElRef}
            onClick={(e) => { if (!trailRefClick(nodeRef, e) && hasRows) toggleCollapsed('branch', nodeKey) }}
            onContextMenu={(e) => openTrailRefMenu(
              openMenu, nodeRef, e, onJumpToOrigin,
              onDeleteNode ? () => onDeleteNode(node.id) : undefined,
              onToggleTopicBreak ? { active: node.isTopicBreak, onToggle: () => onToggleTopicBreak(node.id, node.isTopicBreak) } : undefined,
              originConn ? {
                active: originConn.isBranch,
                onToggle: () => window.studyTrail.updateConnectionReason(originConn.id, { isBranch: !originConn.isBranch }),
              } : undefined,
              {
                onSplitHere: onSplitHere ? () => onSplitHere(node.id) : undefined,
                onAddSection: onAddSticky ? () => onAddSticky(node.id, 'section') : undefined,
                onAddNote: onAddSticky ? () => onAddSticky(node.id, 'annotation') : undefined,
              },
            )}
            style={{
              fontFamily: 'ui-monospace, monospace', fontSize: isRevisit ? FONT.row : FONT.stop, fontWeight: 600, cursor: 'pointer',
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
              fontSize: FONT.step, fontWeight: 700, color: 'rgb(var(--color-text-muted))', opacity: 0.7,
              // Was a fixed minWidth:16 — fine for 1-2 digit steps, but a 3-4 digit step number
              // (long sessions) overflowed that fixed box and crowded into the reference label
              // right after it. Size the column to the actual digit count instead (monospace
              // font, so `ch` units track real character width) with a small floor so short
              // step numbers don't get a cramped column either.
              minWidth: `max(16px, ${String(step).length}ch)`, textAlign: 'right', flexShrink: 0,
            }}>{step}</span>
            {bookChapterVerseLabel(node.bookId, node.chapter)}
            {dwellLabel && (
              <span style={{ fontSize: FONT.meta, fontWeight: 400, fontStyle: 'normal', color: 'rgb(var(--color-text-muted))', opacity: 0.75, flexShrink: 0 }}>
                {dwellLabel}
              </span>
            )}
            {/* Same labelled fold pill as a branch row's, so one affordance means one thing
                everywhere on the map. Replaces the caret that used to sit before the title. */}
            {hasRows && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleCollapsed('branch', nodeKey) }}
                title={rowsCollapsed ? 'Show what came off this stop' : 'Fold this stop\u2019s branches away'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, cursor: 'pointer',
                  fontSize: FONT.badge, fontWeight: 600, fontStyle: 'normal', lineHeight: '18px', padding: '0 8px', borderRadius: 999,
                  background: rowsCollapsed ? 'rgb(var(--color-accent) / 0.14)' : 'rgb(var(--color-surface-3))',
                  border: 'none', color: rowsCollapsed ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
                }}
              >
                <GitBranch size={ICON.sm} />
                {branchTotal}
                <span style={{ transform: rowsCollapsed ? CARET_COLLAPSED_ROTATE : undefined, transition: 'transform 120ms', display: 'inline-block' }}>▾</span>
              </button>
            )}
            {hasNote(originConn) && (
              <NotepadText size={ICON.sm} aria-label="Has a note" style={{ opacity: 0.5, flexShrink: 0, color: 'rgb(var(--color-text-muted))' }} />
            )}
            {/* Home base — the passage this session kept returning to. */}
            {anchorVisits != null && (
              <span
                title={`You came back to this passage ${anchorVisits} times — the centre of this study`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                  fontSize: FONT.badge, fontWeight: 700, fontStyle: 'normal', letterSpacing: '.03em', textTransform: 'uppercase',
                  color: 'rgb(var(--color-accent))', background: 'rgb(var(--color-accent) / 0.14)',
                  borderRadius: 999, padding: '2px 8px',
                }}
              ><Crosshair size={ICON.sm} /> home · {anchorVisits}</span>
            )}
            {isRevisit && !bounceBadge && (
              <span style={{
                fontSize: FONT.badge, fontWeight: 700, fontStyle: 'italic', color: 'rgb(var(--color-text-muted))', background: 'rgb(var(--color-surface-3))',
                borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '.03em',
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
                title={bounceBadge.variant === 'run'
                  ? `Read straight through ${bounceBadge.count} chapters over ${formatGap(bounceBadge.spanMs)} — click to show every one`
                  : `Bounced ${bounceBadge.count}x over ${formatGap(bounceBadge.spanMs)}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: FONT.badge, fontWeight: 700, fontStyle: 'normal', color: 'rgb(var(--color-accent))', background: 'rgb(var(--color-accent) / 0.14)',
                  border: 'none', borderRadius: 999, padding: '2px 9px', cursor: 'pointer', letterSpacing: '.01em',
                }}
              >
                {bounceBadge.variant === 'run'
                  ? <><BookOpen size={ICON.sm} /> read through {bounceBadge.count}</>
                  : <><ArrowLeftRight size={ICON.sm} /> {bounceBadge.count}x</>}
              </button>
            )}
          </div>
        </TrailHoverCard>
        {/* Per feedback ("when the user hovers over a bullet, show the same thing as the item"):
            a SELECTED node (marquee/keyboard select) used to get only a highlight ring, no info
            at all. Shows the same TrailNodeHoverContent the hover card above shows, independent
            of the mouse — see TrailSelectedInfoCard's own comment for why this is a separate,
            simpler component rather than teaching TrailHoverCard about a second trigger. */}
        {selected && (
          <TrailSelectedInfoCard
            anchorRef={rowElRef}
            content={<TrailNodeHoverContent node={node} originConn={originConn} onEditNote={originConn ? () => onOpenPrompt(originConn) : undefined} />}
          />
        )}
        {node.cachedSubnote && <div style={{ fontSize: FONT.meta, color: 'rgb(var(--color-text-muted))', marginTop: 2 }}>{replace(node.cachedSubnote)}</div>}
        <div style={{ marginTop: 4 }}>
          {/* Folded away, but never silently: the summary line says how many stops are hidden, so
              a collapsed stop still reads as "there was more here" rather than as a bare chapter.
              Clicking it (or the row above) puts them back — and the fold is remembered across
              restarts, per direct feedback. */}
          {rowsCollapsed ? null : items.map((it) => it.type === 'single'
            ? <ConnRow key={it.item.id} conn={it.item} refFor={refFor} onOpenPrompt={onOpenPrompt} openMenu={openMenu} registerPoint={registerPoint} rowsForConnection={rowsForConnection} onHoverKey={onHoverKey} originBookId={node.bookId} originChapter={node.chapter} hoverChain={hoverChain} />
            : <GlanceGroupRow key={it.key} groupKey={it.key} items={it.items} refFor={refFor} openMenu={openMenu} registerPoint={registerPoint} />)}
        </div>
      </div>
      </div>
    </div>
    </div>
  )
}

const blankMenuBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
  background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
  color: 'rgb(var(--color-text-primary))', textAlign: 'left', fontSize: 12,
}

export const ZOOM_MIN = 0.5
// Raised from 2 — with the map's own text now larger at 100%, the useful range shifted upward,
// and a dense Everything timeline is genuinely easier to read pushed further in.
export const ZOOM_MAX = 3
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

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
  filterValue, onFilterChange, topInset = 0, onLayoutRoomChange,
  scrollKey = EVERYTHING_SCROLL_KEY, onSplitHere,
}: {
  detail: TrailSessionDetail; onChanged: () => void; boundaryLabelForNodeId?: Map<string, string>
  /** Right-click a stop → "Start a new session here". Only supplied for a single-session map;
   *  in the merged Everything timeline "everything after this stop" crosses session boundaries,
   *  so the operation has no coherent meaning and the item is simply absent. */
  onSplitHere?: (nodeId: string) => void
  /** Identifies the current view for scroll-position persistence — `selectedId ?? '__everything__'`
   *  (see trailWindowPrefs). On mount / when this changes, a saved scroll position for the key is
   *  restored INSTEAD of the default open-at-newest jump; the live scroll position is saved back
   *  (debounced) under this key. */
  scrollKey?: string
  /** Reports the live clear space (px) on each side of the trail's SOLID content (spine +
   *  branch bullets — faint arcs don't count) so the parent can decide which side to float its
   *  own header / zoom controls on. Per direct feedback: those controls default to the left and
   *  "swap to the right if they will get in the way of the main spine/branches". */
  onLayoutRoomChange?: (room: { left: number; right: number }) => void
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

  // Persist this view's scroll position (per scrollKey) so reopening the Study Trail window
  // lands back where the user left off — debounced so a scroll drag doesn't thrash localStorage.
  // The timeout closes over the scrollKey of the render it was scheduled in, so a save that
  // lands just after a view switch still writes under the view it came from.
  const saveScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function saveScrollDebounced() {
    const el = scrollContainerRef.current
    if (!el) return
    const key = scrollKey
    if (saveScrollTimerRef.current) clearTimeout(saveScrollTimerRef.current)
    saveScrollTimerRef.current = setTimeout(() => {
      const cur = scrollContainerRef.current
      if (cur) setTrailScroll(key, { top: cur.scrollTop, left: cur.scrollLeft })
    }, 150)
  }
  useEffect(() => () => { if (saveScrollTimerRef.current) clearTimeout(saveScrollTimerRef.current) }, [])
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
    // Sticky-follow the newest end while a live session appends — but never fight a restored
    // scroll position: the restore layout-effect below runs first on this same commit and clears
    // isAtBottomRef when the saved spot isn't at the bottom.
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
    // A saved scroll position for the current view wins — the restore layout-effect below sets
    // scrollLeft from it; centering here would just be immediately overwritten (or, on an
    // Everything-view session-id churn, clobber the restored position).
    if (getTrailScroll(scrollKey)) return
    recenterHorizontal('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.session.id, detail.nodes.length])

  // Restore this view's saved scroll position (per scrollKey) instead of the default open-at-
  // newest jump — or, when nothing is saved, apply that default (newest at the bottom; the
  // horizontal centering is handled by the once-per-session effect above). Runs once per
  // scrollKey, after node data has rendered. useLayoutEffect (pre-paint) so the user never sees
  // a flash of the wrong position, mirroring the horizontal-recenter effect's timing.
  const restoredScrollKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || detail.nodes.length === 0) return
    if (restoredScrollKeyRef.current === scrollKey) return
    restoredScrollKeyRef.current = scrollKey
    const saved = getTrailScroll(scrollKey)
    if (saved) {
      el.scrollLeft = saved.left
      el.scrollTop = saved.top
      const atBottom = el.scrollHeight - saved.top - el.clientHeight < NEAR_BOTTOM_PX
      isAtBottomRef.current = atBottom
      setShowScrollToLatest(!atBottom)
    } else {
      el.scrollTop = el.scrollHeight
      isAtBottomRef.current = true
      setShowScrollToLatest(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, detail.nodes.length])

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
  // The PINNED point (clicking a bullet). Feeds the exact same causal-chain walk as hovering, so
  // "show me what led here" is one mechanism with two ways in: hover is transient, a pin sticks
  // until it's clicked again or Escape is pressed. Hover still wins while the mouse is over
  // something, so a pin never blocks exploring.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  // Right-click on EMPTY map space → add a note or a section there. Per direct feedback:
  // "rightclicking empty space in a note should allow the user to create a note from a menu."
  // Until now a sticky could only be added by right-clicking an existing stop, which is a strange
  // place to look for "put a note here" — the empty margin beside the spine is the obvious one.
  // The note is anchored to the nearest stop ABOVE the click, which is what "here" means on a
  // timeline that reads downward.
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number; nodeId: string; sectionNodeId: string } | null>(null)
  useEffect(() => {
    if (!blankMenu) return
    const close = () => setBlankMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [blankMenu])
  const togglePinned = useCallback((key: string) => setPinnedKey((k) => (k === key ? null : key)), [])
  const collapse = useTrailCollapse()
  // Sticky notes and section headers pinned to this map (v39). Loaded per-session, and refreshed
  // on the same push channel as everything else so a note added in another window appears here.
  const [stickies, setStickies] = useState<TrailStickyNoteData[]>([])
  const sessionIdForNotes = detail.session.id
  const reloadStickies = useCallback(() => {
    // The merged Everything timeline has a synthetic 'merged' session id — load ALL notes there
    // instead, and let the anchor-node lookup below place them.
    const arg = sessionIdForNotes === 'merged' ? undefined : sessionIdForNotes
    window.studyTrail.listNotes(arg).then(setStickies).catch(() => {})
  }, [sessionIdForNotes])
  useEffect(() => { reloadStickies() }, [reloadStickies])
  useEffect(() => window.studyTrail.onDataChanged(() => reloadStickies()), [reloadStickies])
  // Cleared when the view changes — a pin on a stop that isn't rendered any more would dim the
  // whole spine with nothing pronounced (see hoveredKeyIsLive's own safety net).
  useEffect(() => { setPinnedKey(null) }, [scrollKey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
    // `.no-drag` covers the popovers AND the map's own sticky notes, which are dragged by their
    // own header — without it, moving a note also rubber-banded a selection box behind it.
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
    // MULTIPLICATIVE, not additive. The old `zoom - deltaY * 0.01` moved by a fixed number of
    // absolute zoom units per notch, so the same gesture was a huge jump down at 0.5x and barely
    // anything at 2x — the "zoom doesn't feel nice" problem. Scaling by a ratio makes one notch
    // feel identical at every level, which is how every other zoomable surface behaves.
    const next = clampZoom(zoom * Math.exp(-e.deltaY * 0.0022))
    zoomAtPoint(next, e.clientX, e.clientY)
  }

  /** Applies a new zoom while keeping whatever is under (cx, cy) under it afterwards. Zooming
   *  around the top-left corner — which is what a bare setZoom does, since the transform origin is
   *  top-left — throws the thing you were looking at off screen, and is most of why zooming felt
   *  bad rather than merely coarse. */
  function zoomAtPoint(next: number, cx: number, cy: number) {
    const el = scrollContainerRef.current
    if (!el || next === zoom) { setZoom(next); return }
    const r = el.getBoundingClientRect()
    // Offset of the cursor within the scrolled content, in local (pre-transform) units.
    const localX = (el.scrollLeft + (cx - r.left)) / zoom
    const localY = (el.scrollTop + (cy - r.top)) / zoom
    setZoom(next)
    // After React commits the new scale, put the same local point back under the cursor.
    requestAnimationFrame(() => {
      const v = scrollContainerRef.current
      if (!v) return
      v.scrollLeft = localX * next - (cx - r.left)
      v.scrollTop = localY * next - (cy - r.top)
    })
  }

  /** Zoom from a button or a keyboard shortcut — anchored on the middle of the view, which is the
   *  closest thing to "what I'm looking at" when there's no cursor position to use. */
  function zoomBy(factor: number) {
    const el = scrollContainerRef.current
    if (!el) { setZoom(clampZoom(zoom * factor)); return }
    const r = el.getBoundingClientRect()
    zoomAtPoint(clampZoom(zoom * factor), r.left + r.width / 2, r.top + r.height / 2)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(1.15) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.15) }
      else if (e.key === '0') { e.preventDefault(); setZoom(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // no dep array on purpose: the handlers close over the CURRENT zoom, which changes every step

  // ── The graph ─────────────────────────────────────────────────────────────
  // Every "which rows hang under which node" and "which lines connect which points" decision
  // now lives in trailGraph.ts as one pure function — see that file's header for the
  // last-write-wins node-resolution bug this extraction was done to fix ("some of the arrows
  // point wrongly to future arrows"). Nothing there measures or renders; MapView only consumes.
  const graph = buildTrailGraph(detail, { revisitWindowMs, boundaryLabelForNodeId })
  const {
    nodeById, nextNodeById, nodeOrderIndex, originConnByNodeId,
    rowsForNode, rowsForConnection, edges, gutterWidth, maxRenderDepth,
    hourMarkers, isRevisitWithinWindow, anchorNodes,
  } = graph

  // ── What a fold actually hides ────────────────────────────────────────────
  // "collapsing doesnt seem to fully be working for branches" — because a branch's real payoff is
  // usually a CHAPTER it landed on, and those render as stops on the spine, not as rows under the
  // folded connection. Folding hid the row and left its destination sitting there.
  //
  // A stop is hidden when the branch that produced it is hidden: walk from its origin connection
  // up through fromConnectionId, and also check the stop that connection hangs off. Only branch
  // arrivals can be hidden this way — a chapter you simply read on to is part of the spine and is
  // never folded away by something else's fold.
  const connById = new Map(detail.connections.map((c) => [c.id, c]))
  function branchHidden(conn: TrailConnection): boolean {
    if (collapse.isCollapsed('branch', `node:${conn.fromNodeId}`)) return true
    let parentId = conn.fromConnectionId
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      if (collapse.isCollapsed('branch', parentId)) return true
      parentId = connById.get(parentId)?.fromConnectionId
    }
    return false
  }
  function nodeHiddenByFold(n: TrailNode): boolean {
    const oc = originConnByNodeId.get(n.id)
    if (!oc || !renderAsBranch(oc)) return false
    return branchHidden(oc)
  }

  // Stickies indexed by the node they're pinned to. A 'section' renders ABOVE its node and owns
  // every stop from there until the next section; an 'annotation' renders beside its node.
  const sectionsByNodeId = new Map<string, TrailStickyNoteData[]>()
  const annotationsByNodeId = new Map<string, TrailStickyNoteData[]>()
  for (const st of stickies) {
    if (!st.anchorNodeId) continue
    const target = st.kind === 'section' ? sectionsByNodeId : annotationsByNodeId
    const list = target.get(st.anchorNodeId)
    if (list) list.push(st)
    else target.set(st.anchorNodeId, [st])
  }
  // Which section (if any) each node falls under, so collapsing a section hides its whole range
  // rather than just its own header row.
  const sectionForNodeId = new Map<string, string>()
  {
    let current: string | null = null
    for (const n of detail.nodes) {
      const opens = sectionsByNodeId.get(n.id)?.[0]
      if (opens) current = opens.id
      if (current) sectionForNodeId.set(n.id, current)
    }
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

  /** Nearest stop at or above a viewport y — what "here" means for a note, which renders beside
   *  the stop it belongs to. */
  function nodeIdAboveY(clientY: number): string | null {
    let best: string | null = null
    let bestTop = -Infinity
    for (const [id, el] of nodeBlockRefs.current) {
      const top = el.getBoundingClientRect().top
      if (top <= clientY && top > bestTop) { bestTop = top; best = id }
    }
    // Clicking above the first stop still has to land somewhere — use the first one.
    return best ?? detail.nodes[0]?.id ?? null
  }

  /** Nearest stop at or BELOW a viewport y. A section header renders ABOVE its anchor, so
   *  anchoring to the following stop is what puts the header itself at the spot that was actually
   *  right-clicked — anchoring above dropped it a whole stop higher than intended. */
  function nodeIdBelowY(clientY: number): string | null {
    let best: string | null = null
    let bestTop = Infinity
    for (const [id, el] of nodeBlockRefs.current) {
      const top = el.getBoundingClientRect().top
      if (top >= clientY - 8 && top < bestTop) { bestTop = top; best = id }
    }
    return best ?? nodeIdAboveY(clientY)
  }

  function onBlankContextMenu(e: React.MouseEvent) {
    // Rows and bullets call e.stopPropagation() in their own handlers, so reaching here means the
    // click really was on empty space.
    if (detail.nodes.length === 0) return
    // Both anchors are captured at right-click time, because which one is correct depends on
    // which item is chosen from the menu.
    const above = nodeIdAboveY(e.clientY)
    const below = nodeIdBelowY(e.clientY)
    if (!above && !below) return
    e.preventDefault()
    setBlankMenu({ x: e.clientX, y: e.clientY, nodeId: above ?? below!, sectionNodeId: below ?? above! })
  }

  function addStickyAt(nodeId: string, kind: 'section' | 'annotation') {
    setBlankMenu(null)
    void window.studyTrail.createNote({
      trailSessionId: nodeById.get(nodeId)?.trailSessionId ?? detail.session.id,
      kind, anchorNodeId: nodeId, orderIndex: nodeOrderIndex.get(nodeId) ?? 0,
    }).then(reloadStickies)
  }

  function refFor(conn: TrailConnection): TrailRef | null {
    if (conn.toKind === 'lexicon' && conn.toStrongsNum) return { kind: 'lexicon', strongsNum: conn.toStrongsNum }
    if ((conn.toKind === 'chapter' || conn.toKind === 'compare') && conn.toBookId && conn.toChapter != null) {
      return { kind: 'chapter', bookId: conn.toBookId, chapter: conn.toChapter, verse: conn.toVerse }
    }
    return null
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
  // Hover takes precedence over a pin: moving the mouse over something always shows THAT chain,
  // and dropping off it falls back to whatever is pinned rather than to nothing.
  const focusKey = hoveredKey ?? pinnedKey
  if (focusKey) {
    hoverChainPointKeys.add(focusKey)
    // Direct, single-hop only: a return/revisit-link edge pronounces when the hovered point is
    // literally one of its own two ends, without chasing anything further through it.
    for (const e of edges) {
      if (!isBackwardEdge(e.key)) continue
      if (e.from === focusKey || e.to === focusKey) hoverChainEdgeKeys.add(e.key)
    }
    const stack = [focusKey]
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
  const hoveredKeyIsLive = !!focusKey && edges.some((e) => e.from === focusKey || e.to === focusKey)
  // REFACTORED per direct feedback ("the right click is still hiding the connection lines")
  // after the previous fix (suppressing new hover claims at the SETTER while a menu is open)
  // still wasn't enough — rather than keep chasing exactly which event re-sets hoveredKey while
  // a menu is up, gate the OUTPUT directly: whenever any context menu is open, dimming is off,
  // full stop, regardless of what hoveredKey happens to hold. This can't be defeated by a stray
  // re-fired mouseenter, a stale key, or any other path into hoveredKey — the single place that
  // actually paints the dim effect refuses to do it at all while `menu` is truthy.
  const hoverActive = hoveredKeyIsLive && !menu
  const finalEdges = hoverActive
    ? edges.map((e) => hoverChainEdgeKeys.has(e.key)
        ? { ...e, opacity: 1, strokeWidth: (e.strokeWidth ?? (e.thick ? 3 : 1.75)) * 1.35 }
        : { ...e, opacity: (e.opacity ?? 1) * 0.12 })
    : edges

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
  // TRUE symmetric centering. This used to be `const centreNudge = pad`, which made
  // `paddingLeft: pad - centreNudge` evaluate to 0 on every render and `paddingRight` to 2·pad —
  // i.e. the spine was hard-left-hugged, never centred, despite the "Horizontal placement model"
  // comment above describing symmetric centering. That was a deliberate response to older
  // feedback ("move it as far left as possible"); the current ask is the opposite ("it isn't
  // centered horizontally"), and with the gutter now a fixed-width column there's no longer any
  // reason to hug left. `contentWidth` includes the gutter spacer, so subtracting half of it
  // back out centres the SPINE itself rather than the spine-plus-gutter box — otherwise a
  // session with backlinks would sit visibly right of one without any.
  const centreNudge = -gutterWidth / 2

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

  // ── Time rail (left edge) ──────────────────────────────────────────────────
  // Replaces the old top-right "current hour" badge entirely — per direct feedback, something
  // that lives ON THE MAP itself, on the left side: a small label tracking whichever hour marker
  // is current, sliding down a short fixed range as you scroll THROUGH that hour's own span
  // (reaching the bottom of the range right as the next hour marker reaches the top of the
  // view), then jumping back up to start the next hour's slide. Plus, independently, a
  // hover-anywhere readout: a dashed line to the left edge and the EXACT time (with minutes) at
  // the cursor's row, linearly interpolated between whichever two chapter-stop bullets bracket
  // it — the spine's vertical spacing is log-scaled, not literal elapsed time, so this is the
  // only place an exact time is ever recoverable from a Y position.
  const [railState, setRailState] = useState<{ label: string; progress: number } | null>(null)
  const hourMarkersRef = useRef(hourMarkers)
  hourMarkersRef.current = hourMarkers
  const railRafRef = useRef(0)
  useEffect(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const measure = () => {
      railRafRef.current = 0
      const markers = hourMarkersRef.current
      if (markers.length === 0) { setRailState(null); return }
      const sTop = scroller.getBoundingClientRect().top + topInset
      let activeIdx = 0
      for (let i = 0; i < markers.length; i++) {
        const el = nodeBlockRefs.current.get(markers[i].id)
        if (!el) continue
        if (el.getBoundingClientRect().top - sTop <= 12) activeIdx = i
        else break
      }
      const activeEl = nodeBlockRefs.current.get(markers[activeIdx].id)
      const nextEl = markers[activeIdx + 1] ? nodeBlockRefs.current.get(markers[activeIdx + 1].id) : null
      let progress = 0
      if (activeEl && nextEl) {
        const a = activeEl.getBoundingClientRect().top - sTop
        const b = nextEl.getBoundingClientRect().top - sTop
        progress = b > a ? Math.max(0, Math.min(1, -a / (b - a))) : 0
      }
      setRailState({ label: markers[activeIdx].label, progress })
    }
    const schedule = () => { if (!railRafRef.current) railRafRef.current = requestAnimationFrame(measure) }
    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      ro.disconnect()
      if (railRafRef.current) cancelAnimationFrame(railRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.nodes.length, zoom, topInset])

  // Hover-anywhere exact-time readout. Tracks the raw cursor point; the render below converts
  // its Y into a real timestamp by linearly interpolating between the two nearest chapter-stop
  // bullets' OWN real anchorStartedAt values (not the hour markers above, which only mark
  // whole-hour boundaries) — "the time between bullets is just linear time between" per direct
  // feedback. Reads from `pointsRef` (the exact small bullet dots TrailConnectorOverlay already
  // draws its lines between, registered under `node:${id}`) rather than nodeBlockRefs (each
  // node's WHOLE row wrapper, including any tangent bullets/dividers stacked above it) — that
  // wrapper's own center can sit well below the actual bullet for a node with extra chrome
  // above it, which was throwing the interpolation off badly enough to read as broken.
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null)
  const hoverInfo = useMemo(() => {
    if (!hoverPoint) return null
    const points: { y: number; t: number }[] = []
    for (const n of detail.nodes) {
      const el = pointsRef.current.get(`node:${n.id}`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      points.push({ y: r.top + r.height / 2, t: n.anchorStartedAt })
    }
    if (points.length === 0) return null
    points.sort((a, b) => a.y - b.y)
    const hy = hoverPoint.y
    let t: number
    if (hy <= points[0].y) t = points[0].t
    else if (hy >= points[points.length - 1].y) t = points[points.length - 1].t
    else {
      let lo = points[0], hi = points[points.length - 1]
      for (let i = 0; i < points.length - 1; i++) {
        if (hy >= points[i].y && hy <= points[i + 1].y) { lo = points[i]; hi = points[i + 1]; break }
      }
      const frac = hi.y > lo.y ? (hy - lo.y) / (hi.y - lo.y) : 0
      t = lo.t + frac * (hi.t - lo.t)
    }
    // `y` stays in raw screen (clientY) coordinates — the readout below is `position: fixed`,
    // same as this file's existing marquee/selection-bar overlays, so no container-relative
    // conversion is needed.
    return {
      y: hy,
      label: new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    }
    // detail.nodes.length (not the array itself) is enough to re-derive on data changes; zoom
    // affects every bullet's screen Y too. hoverPoint is read fresh each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverPoint, detail.nodes.length, zoom])

  // Dim the time rail (both pieces) the closer the cursor gets to any real map element — per
  // direct feedback, it was competing for attention with the actual bullets/lines it sits near.
  // Distance to the nearest registered point (bullets, tangent stubs, row anchors — everything
  // in the shared pointsRef map, not just chapter bullets) rather than just chapter nodes, since
  // ANY nearby element reads as "the cursor is busy with something else right now."
  const timeRailOpacity = useMemo(() => {
    if (!hoverPoint) return 1
    // 70px was too generous relative to how densely bullets/rows are already packed (a normal
    // row is ~20-30px tall) — nearly every point on the map was already within 70px of SOME
    // registered point, so this sat at/near MIN_OPACITY continuously while hovering ANY content,
    // never actually reading as "dims as you approach." 30px is closer to "right on top of a
    // specific bullet," and MIN_OPACITY dropped further so the contrast is unmistakable at 0px.
    const DIM_START_PX = 30
    const MIN_OPACITY = 0.05
    let nearest = Infinity
    for (const el of pointsRef.current.values()) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const d = Math.hypot(cx - hoverPoint.x, cy - hoverPoint.y)
      if (d < nearest) nearest = d
    }
    if (nearest >= DIM_START_PX) return 1
    return MIN_OPACITY + (1 - MIN_OPACITY) * (nearest / DIM_START_PX)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverPoint, detail.nodes.length, zoom])

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
    <TrailInteractionContext.Provider value={{
      isCollapsed: collapse.isCollapsed, toggleCollapsed: collapse.toggle,
      pinnedKey, togglePinned, contentWidth: Math.max(0, (viewportWidth || 700) / zoom - gutterWidth),
    }}>
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
      <div
        ref={scrollContainerRef} onWheel={onWheelZoom} onMouseDown={onMarqueeMouseDown} onContextMenu={onBlankContextMenu}
        onScroll={() => { checkAtBottom(); checkCentered(); saveScrollDebounced() }}
        onMouseMove={(e) => setHoverPoint({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHoverPoint(null)}
        style={{ overflow: 'auto', position: 'relative', flex: 1, minHeight: 0, paddingTop: topInset }}
      >
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
            {/* Main-spine guide line — reinstated. It was removed earlier because the OLD one ran
                the full height at a visible-enough weight that wherever a real spine segment was
                quieter or absent, you saw IT instead, reading as "the spine doesn't fully connect
                / switches color" — a real regression. This one is different: same near-invisible
                0.15-alpha weight as the off-spine guides below it, sitting behind everything —
                at that opacity it can't be mistaken for a spine segment even in the gaps, it just
                answers "i dont see the musical guide line" for the one column (the main reading
                spine itself) every session actually has, unlike the off-spine ones below which
                only appear once there's an actual branch/tangent to guide. */}
            <div
              style={{
                position: 'absolute', top: 0, bottom: 0, left: gutterWidth + SPINE_DOT_INSET,
                width: 1, background: 'rgb(var(--color-surface-4) / 0.15)', pointerEvents: 'none', zIndex: 0,
              }}
            />
            {/* Off-spine (branch/tangent column) guide lines — one per indent level actually
                rendered (maxRenderDepth, which now counts non-branch rows too), each at that
                depth's own `SPINE_LABEL_COL_INSET + INDENT_STEP*(depth+1) + OFFSPINE_DOT_INSET`
                — the exact centre of that column's bullets, which hang inside the spine row's
                label column (see SPINE_LABEL_COL_INSET). Indent guides mark columns that have no
                line of their own to be confused with (the main spine above has a REAL drawn line
                from TrailConnectorOverlay; these columns don't). */}
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
        {groupNodesForRender(detail.nodes, {
          // A stop that has anything hanging off it is never swallowed into a read-through run —
          // that branch is precisely what the map is for.
          hasBranches: (id) => (rowsForNode.get(id)?.length ?? 0) > 0 || sectionsByNodeId.has(id) || annotationsByNodeId.has(id),
        }).map((item) => {
          if (item.type === 'cluster' || item.type === 'run') {
            return (
              <NodeClusterGroup
                key={`${item.type}:${item.nodes[0].id}`}
                variant={item.type === 'run' ? 'run' : 'bounce'}
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
          const sectionsHere = sectionsByNodeId.get(n.id) ?? []
          const annotationsHere = annotationsByNodeId.get(n.id) ?? []
          const owningSection = sectionForNodeId.get(n.id)
          // A node inside a collapsed section is hidden entirely — EXCEPT the one that opens the
          // section, which still has to render its own header (otherwise there'd be no way to
          // expand it again).
          const hiddenBySection = !!owningSection && sectionsHere.length === 0 && collapse.isCollapsed('section', owningSection)
          if (hiddenBySection) return null
          // A stop reached by a branch that's currently folded away goes with it.
          if (sectionsHere.length === 0 && nodeHiddenByFold(n)) return null
          return (
            <div key={n.id} data-trailnode={n.id} onClickCapture={(e) => onTrailNodeClickCapture(e, n.id)}>
            {sectionsHere.map((sec) => (
              <TrailSectionHeader
                key={sec.id} note={sec}
                collapsed={collapse.isCollapsed('section', sec.id)}
                onToggle={() => collapse.toggle('section', sec.id)}
                onChanged={reloadStickies}
              />
            ))}
            {sectionsHere.length > 0 && collapse.isCollapsed('section', sectionsHere[0].id) ? null : (
            <>
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
              onSplitHere={onSplitHere}
              anchorVisits={anchorNodes.get(n.id)}
              onAddSticky={(nodeId, kind) => {
                void window.studyTrail.createNote({
                  // In the merged Everything view detail.session.id is a synthetic placeholder, so
                  // the sticky belongs to the session the ANCHORED STOP is in, not to the view.
                  trailSessionId: nodeById.get(nodeId)?.trailSessionId ?? detail.session.id,
                  kind, anchorNodeId: nodeId, orderIndex: nodeOrderIndex.get(nodeId) ?? 0,
                }).then(reloadStickies)
              }}
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
            {annotationsHere.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: gutterWidth + SPINE_LABEL_COL_INSET + INDENT_STEP }}>
                {annotationsHere.map((a) => (
                  <TrailAnnotation
                    key={a.id} note={a} onChanged={reloadStickies} zoom={zoom}
                    resolveAnchor={(clientY) => nodeIdAboveY(clientY)}
                  />
                ))}
              </div>
            )}
            {showGapDivider && <GapDivider gapMs={gapToNextMs!} gutterWidth={gutterWidth} />}
            </>
            )}
            </div>
          )
        })}
        {detail.nodes.length === 0 && (
          <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>Nothing recorded yet — navigate around the app while this session is live.</div>
        )}

        {promptConn && (
          // key={promptConn.id} — without it, clicking a pencil icon on a DIFFERENT connection
          // while this popup is already open just re-renders the same component instance with a
          // new `connection` prop; its note/tie fields are only ever seeded from that prop in
          // useState's initializer (run once, on mount), so they'd keep showing the PREVIOUS
          // connection's stale ties/note under the new one's own title. The key forces a real
          // remount whenever the connection changes.
          <ReasonPromptPopover
            key={promptConn.id}
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

        {/* Time rail — left edge of the map viewport. Replaces the old top-right "current hour"
            badge (per direct feedback, "something actually on the map... on the left side").
            Two independent pieces, both `position: fixed` off the scroll container's own live
            rect (same pattern as the marquee/selection-bar overlays below):
             1. The current-hour label, which slides down a short fixed range as you scroll
                through that hour's own span and jumps back up when the next hour marker takes
                over — a real "progress through this hour" motion, not just a static readout.
             2. A dashed line to the left edge + the exact time (with minutes) at the cursor's
                row, only while hovering anywhere over the timeline — see hoverInfo above for the
                linear-interpolation-between-bullets math. */}
        {(() => {
          const scrollRect = scrollContainerRef.current?.getBoundingClientRect()
          if (!scrollRect) return null
          const RAIL_TOP = 16
          const RAIL_SLIDE_RANGE = 44
          return (
            <>
              {railState && (
                <div style={{
                  position: 'fixed', left: scrollRect.left + 10,
                  top: scrollRect.top + RAIL_TOP + railState.progress * RAIL_SLIDE_RANGE,
                  zIndex: 30, pointerEvents: 'none',
                  fontSize: 11, fontWeight: 700, letterSpacing: '.03em', color: 'rgb(var(--color-text-muted))',
                  background: 'rgb(var(--color-surface-1) / 0.85)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                  border: '1px solid rgb(var(--color-surface-4) / 0.6)', borderRadius: 6, padding: '3px 7px',
                  opacity: timeRailOpacity,
                  transition: 'top 220ms ease, opacity 120ms ease',
                }}>
                  {railState.label}
                </div>
              )}
              {hoverInfo && (
                <>
                  <div style={{
                    position: 'fixed', left: scrollRect.left, top: hoverInfo.y,
                    width: scrollRect.width, height: 0, zIndex: 29, pointerEvents: 'none',
                    borderTop: '1px dashed rgb(var(--color-accent) / 0.45)',
                    opacity: timeRailOpacity, transition: 'opacity 120ms ease',
                  }} />
                  <div style={{
                    position: 'fixed', left: scrollRect.left + 10, top: hoverInfo.y, transform: 'translateY(-50%)',
                    zIndex: 30, pointerEvents: 'none',
                    fontSize: 11, fontWeight: 700, color: 'rgb(var(--color-accent))',
                    background: 'rgb(var(--color-surface-1) / 0.92)', border: '1px solid rgb(var(--color-accent) / 0.4)',
                    borderRadius: 6, padding: '3px 7px',
                    opacity: timeRailOpacity, transition: 'opacity 120ms ease',
                  }}>
                    {hoverInfo.label}
                  </div>
                </>
              )}
            </>
          )
        })()}

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
    {blankMenu && (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: blankMenu.y, left: blankMenu.x, zIndex: 10001, minWidth: 168,
          background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
          borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', padding: 5,
        }}
      >
        <button className="trail-ctx-btn" onClick={() => addStickyAt(blankMenu.nodeId, 'annotation')} style={blankMenuBtnStyle}>
          <StickyNote size={14} style={{ opacity: 0.85 }} /> Add a note here
        </button>
        <button className="trail-ctx-btn" onClick={() => addStickyAt(blankMenu.sectionNodeId, 'section')} style={blankMenuBtnStyle}>
          <Heading size={14} style={{ opacity: 0.85 }} /> Add a section here
        </button>
      </div>
    )}
    </TrailInteractionContext.Provider>
    </HoverDisabledContext.Provider>
  )
}
