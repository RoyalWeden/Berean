import React from 'react'
import { Library, ChevronRight } from 'lucide-react'
import type { SheetApi } from '../primitives/Sheet'
import { useAppStore } from '@/store'
import { ExperienceRow } from '../navigation/ExperienceRow'
import { otherExperiences } from '../navigation/experiences'
import { SearchSurface, useSurfaceContext, type PassageGo } from '../search/SearchSurface'

/**
 * The caret's search field — "Search Berean" in THIS tab (⌘L of the phone; SEP25 → SRCH-003).
 * The same surface as the plus (SearchSurface): every source, scope and filter, whatever this tab
 * is. Picks change THIS tab (NAV-002): a Scripture tab navigates (its own go-to keeps the database
 * rules — "Matthew 10 LXX", "1 Enoch 10", a bare "10" in the current book); any other tab becomes
 * the destination's type in place (‹ returns). Long press on a result → Open in New Tab.
 * Empty: recent searches, "Browse the library" (Scripture tabs) and a "Go to" row of the other
 * major experiences (TEST25-NAV-001).
 */
export function CaretGoTo({ api, textId, bookId, onGo, browse }: {
  api: SheetApi
  textId?: string
  bookId?: string
  /** A passage shown by THIS tab itself (Scripture / Compare tabs). Omitted: the shared
   *  current-tab navigation (the tab changes type when it is not Scripture). */
  onGo?: PassageGo
  /** The picker, pushed into this sheet (Scripture tabs). */
  browse?: () => { title: string; render: (a: SheetApi) => React.ReactNode }
}) {
  const context = useSurfaceContext(textId, bookId)
  const experiences = useAppStore((s) => otherExperiences(s.tabs[s.activeSpace]?.find((t) => t.id === s.activeTabId[s.activeSpace])).join(','))
  return (
    <SearchSurface api={api} target="current-tab" context={context} onGoPassage={onGo} empty={
      <>
        {browse && (
          <div className="m-pp-list mobile-newtab-section">
            <button type="button" className="m-pp-row is-first" onClick={() => { const v = browse(); api.push({ key: 'library', ...v }) }}>
              <Library size={18} aria-hidden className="mobile-caret-goto-icon" />
              <span className="m-pp-row-text"><span className="m-pp-row-title">Browse the library</span><span className="m-pp-row-sub">Books, chapters and verses</span></span>
              <ChevronRight className="m-pp-row-chevron" size={18} aria-hidden />
            </button>
          </div>
        )}
        <ExperienceRow items={experiences.split(',').filter(Boolean) as ReturnType<typeof otherExperiences>} target="current-tab" onDone={() => api.close()} />
      </>
    } />
  )
}
