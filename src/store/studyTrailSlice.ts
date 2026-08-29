// Study Trail's own small Zustand store — deliberately NOT merged into the main
// src/store/index.ts monolith (2500+ lines, single `create()` call, no existing
// slice-composition pattern to hook into cleanly). A separate store is simpler and lower-risk
// here, and nothing about Zustand requires a single global store. Prefixed `TrailSession`/
// `useStudyTrailStore` throughout to avoid colliding with the main store's unrelated
// `Session`/`sessions`/`currentSessionId` (tab-layout workspaces — a completely different
// concept, see src/store/index.ts:114, 539-540).
import { create } from 'zustand'
import type { NavOrigin, NavRecorder } from '@/lib/verseNavigation'
import { setNavRecorder } from '@/lib/verseNavigation'
import type { ClarityTier, TrailSessionStatus, TrailConnection } from '@/types/studyTrail'
import { bookChapterVerseLabel } from '@/lib/parseRef'

// The implicit "Loose stops" bucket — navigation is recorded here when the user has NOT created
// a session of their own. Never shown in the session rail (listSessions filters it out); only
// surfaces in the merged Everything timeline. Per direct feedback: "i don't want an untitled
// study session created if i didn't create one... if the user continues to study, then these
// things are just put in everything". Kept in sync with the same constant in
// electron/ipc/studyTrail.ts.
export const LOOSE_SESSION_ID = '__loose_stops__'

interface StudyTrailState {
  currentTrailSessionId: string | null
  trailSessionStatus: TrailSessionStatus | null
  // The current "main bullet" — the chapter the user is presently anchored on. A navigation
  // to this SAME book/chapter just updates its cached subnote (still reading here); a
  // navigation elsewhere writes a connection and becomes the new anchor.
  currentAnchorNodeId: string | null
  currentAnchorBookId: string | null
  currentAnchorChapter: number | null
  currentAnchorVerseCount: number
  // When the current anchor is a REOPENED (not freshly-created) node, these track this
  // particular visit's own start time and whether it's a reopen at all — read at the moment
  // the user leaves to decide whether this was substantial enough re-engagement to PROMOTE
  // into its own new spine node (see the recorder's promotion check, and the v29 migration
  // comment in electron/db/berean.ts for the full "why").
  currentAnchorActivatedAt: number | null
  currentAnchorIsRevisit: boolean
  // `${bookId}:${chapter}` → nodeId, for every chapter that already has a node in THIS
  // session. The spine-drift fix: before recording a fresh chapter navigation as a brand-new
  // node, the recorder checks this index — a match means "already visited," so the existing
  // node is reopened (studyTrail:reopenNode) instead of a duplicate being created, which is
  // what lets a lexicon/search detour that lands back on an already-read chapter resume the
  // real spine instead of permanently dragging the anchor through the detour. Updated to
  // point at a PROMOTED node once one exists for that chapter, so a third visit resumes from
  // the most recent position, not the original.
  sessionNodeIndex: Record<string, string>

  // Tangent depth/parent lookup — `${bookId}:${chapter}:${verse}` → the tangent connection whose
  // OWN destination is that verse, plus its depth. Per the confirmed branch/tangent model: a new
  // verse-specific branch click chains off whichever EXISTING tangent bullet already represents
  // its origin verse (one level deeper than that bullet), or — if no tangent bullet represents
  // that verse yet — hangs directly off the current main anchor as a fresh sibling. This
  // replaces the old single "most recent branch" pointer (`currentBranchTipConnectionId` below),
  // which always chained onto whatever happened most recently regardless of which verse a new
  // click actually came from — the reported bug where two sibling tangents off the same verse
  // (e.g. Isaiah 1:2 and Jeremiah 7:3, both clicked from Deuteronomy 32:1) incorrectly nested one
  // under the other instead of sitting side by side. Cleared whenever a plain/non-tangent hop
  // returns to depth 0 (a fresh tangent group starts clean); kept across tangent hops within the
  // same excursion so later sibling/nested lookups keep resolving correctly.
  sessionTangentIndex: Record<string, { connectionId: string; depth: number }>

  // Branch chaining (v31) — the most recent BRANCH connection recorded off the current anchor
  // that is itself eligible to be chained off (a lexicon click/related-word/occurrence, or a
  // same-chapter branch) — null means "the anchor's chapter itself is the nearest parent."
  // "Mid-branch" is defined precisely as this being non-null. Reset to null (alongside the
  // other currentAnchor* fields) whenever a genuinely new chapter node is created/reopened —
  // arriving at a chapter always means "back at depth 0," full stop, closing out whatever chain
  // led there. See recordLexiconConnection and the sameChapter branch below for how this
  // advances, and the recorder's different-chapter arrival block for how it resets.
  currentBranchTipConnectionId: string | null
  currentBranchTipDepth: number
  currentBranchTipActivatedAt: number | null

  // v36 — "in branch mode" persists ACROSS chapter arrivals (unlike currentBranchTip* above,
  // which normally resets to depth 0 on every new chapter node). A cross-ref jump always starts
  // (or continues) a branch — per direct feedback, once off on a tangent, everything recorded
  // after it stays part of that branch until the user explicitly marks a return to main, not
  // just until the next chapter change. Also set (best-effort — the "ask why" popup is
  // non-blocking/async, so this only actually engages if the user answers before navigating
  // further) when the user checks "this is a tangent" in the popup.
  currentlyInBranch: boolean

  // A just-created chapter-to-chapter connection waiting on the opt-in "why did you jump here?"
  // arrival prompt (Settings → studyTrailAskChapterJumpReason) — set right after the recorder
  // successfully writes the connection, read by a popover mounted in the main Bible-reader
  // window (src/App.tsx), per the plan's "auto-prompt in the main window" note. Only ever one
  // pending at a time; a later arrival replaces rather than queues. Unlike the tier-3 "?"
  // badge's dismissPrompt (permanent — dismissed_prompt_at is written to the DB), closing this
  // WITHOUT saving writes nothing at all: it's a one-time nudge for this specific arrival, not
  // a persistent per-connection state, so a later jump to the same pair of chapters still gets
  // its own fresh prompt rather than being permanently silenced.
  pendingArrivalPrompt: TrailConnection | null
  // The node the connection above actually LANDED on — needed alongside pendingArrivalPrompt so
  // the popup's "new topic" checkbox (a node-level flag, not a connection-level one) has
  // somewhere to write to.
  pendingArrivalNodeId: string | null
  clearPendingArrivalPrompt: () => void

  startTrailSession: (name: string) => Promise<void>
  pauseTrailSession: () => Promise<void>
  resumeTrailSession: () => Promise<void>
  renameTrailSession: (name: string) => Promise<void>
  endTrailSession: () => Promise<void>
  deleteTrailSession: (trailSessionId: string) => Promise<void>
  deleteTrailSessions: (trailSessionIds: string[]) => Promise<void>
  /** Makes an EXISTING session (e.g. a previously-ended one the user wants to pick back up)
   *  the active one — pausing whatever was active first, so two sessions are never live at
   *  once. Restores sessionNodeIndex and the still-open anchor (if any) so recording resumes
   *  correctly rather than starting the reopened session with no memory of its own nodes. */
  activateExistingSession: (trailSessionId: string) => Promise<void>
  /** Recording should never require the user to have created a session first — a session is
   *  now just a named label/view over the continuous trail, not a gate on capture. Called
   *  lazily by the recorder the first time it sees no live session; auto-provisions an
   *  "Untitled study" session (same as clicking "+ New session" would) so navigation is never
   *  silently dropped just because nobody clicked Start first. Resolves to the live session id,
   *  reusing whatever's already live/in-flight rather than racing multiple auto-creates. */
  ensureLiveSession: () => Promise<string>
}

/** cross-ref/search/etc. → clarity tier, per the plan's clarity-tier rules. Kept here (not on
 *  NavOrigin itself) since it's Study Trail's own interpretation of navigation metadata that
 *  verseNavigation.ts otherwise knows nothing about. */
export function tierForOrigin(origin: NavOrigin): ClarityTier {
  switch (origin.kind) {
    case 'cross-ref': return origin.source === 'notes' ? 2 : 1
    case 'lexicon-occurrence': return 1
    case 'ai-lookup': return 1
    case 'search-result': return 2
    case 'note-wikilink': return 2
    case 'book-chapter-picker': return 3
    case 'verse-popover': return 2
    case 'compare-column': return 1
    case 'history-revisit': return 2
    case 'sequential-nav': return 1
    case 'tab-switch': return 2
    case 'other': return 3
  }
}

// One shared "via {text}" sentence shape (see OriginBadgeLine/TrailNodeHoverContent) covers
// every one of the app's ~150+ concrete navigation scenarios cleanly, because they all reduce
// to just these ~15 NavOrigin KINDS — a bespoke phrasing/icon per literal scenario was never
// actually needed, only per KIND, and every kind already threads its own real reasonText/tags
// through here. Every case below reads naturally after "via " (see OriginBadgeLine).
export function reasonForOrigin(origin: NavOrigin, fromRef?: { bookId: string; chapter: number }): { text?: string; tags: string[] } {
  // The full "Deuteronomy 32:1" reference when the origin chapter is known (every real call
  // site now passes fromRef — see commitChapterArrival/the same-chapter branch below), falling
  // back to the old bare "v.1" only when it isn't (kept so the locked verbatim-text tests below,
  // which call this with no fromRef, still pass unchanged). Per direct feedback: "this info in
  // the note... should actually say the book chapter and verse like 'Deuteronomy 32:1'."
  const fromLabel = (v: number) => fromRef ? bookChapterVerseLabel(fromRef.bookId, fromRef.chapter, v) : `v.${v}`
  switch (origin.kind) {
    case 'cross-ref': {
      // fromVerse — when known (the right panel's specific active verse, not just "some verse
      // in the chapter") — is appended so the origin badge/row reads e.g. "a tske cross-
      // reference (from Deuteronomy 32:1)" instead of just naming the destination chapter with
      // no indication of which specific verse on the ORIGIN side actually pointed here. Per
      // Michael: "it should indicate that i went from a specific verse in matthew 5 cross ref
      // to isaiah 52 or whatever i clicked." Appended, not prepended/replacing — origin.reason
      // (when present) must still come through verbatim, see the locked unit test below.
      const base = origin.reason ?? `a ${origin.source} cross-reference`
      const text = origin.fromVerse != null ? `${base} (from ${fromLabel(origin.fromVerse)})` : base
      return { text, tags: [`cross-ref:${origin.source}`] }
    }
    case 'lexicon-occurrence': return { text: `Strong's ${origin.strongsNum} occurrence`, tags: ['lexicon'] }
    // ai-lookup's text is the raw question verbatim (not decorated) — it's tier 1 and shown
    // directly as the connection's reason elsewhere, where "AI Lookup:" would just be noise
    // next to a question mark already reading as a question. fromVerse (a nested cross-ref
    // result) appends the same way cross-ref's does — see the locked verbatim-question test
    // below, which has no fromVerse and must stay untouched.
    case 'ai-lookup': return { text: origin.fromVerse != null ? `${origin.question} (from ${fromLabel(origin.fromVerse)})` : origin.question, tags: ['ai-lookup'] }
    case 'search-result': return { text: `a search for "${origin.query}"`, tags: ['search'] }
    case 'note-wikilink': return { text: `a link in note "${origin.noteTitle}"`, tags: ['note'] }
    // No pre-filled text on purpose — book-chapter-picker is the one genuinely ambiguous tier-3
    // origin; inventing a reason here would defeat the point of ever prompting for one.
    case 'book-chapter-picker': return { tags: ['manual'] }
    case 'verse-popover': return { text: 'a verse popover', tags: ['popover'] }
    case 'compare-column': return { text: 'viewing side-by-side in Compare', tags: ['compare'] }
    case 'history-revisit': return { text: 'revisiting from History', tags: ['history'] }
    case 'sequential-nav': return { text: 'reading onward', tags: ['reading'] }
    case 'tab-switch': return { text: 'switching to an already-open tab', tags: ['tab-switch'] }
    case 'other': return { text: origin.label ?? 'navigation', tags: [] }
  }
}

export const useStudyTrailStore = create<StudyTrailState>()((set, get) => ({
  currentTrailSessionId: null,
  trailSessionStatus: null,
  currentAnchorNodeId: null,
  currentAnchorBookId: null,
  currentAnchorChapter: null,
  currentAnchorVerseCount: 0,
  currentAnchorActivatedAt: null,
  currentAnchorIsRevisit: false,
  currentBranchTipConnectionId: null,
  currentBranchTipDepth: 0,
  currentBranchTipActivatedAt: null,
  currentlyInBranch: false,
  pendingArrivalPrompt: null, pendingArrivalNodeId: null,
  clearPendingArrivalPrompt: () => set({ pendingArrivalPrompt: null, pendingArrivalNodeId: null }),
  sessionNodeIndex: {}, sessionTangentIndex: {},

  startTrailSession: async (name: string) => {
    // Never leave a previous session dangling with status='live' forever while a new one
    // starts recording — two sessions being "active" at once was possible before this (the
    // old row just sat orphaned in the DB, still showing a green "live" dot in the rail even
    // though nothing was recording to it anymore).
    const prevId = get().currentTrailSessionId
    // Never pause the implicit loose bucket — it stays live in the DB as the fallback target
    // for whenever no user session is active. Only a real prior session gets paused.
    if (prevId && prevId !== LOOSE_SESSION_ID) await window.studyTrail.pauseSession(prevId).catch(() => {})
    const session = await window.studyTrail.startSession(name)

    // Seed the session's first spine node from whatever chapter is ACTUALLY open right now in
    // the main window, so a new session doesn't start on a totally blank slate if you're
    // already mid-study when you create it. The main window's tab state lives in ITS OWN
    // separate renderer store (invisible from here), so this asks it directly via a round-trip
    // IPC (getActiveScriptureRef) — best-effort: if the main window doesn't answer in time, or
    // there's no scripture tab open at all, the session just starts empty as before.
    const activeRef = await window.app.getActiveScriptureRef?.().catch(() => null)
    let seedNodeId: string | null = null
    if (activeRef) {
      const seedNode = await window.studyTrail.addNode({
        trailSessionId: session.id, bookId: activeRef.bookId, chapter: activeRef.chapter, orderIndex: Date.now(),
      }).catch(() => null)
      seedNodeId = seedNode?.id ?? null
    }

    set({
      currentTrailSessionId: session.id, trailSessionStatus: 'live', currentAnchorActivatedAt: seedNodeId ? Date.now() : null,
      currentAnchorNodeId: seedNodeId, currentAnchorBookId: seedNodeId ? activeRef!.bookId : null,
      currentAnchorChapter: seedNodeId ? activeRef!.chapter : null, currentAnchorIsRevisit: false,
      currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null,
      sessionNodeIndex: seedNodeId ? { [`${activeRef!.bookId}:${activeRef!.chapter}`]: seedNodeId } : {},
      sessionTangentIndex: {},
    })
    // Tell every other open window (main window, if this was started from the Study Trail
    // window, or vice versa) — see installStudyTrailStateSync's own comment for why this is
    // necessary at all. The seedAnchor payload lets the MAIN window (where the actual live
    // recorder/anchor-tracking runs) adopt the seeded node directly instead of resetting to a
    // blank anchor and waiting for the next real navigation to create the first node.
    window.app.broadcastStudyTrailState?.({
      currentTrailSessionId: session.id, trailSessionStatus: 'live',
      ...(seedNodeId ? { seedAnchor: { nodeId: seedNodeId, bookId: activeRef!.bookId, chapter: activeRef!.chapter } } : {}),
    })
  },
  pauseTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.pauseSession(id)
    set({ trailSessionStatus: 'paused' })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: id, trailSessionStatus: 'paused' })
  },
  resumeTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.resumeSession(id)
    set({ trailSessionStatus: 'live' })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: id, trailSessionStatus: 'live' })
  },
  renameTrailSession: async (name: string) => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.renameSession(id, name)
  },
  endTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (id && id !== LOOSE_SESSION_ID) await window.studyTrail.endSession(id)
    set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null, pendingArrivalPrompt: null, pendingArrivalNodeId: null, sessionNodeIndex: {}, sessionTangentIndex: {} })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: null, trailSessionStatus: null })
    // Recording falls back to the implicit loose bucket — continued study after ending a
    // session still shows up in Everything, it just isn't attached to a named session.
    void get().ensureLiveSession()
  },
  // Thin wrappers so UI (session rail / Everything view) has one place to call for deletion —
  // if the session being deleted is the one currently live/paused in THIS window, also clears
  // local anchor state so nothing keeps trying to record against a row that no longer exists.
  deleteTrailSession: async (trailSessionId: string) => {
    await window.studyTrail.deleteSession(trailSessionId)
    if (get().currentTrailSessionId === trailSessionId) {
      set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null, pendingArrivalPrompt: null, pendingArrivalNodeId: null, sessionNodeIndex: {}, sessionTangentIndex: {} })
      window.app.broadcastStudyTrailState?.({ currentTrailSessionId: null, trailSessionStatus: null })
      void get().ensureLiveSession()
    }
  },
  deleteTrailSessions: async (trailSessionIds: string[]) => {
    await window.studyTrail.deleteSessions(trailSessionIds)
    if (get().currentTrailSessionId && trailSessionIds.includes(get().currentTrailSessionId!)) {
      set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null, pendingArrivalPrompt: null, pendingArrivalNodeId: null, sessionNodeIndex: {}, sessionTangentIndex: {} })
      window.app.broadcastStudyTrailState?.({ currentTrailSessionId: null, trailSessionStatus: null })
      void get().ensureLiveSession()
    }
  },
  activateExistingSession: async (trailSessionId: string) => {
    const prevId = get().currentTrailSessionId
    if (prevId && prevId !== trailSessionId) await window.studyTrail.pauseSession(prevId).catch(() => {})
    await window.studyTrail.resumeSession(trailSessionId)
    const detail = await window.studyTrail.getSession(trailSessionId).catch(() => null)
    const sessionNodeIndex: Record<string, string> = {}
    if (detail) for (const n of detail.nodes) sessionNodeIndex[`${n.bookId}:${n.chapter}`] = n.id
    const openNode = detail?.nodes.find((n) => n.anchorEndedAt == null)
    set({
      currentTrailSessionId: trailSessionId, trailSessionStatus: 'live', sessionNodeIndex, sessionTangentIndex: {},
      currentAnchorNodeId: openNode?.id ?? null, currentAnchorBookId: openNode?.bookId ?? null,
      currentAnchorChapter: openNode?.chapter ?? null, currentAnchorVerseCount: 0,
      currentAnchorActivatedAt: openNode ? Date.now() : null, currentAnchorIsRevisit: false,
      currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null,
    })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: trailSessionId, trailSessionStatus: 'live' })
  },
  ensureLiveSession: async () => {
    const existing = get().currentTrailSessionId
    if (existing && get().trailSessionStatus === 'live') return existing
    // Guard against multiple navigations racing this before the first request resolves —
    // everyone piggybacks on the one in-flight request instead of each provisioning its own.
    if (ensureLiveSessionInFlight) return ensureLiveSessionInFlight
    ensureLiveSessionInFlight = (async () => {
      try {
        // No named "Untitled study" session any more — recording with no user session lands in
        // the implicit loose bucket, which only shows in the Everything timeline. Adopts the
        // bucket's own still-open anchor (if any) so recording resumes from where it left off.
        const s = await window.studyTrail.ensureLooseSession()
        const detail = await window.studyTrail.getSession(s.id).catch(() => null)
        const sessionNodeIndex: Record<string, string> = {}
        if (detail) for (const n of detail.nodes) sessionNodeIndex[`${n.bookId}:${n.chapter}`] = n.id
        const openNode = detail?.nodes.find((n) => n.anchorEndedAt == null)
        set({
          currentTrailSessionId: s.id, trailSessionStatus: 'live', sessionNodeIndex, sessionTangentIndex: {},
          currentAnchorNodeId: openNode?.id ?? null, currentAnchorBookId: openNode?.bookId ?? null,
          currentAnchorChapter: openNode?.chapter ?? null, currentAnchorVerseCount: 0,
          currentAnchorActivatedAt: openNode ? Date.now() : null, currentAnchorIsRevisit: false,
          currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null,
        })
        window.app.broadcastStudyTrailState?.({ currentTrailSessionId: s.id, trailSessionStatus: 'live' })
        return s.id
      } finally {
        ensureLiveSessionInFlight = null
      }
    })()
    return ensureLiveSessionInFlight
  },
}))

// See ensureLiveSession's own comment — module-level so it survives across the async gap
// regardless of which call site (recorder, recordLexiconConnection, ...) triggers it first.
let ensureLiveSessionInFlight: Promise<string> | null = null

/**
 * Records a lexicon-entry-open as a connection FROM the current anchor chapter (Strong's-chip
 * click, tier 1, no popup ever — a mere tooltip hover is never recorded at all, only an actual
 * click into the full entry, which is exactly what openLexiconEntry represents). Called from
 * the single existing choke point for lexicon navigation (src/store/index.ts's
 * `openLexiconEntry`) and from BiblePanel.tsx's `handleStrongsClick` (the one path that opens
 * the lexicon in an in-tab side panel instead of routing through openLexiconEntry).
 * `depth` lets a later click into that same entry's occurrences/related-words list upgrade to
 * a bolder connection — see the plan's Strong's depth-gradient section — without needing a
 * flag bump; each of those is its own new connection row.
 */
export function recordLexiconConnection(strongsNum: string, depth: 'click' | 'occurrences' | 'related' = 'click', fromVerse?: number): void {
  const s = useStudyTrailStore.getState()
  if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live') {
    // Same auto-provisioning as the main recorder — see its comment. Still requires an anchor
    // node to attach to (a lexicon click has to originate from a chapter already on-screen), so
    // this specific click is lost if it's the very first thing that happens after auto-creating
    // the session, but the session itself is no longer the blocker.
    void useStudyTrailStore.getState().ensureLiveSession()
    return
  }
  if (!s.currentAnchorNodeId) {
    return
  }
  // Branch chaining — fromNodeId always stays the chapter root (unchanged), but when the user
  // is already mid-branch (currentBranchTipConnectionId set — e.g. this is word B after already
  // clicking word A), fromConnectionId chains this new connection off THAT prior connection
  // instead of leaving it looking like a sibling click straight from the chapter. This is what
  // makes a Strong's A -> B -> C click sequence read as a real chain.
  const chained = s.currentBranchTipConnectionId != null
  // When the entry was actually opened — this fn can be called from a deferred path, so stamp
  // the connection with now rather than letting the IPC handler's own (later) clock win.
  const navAt = Date.now()
  window.studyTrail.addConnection({
    trailSessionId: s.currentTrailSessionId,
    fromNodeId: s.currentAnchorNodeId,
    fromConnectionId: chained ? s.currentBranchTipConnectionId! : undefined,
    chainDepth: chained ? s.currentBranchTipDepth + 1 : 0,
    toKind: 'lexicon',
    toStrongsNum: strongsNum,
    clarityTier: 1,
    reasonText: `Strong's word · ${strongsNum}`,
    reasonTags: ['lexicon'],
    weight: 'full',
    strongsDepth: depth,
    // Only meaningful for a fresh click FROM scripture text — a click from an already-open
    // entry (SidebarLexicon/LexiconPanel's own navToEntry, depth 'related') has no originating
    // verse at all, correctly left undefined by those call sites.
    originVersePinFrom: fromVerse,
    createdAt: navAt,
  })
    .then((conn) => {
      useStudyTrailStore.setState({
        currentBranchTipConnectionId: conn.id, currentBranchTipDepth: conn.chainDepth, currentBranchTipActivatedAt: navAt,
      })
    })
    .catch((err) => console.error('[TrailDebug] addConnection (lexicon) FAILED — this was previously silently swallowed', err))
}

/**
 * Notes a translation switch (KJV → LXX, etc.) on the CURRENT anchor node — the plain
 * translation picker in BiblePanel.tsx changes `updateTabState('scripture', ..., {translation})`
 * directly, without going through navigateToVerse/the NavOrigin recorder at all (there's no
 * chapter change to record), so it was previously invisible to Study Trail entirely: "switched
 * from KJV to LXX and it didn't detect that." Appends to the node's cachedSubnote rather than
 * a new connection row — a translation switch isn't a navigational tangent, just a detail
 * about how this chapter was being read.
 */
export function recordTranslationSwitch(newTranslation: string): void {
  const s = useStudyTrailStore.getState()
  if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live') {
    void useStudyTrailStore.getState().ensureLiveSession()
    return
  }
  if (!s.currentAnchorNodeId) return
  const label = newTranslation.toUpperCase()
  window.studyTrail.updateNodeSubnote(s.currentAnchorNodeId, `switched to ${label}`)
    .catch((err) => console.error('[TrailDebug] recordTranslationSwitch FAILED', err))
}

/**
 * Keeps THIS window's useStudyTrailStore in sync with whichever window a session was actually
 * started/paused/resumed from. Each window (main + Study Trail) is a separate renderer process
 * with its own independent in-memory store instance — a session started via the Study Trail
 * window's own +New session button updated only ITS store, leaving the main window (where
 * installStudyTrailRecorder's navigateToVerse hook actually lives and checks
 * currentTrailSessionId before recording anything) permanently believing no session was live.
 * That was the root cause of Study Trail silently recording nothing at all, regardless of
 * which window a session was started from. Call once at startup in BOTH windows (App.tsx and
 * StudyTrailApp.tsx) — see startTrailSession/pauseTrailSession/resumeTrailSession's own
 * broadcastStudyTrailState calls for the other half of this.
 */
export function installStudyTrailStateSync(): void {
  // Self-heal on mount (app boot, or a window reload while a session is already live/paused)
  // rather than relying solely on a fresh broadcast, which only fires on the NEXT start/pause/
  // resume action — without this, a session already live before this window/tab finished
  // mounting would silently look ended to it until something else happened to re-broadcast.
  window.studyTrail.listSessions().then(async (rows) => {
    const active = rows.find((r) => r.status === 'live' || r.status === 'paused')
    if (!active) {
      // No user-created session is live or paused — point recording at the implicit loose
      // bucket (ensureLiveSession) so navigation is still captured for the Everything timeline
      // without ever fabricating a named "Untitled study" session the user didn't create.
      void useStudyTrailStore.getState().ensureLiveSession()
      return
    }
    const cur = useStudyTrailStore.getState()
    if (cur.currentTrailSessionId) return // already knows about a session — don't clobber it
    // Seed sessionNodeIndex from whatever this session already has (a page reload, or this
    // window mounting after the session was started elsewhere) — without this, every already-
    // visited chapter would look "new" to THIS window's recorder until it independently
    // rediscovers each one, defeating the reopen-instead-of-duplicate logic below.
    const detail = await window.studyTrail.getSession(active.id).catch(() => null)
    const sessionNodeIndex: Record<string, string> = {}
    if (detail) for (const n of detail.nodes) sessionNodeIndex[`${n.bookId}:${n.chapter}`] = n.id
    useStudyTrailStore.setState({ currentTrailSessionId: active.id, trailSessionStatus: active.status, sessionNodeIndex, sessionTangentIndex: {} })
  }).catch(() => {})

  window.app.onStudyTrailStateChanged?.((raw) => {
    const incoming = raw as {
      currentTrailSessionId: string | null; trailSessionStatus: TrailSessionStatus | null
      seedAnchor?: { nodeId: string; bookId: string; chapter: number }
    }
    const cur = useStudyTrailStore.getState()
    if (cur.currentTrailSessionId === incoming.currentTrailSessionId && cur.trailSessionStatus === incoming.trailSessionStatus) return
    const sessionChanged = cur.currentTrailSessionId !== incoming.currentTrailSessionId
    useStudyTrailStore.setState({
      currentTrailSessionId: incoming.currentTrailSessionId,
      trailSessionStatus: incoming.trailSessionStatus,
      // A different (or newly-null) session id means whatever anchor THIS window's own
      // recorder was tracking is now stale — reset it exactly like startTrailSession's own
      // reducer does, so the next navigation creates a fresh first anchor for the new session
      // instead of wrongly hanging a connection off the previous one. UNLESS the broadcast
      // came with a seedAnchor (the new session was seeded from whatever chapter was active
      // when it was created) — then THIS window (almost always the main window, where the
      // live recorder actually runs) adopts that seeded node as its own current anchor
      // directly, so the next real navigation correctly connects FROM it instead of having
      // nothing to connect from.
      ...(sessionChanged
        ? incoming.seedAnchor
          ? {
              currentAnchorNodeId: incoming.seedAnchor.nodeId, currentAnchorBookId: incoming.seedAnchor.bookId,
              currentAnchorChapter: incoming.seedAnchor.chapter, currentAnchorVerseCount: 0,
              currentAnchorActivatedAt: Date.now(), currentAnchorIsRevisit: false,
              currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null,
              sessionNodeIndex: { [`${incoming.seedAnchor.bookId}:${incoming.seedAnchor.chapter}`]: incoming.seedAnchor.nodeId },
              sessionTangentIndex: {},
            }
          : { currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null, pendingArrivalPrompt: null, pendingArrivalNodeId: null, sessionNodeIndex: {}, sessionTangentIndex: {} }
        : {}),
    })
  })
}

// The glance window — a reversal back to the origin chapter within this long, with no other
// navigation in between, retroactively marks the connection as a low-weight 'glance' rather
// than a full tangent. Nothing is ever deleted, only re-weighted.
const GLANCE_WINDOW_MS = 2500

let pendingGlanceCheck: { connectionId: string; fromBookId: string; fromChapter: number; timer: ReturnType<typeof setTimeout> } | null = null

// Origins specific/intentional enough that even a SAME-CHAPTER landing is worth its own branch
// row rather than being silently folded into the engagement counter — a deliberate cross-ref or
// lexicon-occurrence click always represents a real "why did I look at THIS verse" fact,
// regardless of whether it happens to land in the chapter already open. Sequential reading,
// tab-switches, and verse-popovers are deliberately NOT included — those are exactly the "just
// more time on the same anchor" cases this branch exists to filter out. An explicit allowlist
// (not a per-kind `if`) so a future same-chapter-worthy origin only needs adding here, not a new
// conditional. See the same-chapter cross-ref fix (commit 6c2e527) this generalizes.
// search-result added per direct feedback confirming a verse-specific search result click is
// exactly as much a deliberate "why did I look at THIS verse" tangent as a cross-ref click —
// it just has no origin verse of its own (no `fromVerse` concept for a search), so the
// depth/parent lookup below always treats it as a fresh sibling, never a nested chain.
const SAME_CHAPTER_BRANCH_WORTHY_KINDS = new Set<NavOrigin['kind']>(['cross-ref', 'lexicon-occurrence', 'ai-lookup', 'search-result'])

// The specific origin verse a connection's automatic reason came from — cross-ref rows and a
// nested AI Lookup cross-ref result both know this; every other origin kind doesn't have the
// concept at all. One place to read it so the two addConnection call sites below (and any
// future one) don't each need their own kind-by-kind check.
function originFromVerse(origin: NavOrigin): number | undefined {
  if (origin.kind === 'cross-ref') return origin.fromVerse
  if (origin.kind === 'ai-lookup') return origin.fromVerse
  return undefined
}

/** Depth/parent lookup for a new tangent connection, per the confirmed branch model: chain off
 *  whichever EXISTING tangent bullet already represents this origin verse (one level deeper than
 *  it), or hang directly off the current main anchor as a fresh sibling if no tangent bullet
 *  represents that verse yet. `anchorBookId`/`anchorChapter` is the chapter the origin verse
 *  belongs to — the current anchor at the moment of the click (the chapter being read FROM),
 *  not the destination. See sessionTangentIndex's own comment for the full "why". */
function tangentParentFor(
  tangentIndex: Record<string, { connectionId: string; depth: number }>,
  anchorBookId: string | null, anchorChapter: number | null, origin: NavOrigin,
): { fromConnectionId?: string; chainDepth: number } {
  const fromVerse = originFromVerse(origin)
  if (fromVerse != null && anchorBookId && anchorChapter != null) {
    const parent = tangentIndex[`${anchorBookId}:${anchorChapter}:${fromVerse}`]
    if (parent) return { fromConnectionId: parent.connectionId, chainDepth: parent.depth + 1 }
  }
  return { chainDepth: 0 }
}

// A branch CHAIN (as opposed to the chapter-revisit case REVISIT_PROMOTE_* above measures)
// staying entirely within lexicon-land can never create a trail_nodes row to "promote" into —
// there's no chapter to attach to — so getting long/slow enough to be worth flagging is purely
// a RENDERING decision computed live from chain_depth (see MapView.tsx), never a persisted DB
// fact. Lower thresholds than the chapter-revisit ones: a lexicon hop is a much smaller unit of
// engagement than a full chapter visit, so it takes fewer/less time for a chain to mean something.
export const BRANCH_PROMOTE_DEPTH_THRESHOLD = 3
export const BRANCH_PROMOTE_DWELL_MS = 30_000

// How long the user has to actually STAY on a chapter before it's recorded at all — a rapid
// A→B→C→D→E flip-through (Next Chapter mashed, or a fast book/chapter picker drag) re-arms
// this same timer on every hop, so only the chapter the user is still on once it fires ever
// gets a node/connection; every merely-passed-through chapter in between leaves no trace.
// Short enough that genuine reading never feels delayed (nothing else about navigation waits
// on this — only Study Trail's own recording does), long enough to clearly exceed a reflexive
// next-chapter click's cadence.
const CHAPTER_ARRIVAL_DWELL_MS = 1200
let pendingChapterArrivalTimer: ReturnType<typeof setTimeout> | null = null

/** Schedules the "record a genuinely different chapter" logic after CHAPTER_ARRIVAL_DWELL_MS —
 *  see its own comment. Re-arming (clearing whatever was previously pending) on every call is
 *  the whole mechanism: only the LAST call in a rapid run ever survives to fire. Recomputes
 *  everything from a FRESH store snapshot when it actually fires (not from anything captured
 *  at schedule time), since real time has passed and branch-mode state in particular
 *  (currentlyInBranch/currentBranchTipConnectionId) may have changed via the "ask why" popup
 *  in the meantime. */
function scheduleChapterArrival(from: Parameters<NavRecorder>[0], to: Parameters<NavRecorder>[1], origin: NavOrigin, navAt: number): void {
  if (pendingChapterArrivalTimer) clearTimeout(pendingChapterArrivalTimer)
  pendingChapterArrivalTimer = setTimeout(() => {
    pendingChapterArrivalTimer = null
    commitChapterArrival(from, to, origin, navAt).catch((err) => console.error('[TrailDebug] commitChapterArrival FAILED', err))
  }, CHAPTER_ARRIVAL_DWELL_MS)
}

/** `navAt` is the wall-clock time the user ACTUALLY navigated (captured synchronously in the
 *  recorder, before the arrival dwell + IPC round-trip), so the node/connection it writes is
 *  stamped with when the chapter was opened — not the ~1.2s-plus-later moment this code finally
 *  runs. Per direct feedback: "the timestamps ... are not accurate ... make sure that they are
 *  accurate to when the user actually opened them." */
async function commitChapterArrival(from: Parameters<NavRecorder>[0], to: Parameters<NavRecorder>[1], origin: NavOrigin, navAt: number): Promise<void> {
  const s = useStudyTrailStore.getState()
  // The session/anchor could in principle have changed (session ended, etc.) during the dwell
  // — bail out the same way the live recorder itself would rather than recording against stale
  // state.
  if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live' || !to.bookId || to.chapter == null) return
  // Also re-check "is this actually still a different chapter" — the dwell may have ended
  // exactly back where the user already was (e.g. a same-chapter-but-different-verse hop that
  // got funneled through here transiently), in which case there's nothing to do; the live
  // sameChapter branch already handles ordinary same-chapter engagement immediately.
  if (s.currentAnchorBookId === to.bookId && s.currentAnchorChapter === to.chapter) return

  const trailSessionId = s.currentTrailSessionId
  const prevNodeId = s.currentAnchorNodeId
  const fromRef = s.currentAnchorBookId && s.currentAnchorChapter != null ? { bookId: s.currentAnchorBookId, chapter: s.currentAnchorChapter } : undefined
  const { text, tags } = reasonForOrigin(origin, fromRef)
  const tier = tierForOrigin(origin)

  // A compare-view column change is its own connection kind, not a chapter tangent — the user
  // is still anchored on whatever they were reading, just glancing at a second translation
  // alongside it. Record the connection without moving the anchor or creating a new node for
  // it. (Compare-column origins are tier 1 and never actually flip-through-worthy in practice,
  // but handled here too for correctness now that this whole path is dwell-scheduled.)
  if (origin.kind === 'compare-column') {
    if (prevNodeId) {
      window.studyTrail.addConnection({
        trailSessionId, fromNodeId: prevNodeId, toKind: 'compare',
        toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse,
        clarityTier: tier, reasonText: text, reasonTags: tags, weight: 'full', createdAt: navAt,
      })
        .catch((err) => console.error('[TrailDebug] addConnection (compare) FAILED', err))
    }
    return
  }

  // If this exact chapter already has a node in the session (the spine-drift fix: an
  // occurrence/search/wikilink detour landing back on an already-read chapter, or any plain
  // revisit), REOPEN that existing node instead of creating a duplicate — the spine then reads
  // as a real round trip (this connection's destination matches an earlier node) rather than
  // the anchor permanently dragging forward through the detour.
  const key = `${to.bookId}:${to.chapter}`
  const existingNodeId = s.sessionNodeIndex[key]

  // Revisit promotion — checked as we LEAVE, not as we arrive. If the anchor being left was
  // itself a reopened node (not a fresh first visit), split it off into its own new spine node
  // positioned at when this visit actually began — instead of forever folding it into the
  // chapter's frozen first-visit position, which is what read as "this happened in the past"
  // even for a substantial re-engagement happening right now. UNCONDITIONAL as of this round —
  // per direct feedback ("i would think to always promote on any revisit... events that happen
  // later dont look like they happened in the past before they would have actually happened"),
  // the earlier engagement threshold (REVISIT_PROMOTE_VERSE_THRESHOLD/DWELL_MS) is removed;
  // even a brief bounce-through now gets its own real chronological position. The predictable
  // cost — rapid back-and-forth now produces a run of separate promoted nodes — is handled
  // entirely in the renderer (see MapView.tsx's cluster-collapse, and promoteRevisit's own
  // cluster_id detection in electron/ipc/studyTrail.ts, v33), not by suppressing promotion here.
  let effectivePrevNodeId = prevNodeId
  if (prevNodeId && s.currentAnchorIsRevisit && s.currentAnchorActivatedAt != null && s.currentAnchorBookId && s.currentAnchorChapter != null) {
    try {
      const promoted = await window.studyTrail.promoteRevisit({
        trailSessionId, originalNodeId: prevNodeId, bookId: s.currentAnchorBookId, chapter: s.currentAnchorChapter,
        // from.translation, not to.translation — this promotes the chapter being LEFT (the
        // reopened node the user was just re-engaging with), so it needs that chapter's own
        // translation, which is what `from` (the pre-navigation tab state) carries, not the
        // destination's.
        activatedAt: s.currentAnchorActivatedAt, translation: from.translation,
      })
      effectivePrevNodeId = promoted.id
      const promotedKey = `${s.currentAnchorBookId}:${s.currentAnchorChapter}`
      useStudyTrailStore.setState((st) => ({ sessionNodeIndex: { ...st.sessionNodeIndex, [promotedKey]: promoted.id } }))
    } catch (err) {
      console.error('[TrailDebug] promoteRevisit FAILED — keeping the original node as the connection source', err)
    }
  }

  let node = await (existingNodeId
    ? window.studyTrail.reopenNode(existingNodeId, navAt)
    : window.studyTrail.addNode({ trailSessionId, bookId: to.bookId, chapter: to.chapter, orderIndex: navAt, anchorStartedAt: navAt, originLabel: origin.kind, translation: to.translation }))
  if (!node) { // reopenNode found nothing (stale index entry) — fall back to a fresh node
    node = await window.studyTrail.addNode({ trailSessionId, bookId: to.bookId, chapter: to.chapter, orderIndex: navAt, anchorStartedAt: navAt, originLabel: origin.kind, translation: to.translation })
  }
  // Arriving at a chapter normally means "back at depth 0" for the branch chain — UNLESS THIS
  // hop is itself a deliberate cross-ref/lexicon-occurrence/ai-lookup jump to a SPECIFIC VERSE.
  // Per direct feedback, being "already mid-branch" no longer carries forward on its own: a
  // plain/manual jump (typing a reference, the book/chapter picker, a search result, just
  // reading onward) always snaps back to main automatically, even if you never explicitly
  // clicked "back to main." Only another deliberate click of one of those kinds (from wherever
  // you currently are, main or mid-branch) extends the chain further — that still works
  // correctly on its own merits below via chainedFromBranch, no need to also gate on the OLD
  // currentlyInBranch flag here. (Previously this also carried forward on `s.currentlyInBranch`,
  // which meant one cross-ref click permanently branch-tagged every subsequent navigation until
  // a manual "back to main" click — the reported "Song of Songs 8 shows up oddly indented/
  // disconnected" bug.) A landing on a bare CHAPTER with no specific verse target still doesn't
  // earn its own branch — there's nothing verse-specific to point at, so it's recorded as an
  // ordinary spine continuation instead.
  const isBranchThisHop = SAME_CHAPTER_BRANCH_WORTHY_KINDS.has(origin.kind) && to.verse != null
  useStudyTrailStore.setState((st) => ({
    currentAnchorNodeId: node!.id, currentAnchorBookId: to.bookId, currentAnchorChapter: to.chapter, currentAnchorVerseCount: 1,
    currentAnchorActivatedAt: navAt, currentAnchorIsRevisit: !!existingNodeId,
    // A plain/non-tangent hop is back at depth 0 — the whole tangent group (and its lookup
    // index) closes out; the NEXT tangent, whenever it starts, begins clean rather than
    // possibly chaining onto a stale entry from an unrelated earlier excursion.
    ...(isBranchThisHop ? {} : { currentlyInBranch: false, currentBranchTipConnectionId: null, currentBranchTipDepth: 0, currentBranchTipActivatedAt: null, sessionTangentIndex: {} }),
    sessionNodeIndex: { ...st.sessionNodeIndex, [key]: node!.id },
  }))
  if (!effectivePrevNodeId) {
    return
  }
  if (effectivePrevNodeId === node!.id) {
    return
  }
  // Depth/parent from tangentParentFor — chains off whichever existing tangent bullet already
  // represents this hop's ORIGIN verse (one level deeper), or hangs directly off the anchor as
  // a fresh sibling otherwise. `s` is the pre-arrival snapshot, so `s.currentAnchorBookId`/
  // `currentAnchorChapter` still correctly means "the chapter being left" here.
  const parent = tangentParentFor(s.sessionTangentIndex, s.currentAnchorBookId, s.currentAnchorChapter, origin)
  const conn = await window.studyTrail.addConnection({
    trailSessionId, fromNodeId: effectivePrevNodeId, toKind: 'chapter',
    fromConnectionId: parent.fromConnectionId,
    chainDepth: parent.chainDepth,
    toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse, toVerseEnd: to.endVerse,
    clarityTier: tier, reasonText: text, reasonTags: tags, weight: 'full',
    originVersePinFrom: originFromVerse(origin),
    isBranch: isBranchThisHop, createdAt: navAt,
  })
  if (isBranchThisHop) {
    useStudyTrailStore.setState((st) => ({
      currentlyInBranch: true, currentBranchTipConnectionId: conn.id, currentBranchTipDepth: conn.chainDepth, currentBranchTipActivatedAt: navAt,
      // Record THIS connection's own destination verse so a later cross-ref clicked FROM it
      // (once its chapter becomes the anchor, which it does above) chains one level deeper.
      ...(to.verse != null && to.bookId
        ? { sessionTangentIndex: { ...st.sessionTangentIndex, [`${to.bookId}:${to.chapter}:${to.verse}`]: { connectionId: conn.id, depth: conn.chainDepth } } }
        : {}),
    }))
  }
  // The arrival prompt — only for jumps Study Trail is NOT already confident about (tier 2/3:
  // search, tab-switch, manual picker, etc.). A tier-1 jump (cross-ref, lexicon occurrence, AI
  // Lookup, sequential reading) already has a known, specific reason recorded automatically —
  // asking again would just be noise. Always set for tier 2/3 now (not gated behind
  // studyTrailAskChapterJumpReason here) — StudyTrailArrivalPrompt itself decides whether that
  // setting means "show the full popup" or "show the lightweight passive pill instead", so a
  // reason can still be jotted down even with the full popup turned off.
  if (tier !== 1) {
    useStudyTrailStore.setState({ pendingArrivalPrompt: conn, pendingArrivalNodeId: node!.id })
  }
  // Arm the glance check: if the user bounces straight back to where they came from within the
  // window, this connection gets re-weighted down to a glance.
  if (pendingGlanceCheck) clearTimeout(pendingGlanceCheck.timer)
  if (from.bookId && from.chapter != null) {
    pendingGlanceCheck = {
      connectionId: conn.id, fromBookId: from.bookId, fromChapter: from.chapter,
      timer: setTimeout(() => { pendingGlanceCheck = null }, GLANCE_WINDOW_MS),
    }
  }
}

/** Installed once at app startup (see src/App.tsx) so every navigateToVerse() call anywhere
 *  in the app feeds Study Trail without those call sites needing to know it exists. */
export function installStudyTrailRecorder(): void {
  setNavRecorder((from, to, origin) => {
    // Captured NOW, synchronously with the navigation itself — every node/connection this event
    // ultimately writes is stamped with this, not the later moment the (dwell-delayed, async,
    // IPC-round-tripped) write actually runs. "make sure that they are accurate to when the user
    // actually opened them."
    const navAt = Date.now()
    const s = useStudyTrailStore.getState()
    // Recording never requires the user to have created/started a session — a session is
    // just a named label over the continuous trail now. If nothing is live yet, kick off an
    // auto-provisioned one in the background and skip only THIS one navigation event (the
    // in-flight guard means this only actually happens once, at cold start, before the very
    // first navigation lands).
    if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live') {
      void useStudyTrailStore.getState().ensureLiveSession()
      return
    }
    if (!to.bookId || to.chapter == null) {
      return
    }

    const sameChapter = s.currentAnchorBookId === to.bookId && s.currentAnchorChapter === to.chapter
    if (sameChapter && s.currentAnchorNodeId) {
      // Still reading the same chapter — no new NODE, and for most origins (plain verse-number
      // clicks, tab-switches, sequential reading) no connection either: it's just more time
      // spent on the one anchor. The counter keeps incrementing regardless (kept for possible
      // future use — it no longer gates revisit promotion, which is unconditional now), but
      // it's a count of same-chapter NAVIGATION EVENTS (clicking a verse number, a cross-ref
      // landing back here, etc.), not verses actually read — there's no scroll-position
      // tracking behind it, so it was never
      // honest to display as "read N verses in this chapter" (a plain scroll-through with no
      // further verse-targeted navigation left it at 0 regardless of how much was actually
      // read). No cachedSubnote claim is written for this anymore; the real, verifiable
      // per-visit facts (arrival time, total dwell duration) are still shown via the hover
      // card, which doesn't need to assert an unverifiable read count.
      //
      // A cross-ref click IS still worth recording even when it lands in the same chapter —
      // Michael's own framing: "if i click a verse from a cross ref on a verse, then that's
      // something that should be like a branch and such to tie it together." Landing on
      // Gen 3:5 via a TSKe cross-ref while anchored on Genesis 3 previously vanished into this
      // same-chapter branch with zero trace, even though it's exactly as real a "why did I end
      // up looking at this verse" fact as a cross-ref that happens to land in a different
      // chapter. Recorded as a connection FROM the anchor back to itself (same node, same
      // book/chapter, specific target verse) — MapView renders this as a short branch stub off
      // the node, not a "return" (see isSameChapterBranch there), since nothing about it is a
      // round trip. The anchor itself doesn't move and no new node is created.
      // Generalized (was cross-ref-only) — see SAME_CHAPTER_BRANCH_WORTHY_KINDS above; a
      // same-chapter lexicon-occurrence click (Strong's A's occurrence lands on a verse in the
      // very chapter you're already anchored on) was silently dropped by this branch before,
      // the same class of bug the cross-ref case was fixed for.
      const count = s.currentAnchorVerseCount + 1
      useStudyTrailStore.setState({ currentAnchorVerseCount: count })
      if (SAME_CHAPTER_BRANCH_WORTHY_KINDS.has(origin.kind)) {
        const fromRef = s.currentAnchorBookId && s.currentAnchorChapter != null ? { bookId: s.currentAnchorBookId, chapter: s.currentAnchorChapter } : undefined
        const { text, tags } = reasonForOrigin(origin, fromRef)
        // A same-chapter cross-ref/lexicon-occurrence/ai-lookup/search-result is exactly as much
        // "off on a tangent" as one that lands on a different chapter — same isBranch treatment
        // as the different-chapter path above. Same "specific verse only" condition, though a
        // same-chapter landing always does target a specific verse by definition.
        const isBranchThisHop = SAME_CHAPTER_BRANCH_WORTHY_KINDS.has(origin.kind) && to.verse != null
        const parent = tangentParentFor(s.sessionTangentIndex, s.currentAnchorBookId, s.currentAnchorChapter, origin)
        window.studyTrail.addConnection({
          trailSessionId: s.currentTrailSessionId, fromNodeId: s.currentAnchorNodeId, toKind: 'chapter',
          fromConnectionId: parent.fromConnectionId,
          chainDepth: parent.chainDepth,
          toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse, toVerseEnd: to.endVerse,
          clarityTier: tierForOrigin(origin), reasonText: text, reasonTags: tags, weight: 'full',
          originVersePinFrom: originFromVerse(origin),
          isBranch: isBranchThisHop, createdAt: navAt,
        })
          .then((conn) => {
            useStudyTrailStore.setState((st) => ({
              currentlyInBranch: isBranchThisHop || st.currentlyInBranch,
              currentBranchTipConnectionId: conn.id, currentBranchTipDepth: conn.chainDepth, currentBranchTipActivatedAt: navAt,
              // Record THIS connection's own destination verse as a lookup key — a later
              // cross-ref clicked from THIS verse (same chapter, same verse) chains one level
              // deeper than it, per tangentParentFor's own comment.
              ...(isBranchThisHop && to.verse != null && to.bookId
                ? { sessionTangentIndex: { ...st.sessionTangentIndex, [`${to.bookId}:${to.chapter}:${to.verse}`]: { connectionId: conn.id, depth: conn.chainDepth } } }
                : {}),
            }))
          })
          .catch((err) => console.error('[TrailDebug] addConnection (same-chapter branch) FAILED', err))
      }
      return
    }

    const trailSessionId = s.currentTrailSessionId
    const prevNodeId = s.currentAnchorNodeId
    const { text, tags } = reasonForOrigin(origin)
    const tier = tierForOrigin(origin)

    // A compare-view column change is its own connection kind, not a chapter tangent — the
    // user is still anchored on whatever they were reading, just glancing at a second
    // translation alongside it. Record the connection without moving the anchor or creating
    // a new node for it.
    if (origin.kind === 'compare-column') {
      if (prevNodeId) {
        window.studyTrail.addConnection({
          trailSessionId, fromNodeId: prevNodeId, toKind: 'compare',
          toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse,
          clarityTier: tier, reasonText: text, reasonTags: tags, weight: 'full', createdAt: navAt,
        })
          .catch((err) => console.error('[TrailDebug] addConnection (compare) FAILED', err))
      }
      return
    }

    // A genuinely different chapter — this earns a connection FROM the current anchor (if
    // any). Per direct feedback ("if i quickly flip from chapter Isaiah 40 to get to Isaiah 44
    // I wont want you to track the chapters in between unless i actually stop on them"), this
    // isn't recorded immediately for most origins — it's scheduled after a short dwell (see
    // scheduleChapterArrival below), so a rapid A→B→C→D→E flip-through (each hop re-arming the
    // same timer before the last one fires) never creates a node for any of the merely-
    // passed-through chapters, only for wherever the user actually settles.
    //
    // EXCEPT the same always-worthy kinds SAME_CHAPTER_BRANCH_WORTHY_KINDS already carves out
    // for the same-chapter case above (cross-ref, lexicon-occurrence, ai-lookup) — these are
    // deliberate clicks on a specific reference, not passive/reflexive flipping, so they were
    // being silently dropped by the dwell debounce whenever the user kept moving within
    // CHAPTER_ARRIVAL_DWELL_MS of clicking one (exactly the "cross ref... not putting the
    // branch sometimes" bug report). Recorded immediately instead, same as the sameChapter
    // branch already does.
    if (SAME_CHAPTER_BRANCH_WORTHY_KINDS.has(origin.kind)) {
      if (pendingChapterArrivalTimer) { clearTimeout(pendingChapterArrivalTimer); pendingChapterArrivalTimer = null }
      commitChapterArrival(from, to, origin, navAt).catch((err) => console.error('[TrailDebug] commitChapterArrival (immediate, always-worthy origin) FAILED', err))
    } else {
      scheduleChapterArrival(from, to, origin, navAt)
    }

    // If THIS navigation is itself the "bounce back" a previous connection was waiting on,
    // mark that one a glance instead of a full connection.
    if (pendingGlanceCheck && pendingGlanceCheck.fromBookId === to.bookId && pendingGlanceCheck.fromChapter === to.chapter) {
      clearTimeout(pendingGlanceCheck.timer)
      const glanceConnId = pendingGlanceCheck.connectionId
      window.studyTrail.markGlance(glanceConnId)
        .catch((err) => console.error('[TrailDebug] markGlance FAILED', err))
      // Smart anti-spam for the arrival prompt (§5 of the plan) — a jump that turns out to be
      // a quick back-and-forth check (exactly what glance detection exists to catch) shouldn't
      // leave its own "why did you jump here?" popover sitting open for what wasn't really a
      // navigational moment. Auto-dismiss it without writing anything (same as a manual "Not
      // now"), so it doesn't accumulate as the user checks their answer by bouncing around.
      if (useStudyTrailStore.getState().pendingArrivalPrompt?.id === glanceConnId) {
        useStudyTrailStore.setState({ pendingArrivalPrompt: null, pendingArrivalNodeId: null })
      }
      pendingGlanceCheck = null
    }
  })
}
