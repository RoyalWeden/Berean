import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import { useAppStore } from '@/store'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import SearchTab from '@/components/search/SearchTab'
import type { MosaicKey } from '@/types'
import type { MosaicNode } from 'react-mosaic-component'

const PANEL_TITLES: Record<MosaicKey, string> = {
  'bible-panel': 'Scripture',
  'notes-panel': 'Notes',
  'lexicon-panel': 'Lexicon',
  'youtube-panel': 'YouTube',
  'search-panel': 'Search'
}

function renderPanel(key: MosaicKey) {
  switch (key) {
    case 'bible-panel': return <BiblePanel />
    case 'notes-panel': return <NotesPanel />
    case 'lexicon-panel': return <LexiconPanel />
    case 'youtube-panel': return <YouTubeTab />
    case 'search-panel': return <SearchTab />
    default: return <div className="p-4 text-[rgb(var(--color-text-muted))]">Panel</div>
  }
}

export default function PanelLayout() {
  const panelLayout = useAppStore((s) => s.panelLayout)
  const updatePanelLayout = useAppStore((s) => s.updatePanelLayout)

  return (
    <div className="h-full w-full p-2">
      <Mosaic<MosaicKey>
        renderTile={(key, path) => (
          <MosaicWindow<MosaicKey>
            path={path}
            title={PANEL_TITLES[key]}
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
