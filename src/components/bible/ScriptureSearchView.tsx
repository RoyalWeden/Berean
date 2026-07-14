import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, BookOpen, ChevronRight, ChevronDown, Check, GitFork, ExternalLink, Copy, Hash, ArrowUpDown, ListTree, Rows, AlignJustify } from 'lucide-react'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import type { Book } from '@/types'
import { parseRef, bookName } from '@/lib/parseRef'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useAppStore } from '@/store'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { parseStrongsQuery, isStrongsQuery, splitStrongsHighlight } from '@/lib/strongsSearch'
import { toggleBook, bookPassesFilter } from '@/lib/scriptureSearchFilters'
import { normalizeBookQuery } from '@/lib/verseUtils'
import { EDITIONS } from '@/lib/bibleTexts'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'

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

/** Full, unabbreviated edition name (e.g. "Apocalypse of Elijah" instead of "Apoc. Elijah") —
 *  EDITIONS carries the full title; ALL_TEXTS's `label` is deliberately short for use as a
 *  chip/pill label elsewhere, which reads as cramped/cryptic inside the scope modal's lists. */
function fullEditionLabel(id: string, fallback: string): string {
  return EDITIONS.find((e) => e.id === id)?.label ?? fallback
}

type SearchMode = 'auto' | 'text' | 'strongs' | 'crossref'
type WordMode = 'all' | 'any' | 'phrase'

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

// Module-level cache: this view remounts every time the search tab is (re)opened (BiblePanel
// only renders it while tabState.searchMode is true), and it previously re-fetched getBooks for
// all 14 texts on every single mount — 14 IPC round-trips just to reopen a tab that was open five
// seconds ago. Caching the result for the life of the app avoids that entirely after the first
// open; the underlying getBooks query itself was also fixed (electron/ipc/bible.ts) since even
// the first load was blocking the main process with an O(books) query pattern.
let allBooksCachePromise: Promise<Record<string, Book[]>> | null = null
function loadAllBooksCached(): Promise<Record<string, Book[]>> {
  if (!allBooksCachePromise) {
    allBooksCachePromise = Promise.all(
      ALL_TEXTS.map(async (t) => {
        try {
          const books = await window.bible.getBooks(t.id)
          return [t.id, books.map((b) => ({ ...b, name: normalizeBookName(b.name) }))] as [string, Book[]]
        } catch { return [t.id, []] as [string, Book[]] }
      })
    ).then((entries) => Object.fromEntries(entries))
  }
  return allBooksCachePromise
}

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
    // Highlight each individual word (handles 'all' and 'any' modes). These modes
    // match server-side via FTS5 prefix wildcards (word*), so a search for "begin"
    // can match "beginning" — append \w* and anchor to a word boundary so the whole
    // matched word gets highlighted, not just the typed prefix.
    const words = query.trim().split(/\s+/).filter(w => w.length > 0)
    if (words.length === 0) return text
    pattern = words.map(w => `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`).join('|')
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
  /** Floating (detached) windows draw their own PanelHeader; docked panels portal mode
   *  controls into the shared TopBar instead — see TabHeaderPortal below. */
  floating?: boolean
}

type CtxItem = { bookId: string; chapter: number; verse: number; textId: string; text: string; x: number; y: number }

export default function ScriptureSearchView({ onNavigate, onOpenInNewTab, onOpenInFloating, onClose, initialQuery, persistedState, onStateChange, floating = false }: Props) {
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
  const [scopePaletteOpen, setScopePaletteOpen] = useState(false)
  const [scopeTab, setScopeTab] = useState<'edition' | 'canon' | 'other'>('canon')
  const [scopeSearch, setScopeSearch] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['OT', 'NT']))
  const [sortMode, setSortMode] = useState<SortMode>(persistedState?.sortMode ?? 'relevance')
  const [wordMode, setWordMode] = useState<WordMode>(persistedState?.wordMode ?? 'all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const [showContext, setShowContext] = useState(false)
  const [railExpanded, setRailExpanded] = useState(false)
  const [railSearch, setRailSearch] = useState('')
  const [railPanelPos, setRailPanelPos] = useState<{ centerY: number; right: number } | null>(null)
  const railSearchRef = useRef<HTMLInputElement>(null)
  const railTriggerRef = useRef<HTMLDivElement>(null)
  const railCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopeSearchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const groupHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const resultButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  type CtxData = Omit<CtxItem, 'x' | 'y'>
  const { menu: ctxMenu, menuRef: ctxMenuRef, openMenu: openCtxMenu, closeMenu: closeCtxMenu } = usePositionedMenu<CtxData>()
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => { onStateChangeRef.current = onStateChange }, [onStateChange])

  // Load books for all texts on mount (cached across mounts — see loadAllBooksCached)
  useEffect(() => {
    let cancelled = false
    loadAllBooksCached().then((books) => { if (!cancelled) setAllBooks(books) })
    return () => { cancelled = true }
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

  // Persist state whenever filters or query change. Must carry the current scrollTop
  // through too (falling back to whatever was already persisted) — omitting it here
  // clobbered the value the onScroll handler below had just saved, since this effect
  // fires on mount and on nearly every filter/query change, wiping scroll position back
  // to undefined well before the user ever switched tabs.
  useEffect(() => {
    onStateChangeRef.current?.({
      query, textId, wordMode, testamentFilter, bookFilter: selectedBooks.join(',') || 'all', sortMode,
      scrollTop: resultsRef.current?.scrollTop ?? persistedState?.scrollTop,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Close the scope modal on Escape (backdrop click handles outside-click)
  useEffect(() => {
    if (!scopePaletteOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setScopePaletteOpen(false); setScopeSearch('') }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [scopePaletteOpen])

  const runSearch = useCallback(async (q: string, tid: string, wMode?: WordMode) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); return }
    setLoading(true)
    const effectiveWordMode = wMode ?? wordMode
    try {
      let raw: RawResult[] = []
      if (tid === 'all') {
        const allResults = await Promise.all(
          ALL_TEXTS.map(async (t) => {
            try {
              const res = await window.bible.searchText(trimmed, t.id, effectiveWordMode)
              return (res as unknown as RawResult[]).map((r) => ({ ...r, _textId: t.id }))
            } catch { return [] }
          })
        )
        raw = allResults.flat()
      } else {
        const res = await window.bible.searchText(trimmed, tid, effectiveWordMode)
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
    if (searchMode === 'strongs') return 'strongs'          // explicit segment pick
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

  function openScopePalette(tab?: 'edition' | 'canon' | 'other') {
    setScopeTab(tab ?? 'canon')
    setScopePaletteOpen(true)
    setScopeSearch('')
    setTimeout(() => scopeSearchRef.current?.focus(), 30)
  }

  // Jump-rail hover handling. The expanded panel is portaled to document.body (not rendered as
  // a child of the trigger), so onMouseEnter/onMouseLeave on the trigger alone would fire
  // onMouseLeave the instant the pointer crosses from the trigger onto the (DOM-disconnected)
  // panel — a short close delay, cancelled by re-entering either element, lets the pointer
  // travel between them without the panel slamming shut mid-move.
  //
  // The panel stays mounted (position known) as soon as the trigger exists, not just once
  // hovered — its visibility is controlled purely by opacity/scale classes tied to
  // railExpanded. That's what makes the fade+slide a real CSS transition even on the very
  // first hover: a conditionally-mounted element has no prior style to transition FROM, so
  // toggling it into existence already-visible would just pop in with no animation.
  function openRail() {
    if (railCloseTimerRef.current) { clearTimeout(railCloseTimerRef.current); railCloseTimerRef.current = null }
    const r = railTriggerRef.current?.getBoundingClientRect()
    if (r) setRailPanelPos({ centerY: r.top + r.height / 2, right: window.innerWidth - r.left + 6 })
    setRailExpanded(true)
    setTimeout(() => railSearchRef.current?.focus(), 30)
  }
  function scheduleCloseRail() {
    if (railCloseTimerRef.current) clearTimeout(railCloseTimerRef.current)
    railCloseTimerRef.current = setTimeout(() => { setRailExpanded(false); setRailSearch('') }, 180)
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

  // Canon books (OT/NT/Apocrypha) deduped across the Bible-category editions (KJVA, LXX),
  // independent of which edition is currently selected — so the "Canon Books" picker in the
  // scope palette works whether or not a specific Bible edition is chosen.
  const canonBooksAll: Array<{ id: string; name: string; testament: string }> = (() => {
    const seen = new Set<string>()
    const out: Array<{ id: string; name: string; testament: string }> = []
    for (const t of ALL_TEXTS.filter((t) => t.category === 'bible')) {
      for (const b of (allBooks[t.id] ?? [])) {
        if (!seen.has(b.id)) {
          seen.add(b.id)
          out.push({ id: b.id, name: b.name, testament: b.testament ?? '' })
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

  // Flat ordered list of visible results (respects collapsed groups) for keyboard nav, plus an
  // index by row identity for O(1) lookup — an earlier version had each result row call
  // visibleResults.findIndex(...) during render, which made rendering the results list
  // O(n²) and was the source of the scroll lag on any search with more than a couple hundred
  // matches.
  const visibleResults: Array<RawResult & { _groupKey: string }> = []
  const visibleResultIdxByKey = new Map<string, number>()
  for (const g of filteredGroups) {
    const key = `${g.textId}::${g.bookId}`
    if (!collapsedGroups.has(key)) {
      for (const r of g.results) {
        visibleResultIdxByKey.set(`${r.book_id}:${r.chapter}:${r.verse_num}:${key}`, visibleResults.length)
        visibleResults.push({ ...r, _groupKey: key })
      }
    }
  }

  // Scroll focused result into view when focusedIdx changes
  useEffect(() => {
    if (focusedIdx >= 0) resultButtonRefs.current.get(focusedIdx)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIdx])

  // Reset focused index when results change
  useEffect(() => { setFocusedIdx(-1) }, [results])

  // Position the jump-rail panel as soon as its trigger exists, not just on first hover —
  // see openRail's comment for why this matters for the entrance animation.
  useEffect(() => {
    if (filteredGroups.length <= 1) return
    const r = railTriggerRef.current?.getBoundingClientRect()
    if (r) setRailPanelPos({ centerY: r.top + r.height / 2, right: window.innerWidth - r.left + 6 })
  }, [filteredGroups.length])

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
      {/* ── Shared TopBar slot: mode segmented + word-mode pills. The TopBar's right-hand
           area sits empty while this view is active (it never portals anything there by
           default), so these move up rather than crowding the local search-input row below. ── */}
      <TabHeaderPortal floating={floating}>
        <div className="flex items-center gap-0.5 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-md p-0.5 flex-shrink-0">
          {([['auto', 'All'], ['text', 'Text'], ['strongs', "Strong's"], ['crossref', 'Cross-ref']] as [SearchMode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setSearchMode(m); if (query.trim().length >= 2) runForMode(query) }}
              className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition-colors ${searchMode === m ? 'bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-primary))] font-semibold shadow-sm' : 'text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Word mode — permanent inline pills, text mode only (never in a modal/dropdown) */}
        {effectiveMode(query) === 'text' && (
          <div className="flex items-center gap-0.5 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-md p-0.5 flex-shrink-0">
            {([['all', 'All words'], ['any', 'Any word'], ['phrase', 'Phrase']] as [WordMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => handleWordModeChange(m)}
                className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition-colors ${wordMode === m ? 'bg-[rgb(var(--color-accent))]/16 text-[rgb(var(--color-accent))] font-semibold' : 'text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Scope trigger — a single compact summary button, not the full chip row. The shared
            TopBar slot is one non-wrapping `overflow-hidden` row (TopBar.tsx) already carrying
            the controls above; a multi-chip list here risked silently clipping off-screen with
            no way to scroll to it. The full chip-based editor still exists — it opens the same
            tabbed modal, just from one button instead of N. */}
        {effectiveMode(query) !== 'crossref' && (() => {
          const currentTextEntry = textId !== 'all' ? ALL_TEXTS.find((t) => t.id === textId) : undefined
          const isFiltered = textId !== 'all' || testamentFilter !== 'all' || selectedBooks.length > 0
          const scopeParts: string[] = []
          if (currentTextEntry) scopeParts.push(currentTextEntry.label)
          if (testamentFilter !== 'all') scopeParts.push(testamentFilter)
          if (selectedBooks.length === 1) scopeParts.push(bookNameOf(selectedBooks[0]))
          else if (selectedBooks.length > 1) scopeParts.push(`${selectedBooks.length} books`)
          const scopeSummary = scopeParts.length > 0 ? scopeParts.join(' · ') : 'All scripture'
          return (
            <button
              onClick={() => openScopePalette()}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer flex-shrink-0 min-w-0 ${isFiltered ? 'bg-[rgb(var(--color-accent))]/12 border-[rgb(var(--color-accent))]/40 text-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'}`}
              title="Scope: edition, testament, and books"
            >
              <BookOpen size={11} className="flex-shrink-0" />
              <span className="truncate max-w-[160px]">{scopeSummary}</span>
              <ChevronDown size={9} className="flex-shrink-0" />
            </button>
          )
        })()}
      </TabHeaderPortal>

      {/* ── Header row: search input + relevance/view toggles. No back button — Esc
           (handleKeyDown) still returns to the reader. ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 flex-wrap">
        <Search size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search scripture, Strong's, or verse ref…"
          className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none min-w-0 basis-40"
        />
        {effectiveMode(query) !== 'crossref' && (
          <>
            <button
              onClick={() => setSortMode((s) => s === 'relevance' ? 'bookOrder' : 'relevance')}
              title={sortMode === 'relevance' ? 'Sorted by relevance — click for book order' : 'Sorted by book order — click for relevance'}
              className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:border-[rgb(var(--color-text-muted))] transition-colors cursor-pointer flex-shrink-0"
            >
              {sortMode === 'relevance' ? <ArrowUpDown size={11} /> : <ListTree size={11} />}
              {sortMode === 'relevance' ? 'Relevance' : 'Book order'}
            </button>
            {/* Compact/full refreshed to match the relevance pill's icon+label style instead of
                a bare "≡ Compact" text button. */}
            <button
              onClick={() => setShowContext((v) => !v)}
              title={showContext ? 'Showing full verse text — click for compact' : 'Showing compact snippets — click for full text'}
              className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex-shrink-0 ${showContext ? 'bg-[rgb(var(--color-accent))]/12 border-[rgb(var(--color-accent))]/40 text-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'}`}
            >
              {showContext ? <Rows size={11} /> : <AlignJustify size={11} />}
              {showContext ? 'Full' : 'Compact'}
            </button>
          </>
        )}
      </div>

      {/* ── Scope modal — tabbed: Bible Edition / Canon Books / Other Books, triggered from the
           compact scope button in the shared TopBar above.

           The palette is split into three sections matching how the corpus is actually
           organized (CLAUDE.md §7): a Bible Edition (KJVA/LXX — the translation of the OT/NT/
           Apocrypha canon), Canon Books (multi-select, independent of which edition is chosen,
           since both editions share the same book set), and Other Books (each pseudepigrapha
           text — Enoch, Jubilees, Hermas, etc. — is its own single-book edition, so picking one
           is a single-select action, distinct from picking canon books). An earlier version
           folded all of this into one "Editions" + "Books" pair filtered by a shared Testament
           axis, which made it hard to find/pick a specific canon book OR a specific other book
           without first fighting through edition/testament state that didn't map cleanly to
           either. ── */}
      {effectiveMode(query) !== 'crossref' && (() => {
        const isFiltered = textId !== 'all' || testamentFilter !== 'all' || selectedBooks.length > 0

        const sq = normalizeBookQuery(scopeSearch.trim().toLowerCase())
        const bibleEditions = ALL_TEXTS.filter((t) => t.category === 'bible')
        const otherBooks = ALL_TEXTS.filter((t) => t.category === 'pseudo')
        const filteredOtherBooks = sq ? otherBooks.filter((t) => fullEditionLabel(t.id, t.label).toLowerCase().includes(sq)) : otherBooks

        const canonTestamentOptions: Array<Exclude<TestamentFilter, 'Pseudepigrapha'>> = ['all', 'OT', 'NT', 'Apocrypha']
        const canonBooksInTestament = canonBooksAll.filter((b) => testamentFilter === 'all' || testamentFilter === 'Pseudepigrapha' || b.testament === testamentFilter)
        const filteredCanonBooks = sq
          ? canonBooksInTestament.filter((b) => b.name.toLowerCase().includes(sq) || b.id.toLowerCase().includes(sq))
          : canonBooksInTestament

        return (
          <>
            {/* Scope modal — tabbed: Bible Edition / Canon Books / Other Books. A centered
                modal with real tabs (one section visible at a time) reads more clearly than
                the earlier version's three sections stacked in one long scrolling list. */}
            {scopePaletteOpen && createPortal(
              <div
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
                onMouseDown={(e) => { if (e.target === e.currentTarget) { setScopePaletteOpen(false); setScopeSearch('') } }}
              >
                <div className="flex flex-col bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl overflow-hidden w-[420px] max-h-[75vh]">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
                    <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                    <input
                      ref={scopeSearchRef}
                      type="text"
                      value={scopeSearch}
                      onChange={(e) => setScopeSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setScopePaletteOpen(false); setScopeSearch('') } }}
                      placeholder={scopeTab === 'edition' ? 'Search editions…' : scopeTab === 'other' ? 'Search other books…' : 'Search canon books…'}
                      className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))]"
                    />
                    {isFiltered && (
                      <button
                        onClick={() => { setTextId('all'); setTestamentFilter('all'); setSelectedBooks([]) }}
                        className="flex-shrink-0 text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                      >Clear all</button>
                    )}
                  </div>

                  {/* Tab bar */}
                  <div className="flex items-center gap-1 px-3 pt-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
                    {([['edition', 'Bible Edition'], ['canon', 'Canon Books'], ['other', 'Other Books']] as [typeof scopeTab, string][]).map(([tab, label]) => (
                      <button
                        key={tab}
                        onClick={() => { setScopeTab(tab); setScopeSearch('') }}
                        className={`text-xs font-medium px-3 py-1.5 rounded-t-md border-b-2 -mb-px cursor-pointer transition-colors ${scopeTab === tab ? 'border-[rgb(var(--color-accent))] text-[rgb(var(--color-text-primary))] bg-[rgb(var(--color-surface-3))]' : 'border-transparent text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="overflow-y-auto flex-1 py-1 min-h-[240px]">
                    {/* Bible Edition tab — which translation of the canon to search */}
                    {scopeTab === 'edition' && (
                      <div>
                        {(!sq || 'all editions'.includes(sq)) && (
                          <button
                            onClick={() => selectTranslation('all')}
                            className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left cursor-pointer transition-colors ${textId === 'all' ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/8' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
                          >
                            <Check size={12} className={textId === 'all' ? 'opacity-100' : 'opacity-0'} />
                            📖 All editions
                          </button>
                        )}
                        {bibleEditions.filter((t) => !sq || fullEditionLabel(t.id, t.label).toLowerCase().includes(sq)).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => selectTranslation(t.id)}
                            className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left cursor-pointer transition-colors ${textId === t.id ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/8' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
                          >
                            <Check size={12} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.id === 'kjva' ? 'bg-amber-500' : 'bg-sky-500'}`} />
                            {fullEditionLabel(t.id, t.label)}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Canon Books tab — OT/NT/Apocrypha, works across whichever edition is selected */}
                    {scopeTab === 'canon' && (
                      <div>
                        {!sq && (
                          <div className="flex items-center gap-1 px-3 pb-2 flex-wrap">
                            {canonTestamentOptions.map((s) => (
                              <button
                                key={s}
                                onClick={() => { setTestamentFilter(s); setSelectedBooks([]) }}
                                className={`text-[10.5px] px-2 py-1 rounded-full border cursor-pointer transition-colors ${testamentFilter === s ? 'bg-[rgb(var(--color-accent))]/16 border-[rgb(var(--color-accent))]/45 text-[rgb(var(--color-accent))] font-semibold' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                              >
                                {s === 'all' ? 'All' : s === 'Apocrypha' ? 'Apocrypha' : s}
                              </button>
                            ))}
                          </div>
                        )}
                        {filteredCanonBooks.length === 0 && (
                          <div className="px-3 py-6 text-sm text-center text-[rgb(var(--color-text-muted))]">No canon books match</div>
                        )}
                        {(['OT', 'NT', 'Apocrypha'] as const).map((section) => {
                          const sectionBooks = filteredCanonBooks.filter((b) => b.testament === section)
                          if (sectionBooks.length === 0) return null
                          const sectionLabel = section === 'OT' ? 'Old Testament' : section === 'NT' ? 'New Testament' : 'Apocrypha'
                          const expanded = expandedSections.has(section)
                          return (
                            <div key={section}>
                              <div className="flex items-center gap-1 px-2 py-1.5 select-none sticky top-0 bg-[rgb(var(--color-surface-2))]">
                                <button
                                  onClick={() => setExpandedSections((prev) => { const s = new Set(prev); s.has(section) ? s.delete(section) : s.add(section); return s })}
                                  className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] flex-shrink-0 cursor-pointer"
                                >
                                  {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                </button>
                                <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-secondary))]">
                                  {sectionLabel}
                                  <span className="ml-1.5 font-normal normal-case text-[10px] text-[rgb(var(--color-text-muted))]">{sectionBooks.length}</span>
                                </span>
                              </div>
                              {expanded && (
                                <div className="grid grid-cols-2 gap-0.5 px-2 pb-1.5">
                                  {sectionBooks.map((book) => {
                                    const on = selectedBooks.includes(book.id)
                                    return (
                                      <button
                                        key={book.id}
                                        onClick={() => setSelectedBooks((cur) => toggleBook(cur, book.id))}
                                        className={`flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-left cursor-pointer transition-colors rounded-md ${on ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
                                      >
                                        <span className={`flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))]'}`}>
                                          {on && <Check size={9} className="text-white" />}
                                        </span>
                                        <span className="flex-1 truncate">{book.name}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Other Books tab — each pseudepigrapha text is its own single-book edition */}
                    {scopeTab === 'other' && (
                      <div>
                        {filteredOtherBooks.length === 0 && (
                          <div className="px-3 py-6 text-sm text-center text-[rgb(var(--color-text-muted))]">No other books match</div>
                        )}
                        {filteredOtherBooks.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => selectTranslation(t.id)}
                            className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left cursor-pointer transition-colors ${textId === t.id ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/8' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
                          >
                            <Check size={12} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                            📘 {fullEditionLabel(t.id, t.label)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t border-[rgb(var(--color-surface-4))]">
                    <span className="text-[10px] text-[rgb(var(--color-text-muted))]">Esc to close</span>
                    <button
                      onClick={() => { setScopePaletteOpen(false); setScopeSearch('') }}
                      className="text-[11px] font-semibold px-3 py-1 rounded-md bg-[rgb(var(--color-accent))] text-white cursor-pointer"
                    >Done</button>
                  </div>
                </div>
              </div>,
              document.body
            )}
          </>
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
          <div className="py-1.5">
            {/* Testament/book filters already show as chips in the scope row above, so this
                doesn't repeat them — just the count, and only the search term for Strong's
                mode where there's no query text visible elsewhere to explain the results. */}
            <p className="px-4 pt-0.5 pb-1 text-[10px] text-[rgb(var(--color-text-muted))]">
              {totalCount} result{totalCount !== 1 ? 's' : ''}
              {effectiveMode(query) === 'strongs' && ` for ${parseStrongsQuery(query)}`}
            </p>
            {filteredGroups.map((group) => {
              const key = `${group.textId}::${group.bookId}`
              const collapsed = collapsedGroups.has(key)
              const editionDot = group.textId === 'kjva' ? 'bg-amber-500' : group.textId === 'lxx' ? 'bg-sky-500' : 'bg-[rgb(var(--color-text-muted))]'
              return (
              <div key={key} className="mx-2 mb-1.5 rounded-lg border border-[rgb(var(--color-surface-4))] overflow-hidden bg-[rgb(var(--color-surface-2))]">
                <div
                  ref={(el) => { if (el) groupHeaderRefs.current.set(key, el); else groupHeaderRefs.current.delete(key) }}
                  className="flex items-center gap-2 px-3 py-2 bg-[rgb(var(--color-surface-3))] cursor-pointer select-none hover:bg-[rgb(var(--color-surface-4))] transition-colors"
                  onClick={() => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })}
                >
                  <ChevronDown size={12} className={`text-[rgb(var(--color-text-muted))] transition-transform flex-shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
                  <BookOpen size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                  <span className="text-[13px] font-semibold text-[rgb(var(--color-text-primary))]">{group.bookName}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))]/60 rounded-full px-1.5 py-0.5">{group.results.length}</span>
                  <div className="flex-1" />
                  {textId === 'all' && (
                    <span className="flex items-center gap-1 text-[9.5px] text-[rgb(var(--color-text-secondary))] font-semibold uppercase tracking-wide">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${editionDot}`} />
                      {group.textLabel}
                    </span>
                  )}
                  {group.testament && textId !== 'all' && <span className="text-[9.5px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">{group.testament}</span>}
                </div>
                {!collapsed && group.results.map((r, i) => {
                  const flatIdx = visibleResultIdxByKey.get(`${r.book_id}:${r.chapter}:${r.verse_num}:${key}`) ?? -1
                  const isFocused = flatIdx === focusedIdx
                  return (
                  <button
                    key={`${r._textId}-${r.book_id}-${r.chapter}-${r.verse_num}`}
                    ref={(el) => { if (el && flatIdx >= 0) resultButtonRefs.current.set(flatIdx, el) }}
                    onClick={() => onNavigate(r.book_id, r.chapter, r.verse_num, r._textId ?? textId)}
                    onContextMenu={(e) => { e.preventDefault(); const tid = r._textId ?? textId; openCtxMenu({ bookId: r.book_id, chapter: r.chapter, verse: r.verse_num, textId: tid, text: r.text, x: e.clientX, y: e.clientY }) }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer group ${i > 0 ? 'border-t border-[rgb(var(--color-surface-4))/50]' : ''} ${isFocused ? 'bg-[rgb(var(--color-accent))]/10 ring-inset ring-1 ring-[rgb(var(--color-accent))]/30' : 'hover:bg-[rgb(var(--color-surface-3))]'}`}
                  >
                    <span className="text-[10.5px] font-mono font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded-md w-14 flex-shrink-0 text-center py-1">
                      {r.chapter}:{r.verse_num}
                    </span>
                    {/* line-clamp-2 (the earlier default) rarely differed visually from full text
                        for typical one-sentence verse snippets, which made the toggle feel like it
                        "did nothing" — clamping to a single line makes the two modes clearly
                        different at a glance. */}
                    <span className={`flex-1 text-[13px] text-[rgb(var(--color-text-primary))] leading-relaxed pt-0.5 ${showContext ? '' : 'line-clamp-1'}`}>
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
                    <ChevronRight size={13} className="flex-shrink-0 mt-1 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
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

      {/* Jump-to-book: a small floating pill (not a docked full-height rail), vertically
           centered against the results column rather than pinned to the top corner. An earlier
           version rendered its expanded panel as an absolutely-positioned child inside this
           results row's `overflow-hidden` container — that clipped the panel to invisibility,
           which is why hovering appeared to "do nothing." It's now portaled to document.body
           (like the scope modal) so nothing can clip it, with its own search box and a real
           fade+slide-in animation. A ListTree icon (not just unlabeled dots) plus a native title
           makes its purpose legible before you've ever hovered it; it sits at reduced opacity by
           default and reaches full opacity on hover, reading as an on-demand affordance rather
           than a permanent fixture. */}
      {filteredGroups.length > 1 && (effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && (
        <div
          ref={railTriggerRef}
          title="Jump to book"
          className="absolute top-1/2 -translate-y-1/2 right-2 z-10 flex flex-col items-center gap-1 py-1.5 px-1.5 rounded-full bg-[rgb(var(--color-surface-2))]/95 border border-[rgb(var(--color-surface-4))] shadow-lg backdrop-blur-sm cursor-pointer opacity-55 hover:opacity-100 transition-opacity"
          onMouseEnter={openRail}
          onMouseLeave={scheduleCloseRail}
        >
          <ListTree size={11} className="text-[rgb(var(--color-text-muted))] mb-0.5" />
          {filteredGroups.slice(0, 8).map((g) => {
            const key = `${g.textId}::${g.bookId}`
            const editionColor = g.textId === 'kjva' ? 'bg-amber-500' : g.textId === 'lxx' ? 'bg-sky-500' : 'bg-[rgb(var(--color-text-muted))]'
            return <span key={key} className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${editionColor} opacity-80`} />
          })}
          {filteredGroups.length > 8 && <span className="text-[8px] text-[rgb(var(--color-text-muted))] leading-none">+{filteredGroups.length - 8}</span>}
        </div>
      )}
      {railPanelPos && createPortal(
        (() => {
          const railQuery = normalizeBookQuery(railSearch.trim().toLowerCase())
          const railGroups = railQuery ? filteredGroups.filter((g) => g.bookName.toLowerCase().includes(railQuery)) : filteredGroups
          return (
            <div
              className={`fixed z-[9999] w-64 max-h-[70vh] flex flex-col bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl origin-right transition-[opacity,transform] duration-150 ease-out ${
                railExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
              style={{
                top: railPanelPos.centerY,
                right: railPanelPos.right,
                // Vertical centering (translateY(-50%) against centerY) and the show/hide
                // slide+scale both need the same `transform` property, so they're combined
                // into one inline value here rather than split across this and Tailwind's
                // translate-x-*/scale-* utility classes, which would silently overwrite each
                // other (inline style always wins the whole property, not just the parts a
                // class happens to also set) — that's also why the panel was previously
                // anchored to the trigger's top edge instead of centered on it.
                transform: `translateY(-50%) ${railExpanded ? 'translateX(0) scale(1)' : 'translateX(4px) scale(0.95)'}`,
              }}
              onMouseEnter={openRail}
              onMouseLeave={scheduleCloseRail}
            >
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
                <Search size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                <input
                  ref={railSearchRef}
                  value={railSearch}
                  onChange={(e) => setRailSearch(e.target.value)}
                  placeholder="Jump to book…"
                  className="flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))] min-w-0"
                />
              </div>
              <div className="overflow-y-auto flex-1 py-1">
                {railGroups.length === 0 && (
                  <div className="px-3 py-3 text-xs text-center text-[rgb(var(--color-text-muted))]">No match</div>
                )}
                {railGroups.map((g) => {
                  const key = `${g.textId}::${g.bookId}`
                  const editionDot = g.textId === 'kjva' ? 'bg-amber-500' : g.textId === 'lxx' ? 'bg-sky-500' : 'bg-[rgb(var(--color-text-muted))]'
                  return (
                    <button
                      key={key}
                      onClick={() => { groupHeaderRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setRailExpanded(false); setRailSearch('') }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[12.5px] text-left text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
                    >
                      {textId === 'all' && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${editionDot}`} />}
                      <span className="flex-1 truncate">{g.bookName}</span>
                      {textId === 'all' && <span className="text-[9.5px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide flex-shrink-0">{g.textLabel}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })(),
        document.body
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
