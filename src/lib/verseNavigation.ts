import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { resolveTextForBook, chapterForBookSwitch } from '@/lib/textCoverage'
import type { BibleTabState } from '@/types'

/**
 * Where a scripture navigation originated — every call site passes one of these so Study
 * Trail (src/lib/studyTrailRecorder.ts) can assign the right clarity tier without each caller
 * needing to know anything about Study Trail itself. Kept here (not in studyTrail types)
 * since it's meaningful navigation metadata on its own, independent of whether Study Trail
 * recording is even wired up yet.
 */
/** Verses the user had selected (via verse-number click) at the moment they navigated away —
 *  attached to any NavOrigin below so Study Trail can note "(from Gen 1:3, 1:7)" on the
 *  connection and pin the tangent to that verse. Cleared once the navigation is recorded. */
export interface NavFromSelectionRef { bookId: string; chapter: number; verse: number }

export type NavOrigin = NavOriginKind & { fromSelection?: NavFromSelectionRef[] }

type NavOriginKind =
  | { kind: 'verse-popover' }                                            // VerseRow "Open verse" / cross-ref hover
  | { kind: 'cross-ref'; source: 'tske' | 'classic' | 'notes'; reason?: string; fromVerse?: number } // BibleRightPanel ref rows — fromVerse is the SPECIFIC verse whose cross-ref list this came from (the right panel's activeVerseNum), not just "some verse in the chapter"
  | { kind: 'search-result'; query: string }                             // ScriptureSearchView / SearchTab / FloatingSearch
  | { kind: 'lexicon-occurrence'; strongsNum: string }                   // LexiconPanel occurrence row
  | { kind: 'note-wikilink'; noteId: string; noteTitle: string }          // NotesPanel wikilink/verse-ref click
  | { kind: 'ai-lookup'; question: string; fromVerse?: number }          // AiLookupPanel suggested verse — fromVerse set when this suggestion was itself a nested cross-ref result (AiLookupResult.crossRefOf), so it's exactly as traceable as a right-panel cross-ref click
  | { kind: 'compare-column' }                                           // CompareView column change
  | { kind: 'book-chapter-picker' }                                      // manual chapter/book picker — ambiguous
  | { kind: 'history-revisit' }                                          // HistoryModal reopen
  | { kind: 'sequential-nav' }                                           // plain prev/next-chapter arrow — the reading "spine", not a tangent
  | { kind: 'tab-switch' }                                               // clicking an ALREADY-OPEN scripture tab in the sidebar
  | { kind: 'other'; label?: string }

export interface NavigateToVerseArgs {
  bookId: string
  chapter: number
  verse?: number
  endVerse?: number | null
  origin: NavOrigin
  /** Only when navigating from a verse ref clicked inside a note shown in a side/main panel —
   *  records which note to return to. Mirrors the pre-refactor `noteBack` parameter. */
  noteBack?: { noteId: string; title: string } | null
  /** Overrides the dedicated-translation auto-switch entirely — e.g. a Lexicon occurrence
   *  row already knows for certain which text (KJVA vs. LXX) the match came from. */
  translationOverride?: string
}

/**
 * Single shared scripture-navigation function — replaces ~11 near-duplicate
 * `updateTabState('scripture', ...)` call sites that each re-implemented capturing
 * `scriptureBack`, the dedicated-translation auto-switch, `ensureTab`, and `setActiveSpace`.
 * Also the one place Study Trail hooks into for recording (see recordNavigation() call below,
 * wired in Phase 1 — kept as a single optional side effect here rather than duplicated at
 * every call site).
 */
/** Fold any active verse-number selection into `origin.fromSelection`, then clear it —
 *  the selection's whole purpose is to say "I was looking at these when I jumped", so it's
 *  consumed by the jump. No-op (returns origin unchanged) when nothing is selected. */
function consumeSelectionInto(origin: NavOrigin): NavOrigin {
  // A plain tab switch isn't "navigating away using the selection as context" — each scripture
  // tab keeps its own selection, so switching tabs must NOT clear it.
  if (origin.kind === 'tab-switch') return origin
  const s = useAppStore.getState()
  const tid = s.activeTabId['scripture']
  const sel = tid ? (s.selectedVersesByTab[tid] ?? []) : []
  if (sel.length === 0) return origin
  s.clearVerseSelection(tid ?? undefined)
  return {
    ...origin,
    fromSelection: sel.map((v) => ({ bookId: v.bookId, chapter: v.chapter, verse: v.verse })),
  }
}

export function navigateToVerse(args: NavigateToVerseArgs): void {
  const { bookId, verse, endVerse, noteBack, translationOverride } = args
  // A chapter the book does not have (Genesis 50 → Ruth) opens chapter 1 instead (TEST-025).
  const chapter = chapterForBookSwitch(bookId, args.chapter)
  const origin = consumeSelectionInto(args.origin)
  const s = useAppStore.getState()
  s.ensureTab('bible')
  // The active Scripture tab may be a PDF / tags-graph tab: a verse must land in a Bible tab
  // (the most recently used one, else a new one), never be written into that tab's state.
  {
    const st = useAppStore.getState()
    const active = st.tabs['scripture'].find((t) => t.id === st.activeTabId['scripture'])
    if (active && active.type !== 'bible') {
      const isBible = (id: string) => st.tabs['scripture'].some((t) => t.id === id && t.type === 'bible')
      const mru = st.tabMRUList.find((m) => m.spaceId === 'scripture' && isBible(m.tabId))
      const target = mru ? st.tabs['scripture'].find((t) => t.id === mru.tabId) : st.tabs['scripture'].find((t) => t.type === 'bible')
      if (target) st.setActiveTab('scripture', target.id)
      else st.createTab('bible')
    }
  }
  const fresh = useAppStore.getState()
  const tabId = fresh.activeTabId['scripture']
  if (!tabId) return

  const curTab = fresh.tabs['scripture'].find((t) => t.id === tabId)
  const cur = curTab?.state as BibleTabState | undefined
  const currentTranslation = cur?.translation ?? 'kjva'
  const scriptureBack = cur
    ? { bookId: cur.bookId, chapter: cur.chapter, verse: cur.targetVerse, label: bookChapterVerseLabel(cur.bookId, cur.chapter), translation: currentTranslation }
    : null

  // Auto-switch translation (shared rule, src/lib/textCoverage.ts):
  //   • target book has a dedicated translation (e.g. enoch, jubilees) → use it
  //   • current translation is dedicated but target book is canonical → switch to kjva
  //   • current translation has no such book (LXX → a New Testament cross ref) → kjva (TEST-009)
  let newTranslation: string | undefined = resolveTextForBook(currentTranslation, bookId)
  if (translationOverride) newTranslation = translationOverride

  // Navigating from a note: record the note as the previous history entry of THIS Scripture
  // tab so ⌘[ / the Back button returns to it (cross-tab entry, handled by navTabBack).
  if (noteBack) fresh.pushTabNav(tabId, { type: 'note', title: noteBack.title, noteId: noteBack.noteId })

  fresh.updateTabState('scripture', tabId, {
    bookId, chapter, targetVerse: verse,
    endVerse: endVerse ?? undefined,
    scrollPosition: 0,
    ...(newTranslation ? { translation: newTranslation } : {}),
    ...(scriptureBack ? { scriptureBack } : {}),
    // Always resolve, never "leave whatever was there before": every call site either
    // knows it's navigating FROM a note ref click (passes the note to return to) or
    // doesn't (passes nothing) — the latter must CLEAR any stale noteBack, not preserve
    // it, or the "← back to note" pill in the reference bar keeps pointing at a note
    // that's no longer where the user actually came from (e.g. clicking an unrelated
    // cross-reference in the side panel left the old note's pill sitting there).
    noteBack: null,
  })
  s.setActiveSpace('scripture')

  // Study Trail recording — a no-op until Phase 1 installs a recorder via setNavRecorder().
  // Kept as an injected callback (not a direct import) so this module has zero dependency
  // on Study Trail's IPC/store wiring; verseNavigation.ts works standalone either way.
  navRecorder?.(
    { bookId: cur?.bookId, chapter: cur?.chapter, verse: cur?.targetVerse, translation: currentTranslation },
    { bookId, chapter, verse, endVerse: endVerse ?? undefined, translation: newTranslation ?? currentTranslation },
    origin,
  )
}

/**
 * Records a navigation with Study Trail WITHOUT performing any tab/state changes — for call
 * sites whose own tab-targeting logic (FloatingSearch's new/current/in-tab modes, Compare
 * view's per-column navigation, History's reopen) differs enough from navigateToVerse's
 * single-active-scripture-tab model that forcing them through it would risk regressing that
 * behavior. Those sites still perform their own navigation as before; this is just the
 * Study-Trail side effect navigateToVerse would otherwise have run for them.
 */
export function recordNavigation(
  from: { bookId?: string; chapter?: number; verse?: number },
  to: { bookId: string; chapter: number; verse?: number },
  origin: NavOrigin,
): void {
  navRecorder?.(from, to, consumeSelectionInto(origin))
}

export type NavRecorder = (
  from: { bookId?: string; chapter?: number; verse?: number; translation?: string },
  to: { bookId: string; chapter: number; verse?: number; endVerse?: number; translation?: string },
  origin: NavOrigin,
) => void

let navRecorder: NavRecorder | null = null

/** Installed once by Study Trail's initialization (Phase 1) — see src/lib/studyTrailRecorder.ts. */
export function setNavRecorder(recorder: NavRecorder | null): void {
  navRecorder = recorder
}
