import { useAppStore } from '@/store'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import SearchTab from '@/components/search/SearchTab'
import PDFViewer from '@/components/pdf/PDFViewer'
import ErrorBoundary from './ErrorBoundary'
import { BookOpen } from 'lucide-react'

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
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)

  const tabId = activeTabId[activeSpace]
  const tab = tabs[activeSpace].find((t) => t.id === tabId)

  // Always-mounted YouTube: keeps the webview alive across space switches so PiP and
  // video state are never lost. CSS visibility hides it without unmounting.
  const ytTabId = activeTabId['youtube']
  const ytTab = ytTabId ? tabs['youtube'].find((t) => t.id === ytTabId) : null
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
            <YouTubeTab />
          </ErrorBoundary>
        </div>
      )}

      {/* Non-YouTube panels (also covers YouTube empty state when no tab exists yet) */}
      {(!isYouTubeActive || !ytTab) && (
        <div className="absolute inset-0">
          {!tab && <EmptyState />}
          {tab?.type === 'bible'   && <ErrorBoundary key={tab.id} label="Bible panel error"><BiblePanel key={tab.id} /></ErrorBoundary>}
          {tab?.type === 'note'    && <ErrorBoundary key={tab.id} label="Notes panel error"><NotesPanel key={tab.id} /></ErrorBoundary>}
          {tab?.type === 'lexicon' && <ErrorBoundary key={tab.id} label="Lexicon panel error"><LexiconPanel key={tab.id} /></ErrorBoundary>}
          {tab?.type === 'search'  && <ErrorBoundary key={tab.id} label="Search error"><SearchTab key={tab.id} /></ErrorBoundary>}
          {tab?.type === 'pdf'     && <ErrorBoundary key={tab.id} label="PDF viewer error"><PDFViewer key={tab.id} /></ErrorBoundary>}
        </div>
      )}
    </div>
  )
}
