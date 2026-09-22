import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X, Clock, ArrowUp, ArrowDown, Tag } from 'lucide-react'
import type { Note, LexiconEntry, VerseTagMember } from '@/types'
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
import { CANONICAL_BOOK_GROUPS, toggleGroup, isGroupActive } from '@/lib/scriptureSearchFilters'
import type { WordMode } from '@/lib/scriptureHighlight'
import { Page, IconTap, ListSection, Row } from '../primitives/Page'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { Segmented } from '../settings/SettingsPage'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import { useIncrementalLimit } from './useIncrementalLimit'
import { loadTaggedVerses } from './taggedBrowse'
import './search.css'

type Scope = 'scripture' | 'notes' | 'lexicon'

/** Everything the filter sheet edits. Tags and sort are applied client-side to the hit list;
 *  text / match / books change the query itself (same split as ScriptureSearchView). */
export interface SearchFilterState {
  textId: string | 'all'
  wordMode: WordMode
  books: string[]
  /** Selected verse-tag ids; results narrow to tagged verses (chapter tags cover every verse). */
  tagIds: string[]
  /** Every selected tag must contain the verse (AND) rather than any one (OR). */
  tagMatchAll: boolean
  sort: SearchSortMode
  direction: SearchSortDirection
}
export const DEFAULT_SEARCH_FILTERS: SearchFilterState = { textId: 'all', wordMode: 'all', books: [], tagIds: [], tagMatchAll: false, sort: 'relevance', direction: 'desc' }
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
export function SearchPage() {
  const sheets = useSheets()
  const [scope, setScope] = useState<Scope>('scripture')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS)
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
        const strongs = await runStrongsSearch(trimmed)
        const r = strongs ?? await runScriptureSearch(trimmed, { textId, wordMode, bookIds: books.length ? books : undefined, wordReplacerEnabled, wordReplacerRules })
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
    const ref = scope === 'scripture' ? parseRef(trimmed) : null
    if (ref) { void haptic.light(); setActiveSpace('scripture'); navigateToVerse({ bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null, origin: { kind: 'search-result', query: trimmed } }) }
  }
  const openHit = (h: ScriptureHit) => {
    const q = query.trim()
    if (q) addRecent(q)
    const s = useAppStore.getState()
    s.setActiveSpace('scripture')
    s.ensureTab('bible')
    const tabId = useAppStore.getState().activeTabId.scripture
    if (tabId) s.updateTabState('scripture', tabId, { translation: h.textId.toUpperCase(), targetVerseQuery: h.strongsWords || browsing ? undefined : q, targetVerseWordMode: wordMode, targetVerseStrongsWords: h.strongsWords })
    navigateToVerse({ bookId: h.book_id, chapter: h.chapter, verse: h.verse_num, origin: { kind: 'search-result', query: q || tagIds.map((id) => verseTags.find((t) => t.id === id)?.name ?? id).join(', ') } })
  }

  // Tag filter + sort are client-side passes over the hit list, so flipping them never re-queries.
  const shownHits = browsing ? browseHits : hits
  const filteredHits = useMemo(() => (shownHits && !browsing ? filterHitsByVerseTags(shownHits, tagMembers, tagIds, tagMatchAll) : shownHits), [shownHits, browsing, tagMembers, tagIds, tagMatchAll])
  const groups = useMemo(() => (filteredHits ? groupHitsByBook(filteredHits, { sort, direction }) : []), [filteredHits, sort, direction])
  const { limit, grow, sentinelRef } = useIncrementalLimit(groups, RESULT_CHUNK)
  const page = useMemo(() => takeGroupRows(groups, limit), [groups, limit])
  const filterCount = (textId !== 'all' ? 1 : 0) + (books.length ? 1 : 0) + (wordMode !== 'all' ? 1 : 0) + (tagIds.length ? 1 : 0) + (sort !== 'relevance' ? 1 : 0)
  const snippetQuery = browsing ? '' : query

  const openFilters = () => sheets.open({ id: 'search-filters', title: 'Filters', detents: [0.75, 0.92], render: (api) => (
    <SearchFilters initial={filters} onChange={setFilters} api={api} />
  ) })

  return (
    <Page
      title="Search"
      right={scope === 'scripture' ? <IconTap icon={SlidersHorizontal} label={`Filters${filterCount ? ` (${filterCount})` : ''}`} active={filterCount > 0} onClick={openFilters} /> : undefined}
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
        </>
      }
    >
      {loading && <div className="mobile-muted" style={{ padding: '8px 16px' }}>Searching…</div>}
      {!query.trim() && !browsing && recent.length > 0 && (
        <ListSection title="Recent">
          {recent.map((r) => <Row key={r} leading={<Clock size={16} aria-hidden />} title={r} onClick={() => setQuery(r)} />)}
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
                    <Row key={`${h.textId}-${h.book_id}-${h.chapter}-${h.verse_num}`} chevron onClick={() => openHit(h)}
                      title={<span className="mobile-occurrence-ref">{bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)}{textId === 'all' ? <span className="mobile-muted"> · {TRANSLATIONS.find((t) => t.id === h.textId)?.label ?? h.textId}</span> : null}</span>}
                      subtitle={<span className="mobile-search-snippet">{applyFindHighlight(buildAllWordsSnippet(h.text, snippetQuery, 140).text, h.strongsWords ? '' : snippetQuery, wordMode)}</span>} />
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
            <Row key={n.id} chevron title={n.title || 'Untitled'} subtitle={applyFindHighlight(stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 140), query, wordMode)} onClick={() => { addRecent(query.trim()); setActiveSpace('notes'); requestOpenNote(n.id) }} />
          ))}
        </ListSection>
      )}
      {scope === 'lexicon' && entries && (
        <ListSection title={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}>
          {entries.length === 0 && <div className="mobile-empty">No entries match.</div>}
          {entries.slice(0, 200).map((e) => (
            <Row key={e.strongsNum} chevron title={<><span className="mobile-strongs-num">{e.strongsNum}</span> {e.lemma} <span className="mobile-muted">{e.transliteration}</span></>} subtitle={e.gloss}
              onClick={() => sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={e.strongsNum} api={api} onNavigate={() => setActiveSpace('scripture')} /> })} />
          ))}
          {entries.length > 0 && <Row title="Open in Lexicon space" onClick={() => { setActiveSpace('lexicon'); openLexiconEntry(entries[0].strongsNum) }} />}
        </ListSection>
      )}
    </Page>
  )
}

/**
 * The filter sheet owns a working copy of the filters and reports every change up — the sheet
 * host renders the `render` closure it was opened with, so props captured at open time would
 * never refresh; local state keeps the chips live while the page state follows along.
 */
export function SearchFilters({ initial, onChange, api }: { initial: SearchFilterState; onChange: (next: SearchFilterState) => void; api?: SheetApi }) {
  const [f, setF] = useState<SearchFilterState>(initial)
  const verseTags = useAppStore((s) => s.verseTags)
  const openTagsGraph = useAppStore((s) => s.openTagsGraph)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const update = (patch: Partial<SearchFilterState>) => { setF((cur) => { const next = { ...cur, ...patch }; onChange(next); return next }) }
  const toggleTag = (id: string) => { void haptic.selection(); update({ tagIds: f.tagIds.includes(id) ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id] }) }
  const setSort = (sort: SearchSortMode) => update({ sort, direction: naturalDirection(sort) })
  const flipDirection = () => update({ direction: f.direction === 'asc' ? 'desc' : 'asc' })
  const dirLabel = f.sort === 'relevance' ? (f.direction === 'desc' ? 'Best first' : 'Weakest first') : (f.direction === 'asc' ? 'Genesis → end' : 'End → Genesis')
  const dirty = f.tagIds.length > 0 || f.books.length > 0 || f.textId !== 'all' || f.wordMode !== 'all' || f.sort !== 'relevance' || f.direction !== 'desc'
  return (
    <div className="mobile-search-filters">
      <div className="mobile-option-label">Sort</div>
      <div className="mobile-search-filter-row">
        <Segmented value={f.sort} options={[['relevance', 'Relevance'], ['bookOrder', 'Book order']]} onChange={(v) => setSort(v as SearchSortMode)} />
        <button type="button" className="mobile-search-sort-dir" onClick={flipDirection} aria-label={`Sort direction: ${dirLabel}`}>
          {f.direction === 'asc' ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />} {dirLabel}
        </button>
      </div>
      <div className="mobile-option-label">Match</div>
      <Segmented value={f.wordMode} options={[['all', 'All words'], ['any', 'Any word'], ['phrase', 'Exact phrase']]} onChange={(v) => update({ wordMode: v as WordMode })} />
      <div className="mobile-option-label">Text</div>
      <div className="mobile-chip-row">
        <button type="button" className={`mobile-chip${f.textId === 'all' ? ' is-on' : ''}`} onClick={() => update({ textId: 'all' })}>All texts</button>
        {TRANSLATIONS.map((t) => (
          <button key={t.id} type="button" className={`mobile-chip${f.textId === t.id ? ' is-on' : ''}`} onClick={() => update({ textId: t.id })}>{t.label}</button>
        ))}
      </div>
      <div className="mobile-option-label">Books</div>
      <div className="mobile-chip-row">
        <button type="button" className={`mobile-chip${f.books.length === 0 ? ' is-on' : ''}`} onClick={() => update({ books: [] })}>Every book</button>
        {CANONICAL_BOOK_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`mobile-chip${isGroupActive(f.books, g) ? ' is-on' : ''}`} onClick={() => update({ books: toggleGroup(f.books, g) })}>{g.label}</button>
        ))}
      </div>
      <div className="mobile-option-label">Verse tags</div>
      {verseTags.length === 0 ? (
        <div className="mobile-muted">No verse tags yet — long-press a verse to tag it.</div>
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
          <Segmented value={f.tagMatchAll ? 'all' : 'any'} options={[['any', 'Any tag'], ['all', 'Every tag']]} onChange={(v) => update({ tagMatchAll: v === 'all' })} />
        </div>
      )}
      <div className="mobile-search-filter-row">
        <button type="button" className="mobile-link-button" onClick={() => { api?.close(); openTagsGraph(); setActiveSpace('notes') }}>Manage tags</button>
        {dirty && <button type="button" className="mobile-link-button" onClick={() => update({ ...DEFAULT_SEARCH_FILTERS })}>Reset filters</button>}
      </div>
    </div>
  )
}
