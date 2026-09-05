import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, BookOpen, ChevronRight, ChevronDown, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { recordNavigation } from '@/lib/verseNavigation'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import { useIsActivePanel } from '@/components/shell/ActivePanelContext'
import { expandQueryForWordReplacer } from '@/lib/wordReplacer'
import { numberTokenAlternates } from '@/lib/numberWords'
import type { Book, SearchTabState } from '@/types'

function normalizeBookName(name: string): string {
  return name.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ')
}

const SEARCH_TRANSLATIONS = [
  { id: 'kjva',          label: 'KJVA',             category: 'bible' },
  { id: 'lxx',           label: 'LXX',              category: 'bible' },
  { id: 'enoch',         label: '1 Enoch',           category: 'pseudo' },
  { id: 'jubilees',      label: 'Jubilees',          category: 'pseudo' },
  { id: 'apoc_elijah',   label: 'Apoc. Elijah',      category: 'pseudo' },
  { id: 'asc_isaiah',    label: 'Asc. Isaiah',       category: 'pseudo' },
  { id: 'ep_barnabas',   label: 'Ep. Barnabas',      category: 'pseudo' },
  { id: 't12p',          label: 'T12 Patriarchs',    category: 'pseudo' },
  { id: 'recog_clement', label: 'Recog. Clement',    category: 'pseudo' },
  { id: 'hermas',        label: 'Hermas',            category: 'pseudo' },
  { id: 'gad',           label: 'Gad the Seer',      category: 'pseudo' },
  { id: 't_job',         label: 'T. Job',            category: 'pseudo' },
  { id: '1clement',      label: '1 Clement',         category: 'pseudo' },
  { id: 'apoc_abraham',  label: 'Apoc. Abraham',     category: 'pseudo' },
  { id: 't_jacob',       label: 'T. Jacob',          category: 'pseudo' },
  { id: '2baruch',       label: '2 Baruch',          category: 'pseudo' },
]

// Detect if query starts with a translation hint like "lxx: ..." or "enoch ..."
function detectTranslationPrefix(q: string): { textId: string; cleanQuery: string } | null {
  const lower = q.trim().toLowerCase()
  const prefixes: Array<[string[], string]> = [
    [['lxx:', 'lxx ', 'septuagint:', 'septuagint ', 'brenton:', 'brenton '], 'lxx'],
    [['enoch:', 'enoch ', '1 enoch:', '1 enoch '], 'enoch'],
    [['jubilees:', 'jubilees '], 'jubilees'],
    [['apoc elijah:', 'apoc elijah ', 'apoc. elijah:', 'apocalypse of elijah:', 'apocalypse of elijah '], 'apoc_elijah'],
    [['asc isaiah:', 'asc isaiah ', 'asc. isaiah:', 'ascension of isaiah:', 'ascension of isaiah '], 'asc_isaiah'],
    [['ep barnabas:', 'ep barnabas ', 'ep. barnabas:', 'epistle of barnabas:', 'epistle of barnabas ', 'barnabas:', 'barnabas '], 'ep_barnabas'],
    [['t12p:', 't12p ', 'testaments:', 'testaments ', '12 patriarchs:', '12 patriarchs '], 't12p'],
    [['recog clement:', 'recog clement ', 'recog. clement:', 'recognitions:', 'recognitions ', 'roc:', 'roc '], 'recog_clement'],
    [['hermas:', 'hermas ', 'shepherd of hermas:', 'shepherd of hermas '], 'hermas'],
    [['gad the seer:', 'gad seer:', 'words of gad '], 'gad'],
    [['testament of job:', 'test job:', 'tjob '], 't_job'],
    [['1 clement:', '1clement:', '1clem '], '1clement'],
    [['apoc abraham:', 'apoc abraham ', 'apoc. abraham:', 'apocalypse of abraham:', 'apocalypse of abraham '], 'apoc_abraham'],
    [['testament of jacob:', 'test jacob:', 'tjac '], 't_jacob'],
    [['2 baruch:', '2 baruch ', '2baruch:', '2baruch ', 'apocalypse of baruch:', 'apocalypse of baruch '], '2baruch'],
  ]
  for (const [patterns, id] of prefixes) {
    for (const pat of patterns) {
      if (lower.startsWith(pat)) {
        return { textId: id, cleanQuery: q.slice(pat.length).trim() }
      }
    }
  }
  return null
}

interface RawResult {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  _textId?: string  // which translation this came from (set in runSearch)
}

interface GroupedResult {
  bookId: string
  bookName: string
  testament: string
  textId: string
  textLabel: string
  results: RawResult[]
}

type TestamentFilter = 'all' | 'OT' | 'NT' | 'Apocrypha' | 'Pseudepigrapha'
type SortMode = 'relevance' | 'bookOrder'

function highlight(text: string, query: string): React.ReactNode[] {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [text]
  // Per-word, not the whole query as one phrase — matches how the underlying FTS
  // search actually works ('all words' mode: every word must appear, not necessarily
  // adjacent), and lets each word's number alternate (numberTokenAlternates: "7" also
  // matches "seven", and vice versa) highlight too, not just the literal typed form.
  const patterns = Array.from(new Set(
    words.flatMap((w) => numberTokenAlternates(w)).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  ))
  const combined = patterns.join('|')
  const parts = text.split(new RegExp(`(${combined})`, 'gi'))
  return parts.map((p, i) =>
    new RegExp(`^(?:${combined})$`, 'i').test(p)
      ? <mark key={i} className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm">{p}</mark>
      : p
  )
}

export default function SearchTab({ floating = false }: { floating?: boolean }) {
  const isActivePanel = useIsActivePanel('search')
  // Narrowed to just the two spaces this component actually reads (search + scripture, for
  // "open in current scripture panel") instead of the whole `tabs` record (all 5 spaces) — see
  // BiblePanel.tsx's identical comment for why that matters. useShallow so a write to an
  // unrelated space's array (which doesn't change these two references) doesn't re-render this.
  const { search: searchSpaceTabs, scripture: scriptureSpaceTabs } = useAppStore(
    useShallow((s) => ({ search: s.tabs.search, scripture: s.tabs.scripture }))
  )
  const activeTabId = useAppStore((s) => s.activeTabId.search)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const addTab = useAppStore((s) => s.addTab)
  const pendingSearchQuery = useAppStore((s) => s.pendingSearchQuery)
  const clearSearchQuery = useAppStore((s) => s.clearSearchQuery)

  const searchTab = searchSpaceTabs.find((t) => t.id === activeTabId)
  const tabState = (searchTab?.state ?? { query: '', results: [] }) as SearchTabState

  const [query, setQuery] = useState(tabState.query ?? '')
  const [textId, setTextId] = useState<string>('kjva')  // 'all' = search all texts
  const [results, setResults] = useState<RawResult[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [translationOpen, setTranslationOpen] = useState(false)
  const [testamentFilter, setTestamentFilter] = useState<TestamentFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('relevance')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const translationRef = useRef<HTMLDivElement>(null)
  const resultsScrollRef = useRef<HTMLDivElement>(null)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore scroll position on mount
  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = tabState.scrollTop ?? 0 })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush the latest scroll position on unmount (switching tabs away from this one) — the
  // onScroll handler below debounces its store write by 150ms, so if the tab is switched within
  // that window the debounce timer never fires and the last stretch of scrolling is silently
  // lost. Mirrors the same fix in ScriptureSearchView.tsx.
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      const el = resultsScrollRef.current
      if (el && searchTab) updateTabState('search', searchTab.id, { scrollTop: el.scrollTop })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load books for the current single-text mode (used for grouping/filtering)
  useEffect(() => {
    if (textId === 'all') return
    window.bible.getBooks(textId)
      .then((raw) => setBooks(raw.map((b) => ({ ...b, name: normalizeBookName(b.name) }))))
      .catch(() => {})
  }, [textId])

  // Close translation dropdown on outside click
  useEffect(() => {
    if (!translationOpen) return
    function onDown(e: MouseEvent) {
      if (translationRef.current && !translationRef.current.contains(e.target as Node)) {
        setTranslationOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [translationOpen])

  // Pick up pending search query (e.g. from FloatingSearch)
  useEffect(() => {
    if (!pendingSearchQuery) return
    clearSearchQuery()
    setQuery(pendingSearchQuery)
    runSearch(pendingSearchQuery, textId)
    inputRef.current?.focus()
    // This is a one-shot external push (e.g. from FloatingSearch), not live typing, so rename
    // immediately rather than going through handleInput's 150ms debounce — that debounce exists
    // to smooth out per-keystroke renames, which doesn't apply here.
    if (searchTab) {
      const trimmed = pendingSearchQuery.trim()
      useAppStore.getState().renameTab('search', searchTab.id, trimmed ? `"${trimmed}"` : 'Search')
    }
  }, [pendingSearchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const wordReplacerEnabled = useAppStore.getState().wordReplacerEnabled
  const wordReplacerRules   = useAppStore.getState().wordReplacerRules

  const runSearch = useCallback(async (q: string, tid: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); return }
    // Expand query with original terms for any replacement words (e.g. "yeshua" → also "jesus")
    const state = useAppStore.getState()
    const searchQ = state.wordReplacerEnabled
      ? expandQueryForWordReplacer(trimmed, state.wordReplacerRules)
      : trimmed
    setLoading(true)
    try {
      if (tid === 'all') {
        // Search all texts in parallel
        const allResults = await Promise.all(
          SEARCH_TRANSLATIONS.map(async (t) => {
            try {
              const res = await window.bible.searchText(searchQ, t.id)
              return (res as unknown as RawResult[]).map((r) => ({ ...r, _textId: t.id }))
            } catch { return [] }
          })
        )
        setResults(allResults.flat())
      } else {
        const res = await window.bible.searchText(searchQ, tid)
        setResults((res as unknown as RawResult[]).map((r) => ({ ...r, _textId: tid })))
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
    if (searchTab) updateTabState('search', searchTab.id, { query: trimmed, results: [] })
    // Record a history entry with the actual query so the task panel can detect it
    useAppStore.getState().addHistoryEntry({ type: 'search', title: `"${trimmed}"`, query: trimmed })
  }, [searchTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run the persisted query on mount. `results` are intentionally never saved into
  // tabState (they can be large), so without this a Search tab that is switched away
  // from and back to — or restored on app launch — showed its query text in the input
  // but a blank results pane until the user re-submitted ("search is broken / slow").
  // Runs once; the pendingSearchQuery path above handles fresh external pushes.
  useEffect(() => {
    const q = (tabState.query ?? '').trim()
    if (q.length >= 2 && results.length === 0 && !pendingSearchQuery) {
      void runSearch(q, textId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleInput(val: string) {
    setQuery(val)
    // Reflect the live query in the tab's own title so the sidebar tab list shows a
    // preview of what's being searched — NOT tied to runSearch below, which is
    // debounced 400ms and skips anything under 2 characters, both of which made the
    // tab title lag behind or never update at all for short queries. Debounced
    // separately (short, ~150ms) rather than firing on literally every keystroke: a
    // rename touches `tabs`, which both the sidebar's tab list AND its own breadcrumb
    // button subscribe to, so renaming on every single character sent a render
    // through that whole subtree per keystroke while typing fast — visible as the
    // tab bar/breadcrumb text flickering instead of settling. This still reads as
    // "live" at normal typing speed.
    if (searchTab) {
      const tabId = searchTab.id
      if (renameTimerRef.current) clearTimeout(renameTimerRef.current)
      renameTimerRef.current = setTimeout(() => {
        useAppStore.getState().renameTab('search', tabId, val.trim() ? `"${val.trim()}"` : 'Search')
      }, 150)
    }
    // Auto-detect translation prefix (e.g. "lxx creation" → switch to LXX)
    const detected = detectTranslationPrefix(val)
    let effectiveTid = textId
    if (detected && detected.textId !== textId) {
      setTextId(detected.textId)
      effectiveTid = detected.textId
      setResults([])
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const effectiveQuery = detected ? detected.cleanQuery : val
    debounceRef.current = setTimeout(() => runSearch(effectiveQuery || val, effectiveTid), 400)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') runSearch(query, textId)
  }

  function selectTranslation(tid: string) {
    setTextId(tid)
    setResults([])
    setTranslationOpen(false)
    if (query.trim().length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => runSearch(query, tid), 100)
    }
  }

  function navigateToVerse(bookId: string, chapter: number, verseNum: number, tid: string) {
    // For "all" mode, look up books for the specific text
    const bookData = books.find((b) => b.id === bookId)
    const bookLabel = bookData?.name ?? bookId
    const title = `${bookLabel} ${chapter}:${verseNum}`
    const translation = tid.toUpperCase()

    const activeScripture = scriptureSpaceTabs.find((t) => t.id === useAppStore.getState().activeTabId.scripture)
    const priorState = activeScripture?.state as { bookId?: string; chapter?: number; targetVerse?: number } | undefined
    if (activeScripture) {
      updateTabState('scripture', activeScripture.id, { bookId, chapter, targetVerse: verseNum, scrollPosition: 0, translation, endVerse: undefined })
      renameTab('scripture', activeScripture.id, title)
    } else {
      const id = `bible-${Date.now()}`
      addTab({
        id, spaceId: 'scripture', type: 'bible', title,
        state: { bookId, chapter, targetVerse: verseNum, translation, showStrongs: false, scrollPosition: 0 },
        ...(searchTab ? { originTabId: searchTab.id, originSpaceId: 'search' as const } : {}),
      })
    }
    setActiveSpace('scripture')
    recordNavigation(
      { bookId: priorState?.bookId, chapter: priorState?.chapter, verse: priorState?.targetVerse },
      { bookId, chapter, verse: verseNum },
      { kind: 'search-result', query: query.trim() },
    )
  }

  // Build grouped results
  const filteredAndSorted: GroupedResult[] = (() => {
    // Group by textId + bookId
    const groupMap = new Map<string, GroupedResult>()
    for (const r of results) {
      const rid = r._textId ?? textId
      const key = `${rid}::${r.book_id}`
      if (!groupMap.has(key)) {
        const tInfo = SEARCH_TRANSLATIONS.find((t) => t.id === rid)
        const bookData = books.find((b) => b.id === r.book_id)
        groupMap.set(key, {
          bookId: r.book_id,
          bookName: normalizeBookName(bookData?.name ?? r.book_id),
          testament: bookData?.testament ?? (tInfo?.category === 'pseudo' ? 'Pseudepigrapha' : ''),
          textId: rid,
          textLabel: tInfo?.label ?? rid.toUpperCase(),
          results: [],
        })
      }
      groupMap.get(key)!.results.push(r)
    }

    let groups = Array.from(groupMap.values())

    // Testament filter
    if (testamentFilter !== 'all') {
      groups = groups.filter((g) => {
        if (testamentFilter === 'Pseudepigrapha') {
          const t = SEARCH_TRANSLATIONS.find((t) => t.id === g.textId)
          return t?.category === 'pseudo'
        }
        return g.testament === testamentFilter
      })
    }

    // Sort
    if (sortMode === 'bookOrder') {
      groups.sort((a, b) => {
        // Sort by textId order first
        const ai = SEARCH_TRANSLATIONS.findIndex((t) => t.id === a.textId)
        const bi = SEARCH_TRANSLATIONS.findIndex((t) => t.id === b.textId)
        if (ai !== bi) return ai - bi
        // Then by book position within that text
        const aBook = books.findIndex((bk) => bk.id === a.bookId)
        const bBook = books.findIndex((bk) => bk.id === b.bookId)
        return aBook - bBook
      })
      groups.forEach((g) => {
        g.results.sort((a, b) => {
          if (a.chapter !== b.chapter) return a.chapter - b.chapter
          return a.verse_num - b.verse_num
        })
      })
    }

    return groups
  })()

  const totalFilteredCount = filteredAndSorted.reduce((n, g) => n + g.results.length, 0)

  const currentLabel = textId === 'all'
    ? 'All texts'
    : SEARCH_TRANSLATIONS.find((t) => t.id === textId)?.label ?? textId.toUpperCase()

  const showTestamentFilter = testamentFilter !== 'all' || true  // always show

  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      {/* Search input row */}
      <TabHeaderPortal floating={floating} active={floating || isActivePanel}>
        <Search size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search scripture…"
          className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none"
          autoFocus
        />
        {/* Translation selector dropdown */}
        <div ref={translationRef} className="relative flex-shrink-0">
          <button
            onClick={() => setTranslationOpen((v) => !v)}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-shell transition-colors cursor-pointer ${
              translationOpen
                ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'
            }`}
          >
            {currentLabel}
            <ChevronDown size={10} className={`transition-transform ${translationOpen ? 'rotate-180' : ''}`} />
          </button>
          {translationOpen && (
            <div className="glass-panel absolute top-full right-0 mt-1 z-50 min-w-[180px] rounded-shell overflow-hidden py-1">
              {/* All texts option */}
              <button
                onClick={() => selectTranslation('all')}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer ${
                  textId === 'all'
                    ? 'text-[rgb(var(--color-accent))]'
                    : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                }`}
              >
                <Check size={11} className={textId === 'all' ? 'opacity-100' : 'opacity-0'} />
                <span className="text-xs font-medium">All texts</span>
              </button>
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-1" />
              {/* Bible translations */}
              <div className="px-3 py-0.5">
                <span className="text-[9px] uppercase tracking-wide text-[rgb(var(--color-text-muted))]">Bible</span>
              </div>
              {SEARCH_TRANSLATIONS.filter((t) => t.category === 'bible').map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTranslation(t.id)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer ${
                    textId === t.id
                      ? 'text-[rgb(var(--color-accent))]'
                      : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                  }`}
                >
                  <Check size={11} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                  <span className="text-xs">{t.label}</span>
                </button>
              ))}
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-1" />
              {/* Pseudepigrapha */}
              <div className="px-3 py-0.5">
                <span className="text-[9px] uppercase tracking-wide text-[rgb(var(--color-text-muted))]">Pseudepigrapha</span>
              </div>
              {SEARCH_TRANSLATIONS.filter((t) => t.category === 'pseudo').map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTranslation(t.id)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer ${
                    textId === t.id
                      ? 'text-[rgb(var(--color-accent))]'
                      : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                  }`}
                >
                  <Check size={11} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                  <span className="text-xs">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </TabHeaderPortal>

      {/* Filter + sort bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 flex-wrap">
        {(['all', 'OT', 'NT', 'Apocrypha', 'Pseudepigrapha'] as TestamentFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setTestamentFilter(f)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${
              testamentFilter === f
                ? 'bg-[rgb(var(--color-accent))]/16 border-[rgb(var(--color-accent))]/45 text-[rgb(var(--color-accent))] font-semibold'
                : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
            }`}
          >
            {f === 'all' ? 'All sections' : f}
          </button>
        ))}
        <div className="flex-1 min-w-0" />
        <button
          onClick={() => setSortMode((s) => s === 'relevance' ? 'bookOrder' : 'relevance')}
          className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:border-[rgb(var(--color-text-muted))] transition-colors cursor-pointer flex-shrink-0"
        >
          {sortMode === 'relevance' ? '↕ Relevance' : '↕ Book order'}
        </button>
      </div>

      {/* Results */}
      <div
        ref={resultsScrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
          scrollSaveTimerRef.current = setTimeout(() => {
            if (searchTab) updateTabState('search', searchTab.id, { scrollTop: el.scrollTop })
          }, 150)
        }}
      >
        {loading && (
          <div className="px-4 py-6 text-center text-sm text-[rgb(var(--color-text-muted))] animate-pulse">Searching…</div>
        )}

        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[rgb(var(--color-text-secondary))]">No results for "{query}"</p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">Try a different phrase or translation</p>
          </div>
        )}

        {!loading && filteredAndSorted.length > 0 && (
          <div>
            <p className="px-4 py-1.5 text-[10px] text-[rgb(var(--color-text-muted))] border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] sticky top-0 z-20">
              {results.length >= 100 && textId !== 'all' ? '100+ results' : `${totalFilteredCount} result${totalFilteredCount !== 1 ? 's' : ''}`}
              {testamentFilter !== 'all' && ` in ${testamentFilter}`}
              {textId === 'all' && ` across all texts`}
              {' '}— click to navigate
            </p>

            {filteredAndSorted.map((group) => (
              <div key={`${group.textId}::${group.bookId}`}>
                {/* Book / text header */}
                <div className="flex items-center gap-1.5 px-4 py-1.5 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))] sticky top-[29px] z-10">
                  <BookOpen size={11} className="text-[rgb(var(--color-text-muted))]" />
                  <span className="text-xs font-semibold text-[rgb(var(--color-text-secondary))]">{group.bookName}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] ml-1">{group.results.length}</span>
                  <div className="flex-1" />
                  {textId === 'all' && (
                    <span className="text-[9px] text-[rgb(var(--color-accent))] font-medium uppercase tracking-wide">{group.textLabel}</span>
                  )}
                  {group.testament && textId !== 'all' && (
                    <span className="text-[9px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">{group.testament}</span>
                  )}
                </div>

                {/* Verse results */}
                {group.results.map((r) => (
                  <button
                    key={`${r._textId ?? textId}-${r.book_id}-${r.chapter}-${r.verse_num}`}
                    onClick={() => navigateToVerse(r.book_id, r.chapter, r.verse_num, r._textId ?? textId)}
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer border-b border-[rgb(var(--color-surface-4))/50] group"
                  >
                    <span className="text-xs font-mono text-[rgb(var(--color-text-muted))] w-14 flex-shrink-0 pt-0.5">
                      {r.chapter}:{r.verse_num}
                    </span>
                    <span className="flex-1 text-xs text-[rgb(var(--color-text-primary))] leading-relaxed">
                      {highlight(r.text, query)}
                    </span>
                    <ChevronRight size={11} className="flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {!loading && !query.trim() && (
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center min-h-[200px]">
            <Search size={28} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-30" />
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-1">
              {textId === 'all' ? 'Searching all texts' : `Searching ${currentLabel}`}
            </p>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] opacity-60">Type to search · prefix with "lxx:", "enoch:", etc. to narrow</p>
          </div>
        )}
      </div>
    </div>
  )
}
