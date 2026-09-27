import React, { useCallback, useMemo } from 'react'
import { Clock } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_TYPE_LABEL } from '@/lib/historyModel'
import { haptic } from '../primitives/haptics'
import { classifyNewTabQuery, openQueryInNewSearchTab } from './destinationQuery'
import { historyDestination } from '@/lib/navigation/historyDestination'
import { openDestination } from '@/lib/navigation/destination'
import { SearchSurface } from '../search/SearchSurface'
import type { SheetApi } from '../primitives/Sheet'
import { ExperienceRow } from './ExperienceRow'
import { SWITCHER_EXPERIENCES } from './experiences'

export { classifyNewTabQuery, openQueryInNewSearchTab }

export type MorePageRoute = 'more' | 'settings' | 'history' | 'workspaces'

/**
 * The plus / new-tab surface — Floating Search on the iPhone (TEST-032; T23-009/010; SRCH-003):
 * "Search Berean" (the same surface as the caret's search — SearchSurface) whose picks open in a
 * NEW tab (long press: in this tab). With nothing typed: recent searches, ONE compact row of the
 * major experiences as new tabs (+ More), and Recent places. No Compare, no Workspaces.
 */
const RECENT_PREVIEW = 5

export function NewTabSheet({ api, openMore }: { api: SheetApi; openMore: (route: MorePageRoute) => void }) {
  const history = useAppStore((s) => s.history)
  const navigateHistory = useHistoryNavigate()
  const recent = useMemo(() => dedupeRecent(history, RECENT_PREVIEW), [history])
  const close = useCallback(() => api.close(), [api])
  const allHistory = () => { void haptic.light(); close(); useAppStore.getState().ensureTab('history') }
  // A recent place opens in a NEW tab — the plus never changes the tab behind it (NAV-003).
  const openRecent = (h: HistoryEntry) => {
    void haptic.light(); close()
    const d = historyDestination(h)
    if (d) openDestination(d, 'new-tab', { origin: { kind: 'history-revisit' } })
    else navigateHistory(h)
  }
  return (
    <SearchSurface api={api} target="new-tab" empty={
      <>
        {/* The major experiences, each a real new tab; More is last (NEW-013, TEST25-NAV-001). */}
        <ExperienceRow items={SWITCHER_EXPERIENCES} target="new-tab" onDone={close} onMore={() => { close(); openMore('more') }} />
        {recent.length > 0 && (
          <section className="mobile-newtab-section" aria-label="Recent">
            <div className="mobile-newtab-section-head">
              <h3>Recent</h3>
              <button type="button" className="mobile-newtab-more" onClick={allHistory}>All History</button>
            </div>
            <div className="mobile-newtab-list">
              {recent.map((h) => (
                <button key={h.id} type="button" className="mobile-newtab-row" onClick={() => openRecent(h)}>
                  <span className="mobile-newtab-row-icon"><Clock size={17} aria-hidden /></span>
                  <span className="mobile-newtab-row-text"><span>{h.title}</span></span>
                  <span className="mobile-newtab-row-meta">{HISTORY_TYPE_LABEL[h.type]}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </>
    } />
  )
}

function dedupeRecent(history: HistoryEntry[], max: number): HistoryEntry[] {
  const seen = new Set<string>()
  const out: HistoryEntry[] = []
  for (const h of history) {
    const k = `${h.type}|${h.title}`
    if (seen.has(k)) continue
    seen.add(k); out.push(h)
    if (out.length >= max) break
  }
  return out
}
