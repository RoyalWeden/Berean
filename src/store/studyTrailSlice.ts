// Study Trail's own small Zustand store — deliberately NOT merged into the main
// src/store/index.ts monolith (2500+ lines, single `create()` call, no existing
// slice-composition pattern to hook into cleanly). A separate store is simpler and lower-risk
// here, and nothing about Zustand requires a single global store. Prefixed `TrailSession`/
// `useStudyTrailStore` throughout to avoid colliding with the main store's unrelated
// `Session`/`sessions`/`currentSessionId` (tab-layout workspaces — a completely different
// concept, see src/store/index.ts:114, 539-540).
import { create } from 'zustand'
import type { NavOrigin } from '@/lib/verseNavigation'
import { setNavRecorder } from '@/lib/verseNavigation'
import type { ClarityTier, TrailSessionStatus } from '@/types/studyTrail'

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
export function reasonForOrigin(origin: NavOrigin): { text?: string; tags: string[] } {
  switch (origin.kind) {
    case 'cross-ref': return { text: origin.reason ?? `a ${origin.source} cross-reference`, tags: [`cross-ref:${origin.source}`] }
    case 'lexicon-occurrence': return { text: `Strong's ${origin.strongsNum} occurrence`, tags: ['lexicon'] }
    // ai-lookup's text is the raw question verbatim (not decorated) — it's tier 1 and shown
    // directly as the connection's reason elsewhere, where "AI Lookup:" would just be noise
    // next to a question mark already reading as a question.
    case 'ai-lookup': return { text: origin.question, tags: ['ai-lookup'] }
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
  sessionNodeIndex: {},

  startTrailSession: async (name: string) => {
    if (window.__bereanTrailDebug) console.log('[TrailDebug] startTrailSession() called', { name })
    // Never leave a previous session dangling with status='live' forever while a new one
    // starts recording — two sessions being "active" at once was possible before this (the
    // old row just sat orphaned in the DB, still showing a green "live" dot in the rail even
    // though nothing was recording to it anymore).
    const prevId = get().currentTrailSessionId
    if (prevId) await window.studyTrail.pauseSession(prevId).catch(() => {})
    const session = await window.studyTrail.startSession(name)
    if (window.__bereanTrailDebug) console.log('[TrailDebug] startSession IPC resolved', session)

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
      sessionNodeIndex: seedNodeId ? { [`${activeRef!.bookId}:${activeRef!.chapter}`]: seedNodeId } : {},
    })
    // Tell every other open window (main window, if this was started from the Study Trail
    // window, or vice versa) — see installStudyTrailStateSync's own comment for why this is
    // necessary at all. The seedAnchor payload lets the MAIN window (where the actual live
    // recorder/anchor-tracking runs) adopt the seeded node directly instead of resetting to a
    // blank anchor and waiting for the next real navigation to create the first node.
    if (window.__bereanTrailDebug) console.log('[TrailDebug] broadcasting session start', { currentTrailSessionId: session.id, trailSessionStatus: 'live', seedNodeId })
    window.app.broadcastStudyTrailState?.({
      currentTrailSessionId: session.id, trailSessionStatus: 'live',
      ...(seedNodeId ? { seedAnchor: { nodeId: seedNodeId, bookId: activeRef!.bookId, chapter: activeRef!.chapter } } : {}),
    })
  },
  pauseTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (window.__bereanTrailDebug) console.log('[TrailDebug] pauseTrailSession() called', { id })
    if (!id) return
    await window.studyTrail.pauseSession(id)
    set({ trailSessionStatus: 'paused' })
    if (window.__bereanTrailDebug) console.log('[TrailDebug] broadcasting session pause', { id })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: id, trailSessionStatus: 'paused' })
  },
  resumeTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (window.__bereanTrailDebug) console.log('[TrailDebug] resumeTrailSession() called', { id })
    if (!id) return
    await window.studyTrail.resumeSession(id)
    set({ trailSessionStatus: 'live' })
    if (window.__bereanTrailDebug) console.log('[TrailDebug] broadcasting session resume', { id })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: id, trailSessionStatus: 'live' })
  },
  renameTrailSession: async (name: string) => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.renameSession(id, name)
  },
  endTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (id) await window.studyTrail.endSession(id)
    set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, sessionNodeIndex: {} })
    if (window.__bereanTrailDebug) console.log('[TrailDebug] broadcasting session end', { id })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: null, trailSessionStatus: null })
  },
  // Thin wrappers so UI (session rail / Everything view) has one place to call for deletion —
  // if the session being deleted is the one currently live/paused in THIS window, also clears
  // local anchor state so nothing keeps trying to record against a row that no longer exists.
  deleteTrailSession: async (trailSessionId: string) => {
    await window.studyTrail.deleteSession(trailSessionId)
    if (get().currentTrailSessionId === trailSessionId) {
      set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, sessionNodeIndex: {} })
      window.app.broadcastStudyTrailState?.({ currentTrailSessionId: null, trailSessionStatus: null })
    }
  },
  deleteTrailSessions: async (trailSessionIds: string[]) => {
    await window.studyTrail.deleteSessions(trailSessionIds)
    if (get().currentTrailSessionId && trailSessionIds.includes(get().currentTrailSessionId!)) {
      set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, sessionNodeIndex: {} })
      window.app.broadcastStudyTrailState?.({ currentTrailSessionId: null, trailSessionStatus: null })
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
      currentTrailSessionId: trailSessionId, trailSessionStatus: 'live', sessionNodeIndex,
      currentAnchorNodeId: openNode?.id ?? null, currentAnchorBookId: openNode?.bookId ?? null,
      currentAnchorChapter: openNode?.chapter ?? null, currentAnchorVerseCount: 0,
      currentAnchorActivatedAt: openNode ? Date.now() : null, currentAnchorIsRevisit: false,
    })
    window.app.broadcastStudyTrailState?.({ currentTrailSessionId: trailSessionId, trailSessionStatus: 'live' })
  },
}))

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
export function recordLexiconConnection(strongsNum: string, depth: 'click' | 'occurrences' | 'related' = 'click'): void {
  const s = useStudyTrailStore.getState()
  if (window.__bereanTrailDebug) {
    console.log('[TrailDebug] recordLexiconConnection() called', {
      strongsNum, depth, currentTrailSessionId: s.currentTrailSessionId,
      trailSessionStatus: s.trailSessionStatus, currentAnchorNodeId: s.currentAnchorNodeId,
    })
  }
  if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live' || !s.currentAnchorNodeId) {
    if (window.__bereanTrailDebug) console.log('[TrailDebug] recordLexiconConnection: gate failed — nothing recorded')
    return
  }
  window.studyTrail.addConnection({
    trailSessionId: s.currentTrailSessionId,
    fromNodeId: s.currentAnchorNodeId,
    toKind: 'lexicon',
    toStrongsNum: strongsNum,
    clarityTier: 1,
    reasonText: `Strong's word · ${strongsNum}`,
    reasonTags: ['lexicon'],
    weight: 'full',
    strongsDepth: depth,
  })
    .then((conn) => { if (window.__bereanTrailDebug) console.log('[TrailDebug] addConnection (lexicon) SUCCEEDED', conn) })
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
  if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live' || !s.currentAnchorNodeId) return
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
    if (window.__bereanTrailDebug) console.log('[TrailDebug] bootstrap listSessions', { rows, adopting: active?.id ?? null })
    if (!active) return
    const cur = useStudyTrailStore.getState()
    if (cur.currentTrailSessionId) return // already knows about a session — don't clobber it
    // Seed sessionNodeIndex from whatever this session already has (a page reload, or this
    // window mounting after the session was started elsewhere) — without this, every already-
    // visited chapter would look "new" to THIS window's recorder until it independently
    // rediscovers each one, defeating the reopen-instead-of-duplicate logic below.
    const detail = await window.studyTrail.getSession(active.id).catch(() => null)
    const sessionNodeIndex: Record<string, string> = {}
    if (detail) for (const n of detail.nodes) sessionNodeIndex[`${n.bookId}:${n.chapter}`] = n.id
    useStudyTrailStore.setState({ currentTrailSessionId: active.id, trailSessionStatus: active.status, sessionNodeIndex })
  }).catch((err) => { if (window.__bereanTrailDebug) console.log('[TrailDebug] bootstrap listSessions FAILED', err) })

  window.app.onStudyTrailStateChanged?.((raw) => {
    const incoming = raw as {
      currentTrailSessionId: string | null; trailSessionStatus: TrailSessionStatus | null
      seedAnchor?: { nodeId: string; bookId: string; chapter: number }
    }
    if (window.__bereanTrailDebug) console.log('[TrailDebug] received broadcast', incoming)
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
              sessionNodeIndex: { [`${incoming.seedAnchor.bookId}:${incoming.seedAnchor.chapter}`]: incoming.seedAnchor.nodeId },
            }
          : { currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0, currentAnchorActivatedAt: null, currentAnchorIsRevisit: false, sessionNodeIndex: {} }
        : {}),
    })
  })
}

// The glance window — a reversal back to the origin chapter within this long, with no other
// navigation in between, retroactively marks the connection as a low-weight 'glance' rather
// than a full tangent. Nothing is ever deleted, only re-weighted.
const GLANCE_WINDOW_MS = 2500

// Revisit-promotion thresholds — either crossing counts as "genuine re-engagement" (see the
// promotion check in installStudyTrailRecorder below). Verse count catches "read a few more
// verses and moved on" quickly even if they didn't linger; dwell time catches "sat there
// actually thinking about it" even without triggering more verse-view navigations.
const REVISIT_PROMOTE_VERSE_THRESHOLD = 3
const REVISIT_PROMOTE_DWELL_MS = 45_000
let pendingGlanceCheck: { connectionId: string; fromBookId: string; fromChapter: number; timer: ReturnType<typeof setTimeout> } | null = null

/** Installed once at app startup (see src/App.tsx) so every navigateToVerse() call anywhere
 *  in the app feeds Study Trail without those call sites needing to know it exists. */
export function installStudyTrailRecorder(): void {
  setNavRecorder((from, to, origin) => {
    const s = useStudyTrailStore.getState()
    if (window.__bereanTrailDebug) {
      console.log('[TrailDebug] recorder callback entry', {
        currentTrailSessionId: s.currentTrailSessionId, trailSessionStatus: s.trailSessionStatus,
        currentAnchorNodeId: s.currentAnchorNodeId, from, to, origin,
      })
    }
    if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live') {
      if (window.__bereanTrailDebug) console.log('[TrailDebug] recorder: no live session in THIS window\'s store — nothing recorded')
      return
    }
    if (!to.bookId || to.chapter == null) {
      if (window.__bereanTrailDebug) console.log('[TrailDebug] recorder: missing to.bookId/chapter — nothing recorded', to)
      return
    }

    const sameChapter = s.currentAnchorBookId === to.bookId && s.currentAnchorChapter === to.chapter
    if (sameChapter && s.currentAnchorNodeId) {
      // Still reading the same chapter — no new connection. The counter keeps incrementing
      // (it's one of the two revisit-promotion engagement signals, alongside dwell time — see
      // REVISIT_PROMOTE_VERSE_THRESHOLD below), but it's a count of same-chapter NAVIGATION
      // EVENTS (clicking a verse number, a cross-ref landing back here, etc.), not verses
      // actually read — there's no scroll-position tracking behind it, so it was never
      // honest to display as "read N verses in this chapter" (a plain scroll-through with no
      // further verse-targeted navigation left it at 0 regardless of how much was actually
      // read). No cachedSubnote claim is written for this anymore; the real, verifiable
      // per-visit facts (arrival time, total dwell duration) are still shown via the hover
      // card, which doesn't need to assert an unverifiable read count.
      const count = s.currentAnchorVerseCount + 1
      useStudyTrailStore.setState({ currentAnchorVerseCount: count })
      if (window.__bereanTrailDebug) console.log('[TrailDebug] same chapter — counted toward engagement only, no subnote/connection', { nodeId: s.currentAnchorNodeId, count })
      return
    }

    const trailSessionId = s.currentTrailSessionId
    const prevNodeId = s.currentAnchorNodeId
    const { text, tags } = reasonForOrigin(origin)
    const tier = tierForOrigin(origin)
    if (window.__bereanTrailDebug) {
      console.log('[TrailDebug] different chapter — recording', { trailSessionId, prevNodeId, to, tier, text, tags, originKind: origin.kind })
    }

    // A compare-view column change is its own connection kind, not a chapter tangent — the
    // user is still anchored on whatever they were reading, just glancing at a second
    // translation alongside it. Record the connection without moving the anchor or creating
    // a new node for it.
    if (origin.kind === 'compare-column') {
      if (prevNodeId) {
        window.studyTrail.addConnection({
          trailSessionId, fromNodeId: prevNodeId, toKind: 'compare',
          toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse,
          clarityTier: tier, reasonText: text, reasonTags: tags, weight: 'full',
        })
          .then((conn) => { if (window.__bereanTrailDebug) console.log('[TrailDebug] addConnection (compare) SUCCEEDED', conn) })
          .catch((err) => console.error('[TrailDebug] addConnection (compare) FAILED', err))
      } else if (window.__bereanTrailDebug) {
        console.log('[TrailDebug] compare-column but no prevNodeId — nothing to connect FROM, skipped')
      }
      return
    }

    // A genuinely different chapter — this earns a connection FROM the current anchor (if
    // any). If this exact chapter already has a node in the session (the spine-drift fix:
    // an occurrence/search/wikilink detour landing back on an already-read chapter, or any
    // plain revisit), REOPEN that existing node instead of creating a duplicate — the spine
    // then reads as a real round trip (this connection's destination matches an earlier node)
    // rather than the anchor permanently dragging forward through the detour.
    const key = `${to.bookId}:${to.chapter}`
    const existingNodeId = s.sessionNodeIndex[key]
    if (window.__bereanTrailDebug) console.log('[TrailDebug] resolving node for chapter', { key, existingNodeId, willReopen: !!existingNodeId })

    ;(async () => {
      // Revisit promotion — checked as we LEAVE, not as we arrive. If the anchor being left
      // was itself a reopened node (not a fresh first visit) and THIS particular visit
      // involved real engagement (read several verses, or spent real time — either counts,
      // since a quick glance at one verse and an unusually long stare at zero new verses are
      // both genuine signals), split it off into its own new spine node positioned at when
      // this visit actually began — instead of forever folding it into the chapter's frozen
      // first-visit position, which is what read as "this happened in the past" even for a
      // substantial re-engagement happening right now. A brief bounce-through never crosses
      // either threshold, so it still resolves exactly as before (a quiet return curve to the
      // original position) — this doesn't reintroduce the "spine drift" bug the reuse
      // mechanism was originally built to fix, since reopenNode's own arrival behavior is
      // completely unchanged.
      let effectivePrevNodeId = prevNodeId
      if (prevNodeId && s.currentAnchorIsRevisit && s.currentAnchorActivatedAt != null && s.currentAnchorBookId && s.currentAnchorChapter != null) {
        const dwellMs = Date.now() - s.currentAnchorActivatedAt
        const engaged = s.currentAnchorVerseCount >= REVISIT_PROMOTE_VERSE_THRESHOLD || dwellMs >= REVISIT_PROMOTE_DWELL_MS
        if (window.__bereanTrailDebug) {
          console.log('[TrailDebug] revisit-promotion check', { prevNodeId, verseCount: s.currentAnchorVerseCount, dwellMs, engaged })
        }
        if (engaged) {
          try {
            const promoted = await window.studyTrail.promoteRevisit({
              trailSessionId, originalNodeId: prevNodeId, bookId: s.currentAnchorBookId, chapter: s.currentAnchorChapter,
              activatedAt: s.currentAnchorActivatedAt,
            })
            if (window.__bereanTrailDebug) console.log('[TrailDebug] promoteRevisit SUCCEEDED', promoted)
            effectivePrevNodeId = promoted.id
            const promotedKey = `${s.currentAnchorBookId}:${s.currentAnchorChapter}`
            useStudyTrailStore.setState((st) => ({ sessionNodeIndex: { ...st.sessionNodeIndex, [promotedKey]: promoted.id } }))
          } catch (err) {
            console.error('[TrailDebug] promoteRevisit FAILED — keeping the original node as the connection source', err)
          }
        }
      }

      let node = await (existingNodeId
        ? window.studyTrail.reopenNode(existingNodeId)
        : window.studyTrail.addNode({ trailSessionId, bookId: to.bookId, chapter: to.chapter, orderIndex: Date.now(), originLabel: origin.kind }))
      if (!node) { // reopenNode found nothing (stale index entry) — fall back to a fresh node
        node = await window.studyTrail.addNode({ trailSessionId, bookId: to.bookId, chapter: to.chapter, orderIndex: Date.now(), originLabel: origin.kind })
      }
      if (window.__bereanTrailDebug) console.log('[TrailDebug] node resolved — new anchor', node)
      useStudyTrailStore.setState((st) => ({
        currentAnchorNodeId: node!.id, currentAnchorBookId: to.bookId, currentAnchorChapter: to.chapter, currentAnchorVerseCount: 1,
        currentAnchorActivatedAt: Date.now(), currentAnchorIsRevisit: !!existingNodeId,
        sessionNodeIndex: { ...st.sessionNodeIndex, [key]: node!.id },
      }))
      if (!effectivePrevNodeId) {
        if (window.__bereanTrailDebug) console.log('[TrailDebug] no prevNodeId (first anchor of session) — nothing to connect FROM')
        return
      }
      if (effectivePrevNodeId === node!.id) {
        if (window.__bereanTrailDebug) console.log('[TrailDebug] reopened the SAME node we were already on — nothing to connect')
        return
      }
      const conn = await window.studyTrail.addConnection({
        trailSessionId, fromNodeId: effectivePrevNodeId, toKind: 'chapter',
        toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse,
        clarityTier: tier, reasonText: text, reasonTags: tags, weight: 'full',
      })
      if (window.__bereanTrailDebug) console.log('[TrailDebug] addConnection (chapter) SUCCEEDED', conn)
      // Arm the glance check: if the user bounces straight back to where they came from
      // within the window, this connection gets re-weighted down to a glance.
      if (pendingGlanceCheck) clearTimeout(pendingGlanceCheck.timer)
      if (from.bookId && from.chapter != null) {
        pendingGlanceCheck = {
          connectionId: conn.id, fromBookId: from.bookId, fromChapter: from.chapter,
          timer: setTimeout(() => { pendingGlanceCheck = null }, GLANCE_WINDOW_MS),
        }
      }
    })().catch((err) => console.error('[TrailDebug] node resolution or its follow-up addConnection FAILED — this was previously silently swallowed', err))

    // If THIS navigation is itself the "bounce back" a previous connection was waiting on,
    // mark that one a glance instead of a full connection.
    if (pendingGlanceCheck && pendingGlanceCheck.fromBookId === to.bookId && pendingGlanceCheck.fromChapter === to.chapter) {
      clearTimeout(pendingGlanceCheck.timer)
      const glanceConnId = pendingGlanceCheck.connectionId
      if (window.__bereanTrailDebug) console.log('[TrailDebug] bounce-back detected — marking glance', pendingGlanceCheck)
      window.studyTrail.markGlance(glanceConnId)
        .then(() => { if (window.__bereanTrailDebug) console.log('[TrailDebug] markGlance SUCCEEDED', { connectionId: glanceConnId }) })
        .catch((err) => console.error('[TrailDebug] markGlance FAILED', err))
      pendingGlanceCheck = null
    }
  })
}
