// Pure eligibility + placement logic for the Study Trail "Why'd you go to <ref> from <ref>?"
// arrival prompt (StudyTrailArrivalPrompt.tsx). Factored out of the component so the rules
// governing WHEN/WHERE it may show are testable in isolation, and so the component itself
// never has to encode "is this an appropriate place to ask that question" inline.
//
// Background: the prompt used to be driven purely by `pendingArrivalPrompt` (a TrailConnection)
// with no check at all on what the user was actually looking at by the time the (dwell-delayed)
// arrival fires — so it could pop up over Notes tabs, Settings, a Search tab, or any other
// surface where "why did you arrive here" is meaningless. This module is the fix: a single pure
// gate the component consults on every render-relevant change, plus a placement function that
// refuses to render the toast at all when there's no safe slot for it.
import type { NavOrigin } from '@/lib/verseNavigation'

/** Normalized navigation-kind taxonomy for arrival-prompt purposes — coarser than NavOrigin's own
 *  ~15 kinds (which encode WHERE a jump came from for Study Trail's map/reason text), because
 *  eligibility only cares about one question: does this kind of navigation carry a meaningful
 *  "why did you go here" story at all? 'restore' and 'programmatic' have no NavOrigin equivalent
 *  today (session/tab restore never goes through navigateToVerse — see studyTrailSlice.ts's
 *  installStudyTrailRecorder comment), but are kept as first-class values here so any future
 *  programmatic-navigation path is ineligible by construction rather than by omission. */
export type ArrivalNavigationKind =
  | 'cross-ref'          // TSKe/Classic/notes cross-reference row
  | 'search-result'      // Scripture search / floating search result
  | 'reference-link'     // a verse ref clicked inside a note, a verse popover, a specific reference typed/picked
  | 'study-navigation'   // any other deliberate, verse/chapter-targeted jump (AI Lookup, lexicon occurrence, manual picker)
  | 'sequential'         // plain prev/next chapter arrow — the reading spine, not a tangent
  | 'tab-switch'         // clicking an already-open scripture tab
  | 'history'            // History modal reopen / back-forward
  | 'restore'            // session/workspace restore on launch
  | 'programmatic'       // any non-user-initiated navigation
  | 'other'

/** Kinds for which "why did you jump here?" is never a meaningful question, regardless of
 *  surface, staleness, or anything else — a plain next-chapter read, a tab switch, reopening
 *  something from History, or any restore/programmatic navigation. */
const INELIGIBLE_KINDS: ReadonlySet<ArrivalNavigationKind> = new Set([
  'sequential', 'tab-switch', 'history', 'restore', 'programmatic',
])

/** Maps a raw NavOrigin kind (as captured by the recorder at the moment it records the
 *  connection — see commitChapterArrival in studyTrailSlice.ts) onto the coarser taxonomy
 *  above. Exported so the recorder and tests share exactly one mapping. */
export function navOriginKindToArrivalKind(kind: NavOrigin['kind']): ArrivalNavigationKind {
  switch (kind) {
    case 'cross-ref': return 'cross-ref'
    case 'search-result': return 'search-result'
    case 'note-wikilink':
    case 'verse-popover':
      return 'reference-link'
    case 'book-chapter-picker':
    case 'ai-lookup':
    case 'lexicon-occurrence':
    case 'compare-column':
      return 'study-navigation'
    case 'sequential-nav': return 'sequential'
    case 'tab-switch': return 'tab-switch'
    case 'history-revisit': return 'history'
    case 'other': return 'other'
    default: return 'other'
  }
}

/** The ONLY surface the arrival prompt may ever render over: a Scripture-reader (Bible) tab in
 *  the Scripture space. Every other space/tab combination (Notes, Lexicon, Settings, Search,
 *  YouTube, a PDF/tags/history/calendar tab, even a non-'bible' tab WITHIN the Scripture space)
 *  is out of bounds. */
export interface ArrivalSurface {
  space: string | null
  tabType: string | null
}

export interface ArrivalRef {
  bookId: string
  chapter: number
}

/** Expire an armed prompt after this long — a dwell-scheduled, async-recorded arrival can sit
 *  "pending" for a little while after the moment it actually happened; past this window, asking
 *  "why did you just go there?" no longer matches what the user is doing. Also enforced
 *  actively: the component clears itself once a pending prompt crosses this age, not only on
 *  next unrelated render. */
export const ARRIVAL_PROMPT_MAX_AGE_MS = 20_000

export interface ArrivalEligibilityContext {
  navigationKind: ArrivalNavigationKind
  /** False for any non-user-initiated navigation (restore, programmatic tab sync, etc.). Real
   *  NavOrigin-driven navigations are always user-initiated by construction; this exists so a
   *  future caller that forces a navigation kind without going through the normal UI path still
   *  fails safe instead of accidentally qualifying. */
  userInitiated: boolean
  surface: ArrivalSurface
  fromRef: ArrivalRef | null
  toRef: ArrivalRef | null
  /** When the connection was recorded (TrailConnection.createdAt / navAt). */
  recordedAt: number
  /** Evaluation time — always `Date.now()` from the live caller; a fixed value in tests. */
  now: number
}

export interface ArrivalEligibilityResult {
  eligible: boolean
  reason: string
}

function sameChapter(a: ArrivalRef, b: ArrivalRef): boolean {
  return a.bookId === b.bookId && a.chapter === b.chapter
}

/** The single gate StudyTrailArrivalPrompt.tsx consults before rendering anything. Pure — no
 *  store reads, no DOM, no side effects — so every rule is independently testable. */
export function arrivalPromptEligibility(ctx: ArrivalEligibilityContext): ArrivalEligibilityResult {
  if (!ctx.userInitiated) {
    return { eligible: false, reason: 'navigation was not user-initiated (restore/programmatic)' }
  }
  if (INELIGIBLE_KINDS.has(ctx.navigationKind)) {
    return { eligible: false, reason: `navigation kind "${ctx.navigationKind}" has no meaningful "why" to ask about` }
  }
  if (ctx.surface.space !== 'scripture' || ctx.surface.tabType !== 'bible') {
    return { eligible: false, reason: 'active surface is not a Scripture reader tab' }
  }
  if (!ctx.fromRef || !ctx.toRef) {
    return { eligible: false, reason: 'origin or destination is not a resolved Scripture reference' }
  }
  if (sameChapter(ctx.fromRef, ctx.toRef)) {
    return { eligible: false, reason: 'origin and destination are the same chapter' }
  }
  const age = ctx.now - ctx.recordedAt
  if (age < 0 || age > ARRIVAL_PROMPT_MAX_AGE_MS) {
    return { eligible: false, reason: 'arrival context is stale' }
  }
  return { eligible: true, reason: 'eligible scripture-to-scripture navigation' }
}

// ───────────────────────────── Placement ─────────────────────────────

/** Collision-aware placement inputs — every other floating element the prompt must stay clear
 *  of, expressed as the simple rectangles/insets the main window already tracks (see
 *  StudyTrailArrivalPrompt.tsx's existing rightPx/bottomPx derivation, which this formalizes and
 *  makes independently testable rather than inlined JSX math). */
export interface ArrivalPlacementInputs {
  viewportWidth: number
  viewportHeight: number
  pillWidth: number
  pillHeight: number
  /** The Scripture inspector / right-hand side panel width (store's bibleRightPanelWidth); the
   *  pill slides left by this much (+ a gap) so it never sits on top of it. */
  rightPanelWidth: number
  /** Height already claimed at the bottom-right corner by other floating UI (the audio player,
   *  StudyTrailSplitToast, a note editor's word-count footer, the verse-selection action bar) —
   *  the pill stacks above this. */
  bottomReservedHeight: number
  /** Height of the top toolbar — kept clear of so a tall expanded pill can never grow up and
   *  under it. */
  toolbarHeight: number
  /** The minimum width the central reading column needs left uncovered. If placing the pill
   *  would eat into more than this, there is no safe slot and the caller must suppress the
   *  overlay entirely rather than sit on top of the Scripture text. */
  minReadingColumnWidth: number
}

const PLACEMENT_MARGIN = 16
const PLACEMENT_GAP = 12

export interface ArrivalPlacement {
  right: number
  bottom: number
}

/** Computes a bottom-trailing anchor point for the prompt, or null when no safe slot exists (the
 *  caller must then render nothing rather than overlap the reading column, the toolbar, or
 *  another floating element). Anchored bottom-trailing (right in LTR) of the Scripture reader
 *  area, sliding further left/up as the inspector panel / other bottom-right UI claim space. */
export function computeArrivalPlacement(inputs: ArrivalPlacementInputs): ArrivalPlacement | null {
  const {
    viewportWidth, viewportHeight, pillWidth, pillHeight,
    rightPanelWidth, bottomReservedHeight, toolbarHeight, minReadingColumnWidth,
  } = inputs
  const right = PLACEMENT_MARGIN + (rightPanelWidth > 0 ? rightPanelWidth + PLACEMENT_GAP : 0)
  const bottom = PLACEMENT_MARGIN + bottomReservedHeight
  const availableWidth = viewportWidth - right - pillWidth
  if (availableWidth < minReadingColumnWidth) return null
  const availableHeight = viewportHeight - bottom - pillHeight - toolbarHeight
  if (availableHeight < 0) return null
  return { right, bottom }
}
