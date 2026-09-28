import { EmptyState as UiEmptyState, Button } from '@/components/ui'
import { lazy, Suspense, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { CROSSFADE } from '@/lib/motion'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import CalendarTabPanel from '@/components/notes/CalendarTabPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import SearchTab from '@/components/search/SearchTab'
import PDFViewer from '@/components/pdf/PDFViewer'
import ErrorBoundary from './ErrorBoundary'
import { ActivePanelContext } from './ActivePanelContext'
import { BookOpen, History as HistoryIcon, Settings as SettingsIcon } from 'lucide-react'
import type { TabType } from '@/types'

// YouTubeTab is large (~2.6k lines w/ webview wiring) and only needed once a
// YouTube tab exists — code-split so it stays out of the initial bundle.
const importYouTubeTab = () => import('@/components/youtube/YouTubeTab')
const YouTubeTab = lazy(importYouTubeTab)

// The Tags graph (canvas + force sim + SVG edges) is only needed once the singleton Tags tab is
// opened — code-split so it stays out of the initial bundle.
const TagsGraphPanel = lazy(() => import('@/components/tags/TagsGraphPanel'))

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

/** A dedicated History / Settings tab opened on the iPhone (T23-009) and synced here: the Mac
 *  keeps History and Settings as windows, so the tab offers to open them instead of a blank panel. */
function ToolTabFallback({ type }: { type: 'history' | 'settings' }) {
  const isHistory = type === 'history'
  return (
    <UiEmptyState
      icon={isHistory ? HistoryIcon : SettingsIcon}
      title={isHistory ? 'History' : 'Settings'}
      hint={`This tab was opened on iPhone. On the Mac, ${isHistory ? 'History' : 'Settings'} opens in its own window.`}
      action={<Button onClick={() => { const s = useAppStore.getState(); if (isHistory) s.openHistory(); else useAppStore.setState({ settingsOpen: true }) }}>Open {isHistory ? 'History' : 'Settings'}</Button>}
      className="h-full"
    />
  )
}

function EmptyState() {
  return <UiEmptyState icon={BookOpen} title="No tab open" hint="Click a space button to open a new tab" className="h-full" />
}

// One always-mounted layer. `visible` toggles `display` (not visibility/opacity):
// an offscreen but display:'block' panel still runs layout, and for the embedded
// YouTube <webview> a GPU-composited surface that keeps painting for a beat after
// an ancestor goes visibility:hidden (the original reason YouTube used display:none
// here). Kept mounted so switching back is a display flip — no unmount, no refetch,
// no editor rebuild, scroll position still in the DOM.
//
// §7.3/§70/§78: workspace/tab switching is Safari-like — the incoming layer crossfades in
// (120ms opacity, no slide/scale); the outgoing one just disappears (display:none happens on
// the same render, so it has nothing to animate anyway). The inner motion.div is unconditionally
// present (never conditionally wrapped) so toggling `visible` never unmounts/remounts `children`
// — the YouTube webview and every other panel's own mount-scoped state stay exactly as
// continuous as before this was added.
function Layer({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div className={`absolute inset-0 ${visible ? '' : 'hidden pointer-events-none'}`}>
      <motion.div
        initial={false}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={CROSSFADE.transition}
        className="absolute inset-0"
      >
        {children}
      </motion.div>
    </div>
  )
}

export default function ActivePanel() {
  // Project ONLY the stable identity bits of each space's active tab — never the
  // tab's `.state`. useShallow over these primitives means a tab-state write (a
  // scroll-position tick in ANY space, a Strong's toggle, a panel resize) does
  // NOT re-render ActivePanel, and therefore doesn't re-render every mounted
  // panel underneath it. Each panel subscribes to what it actually needs itself.
  const { activeSpace, scriptureTabId, scriptureTabType, notesTabType, notesTabId, hasNotesTab, hasLexiconTab, hasSearchTab, hasYouTubeTab, lexiconTabId, searchTabId, searchTabType } = useAppStore(
    useShallow((s) => {
      const scriptureTab = s.tabs.scripture.find((t) => t.id === s.activeTabId.scripture) ?? null
      const notesTab = s.tabs.notes.find((t) => t.id === s.activeTabId.notes) ?? null
      return {
        activeSpace: s.activeSpace,
        scriptureTabId: scriptureTab?.id ?? null,
        scriptureTabType: scriptureTab?.type ?? null,
        notesTabType: notesTab?.type ?? null,
        notesTabId: notesTab?.id ?? null,
        hasNotesTab:   s.tabs.notes.some((t) => t.id === s.activeTabId.notes),
        hasLexiconTab: s.tabs.lexicon.some((t) => t.id === s.activeTabId.lexicon),
        hasSearchTab:  s.tabs.search.some((t) => t.id === s.activeTabId.search),
        searchTabType: s.tabs.search.find((t) => t.id === s.activeTabId.search)?.type ?? null,
        lexiconTabId:  s.activeTabId.lexicon,
        searchTabId:   s.activeTabId.search,
        hasYouTubeTab: s.tabs.youtube.some((t) => t.id === s.activeTabId.youtube),
      }
    })
  )

  // The panel type actually shown right now = the active space's active tab's type.
  const activeType: TabType | null =
    activeSpace === 'scripture' ? scriptureTabType :
    activeSpace === 'notes'     ? (hasNotesTab ? (notesTabType ?? 'note') : null) :
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
            {notesTabType === 'tags' ? (
              <ErrorBoundary label="Tag graph error">
                <Suspense fallback={null}><TagsGraphPanel /></Suspense>
              </ErrorBoundary>
            ) : notesTabType === 'calendar' && notesTabId ? (
              <ErrorBoundary label="Calendar error"><CalendarTabPanel tabId={notesTabId} /></ErrorBoundary>
            ) : (
              <ErrorBoundary label="Notes panel error"><NotesPanel /></ErrorBoundary>
            )}
          </Layer>
        )}

        {/* Lexicon and Search panels are keyed by TAB id: both read their tab's persisted state
            in lazy `useState` initialisers (query, language, scroll) on the assumption that a
            tab switch is a fresh mount. Without the key, one shared instance carried the previous
            tab's search/query/results into a brand-new tab ("stuff I never entered"). Notes keeps
            its single in-place instance (its own tab-switch resync + per-tab home snapshot). */}
        {hasLexiconTab && (
          <Layer visible={activeSpace === 'lexicon'}>
            <ErrorBoundary label="Lexicon panel error"><LexiconPanel key={lexiconTabId ?? 'lexicon'} /></ErrorBoundary>
          </Layer>
        )}

        {hasSearchTab && (
          <Layer visible={activeSpace === 'search'}>
            {searchTabType === 'history' || searchTabType === 'settings' ? (
              <ToolTabFallback type={searchTabType} />
            ) : (
              <ErrorBoundary label="Search error"><SearchTab key={searchTabId ?? 'search'} /></ErrorBoundary>
            )}
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
