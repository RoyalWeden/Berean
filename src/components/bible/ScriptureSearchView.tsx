import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, BookOpen, ChevronRight, ChevronDown, Check, ArrowLeft, GitFork } from 'lucide-react'
import type { Book } from '@/types'
import { parseRef, bookName } from '@/lib/parseRef'
import { useAppStore } from '@/store'
import { applyWordReplacer } from '@/lib/wordReplacer'

function normalizeBookName(name: string): string {
  return name.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ')
}

type SearchMode = 'auto' | 'text' | 'crossref'
type WordMode = 'all' | 'any' | 'phrase'

function buildFTSQuery(q: string, mode: WordMode): string {
  const trimmed = q.trim()
  if (mode === 'phrase') return `"${trimmed}"`
  if (mode === 'any') {
    const terms = trimmed.split(/\s+/).filter(Boolean)
    return terms.length > 1 ? terms.join(' OR ') : trimmed
  }
  return trimmed // 'all' — FTS5 default is AND
}

interface CrossRef {
  bookId: string
  chapter: number
  verse: number
  endVerse: number | null
  votes: number
  text: string
}

const ALL_TEXTS = [
  { id: 'kjva',          label: 'KJVA',             category: 'bible' as const },
  { id: 'lxx',           label: 'LXX',              category: 'bible' as const },
  { id: 'enoch',         label: '1 Enoch',           category: 'pseudo' as const },
  { id: 'jubilees',      label: 'Jubilees',          category: 'pseudo' as const },
  { id: 'apoc_elijah',   label: 'Apoc. Elijah',      category: 'pseudo' as const },
  { id: 'asc_isaiah',    label: 'Asc. Isaiah',       category: 'pseudo' as const },
  { id: 'ep_barnabas',   label: 'Ep. Barnabas',      category: 'pseudo' as const },
  { id: 't12p',          label: 'T12 Patriarchs',    category: 'pseudo' as const },
  { id: 'recog_clement', label: 'Recog. Clement',    category: 'pseudo' as const },
  { id: 'hermas',        label: 'Hermas',            category: 'pseudo' as const },
  { id: 'gad',           label: 'Gad the Seer',      category: 'pseudo' as const },
  { id: 't_job',         label: 'T. Job',            category: 'pseudo' as const },
  { id: '1clement',      label: '1 Clement',         category: 'pseudo' as const },
]

interface RawResult {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  _textId?: string
}

type TestamentFilter = 'all' | 'OT' | 'NT' | 'Apocrypha' | 'Pseudepigrapha'
type SortMode = 'relevance' | 'bookOrder'

function highlight(text: string, query: string, wordMode: WordMode = 'all'): React.ReactNode {
  if (!query.trim()) return text
  let pattern: string
  if (wordMode === 'phrase') {
    // Highlight the whole phrase
    pattern = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  } else {
    // Highlight each individual word (handles 'all' and 'any' modes)
    const words = query.trim()
      .replace(/"/g, '')
      .split(/\s+(?:OR\s+)?/)
      .map(w => w.trim())
      .filter(w => w.length > 0)
    if (words.length === 0) return text
    pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  }
  const re = new RegExp(`(${pattern})`, 'gi')
  const matchRe = new RegExp(`^(?:${pattern})$`, 'i')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        matchRe.test(p)
          ? <mark key={i} className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm">{p}</mark>
          : p
      )}
    </>
  )
}

interface PersistedState {
  textId?: string
  wordMode?: WordMode
  testamentFilter?: string
  bookFilter?: string
  sortMode?: SortMode
  scrollTop?: number
}

interface Props {
  onNavigate: (bookId: string, chapter: number, verse: number, textId: string) => void
  onClose: () => void
  initialQuery?: string
  persistedState?: PersistedState
  onStateChange?: (state: PersistedState) => void
}

export default function ScriptureSearchView({ onNavigate, onClose, initialQuery, persistedState, onStateChange }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [searchMode, setSearchMode] = useState<SearchMode>('auto')
  const [textId, setTextId] = useState<string>(persistedState?.textId ?? 'all')
  const [results, setResults] = useState<RawResult[]>([])
  const [crossRefs, setCrossRefs] = useState<CrossRef[]>([])
  const [crossRefsLoading, setCrossRefsLoading] = useState(false)
  const [versePreview, setVersePreview] = useState<{ ref: string; text: string } | null>(null)
  const [allBooks, setAllBooks] = useState<Record<string, Book[]>>({})
  const [loading, setLoading] = useState(false)
  const [translationOpen, setTranslationOpen] = useState(false)
  const [testamentFilter, setTestamentFilter] = useState<TestamentFilter>((persistedState?.testamentFilter as TestamentFilter) ?? 'all')
  const [bookFilter, setBookFilter] = useState<string>(persistedState?.bookFilter ?? 'all')  // 'all' or a specific book_id
  const [bookPickerOpen, setBookPickerOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>(persistedState?.sortMode ?? 'relevance')
  const [wordMode, setWordMode] = useState<WordMode>(persistedState?.wordMode ?? 'all')
  const inputRef = useRef<HTMLInputElement>(null)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const translationRef = useRef<HTMLDivElement>(null)
  const bookPickerRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => { onStateChangeRef.current = onStateChange }, [onStateChange])

  // Load books for all texts on mount
  useEffect(() => {
    Promise.all(
      ALL_TEXTS.map(async (t) => {
        try {
          const books = await window.bible.getBooks(t.id)
          return [t.id, books.map((b) => ({ ...b, name: normalizeBookName(b.name) }))] as [string, Book[]]
        } catch { return [t.id, []] as [string, Book[]] }
      })
    ).then((entries) => {
      setAllBooks(Object.fromEntries(entries))
    })
  }, [])

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  // Cmd+L — focus the search input when this tab is active
  useEffect(() => {
    function onFocus() { inputRef.current?.focus(); inputRef.current?.select() }
    window.addEventListener('berean:focusScriptureSearch', onFocus)
    return () => window.removeEventListener('berean:focusScriptureSearch', onFocus)
  }, [])

  // Restore scroll position after results load
  useEffect(() => {
    if (persistedState?.scrollTop && resultsRef.current) {
      resultsRef.current.scrollTop = persistedState.scrollTop
    }
  }, [results]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist state whenever filters change
  useEffect(() => {
    onStateChangeRef.current?.({ textId, wordMode, testamentFilter, bookFilter, sortMode })
  }, [textId, wordMode, testamentFilter, bookFilter, sortMode])

  // If an initial query was provided, run the appropriate search immediately
  useEffect(() => {
    if (initialQuery && initialQuery.trim().length >= 2) {
      if (parseRef(initialQuery.trim())) {
        runCrossRefSearch(initialQuery)
      } else {
        runSearch(initialQuery, textId)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch verse text preview when a verse reference is detected
  useEffect(() => {
    const mode = effectiveMode(query)
    if (mode !== 'crossref') { setVersePreview(null); return }
    const parsed = parseRef(query.trim())
    if (!parsed || !parsed.verse) { setVersePreview(null); return }
    window.bible.queryVerse(parsed.bookId, parsed.chapter, parsed.verse, 'kjva')
      .then((v) => {
        if (v) {
          setVersePreview({ ref: `${bookName(parsed.bookId)} ${parsed.chapter}:${parsed.verse}`, text: v.text })
        } else {
          setVersePreview(null)
        }
      })
      .catch(() => setVersePreview(null))
  }, [query, searchMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdowns on outside click
  useEffect(() => {
    if (!translationOpen && !bookPickerOpen) return
    function onDown(e: MouseEvent) {
      if (translationRef.current && !translationRef.current.contains(e.target as Node)) setTranslationOpen(false)
      if (bookPickerRef.current && !bookPickerRef.current.contains(e.target as Node)) setBookPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [translationOpen, bookPickerOpen])

  const runSearch = useCallback(async (q: string, tid: string, wMode?: WordMode) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); return }
    setLoading(true)
    const effectiveWordMode = wMode ?? wordMode
    const ftsQuery = buildFTSQuery(trimmed, effectiveWordMode)
    try {
      let raw: RawResult[] = []
      if (tid === 'all') {
        const allResults = await Promise.all(
          ALL_TEXTS.map(async (t) => {
            try {
              const res = await window.bible.searchText(ftsQuery, t.id)
              return (res as unknown as RawResult[]).map((r) => ({ ...r, _textId: t.id }))
            } catch { return [] }
          })
        )
        raw = allResults.flat()
      } else {
        const res = await window.bible.searchText(ftsQuery, tid)
        raw = (res as unknown as RawResult[]).map((r) => ({ ...r, _textId: tid }))
      }

      // ── Phrase mode: JS post-filter guarantees only exact-phrase matches ──────
      // FTS5 phrase search is correct in most cases, but this catches edge cases
      // and makes the filtering strict regardless of FTS5 tokenizer quirks.
      if (effectiveWordMode === 'phrase') {
        const phrase = trimmed.toLowerCase()
        raw = raw.filter((r) => r.text.toLowerCase().includes(phrase))
      }

      setResults(raw)
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [wordMode])

  const runCrossRefSearch = useCallback(async (q: string) => {
    const parsed = parseRef(q.trim())
    if (!parsed) { setCrossRefs([]); return }
    setCrossRefsLoading(true)
    try {
      const result = await window.crossrefs.getForVerse(parsed.bookId, parsed.chapter, parsed.verse ?? 1)
      setCrossRefs(result?.refs ?? [])
    } catch { setCrossRefs([]) }
    finally { setCrossRefsLoading(false) }
  }, [])

  function effectiveMode(q: string): 'text' | 'crossref' {
    if (searchMode === 'text') return 'text'
    if (searchMode === 'crossref') return 'crossref'
    return parseRef(q.trim()) ? 'crossref' : 'text'
  }

  function handleInput(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const mode = effectiveMode(val)
    if (mode === 'crossref') {
      debounceRef.current = setTimeout(() => runCrossRefSearch(val), 350)
    } else {
      debounceRef.current = setTimeout(() => runSearch(val, textId), 350)
    }
  }

  function selectTranslation(tid: string) {
    setTextId(tid)
    setBookFilter('all')
    setTranslationOpen(false)
    if (query.trim().length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => runSearch(query, tid, wordMode), 100)
    }
  }

  function handleWordModeChange(mode: WordMode) {
    setWordMode(mode)
    if (query.trim().length >= 2 && effectiveMode(query) === 'text') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      runSearch(query, textId, mode)
    }
  }

  // Build flat list of all books available for the current text selection
  const availableBooks: Array<{ id: string; name: string; textId: string; textLabel: string; testament: string }> = (() => {
    const seen = new Set<string>()
    const out: Array<{ id: string; name: string; textId: string; textLabel: string; testament: string }> = []
    const texts = textId === 'all' ? ALL_TEXTS : ALL_TEXTS.filter((t) => t.id === textId)
    for (const t of texts) {
      for (const b of (allBooks[t.id] ?? [])) {
        const key = `${t.id}::${b.id}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ id: b.id, name: b.name, textId: t.id, textLabel: t.label, testament: b.testament ?? '' })
        }
      }
    }
    return out
  })()

  // Build grouped results with filters applied
  type GroupedResult = { bookId: string; bookName: string; testament: string; textId: string; textLabel: string; results: RawResult[] }
  const filteredGroups: GroupedResult[] = (() => {
    const groupMap = new Map<string, GroupedResult>()
    for (const r of results) {
      const rid = r._textId ?? textId
      // Book filter
      if (bookFilter !== 'all' && r.book_id !== bookFilter) continue
      // Testament filter
      const booksForText = allBooks[rid] ?? []
      const bookData = booksForText.find((b) => b.id === r.book_id)
      if (testamentFilter !== 'all') {
        if (testamentFilter === 'Pseudepigrapha') {
          const t = ALL_TEXTS.find((t) => t.id === rid)
          if (t?.category !== 'pseudo') continue
        } else {
          if (bookData?.testament !== testamentFilter) continue
        }
      }
      const key = `${rid}::${r.book_id}`
      if (!groupMap.has(key)) {
        const tInfo = ALL_TEXTS.find((t) => t.id === rid)
        groupMap.set(key, {
          bookId: r.book_id,
          bookName: bookData?.name ?? r.book_id,
          testament: bookData?.testament ?? (tInfo?.category === 'pseudo' ? 'Pseudepigrapha' : ''),
          textId: rid,
          textLabel: tInfo?.label ?? rid.toUpperCase(),
          results: [],
        })
      }
      groupMap.get(key)!.results.push(r)
    }
    let groups = Array.from(groupMap.values())
    if (sortMode === 'bookOrder') {
      groups.sort((a, b) => {
        const ai = ALL_TEXTS.findIndex((t) => t.id === a.textId)
        const bi = ALL_TEXTS.findIndex((t) => t.id === b.textId)
        if (ai !== bi) return ai - bi
        const aBooks = allBooks[a.textId] ?? []
        const bBooks = allBooks[b.textId] ?? []
        return aBooks.findIndex((bk) => bk.id === a.bookId) - bBooks.findIndex((bk) => bk.id === b.bookId)
      })
      groups.forEach((g) => {
        g.results.sort((a, b) => a.chapter !== b.chapter ? a.chapter - b.chapter : a.verse_num - b.verse_num)
      })
    }
    return groups
  })()

  const totalCount = filteredGroups.reduce((n, g) => n + g.results.length, 0)
  const currentTextLabel = textId === 'all' ? 'All texts' : ALL_TEXTS.find((t) => t.id === textId)?.label ?? textId.toUpperCase()
  const selectedBookLabel = bookFilter === 'all' ? 'Any book' : (availableBooks.find((b) => b.id === bookFilter)?.name ?? bookFilter)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') runSearch(query, textId)
  }

  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
        {/* Back to reader */}
        <button
          onClick={onClose}
          title="Back to reader (Esc)"
          className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
        >
          <ArrowLeft size={15} />
        </button>

        {/* Search input */}
        <Search size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search scripture…"
          className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none"
        />

        {/* Translation selector — hidden in crossref mode */}
        {effectiveMode(query) !== 'crossref' && <div ref={translationRef} className="relative flex-shrink-0">
          <button
            onClick={() => setTranslationOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            {currentTextLabel}
            <ChevronDown size={10} className={`transition-transform ${translationOpen ? 'rotate-180' : ''}`} />
          </button>
          {translationOpen && (
            <div className="absolute top-full right-0 mt-1 z-50 min-w-[180px] bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden py-1 max-h-96 overflow-y-auto">
              <button onClick={() => selectTranslation('all')} className={`flex items-center gap-2 w-full px-3 py-1.5 text-left cursor-pointer transition-colors ${textId === 'all' ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}>
                <Check size={11} className={textId === 'all' ? 'opacity-100' : 'opacity-0'} />
                <span className="text-xs font-medium">All texts</span>
              </button>
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-1" />
              <div className="px-3 py-0.5"><span className="text-[9px] uppercase tracking-wide text-[rgb(var(--color-text-muted))]">Bible</span></div>
              {ALL_TEXTS.filter((t) => t.category === 'bible').map((t) => (
                <button key={t.id} onClick={() => selectTranslation(t.id)} className={`flex items-center gap-2 w-full px-3 py-1.5 text-left cursor-pointer transition-colors ${textId === t.id ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}>
                  <Check size={11} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                  <span className="text-xs">{t.label}</span>
                </button>
              ))}
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-1" />
              <div className="px-3 py-0.5"><span className="text-[9px] uppercase tracking-wide text-[rgb(var(--color-text-muted))]">Pseudepigrapha</span></div>
              {ALL_TEXTS.filter((t) => t.category === 'pseudo').map((t) => (
                <button key={t.id} onClick={() => selectTranslation(t.id)} className={`flex items-center gap-2 w-full px-3 py-1.5 text-left cursor-pointer transition-colors ${textId === t.id ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}>
                  <Check size={11} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                  <span className="text-xs">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>}

      </div>

      {/* Row 1: Search mode (Auto / Text / Cross refs) */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] flex-shrink-0 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] mr-0.5">Mode</span>
        {(['auto', 'text', 'crossref'] as SearchMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setSearchMode(m); setResults([]); setCrossRefs([]) }}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
              searchMode === m
                ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white'
                : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'
            }`}
          >
            {m === 'crossref' && <GitFork size={9} />}
            {m === 'auto' ? 'Auto' : m === 'text' ? 'Text' : 'Cross refs'}
          </button>
        ))}
      </div>

      {/* Row 2: Word match mode (All / Any / Phrase) — only shown for text search */}
      {effectiveMode(query) !== 'crossref' && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
          <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] mr-0.5 flex-shrink-0">Match</span>
          {(['all', 'any', 'phrase'] as WordMode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleWordModeChange(m)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${
                wordMode === m
                  ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white'
                  : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'
              }`}
            >
              {m === 'all' ? 'All words' : m === 'any' ? 'Any word' : 'Phrase'}
            </button>
          ))}
        </div>
      )}

      {/* Filter + sort bar — hidden in crossref mode */}
      {effectiveMode(query) !== 'crossref' && <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 flex-wrap">
        {/* Book filter */}
        <div ref={bookPickerRef} className="relative">
          <button
            onClick={() => setBookPickerOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:border-[rgb(var(--color-text-muted))] transition-colors cursor-pointer"
          >
            {selectedBookLabel}
            <ChevronDown size={9} />
          </button>
          {bookPickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-52 max-h-72 overflow-y-auto bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl py-1">
              <button onClick={() => { setBookFilter('all'); setBookPickerOpen(false) }} className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left cursor-pointer ${bookFilter === 'all' ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}>
                <Check size={10} className={bookFilter === 'all' ? 'opacity-100' : 'opacity-0'} /> Any book
              </button>
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-1" />
              {availableBooks.map((b) => (
                <button key={`${b.textId}::${b.id}`} onClick={() => { setBookFilter(b.id); setBookPickerOpen(false) }} className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left cursor-pointer ${bookFilter === b.id ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}>
                  <Check size={10} className={bookFilter === b.id ? 'opacity-100' : 'opacity-0'} />
                  <span className="flex-1 truncate">{b.name}</span>
                  {textId === 'all' && <span className="text-[9px] text-[rgb(var(--color-text-muted))] ml-1 flex-shrink-0">{b.textLabel}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Testament filter chips */}
        {(['all', 'OT', 'NT', 'Apocrypha', 'Pseudepigrapha'] as TestamentFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setTestamentFilter(f)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${
              testamentFilter === f
                ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white'
                : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
            }`}
          >
            {f === 'all' ? 'All sections' : f}
          </button>
        ))}
        <div className="flex-1 min-w-0" />
        <button
          onClick={() => setSortMode((s) => s === 'relevance' ? 'bookOrder' : 'relevance')}
          className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
        >
          {sortMode === 'relevance' ? '↕ Relevance' : '↕ Book order'}
        </button>
      </div>}

      {/* Results */}
      <div
        ref={resultsRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => onStateChangeRef.current?.({ textId, wordMode, testamentFilter, bookFilter, sortMode, scrollTop: (e.currentTarget as HTMLDivElement).scrollTop })}
      >
        {/* Cross-ref results */}
        {effectiveMode(query) === 'crossref' && crossRefsLoading && (
          <div className="px-4 py-6 text-center text-sm text-[rgb(var(--color-text-muted))] animate-pulse">Finding cross-references…</div>
        )}
        {effectiveMode(query) === 'crossref' && versePreview && (
          <div className="px-4 py-3 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]">
            <p className="text-[10px] font-semibold text-[rgb(var(--color-accent))] mb-1">{versePreview.ref}</p>
            <p className="text-xs text-[rgb(var(--color-text-primary))] leading-relaxed">{versePreview.text}</p>
          </div>
        )}
        {effectiveMode(query) === 'crossref' && !crossRefsLoading && crossRefs.length > 0 && (
          <div>
            <p className="px-4 py-1.5 text-[10px] text-[rgb(var(--color-text-muted))] border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] sticky top-0 z-10">
              {crossRefs.length} cross-reference{crossRefs.length !== 1 ? 's' : ''} — sorted by strength
            </p>
            {crossRefs.map((r, i) => {
              const ref = r.endVerse
                ? `${bookName(r.bookId)} ${r.chapter}:${r.verse}–${r.endVerse}`
                : `${bookName(r.bookId)} ${r.chapter}:${r.verse}`
              const strength = Math.max(0, Math.min(Math.ceil(r.votes / 3), 5))
              return (
                <button
                  key={i}
                  onClick={() => onNavigate(r.bookId, r.chapter, r.verse, 'kjva')}
                  className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer border-b border-[rgb(var(--color-surface-4))/50] group"
                >
                  <span className="text-xs font-mono text-[rgb(var(--color-accent))] w-28 flex-shrink-0 pt-0.5 group-hover:underline">{ref}</span>
                  <div className="flex-1 min-w-0">
                    {r.text && <p className="text-xs text-[rgb(var(--color-text-primary))] leading-relaxed line-clamp-2">{r.text}</p>}
                    <div className="mt-0.5 text-[9px] text-[rgb(var(--color-text-muted))]">{'●'.repeat(strength)}{'○'.repeat(5 - strength)}</div>
                  </div>
                  <ChevronRight size={11} className="flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )
            })}
          </div>
        )}
        {effectiveMode(query) === 'crossref' && !crossRefsLoading && crossRefs.length === 0 && query.trim().length >= 2 && (
          <div className="px-4 py-12 text-center">
            <GitFork size={24} className="mx-auto mb-3 text-[rgb(var(--color-text-muted))] opacity-30" />
            <p className="text-sm text-[rgb(var(--color-text-secondary))]">
              {parseRef(query.trim()) ? 'No cross-references found' : 'Enter a verse reference (e.g. Gen 1:1)'}
            </p>
          </div>
        )}
        {effectiveMode(query) === 'crossref' && !query.trim() && (
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center min-h-[200px]">
            <GitFork size={28} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-30" />
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-1">Find cross-references for any verse</p>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] opacity-60">Type a verse reference like "Gen 1:1" or "John 3:16"</p>
          </div>
        )}

        {/* Text search results */}
        {effectiveMode(query) === 'text' && loading && (
          <div className="px-4 py-6 text-center text-sm text-[rgb(var(--color-text-muted))] animate-pulse">Searching…</div>
        )}

        {effectiveMode(query) === 'text' && !loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[rgb(var(--color-text-secondary))]">No results for "{query}"</p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">Try a different phrase or text</p>
          </div>
        )}

        {effectiveMode(query) === 'text' && !loading && filteredGroups.length > 0 && (
          <div>
            <p className="px-4 py-1.5 text-[10px] text-[rgb(var(--color-text-muted))] border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] sticky top-0 z-10">
              {totalCount} result{totalCount !== 1 ? 's' : ''}
              {testamentFilter !== 'all' && ` in ${testamentFilter}`}
              {bookFilter !== 'all' && ` in ${selectedBookLabel}`}
              {' '}— click to navigate
            </p>
            {filteredGroups.map((group) => (
              <div key={`${group.textId}::${group.bookId}`}>
                <div className="flex items-center gap-1.5 px-4 py-1.5 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))] sticky top-[29px] z-10">
                  <BookOpen size={11} className="text-[rgb(var(--color-text-muted))]" />
                  <span className="text-xs font-semibold text-[rgb(var(--color-text-secondary))]">{group.bookName}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] ml-1">{group.results.length}</span>
                  <div className="flex-1" />
                  {textId === 'all' && <span className="text-[9px] text-[rgb(var(--color-accent))] font-medium uppercase tracking-wide">{group.textLabel}</span>}
                  {group.testament && textId !== 'all' && <span className="text-[9px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">{group.testament}</span>}
                </div>
                {group.results.map((r) => (
                  <button
                    key={`${r._textId}-${r.book_id}-${r.chapter}-${r.verse_num}`}
                    onClick={() => onNavigate(r.book_id, r.chapter, r.verse_num, r._textId ?? textId)}
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer border-b border-[rgb(var(--color-surface-4))/50] group"
                  >
                    <span className="text-xs font-mono text-[rgb(var(--color-text-muted))] w-14 flex-shrink-0 pt-0.5">
                      {r.chapter}:{r.verse_num}
                    </span>
                    <span className="flex-1 text-xs text-[rgb(var(--color-text-primary))] leading-relaxed">
                      {highlight(
                        wordReplacerEnabled && wordReplacerRules.length > 0
                          ? applyWordReplacer(r.text, wordReplacerRules)
                          : r.text,
                        query,
                        wordMode
                      )}
                    </span>
                    <ChevronRight size={11} className="flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {effectiveMode(query) === 'text' && !loading && !query.trim() && (
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center min-h-[200px]">
            <Search size={28} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-30" />
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-1">Search across all scripture texts</p>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] opacity-60">Filter by text, book, and section · Esc to return to reader</p>
          </div>
        )}
      </div>
    </div>
  )
}
