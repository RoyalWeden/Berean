// Study Trail domain types — shared between the main window (recording) and the Study Trail
// window (display). See /Users/roywe/.claude/plans/create-a-full-plan-composed-lark.md for
// the full design. Naming is prefixed `Trail*` throughout to avoid colliding with the
// unrelated tab-layout `Session`/`sessions` concept already in src/store/index.ts.

export type ClarityTier = 1 | 2 | 3 // 1 = 100% clear, 2 = softly inferred, 3 = ambiguous
export type ConnectionWeight = 'full' | 'glance'
export type ConnectionKind = 'chapter' | 'lexicon' | 'note' | 'video' | 'compare'
export type TrailSessionStatus = 'live' | 'paused' | 'ended'
export type StrongsDepth = 'click' | 'occurrences' | 'related'

export interface TrailSession {
  id: string
  name: string
  status: TrailSessionStatus
  possiblyAccidental: boolean
  recapText?: string
  recapUserEdited: boolean
  createdAt: number
  updatedAt: number
}

export interface TrailNode {
  id: string
  trailSessionId: string
  bookId: string
  chapter: number
  orderIndex: number
  anchorStartedAt: number
  anchorEndedAt?: number
  cachedSubnote?: string
  originLabel?: string
  /** Set only on a PROMOTED revisit node — points back to the original node for this chapter.
   *  See electron/db/berean.ts's v29 migration comment for the full "why". */
  revisitOfNodeId?: string
  /** The branch-chain analogue of revisitOfNodeId (v31) — reserved for a future "this chapter
   *  was reached by a substantial branch chain" flag, kept as a separate column so it's never
   *  ambiguous with a same-chapter revisit backlink. Not currently written by any code path —
   *  the equivalent "chain got long enough to flag" signal is computed live from chainDepth at
   *  render time instead (see MapView.tsx), no persisted fact needed for that case. */
  promotedFromConnectionId?: string
  /** The translation/text this chapter was actually read in at arrival (v32) — 'kjva', 'lxx',
   *  or a dedicated-translation id (enoch, jubilees, etc). Always populated going forward,
   *  independent of cachedSubnote's mid-visit-switch note. */
  translation?: string
}

export interface TrailConnection {
  id: string
  trailSessionId: string
  fromNodeId: string
  toKind: ConnectionKind
  toBookId?: string
  toChapter?: number
  toVerse?: number
  toStrongsNum?: string
  toNoteId?: string
  toVideoId?: string
  clarityTier: ClarityTier
  reasonText?: string
  reasonTags: string[]
  versePinFrom?: number
  versePinTo?: number
  /** Verse(s) pinned on the chapter the user LEFT (as opposed to versePinFrom/To above, which
   *  pin the destination) — see the v30 migration comment in electron/db/berean.ts. */
  originVersePinFrom?: number
  originVersePinTo?: number
  weight: ConnectionWeight
  strongsDepth?: StrongsDepth
  clusterId?: string
  dismissedPromptAt?: number
  createdAt: number
  /** Branch chaining (v31) — when set, this connection's TRUE immediate predecessor is another
   *  connection (a prior lexicon lookup, or same-chapter branch), not fromNodeId's chapter
   *  directly. fromNodeId is still always populated (the chain's root chapter), so every
   *  fromNodeId-keyed lookup keeps working unmodified. See electron/db/berean.ts's v31 comment. */
  fromConnectionId?: string
  /** 0 = hangs directly off a chapter node (unchanged meaning from before v31); 1+ = hops deep
   *  in a branch chain. */
  chainDepth: number
  /** Destination range end, parallel to toVerse — a TSKe range ref (e.g. Isa 52:13-53:12)
   *  previously only ever recorded its start verse. */
  toVerseEnd?: number
}

export interface TrailPausedInterval {
  pausedAt: number
  resumedAt?: number
}

export interface TrailSessionDetail {
  session: TrailSession
  nodes: TrailNode[]
  connections: TrailConnection[]
  pausedIntervals: TrailPausedInterval[]
}

export interface TrailConnectionWithSession extends TrailConnection {
  sessionName: string
}

/** Cross-window "please navigate to this" payload — sent from the Study Trail window (or any
 *  secondary window) to the main window via window.app.navigateMainToRef, and received there
 *  by onNavigateToRef. Either a chapter ref or a Strong's number, never both. */
export type TrailNavRefPayload =
  | { kind: 'chapter'; bookId: string; chapter: number; verse?: number; newTab: boolean }
  | { kind: 'lexicon'; strongsNum: string; newTab: boolean }
