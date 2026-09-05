import { lazy, Suspense, type ReactNode } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import SearchTab from '@/components/search/SearchTab'
import PDFViewer from '@/components/pdf/PDFViewer'
import ErrorBoundary from './ErrorBoundary'
import { ActivePanelContext } from './ActivePanelContext'
import { BookOpen } from 'lucide-react'
import type { TabType } from '@/types'

// YouTubeTab is large (~2.6k lines w/ webview wiring) and only needed once a
// YouTube tab exists — code-split so it stays out of the initial bundle.
const importYouTubeTab = () => import('@/components/youtube/YouTubeTab')
const YouTubeTab = lazy(importYouTubeTab)

// Prewarm the YouTube chunk once the app is idle after first paint, so the first
// time a YouTube tab is opened it's a mount (still not instant — webview wiring)
// rather than mount + a cold chunk fetch/parse on top. Fire-and-forget; the lazy()
// above dedupes against this if the user opens YouTube before idle fires.
if (typeof window !== 'undefined') {
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined
  const warm = () => { void importYouTubeTab().catch(() => {}) }
  if (ric) ric(warm, { timeout: 4000 })
  else setTimeout(warm, 2500)
}

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

// One always-mounted layer. `visible` toggles `display` (not visibility/opacity):
// an offscreen but display:'block' panel still runs layout, and for the embedded
// YouTube <webview> a GPU-composited surface that keeps painting for a beat after
// an ancestor goes visibility:hidden (the original reason YouTube used display:none
// here). Kept mounted so switching back is a display flip — no unmount, no refetch,
// no editor rebuild, scroll position still in the DOM.
function Layer({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div className={`absolute inset-0 ${visible ? '' : 'hidden pointer-events-none'}`}>
      {children}
    </div>
  )
}

export default function ActivePanel() {
  // Project ONLY the stable identity bits of each space's active tab — never the
  // tab's `.state`. useShallow over these primitives means a tab-state write (a
  // scroll-position tick in ANY space, a Strong's toggle, a panel resize) does
  // NOT re-render ActivePanel, and therefore doesn't re-render every mounted
  // panel underneath it. Each panel subscribes to what it actually needs itself.
  const { activeSpace, scriptureTabId, scriptureTabType, hasNotesTab, hasLexiconTab, hasSearchTab, hasYouTubeTab } = useAppStore(
    useShallow((s) => {
      const scriptureTab = s.tabs.scripture.find((t) => t.id === s.activeTabId.scripture) ?? null
      return {
        activeSpace: s.activeSpace,
        scriptureTabId: scriptureTab?.id ?? null,
        scriptureTabType: scriptureTab?.type ?? null,
        hasNotesTab:   s.tabs.notes.some((t) => t.id === s.activeTabId.notes),
        hasLexiconTab: s.tabs.lexicon.some((t) => t.id === s.activeTabId.lexicon),
        hasSearchTab:  s.tabs.search.some((t) => t.id === s.activeTabId.search),
        hasYouTubeTab: s.tabs.youtube.some((t) => t.id === s.activeTabId.youtube),
      }
    })
  )

  // The panel type actually shown right now = the active space's active tab's type.
  const activeType: TabType | null =
    activeSpace === 'scripture' ? scriptureTabType :
    activeSpace === 'notes'     ? (hasNotesTab ? 'note' : null) :
    activeSpace === 'lexicon'   ? (hasLexiconTab ? 'lexicon' : null) :
    activeSpace === 'search'    ? (hasSearchTab ? 'search' : null) :
    activeSpace === 'youtube'   ? (hasYouTubeTab ? 'youtube' : null) :
    null

  // The Scripture space holds two panel types (bible + pdf); the rest are 1:1
  // with a space. The scripture layer swaps bible↔pdf by key (rare) and shares
  // one `panel:bible` key across every scripture tab so a Bible→Bible switch
  // updates in place (BiblePanel has render-phase reset for its mount-scoped
  // state — see prevBibleTabIdForResetRef).
  const scriptureVisible = activeSpace === 'scripture'
  const scriptureKey = scriptureTabType
    ? (scriptureTabType === 'bible' ? 'panel:bible' : scriptureTabId ?? 'empty')
    : 'empty'

  return (
    <ActivePanelContext.Provider value={activeType}>
      <div className="h-full w-full relative">
        {scriptureTabType && (
          <Layer visible={scriptureVisible}>
            <div key={scriptureKey} className="absolute inset-0">
              {scriptureTabType === 'bible' && (
                <ErrorBoundary label="Bible panel error"><BiblePanel /></ErrorBoundary>
              )}
              {scriptureTabType === 'pdf' && (
                <ErrorBoundary label="PDF viewer error"><PDFViewer /></ErrorBoundary>
              )}
            </div>
          </Layer>
        )}

        {hasNotesTab && (
          <Layer visible={activeSpace === 'notes'}>
            <ErrorBoundary label="Notes panel error"><NotesPanel /></ErrorBoundary>
          </Layer>
        )}

        {hasLexiconTab && (
          <Layer visible={activeSpace === 'lexicon'}>
            <ErrorBoundary label="Lexicon panel error"><LexiconPanel /></ErrorBoundary>
          </Layer>
        )}

        {hasSearchTab && (
          <Layer visible={activeSpace === 'search'}>
            <ErrorBoundary label="Search error"><SearchTab /></ErrorBoundary>
          </Layer>
        )}

        {/* YouTube: always mounted (PiP continuity) + code-split. Same display:none
            hide as the others — see Layer's comment. */}
        {hasYouTubeTab && (
          <Layer visible={activeSpace === 'youtube'}>
            <ErrorBoundary label="YouTube error">
              <Suspense fallback={null}><YouTubeTab /></Suspense>
            </ErrorBoundary>
          </Layer>
        )}

        {activeType === null && (
          <div className="absolute inset-0"><EmptyState /></div>
        )}
      </div>
    </ActivePanelContext.Provider>
  )
}
