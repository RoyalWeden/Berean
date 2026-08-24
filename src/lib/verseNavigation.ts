import { useAppStore } from '@/store'
import { getTranslationForBook, isDedicatedTranslation, bookChapterVerseLabel } from '@/lib/parseRef'
import type { BibleTabState } from '@/types'

/**
 * Where a scripture navigation originated — every call site passes one of these so Study
 * Trail (src/lib/studyTrailRecorder.ts) can assign the right clarity tier without each caller
 * needing to know anything about Study Trail itself. Kept here (not in studyTrail types)
 * since it's meaningful navigation metadata on its own, independent of whether Study Trail
 * recording is even wired up yet.
 */
export type NavOrigin =
  | { kind: 'verse-popover' }                                            // VerseRow "Open verse" / cross-ref hover
  | { kind: 'cross-ref'; source: 'tske' | 'classic' | 'notes'; reason?: string } // BibleRightPanel ref rows
  | { kind: 'search-result'; query: string }                             // ScriptureSearchView / SearchTab / FloatingSearch
  | { kind: 'lexicon-occurrence'; strongsNum: string }                   // LexiconPanel occurrence row
  | { kind: 'note-wikilink'; noteId: string; noteTitle: string }          // NotesPanel wikilink/verse-ref click
  | { kind: 'ai-lookup'; question: string }                              // AiLookupPanel suggested verse
  | { kind: 'compare-column' }                                           // CompareView column change
  | { kind: 'book-chapter-picker' }                                      // manual chapter/book picker — ambiguous
  | { kind: 'history-revisit' }                                          // HistoryModal reopen
  | { kind: 'sequential-nav' }                                           // plain prev/next-chapter arrow — the reading "spine", not a tangent
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
export function navigateToVerse(args: NavigateToVerseArgs): void {
  const { bookId, chapter, verse, endVerse, origin, noteBack, translationOverride } = args
  const s = useAppStore.getState()
  s.ensureTab('bible')
  const fresh = useAppStore.getState()
  const tabId = fresh.activeTabId['scripture']
  if (!tabId) return

  const curTab = fresh.tabs['scripture'].find((t) => t.id === tabId)
  const cur = curTab?.state as BibleTabState | undefined
  const currentTranslation = cur?.translation ?? 'kjva'
  const scriptureBack = cur
    ? { bookId: cur.bookId, chapter: cur.chapter, verse: cur.targetVerse, label: bookChapterVerseLabel(cur.bookId, cur.chapter), translation: currentTranslation }
    : null

  // Auto-switch translation:
  //   • target book has a dedicated translation (e.g. enoch, jubilees) → use it
  //   • current translation is dedicated but target book is canonical → switch to kjva
  const dedicatedTarget = getTranslationForBook(bookId)
  let newTranslation: string | undefined
  if (dedicatedTarget) {
    newTranslation = dedicatedTarget
  } else if (isDedicatedTranslation(currentTranslation)) {
    newTranslation = 'kjva'
  }
  if (translationOverride) newTranslation = translationOverride

  fresh.updateTabState('scripture', tabId, {
    bookId, chapter, targetVerse: verse,
    endVerse: endVerse ?? undefined,
    scrollPosition: 0,
    ...(newTranslation ? { translation: newTranslation } : {}),
    ...(scriptureBack ? { scriptureBack } : {}),
    ...(noteBack !== undefined ? { noteBack } : {}),
  })
  s.setActiveSpace('scripture')

  // Study Trail recording — a no-op until Phase 1 installs a recorder via setNavRecorder().
  // Kept as an injected callback (not a direct import) so this module has zero dependency
  // on Study Trail's IPC/store wiring; verseNavigation.ts works standalone either way.
  if (typeof window !== 'undefined' && window.__bereanTrailDebug) {
    console.log('[TrailDebug] navigateToVerse fired', { origin, to: { bookId, chapter, verse }, recorderInstalled: !!navRecorder })
  }
  navRecorder?.({ bookId: cur?.bookId, chapter: cur?.chapter, verse: cur?.targetVerse }, { bookId, chapter, verse }, origin)
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
  if (typeof window !== 'undefined' && window.__bereanTrailDebug) {
    console.log('[TrailDebug] recordNavigation fired', { origin, from, to, recorderInstalled: !!navRecorder })
  }
  navRecorder?.(from, to, origin)
}

type NavRecorder = (
  from: { bookId?: string; chapter?: number; verse?: number },
  to: { bookId: string; chapter: number; verse?: number },
  origin: NavOrigin,
) => void

let navRecorder: NavRecorder | null = null

/** Installed once by Study Trail's initialization (Phase 1) — see src/lib/studyTrailRecorder.ts. */
export function setNavRecorder(recorder: NavRecorder | null): void {
  navRecorder = recorder
}
