import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { navigateToVerse } from '@/lib/verseNavigation'
import { bookChapterVerseLabel, getTranslationForBook } from '@/lib/parseRef'
import { installTrailNavigator, type TrailRef } from '@/components/studyTrail/trailNav'
import type { SpaceId } from '@/types'

/**
 * Navigation out of the trail views on the phone. The desktop views route ⌘-click / context-menu
 * "Open" through `window.app.navigateMainToRef` (a second window); here the store is the same
 * one the reader uses, so this does exactly what App.tsx's onNavigateToRef listener does — and a
 * plain tap counts as "open" (there is no ⌘ key on a phone, see trailNav.ts).
 */
export function navigateTrailRefOnPhone(ref: TrailRef, newTab: boolean, onOpenSpace?: (space: SpaceId) => void): void {
  const s = useAppStore.getState()
  if (ref.kind === 'lexicon') {
    if (newTab) s.createTab('lexicon'); else s.ensureTab('lexicon')
    s.openLexiconEntry(ref.strongsNum)
    s.setActiveSpace('lexicon')
    onOpenSpace?.('lexicon')
    return
  }
  if (newTab) {
    const translation = (getTranslationForBook(ref.bookId) ?? 'kjva').toUpperCase()
    s.addTab({
      id: `bible-${Date.now()}`, spaceId: 'scripture', type: 'bible', title: bookChapterVerseLabel(ref.bookId, ref.chapter),
      state: { bookId: ref.bookId, chapter: ref.chapter, targetVerse: ref.verse, translation, showStrongs: false, scrollPosition: 0 },
    })
  } else {
    navigateToVerse({ bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, origin: { kind: 'other', label: 'study-trail' } })
  }
  useAppStore.getState().setActiveSpace('scripture')
  onOpenSpace?.('scripture')
}

/** Installs the phone navigator into the shared trail views for the lifetime of the page. */
export function useTrailNavigatorOnPhone(onOpenSpace?: (space: SpaceId) => void): void {
  useEffect(() => installTrailNavigator((ref, newTab) => navigateTrailRefOnPhone(ref, newTab, onOpenSpace), { plainClickNavigates: true }), [onOpenSpace])
}

export const OPEN_STUDY_TRAIL_PAGE_EVENT = 'berean:openStudyTrailPage'

/** `window.app.openStudyTrailWindow()` on the phone dispatches this event (bridgeExtras.ts); the
 *  shell attaches a handler that pushes the Study Trail page. */
export function useOpenStudyTrailPageEvent(cb: () => void): void {
  useEffect(() => {
    const h = () => cb()
    window.addEventListener(OPEN_STUDY_TRAIL_PAGE_EVENT, h)
    return () => window.removeEventListener(OPEN_STUDY_TRAIL_PAGE_EVENT, h)
  }, [cb])
}
