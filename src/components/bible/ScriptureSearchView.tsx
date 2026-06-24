import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, BookOpen, ChevronRight, ChevronDown, Check, ArrowLeft, GitFork, ExternalLink, Copy, Hash } from 'lucide-react'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import type { Book } from '@/types'
import { parseRef, bookName } from '@/lib/parseRef'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useAppStore } from '@/store'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { parseStrongsQuery, isStrongsQuery, splitStrongsHighlight } from '@/lib/strongsSearch'
import { toggleBook, bookPassesFilter, bookFilterSummary } from '@/lib/scriptureSearchFilters'
import { editionForTextId } from '@/lib/bibleTexts'
import { normalizeBookQuery } from '@/lib/verseUtils'

/** Render a verse with its Strong's-tagged words highlighted (by word index). */
function highlightStrongs(text: string, matchWordIndices: number[]): React.ReactNode {
  return (
    <>
      {splitStrongsHighlight(text, matchWordIndices).map((seg, i) => (
        <span key={i}>
          {seg.match
            ? <mark className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm font-semibold">{seg.text}</mark>
            : seg.text}
          {i < text.split(' ').length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

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
  { id: 'apoc_abraham',  label: 'Apoc. Abraham',     category: 'pseudo' as const },
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
  query?: string
  textId?: string
  wordMode?: WordMode
  testamentFilter?: string
  bookFilter?: string
  sortMode?: SortMode
  scrollTop?: number
}

interface Props {
  onNavigate: (bookId: string, chapter: number, verse: number, textId: string) => void
  onOpenInNewTab?: (bookId: string, chapter: number, verse: number, textId: string) => void
  onOpenInFloating?: (bookId: string, chapter: number, verse: number) => void
  onClose: () => void
  initialQuery?: string
  persistedState?: PersistedState
  onStateChange?: (state: PersistedState) => void
}

type CtxItem = { bookId: string; chapter: number; verse: number; textId: string; text: string; x: number; y: number }

export default function ScriptureSearchView({ onNavigate, onOpenInNewTab, onOpenInFloating, onClose, initialQuery, persistedState, onStateChange }: Props) {
  const [query, setQuery] = useState(persistedState?.query ?? initialQuery ?? '')
  const [searchMode, setSearchMode] = useState<SearchMode>('auto')
  const [textId, setTextId] = useState<string>(persistedState?.textId ?? 'all')
  const [results, setResults] = useState<RawResult[]>([])
  // Strong's-search highlight indices, keyed by "bookId:chapter:verse".
  const [strongsMatches, setStrongsMatches] = useState<Record<string, number[]>>({})
  const [crossRefs, setCrossRefs] = useState<CrossRef[]>([])
  const [crossRefsLoading, setCrossRefsLoading] = useState(false)
  const [versePreview, setVersePreview] = useState<{ ref: string; text: string } | null>(null)
  const [allBooks, setAllBooks] = useState<Record<string, Book[]>>({})
  const [loading, setLoading] = useState(false)
  const [testamentFilter, setTestamentFilter] = useState<TestamentFilter>((persistedState?.testamentFilter as TestamentFilter) ?? 'all')
  // Multi-select book filter (empty = any book). Persisted as a comma-joined string.
  const [selectedBooks, setSelectedBooks] = useState<string[]>(() => {
    const s = persistedState?.bookFilter
    return s && s !== 'all' ? s.split(',').filter(Boolean) : []
  })
  const [bookPickerOpen, setBookPickerOpen] = useState(false)
  const [bookPickerPos, setBookPickerPos] = useState<{ left: number; top: number } | null>(null)
  const [bookSearch, setBookSearch] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['OT', 'NT']))
  const [wordModeOpen, setWordModeOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>(persistedState?.sortMode ?? 'relevance')
  const [wordMode, setWordMode] = useState<WordMode>(persistedState?.wordMode ?? 'all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const [showContext, setShowContext] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bookPickerTriggerRef = useRef<HTMLButtonElement>(null)
  const bookPickerPanelRef = useRef<HTMLDivElement>(null)
  const bookSearchRef = useRef<HTMLInputElement>(null)
  const editionStripRef = useRef<HTMLDivElement>(null)
  const wordModeRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const groupHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const resultButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  type CtxData = Omit<CtxItem, 'x' | 'y'>
  const { menu: ctxMenu, menuRef: ctxMenuRef, openMenu: openCtxMenu, closeMenu: closeCtxMenu } = usePositionedMenu<CtxData>()
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

  // Focus the search input only on an explicit request (berean:focusScriptureSearch).
  // Cmd+L is intentionally NOT handled here — it opens the main floating search bar
  // (handled globally in App.tsx) so the shortcut behaves the same everywhere.
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

  // Persist state whenever filters or query change
  useEffect(() => {
    onStateChangeRef.current?.({ query, textId, wordMode, testamentFilter, bookFilter: selectedBooks.join(',') || 'all', sortMode })
  }, [query, textId, wordMode, testamentFilter, selectedBooks, sortMode])

  // Run the search on mount if there is an initial/restored query
  useEffect(() => {
    const q = persistedState?.query ?? initialQuery ?? ''
    if (q.trim().length >= 2) runForMode(q)
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

  // Close book picker on outside click (portaled panel)
  useEffect(() => {
    if (!bookPickerOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (!bookPickerTriggerRef.current?.contains(t) && !bookPickerPanelRef.current?.contains(t)) {
        setBookPickerOpen(false)
        setBookSearch('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [bookPickerOpen])

  // Close word-mode dropdown on outside click
  useEffect(() => {
    if (!wordModeOpen) return
    function onDown(e: MouseEvent) {
      if (wordModeRef.current && !wordModeRef.current.contains(e.target as Node)) setWordModeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [wordModeOpen])

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

  function effectiveMode(q: string): 'text' | 'crossref' | 'strongs' {
    if (searchMode === 'crossref') return 'crossref'
    if (isStrongsQuery(q)) return 'strongs'                 // "g5485" / "h1319"
    if (searchMode === 'text') return 'text'
    return parseRef(q.trim()) ? 'crossref' : 'text'
  }

  // Strong's-number search: find every verse whose tagged text carries the number, and
  // remember which words to highlight. Powered by the same lexicon occurrence data as the
  // side panel, so "open all occurrences" lands here.
  const runStrongsSearch = useCallback(async (q: string) => {
    const num = parseStrongsQuery(q)
    if (!num) { setResults([]); setStrongsMatches({}); return }
    setLoading(true)
    try {
      const occ = await window.lexicon.getOccurrences(num)
      const matches: Record<string, number[]> = {}
      const rows: RawResult[] = occ.map((o) => {
        matches[`${o.book_id}:${o.chapter}:${o.verse_num}`] = o.matchWordIndices ?? []
        return { book_id: o.book_id, chapter: o.chapter, verse_num: o.verse_num, text: o.text, _textId: 'kjva' }
      })
      setStrongsMatches(matches)
      setResults(rows)
    } catch { setResults([]); setStrongsMatches({}) }
    finally { setLoading(false) }
  }, [])

  // Dispatch a query to the right search based on its detected mode. Used by every
  // entry point (typing, Enter, mount/restore) so Strong's queries never fall through
  // to the keyword search.
  function runForMode(q: string) {
    const mode = effectiveMode(q)
    if (mode === 'crossref') runCrossRefSearch(q)
    else if (mode === 'strongs') runStrongsSearch(q)
    else runSearch(q, textId)
  }

  function handleInput(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const mode = effectiveMode(val)
    const delay = mode === 'strongs' ? 250 : 350
    debounceRef.current = setTimeout(() => runForMode(val), delay)
  }

  function selectTranslation(tid: string) {
    setTextId(tid)
    setSelectedBooks([])
    if (query.trim().length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => runSearch(query, tid, wordMode), 100)
    }
  }

  function openBookPicker() {
    const r = bookPickerTriggerRef.current?.getBoundingClientRect()
    if (!r) return
    const W = 320, H = 380, pad = 8
    const left = Math.max(pad, Math.min(r.left, window.innerWidth - W - pad))
    const spaceBelow = window.innerHeight - r.bottom - pad
    const top = spaceBelow >= H / 2 ? r.bottom + 4 : Math.max(pad, r.top - H - 4)
    setBookPickerPos({ left, top })
    setBookPickerOpen((v) => !v)
    setBookSearch('')
    setTimeout(() => bookSearchRef.current?.focus(), 30)
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
      if (!bookPassesFilter(selectedBooks, r.book_id)) continue
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
const bookNameOf = (id: string) => availableBooks.find((b) => b.id === id)?.name ?? id
  const selectedBookLabel = bookFilterSummary(selectedBooks, bookNameOf)

  // Flat ordered list of visible results (respects collapsed groups) for keyboard nav
  const visibleResults: Array<RawResult & { _groupKey: string }> = []
  for (const g of filteredGroups) {
    const key = `${g.textId}::${g.bookId}`
    if (!collapsedGroups.has(key)) {
      for (const r of g.results) visibleResults.push({ ...r, _groupKey: key })
    }
  }

  // Scroll focused result into view when focusedIdx changes
  useEffect(() => {
    if (focusedIdx >= 0) resultButtonRefs.current.get(focusedIdx)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIdx])

  // Reset focused index when results change
  useEffect(() => { setFocusedIdx(-1) }, [results])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Enter') {
      if (focusedIdx >= 0 && visibleResults[focusedIdx]) {
        const r = visibleResults[focusedIdx]
        onNavigate(r.book_id, r.chapter, r.verse_num, r._textId ?? textId)
        return
      }
      runForMode(query)
      return
    }
    if ((e.key === 'j' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (visibleResults.length === 0) return
      e.preventDefault()
      setFocusedIdx((i) => Math.min(i + 1, visibleResults.length - 1))
      return
    }
    if ((e.key === 'k' || e.key === 'ArrowUp') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (visibleResults.length === 0) return
      e.preventDefault()
      setFocusedIdx((i) => { if (i <= 0) { inputRef.current?.focus(); return -1 } return i - 1 })
      return
    }
  }

  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      {/* ── Header row: input + controls ─────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
        <button
          onClick={onClose}
          title="Back to reader (Esc)"
          className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
        >
          <ArrowLeft size={15} />
        </button>

        <Search size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search scripture, Strong's, or verse ref…"
          className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none min-w-0"
        />

        {/* Match mode dropdown — text mode only */}
        {effectiveMode(query) === 'text' && (
          <div ref={wordModeRef} className="relative flex-shrink-0">
            <button
              onClick={() => setWordModeOpen((v) => !v)}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                wordMode !== 'all'
                  ? 'bg-[rgb(var(--color-accent))]/15 border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]'
                  : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
              }`}
            >
              {wordMode === 'phrase' ? '" Phrase' : wordMode === 'any' ? 'Any word' : 'All words'}
              <ChevronDown size={9} className={`transition-transform ${wordModeOpen ? 'rotate-180' : ''}`} />
            </button>
            {wordModeOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 min-w-[130px] bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden py-1">
                {([['all', 'All words'], ['any', 'Any word'], ['phrase', '" Phrase']] as [WordMode, string][]).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => { handleWordModeChange(m); setWordModeOpen(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left cursor-pointer transition-colors ${wordMode === m ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}
                  >
                    <Check size={10} className={wordMode === m ? 'opacity-100' : 'opacity-0'} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Filter area — three distinct axes, hidden in crossref mode ── */}
      {effectiveMode(query) !== 'crossref' && (() => {
        const isFiltered = textId !== 'all' || testamentFilter !== 'all' || selectedBooks.length > 0
        const currentEdition = textId !== 'all' ? editionForTextId(textId) : undefined

        // Books filtered by currently-selected edition and corpus (for the book picker + quick strip)
        const booksForCurrentContext = availableBooks.filter((b) => {
          if (testamentFilter !== 'all') {
            if (testamentFilter === 'Pseudepigrapha') {
              const t = ALL_TEXTS.find((t) => t.id === b.textId)
              if (t?.category !== 'pseudo') return false
            } else {
              if (b.testament !== testamentFilter) return false
            }
          }
          return true
        })

        const booksForEdition = textId !== 'all' ? (allBooks[textId] ?? []) : []
        const otBooks = booksForEdition.filter((b) => b.testament === 'OT')
        const ntBooks = booksForEdition.filter((b) => b.testament === 'NT')
        const apoBooks = booksForEdition.filter((b) => b.testament === 'Apocrypha')

        // Filtered book list for search in picker
        const bq = normalizeBookQuery(bookSearch.trim().toLowerCase())
        const filteredPickerBooks = bq
          ? booksForCurrentContext.filter((b) => b.name.toLowerCase().includes(bq) || b.id.toLowerCase().includes(bq))
          : booksForCurrentContext

        // Short label for edition button
        const editionChipLabel = (t: typeof ALL_TEXTS[0]) =>
          t.id === 'kjva' ? 'KJVa' : t.id === 'lxx' ? 'LXX' : t.label

        return (
          <div className="flex-shrink-0 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]">

            {/* Row A — Edition chips */}
            <div
              ref={editionStripRef}
              className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto border-b border-[rgb(var(--color-surface-4))]/40 scrollbar-none"
              style={{ scrollbarWidth: 'none' }}
            >
              <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] font-semibold flex-shrink-0 mr-1">Edition</span>
              {/* All */}
              <button
                onClick={() => selectTranslation('all')}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${textId === 'all' ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
              >All</button>
              {/* Bible editions */}
              {ALL_TEXTS.filter((t) => t.category === 'bible').map((t) => {
                const isActive = textId === t.id || (currentEdition?.id === t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTranslation(t.id)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${isActive ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                  >
                    {editionChipLabel(t)}
                  </button>
                )
              })}
              <span className="text-[rgb(var(--color-surface-4))] flex-shrink-0 mx-0.5 select-none">·</span>
              {/* Pseudepigrapha editions */}
              {ALL_TEXTS.filter((t) => t.category === 'pseudo').map((t) => {
                const isActive = textId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTranslation(t.id)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${isActive ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                  >
                    {editionChipLabel(t)}
                  </button>
                )
              })}
            </div>

            {/* Row B — Book quick-strip (only when a specific edition is selected) */}
            {textId !== 'all' && (otBooks.length > 0 || ntBooks.length > 0 || apoBooks.length > 0) && (
              <div className="border-b border-[rgb(var(--color-surface-4))]/40 px-3 py-1.5 space-y-1">
                {otBooks.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] w-6 flex-shrink-0">OT</span>
                    {otBooks.map((b) => {
                      const on = selectedBooks.includes(b.id)
                      const abbr = b.name.length > 5 ? b.name.slice(0, 3) : b.name
                      return (
                        <button
                          key={b.id}
                          title={b.name}
                          onClick={() => { setTestamentFilter('all'); setSelectedBooks((cur) => toggleBook(cur, b.id)) }}
                          className={`text-[9px] px-1 py-0.5 rounded border cursor-pointer transition-colors flex-shrink-0 whitespace-nowrap ${on ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                        >{abbr}</button>
                      )
                    })}
                  </div>
                )}
                {ntBooks.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] w-6 flex-shrink-0">NT</span>
                    {ntBooks.map((b) => {
                      const on = selectedBooks.includes(b.id)
                      const abbr = b.name.length > 5 ? b.name.slice(0, 3) : b.name
                      return (
                        <button
                          key={b.id}
                          title={b.name}
                          onClick={() => { setTestamentFilter('all'); setSelectedBooks((cur) => toggleBook(cur, b.id)) }}
                          className={`text-[9px] px-1 py-0.5 rounded border cursor-pointer transition-colors flex-shrink-0 whitespace-nowrap ${on ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                        >{abbr}</button>
                      )
                    })}
                  </div>
                )}
                {apoBooks.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] w-6 flex-shrink-0">Apo</span>
                    {apoBooks.map((b) => {
                      const on = selectedBooks.includes(b.id)
                      const abbr = b.name.length > 5 ? b.name.slice(0, 3) : b.name
                      return (
                        <button
                          key={b.id}
                          title={b.name}
                          onClick={() => { setTestamentFilter('all'); setSelectedBooks((cur) => toggleBook(cur, b.id)) }}
                          className={`text-[9px] px-1 py-0.5 rounded border cursor-pointer transition-colors flex-shrink-0 whitespace-nowrap ${on ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                        >{abbr}</button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Row C — Corpus chips + Book picker trigger + controls */}
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] font-semibold flex-shrink-0 mr-0.5">Corpus</span>
              {(['all', 'OT', 'NT', 'Apocrypha', 'Pseudepigrapha'] as const).map((s) => {
                const isActive = testamentFilter === s && selectedBooks.length === 0 || (s === 'all' && testamentFilter === 'all' && selectedBooks.length === 0)
                const label = s === 'all' ? 'All' : s === 'OT' ? 'OT' : s === 'NT' ? 'NT' : s === 'Apocrypha' ? 'Apoc' : 'Pseud'
                return (
                  <button
                    key={s}
                    onClick={() => { setTestamentFilter(s === 'all' ? 'all' : s as TestamentFilter); setSelectedBooks([]) }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer flex-shrink-0 ${isActive ? 'bg-[rgb(var(--color-accent))]/20 border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                  >{label}</button>
                )
              })}

              {/* Book picker — simplified, shows only books filtered by edition+corpus */}
              <button
                ref={bookPickerTriggerRef}
                onClick={openBookPicker}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer flex-shrink-0 ${selectedBooks.length > 0 ? 'bg-[rgb(var(--color-accent))]/10 border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
              >
                {selectedBooks.length > 0
                  ? bookFilterSummary(selectedBooks, (id) => availableBooks.find((b) => b.id === id)?.name ?? id)
                  : 'Book ▾'}
              </button>

              {/* Clear active filters */}
              {isFiltered && (
                <button
                  onClick={() => { setTextId('all'); setTestamentFilter('all'); setSelectedBooks([]) }}
                  className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer flex-shrink-0"
                  title="Clear all filters"
                >×</button>
              )}

              <div className="flex-1 min-w-0" />
              <button
                onClick={() => setSortMode((s) => s === 'relevance' ? 'bookOrder' : 'relevance')}
                className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
              >
                {sortMode === 'relevance' ? '↕ Relevance' : '↕ Book order'}
              </button>
              <button
                onClick={() => setShowContext((v) => !v)}
                title={showContext ? 'Compact view' : 'Full verse text'}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer flex-shrink-0 ${showContext ? 'bg-[rgb(var(--color-accent))]/15 border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
              >
                {showContext ? '≡ Full' : '≡ Compact'}
              </button>
            </div>

            {/* Simplified book picker portal (books only, no edition section) */}
            {bookPickerOpen && bookPickerPos && createPortal(
              <div
                ref={bookPickerPanelRef}
                className="fixed z-[9999] flex flex-col bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl overflow-hidden"
                style={{ left: bookPickerPos.left, top: bookPickerPos.top, width: 320, maxHeight: 380 }}
              >
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
                  <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                  <input
                    ref={bookSearchRef}
                    type="text"
                    value={bookSearch}
                    onChange={(e) => setBookSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setBookPickerOpen(false); setBookSearch('') } }}
                    placeholder={textId === 'all' ? 'Search books…' : `Search ${currentEdition?.label ?? textId.toUpperCase()} books…`}
                    className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))]"
                  />
                  {selectedBooks.length > 0 && (
                    <button
                      onClick={() => setSelectedBooks([])}
                      className="flex-shrink-0 text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                    >Clear</button>
                  )}
                </div>
                <div className="overflow-y-auto flex-1 py-1">
                  {(['OT', 'NT', 'Apocrypha', 'Pseudepigrapha'] as const).map((section) => {
                    const sectionBooks = filteredPickerBooks.filter((b) => b.testament === section)
                    if (sectionBooks.length === 0) return null
                    const sectionLabel = section === 'OT' ? 'Old Testament' : section === 'NT' ? 'New Testament' : section
                    const expanded = expandedSections.has(section)
                    return (
                      <div key={section}>
                        <div className="flex items-center gap-1 px-2 py-1 select-none">
                          <button
                            onClick={() => setExpandedSections((prev) => { const s = new Set(prev); s.has(section) ? s.delete(section) : s.add(section); return s })}
                            className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] flex-shrink-0 cursor-pointer"
                          >
                            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </button>
                          <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
                            {sectionLabel}
                            <span className="ml-1.5 font-normal normal-case text-[9px]">{sectionBooks.length}</span>
                          </span>
                        </div>
                        {expanded && sectionBooks.map((book) => {
                          const on = selectedBooks.includes(book.id)
                          return (
                            <button
                              key={`${book.textId}::${book.id}`}
                              onClick={() => {
                                setTestamentFilter('all')
                                setSelectedBooks((cur) => toggleBook(cur, book.id))
                              }}
                              className={`flex items-center gap-2 w-full pl-6 pr-3 py-1.5 text-sm text-left cursor-pointer transition-colors rounded-sm mx-1 ${on ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/8' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
                            >
                              <span className={`flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))]'}`}>
                                {on && <Check size={9} className="text-white" />}
                              </span>
                              <span className="flex-1 truncate">{book.name}</span>
                              {textId === 'all' && <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0 ml-1">{book.textLabel}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                  {filteredPickerBooks.length === 0 && (
                    <div className="px-3 py-4 text-sm text-center text-[rgb(var(--color-text-muted))]">No books found</div>
                  )}
                </div>
              </div>,
              document.body
            )}
          </div>
        )
      })()}

      {/* Results — scroll list + jump-to-book rail */}
      <div className="flex-1 flex overflow-hidden">
      <div
        ref={resultsRef}
        className="flex-1 overflow-y-auto min-w-0"
        onScroll={(e) => onStateChangeRef.current?.({ query, textId, wordMode, testamentFilter, bookFilter: selectedBooks.join(',') || 'all', sortMode, scrollTop: (e.currentTarget as HTMLDivElement).scrollTop })}
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
                  onContextMenu={(e) => { e.preventDefault(); openCtxMenu({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, textId: 'kjva', text: '', x: e.clientX, y: e.clientY }) }}
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

        {/* Text + Strong's search results */}
        {(effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && loading && (
          <div className="px-4 py-6 text-center text-sm text-[rgb(var(--color-text-muted))] animate-pulse">Searching…</div>
        )}

        {(effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && !loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[rgb(var(--color-text-secondary))]">No results for "{query}"</p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">{effectiveMode(query) === 'strongs' ? 'No verses carry this Strong’s number' : 'Try a different phrase or text'}</p>
          </div>
        )}

        {(effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && !loading && filteredGroups.length > 0 && (
          <div>
            <p className="px-4 py-1.5 text-[10px] text-[rgb(var(--color-text-muted))] border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] sticky top-0 z-10">
              {totalCount} result{totalCount !== 1 ? 's' : ''}
              {effectiveMode(query) === 'strongs' && ` for ${parseStrongsQuery(query)}`}
              {testamentFilter !== 'all' && ` in ${testamentFilter}`}
              {selectedBooks.length > 0 && ` in ${selectedBookLabel}`}
              {' '}— click to navigate
            </p>
            {filteredGroups.map((group) => {
              const key = `${group.textId}::${group.bookId}`
              const collapsed = collapsedGroups.has(key)
              return (
              <div key={key}>
                <div
                  ref={(el) => { if (el) groupHeaderRefs.current.set(key, el); else groupHeaderRefs.current.delete(key) }}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))] sticky top-[29px] z-10 cursor-pointer select-none hover:bg-[rgb(var(--color-surface-4))] transition-colors"
                  onClick={() => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })}
                >
                  <ChevronDown size={11} className={`text-[rgb(var(--color-text-muted))] transition-transform flex-shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
                  <BookOpen size={11} className="text-[rgb(var(--color-text-muted))]" />
                  <span className="text-xs font-semibold text-[rgb(var(--color-text-secondary))]">{group.bookName}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] ml-1">{group.results.length}</span>
                  <div className="flex-1" />
                  {textId === 'all' && <span className="text-[9px] text-[rgb(var(--color-accent))] font-medium uppercase tracking-wide">{group.textLabel}</span>}
                  {group.testament && textId !== 'all' && <span className="text-[9px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">{group.testament}</span>}
                </div>
                {!collapsed && group.results.map((r) => {
                  const flatIdx = visibleResults.findIndex((vr) => vr.book_id === r.book_id && vr.chapter === r.chapter && vr.verse_num === r.verse_num && vr._groupKey === key)
                  const isFocused = flatIdx === focusedIdx
                  return (
                  <button
                    key={`${r._textId}-${r.book_id}-${r.chapter}-${r.verse_num}`}
                    ref={(el) => { if (el && flatIdx >= 0) resultButtonRefs.current.set(flatIdx, el) }}
                    onClick={() => onNavigate(r.book_id, r.chapter, r.verse_num, r._textId ?? textId)}
                    onContextMenu={(e) => { e.preventDefault(); const tid = r._textId ?? textId; openCtxMenu({ bookId: r.book_id, chapter: r.chapter, verse: r.verse_num, textId: tid, text: r.text, x: e.clientX, y: e.clientY }) }}
                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer border-b border-[rgb(var(--color-surface-4))/50] group ${isFocused ? 'bg-[rgb(var(--color-accent))]/10 ring-inset ring-1 ring-[rgb(var(--color-accent))]/30' : 'hover:bg-[rgb(var(--color-surface-4))]'}`}
                  >
                    <span className="text-xs font-mono text-[rgb(var(--color-text-muted))] w-14 flex-shrink-0 pt-0.5">
                      {r.chapter}:{r.verse_num}
                    </span>
                    <span className={`flex-1 text-xs text-[rgb(var(--color-text-primary))] leading-relaxed ${showContext ? '' : 'line-clamp-2'}`}>
                      {effectiveMode(query) === 'strongs'
                        ? highlightStrongs(r.text, strongsMatches[`${r.book_id}:${r.chapter}:${r.verse_num}`] ?? [])
                        : highlight(
                            wordReplacerEnabled && wordReplacerRules.length > 0
                              ? applyWordReplacer(r.text, wordReplacerRules)
                              : r.text,
                            query,
                            wordMode
                          )}
                    </span>
                    <ChevronRight size={11} className="flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )})}
              </div>
              )
            })}
          </div>
        )}

        {(effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && !loading && !query.trim() && (
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center min-h-[200px]">
            <Search size={28} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-30" />
            <p className="text-xs text-[rgb(var(--color-text-muted))] mb-1">Search across all scripture texts</p>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] opacity-60">Keywords, a reference, or a Strong's number (e.g. G5485) · Esc to return to reader</p>
          </div>
        )}
      </div>

      {/* Jump-to-book rail — shown when there are multiple groups */}
      {filteredGroups.length > 1 && (effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && (
        <div className="flex-shrink-0 w-9 overflow-y-auto border-l border-[rgb(var(--color-surface-4))] flex flex-col items-center py-1 gap-0.5 bg-[rgb(var(--color-surface-2))]">
          {filteredGroups.map((g) => {
            const key = `${g.textId}::${g.bookId}`
            const abbr = g.bookName.replace(/^(1|2|3|First|Second|Third)\s+/i, (m) => m.trim()[0]).slice(0, 3)
            return (
              <button
                key={key}
                onClick={() => groupHeaderRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                title={g.bookName}
                className="text-[8.5px] font-medium text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer leading-tight py-0.5 px-0.5 text-center w-full"
              >
                {abbr}
              </button>
            )
          })}
        </div>
      )}
      </div>

      {/* Right-click context menu for search results */}
      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          className="fixed z-[9999] min-w-[190px] rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1 overflow-hidden"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
            onClick={() => { onNavigate(ctxMenu.bookId, ctxMenu.chapter, ctxMenu.verse, ctxMenu.textId); closeCtxMenu() }}
          >
            <ChevronRight size={12} />
            Open here
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
            onClick={async () => {
              const { bookId: bId, chapter: ch, verse: vs, textId: tid, text: tx } = ctxMenu
              closeCtxMenu()
              let text = tx
              if (!text) { const v = await window.bible.queryVerse(bId, ch, vs, tid).catch(() => null); text = v?.text ?? '' }
              copyVerse(bId, ch, vs, text, tid === 'lxx')
            }}
          >
            <Copy size={12} />
            Copy verse
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
            onClick={() => { copyVerseRef(ctxMenu.bookId, ctxMenu.chapter, ctxMenu.verse, ctxMenu.textId === 'lxx'); closeCtxMenu() }}
          >
            <Hash size={12} />
            Copy reference
          </button>
          {onOpenInNewTab && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
              onClick={() => { onOpenInNewTab(ctxMenu.bookId, ctxMenu.chapter, ctxMenu.verse, ctxMenu.textId); closeCtxMenu() }}
            >
              <BookOpen size={12} />
              Open in new tab
            </button>
          )}
          {onOpenInFloating && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
              onClick={() => { onOpenInFloating(ctxMenu.bookId, ctxMenu.chapter, ctxMenu.verse); closeCtxMenu() }}
            >
              <ExternalLink size={12} />
              Open in floating tab
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
