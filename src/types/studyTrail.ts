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
  weight: ConnectionWeight
  strongsDepth?: StrongsDepth
  clusterId?: string
  dismissedPromptAt?: number
  createdAt: number
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
