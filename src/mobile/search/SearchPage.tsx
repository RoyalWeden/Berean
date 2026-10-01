import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCaretCommands } from '../commands/caretRegistry'
import { Search, X, Clock, Tag, Languages, Library, Tags as TagsIcon, RotateCcw, History as HistoryIcon, SlidersHorizontal, MoreHorizontal, ChevronDown } from 'lucide-react'
import type { Note, LexiconEntry, VerseTagMember, Tab, SearchTabState } from '@/types'
import { useAppStore } from '@/store'
import { bookName, parseRef, bookChapterVerseLabel } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { applyFindHighlight } from '@/lib/highlight'
import { buildAllWordsSnippet } from '@/components/bible/ScriptureSearchView'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { displayHitText } from '@/lib/scriptureText'
import { openDestination, type NavIntent } from '@/lib/navigation/destination'
import { runUnifiedSearch, resolvePlace, type UnifiedResults } from '@/lib/search/unifiedSearch'
import { UnifiedResultsList, type UnifiedPick } from './UnifiedResults'
import { SCOPE_OPTIONS } from './SearchSurface'
import { runExperience } from '../navigation/experiences'
import { resolveTagColor } from '@/lib/tagPalette'
import {
  runScriptureSearch, runStrongsSearch, groupHitsByBook, filterHitsByVerseTags, takeGroupRows,
  type ScriptureHit, type SearchSortMode, type SearchSortDirection,
} from '@/lib/scriptureSearch'
import { booksSummary } from '@/lib/scriptureSearchFilters'
import {
  DEFAULT_SEARCH_FILTERS, activeFilterCount, scopeHasFilters, textFilterLabel, WORD_MODE_LABEL,
  type SearchFilterState,
} from './searchFilters'
import { BooksFilterView } from './BooksFilterView'
import { HistoryView } from '../history/HistoryPage'
import type { WordMode } from '@/lib/scriptureHighlight'
import { Page, ListSection, Row, IconTap } from '../primitives/Page'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { ChoiceList, useActionSheet } from '../primitives/ActionSheet'
import { Segmented } from '../settings/SettingsPage'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import { useIncrementalLimit } from './useIncrementalLimit'
import { loadTaggedVerses } from './taggedBrowse'
import { useSearchResultActions, LongPressResult } from './ResultActionSheet'
import { buildSearchPreview, samePreview, type SearchPreviewSummary } from './resultActions'
import { commitSearchStep, isSearchCommitted, markSearchCommitted, searchSnapshot } from './searchHistory'
import './search.css'

type Scope = 'all' | 'scripture' | 'notes' | 'lexicon'

export { DEFAULT_SEARCH_FILTERS, type SearchFilterState }
const naturalDirection = (sort: SearchSortMode): SearchSortDirection => (sort === 'relevance' ? 'desc' : 'asc')

/** Rows mounted per scroll chunk — a 5,000-hit search mounts 50 rows, then 50 more per reach of the end. */
const RESULT_CHUNK = 50

/**
 * Search on the phone (Phase 14, R085): full library by default; a filter sheet for text,
 * testament/book groups, word mode, verse tags and sort; results grouped by book with snippet
 * highlighting, mounted incrementally; notes and lexicon scopes; recent queries. A reference
 * typed here ("Gen 1:1") opens the passage; a Strong's number searches its occurrences; tags
 * picked with no query browse the tagged verses themselves (the desktop's browse view).
 */
/** A search tab's filters, defaults filled in. */
export function tabFilters(st: SearchTabState | undefined): SearchFilterState {
  return { ...DEFAULT_SEARCH_FILTERS, ...((st?.filters ?? {}) as Partial<SearchFilterState>) }
}
/** Live state of search tab `tabId` (store, not a render snapshot — caret views read it lazily). */
function liveSearchState(tabId: string): SearchTabState | undefined {
  return useAppStore.getState().tabs.search.find((t) => t.id === tabId)?.state as SearchTabState | undefined
}
/**
 * Per-tab history (SEP25): committing a query, switching scope or changing a filter is a step
 * ‹ / › can return to. Recorded BEFORE the tab-state write so the restore-detection effect in
 * SearchPage sees it as already committed. `patch` is the next tab state.
 */
function commitSearch(tabId: string, patch: Partial<SearchTabState>) {
  const live = liveSearchState(tabId)
  commitSearchStep(tabId, searchSnapshot(live), searchSnapshot({ ...live, ...patch }))
}
function patchSearchFilters(tabId: string, patch: Partial<SearchFilterState>) {
  const filters = { ...tabFilters(liveSearchState(tabId)), ...patch } as unknown as Record<string, unknown>
  commitSearch(tabId, { filters })
  useAppStore.getState().updateTabState('search', tabId, { filters })
}
function resetSearchFilters(tabId: string) {
  commitSearch(tabId, { filters: {} })
  useAppStore.getState().updateTabState('search', tabId, { filters: {} })
}
/** Throttle for saving the result list's scroll offset into the tab. */
const SCROLL_SAVE_MS = 250
/** Typing counts as a committed search once it has settled this long. */
const QUERY_COMMIT_MS = 800

/**
 * Each Search TAB keeps its own scope, query and filters in its tab state (T23-009: several
 * Search tabs are independent; the page is keyed per tab by the shell). Filters are edited from
 * the caret (T23-013) — Match / Sort inline, Text / Books / Verse tags as views inside the caret.
 */
export function SearchPage({ tab }: { tab: Tab }) {
  const sheets = useSheets()
  const tabId = tab.id
  const st = tab.state as SearchTabState
  // Default: everything (SRCH-001) — a scope only narrows when the user picks one.
  const scope: Scope = st.scope ?? 'all'
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const setScope = useCallback((v: Scope) => { commitSearch(tabId, { scope: v }); updateTabState('search', tabId, { scope: v }) }, [updateTabState, tabId])
  const [query, setQuery] = useState(st.query ?? '')
  // The query as a committed history step: now (submit / a recent) or once typing settles.
  const commitQuery = useCallback((q: string) => { commitSearch(tabId, { query: q }); if ((liveSearchState(tabId)?.query ?? '') !== q) updateTabState('search', tabId, { query: q }) }, [tabId, updateTabState])
  useEffect(() => { markSearchCommitted(tabId, searchSnapshot(liveSearchState(tabId)), true) }, [tabId])
  useEffect(() => {
    const t = setTimeout(() => commitQuery(query), QUERY_COMMIT_MS)
    return () => clearTimeout(t)
  }, [query, commitQuery])
  // Back / forward re-apply a step's query / scope / filters (+ scroll) to the tab state; mirror a
  // restored query into the field. Our own writes are committed first, and a typed query equals
  // the field, so anything else is a restore.
  const bodyAnchorRef = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<number | null>(st.scrollTop ?? null)
  const filtersSig = JSON.stringify(st.filters ?? {})
  useEffect(() => {
    const snap = searchSnapshot(st)
    if (isSearchCommitted(tabId, snap)) return
    const restoring = useAppStore.getState().isNavJumping || (st.query ?? '') !== query
    if (!restoring) return
    markSearchCommitted(tabId, snap)
    if ((st.query ?? '') !== query) setQuery(st.query ?? '')
    pendingScroll.current = st.scrollTop ?? 0
  }, [st.query, st.scope, filtersSig]) // eslint-disable-line react-hooks/exhaustive-deps
  // Result-list scroll → tab state (throttled), so a remount or a history step can put it back.
  useEffect(() => {
    const body = bodyAnchorRef.current?.closest('.mobile-page-body') as HTMLElement | null
    if (!body) return
    let t: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (t) return
      t = setTimeout(() => { t = null; useAppStore.getState().updateTabState('search', tabId, { scrollTop: Math.round(body.scrollTop) }) }, SCROLL_SAVE_MS)
    }
    body.addEventListener('scroll', onScroll, { passive: true })
    return () => { body.removeEventListener('scroll', onScroll); if (t) clearTimeout(t) }
  }, [tabId])
  // The typed query is saved into the tab (and names it) once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = query.trim()
      if ((liveSearchState(tabId)?.query ?? '') !== query) updateTabState('search', tabId, { query })
      renameTab('search', tabId, q ? `“${q}”` : 'Search')
    }, 400)
    return () => clearTimeout(t)
  }, [query, tabId, updateTabState, renameTab])
  const filters = tabFilters(st)
  const setFilters = useCallback((next: SearchFilterState | ((f: SearchFilterState) => SearchFilterState)) => {
    const cur = tabFilters(liveSearchState(tabId))
    patchSearchFilters(tabId, typeof next === 'function' ? next(cur) : next)
  }, [tabId])
  const { textId, wordMode, books, tagIds, tagMatchAll, sort, direction } = filters
  const [hits, setHits] = useState<ScriptureHit[] | null>(null)
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [entries, setEntries] = useState<LexiconEntry[] | null>(null)
  const [unified, setUnified] = useState<UnifiedResults | null>(null)
  const [loading, setLoading] = useState(false)
  const recent = useAppStore((s) => s.recentSearchQueries)
  const addRecent = useAppStore((s) => s.addRecentSearchQuery)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const verseTags = useAppStore((s) => s.verseTags)
  const verseTagChangeToken = useAppStore((s) => s.verseTagChangeToken)
  const seq = useRef(0)
  // `openSearchTab(query)` from anywhere (deep link, history, tag search) lands here.
  const pendingSearchQuery = useAppStore((s) => s.pendingSearchQuery)
  const clearSearchQuery = useAppStore((s) => s.clearSearchQuery)
  useEffect(() => {
    if (!pendingSearchQuery) return
    setScope('all'); setQuery(pendingSearchQuery); clearSearchQuery()
  }, [pendingSearchQuery, clearSearchQuery])

  // The tag filter needs the tag list; App.tsx loads it at launch on desktop — make sure the
  // phone store has it too (idempotent, one query).
  useEffect(() => { if (useAppStore.getState().verseTags.length === 0) void useAppStore.getState().refreshVerseTags() }, [])
  // Drop tag ids that no longer exist (deleted in the Tag Manager) — same as desktop.
  useEffect(() => {
    if (tagIds.length === 0 || verseTags.length === 0) return
    const live = new Set(verseTags.map((t) => t.id))
    const next = tagIds.filter((id) => live.has(id))
    if (next.length !== tagIds.length) setFilters((f) => ({ ...f, tagIds: next }))
  }, [verseTags]) // eslint-disable-line react-hooks/exhaustive-deps
  // Members of the selected tags (verse + whole-chapter membership), refetched on any tag mutation.
  const [tagMembers, setTagMembers] = useState<VerseTagMember[]>([])
  useEffect(() => {
    if (tagIds.length === 0) { setTagMembers([]); return }
    let alive = true
    window.verseTags.getMembers(tagIds).then((m) => { if (alive) setTagMembers(m) }).catch(() => {})
    return () => { alive = false }
  }, [tagIds, verseTagChangeToken])

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim()
    const my = ++seq.current
    if (!trimmed || (trimmed.length < 2 && scope !== 'all')) { setHits(null); setNotes(null); setEntries(null); setUnified(null); return }
    setLoading(true)
    try {
      if (scope === 'all') {
        const r = await runUnifiedSearch(trimmed, { scope: 'all', filters: { textId, wordMode, books }, wordReplacerEnabled, wordReplacerRules })
        if (my === seq.current) { setUnified(r); setHits(null); setNotes(null); setEntries(null) }
      } else if (scope === 'notes') {
        const r = await window.notes.searchNotes(trimmed, 200, wordMode)
        if (my === seq.current) { setNotes(r); setHits(null); setEntries(null); setUnified(null) }
      } else if (scope === 'lexicon') {
        const r = await window.lexicon.search(trimmed, 'all')
        if (my === seq.current) { setEntries(r); setHits(null); setNotes(null); setUnified(null) }
      } else {
        const t0 = performance.now()
        const strongs = await runStrongsSearch(trimmed)
        const r = strongs ?? await runScriptureSearch(trimmed, { textId, wordMode, bookIds: books.length ? books : undefined, wordReplacerEnabled, wordReplacerRules })
        if (import.meta.env.DEV) console.debug(`[perf] search (${textId}) → ${r.length} hits in ${Math.round(performance.now() - t0)}ms`)
        if (my === seq.current) { setHits(r); setNotes(null); setEntries(null); setUnified(null) }
      }
    } catch { if (my === seq.current) { setHits([]); setNotes([]); setEntries([]) } }
    finally { if (my === seq.current) setLoading(false) }
  }, [scope, textId, wordMode, books, wordReplacerEnabled, wordReplacerRules])

  useEffect(() => {
    const t = setTimeout(() => { void run(query) }, 250)
    return () => clearTimeout(t)
  }, [query, run])

  // Browse mode: tags picked, nothing typed → the tagged verses themselves.
  const browsing = scope === 'scripture' && query.trim().length < 2 && tagIds.length > 0
  const [browseHits, setBrowseHits] = useState<ScriptureHit[] | null>(null)
  useEffect(() => {
    if (!browsing) { setBrowseHits(null); return }
    if (tagMembers.length === 0) { setBrowseHits([]); return }
    let alive = true
    setLoading(true)
    loadTaggedVerses(tagMembers, textId === 'all' ? 'kjva' : textId, (b, c, t) => window.bible.queryChapter(b, c, t))
      .then((r) => { if (alive) setBrowseHits(r) })
      .catch(() => { if (alive) setBrowseHits([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [browsing, tagMembers, textId])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    addRecent(trimmed)
    commitQuery(query)
    const ref = scope === 'scripture' || scope === 'all' ? parseRef(trimmed) : null
    // A reference opens in THIS tab (it becomes Scripture; ‹ returns to the search — NAV-002).
    if (ref) { void haptic.light(); openDestination({ kind: 'passage', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null }, 'current-tab', { origin: { kind: 'search-result', query: trimmed } }) }
  }
  // A tap opens the hit in THIS tab (NAV-002): the Search tab becomes Scripture at the verse, with
  // the find highlight; ‹ comes back to these results. (It used to land in whichever Scripture tab
  // was active in the Scripture space — or a brand-new one — leaving this tab behind.)
  // Long press → Open in New Tab.
  const openHit = (h: ScriptureHit, intent: NavIntent = 'current-tab') => {
    const q = query.trim()
    if (q) addRecent(q)
    const origin = { kind: 'search-result' as const, query: q || tagIds.map((id) => verseTags.find((t) => t.id === id)?.name ?? id).join(', ') }
    openDestination({ kind: 'passage', bookId: h.book_id, chapter: h.chapter, verse: h.verse_num, textId: h.textId, highlight: { query: h.strongsWords || browsing ? undefined : q, wordMode, strongsWords: h.strongsWords } }, intent, { origin })
  }

  // Tag filter + sort are client-side passes over the hit list, so flipping them never re-queries.
  const shownHits = browsing ? browseHits : hits
  const filteredHits = useMemo(() => (shownHits && !browsing ? filterHitsByVerseTags(shownHits, tagMembers, tagIds, tagMatchAll) : shownHits), [shownHits, browsing, tagMembers, tagIds, tagMatchAll])
  const groups = useMemo(() => (filteredHits ? groupHitsByBook(filteredHits, { sort, direction }) : []), [filteredHits, sort, direction])
  const { limit, grow, sentinelRef } = useIncrementalLimit(groups, RESULT_CHUNK)
  const page = useMemo(() => takeGroupRows(groups, limit), [groups, limit])

  const openNote = (n: Note) => { addRecent(query.trim()); openDestination({ kind: 'note', noteId: n.id }, 'current-tab') }
  // Once results for a restored step have loaded, put the list back where it was.
  useEffect(() => {
    if (loading || pendingScroll.current == null) return
    const body = bodyAnchorRef.current?.closest('.mobile-page-body') as HTMLElement | null
    if (!body) return
    const y = pendingScroll.current
    pendingScroll.current = null
    requestAnimationFrame(() => { body.scrollTop = y })
  }, [loading, hits, browseHits, notes, entries, unified])
  const runRecent = (r: string) => { setQuery(r); commitQuery(r) }
  const openEntry = (e: LexiconEntry) => sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={e.strongsNum} api={api} /> })
  // Long-press menus (SEP24): the same Open as a tap, plus new tab / copy / share / note / highlight.
  const resultActions = useSearchResultActions({ openHit, openNote, openEntry, runRecent, scope })
  // The All scope's grouped rows (the same list as the plus / caret search sheet).
  const pickUnified = (p: UnifiedPick) => {
    switch (p.kind) {
      case 'verse': openHit(p.hit); return
      case 'note': openNote(p.note); return
      case 'entry': openEntry(p.entry); return
      case 'goto': {
        const item = p.item
        addRecent(query.trim())
        if (item.kind === 'notes') { runExperience('notes', 'current-tab'); return }
        void (item.destination ? Promise.resolve(item.destination) : item.place ? resolvePlace(item.place) : Promise.resolve(null))
          .then((d) => { if (d) openDestination(d, 'current-tab', { origin: { kind: 'search-result', query: query.trim() } }) })
      }
    }
  }
  const longPickUnified = (p: UnifiedPick) => {
    if (p.kind === 'verse') resultActions.scripture(p.hit)
    else if (p.kind === 'note') resultActions.note(p.note)
    else if (p.kind === 'entry') resultActions.entry(p.entry)
  }

  // Tab-card preview (T23-011): a tiny summary of what this tab currently shows, saved into the
  // tab's LOCAL state (tabFields.ts — never synced) once results settle, so the card needs no
  // search of its own. Empty query → cleared (the card then shows recent queries).
  const previewSummary = useMemo<SearchPreviewSummary | null>(() => {
    const q = browsing ? '' : query.trim()
    if (scope === 'scripture' && filteredHits && (q.length >= 2 || browsing)) {
      const rows = groups.flatMap((g) => g.hits.slice(0, 3)).slice(0, 3)
      return buildSearchPreview(q, filteredHits.length, rows.map((h) => ({ ref: bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num), text: buildAllWordsSnippet(displayHitText(h), snippetQueryFor(q), 120).text })))
    }
    if (scope === 'all' && unified?.verses && unified.verses.length && q.length >= 2) {
      return buildSearchPreview(q, unified.verses.length, unified.verses.slice(0, 3).map((h) => ({ ref: bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num), text: buildAllWordsSnippet(displayHitText(h), snippetQueryFor(q), 120).text })))
    }
    if (scope === 'notes' && notes && q.length >= 2) return buildSearchPreview(q, notes.length, notes.map((n) => ({ ref: displayNoteTitle(n.title), text: stripMarkdownFormatting(n.content ?? '') })))
    if (scope === 'lexicon' && entries && q.length >= 2) return buildSearchPreview(q, entries.length, entries.map((e) => ({ ref: `${e.strongsNum} ${e.lemma ?? ''}`.trim(), text: e.gloss ?? '' })))
    return null
  }, [scope, filteredHits, groups, notes, entries, unified, query, browsing])
  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => {
      const cur = (liveSearchState(tabId) as (SearchTabState & { preview?: SearchPreviewSummary | null }) | undefined)?.preview ?? null
      if (!samePreview(cur, previewSummary)) updateTabState('search', tabId, { preview: previewSummary } as unknown as Partial<SearchTabState>)
    }, 300)
    return () => clearTimeout(t)
  }, [previewSummary, loading, tabId, updateTabState])

  // Search's caret (T23-013): the filters live here now (no filter button in the header), in a
  // clear order — what to search, how to match, which texts / books / tags, how to sort. Values
  // are read from the tab's live state so inline controls and sub-views stay current.
  useCaretCommands(() => {
    const live = liveSearchState(tabId)
    const f = tabFilters(live)
    const sc: Scope = live?.scope ?? 'all'
    const q = (live?.query ?? query).trim()
    const count = activeFilterCount(f)
    return {
      title: q ? `Search · “${q}”` : 'Search', backTitle: 'Search',
      // Same header as every caret (SEP24-008): tap to edit the query in the page's own field.
      location: { label: q ? `“${q}”` : 'Search', placeholder: 'Edit the search', run: () => setTimeout(() => (document.querySelector('.mobile-search-input') as HTMLInputElement | null)?.focus(), 250) },
      // Search IA (TEST 2026-09-29): filters live in ONE place — the chips under the field.
      // The caret only points there and carries the tab-level actions (no duplicate controls).
      sections: [
        ...(scopeHasFilters(sc) ? [{ id: 'filters', commands: [
          { kind: 'action' as const, id: 'filters', label: count ? `Filters & sort · ${count}` : 'Filters & sort', icon: SlidersHorizontal, run: () => openFiltersSheet(tabId, sc) },
          ...(count ? [{ kind: 'action' as const, id: 'reset', label: 'Reset filters', icon: RotateCcw, keepOpen: true, run: () => resetSearchFilters(tabId) }] : []),
        ] }] : []),
        { id: 'more', commands: [
          { kind: 'action', id: 'clear', label: 'Clear search', icon: X, disabled: !q, run: () => setQuery('') },
          // History opens INSIDE this sheet ("‹ Search"), keeping its position (NEW-014).
          { kind: 'view', id: 'history', label: 'History', icon: HistoryIcon, view: () => ({ title: 'History', render: (a: SheetApi) => <HistoryView onNavigated={a.close} /> }) },
        ] },
      ],
    }
  })
  const snippetQuery = browsing ? '' : query
  // Tertiary actions (TEST 2026-09-29 IA): the header's "…".
  const actions = useActionSheet()
  const openOverflow = () => {
    void haptic.light()
    actions('search-more', 'Search', [
      { id: 'history', label: 'History', icon: HistoryIcon, onSelect: () => {}, view: () => ({ key: 'history', title: 'History', render: (a: SheetApi) => <HistoryView onNavigated={a.close} /> }) },
      ...(scopeHasFilters(scope) ? [{ id: 'filters', label: 'All filters & sort…', icon: SlidersHorizontal, onSelect: () => openFiltersSheet(tabId, scope) }] : []),
      ...(activeFilterCount(filters, scope) ? [{ id: 'reset', label: 'Reset filters', icon: RotateCcw, onSelect: () => resetSearchFilters(tabId) }] : []),
      ...(query ? [{ id: 'clear', label: 'Clear search', icon: X, onSelect: () => setQuery('') }] : []),
    ])
  }
  // Declared after the caret closure that calls it — only ever invoked on a tap, after render.
  const openFiltersSheet = (tid: string, sc: Scope) => {
    void haptic.light()
    sheets.open({ id: `search-filters-${tid}`, title: 'Filters & sort', detents: [0.62, 0.92], render: (api) => <SearchFiltersSheet tabId={tid} scope={sc} api={api} /> })
  }

  return (
    <Page
      title="Search"
      right={<IconTap icon={MoreHorizontal} label="More search options" onClick={openOverflow} />}
      headerBelow={
        <>
          <form className="mobile-search-row" onSubmit={submit}>
            <Search size={16} aria-hidden />
            <input className="mobile-search-input" type="search" enterKeyHint="search" autoCorrect="off"
              placeholder={scope === 'all' ? 'Search Berean' : scope === 'scripture' ? 'Word, phrase, reference or H7225…' : scope === 'notes' ? 'Search notes…' : 'Word, transliteration or Strong\'s number…'}
              value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
            {query && <button type="button" className="mobile-search-clear" aria-label="Clear" onClick={() => setQuery('')}><X size={16} aria-hidden /></button>}
          </form>
          <div className="mobile-search-scope"><Segmented full label="Search in" value={scope} options={SCOPE_OPTIONS} onChange={(v) => setScope(v as Scope)} /></div>
          {scopeHasFilters(scope) && <FilterChips tabId={tabId} filters={filters} scope={scope} />}
        </>
      }
    >
      <div ref={bodyAnchorRef} hidden />
      {loading && <div className="mobile-muted" style={{ padding: '8px 16px' }}>Searching…</div>}
      {!query.trim() && !browsing && recent.length > 0 && (
        <ListSection title="Recent">
          {recent.map((r) => <LongPressResult key={r} onLongPress={() => resultActions.recent(r)}><Row leading={<Clock size={16} aria-hidden />} title={r} onClick={() => runRecent(r)} /></LongPressResult>)}
        </ListSection>
      )}
      {!query.trim() && !browsing && recent.length === 0 && <div className="mobile-empty">Search every text, Strong's and your notes. Type a reference to jump straight to it.</div>}
      {scope === 'all' && query.trim() && (
        <UnifiedResultsList full results={unified} query={query} wordMode={unified?.intent.phrase ? 'phrase' : wordMode} loading={loading && !unified}
          onPick={pickUnified} onLongPick={longPickUnified} onSeeAll={(sc) => setScope(sc)} />
      )}
      {scope === 'scripture' && filteredHits && (
        filteredHits.length === 0 ? ((query.trim().length >= 2 || browsing) && !loading ? <div className="mobile-empty">{tagIds.length && shownHits && shownHits.length > 0 ? 'No matches in the selected tags.' : browsing ? 'Nothing tagged yet.' : 'No matches.'}</div> : null) : (
          <>
            <div className="mobile-search-summary">
              <span className="mobile-muted">
                {browsing ? `${page.total} tagged verse${page.total === 1 ? '' : 's'}` : `${page.total} verse${page.total === 1 ? '' : 's'}`} in {groups.length} book{groups.length === 1 ? '' : 's'}
                {!browsing && tagIds.length > 0 && shownHits && shownHits.length !== page.total ? ` · ${shownHits.length} before tags` : ''}
              </span>
              {tagIds.length > 0 && <button type="button" className="mobile-link-button" onClick={() => setFilters((f) => ({ ...f, tagIds: [] }))}><Tag size={14} aria-hidden /> {tagIds.length} tag{tagIds.length === 1 ? '' : 's'} · clear</button>}
            </div>
            {page.groups.map((g) => {
              const full = groups.find((x) => x.bookId === g.bookId)
              return (
                <ListSection key={g.bookId} title={`${bookName(g.bookId)} · ${full?.hits.length ?? g.hits.length}`}>
                  {g.hits.map((h) => (
                    <LongPressResult key={`${h.textId}-${h.book_id}-${h.chapter}-${h.verse_num}`} onLongPress={() => resultActions.scripture(h)}><Row chevron onClick={() => openHit(h)}
                      title={<span className="mobile-occurrence-ref">{bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)}{h.textId === 'lxx' ? <span className="mobile-muted"> LXX</span> : null}</span>}
                      subtitle={<span className="mobile-search-snippet">{applyFindHighlight(buildAllWordsSnippet(displayHitText(h), snippetQuery, 140).text, h.strongsWords && !h.wrReplacement && !h.text_tagged ? '' : snippetQuery, wordMode)}</span>} /></LongPressResult>
                  ))}
                </ListSection>
              )
            })}
            {page.shown < page.total && (
              <div className="mobile-search-more">
                <span>Showing {page.shown} of {page.total}</span>
                <button type="button" onClick={grow}>Show more</button>
                <div ref={sentinelRef} className="mobile-search-sentinel" aria-hidden />
              </div>
            )}
          </>
        )
      )}
      {scope === 'notes' && notes && (
        <ListSection title={`${notes.length} note${notes.length === 1 ? '' : 's'}`}>
          {notes.length === 0 && <div className="mobile-empty">No notes match.</div>}
          {notes.map((n) => (
            <LongPressResult key={n.id} onLongPress={() => resultActions.note(n)}><Row chevron title={displayNoteTitle(n.title)} subtitle={applyFindHighlight(stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 140), query, wordMode)} onClick={() => openNote(n)} /></LongPressResult>
          ))}
        </ListSection>
      )}
      {scope === 'lexicon' && entries && (
        <ListSection title={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}>
          {entries.length === 0 && <div className="mobile-empty">No entries match.</div>}
          {entries.slice(0, 200).map((e) => (
            <LongPressResult key={e.strongsNum} onLongPress={() => resultActions.entry(e)}><Row chevron title={<><span className="mobile-strongs-num">{e.strongsNum}</span> {e.lemma} <span className="mobile-muted">{e.transliteration}</span></>} subtitle={e.gloss}
              onClick={() => openEntry(e)} /></LongPressResult>
          ))}
          {entries.length > 0 && <Row title="Open in Lexicon" onClick={() => openDestination({ kind: 'strongs', num: entries[0].strongsNum }, 'current-tab')} />}
        </ListSection>
      )}
    </Page>
  )
}

/** The snippet window centres on the query's words; a Strong's query has none to centre on. */
function snippetQueryFor(q: string): string { return /^[HG]\d+$/i.test(q) ? '' : q }

/** Caret → Text: every text or one. Picking returns to the caret. */
function SearchTextChoices({ tabId, api }: { tabId: string; api: SheetApi }) {
  const f = useAppStore((s) => tabFilters(s.tabs.search.find((t) => t.id === tabId)?.state as SearchTabState | undefined))
  return (
    <ChoiceList api={api} value={f.textId}
      options={[{ id: 'all', label: 'All texts' }, ...TRANSLATIONS.map((t) => ({ id: t.id, label: t.label, detail: t.description }))]}
      onSelect={(id) => patchSearchFilters(tabId, { textId: id })} />
  )
}

/** Caret → Books: individual books, several at once (NEW-015; the shared BooksFilterView). */
function SearchBooksFilter({ tabId }: { tabId: string }) {
  const f = useAppStore((s) => tabFilters(s.tabs.search.find((t) => t.id === tabId)?.state as SearchTabState | undefined))
  return <BooksFilterView value={f.books} onChange={(ids) => patchSearchFilters(tabId, { books: ids })} />
}

/** Caret → Verse tags: narrow results to tagged verses (any / every tag). */
function SearchTagsFilter({ tabId, api }: { tabId: string; api: SheetApi }) {
  const f = useAppStore((s) => tabFilters(s.tabs.search.find((t) => t.id === tabId)?.state as SearchTabState | undefined))
  const verseTags = useAppStore((s) => s.verseTags)
  const openTagsGraph = useAppStore((s) => s.openTagsGraph)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const toggleTag = (id: string) => { void haptic.selection(); patchSearchFilters(tabId, { tagIds: f.tagIds.includes(id) ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id] }) }
  return (
    <div className="mobile-search-filters">
      {verseTags.length === 0 ? (
        <div className="mobile-muted">No verse tags yet — tap a verse, then Tag.</div>
      ) : (
        <div className="mobile-chip-row" role="group" aria-label="Verse tags">
          {verseTags.map((t) => (
            <button key={t.id} type="button" className={`mobile-chip mobile-search-tag-chip${f.tagIds.includes(t.id) ? ' is-on' : ''}`} aria-pressed={f.tagIds.includes(t.id)} onClick={() => toggleTag(t.id)}>
              <span className="mobile-tag-dot" style={{ backgroundColor: resolveTagColor(t) }} aria-hidden /> {t.name}
            </button>
          ))}
        </div>
      )}
      {f.tagIds.length >= 2 && (
        <div className="mobile-search-filter-row">
          <span className="mobile-muted">Verse must be in</span>
          <Segmented value={f.tagMatchAll ? 'all' : 'any'} options={[['any', 'Any tag'], ['all', 'Every tag']]} onChange={(v) => patchSearchFilters(tabId, { tagMatchAll: v === 'all' })} />
        </div>
      )}
      <div className="mobile-search-filter-row">
        <button type="button" className="mobile-link-button" onClick={() => { api.close(); openTagsGraph(); setActiveSpace('notes') }}>Manage tags</button>
      </div>
    </div>
  )
}

/**
 * Contextual filters (TEST 2026-09-29 IA): one horizontally scrolling row of chips directly under
 * the scope switch — each shows its current value (accent when not the default) and opens its own
 * small picker. Words for every scope with filters; Text · Books · Tags · Sort for Scripture.
 */
function FilterChips({ tabId, filters: f, scope }: { tabId: string; filters: SearchFilterState; scope: Scope }) {
  const sheets = useSheets()
  const scripture = scope === 'scripture' || scope === 'all'
  const open = (id: string, title: string, render: (api: SheetApi) => React.ReactNode, tall = false) => {
    void haptic.selection()
    sheets.open({ id: `search-chip-${id}-${tabId}`, title, detents: [tall ? 0.72 : 0.42, 0.92], render })
  }
  const sortValue = f.sort === 'relevance' ? 'relevance' : f.direction === 'asc' ? 'bible' : 'bible-rev'
  const chips: Array<{ id: string; label: string; on: boolean; onClick: () => void }> = [
    { id: 'words', label: WORD_MODE_LABEL[f.wordMode], on: f.wordMode !== 'all', onClick: () => open('words', 'Match', (api) => (
      <ChoiceList api={api} closeOnSelect value={f.wordMode} options={(['all', 'any', 'phrase'] as WordMode[]).map((m) => ({ id: m, label: WORD_MODE_LABEL[m] }))} onSelect={(v) => patchSearchFilters(tabId, { wordMode: v as WordMode })} />
    )) },
    ...(scripture ? [
      { id: 'text', label: textFilterLabel(f.textId), on: f.textId !== 'all', onClick: () => open('text', 'Text', (api: SheetApi) => <SearchTextChoices tabId={tabId} api={api} />, true) },
      { id: 'books', label: booksSummary(f.books), on: f.books.length > 0, onClick: () => open('books', 'Books', () => <SearchBooksFilter tabId={tabId} />, true) },
      { id: 'tags', label: f.tagIds.length ? `${f.tagIds.length} tag${f.tagIds.length === 1 ? '' : 's'}` : 'Tags', on: f.tagIds.length > 0, onClick: () => open('tags', 'Verse tags', (api: SheetApi) => <SearchTagsFilter tabId={tabId} api={api} />, true) },
      { id: 'sort', label: sortValue === 'relevance' ? 'Best match' : sortValue === 'bible' ? 'Bible order' : 'Reverse order', on: f.sort !== 'relevance', onClick: () => open('sort', 'Sort', (api: SheetApi) => (
        <ChoiceList api={api} closeOnSelect value={sortValue}
          options={[{ id: 'relevance', label: 'Best match first' }, { id: 'bible', label: 'Bible order', detail: 'Genesis → end' }, { id: 'bible-rev', label: 'Reverse Bible order', detail: 'End → Genesis' }]}
          onSelect={(v) => patchSearchFilters(tabId, v === 'relevance' ? { sort: 'relevance', direction: 'desc' } : { sort: 'bookOrder', direction: v === 'bible' ? 'asc' : 'desc' })} />
      )) },
    ] : []),
  ]
  const count = activeFilterCount(f, scope)
  return (
    <div className="mobile-search-chips" role="group" aria-label="Filters">
      {chips.map((c) => (
        <button key={c.id} type="button" className={`mobile-search-chip${c.on ? ' is-on' : ''}`} onClick={c.onClick} aria-label={`${c.id === 'words' ? 'Match' : c.id[0].toUpperCase() + c.id.slice(1)}: ${c.label}`}>
          <span>{c.label}</span><ChevronDown size={13} aria-hidden />
        </button>
      ))}
      {count > 0 && <button type="button" className="mobile-search-chip is-reset" onClick={() => { void haptic.light(); resetSearchFilters(tabId) }} aria-label="Reset filters"><RotateCcw size={13} aria-hidden /><span>Reset</span></button>}
    </div>
  )
}

/**
 * Advanced Search options, grouped the iOS way: how to match, what to search (text / books / verse
 * tags — each a sub-view in this same sheet), how to sort, and Reset. Reads the tab's live state so
 * every control stays current. Notes only has the match mode; Strong's numbers need no option —
 * typing H7225 / G3056 searches their occurrences.
 */
function SearchFiltersSheet({ tabId, scope, api }: { tabId: string; scope: Scope; api: SheetApi }) {
  const f = useAppStore((s) => tabFilters(s.tabs.search.find((t) => t.id === tabId)?.state as SearchTabState | undefined))
  const count = activeFilterCount(f, scope)
  const scripture = scope === 'scripture'
  return (
    <div className="mobile-search-filter-sheet">
      <ListSection title="Match">
        <Row title="Words" right={
          <Segmented value={f.wordMode} options={[['all', 'All'], ['any', 'Any'], ['phrase', 'Phrase']]} onChange={(v) => patchSearchFilters(tabId, { wordMode: v as WordMode })} />
        } />
      </ListSection>
      {scripture && (
        <>
          <ListSection title="Search in">
            <Row leading={<Languages size={18} aria-hidden />} title="Text" right={textFilterLabel(f.textId)} chevron
              onClick={() => api.push({ key: 'text', title: 'Text', render: (a) => <SearchTextChoices tabId={tabId} api={a} /> })} />
            <Row leading={<Library size={18} aria-hidden />} title="Books" right={booksSummary(f.books)} chevron
              onClick={() => api.push({ key: 'books', title: 'Books', render: () => <SearchBooksFilter tabId={tabId} /> })} />
            <Row leading={<TagsIcon size={18} aria-hidden />} title="Verse tags" right={f.tagIds.length ? `${f.tagIds.length} selected` : 'None'} chevron
              onClick={() => api.push({ key: 'tags', title: 'Verse tags', render: (a) => <SearchTagsFilter tabId={tabId} api={a} /> })} />
          </ListSection>
          <ListSection title="Sort">
            <Row title="Order" right={
              <Segmented value={f.sort} options={[['relevance', 'Relevance'], ['bookOrder', 'Bible order']]} onChange={(v) => patchSearchFilters(tabId, { sort: v as SearchSortMode, direction: naturalDirection(v as SearchSortMode) })} />
            } />
            <Row title="Direction" right={
              <Segmented value={f.direction}
                options={f.sort === 'relevance' ? [['desc', 'Best first'], ['asc', 'Weakest']] : [['asc', 'Gen → end'], ['desc', 'End → Gen']]}
                onChange={(v) => patchSearchFilters(tabId, { direction: v as SearchSortDirection })} />
            } />
          </ListSection>
        </>
      )}
      <ListSection>
        <Row leading={<RotateCcw size={18} aria-hidden />} title="Reset filters"
          onClick={count ? () => { void haptic.light(); resetSearchFilters(tabId) } : undefined} />
      </ListSection>
      <div className="settings-section-note">Type a reference to open it, or a Strong's number (H7225, G3056) to find its occurrences.</div>
    </div>
  )
}

import { displayNoteTitle } from '@/lib/noteTitle'