import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft, Library, ChevronRight } from 'lucide-react'
import { resolvePassageQuery, type PassageDestination } from '@/lib/passageDestinations'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { useDestinationActions } from '../navigation/destinationQuery'
import { navigateToVerse } from '@/lib/verseNavigation'
import { useAppStore } from '@/store'
import { ExperienceRow } from '../navigation/ExperienceRow'
import { otherExperiences } from '../navigation/experiences'

function goInScripture(d: { textId: string; bookId: string; chapter: number; verse?: number; endVerse?: number }) {
  navigateToVerse({ bookId: d.bookId, chapter: d.chapter, verse: d.verse, endVerse: d.endVerse, translationOverride: d.textId.toUpperCase(), origin: { kind: 'sequential-nav' } })
}

/**
 * The caret's search field for a Scripture tab — the ⌘L of the phone (SEP25): the same
 * destinations Floating Search offers (⌘T), but everything lands in THIS tab. Passages come from
 * the passage resolver (so "Matthew 10 LXX", "1 Enoch 10" and a bare "10" in the current book
 * work and switch the database), then the shared destinations (search, Strong's, open in a new
 * tab). Empty: "Browse the library" opens the book / chapter / verse picker in the same sheet,
 * and a "Go to" row of the other major experiences changes THIS tab into one (TEST25-NAV-001;
 * typing "notes", "settings", "today" … offers the same). Scrolling the results puts the
 * keyboard away.
 */
export function CaretGoTo({ api, textId = 'kjva', bookId, onGo = goInScripture, browse }: {
  api: SheetApi
  textId?: string
  bookId?: string
  /** Navigate THIS tab (switching its text when the destination names another one). Default:
   *  the current Scripture tab (tabs that are not Scripture — Lexicon, YouTube, History …). */
  onGo?: (d: { textId: string; bookId: string; chapter: number; verse?: number; endVerse?: number }) => void
  /** The picker, pushed into this sheet (Scripture tabs). */
  browse?: () => { title: string; render: (a: SheetApi) => React.ReactNode }
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 80); return () => clearTimeout(t) }, [])
  const passages = useMemo(() => resolvePassageQuery(query, { textId, bookId, limit: 4 }).filter((d): d is Extract<PassageDestination, { kind: 'passage' }> => d.kind === 'passage'), [query, textId, bookId])
  // The shared destinations, minus "go to" (the resolved passages above already are that).
  const others = useDestinationActions(query, 'current-tab', () => api.close()).filter((a) => a.id !== 'ref-current-tab')
  const go = (d: (typeof passages)[number]) => { void haptic.selection(); api.close(); onGo({ textId: d.textId, bookId: d.bookId, chapter: d.chapter, verse: d.verse, endVerse: d.endVerse }) }
  const submit = () => { if (passages[0]) go(passages[0]); else others.find((o) => o.primary)?.run() ?? others[0]?.run() }
  const experiences = useAppStore((s) => otherExperiences(s.tabs[s.activeSpace]?.find((t) => t.id === s.activeTabId[s.activeSpace])).join(','))
  const dismissKeyboard = () => { if (document.activeElement === inputRef.current) inputRef.current?.blur() }
  return (
    <div className="mobile-caret-goto" onTouchMove={dismissKeyboard} onWheel={dismissKeyboard}>
      <form className="m-pp-search" role="search" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Search size={17} aria-hidden />
        <input ref={inputRef} type="search" autoCorrect="off" autoCapitalize="words" enterKeyHint="go" spellCheck={false}
          placeholder="Passage, word, Strong's number…" value={query} onChange={(e) => setQuery(e.target.value)}
          aria-label="Go to a passage or search, in this tab" data-no-sheet-drag />
      </form>
      {query.trim() ? (
        <div className="m-pp-list" role="list">
          {passages.map((d, i) => (
            <button key={d.key} type="button" role="listitem" className={`m-pp-row${i === 0 ? ' is-first' : ''}`} onClick={() => go(d)} aria-label={`Go to ${d.label}${d.subtitle ? `, ${d.subtitle}` : ''}`}>
              <span className="m-pp-row-text"><span className="m-pp-row-title">{d.label}</span><span className="m-pp-row-sub">{d.subtitle ?? ''}</span></span>
              <CornerDownLeft className="m-pp-row-chevron" size={18} aria-hidden />
            </button>
          ))}
          {others.map((o) => (
            <button key={o.id} type="button" role="listitem" className="m-pp-row" onClick={o.run}>
              <o.icon size={18} aria-hidden className="mobile-caret-goto-icon" />
              <span className="m-pp-row-text"><span className="m-pp-row-title">{o.label}</span>{o.subtitle && <span className="m-pp-row-sub">{o.subtitle}</span>}</span>
            </button>
          ))}
          {!passages.length && !others.length && <div className="mobile-empty">Nothing matches “{query.trim()}”.</div>}
        </div>
      ) : (
        <>
          {browse && (
            <div className="m-pp-list">
              <button type="button" className="m-pp-row is-first" onClick={() => { const v = browse(); api.push({ key: 'library', ...v }) }}>
                <Library size={18} aria-hidden className="mobile-caret-goto-icon" />
                <span className="m-pp-row-text"><span className="m-pp-row-title">Browse the library</span><span className="m-pp-row-sub">Books, chapters and verses</span></span>
                <ChevronRight className="m-pp-row-chevron" size={18} aria-hidden />
              </button>
            </div>
          )}
          <ExperienceRow items={experiences.split(',').filter(Boolean) as ReturnType<typeof otherExperiences>} target="current-tab" onDone={() => api.close()} />
        </>
      )}
    </div>
  )
}
