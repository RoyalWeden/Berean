import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookOpen, NotepadText, CalendarDays, BookMarked, Youtube, Settings as SettingsIcon, History, CornerDownLeft, Clock, Hash, MoreHorizontal, type LucideIcon } from 'lucide-react'
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
 * The plus / new-tab surface (TEST-032; reworked T23-009/010): a floating search sheet built for
 * frequent Bible use. Type a reference ("John 3:16", "Psalm 23:1-6") and open it in a NEW Scripture
 * tab (or the current one); a Strong's number opens a Lexicon tab; while typing, "Search … in a new
 * Search tab" opens a DEDICATED Search tab. With nothing typed: one tile per genuine tab type —
 * each creates a real, independent tab (several of a kind are fine) — then the navigation that is
 * compact icon row (NEW-013; More is its last icon), then recent history (scrolling dismisses the
 * keyboard). There is no separate Search tile: a Search
 * tab starts from what you type.
 */
export function NewTabSheet({ close, openMore }: { close: () => void; openMore: (route: MorePageRoute) => void }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 280); return () => clearTimeout(t) }, [])
  const q = useMemo(() => classifyNewTabQuery(query), [query])
  const history = useAppStore((s) => s.history)
  const navigateHistory = useHistoryNavigate()
  const recent = useMemo(() => dedupeRecent(history).slice(0, 12), [history])

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

  return (
    <div className="mobile-newtab" onTouchMove={dismissKeyboard} onWheel={dismissKeyboard}>
      <form className="mobile-search-field" onSubmit={(e) => {
        e.preventDefault()
        if (q.kind === 'ref') openRef(q, 'new')
        else if (q.kind === 'strongs') { done(); st().openLexiconEntry(q.num) }
        else if (q.kind === 'text') newSearchTab(q.text)
      }}>
        <Search size={18} aria-hidden />
        <input ref={inputRef} className="mobile-search-input" type="search" enterKeyHint="go" autoCorrect="off" autoCapitalize="words"
          placeholder="Reference, Strong's number or words…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Open or search" />
      </form>

      {q.kind === 'ref' && (
        <div className="mobile-newtab-results">
          <button type="button" className="mobile-ref-go" onClick={() => openRef(q, 'new')}><CornerDownLeft size={18} aria-hidden /><span>Open <strong>{q.label}</strong> in a new tab</span></button>
          <button type="button" className="mobile-newtab-row" onClick={() => openRef(q, 'current')}><BookOpen size={18} aria-hidden /><span>Open in the current Scripture tab</span></button>
          <button type="button" className="mobile-newtab-row" onClick={() => newSearchTab(query)}><Search size={18} aria-hidden /><span>Search “{query.trim()}” in a new Search tab</span></button>
        </div>
      )}
      {q.kind === 'strongs' && (
        <div className="mobile-newtab-results">
          <button type="button" className="mobile-ref-go" onClick={() => { done(); st().openLexiconEntry(q.num) }}><Hash size={18} aria-hidden /><span>Open <strong>{q.num}</strong> in the Lexicon</span></button>
          <button type="button" className="mobile-newtab-row" onClick={() => newSearchTab(q.num)}><Search size={18} aria-hidden /><span>Find {q.num} in Scripture — new Search tab</span></button>
        </div>
      )}
      {q.kind === 'text' && (
        <div className="mobile-newtab-results">
          <button type="button" className="mobile-ref-go" onClick={() => newSearchTab(q.text)}><Search size={18} aria-hidden /><span>Search “<strong>{q.text}</strong>” in a new Search tab</span></button>
        </div>
      )}

      {q.kind === 'empty' && (
        <>
          {/* Compact, icon-only destinations (NEW-013) — one row; each is a real new tab, More is
              the last icon. Names are spoken by VoiceOver and shown on long-press tooltips. */}
          <div className="mobile-newtab-icons" role="group" aria-label="New tab">
            <IconTile icon={BookOpen} label="New Scripture tab" onClick={newScripture} />
            <IconTile icon={NotepadText} label="New note" onClick={newNote} />
            <IconTile icon={CalendarDays} label="Today's daily note" onClick={daily} />
            <IconTile icon={BookMarked} label="New Lexicon tab" onClick={newLexicon} />
            <IconTile icon={Youtube} label="New YouTube tab" onClick={newYouTube} />
            <IconTile icon={History} label="New History tab" onClick={newHistory} />
            <IconTile icon={SettingsIcon} label="New Settings tab" onClick={newSettings} />
            <IconTile icon={MoreHorizontal} label="More — study trail, tags, queue, PDFs, sessions" onClick={() => { done(); openMore('more') }} />
          </div>
          {recent.length > 0 && (
            <section className="mobile-newtab-recent" aria-label="Recent">
              <h3>Recent</h3>
              {recent.map((h) => (
                <button key={h.id} type="button" className="mobile-newtab-row" onClick={() => { done(); navigateHistory(h) }}>
                  <Clock size={16} aria-hidden /><span>{h.title}</span><small>{HISTORY_TYPE_LABEL[h.type]}</small>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </div>
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

function IconTile({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return <button type="button" className="mobile-newtab-icon" onClick={onClick} aria-label={label} title={label}><Icon size={21} aria-hidden /></button>
}
