import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookOpen, NotepadText, CalendarDays, BookMarked, Youtube, Clock, MoreHorizontal, XCircle, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_TYPE_LABEL } from '@/lib/historyModel'
import { haptic } from '../primitives/haptics'
import { classifyNewTabQuery, openQueryInNewSearchTab, DestinationList, runPrimaryDestination } from './destinationQuery'

export { classifyNewTabQuery, openQueryInNewSearchTab }

export type MorePageRoute = 'more' | 'settings' | 'history' | 'workspaces'

/**
 * The plus / new-tab surface — "Floating Search" (TEST-032; reworked T23-009/010, calmed SEP25):
 * Berean's quick navigation surface, not an address bar and not a dashboard. Top to bottom:
 *   1. the search field (auto-focused): a reference opens Scripture, a Strong's number the
 *      Lexicon, anything else a DEDICATED new Search tab — the options while typing come from
 *      destinationQuery.tsx (shared with the caret's current-tab field);
 *   2. with nothing typed, ONE compact row of the high-frequency new tabs (Scripture, Note, Today,
 *      Lexicon, YouTube) + More — History and Settings live in More (History also behind Recent's
 *      "All History"), so they are not repeated here;
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
  const newScripture = () => { done(); st().createTab('bible'); st().setActiveSpace('scripture') }
  const newNote = () => { done(); st().createTab('note'); st().setActiveSpace('notes') }
  const daily = () => { done(); st().requestDailyNote() }
  const newLexicon = () => { done(); st().createTab('lexicon'); st().setActiveSpace('lexicon') }
  const newYouTube = () => { done(); st().createTab('youtube'); st().setActiveSpace('youtube') }
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
          {/* Icon-only high-frequency destinations (NEW-013): one quiet grouped row, each a real
              new tab; More is last. Names are spoken by VoiceOver and shown as tooltips. */}
          <div className="mobile-newtab-dests" role="group" aria-label="New tab" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
            <Dest icon={BookOpen} label="New Scripture tab" onClick={newScripture} />
            <Dest icon={NotepadText} label="New note" onClick={newNote} />
            <Dest icon={CalendarDays} label="Today's daily note" onClick={daily} />
            <Dest icon={BookMarked} label="New Lexicon tab" onClick={newLexicon} />
            <Dest icon={Youtube} label="New YouTube tab" onClick={newYouTube} />
            <Dest icon={MoreHorizontal} label="More — history, settings, study trail, tags, queue, PDFs, sessions" onClick={() => { done(); openMore('more') }} more />
          </div>
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

function Dest({ icon: Icon, label, onClick, more }: { icon: LucideIcon; label: string; onClick: () => void; more?: boolean }) {
  return <button type="button" className={`mobile-newtab-dest${more ? ' is-more' : ''}`} onClick={onClick} aria-label={label} title={label}><Icon size={21} aria-hidden /></button>
}
