// Study Trail domain types — shared between the main window (recording) and the Study Trail
// window (display). See /Users/roywe/.claude/plans/create-a-full-plan-composed-lark.md for
// the full design. Naming is prefixed `Trail*` throughout to avoid colliding with the
// unrelated tab-layout `Session`/`sessions` concept already in src/store/index.ts.

export type ClarityTier = 1 | 2 | 3 // 1 = 100% clear, 2 = softly inferred, 3 = ambiguous
export type ConnectionWeight = 'full' | 'glance'
// 'pdf' and 'search' are new; 'note' and 'video' existed in the schema since v28 but nothing ever
// WROTE them until the side-stop recorder (studyTrailSlice.recordSideStop) was added. `to_kind` is
// a free-text column, so widening this union needs no migration.
export type ConnectionKind = 'chapter' | 'lexicon' | 'note' | 'video' | 'compare' | 'pdf' | 'search'
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
  /** Manual position in the session rail (v40). undefined = not hand-placed; those fall back to
   *  plain recency ordering behind everything that has been. */
  sortOrder?: number
}

/** A sticky note or section header placed on the map (v39). A 'section' sits ON the spine between
 *  stops and owns everything below it until the next one; an 'annotation' is a free, resizable
 *  sticky pinned beside a stop. `noteId` is the "real Berean note?" switch: undefined means the
 *  body lives in the trail only, set means the notes table owns the body and it syncs to the
 *  vault like any other note. */
export interface TrailStickyNote {
  id: string
  trailSessionId: string
  kind: 'section' | 'annotation'
  anchorNodeId?: string
  orderIndex: number
  title?: string
  body: string
  width?: number
  height?: number
  noteId?: string
  color?: string
  createdAt: number
  updatedAt: number
}

/** A tag applied to whole trail sessions (v40) — the session-level twin of verse_tags. */
export interface TrailTag {
  id: string
  name: string
  color?: string
  sortOrder?: number
  sessionIds: string[]
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
  /** Shared across a rapid run of promoted revisits of the SAME chapter (v33) — lets MapView
   *  collapse "bounced back to X three times in 40s" into one summary block instead of showing
   *  every promotion as its own full node. Node-level twin of TrailConnection.clusterId. */
  clusterId?: string
  /** v36 — a horizontal divider on the main spine at this node, marking a deliberate break
   *  between topics rather than a mere chapter change. Set from the "ask why" popup's "new
   *  topic" checkbox, or toggled later from the Study Trail window. */
  isTopicBreak: boolean
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
  /** v34, superseded by tiesFrom/tiesTo below (v35) — kept only so old rows still round-trip;
   *  no longer written to by anything. */
  ties: string[]
  /** The user's OWN free-text note (v35) — fully separate from reasonText (the recorder's
   *  auto-inferred phrase, e.g. "Strong's word · G26"). Always blank until the user actually
   *  types one; never pre-filled from, or mixed into, the auto-inferred text. */
  userNote?: string
  /** Freely-typed reference strings ("Mark 13:1-5") tying this connection to verse(s) in the
   *  chapter LEFT / the chapter LANDED ON, respectively — two labeled sections in the note
   *  popup, replacing the single combined `ties` list (v34) for new entries. */
  tiesFrom: string[]
  tiesTo: string[]
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
  /** v36 — user-marked tangent/branch: this connection (and, by convention, everything chained
   *  after it via fromConnectionId until a later isBranchReturn) is NOT part of the main study
   *  branch. Set from the "ask why" popup's minimal checkbox, editable later from the Study
   *  Trail window (reclassify a tangent as having been the real main branch, or vice versa). */
  isBranch: boolean
  /** v36 — marks that this connection is where a previously-flagged tangent rejoins the main
   *  branch. Only meaningful alongside an earlier isBranch=true connection in the same chain. */
  isBranchReturn: boolean
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

/** One result from the Study Trail's own search — deliberately covers every kind of thing the
 *  trail holds (sessions, chapter stops, connections, sticky notes), not just connection
 *  reasons, per direct feedback asking for "searching through all study trail things easily". */
export interface TrailSearchHit {
  kind: 'session' | 'stop' | 'connection' | 'note'
  id: string
  sessionId: string
  sessionName: string
  title: string
  snippet?: string
  bookId?: string
  chapter?: number
  strongsNum?: string
  anchorNodeId?: string
  at: number
}

/** A subject you've been chasing across sessions — the Threads tab's unit. One per book actually
 *  studied, plus one per distinct Strong's number looked up. */
export interface TrailThread {
  id: string
  kind: 'book' | 'strongs'
  label: string
  bookId?: string
  strongsNum?: string
  stops: number
  chapters: number
  firstAt: number
  lastAt: number
  sessions: Array<{ id: string; name: string }>
}

/** Cross-window "please navigate to this" payload — sent from the Study Trail window (or any
 *  secondary window) to the main window via window.app.navigateMainToRef, and received there
 *  by onNavigateToRef. Either a chapter ref or a Strong's number, never both. */
export type TrailNavRefPayload =
  | { kind: 'chapter'; bookId: string; chapter: number; verse?: number; newTab: boolean }
  | { kind: 'lexicon'; strongsNum: string; newTab: boolean }
