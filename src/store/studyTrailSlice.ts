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

  startTrailSession: (name: string) => Promise<void>
  pauseTrailSession: () => Promise<void>
  resumeTrailSession: () => Promise<void>
  renameTrailSession: (name: string) => Promise<void>
  endTrailSession: () => void
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
    case 'other': return 3
  }
}

export function reasonForOrigin(origin: NavOrigin): { text?: string; tags: string[] } {
  switch (origin.kind) {
    case 'cross-ref': return { text: origin.reason, tags: [`cross-ref:${origin.source}`] }
    case 'lexicon-occurrence': return { text: `Strong's ${origin.strongsNum} occurrence`, tags: ['lexicon'] }
    case 'ai-lookup': return { text: origin.question, tags: ['ai-lookup'] }
    case 'search-result': return { text: `search: "${origin.query}"`, tags: ['search'] }
    case 'note-wikilink': return { text: `note: ${origin.noteTitle}`, tags: ['note'] }
    case 'book-chapter-picker': return { tags: ['manual'] }
    case 'other': return { text: origin.label, tags: [] }
    default: return { tags: [] }
  }
}

export const useStudyTrailStore = create<StudyTrailState>()((set, get) => ({
  currentTrailSessionId: null,
  trailSessionStatus: null,
  currentAnchorNodeId: null,
  currentAnchorBookId: null,
  currentAnchorChapter: null,
  currentAnchorVerseCount: 0,

  startTrailSession: async (name: string) => {
    const session = await window.studyTrail.startSession(name)
    set({ currentTrailSessionId: session.id, trailSessionStatus: 'live', currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null })
  },
  pauseTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.pauseSession(id)
    set({ trailSessionStatus: 'paused' })
  },
  resumeTrailSession: async () => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.resumeSession(id)
    set({ trailSessionStatus: 'live' })
  },
  renameTrailSession: async (name: string) => {
    const id = get().currentTrailSessionId
    if (!id) return
    await window.studyTrail.renameSession(id, name)
  },
  endTrailSession: () => {
    set({ currentTrailSessionId: null, trailSessionStatus: null, currentAnchorNodeId: null, currentAnchorBookId: null, currentAnchorChapter: null, currentAnchorVerseCount: 0 })
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
  if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live' || !s.currentAnchorNodeId) return
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
  }).catch(() => {})
}

// The glance window — a reversal back to the origin chapter within this long, with no other
// navigation in between, retroactively marks the connection as a low-weight 'glance' rather
// than a full tangent. Nothing is ever deleted, only re-weighted.
const GLANCE_WINDOW_MS = 2500
let pendingGlanceCheck: { connectionId: string; fromBookId: string; fromChapter: number; timer: ReturnType<typeof setTimeout> } | null = null

/** Installed once at app startup (see src/App.tsx) so every navigateToVerse() call anywhere
 *  in the app feeds Study Trail without those call sites needing to know it exists. */
export function installStudyTrailRecorder(): void {
  setNavRecorder((from, to, origin) => {
    const s = useStudyTrailStore.getState()
    if (!s.currentTrailSessionId || s.trailSessionStatus !== 'live') return
    if (!to.bookId || to.chapter == null) return

    const sameChapter = s.currentAnchorBookId === to.bookId && s.currentAnchorChapter === to.chapter
    if (sameChapter && s.currentAnchorNodeId) {
      // Still reading the same chapter — update the subnote, no new connection.
      const count = s.currentAnchorVerseCount + 1
      useStudyTrailStore.setState({ currentAnchorVerseCount: count })
      window.studyTrail.updateNodeSubnote(s.currentAnchorNodeId, `read ${count} verse${count === 1 ? '' : 's'} in this chapter`).catch(() => {})
      return
    }

    // A genuinely different chapter — this earns a connection FROM the current anchor (if
    // any), and becomes the new anchor itself.
    const trailSessionId = s.currentTrailSessionId
    const prevNodeId = s.currentAnchorNodeId
    const { text, tags } = reasonForOrigin(origin)
    const tier = tierForOrigin(origin)

    window.studyTrail.addNode({ trailSessionId, bookId: to.bookId, chapter: to.chapter, orderIndex: Date.now(), originLabel: origin.kind })
      .then(async (node) => {
        useStudyTrailStore.setState({ currentAnchorNodeId: node.id, currentAnchorBookId: to.bookId, currentAnchorChapter: to.chapter, currentAnchorVerseCount: 1 })
        if (!prevNodeId) return // first anchor of the session — nothing to connect FROM yet
        const conn = await window.studyTrail.addConnection({
          trailSessionId, fromNodeId: prevNodeId, toKind: 'chapter',
          toBookId: to.bookId, toChapter: to.chapter, toVerse: to.verse,
          clarityTier: tier, reasonText: text, reasonTags: tags, weight: 'full',
        })
        // Arm the glance check: if the user bounces straight back to where they came from
        // within the window, this connection gets re-weighted down to a glance.
        if (pendingGlanceCheck) clearTimeout(pendingGlanceCheck.timer)
        if (from.bookId && from.chapter != null) {
          pendingGlanceCheck = {
            connectionId: conn.id, fromBookId: from.bookId, fromChapter: from.chapter,
            timer: setTimeout(() => { pendingGlanceCheck = null }, GLANCE_WINDOW_MS),
          }
        }
      })
      .catch(() => {})

    // If THIS navigation is itself the "bounce back" a previous connection was waiting on,
    // mark that one a glance instead of a full connection.
    if (pendingGlanceCheck && pendingGlanceCheck.fromBookId === to.bookId && pendingGlanceCheck.fromChapter === to.chapter) {
      clearTimeout(pendingGlanceCheck.timer)
      window.studyTrail.markGlance(pendingGlanceCheck.connectionId).catch(() => {})
      pendingGlanceCheck = null
    }
  })
}
