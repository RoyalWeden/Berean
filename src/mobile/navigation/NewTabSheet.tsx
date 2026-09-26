import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Clock, XCircle } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_TYPE_LABEL } from '@/lib/historyModel'
import { haptic } from '../primitives/haptics'
import { classifyNewTabQuery, openQueryInNewSearchTab, DestinationList, runPrimaryDestination } from './destinationQuery'
import { ExperienceRow } from './ExperienceRow'
import { SWITCHER_EXPERIENCES } from './experiences'

export { classifyNewTabQuery, openQueryInNewSearchTab }

export type MorePageRoute = 'more' | 'settings' | 'history' | 'workspaces'

/**
 * The plus / new-tab surface — "Floating Search" (TEST-032; reworked T23-009/010, calmed SEP25):
 * Berean's quick navigation surface, not an address bar and not a dashboard. Top to bottom:
 *   1. the search field (auto-focused): a reference opens Scripture, a Strong's number the
 *      Lexicon, anything else a DEDICATED new Search tab — the options while typing come from
 *      destinationQuery.tsx (shared with the caret's current-tab field);
 *   2. with nothing typed, ONE compact row of the major experiences as new tabs (Scripture, Notes,
 *      Today, Lexicon, YouTube, Search, History, Settings — the same set as the top-left tab-type
 *      switcher and the caret's "Go to" row, TEST25-NAV-001) + More; typing an experience's name
 *      ("notes", "settings", "strong's") offers it as a destination too;
 *   3. Recent (the last few places).
 * Scrolling dismisses the keyboard. No Compare, no Workspaces (Sessions live in More).
 */
const RECENT_PREVIEW = 5

export function NewTabSheet({ close, openMore }: { close: () => void; openMore: (route: MorePageRoute) => void }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 280); return () => clearTimeout(t) }, [])
  const q = useMemo(() => classifyNewTabQuery(query), [query])
  const history = useAppStore((s) => s.history)
  const navigateHistory = useHistoryNavigate()
  const recent = useMemo(() => dedupeRecent(history, RECENT_PREVIEW), [history])

  const st = () => useAppStore.getState()
  const done = () => { void haptic.light(); close() }
  // Destination rows add their own haptic; they only need the sheet closed.
  const closeSheet = useCallback(() => close(), [close])
  const allHistory = () => { done(); st().ensureTab('history') }
  // Scrolling the destinations / recent list puts the keyboard away (NEW-013).
  const dismissKeyboard = () => { if (document.activeElement === inputRef.current) inputRef.current?.blur() }

  return (
    <div className="mobile-newtab" onTouchMove={dismissKeyboard} onWheel={dismissKeyboard}>
      <form className="mobile-search-field" role="search" onSubmit={(e) => { e.preventDefault(); runPrimaryDestination(query, 'new-tab', closeSheet) }}>
        <Search size={17} aria-hidden />
        <input ref={inputRef} className="mobile-search-input" type="search" enterKeyHint="go" autoCorrect="off" autoCapitalize="words"
          placeholder="Reference, Strong's or words" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Open or search" />
        {query && (
          <button type="button" className="mobile-newtab-clear" aria-label="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>
            <XCircle size={17} aria-hidden />
          </button>
        )}
      </form>

      <DestinationList query={query} target="new-tab" onDone={closeSheet} />

      {q.kind === 'empty' && (
        <>
          {/* The major experiences, each a real new tab; More is last (NEW-013, TEST25-NAV-001). */}
          <ExperienceRow items={SWITCHER_EXPERIENCES} target="new-tab" onDone={closeSheet} onMore={() => { close(); openMore('more') }} />
          {recent.length > 0 && (
            <section className="mobile-newtab-section" aria-label="Recent">
              <div className="mobile-newtab-section-head">
                <h3>Recent</h3>
                <button type="button" className="mobile-newtab-more" onClick={allHistory}>All History</button>
              </div>
              <div className="mobile-newtab-list">
                {recent.map((h) => (
                  <button key={h.id} type="button" className="mobile-newtab-row" onClick={() => { done(); navigateHistory(h) }}>
                    <span className="mobile-newtab-row-icon"><Clock size={17} aria-hidden /></span>
                    <span className="mobile-newtab-row-text"><span>{h.title}</span></span>
                    <span className="mobile-newtab-row-meta">{HISTORY_TYPE_LABEL[h.type]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
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
