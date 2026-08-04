import { lazy, Suspense } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import SearchTab from '@/components/search/SearchTab'
import PDFViewer from '@/components/pdf/PDFViewer'
import ErrorBoundary from './ErrorBoundary'
import { BookOpen } from 'lucide-react'

// YouTubeTab is large (~2.6k lines w/ webview wiring) and only needed once a
// YouTube tab exists — code-split so it stays out of the initial bundle.
const YouTubeTab = lazy(() => import('@/components/youtube/YouTubeTab'))

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <BookOpen size={32} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-30" />
      <p className="text-sm text-[rgb(var(--color-text-muted))]">No tab open</p>
      <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1 opacity-60">
        Click a space button to open a new tab
      </p>
    </div>
  )
}

export default function ActivePanel() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTabId = useAppStore((s) => s.activeTabId)
  // Only two spaces are ever read here: whichever is active, and 'youtube' (kept always-mounted
  // for PiP continuity — see below). useShallow so a tab-state write in any OTHER space (e.g. a
  // Scripture scroll-position tick) doesn't re-render this, unlike subscribing to the whole
  // `s.tabs` record. See BiblePanel.tsx's comment for the underlying cause.
  const { activeSpaceTabs, youtubeTabs } = useAppStore(
    useShallow((s) => ({ activeSpaceTabs: s.tabs[s.activeSpace], youtubeTabs: s.tabs.youtube }))
  )

  const tabId = activeTabId[activeSpace]
  const tab = activeSpaceTabs.find((t) => t.id === tabId)

  // Always-mounted YouTube: keeps the webview alive across space switches so PiP and
  // video state are never lost. CSS visibility hides it without unmounting.
  const ytTabId = activeTabId['youtube']
  const ytTab = ytTabId ? youtubeTabs.find((t) => t.id === ytTabId) : null
  const isYouTubeActive = activeSpace === 'youtube'

  return (
    <div className="h-full w-full relative">
      {/* YouTube panel stays mounted at all times — hidden via CSS when not active */}
      {ytTab && (
        <div
          key={ytTab.id}
          className={`absolute inset-0 ${isYouTubeActive ? 'z-10' : 'invisible pointer-events-none'}`}
        >
          <ErrorBoundary label="YouTube error">
            <Suspense fallback={null}>
              <YouTubeTab />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* Non-YouTube panels (also covers YouTube empty state when no tab exists yet) */}
      {(!isYouTubeActive || !ytTab) && (
        <div className="absolute inset-0">
          {/* Plain keyed remount, no animation — an AnimatePresence crossfade used to sit
              here (mode="wait", 70ms opacity fade), but the two-phase exit-then-enter left a
              real gap where the outgoing panel had dissolved toward the backdrop before the
              incoming one materialized, reading as a visible "flash to something else" on
              every tab switch (reported: "it flashes... it should just be on the note").
              React's own key-based remount below swaps old for new in a single commit, so
              there's no intermediate frame to flash through, and — since old and new are never
              both mounted at once (no overlapping enter/exit) — no risk of the double-portaled-
              header collision the AnimatePresence's mode="wait" was originally added to avoid
              (see TabHeaderPortal). */}
          <div key={tab ? (tab.type === 'note' ? 'panel:note' : tab.id) : 'empty'} className="absolute inset-0">
            {!tab && <EmptyState />}
            {tab?.type === 'bible'   && <ErrorBoundary label="Bible panel error"><BiblePanel /></ErrorBoundary>}
            {tab?.type === 'note'    && <ErrorBoundary label="Notes panel error"><NotesPanel /></ErrorBoundary>}
            {tab?.type === 'lexicon' && <ErrorBoundary label="Lexicon panel error"><LexiconPanel /></ErrorBoundary>}
            {tab?.type === 'search'  && <ErrorBoundary label="Search error"><SearchTab /></ErrorBoundary>}
            {tab?.type === 'pdf'     && <ErrorBoundary label="PDF viewer error"><PDFViewer /></ErrorBoundary>}
          </div>
        </div>
      )}
    </div>
  )
}
