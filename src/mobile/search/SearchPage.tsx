import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X, Clock } from 'lucide-react'
import type { Note, LexiconEntry } from '@/types'
import { useAppStore } from '@/store'
import { bookName, parseRef, bookChapterVerseLabel } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { applyFindHighlight } from '@/lib/highlight'
import { buildAllWordsSnippet } from '@/components/bible/ScriptureSearchView'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { navigateToVerse } from '@/lib/verseNavigation'
import { runScriptureSearch, runStrongsSearch, groupHitsByBook, type ScriptureHit } from '@/lib/scriptureSearch'
import { CANONICAL_BOOK_GROUPS, toggleGroup, isGroupActive } from '@/lib/scriptureSearchFilters'
import type { WordMode } from '@/lib/scriptureHighlight'
import { Page, IconTap, ListSection, Row } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { Segmented } from '../settings/SettingsPage'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'

type Scope = 'scripture' | 'notes' | 'lexicon'

/**
 * Search on the phone (Phase 14, R085): full library by default; a filter sheet for text,
 * testament/book groups and word mode; results grouped by book with snippet highlighting;
 * notes and lexicon scopes; recent queries. A reference typed here ("Gen 1:1") opens the
 * passage; a Strong's number searches its occurrences.
 */
export function SearchPage() {
  const sheets = useSheets()
  const [scope, setScope] = useState<Scope>('scripture')
  const [query, setQuery] = useState('')
  const [textId, setTextId] = useState<string | 'all'>('all')
  const [wordMode, setWordMode] = useState<WordMode>('all')
  const [books, setBooks] = useState<string[]>([])
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
  const seq = useRef(0)
  // `openSearchTab(query)` from anywhere (deep link, history, tag search) lands here.
  const pendingSearchQuery = useAppStore((s) => s.pendingSearchQuery)
  const clearSearchQuery = useAppStore((s) => s.clearSearchQuery)
  useEffect(() => {
    if (!pendingSearchQuery) return
    setScope('scripture'); setQuery(pendingSearchQuery); clearSearchQuery()
  }, [pendingSearchQuery, clearSearchQuery])

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    addRecent(trimmed)
    const ref = scope === 'scripture' ? parseRef(trimmed) : null
    if (ref) { void haptic.light(); setActiveSpace('scripture'); navigateToVerse({ bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null, origin: { kind: 'search-result', query: trimmed } }) }
  }
  const openHit = (h: ScriptureHit) => {
    addRecent(query.trim())
    const s = useAppStore.getState()
    s.setActiveSpace('scripture')
    s.ensureTab('bible')
    const tabId = useAppStore.getState().activeTabId.scripture
    if (tabId) s.updateTabState('scripture', tabId, { translation: h.textId.toUpperCase(), targetVerseQuery: h.strongsWords ? undefined : query.trim(), targetVerseWordMode: wordMode, targetVerseStrongsWords: h.strongsWords })
    navigateToVerse({ bookId: h.book_id, chapter: h.chapter, verse: h.verse_num, origin: { kind: 'search-result', query: query.trim() } })
  }
  const groups = useMemo(() => (hits ? groupHitsByBook(hits) : []), [hits])
  const filterCount = (textId !== 'all' ? 1 : 0) + (books.length ? 1 : 0) + (wordMode !== 'all' ? 1 : 0)

  const openFilters = () => sheets.open({ id: 'search-filters', title: 'Filters', detents: [0.75, 0.92], render: () => (
    <SearchFilters textId={textId} setTextId={setTextId} wordMode={wordMode} setWordMode={setWordMode} books={books} setBooks={setBooks} />
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
      {!query.trim() && recent.length > 0 && (
        <ListSection title="Recent">
          {recent.map((r) => <Row key={r} leading={<Clock size={16} aria-hidden />} title={r} onClick={() => setQuery(r)} />)}
        </ListSection>
      )}
      {!query.trim() && recent.length === 0 && <div className="mobile-empty">Search every text, your notes, or the lexicon. Type a reference to jump straight to it.</div>}
      {scope === 'scripture' && hits && (
        hits.length === 0 ? (query.trim().length >= 2 && !loading ? <div className="mobile-empty">No matches.</div> : null) : (
          <>
            <div className="mobile-muted" style={{ padding: '6px 16px' }}>{hits.length} verse{hits.length === 1 ? '' : 's'} in {groups.length} book{groups.length === 1 ? '' : 's'}</div>
            {groups.map((g) => (
              <ListSection key={g.bookId} title={`${bookName(g.bookId)} · ${g.hits.length}`}>
                {g.hits.slice(0, 200).map((h) => (
                  <Row key={`${h.textId}-${h.chapter}-${h.verse_num}`} chevron onClick={() => openHit(h)}
                    title={<span className="mobile-occurrence-ref">{bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)}{textId === 'all' ? <span className="mobile-muted"> · {TRANSLATIONS.find((t) => t.id === h.textId)?.label ?? h.textId}</span> : null}</span>}
                    subtitle={<span className="mobile-search-snippet">{applyFindHighlight(buildAllWordsSnippet(h.text, query, 140).text, h.strongsWords ? '' : query, wordMode)}</span>} />
                ))}
                {g.hits.length > 200 && <div className="mobile-muted" style={{ padding: '6px 14px' }}>…and {g.hits.length - 200} more in this book</div>}
              </ListSection>
            ))}
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

function SearchFilters({ textId, setTextId, wordMode, setWordMode, books, setBooks }: {
  textId: string | 'all'; setTextId: (v: string | 'all') => void
  wordMode: WordMode; setWordMode: (v: WordMode) => void
  books: string[]; setBooks: (v: string[]) => void
}) {
  return (
    <div className="mobile-search-filters">
      <div className="mobile-option-label">Match</div>
      <Segmented value={wordMode} options={[['all', 'All words'], ['any', 'Any word'], ['phrase', 'Exact phrase']]} onChange={(v) => setWordMode(v as WordMode)} />
      <div className="mobile-option-label">Text</div>
      <div className="mobile-chip-row">
        <button type="button" className={`mobile-chip${textId === 'all' ? ' is-on' : ''}`} onClick={() => setTextId('all')}>All texts</button>
        {TRANSLATIONS.map((t) => (
          <button key={t.id} type="button" className={`mobile-chip${textId === t.id ? ' is-on' : ''}`} onClick={() => setTextId(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="mobile-option-label">Books</div>
      <div className="mobile-chip-row">
        <button type="button" className={`mobile-chip${books.length === 0 ? ' is-on' : ''}`} onClick={() => setBooks([])}>Every book</button>
        {CANONICAL_BOOK_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`mobile-chip${isGroupActive(books, g) ? ' is-on' : ''}`} onClick={() => setBooks(toggleGroup(books, g))}>{g.label}</button>
        ))}
      </div>
    </div>
  )
}
