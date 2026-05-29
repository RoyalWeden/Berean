import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import { useAppStore } from '@/store'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import SearchTab from '@/components/search/SearchTab'
import ErrorBoundary from './ErrorBoundary'
import type { MosaicKey, SpaceId } from '@/types'
import type { MosaicNode } from 'react-mosaic-component'

const PANEL_TITLES: Record<MosaicKey, string> = {
  'bible-panel':   'Scripture',
  'notes-panel':   'Notes',
  'lexicon-panel': 'Lexicon',
  'youtube-panel': 'YouTube',
  'search-panel':  'Search',
}

function SecondaryPanel({ activeSpace }: { activeSpace: SpaceId }) {
  switch (activeSpace) {
    case 'lexicon': return <LexiconPanel />
    case 'youtube': return <YouTubeTab />
    case 'search':  return <SearchTab />
    default:        return <NotesPanel />
  }
}

function secondaryTitle(activeSpace: SpaceId): string {
  switch (activeSpace) {
    case 'lexicon': return 'Lexicon'
    case 'youtube': return 'YouTube'
    case 'search':  return 'Search'
    default:        return 'Notes'
  }
}

export default function PanelLayout() {
  const panelLayout = useAppStore((s) => s.panelLayout)
  const updatePanelLayout = useAppStore((s) => s.updatePanelLayout)
  const activeSpace = useAppStore((s) => s.activeSpace)

  function renderPanel(key: MosaicKey) {
    switch (key) {
      case 'bible-panel':   return <ErrorBoundary label="Bible panel error"><BiblePanel /></ErrorBoundary>
      case 'notes-panel':   return <ErrorBoundary label="Notes panel error"><SecondaryPanel activeSpace={activeSpace} /></ErrorBoundary>
      case 'lexicon-panel': return <ErrorBoundary label="Lexicon panel error"><LexiconPanel /></ErrorBoundary>
      case 'youtube-panel': return <ErrorBoundary label="YouTube error"><YouTubeTab /></ErrorBoundary>
      case 'search-panel':  return <ErrorBoundary label="Search error"><SearchTab /></ErrorBoundary>
      default: return <div className="p-4 text-[rgb(var(--color-text-muted))]">Panel</div>
    }
  }

  function tileTitle(key: MosaicKey): string {
    if (key === 'notes-panel') return secondaryTitle(activeSpace)
    return PANEL_TITLES[key]
  }

  return (
    <div className="h-full w-full p-2">
      <Mosaic<MosaicKey>
        renderTile={(key, path) => (
          <MosaicWindow<MosaicKey>
            path={path}
            title={tileTitle(key)}
            toolbarControls={[]}
          >
            {renderPanel(key)}
          </MosaicWindow>
        )}
        value={panelLayout}
        onChange={(newLayout: MosaicNode<MosaicKey> | null) => updatePanelLayout(newLayout)}
        className="berean-mosaic"
      />
    </div>
  )
}
