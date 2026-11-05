import React, { useCallback, useMemo } from 'react'
import { openChatOverlay } from './chatOverlay'
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
import { useOpenTabIndex } from '../search/openTabs'
import { SWITCHER_EXPERIENCES } from './experiences'

export { classifyNewTabQuery, openQueryInNewSearchTab }

export type MorePageRoute = 'more' | 'settings' | 'history' | 'workspaces'

/**
 * The plus — Quick Open (QO-002; was the full "Search Berean" dashboard, TEST-032/SRCH-003): the
 * search field first and alone (scope + Filters behind its options button), search-as-you-type
 * results that say which are already open, and with nothing typed only a compact resume list —
 * recent searches as one chip row, recent places, then the new-tab experience row.
 *
 * A pick REUSES a tab of this session that already shows it ('reuse' intent, tabResolution.ts),
 * else opens a new tab; the plus never changes the tab behind it (NAV-003). Long press → Open New
 * Copy / Go to Tab in another session / Open in This Tab. The full Search tab stays one row away.
 */
const RECENT_PREVIEW = 6

export function NewTabSheet({ api, openMore }: { api: SheetApi; openMore: (route: MorePageRoute) => void }) {
  const history = useAppStore((s) => s.history)
  const navigateHistory = useHistoryNavigate()
  const { matchOf } = useOpenTabIndex()
  // Searches already show as the chip row — places only here.
  const recent = useMemo(() => dedupeRecent(history.filter((h) => h.type !== 'search'), RECENT_PREVIEW), [history])
  const close = useCallback(() => api.close(), [api])
  const allHistory = () => { void haptic.light(); close(); useAppStore.getState().ensureTab('history') }
  const openRecent = (h: HistoryEntry) => {
    void haptic.light(); close()
    const d = historyDestination(h)
    if (d) openDestination(d, 'reuse', { origin: { kind: 'history-revisit' } })
    else navigateHistory(h)
  }
  return (
    <SearchSurface api={api} target="new-tab" compact reuseTabs placeholder="Open a passage, note, Strong’s…" empty={
      <>
        {recent.length > 0 && (
          <section className="mobile-newtab-section" aria-label="Recent">
            <div className="mobile-newtab-section-head">
              <h3>Recent</h3>
              <button type="button" className="mobile-newtab-more" onClick={allHistory}>All History</button>
            </div>
            <div className="mobile-newtab-list">
              {recent.map((h) => {
                const m = matchOf(historyDestination(h))
                return (
                  <button key={h.id} type="button" className="mobile-newtab-row" onClick={() => openRecent(h)}
                    aria-label={`${h.title}, ${HISTORY_TYPE_LABEL[h.type]}${m?.current ? ', open' : ''}`}>
                    <span className="mobile-newtab-row-icon"><Clock size={17} aria-hidden /></span>
                    <span className="mobile-newtab-row-text"><span>{h.title}</span></span>
                    <span className="mobile-newtab-row-meta">{m?.current ? 'Open' : HISTORY_TYPE_LABEL[h.type]}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
        {/* The major experiences, each a real new tab; More is last (NEW-013, TEST25-NAV-001). */}
        <section className="mobile-newtab-section" aria-label="New tab">
          <div className="mobile-newtab-section-head"><h3>New tab</h3></div>
          <ExperienceRow items={SWITCHER_EXPERIENCES} target="new-tab" onDone={close} onChat={() => { close(); openChatOverlay() }} onMore={() => { close(); openMore('more') }} />
        </section>
      </>
    } />
  )
}

function dedupeRecent(history: HistoryEntry[], max: number): HistoryEntry[] {
  const seen = new Set<string>()
  const out: HistoryEntry[] = []
  for (const h of history) {
    const d = historyDestination(h)
    // One row per place: a chapter's verses collapse (they reuse the same tab).
    const k = d ? JSON.stringify(d.kind === 'passage' ? [d.bookId, d.chapter, d.textId ?? ''] : d) : `${h.type}|${h.title}`
    if (seen.has(k)) continue
    seen.add(k); out.push(h)
    if (out.length >= max) break
  }
  return out
}
