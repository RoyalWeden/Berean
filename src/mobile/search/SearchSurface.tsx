import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search, XCircle, SlidersHorizontal, Clock, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { booksSummary } from '@/lib/scriptureSearchFilters'
import { openDestination, type Destination, type NavIntent } from '@/lib/navigation/destination'
import { resolvePlace, runUnifiedSearch, type UnifiedResults, type UnifiedScope } from '@/lib/search/unifiedSearch'
import type { IntentContext } from '@/lib/search/searchIntent'
import type { WordMode } from '@/lib/scriptureHighlight'
import type { SheetApi } from '../primitives/Sheet'
import { ChoiceList } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { Segmented } from '../settings/SettingsControls'
import { runExperience } from '../navigation/experiences'
import { BooksFilterView } from './BooksFilterView'
import { UnifiedResultsList, type UnifiedPick } from './UnifiedResults'
import { useSearchSurface, surfaceFilterCount } from './searchSurfaceState'
import { WORD_MODE_LABEL, textFilterLabel } from './searchFilters'
import './search.css'

/** Where the surface sends what the user picks — the entry point decides, never the result. */
export type SurfaceTarget = Extract<NavIntent, 'current-tab' | 'new-tab'>

export const SCOPE_OPTIONS: Array<[UnifiedScope, string]> = [['all', 'All'], ['scripture', 'Scripture'], ['lexicon', "Strong's"], ['notes', 'Notes']]

/** A passage the caller shows itself (a Scripture / Compare tab's own go-to keeps its database rules). */
export type PassageGo = (d: { textId: string; bookId: string; chapter: number; verse?: number; endVerse?: number }) => void

const freshSheets = new WeakSet<Element>()

/**
 * "Search Berean" on the iPhone (SRCH-003) — ONE surface for the plus (Floating Search, `target
 * "new-tab"`) and the caret's search field (`target "current-tab"`): same field, scope (All ·
 * Scripture · Strong's · Notes), Filters (text · books · match), grouped results, recent searches
 * and result actions; only where a pick lands differs. The tab it was opened from never narrows
 * it; `context` only lets a bare "10" mean a chapter of the current book.
 *
 *   tap                → the entry point's intent (caret: THIS tab; plus: a new tab)
 *   long press         → the other one (Open in New Tab / Open in This Tab)
 *   "All N verses …"   → the full list as a Search tab (same intent)
 *   Return             → the first Go-to, else the full search
 */
export function SearchSurface({ api, target, context, onGoPassage, empty, placeholder = 'Search Berean' }: {
  api: SheetApi
  target: SurfaceTarget
  context?: IntentContext
  onGoPassage?: PassageGo
  /** Shown under Recent when nothing is typed (experience row, Browse the library, recent places). */
  empty?: React.ReactNode
  placeholder?: string
}) {
  const { query, scope, filters, setQuery, setScope } = useSearchSurface()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A fresh sheet starts with an empty query; coming back from the Filters view keeps it.
  useLayoutEffect(() => {
    const sheet = rootRef.current?.closest('.mobile-sheet')
    if (sheet && !freshSheets.has(sheet)) { freshSheets.add(sheet); useSearchSurface.getState().begin() }
  }, [])
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120); return () => clearTimeout(t) }, [])
  // Results need the room: a sheet that opened lower (the caret) grows to its full height, so the
  // keyboard never covers them.
  useEffect(() => { api.expand() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const recent = useAppStore((s) => s.recentSearchQueries)
  const [results, setResults] = useState<UnifiedResults | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const ctxKey = `${context?.textId ?? ''}|${context?.bookId ?? ''}`
  useEffect(() => {
    const q = query.trim()
    const my = ++seq.current
    if (!q) { setResults(null); setLoading(false); return }
    setLoading(true)
    // Search as you type (the desktop's behaviour), debounced; earlier results stay until newer land.
    const t = setTimeout(() => {
      runUnifiedSearch(q, { scope, filters, context, wordReplacerEnabled, wordReplacerRules, limit: 60 })
        .then((r) => { if (my === seq.current) setResults(r) })
        .catch(() => { if (my === seq.current) setResults(null) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, 180)
    return () => clearTimeout(t)
  }, [query, scope, filters, ctxKey, wordReplacerEnabled, wordReplacerRules]) // eslint-disable-line react-hooks/exhaustive-deps

  const other: SurfaceTarget = target === 'current-tab' ? 'new-tab' : 'current-tab'
  const remember = () => { const q = query.trim(); if (q) useAppStore.getState().addRecentSearchQuery(q) }

  /** Open a destination with an intent; passages of THIS tab go through the tab's own go-to. */
  const go = (d: Destination | null, intent: SurfaceTarget) => {
    if (!d) return
    void haptic.light()
    remember()
    api.close()
    if (d.kind === 'passage' && intent === 'current-tab' && onGoPassage && !d.highlight) {
      onGoPassage({ textId: d.textId ?? context?.textId ?? 'kjva', bookId: d.bookId, chapter: d.chapter, verse: d.verse, endVerse: d.endVerse ?? undefined })
      return
    }
    openDestination(d, intent, { origin: { kind: 'search-result', query: query.trim() } })
  }
  const destinationOf = async (p: UnifiedPick): Promise<Destination | null> => {
    switch (p.kind) {
      case 'goto': return p.item.destination ?? (p.item.place ? resolvePlace(p.item.place) : null)
      case 'verse': return { kind: 'passage', bookId: p.hit.book_id, chapter: p.hit.chapter, verse: p.hit.verse_num, textId: p.hit.textId, highlight: { query: results?.intent.text, wordMode: effectiveMode, strongsWords: p.hit.strongsWords } }
      case 'entry': return { kind: 'strongs', num: p.entry.strongsNum }
      case 'note': return { kind: 'note', noteId: p.note.id }
    }
  }
  const pick = (p: UnifiedPick, intent: SurfaceTarget = target) => {
    if (p.kind === 'goto' && p.item.kind === 'notes') { remember(); api.close(); runExperience('notes', intent); return }
    void destinationOf(p).then((d) => go(d, intent))
  }
  const longPick = (p: UnifiedPick) => {
    void haptic.medium()
    api.push({ key: 'result-actions', title: labelOf(p), render: (a) => (
      <ChoiceList api={a} value="" closeOnSelect onSelect={(id) => pick(p, id as SurfaceTarget)}
        options={[
          { id: target, label: target === 'current-tab' ? 'Open' : 'Open in New Tab' },
          { id: other, label: other === 'new-tab' ? 'Open in New Tab' : 'Open in This Tab' },
        ]} />
    ) })
  }
  const seeAll = (s: UnifiedScope) => go({ kind: 'search', query: query.trim(), scope: s, filters: filters as unknown as Record<string, unknown> }, target)
  const submit = () => {
    const q = query.trim()
    if (!q) return
    const first = results?.goTo[0]
    if (first && results?.intent.raw === q) pick({ kind: 'goto', item: first })
    else seeAll(scope)
  }
  const effectiveMode: WordMode = results?.intent.phrase ? 'phrase' : filters.wordMode
  const count = surfaceFilterCount(filters)
  const dismissKeyboard = () => { if (document.activeElement === inputRef.current) inputRef.current?.blur() }

  return (
    <div ref={rootRef} className="mobile-newtab m-usurface" onTouchMove={dismissKeyboard} onWheel={dismissKeyboard}>
      <form className="mobile-search-field" role="search" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Search size={17} aria-hidden />
        {/* No autocapitalize: capitalization follows the user's iOS keyboard setting (SEP26). */}
        <input ref={inputRef} className="mobile-search-input" type="search" enterKeyHint="search" autoCorrect="off" spellCheck={false}
          placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search Berean" data-no-sheet-drag />
        {query && (
          <button type="button" className="mobile-newtab-clear" aria-label="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>
            <XCircle size={17} aria-hidden />
          </button>
        )}
      </form>
      <div className="m-usearch-scope">
        <Segmented full label="Search in" value={scope} options={SCOPE_OPTIONS} onChange={(v) => setScope(v as UnifiedScope)} />
      </div>
      <button type="button" className="m-usearch-filters" onClick={() => api.push({ key: 'filters', title: 'Filters', render: (a) => <SurfaceFilters api={a} /> })}
        aria-label={`Filters: ${filtersLine(filters)}`}>
        <SlidersHorizontal size={16} aria-hidden />
        <span className="m-usearch-filters-text">{filtersLine(filters)}</span>
        {count > 0 && <span className="m-usearch-filters-badge">{count}</span>}
        <ChevronRight size={16} aria-hidden className="m-usearch-chevron" />
      </button>

      {query.trim() ? (
        <UnifiedResultsList results={results} query={query} wordMode={effectiveMode} loading={loading}
          onPick={(p) => pick(p)} onLongPick={longPick} onSeeAll={seeAll} />
      ) : (
        <>
          {recent.length > 0 && (
            <section className="mobile-newtab-section" aria-label="Recent searches">
              <div className="mobile-newtab-section-head">
                <h3>Recent searches</h3>
                <button type="button" className="mobile-newtab-more" onClick={() => useAppStore.getState().clearRecentSearchQueries()}>Clear</button>
              </div>
              <div className="mobile-newtab-list">
                {recent.slice(0, 5).map((r) => (
                  <button key={r} type="button" className="mobile-newtab-row" onClick={() => { setQuery(r); inputRef.current?.focus() }}>
                    <span className="mobile-newtab-row-icon"><Clock size={17} aria-hidden /></span>
                    <span className="mobile-newtab-row-text"><span>{r}</span></span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {empty}
        </>
      )}
    </div>
  )
}

function labelOf(p: UnifiedPick): string {
  switch (p.kind) {
    case 'goto': return p.item.label
    case 'verse': return bookChapterVerseLabel(p.hit.book_id, p.hit.chapter, p.hit.verse_num)
    case 'entry': return p.entry.strongsNum
    case 'note': return p.note.title || 'Untitled'
  }
}

function filtersLine(f: { textId: string; books: string[]; wordMode: WordMode }): string {
  const parts = [textFilterLabel(f.textId), booksSummary(f.books)]
  if (f.wordMode !== 'all') parts.push(WORD_MODE_LABEL[f.wordMode])
  return parts.join(' · ')
}

/** Filters as a view inside the same sheet: Text · Books (individual books) · Match. */
function SurfaceFilters({ api }: { api: SheetApi }) {
  const { filters, setFilters, resetFilters } = useSearchSurface()
  const texts = TRANSLATIONS.filter((t) => t.id !== 'hermas_taylor')
  return (
    <div className="m-usearch-filter-view">
      <div className="mobile-caret-row is-stacked">
        <span className="mobile-caret-row-label">Match</span>
        <Segmented full label="Match" value={filters.wordMode} options={[['all', 'All words'], ['any', 'Any word'], ['phrase', 'Phrase']]} onChange={(v) => setFilters({ wordMode: v as WordMode })} />
      </div>
      <button type="button" className="m-usearch-filters" onClick={() => api.push({ key: 'text', title: 'Text', render: (a) => (
        <ChoiceList api={a} value={filters.textId} onSelect={(id) => setFilters({ textId: id })}
          options={[{ id: 'all', label: 'All texts', detail: 'KJV + Apocrypha, LXX, 1 Enoch, Jubilees and every library text' }, ...texts.map((t) => ({ id: t.id, label: t.label, detail: t.description }))]} />
      ) })}>
        <span className="m-usearch-filters-text">Text</span><span className="mobile-muted">{textFilterLabel(filters.textId)}</span><ChevronRight size={16} aria-hidden className="m-usearch-chevron" />
      </button>
      <button type="button" className="m-usearch-filters" onClick={() => api.push({ key: 'books', title: 'Books', render: () => <SurfaceBooks /> })}>
        <span className="m-usearch-filters-text">Books</span><span className="mobile-muted">{booksSummary(filters.books)}</span><ChevronRight size={16} aria-hidden className="m-usearch-chevron" />
      </button>
      <button type="button" className="mobile-link-button m-usearch-reset" disabled={surfaceFilterCount(filters) === 0} onClick={resetFilters}>Reset filters</button>
    </div>
  )
}

function SurfaceBooks() {
  const books = useSearchSurface((s) => s.filters.books)
  const setFilters = useSearchSurface((s) => s.setFilters)
  return <BooksFilterView value={books} onChange={(ids) => setFilters({ books: ids })} />
}

/** Scripture tabs' caret search: passages resolve against this tab's text and book. */
export function useSurfaceContext(textId?: string, bookId?: string): IntentContext | undefined {
  return useMemo(() => (textId || bookId ? { textId, bookId } : undefined), [textId, bookId])
}
