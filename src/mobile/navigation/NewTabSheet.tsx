import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookOpen, NotepadText, CalendarDays, BookMarked, Youtube, Settings as SettingsIcon, History, CornerDownLeft, Clock, Hash, MoreHorizontal, XCircle, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'
import { parseRef, bookName, isStrongsRef } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_TYPE_LABEL } from '@/lib/historyModel'
import { haptic } from '../primitives/haptics'
import { displayChapter } from '@/lib/chapterNumbering'

export type MorePageRoute = 'more' | 'settings' | 'history' | 'workspaces'

/** What a typed query means for the new-tab search (exported for tests). */
export function classifyNewTabQuery(q: string): { kind: 'empty' } | { kind: 'ref'; bookId: string; chapter: number; verse?: number; endVerse?: number; label: string } | { kind: 'strongs'; num: string } | { kind: 'text'; text: string } {
  const t = q.trim()
  if (!t) return { kind: 'empty' }
  if (isStrongsRef(t)) return { kind: 'strongs', num: t.toUpperCase().replace(/\s+/g, '') }
  if (/\p{L}.*\d/u.test(t)) {
    const p = parseRef(t)
    if (p) return { kind: 'ref', bookId: p.bookId, chapter: p.chapter, verse: p.verse, endVerse: p.endVerse, label: `${bookName(p.bookId)} ${displayChapter(p.bookId, p.chapter)}${p.verse ? `:${p.verse}${p.endVerse ? `–${p.endVerse}` : ''}` : ''}` }
  }
  return { kind: 'text', text: t }
}

/** A NEW Search tab (never the current one) with this query (T23-010). */
export function openQueryInNewSearchTab(query: string): void {
  const s = useAppStore.getState()
  s.createTab('search')
  const id = useAppStore.getState().activeTabId.search
  if (id) {
    s.updateTabState('search', id, { query, scope: 'scripture' })
    s.renameTab('search', id, `“${query.trim()}”`)
  }
  s.addRecentSearchQuery(query.trim())
  s.addHistoryEntry({ type: 'search', title: `"${query.trim()}"`, query: query.trim() })
}

/**
 * The plus / new-tab surface — "Floating Search" (TEST-032; reworked T23-009/010, redesigned
 * 2026-09-24 as a calm iOS command surface). Top to bottom:
 *   1. a prominent filled search field (auto-focused): a reference opens Scripture, a Strong's
 *      number the Lexicon, anything else a DEDICATED new Search tab;
 *   2. with nothing typed, ONE quiet grouped row of icon-only destinations (44 pt, VoiceOver
 *      labels) — each creates a real, independent tab; More is the last icon;
 *   3. Recent as an inset-grouped list (first RECENT_PREVIEW, explicit "Show All");
 *   while typing, the options become a native inset-grouped list (primary action first).
 * Scrolling dismisses the keyboard. There is no separate Search destination: a Search tab starts
 * from what you type. No Compare, no Workspaces here.
 */
const RECENT_PREVIEW = 5
const RECENT_ALL = 30

export function NewTabSheet({ close, openMore }: { close: () => void; openMore: (route: MorePageRoute) => void }) {
  const [query, setQuery] = useState('')
  const [showAllRecent, setShowAllRecent] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 280); return () => clearTimeout(t) }, [])
  const q = useMemo(() => classifyNewTabQuery(query), [query])
  const history = useAppStore((s) => s.history)
  const navigateHistory = useHistoryNavigate()
  const allRecent = useMemo(() => dedupeRecent(history).slice(0, RECENT_ALL), [history])
  const recent = showAllRecent ? allRecent : allRecent.slice(0, RECENT_PREVIEW)

  const st = () => useAppStore.getState()
  const done = () => { void haptic.light(); close() }
  const openRef = (r: Extract<ReturnType<typeof classifyNewTabQuery>, { kind: 'ref' }>, where: 'new' | 'current') => {
    done()
    if (where === 'new') st().createTab('bible')
    navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, origin: { kind: 'search-result', query } })
  }
  const newScripture = () => { done(); st().createTab('bible'); st().setActiveSpace('scripture') }
  const newNote = () => { done(); st().createTab('note'); st().setActiveSpace('notes') }
  const daily = () => { done(); st().requestDailyNote() }
  const newLexicon = () => { done(); st().createTab('lexicon'); st().setActiveSpace('lexicon') }
  const newYouTube = () => { done(); st().createTab('youtube'); st().setActiveSpace('youtube') }
  const newHistory = () => { done(); st().createTab('history') }
  const newSettings = () => { done(); st().createTab('settings') }
  const newSearchTab = (text: string) => { done(); openQueryInNewSearchTab(text) }
  // Scrolling the destinations / recent list puts the keyboard away (NEW-013).
  const dismissKeyboard = () => { if (document.activeElement === inputRef.current) inputRef.current?.blur() }
  const openStrongs = (num: string) => { done(); st().openLexiconEntry(num) }

  return (
    <div className="mobile-newtab" onTouchMove={dismissKeyboard} onWheel={dismissKeyboard}>
      <form className="mobile-search-field" role="search" onSubmit={(e) => {
        e.preventDefault()
        if (q.kind === 'ref') openRef(q, 'new')
        else if (q.kind === 'strongs') openStrongs(q.num)
        else if (q.kind === 'text') newSearchTab(q.text)
      }}>
        <Search size={17} aria-hidden />
        <input ref={inputRef} className="mobile-search-input" type="search" enterKeyHint="go" autoCorrect="off" autoCapitalize="words"
          placeholder="Reference, Strong's or words" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Open or search" />
        {query && (
          <button type="button" className="mobile-newtab-clear" aria-label="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>
            <XCircle size={17} aria-hidden />
          </button>
        )}
      </form>

      {q.kind === 'ref' && (
        <div className="mobile-newtab-list mobile-newtab-section" role="group" aria-label="Open">
          <ResultRow primary icon={BookOpen} title={<>Open {q.label}</>} subtitle="New Scripture tab" onClick={() => openRef(q, 'new')} />
          <ResultRow icon={CornerDownLeft} title="Open in current tab" onClick={() => openRef(q, 'current')} />
          <ResultRow icon={Search} title={<>Search “{query.trim()}”</>} subtitle="New Search tab" onClick={() => newSearchTab(query)} />
        </div>
      )}
      {q.kind === 'strongs' && (
        <div className="mobile-newtab-list mobile-newtab-section" role="group" aria-label="Open">
          <ResultRow primary icon={Hash} title={<>Open {q.num}</>} subtitle="Lexicon" onClick={() => openStrongs(q.num)} />
          <ResultRow icon={Search} title={<>Find {q.num} in Scripture</>} subtitle="New Search tab" onClick={() => newSearchTab(q.num)} />
        </div>
      )}
      {q.kind === 'text' && (
        <div className="mobile-newtab-list mobile-newtab-section" role="group" aria-label="Search">
          <ResultRow primary icon={Search} title={<>Search “{q.text}”</>} subtitle="New Search tab" onClick={() => newSearchTab(q.text)} />
        </div>
      )}

      {q.kind === 'empty' && (
        <>
          {/* Icon-only destinations (NEW-013): one quiet grouped row, each a real new tab; More
              is the last icon. Names are spoken by VoiceOver and shown on long-press tooltips. */}
          <div className="mobile-newtab-dests" role="group" aria-label="New tab">
            <Dest icon={BookOpen} label="New Scripture tab" onClick={newScripture} />
            <Dest icon={NotepadText} label="New note" onClick={newNote} />
            <Dest icon={CalendarDays} label="Today's daily note" onClick={daily} />
            <Dest icon={BookMarked} label="New Lexicon tab" onClick={newLexicon} />
            <Dest icon={History} label="New History tab" onClick={newHistory} />
            <Dest icon={Youtube} label="New YouTube tab" onClick={newYouTube} />
            <Dest icon={SettingsIcon} label="New Settings tab" onClick={newSettings} />
            <Dest icon={MoreHorizontal} label="More — study trail, tags, queue, PDFs, sessions" onClick={() => { done(); openMore('more') }} more />
          </div>
          {allRecent.length > 0 && (
            <section className="mobile-newtab-section" aria-label="Recent">
              <div className="mobile-newtab-section-head">
                <h3>Recent</h3>
                {allRecent.length > RECENT_PREVIEW && (
                  <button type="button" className="mobile-newtab-more" onClick={() => setShowAllRecent((v) => !v)} aria-expanded={showAllRecent}>
                    {showAllRecent ? 'Show Less' : 'Show All'}
                  </button>
                )}
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

function ResultRow({ icon: Icon, title, subtitle, onClick, primary }: { icon: LucideIcon; title: React.ReactNode; subtitle?: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" className={`mobile-newtab-row${primary ? ' is-primary' : ''}`} onClick={onClick}>
      <span className="mobile-newtab-row-icon"><Icon size={19} aria-hidden /></span>
      <span className="mobile-newtab-row-text"><span>{title}</span>{subtitle && <small>{subtitle}</small>}</span>
    </button>
  )
}

function dedupeRecent(history: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>()
  const out: HistoryEntry[] = []
  for (const h of history) {
    const k = `${h.type}|${h.title}`
    if (seen.has(k)) continue
    seen.add(k); out.push(h)
  }
  return out
}

function Dest({ icon: Icon, label, onClick, more }: { icon: LucideIcon; label: string; onClick: () => void; more?: boolean }) {
  return <button type="button" className={`mobile-newtab-dest${more ? ' is-more' : ''}`} onClick={onClick} aria-label={label} title={label}><Icon size={21} aria-hidden /></button>
}
