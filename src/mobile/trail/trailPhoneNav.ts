import { useEffect } from 'react'
import { openDestination } from '@/lib/navigation/destination'
import { getTranslationForBook } from '@/lib/parseRef'
import { installTrailNavigator, type TrailRef } from '@/components/studyTrail/trailNav'
import type { SpaceId } from '@/types'

/**
 * Navigation out of the trail views on the phone. The desktop views route ⌘-click / context-menu
 * "Open" through `window.app.navigateMainToRef` (a second window); here the store is the same
 * one the reader uses, so this does exactly what App.tsx's onNavigateToRef listener does — and a
 * plain tap counts as "open" (there is no ⌘ key on a phone, see trailNav.ts).
 */
export function navigateTrailRefOnPhone(ref: TrailRef, newTab: boolean, onOpenSpace?: (space: SpaceId) => void): void {
  // The trail page sits over a tab: a plain tap changes THAT tab, the "new tab" gesture opens one
  // (NAV-002). It used to reuse the Scripture / Lexicon space's own tab — a different tab.
  const intent = newTab ? 'new-tab' : 'current-tab'
  if (ref.kind === 'lexicon') {
    openDestination({ kind: 'strongs', num: ref.strongsNum }, intent)
    onOpenSpace?.('lexicon')
    return
  }
  const textId = getTranslationForBook(ref.bookId) ?? undefined
  openDestination({ kind: 'passage', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, ...(textId ? { textId: textId.toLowerCase() } : {}) }, intent, { origin: { kind: 'other', label: 'study-trail' } })
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
