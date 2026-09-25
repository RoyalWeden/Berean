import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCaretCommands } from '../commands/caretRegistry'
import { Search, X, Clock, Tag, Languages, Library, Tags as TagsIcon, ListFilter, RotateCcw, History as HistoryIcon, ArrowDownUp, Type, SlidersHorizontal } from 'lucide-react'
import type { Note, LexiconEntry, VerseTagMember, Tab, SearchTabState } from '@/types'
import { useAppStore } from '@/store'
import { bookName, parseRef, bookChapterVerseLabel } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { applyFindHighlight } from '@/lib/highlight'
import { buildAllWordsSnippet } from '@/components/bible/ScriptureSearchView'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { navigateToVerse } from '@/lib/verseNavigation'
import { resolveTagColor } from '@/lib/tagPalette'
import {
  runScriptureSearch, runStrongsSearch, groupHitsByBook, filterHitsByVerseTags, takeGroupRows,
  type ScriptureHit, type SearchSortMode, type SearchSortDirection,
} from '@/lib/scriptureSearch'
import { booksSummary } from '@/lib/scriptureSearchFilters'
import {
  DEFAULT_SEARCH_FILTERS, activeFilterCount, filtersSummary, scopeHasFilters, textFilterLabel,
  type SearchFilterState,
} from './searchFilters'
import { BooksFilterView } from './BooksFilterView'
import { HistoryView } from '../history/HistoryPage'
import type { WordMode } from '@/lib/scriptureHighlight'
import { Page, ListSection, Row } from '../primitives/Page'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { ChoiceList } from '../primitives/ActionSheet'
import { Segmented } from '../settings/SettingsPage'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import { useIncrementalLimit } from './useIncrementalLimit'
import { loadTaggedVerses } from './taggedBrowse'
import { useSearchResultActions, LongPressResult } from './ResultActionSheet'
import { buildSearchPreview, samePreview, type SearchPreviewSummary } from './resultActions'
import { commitSearchStep, isSearchCommitted, markSearchCommitted, searchSnapshot } from './searchHistory'
import './search.css'

type Scope = 'scripture' | 'notes' | 'lexicon'

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
  const scope: Scope = st.scope ?? 'scripture'
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
  const [loading, setLoading] = useState(false)
  const recent = useAppStore((s) => s.recentSearchQueries)
  const addRecent = useAppStore((s) => s.addRecentSearchQuery)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const verseTags = useAppStore((s) => s.verseTags)
  const verseTagChangeToken = useAppStore((s) => s.verseTagChangeToken)
  const seq = useRef(0)
  // `openSearchTab(query)` from anywhere (deep link, history, tag search) lands here.
  const pendingSearchQuery = useAppStore((s) => s.pendingSearchQuery)
  const clearSearchQuery = useAppStore((s) => s.clearSearchQuery)
  useEffect(() => {
    if (!pendingSearchQuery) return
    setScope('scripture'); setQuery(pendingSearchQuery); clearSearchQuery()
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
    if (trimmed.length < 2) { setHits(null); setNotes(null); setEntries(null); return }
    setLoading(true)
    try {
      if (scope === 'notes') {
        const r = await window.notes.searchNotes(trimmed, 200, wordMode)
        if (my === seq.current) { setNotes(r); setHits(null); setEntries(null) }
      } else if (scope === 'lexicon') {
        const r = await window.lexicon.search(trimmed, 'all')
        if (my === seq.current) { setEntries(r); setHits(null); setNotes(null) }
      } else {
        const t0 = performance.now()
        const strongs = await runStrongsSearch(trimmed)
        const r = strongs ?? await runScriptureSearch(trimmed, { textId, wordMode, bookIds: books.length ? books : undefined, wordReplacerEnabled, wordReplacerRules })
        console.debug(`[perf] search "${trimmed}" (${textId}) → ${r.length} hits in ${Math.round(performance.now() - t0)}ms`)
        if (my === seq.current) { setHits(r); setNotes(null); setEntries(null) }
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
    const ref = scope === 'scripture' ? parseRef(trimmed) : null
    if (ref) { void haptic.light(); setActiveSpace('scripture'); navigateToVerse({ bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null, origin: { kind: 'search-result', query: trimmed } }) }
  }
  // A tap opens the hit in the CURRENT Scripture tab (SEP25): navigateToVerse picks that tab (or
  // the most recent Bible tab when the current one is a PDF / tags graph) — the find-highlight
  // state is then written to the tab it actually landed in, never to a non-Bible tab.
  const openHit = (h: ScriptureHit) => {
    const q = query.trim()
    if (q) addRecent(q)
    navigateToVerse({ bookId: h.book_id, chapter: h.chapter, verse: h.verse_num, translationOverride: h.textId.toUpperCase(), origin: { kind: 'search-result', query: q || tagIds.map((id) => verseTags.find((t) => t.id === id)?.name ?? id).join(', ') } })
    const s = useAppStore.getState()
    const landed = s.activeTabId.scripture
    if (landed) s.updateTabState('scripture', landed, { targetVerseQuery: h.strongsWords || browsing ? undefined : q, targetVerseWordMode: wordMode, targetVerseStrongsWords: h.strongsWords })
  }

  // Tag filter + sort are client-side passes over the hit list, so flipping them never re-queries.
  const shownHits = browsing ? browseHits : hits
  const filteredHits = useMemo(() => (shownHits && !browsing ? filterHitsByVerseTags(shownHits, tagMembers, tagIds, tagMatchAll) : shownHits), [shownHits, browsing, tagMembers, tagIds, tagMatchAll])
  const groups = useMemo(() => (filteredHits ? groupHitsByBook(filteredHits, { sort, direction }) : []), [filteredHits, sort, direction])
  const { limit, grow, sentinelRef } = useIncrementalLimit(groups, RESULT_CHUNK)
  const page = useMemo(() => takeGroupRows(groups, limit), [groups, limit])

  const openNote = (n: Note) => { addRecent(query.trim()); setActiveSpace('notes'); requestOpenNote(n.id) }
  // Once results for a restored step have loaded, put the list back where it was.
  useEffect(() => {
    if (loading || pendingScroll.current == null) return
    const body = bodyAnchorRef.current?.closest('.mobile-page-body') as HTMLElement | null
    if (!body) return
    const y = pendingScroll.current
    pendingScroll.current = null
    requestAnimationFrame(() => { body.scrollTop = y })
  }, [loading, hits, browseHits, notes, entries])
  const runRecent = (r: string) => { setQuery(r); commitQuery(r) }
  const openEntry = (e: LexiconEntry) => sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={e.strongsNum} api={api} onNavigate={() => setActiveSpace('scripture')} /> })
  // Long-press menus (SEP24): the same Open as a tap, plus new tab / copy / share / note / highlight.
  const resultActions = useSearchResultActions({ openHit, openNote, openEntry, runRecent, scope })

  // Tab-card preview (T23-011): a tiny summary of what this tab currently shows, saved into the
  // tab's LOCAL state (tabFields.ts — never synced) once results settle, so the card needs no
  // search of its own. Empty query → cleared (the card then shows recent queries).
  const previewSummary = useMemo<SearchPreviewSummary | null>(() => {
    const q = browsing ? '' : query.trim()
    if (scope === 'scripture' && filteredHits && (q.length >= 2 || browsing)) {
      const rows = groups.flatMap((g) => g.hits.slice(0, 3)).slice(0, 3)
      return buildSearchPreview(q, filteredHits.length, rows.map((h) => ({ ref: bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num), text: buildAllWordsSnippet(h.text, snippetQueryFor(q), 120).text })))
    }
    if (scope === 'notes' && notes && q.length >= 2) return buildSearchPreview(q, notes.length, notes.map((n) => ({ ref: n.title || 'Untitled', text: stripMarkdownFormatting(n.content ?? '') })))
    if (scope === 'lexicon' && entries && q.length >= 2) return buildSearchPreview(q, entries.length, entries.map((e) => ({ ref: `${e.strongsNum} ${e.lemma ?? ''}`.trim(), text: e.gloss ?? '' })))
    return null
  }, [scope, filteredHits, groups, notes, entries, query, browsing])
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
    const sc: Scope = live?.scope ?? 'scripture'
    const q = (live?.query ?? query).trim()
    const count = activeFilterCount(f)
    const textLabel = textFilterLabel(f.textId)
    const booksLabel = booksSummary(f.books)
    const tagsLabel = f.tagIds.length === 0 ? 'None' : `${f.tagIds.length} tag${f.tagIds.length === 1 ? '' : 's'}`
    return {
      title: q ? `Search · “${q}”` : 'Search', backTitle: 'Search',
      // Same header as every caret (SEP24-008): tap to edit the query in the page's own field.
      location: { label: q ? `“${q}”` : 'Search', placeholder: 'Edit the search', run: () => setTimeout(() => (document.querySelector('.mobile-search-input') as HTMLInputElement | null)?.focus(), 250) },
      sections: [
        // No Scope row (NEW-014): the page's own Scripture / Notes / Lexicon switch is the scope.
        { id: 'match', title: 'Match', commands: [
          { kind: 'segmented', id: 'word-mode', label: 'Words', icon: Type, value: f.wordMode, options: [['all', 'All'], ['any', 'Any'], ['phrase', 'Phrase']], set: (v) => patchSearchFilters(tabId, { wordMode: v as WordMode }) },
        ] },
        ...(sc === 'scripture' ? [
          { id: 'filters', title: count ? `Scripture filters · ${count}` : 'Scripture filters', commands: [
            { kind: 'view' as const, id: 'text', label: 'Text', icon: Languages, value: textLabel, view: () => ({ title: 'Text', render: (a: SheetApi) => <SearchTextChoices tabId={tabId} api={a} /> }) },
            { kind: 'view' as const, id: 'books', label: 'Books', icon: Library, value: booksLabel, view: () => ({ title: 'Books', render: () => <SearchBooksFilter tabId={tabId} /> }) },
            { kind: 'view' as const, id: 'tags', label: 'Verse tags', icon: TagsIcon, value: tagsLabel, view: () => ({ title: 'Verse tags', render: (a: SheetApi) => <SearchTagsFilter tabId={tabId} api={a} /> }) },
            { kind: 'action' as const, id: 'reset', label: 'Reset filters', icon: RotateCcw, keepOpen: true, disabled: count === 0, run: () => resetSearchFilters(tabId) },
          ] },
          { id: 'sort', title: 'Sort', commands: [
            { kind: 'segmented' as const, id: 'sort', label: 'Order', icon: ListFilter, value: f.sort, options: [['relevance', 'Relevance'], ['bookOrder', 'Bible order']] as Array<[string, string]>, set: (v: string) => patchSearchFilters(tabId, { sort: v as SearchSortMode, direction: naturalDirection(v as SearchSortMode) }) },
            { kind: 'segmented' as const, id: 'direction', label: 'Direction', icon: ArrowDownUp, value: f.direction,
              options: (f.sort === 'relevance' ? [['desc', 'Best first'], ['asc', 'Weakest first']] : [['asc', 'Genesis → end'], ['desc', 'End → Genesis']]) as Array<[string, string]>,
              set: (v: string) => patchSearchFilters(tabId, { direction: v as SearchSortDirection }) },
          ] },
        ] : []),
        { id: 'more', commands: [
          { kind: 'action', id: 'clear', label: 'Clear search', icon: X, disabled: !q, run: () => setQuery('') },
          // History opens INSIDE this sheet ("‹ Search"), keeping its position (NEW-014).
          { kind: 'view', id: 'history', label: 'History', icon: HistoryIcon, view: () => ({ title: 'History', render: (a: SheetApi) => <HistoryView onNavigated={a.close} /> }) },
        ] },
      ],
    }
  })
  const snippetQuery = browsing ? '' : query
  // Advanced Search (SEP25): every option lives behind the ONE Filters entry, in its own sheet.
  const openFilters = () => {
    void haptic.light()
    sheets.open({ id: `search-filters-${tabId}`, title: 'Filters', detents: [0.62, 0.92], render: (api) => <SearchFiltersSheet tabId={tabId} scope={scope} api={api} /> })
  }

  return (
    <Page
      title="Search"
      headerBelow={
        <>
          <form className="mobile-search-row" onSubmit={submit}>
            <Search size={16} aria-hidden />
            <input className="mobile-search-input" type="search" enterKeyHint="search" autoCorrect="off" autoCapitalize="none"
              placeholder={scope === 'scripture' ? 'Word, phrase, reference or H7225…' : scope === 'notes' ? 'Search notes…' : 'Word, transliteration or Strong\'s number…'}
              value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
            {query && <button type="button" className="mobile-search-clear" aria-label="Clear" onClick={() => setQuery('')}><X size={16} aria-hidden /></button>}
          </form>
          <div className="mobile-search-scope"><Segmented value={scope} options={[['scripture', 'Scripture'], ['notes', 'Notes'], ['lexicon', 'Lexicon']]} onChange={(v) => setScope(v as Scope)} /></div>
          {scopeHasFilters(scope) && <FiltersEntry filters={filters} scope={scope} onOpen={openFilters} />}
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
      {!query.trim() && !browsing && recent.length === 0 && <div className="mobile-empty">Search every text, your notes, or the lexicon. Type a reference to jump straight to it.</div>}
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
                      title={<span className="mobile-occurrence-ref">{bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)}{textId === 'all' ? <span className="mobile-muted"> · {TRANSLATIONS.find((t) => t.id === h.textId)?.label ?? h.textId}</span> : null}</span>}
                      subtitle={<span className="mobile-search-snippet">{applyFindHighlight(buildAllWordsSnippet(h.text, snippetQuery, 140).text, h.strongsWords ? '' : snippetQuery, wordMode)}</span>} /></LongPressResult>
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
            <LongPressResult key={n.id} onLongPress={() => resultActions.note(n)}><Row chevron title={n.title || 'Untitled'} subtitle={applyFindHighlight(stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 140), query, wordMode)} onClick={() => openNote(n)} /></LongPressResult>
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
          {entries.length > 0 && <Row title="Open in Lexicon space" onClick={() => { setActiveSpace('lexicon'); openLexiconEntry(entries[0].strongsNum) }} />}
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

/** The ONE compact Filters entry under the scope switch: a summary of what the search covers and
 *  a count badge of non-default filters. Tapping opens the Advanced options sheet. */
function FiltersEntry({ filters, scope, onOpen }: { filters: SearchFilterState; scope: Scope; onOpen: () => void }) {
  const count = activeFilterCount(filters, scope)
  const summary = filtersSummary(filters, scope)
  return (
    <div className="mobile-search-filters-entry">
      <button type="button" className={`mobile-search-filters-button${count ? ' is-active' : ''}`} onClick={onOpen}
        aria-label={`Filters: ${summary}${count ? `, ${count} active` : ''}`}>
        <SlidersHorizontal size={15} aria-hidden />
        <span className="mobile-search-filters-label">Filters</span>
        <span className="mobile-search-filters-summary">{summary}</span>
        {count > 0 && <span className="mobile-search-filters-badge" aria-hidden>{count}</span>}
      </button>
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
