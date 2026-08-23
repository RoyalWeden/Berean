import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, BookOpen, ChevronRight, ChevronDown, Check, GitFork, ExternalLink, Copy, Hash, ArrowUpDown, ListTree, Rows, AlignJustify, ArrowUp, ArrowDown } from 'lucide-react'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import type { Book, Verse } from '@/types'
import { parseRef, bookName } from '@/lib/parseRef'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useAppStore } from '@/store'
import { applyWordReplacer, getWordReplacerSearchVariants } from '@/lib/wordReplacer'
import { parseMultiStrongsQuery, searchMultiStrongs, splitStrongsHighlight } from '@/lib/strongsSearch'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toggleBook, bookPassesFilter, toggleGroup, isGroupActive } from '@/lib/scriptureSearchFilters'
import { normalizeBookQuery, getWordWindow, getAnnotationRanges, type AnnotationRange } from '@/lib/verseUtils'
import { EDITIONS } from '@/lib/bibleTexts'
import { buildHighlightPattern } from '@/lib/scriptureHighlight'
import { RED_LETTER_CLASS } from '@/styles/highlightPalette'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import FloatingHoverPanel, { type FloatingHoverPanelHandle } from '@/components/shell/FloatingHoverPanel'
import { useRovingGridNav } from '@/hooks/useRovingGridNav'

/** Render a verse with its Strong's-tagged words highlighted (by word index), AND — for a
 *  combined Strong's+word query like "G5485 god" — any plain word from that same query
 *  highlighted too, wherever it appears as its own word in the text. Previously only the
 *  Strong's-indexed word(s) got marked, so a combined search silently highlighted just
 *  half of what actually matched. */
function highlightStrongs(text: string, matchWordIndices: number[], extraWords: string[] = []): React.ReactNode {
  const segs = splitStrongsHighlight(text, matchWordIndices, extraWords)
  return (
    <>
      {segs.map((seg, i) => (
        <span key={i}>
          {seg.match
            ? <mark className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm font-semibold">{seg.text}</mark>
            : seg.text}
          {i < segs.length - 1 ? ' ' : ''}
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
  { id: 't_jacob',       label: 'T. Jacob',          category: 'pseudo' as const },
  { id: '2baruch',       label: '2 Baruch',          category: 'pseudo' as const },
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

// Common Strong's numbers (e.g. H853 direct-object marker) have 1,000+ occurrences.
// Previously capped at 200 rendered rows with a "refine your search" message — the
// results list below is now virtualized (@tanstack/react-virtual), so every occurrence
// loads and is searchable/scrollable, but only the rows actually on screen ever mount.

interface RawResult {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  text_tagged?: string
  _textId?: string
}

type TestamentFilter = 'all' | 'OT' | 'NT' | 'Apocrypha' | 'Pseudepigrapha'
type SortMode = 'relevance' | 'bookOrder'

// Compact "all words" results only had room to show one line, but blind CSS line-clamping
// starts at character 0 — for an "all words" query, all the query words are guaranteed to be
// somewhere in the verse (that's what made it match), yet a clamp starting at the verse's
// first word frequently clipped before reaching later query words, so the truncated snippet
// looked like it only matched one of the several typed words. This instead finds each word's
// position, picks a window that covers as many distinct query words as possible within a
// character budget (greedy left-to-right from the first match), and marks truncated ends with
// an ellipsis — the same idea as a search engine's result snippet.
function buildAllWordsSnippet(text: string, query: string, maxLen = 100): string {
  const words = query.trim().split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0 || text.length <= maxLen) return text
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const positions: number[] = []
  for (const w of escaped) {
    const m = new RegExp(`\\b${w}\\w*`, 'i').exec(text)
    if (m) positions.push(m.index)
  }
  if (positions.length === 0) return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
  positions.sort((a, b) => a - b)
  const first = positions[0]
  const last = positions[positions.length - 1]
  let start: number, end: number
  if (last - first + 20 <= maxLen) {
    // All matches fit — center the window on the matched span with some padding.
    const pad = Math.floor((maxLen - (last - first)) / 2)
    start = Math.max(0, first - pad)
    end = Math.min(text.length, start + maxLen)
    start = Math.max(0, end - maxLen)
  } else {
    // Matches are too spread out to all fit — start at the first match so at least it's
    // visible, rather than centering and losing it entirely.
    start = Math.max(0, first - 10)
    end = Math.min(text.length, start + maxLen)
  }
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

function highlight(text: string, query: string, wordMode: WordMode = 'all'): React.ReactNode {
  if (!query.trim()) return text
  const pattern = buildHighlightPattern(query, wordMode)
  if (!pattern) return text
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

/**
 * Like {@link highlight}, but also paints KJV-italic / red-letter (Yeshua's words) spans
 * from `ranges` (see getAnnotationRanges in verseUtils.ts). `text` must be the SAME string
 * `ranges` was computed against (unwindowed r.text) — callers that snippet/truncate the
 * verse first fall back to plain `highlight()` instead of passing ranges here, since the
 * char offsets would no longer line up with the truncated string.
 */
function highlightWithAnnotations(text: string, ranges: AnnotationRange[], query: string, wordMode: WordMode = 'all'): React.ReactNode {
  if (ranges.length === 0) return highlight(text, query, wordMode)
  const pattern = query.trim() ? buildHighlightPattern(query, wordMode) : ''
  const matchRanges: Array<[number, number]> = []
  if (pattern) {
    const re = new RegExp(pattern, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      matchRanges.push([m.index, m.index + m[0].length])
      re.lastIndex = m.index + m[0].length
    }
  }
  const breakpoints = new Set<number>([0, text.length])
  for (const r of ranges) { breakpoints.add(Math.max(0, Math.min(r.start, text.length))); breakpoints.add(Math.max(0, Math.min(r.end, text.length))) }
  for (const [s, e] of matchRanges) { breakpoints.add(s); breakpoints.add(e) }
  const sorted = [...breakpoints].sort((a, b) => a - b)
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1]
    if (s >= e) continue
    const slice = text.slice(s, e)
    const ann = ranges.find((r) => r.start <= s && r.end >= e)
    const isMatch = matchRanges.some(([ms, me]) => ms <= s && me >= e)
    let node: React.ReactNode = slice
    if (isMatch) node = <mark className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm">{node}</mark>
    if (ann?.isRedLetter) node = <span className={RED_LETTER_CLASS}>{node}</span>
    else if (ann?.isItalic) node = <span className="italic opacity-70">{node}</span>
    nodes.push(<span key={i}>{node}</span>)
  }
  return <>{nodes}</>
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

/** What matched, passed along on navigation so the landed verse can highlight it —
 *  the searched text (query/wordMode) or the specific Strong's-tagged word(s)
 *  (strongsWords, word indices). */
export interface SearchNavHighlight {
  query?: string
  wordMode?: WordMode
  strongsWords?: number[]
  /** Plain-word part of a combined Strong's+word query ("G5485 god") — highlighted
   *  alongside strongsWords by text match rather than word index. */
  strongsExtraWords?: string[]
}

interface Props {
  onNavigate: (bookId: string, chapter: number, verse: number, textId: string, highlight?: SearchNavHighlight) => void
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
  // Which book ids the CURRENT query actually matches, independent of selectedBooks — drives
  // hiding non-matching books from the Scope modal's checklist. null = no active query (show
  // every book, same as today). Computed in runSearch below.
  const [matchedBookIds, setMatchedBookIds] = useState<Set<string> | null>(null)
  const [scopePaletteOpen, setScopePaletteOpen] = useState(false)
  const [scopeSearch, setScopeSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>(persistedState?.sortMode ?? 'relevance')
  // Ascending/descending flip, independent of which mode is active — 'desc' is the natural
  // baseline for both (best-match-first for relevance; the bookOrder sort below already
  // produces canonical Genesis→Revelation order, which 'asc' keeps and 'desc' reverses).
  // Not persisted in tab state (unlike sortMode) — a lower-stakes secondary preference.
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [sortMenuPos, setSortMenuPos] = useState<{ left: number; top: number } | null>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  // The dropdown itself is portaled to document.body (see below — fixes a stacking-context
  // bug where it rendered behind other content), so it's no longer a DOM descendant of
  // sortMenuRef — this second ref covers the portaled content too, or every click inside the
  // open menu would register as "outside" and close it before its own onClick even ran.
  const sortMenuContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sortMenuOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (sortMenuRef.current?.contains(t)) return
      if (sortMenuContentRef.current?.contains(t)) return
      setSortMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [sortMenuOpen])
  // Sort pill dropdown: relevance / book order — 2 items, single column. Focus resets
  // to 0 whenever the dropdown opens (below), so it never opens focused on a stale item.
  const sortMenuNav = useRovingGridNav({ itemCount: 2, columns: 1 })
  useEffect(() => { if (sortMenuOpen) sortMenuNav.setFocusedIndex(0) }, [sortMenuOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const [wordMode, setWordMode] = useState<WordMode>(persistedState?.wordMode ?? 'all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState(-1)
  // 'default' (compact, line-clamped snippet) / 'full' (whole verse, no clamp) / 'plusMinus1'
  // / 'plusMinus2' (the matched verse plus 1 or 2 verses of surrounding context on each side).
  const [contextMode, setContextMode] = useState<'default' | 'full' | 'plusMinus1' | 'plusMinus2'>('default')
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState<{ right: number; top: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  // See sortMenuContentRef's comment — same reason, same fix.
  const contextMenuContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!contextMenuOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (contextMenuRef.current?.contains(t)) return
      if (contextMenuContentRef.current?.contains(t)) return
      setContextMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [contextMenuOpen])
  // Compact/context-length dropdown: 4 items (default, full, ±1, ±2) across two visually
  // separated groups but one continuous nav sequence — single column.
  const contextMenuNav = useRovingGridNav({ itemCount: 4, columns: 1 })
  useEffect(() => { if (contextMenuOpen) contextMenuNav.setFocusedIndex(0) }, [contextMenuOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const showContext = contextMode !== 'default'
  // Cache of whole-chapter verse data, keyed "textId:bookId:chapter" — fetched lazily, only
  // once a plusMinus mode is active and a given result's chapter is actually visible/rendered,
  // and shared across every result that happens to land in the same chapter. contextToken
  // forces a re-render once a fetch resolves (the cache itself lives in a ref, not state, so
  // mutating it alone wouldn't trigger one).
  const contextCacheRef = useRef<Map<string, Verse[] | 'pending'>>(new Map())
  const [contextToken, setContextToken] = useState(0)
  function getContextVerses(r: RawResult): Verse[] | null {
    const tid = r._textId ?? textId
    const key = `${tid}:${r.book_id}:${r.chapter}`
    const cached = contextCacheRef.current.get(key)
    if (cached === 'pending' || cached === undefined) {
      if (cached === undefined) {
        contextCacheRef.current.set(key, 'pending')
        window.bible.queryChapter(r.book_id, r.chapter, tid)
          .then((verses) => { contextCacheRef.current.set(key, verses); setContextToken((t) => t + 1) })
          .catch(() => { contextCacheRef.current.set(key, []); setContextToken((t) => t + 1) })
      }
      return null
    }
    return cached
  }
  const [railSearch, setRailSearch] = useState('')
  const railSearchRef = useRef<HTMLInputElement>(null)
  const railPanelRef = useRef<FloatingHoverPanelHandle>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopeSearchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  // Plain-value scroll tracker updated on every scroll tick, read by the unmount-flush effect
  // below INSTEAD of resultsRef.current.scrollTop — React nulls a DOM element ref for an
  // unmounting subtree during the commit phase, before that subtree's passive-effect cleanups
  // run, so reading resultsRef.current directly in an unmount cleanup was silently a no-op.
  const lastScrollTopRef = useRef(0)
  // Debounces the scroll-position store write below, matching BiblePanel.tsx's own scroll
  // handler (150ms) — onScroll fires on every native scroll tick, and each write there replaces
  // the store's whole `tabs` object (one Record spanning all 5 spaces), which every component
  // subscribed to `s.tabs` re-renders on. Writing that on every tick while scrolling search
  // results fanned out re-renders across ~11 unrelated components continuously.
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      // Keep lastScrollTopRef in sync — if the user navigates away again without ever
      // triggering a real onScroll event (e.g. restored straight to a scrolled position, then
      // immediately clicks a result), the unmount-flush above needs this to already reflect
      // the restored position rather than falling back to its 0 initial value.
      lastScrollTopRef.current = persistedState.scrollTop
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

  // Flush the latest scroll position on unmount (switching tabs away from this one,
  // e.g. navigating to a search result — see BiblePanel.tsx's onNavigate). onScroll below
  // debounces its store write by 150ms — if the tab is switched within that window, the
  // debounce timer never fires (it's just abandoned along with the unmounted component) and
  // the scroll position from that last stretch of scrolling is silently lost. Reads through a
  // ref kept fresh every render so the unmount handler (registered once, deps []) always sees
  // the current filter/query state rather than whatever was current when the effect was first
  // attached.
  const latestScopeRef = useRef({ query, textId, wordMode, testamentFilter, selectedBooks, sortMode })
  latestScopeRef.current = { query, textId, wordMode, testamentFilter, selectedBooks, sortMode }
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      const { query, textId, wordMode, testamentFilter, selectedBooks, sortMode } = latestScopeRef.current
      onStateChangeRef.current?.({
        query, textId, wordMode, testamentFilter, bookFilter: selectedBooks.join(',') || 'all', sortMode,
        scrollTop: lastScrollTopRef.current,
      })
    }
  }, [])

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
    // "Isaiah 66:3 LXX" — parseRef reports the trailing translation suffix as forcedTranslation;
    // preview the verse from that text rather than always KJVA.
    const previewTextId = parsed.forcedTranslation?.toLowerCase() ?? 'kjva'
    const refSuffix = parsed.forcedTranslation ? ` ${parsed.forcedTranslation}` : ''
    window.bible.queryVerse(parsed.bookId, parsed.chapter, parsed.verse, previewTextId)
      .then((v) => {
        if (v) {
          setVersePreview({ ref: `${bookName(parsed.bookId)} ${parsed.chapter}:${parsed.verse}${refSuffix}`, text: v.text })
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

  // Build flat list of all books available for the current text selection — computed here
  // (above runSearch) rather than near its other consumers below, since runSearch's scoped-
  // search logic reads it too and a const can't be used before its declaration.
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

  // Shared by runSearch's main (possibly book-scoped) query and its book-filter-agnostic
  // second query below — same variant/text-target double loop, same dedup, same phrase-mode
  // post-filter, just parameterized on which bookIds restriction (if any) to apply.
  const runRawSearch = useCallback(async (
    trimmed: string, tid: string, effectiveWordMode: WordMode, variants: string[], scopedBookIds: string[] | undefined,
  ): Promise<RawResult[]> => {
    const textTargets = tid === 'all' ? ALL_TEXTS.map((t) => t.id) : [tid]
    const seen = new Set<string>()
    let raw: RawResult[] = []
    for (const textId of textTargets) {
      for (const variant of variants) {
        let res: RawResult[]
        try {
          res = (await window.bible.searchText(variant, textId, effectiveWordMode, scopedBookIds)) as unknown as RawResult[]
        } catch { continue }
        for (const r of res) {
          const key = `${textId}|${r.book_id}|${r.chapter}|${r.verse_num}`
          if (seen.has(key)) continue
          seen.add(key)
          raw.push({ ...r, _textId: textId })
        }
      }
    }
    // ── Phrase mode: JS post-filter guarantees only exact-phrase matches ──────
    // FTS5 phrase search is correct in most cases, but this catches edge cases
    // and makes the filtering strict regardless of FTS5 tokenizer quirks. Checked
    // against every VARIANT phrase (not just the user's literal typed text) — a
    // result found via the substituted-wording variant (e.g. "jesus christ") will
    // never literally contain the user's own typed phrase ("yeshua messiah"), so
    // checking only the original phrase here would silently discard exactly the
    // bidirectional matches the variant search above exists to surface.
    if (effectiveWordMode === 'phrase') {
      const phrases = variants.map((v) => v.toLowerCase())
      raw = raw.filter((r) => { const t = r.text.toLowerCase(); return phrases.some((p) => t.includes(p)) })
    }
    return raw
  }, [])

  const runSearch = useCallback(async (q: string, tid: string, wMode?: WordMode) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); setMatchedBookIds(null); return }
    setLoading(true)
    const effectiveWordMode = wMode ?? wordMode
    // Bidirectional word-replacer search: the DB still stores the ORIGINAL word
    // (e.g. "Jesus"), only display-side applyWordReplacer below shows "Yeshua" —
    // so without expanding the search itself, searching "Yeshua" here found nothing.
    // Each variant is a REAL, independent, plain query string run through
    // window.bible.searchText separately and merged below — NOT a single "term1 OR
    // term2" string. electron/ipc/bible.ts's own FTS query builder deliberately
    // treats every word (including a literal "OR") as a required token, so a
    // one-string "OR"-joined query silently became an impossible AND-query
    // requiring the literal word "or" too — confirmed broken in both this view and
    // the floating quick search. Skipped for phrase mode — a substituted variant is
    // still one coherent phrase, so this stays correct there too, just run as
    // several exact-phrase searches instead of one.
    const variants = wordReplacerEnabled
      ? getWordReplacerSearchVariants(trimmed, wordReplacerRules)
      : [trimmed]
    // testamentScopedBookIds (no `selectedBooks`) is the scope the Scripture-filter checklist
    // itself should reflect: "what books does this query actually match", independent of which
    // ones happen to be checked right now. `scopedBookIds` is what actually restricts the VISIBLE
    // results (selectedBooks takes priority there) — see comment below for why that split
    // matters for the relevance cap.
    const testamentScopedBookIds: string[] | undefined =
      (testamentFilter !== 'all' && testamentFilter !== 'Pseudepigrapha')
        ? availableBooks.filter((b) => b.testament === testamentFilter).map((b) => b.id)
        : undefined
    // Push the already-known client-side scope down into the backend query so the
    // relevance cap (electron/ipc/bible.ts) is applied AFTER book/testament filtering,
    // not before — otherwise a book-filtered search can silently miss real matches that
    // rank outside the unscoped cap's top N by BM25 relevance. 'Pseudepigrapha' is a
    // text-level distinction (not a book_id), so it's left unscoped here.
    const scopedBookIds: string[] | undefined = selectedBooks.length > 0 ? selectedBooks : testamentScopedBookIds
    try {
      const raw = await runRawSearch(trimmed, tid, effectiveWordMode, variants, scopedBookIds)
      setResults(raw)
      // The Scripture-filter checklist needs to know which books this query would match with
      // NO book filter applied. When nothing's checked, `raw` above already IS that (it was
      // only ever testament-scoped) — free. Only when a book filter is active does `raw` get
      // artificially narrowed beyond that, so only then is a second, book-filter-agnostic query
      // actually needed to reconstruct the full matched-book set.
      if (selectedBooks.length === 0) {
        setMatchedBookIds(new Set(raw.map((r) => r.book_id)))
      } else {
        const unscoped = await runRawSearch(trimmed, tid, effectiveWordMode, variants, testamentScopedBookIds)
        setMatchedBookIds(new Set(unscoped.map((r) => r.book_id)))
      }
    } catch { setResults([]); setMatchedBookIds(null) }
    finally { setLoading(false) }
  }, [wordMode, wordReplacerEnabled, wordReplacerRules, selectedBooks, testamentFilter, availableBooks, runRawSearch])

  // Auto-uncheck any book that just dropped out of matchedBookIds (its search term no longer
  // matches it) — otherwise a stale, now-invisible checkbox could keep silently filtering
  // results the user has no way to see or uncheck anymore. Also re-runs on `selectedBooks`
  // itself (a group's "Select all" adds every book in that edition, including ones currently
  // hidden by matchedBookIds — this catches that right away rather than leaving them checked
  // until the next query change happens to recompute matchedBookIds).
  useEffect(() => {
    if (matchedBookIds === null) return
    setSelectedBooks((prev) => {
      const next = prev.filter((id) => matchedBookIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [matchedBookIds, selectedBooks])

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
    // An explicit segment pick always wins over shape-based detection — previously
    // `isStrongsQuery` was checked before the explicit 'text' pick, so a Strong's-shaped
    // query (e.g. "G5485") silently ran as a Strong's search even with "Text" selected,
    // and there was no way to force a literal keyword search for that string. Only
    // 'auto' mode (no explicit pick) infers strongs/crossref/text from the query's shape.
    if (searchMode === 'crossref') return 'crossref'
    if (searchMode === 'strongs') return 'strongs'
    if (searchMode === 'text') return 'text'
    // isMultiStrongsQuery covers both a bare number ("g5485") and a combination
    // ("g5485 g54" / "g5485 jacob") — see strongsSearch.ts.
    if (parseMultiStrongsQuery(q) !== null) return 'strongs'
    return parseRef(q.trim()) ? 'crossref' : 'text'
  }

  // Strong's-number search: find every verse whose tagged text carries the number(s) —
  // supports combining several Strong's numbers ("G5485 G54", AND'd) and/or a plain word
  // ("G5485 jacob") via searchMultiStrongs. Powered by the same lexicon occurrence data as
  // the side panel, so "open all occurrences" lands here. No result cap — the render below
  // is virtualized (@tanstack/react-virtual), so even a common number's full occurrence
  // list (thousands of rows) renders only what's actually on screen.
  const runStrongsSearch = useCallback(async (q: string) => {
    const parsed = parseMultiStrongsQuery(q)
    if (!parsed) { setResults([]); setStrongsMatches({}); return }
    setLoading(true)
    try {
      const found = await searchMultiStrongs(parsed, window.lexicon.getOccurrences)
      const matches: Record<string, number[]> = {}
      const rows: RawResult[] = found.map((o) => {
        matches[`${o.book_id}:${o.chapter}:${o.verse_num}`] = o.matchWordIndices
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

  function openScopePalette() {
    setScopePaletteOpen(true)
    setScopeSearch('')
    setTimeout(() => scopeSearchRef.current?.focus(), 30)
  }

  // FloatingHoverPanel owns open/close/hover-timer/positioning; this just
  // reacts to its expanded-state changes to autofocus the search input and
  // reset the search text once it closes.
  function handleRailExpandedChange(expanded: boolean) {
    if (expanded) setTimeout(() => railSearchRef.current?.focus(), 30)
    else setRailSearch('')
  }

  function handleWordModeChange(mode: WordMode) {
    setWordMode(mode)
    if (query.trim().length >= 2 && effectiveMode(query) === 'text') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      runSearch(query, textId, mode)
    }
  }

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
  // Memoized: this groups/filters/sorts `results` (which can run into the thousands — see the
  // comment on `visibleResults` below) and was previously plain code re-run on every render,
  // including the render each keystroke's `setQuery` call triggers — well before the debounced
  // search itself even fires a new query. That made typing feel like it briefly locked up on
  // every character. Only actually recompute when an input that affects the grouping changes.
  const filteredGroups: GroupedResult[] = useMemo(() => (() => {
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
          // The canonical display name (parseRef.ts's own BOOKS table), not the raw DB book
          // name — some texts (e.g. 3 Maccabees) store an abbreviation like "3MA" as their
          // literal book name, which normalizeBookName's Roman-numeral-only handling didn't
          // catch, so it leaked straight through into the jump rail / group headers as-is.
          bookName: bookName(r.book_id),
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
      // 'asc' (Genesis→Revelation) is the sort above's natural order; 'desc' reverses both
      // the group order and each group's own verse order.
      if (sortDirection === 'desc') {
        groups.reverse()
        groups.forEach((g) => g.results.reverse())
      }
    } else if (sortDirection === 'asc') {
      // Relevance mode's natural (unsorted) order is "best match first" — treated as the
      // 'desc' baseline, so 'asc' just reverses it to show the weakest matches first.
      groups.reverse()
      groups.forEach((g) => g.results.reverse())
    }
    return groups
  })(), [results, selectedBooks, allBooks, testamentFilter, sortMode, sortDirection])

  const totalCount = filteredGroups.reduce((n, g) => n + g.results.length, 0)

  const bookNameOf = (id: string) => availableBooks.find((b) => b.id === id)?.name ?? id

  // Flat row model driving BOTH the virtualized render below and keyboard nav — one header
  // row per group (always present) plus one row per result (only when its group isn't
  // collapsed). `visibleIdx` is the keyboard-nav position (what focusedIdx indexes into,
  // skipping headers); the row's own position in this array is what the virtualizer and
  // scrollToIndex use instead. Results are no longer capped/sliced anywhere (a common
  // Strong's number's occurrence list can run into the thousands) — virtualizing here is
  // what keeps that safe: only rows actually on screen are ever mounted as real DOM nodes.
  type FlatRow =
    | { type: 'header'; key: string; group: GroupedResult }
    | { type: 'result'; key: string; group: GroupedResult; result: RawResult; indexInGroup: number; visibleIdx: number }
  // Memoized alongside filteredGroups above, for the same reason — this rebuilds the entire
  // flattened row array (plus an object-spread per result row) and was otherwise re-running on
  // every render, including every keystroke.
  const { flatRows, headerFlatIndex, visibleResults } = useMemo(() => {
    const rows: FlatRow[] = []
    const headerIdx = new Map<string, number>()
    let visibleIdx = 0
    for (const g of filteredGroups) {
      const key = `${g.textId}::${g.bookId}`
      headerIdx.set(key, rows.length)
      rows.push({ type: 'header', key, group: g })
      if (!collapsedGroups.has(key)) {
        g.results.forEach((r, i) => {
          rows.push({ type: 'result', key, group: g, result: r, indexInGroup: i, visibleIdx })
          visibleIdx++
        })
      }
    }
    const visible: Array<RawResult & { _groupKey: string }> =
      rows.filter((row): row is Extract<FlatRow, { type: 'result' }> => row.type === 'result')
        .map((row) => ({ ...row.result, _groupKey: row.key }))
    return { flatRows: rows, headerFlatIndex: headerIdx, visibleResults: visible }
  }, [filteredGroups, collapsedGroups])

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => resultsRef.current,
    estimateSize: (i) => {
      if (flatRows[i]?.type === 'header') return 37
      if (contextMode === 'plusMinus1') return 130
      if (contextMode === 'plusMinus2') return 190
      return showContext ? 88 : 48
    },
    overscan: 12,
  })

  // Scroll focused result into view when focusedIdx changes
  useEffect(() => {
    if (focusedIdx < 0) return
    const flatRowIdx = flatRows.findIndex((row) => row.type === 'result' && row.visibleIdx === focusedIdx)
    if (flatRowIdx >= 0) rowVirtualizer.scrollToIndex(flatRowIdx, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIdx])

  // Reset focused index when results change
  useEffect(() => { setFocusedIdx(-1) }, [results])

  // What to highlight once we land on a result's verse — the searched text (word-replaced
  // the same way the results themselves are, so the highlighted term matches what's on
  // screen) for a text search, or the specific Strong's-tagged word indices for a Strong's
  // search. Shared by every onNavigate call site below.
  function highlightForResult(r: RawResult): SearchNavHighlight | undefined {
    if (effectiveMode(query) === 'strongs') {
      const words = strongsMatches[`${r.book_id}:${r.chapter}:${r.verse_num}`]
      const parsed = parseMultiStrongsQuery(query)
      if ((!words || words.length === 0) && (!parsed?.words.length)) return undefined
      return { strongsWords: words ?? [], strongsExtraWords: parsed?.words }
    }
    const highlightQuery = wordReplacerEnabled && wordReplacerRules.length > 0
      ? applyWordReplacer(query, wordReplacerRules)
      : query
    return highlightQuery.trim() ? { query: highlightQuery, wordMode } : undefined
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Enter') {
      if (focusedIdx >= 0 && visibleResults[focusedIdx]) {
        const r = visibleResults[focusedIdx]
        onNavigate(r.book_id, r.chapter, r.verse_num, r._textId ?? textId, highlightForResult(r))
        return
      }
      runForMode(query)
      return
    }
    // ArrowDown/ArrowUp only — NOT vim-style j/k. This handler is on the live query
    // input itself (below), not a results list, so binding plain letter keys here
    // swallows them out of anything the user is actively typing (e.g. "dark", "jerusalem").
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (visibleResults.length === 0) return
      e.preventDefault()
      setFocusedIdx((i) => Math.min(i + 1, visibleResults.length - 1))
      return
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
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
            {/* Sort pill: conjoined "mode dropdown" + "direction flip" — replaces the old
                single-button relevance/book-order cycle. Direction is its own control
                (applies to whichever mode is active) rather than folded into the cycle. */}
            <div ref={sortMenuRef} className="flex items-stretch rounded-full border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] overflow-hidden flex-shrink-0">
              <button
                onClick={() => {
                  if (!sortMenuOpen) { const r = sortMenuRef.current?.getBoundingClientRect(); if (r) setSortMenuPos({ left: r.left, top: r.bottom + 4 }) }
                  setSortMenuOpen((v) => !v)
                }}
                title="Sort order"
                className="flex items-center gap-1.5 text-[10px] font-medium pl-2 pr-1.5 py-0.5 text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
              >
                {sortMode === 'relevance' ? <ArrowUpDown size={11} /> : <ListTree size={11} />}
                {sortMode === 'relevance' ? 'Relevance' : 'Book order'}
                <ChevronDown size={9} className={`transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className="w-px bg-[rgb(var(--color-surface-4))]" />
              <button
                onClick={() => setSortDirection((d) => d === 'asc' ? 'desc' : 'asc')}
                title={sortDirection === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
                className="flex items-center px-1.5 py-0.5 text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
              >
                {sortDirection === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
              </button>
              {/* Portaled to document.body with a fixed position computed from the trigger's
                  own rect (like every other menu in this file, e.g. the results' right-click
                  ctxMenu below) — an in-flow `absolute` dropdown here sat inside the header
                  row's own stacking context, which a sibling ancestor elsewhere in the tree
                  outranked, so it rendered visually BEHIND other content instead of on top of
                  it despite its own z-50. Escaping to the body's top-level stacking context via
                  a portal is what actually fixes that, not a bigger z-index number. */}
              {sortMenuOpen && sortMenuPos && createPortal(
                <div
                  ref={sortMenuContentRef}
                  style={{ position: 'fixed', left: sortMenuPos.left, top: sortMenuPos.top, zIndex: 9999 }}
                  className="min-w-[130px] rounded-shell context-menu overflow-hidden py-1"
                >
                  {([['relevance', 'Relevance', ArrowUpDown], ['bookOrder', 'Book order', ListTree]] as const).map(([m, label, Icon], i) => (
                    <button
                      key={m}
                      onClick={() => { setSortMode(m); setSortMenuOpen(false) }}
                      {...sortMenuNav.getItemProps(i)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                    >
                      <Icon size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                      <span className="flex-1">{label}</span>
                      {sortMode === m && <Check size={12} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>

            {/* Context-length dropdown — was a compact/full flip button; now a 4-way picker
                (default snippet / full verse / ± context) since "±1 verse" / "±2 verses" have
                no natural binary toggle counterpart. */}
            <div ref={contextMenuRef} className="flex-shrink-0">
              <button
                onClick={() => {
                  if (!contextMenuOpen) { const r = contextMenuRef.current?.getBoundingClientRect(); if (r) setContextMenuPos({ right: window.innerWidth - r.right, top: r.bottom + 4 }) }
                  setContextMenuOpen((v) => !v)
                }}
                title="Result length"
                className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${showContext ? 'bg-[rgb(var(--color-accent))]/12 border-[rgb(var(--color-accent))]/40 text-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'}`}
              >
                {contextMode === 'default' && <AlignJustify size={11} />}
                {contextMode === 'full' && <Rows size={11} />}
                {(contextMode === 'plusMinus1' || contextMode === 'plusMinus2') && <span className="font-mono font-bold leading-none">±</span>}
                {contextMode === 'default' && 'Compact'}
                {contextMode === 'full' && 'Full'}
                {contextMode === 'plusMinus1' && '±1 verse'}
                {contextMode === 'plusMinus2' && '±2 verses'}
                <ChevronDown size={9} className={`transition-transform ${contextMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {contextMenuOpen && contextMenuPos && createPortal(
                <div
                  ref={contextMenuContentRef}
                  style={{ position: 'fixed', right: contextMenuPos.right, top: contextMenuPos.top, zIndex: 9999 }}
                  className="min-w-[150px] rounded-shell context-menu overflow-hidden py-1"
                >
                  {([
                    ['default', 'Compact', AlignJustify],
                    ['full', 'Full verse', Rows],
                  ] as const).map(([m, label, Icon], i) => (
                    <button
                      key={m}
                      onClick={() => { setContextMode(m); setContextMenuOpen(false) }}
                      {...contextMenuNav.getItemProps(i)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                    >
                      <Icon size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                      <span className="flex-1">{label}</span>
                      {contextMode === m && <Check size={12} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
                    </button>
                  ))}
                  <div className="h-px my-1 bg-[rgb(var(--color-surface-4))]" />
                  {([
                    ['plusMinus1', '±1 verse'],
                    ['plusMinus2', '±2 verses'],
                  ] as const).map(([m, label], i) => (
                    <button
                      key={m}
                      onClick={() => { setContextMode(m); setContextMenuOpen(false) }}
                      {...contextMenuNav.getItemProps(i + 2)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                    >
                      <span className="font-mono font-bold leading-none w-3 flex-shrink-0 text-center text-[rgb(var(--color-text-muted))]">±</span>
                      <span className="flex-1">{label}</span>
                      {contextMode === m && <Check size={12} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
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
      {(() => {
        // NOTE: this whole IIFE runs every render (not gated behind `effectiveMode(query)
        // !== 'crossref'` at the call site) because it calls useRovingGridNav below —
        // hooks must run unconditionally in the same order every render. Only the final
        // JSX return is conditioned on crossref mode.
        const isFiltered = textId !== 'all' || testamentFilter !== 'all' || selectedBooks.length > 0

        const sq = normalizeBookQuery(scopeSearch.trim().toLowerCase())
        const bibleEditions = ALL_TEXTS.filter((t) => t.category === 'bible')
        const otherBooks = ALL_TEXTS.filter((t) => t.category === 'pseudo')
        // These "Other Books" editions are internally subdivided (T12P: 12 patriarchs,
        // Hermas: Visions/Mandates/Similitudes, Recognitions of Clement: 10 books) — expose
        // each subdivision as its own pickable book (via selectedBooks/bookPassesFilter,
        // the exact same mechanism Canon Books already uses) instead of only being able to
        // search the whole edition at once.
        const MULTI_BOOK_OTHER = new Set(['t12p', 'hermas', 'recog_clement'])
        const subBooksFor = (textId: string) => allBooks[textId] ?? []
        // DB book names carry the full edition name as a prefix ("Recognitions of Clement
        // — Book I", "Shepherd of Hermas — Visions") so they read correctly standalone
        // (search results, tab titles, etc.) — but repeated 66+ times down a narrow 2-
        // column checkbox grid under a header that already says the edition name, that
        // shared prefix just eats the row's width and truncates away the one part that's
        // actually different between rows, leaving every row looking identical. The group
        // header already establishes what edition these belong to, so only the distinguishing
        // remainder needs to show here (and RCL's roman numerals become plain digits).
        function shortSubBookName(textId: string, book: { id: string; name: string }): string {
          if (textId === 'recog_clement') return `Book ${book.id.replace('RCL', '')}`
          return book.name.replace(/^.*—\s*/, '')
        }
        const filteredOtherBooks = sq
          ? otherBooks.filter((t) =>
              fullEditionLabel(t.id, t.label).toLowerCase().includes(sq) ||
              (MULTI_BOOK_OTHER.has(t.id) && subBooksFor(t.id).some((b) => b.name.toLowerCase().includes(sq)))
            )
          : otherBooks

        const scopeOptions: TestamentFilter[] = ['all', 'OT', 'NT', 'Apocrypha', 'Pseudepigrapha']
        const canonBooksInTestament = canonBooksAll.filter((b) => testamentFilter === 'all' || testamentFilter === 'Pseudepigrapha' || b.testament === testamentFilter)
        // Hide books the current query has zero matches in (matchedBookIds), same idea as the
        // existing `sq` (scope-modal search box) filter just above it, applied as one more
        // predicate in the same chain — null means no active query, so nothing's hidden.
        const filteredCanonBooks = canonBooksInTestament
          .filter((b) => sq ? (b.name.toLowerCase().includes(sq) || b.id.toLowerCase().includes(sq)) : true)
          .filter((b) => matchedBookIds === null || matchedBookIds.has(b.id))

        // Filtered per-section item lists, computed once so both the "does this section
        // have anything to show" check and the actual render use the exact same list.
        const showAllEditionsOption = !sq || 'all editions'.includes(sq)
        const filteredEditions = bibleEditions.filter((t) => !sq || fullEditionLabel(t.id, t.label).toLowerCase().includes(sq))
        // The single scope pill (All/OT/NT/Apocrypha/Pseudepigrapha) now governs which
        // sections are even relevant, not just which canon books show — picking "OT"
        // means "I want an Old Testament book," so Bible Edition and Other Books (neither
        // of which IS a testament) drop out entirely instead of sitting there unrelated.
        const showEditionSection = testamentFilter === 'all'
        const showCanonSection = testamentFilter !== 'Pseudepigrapha'
        const showOtherSection = testamentFilter === 'all' || testamentFilter === 'Pseudepigrapha'
        const hasEditionMatch = showEditionSection && (showAllEditionsOption || filteredEditions.length > 0)
        const hasCanonMatch = showCanonSection && filteredCanonBooks.length > 0
        const hasOtherMatch = showOtherSection && filteredOtherBooks.length > 0

        // Roving-tabindex arrow-key nav — one independent instance per filter group in the
        // Scope modal. Called unconditionally every render (see note above); itemCount is
        // just a prop that changes as the underlying lists filter/load, not the hook call
        // itself, so this is safe even though these lists change size on every keystroke.
        const testamentNav = useRovingGridNav({ itemCount: scopeOptions.length, columns: 1 })
        const editionItemCount = (showAllEditionsOption ? 1 : 0) + filteredEditions.length
        const editionNav = useRovingGridNav({ itemCount: editionItemCount, columns: 1 })
        const canonNav = useRovingGridNav({ itemCount: filteredCanonBooks.length, columns: 3 })
        // "Other Books" multi-book groups (T12P, Hermas, Recognitions of Clement) are a
        // fixed, known set — each gets its own independent sub-grid nav instance. No
        // cross-group edge-of-grid handoff between different groups' sub-grids (deferred
        // v2 simplification); native Tab moves between groups in v1.
        const filteredSubBooksFor = (tid: string) => {
          return subBooksFor(tid)
            .filter((b) => sq ? b.name.toLowerCase().includes(sq) : true)
            .filter((b) => matchedBookIds === null || matchedBookIds.has(b.id))
        }
        const t12pNav = useRovingGridNav({ itemCount: filteredSubBooksFor('t12p').length, columns: 3 })
        const hermasNav = useRovingGridNav({ itemCount: filteredSubBooksFor('hermas').length, columns: 3 })
        const recogClementNav = useRovingGridNav({ itemCount: filteredSubBooksFor('recog_clement').length, columns: 3 })
        const otherGroupNav: Record<string, ReturnType<typeof useRovingGridNav>> = {
          t12p: t12pNav, hermas: hermasNav, recog_clement: recogClementNav,
        }

        // One consistent checkbox-style row for every pickable item across all three
        // sections (Bible Edition, Canon Books, Other Books) — an earlier version used a
        // plain checkmark-list style for Edition/Other rows but a square-checkbox grid
        // for Canon Books, which read as two different pickers glued together even
        // though they're all "select the thing(s) to search." `navProps` (roving-tabindex
        // props from useRovingGridNav.getItemProps) is optional and merged onto the button
        // alongside its own onClick — not every scopeItem call site participates in nav.
        function scopeItem(key: string, selected: boolean, onClick: () => void, content: React.ReactNode, full = true, navProps?: ReturnType<ReturnType<typeof useRovingGridNav>['getItemProps']>) {
          return (
            <button
              key={key}
              onClick={onClick}
              {...navProps}
              className={`flex items-center gap-2 ${full ? 'w-full px-3 py-2 text-sm' : 'px-2 py-1.5 text-[13px] rounded-md'} text-left cursor-pointer transition-colors ${selected ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
            >
              <span className={`flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${selected ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))]'}`}>
                {selected && <Check size={9} className="text-white" />}
              </span>
              {content}
            </button>
          )
        }

        if (effectiveMode(query) === 'crossref') return null

        return (
          <>
            {/* Scope modal — Bible Edition / Canon Books / Other Books all live in ONE
                continuous scrollable list, plain section labels (not tabs, not collapsible).
                An earlier tabbed version showed one section at a time, so the search box
                could only ever filter within whichever tab happened to be open — searching
                "genesis" while on the "Other Books" tab found nothing, even though Genesis
                is right there in Canon Books. A later version fixed that but added its own
                complexity back (collapse/expand toggles on every section, plus a SECOND
                independent collapse toggle per testament inside Canon Books) — simplified
                again here: everything just shows, and the testament pills (All/OT/NT/
                Apocrypha) ARE the one narrowing control for Canon Books' size, instead of
                pills PLUS separate expand state doing overlapping jobs. */}
            {scopePaletteOpen && createPortal(
              <div
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
                onMouseDown={(e) => { if (e.target === e.currentTarget) { setScopePaletteOpen(false); setScopeSearch('') } }}
              >
                <div className="flex flex-col bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl overflow-hidden w-[600px] max-h-[75vh]">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
                    <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                    <input
                      ref={scopeSearchRef}
                      type="text"
                      value={scopeSearch}
                      onChange={(e) => setScopeSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setScopePaletteOpen(false); setScopeSearch('') }
                        // Arrow keys typed while focus is still in the search box do nothing on
                        // their own — each roving-tabindex group's onKeyDown only fires once one
                        // of its own items has DOM focus. ArrowDown hands focus off to the
                        // testament pill row (the first roving group below the input); from
                        // there the existing per-item handlers take over normal roving nav.
                        else if (e.key === 'ArrowDown') { e.preventDefault(); testamentNav.focusCurrent() }
                      }}
                      placeholder="Search editions, testaments, or books…"
                      className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))]"
                    />
                    {isFiltered && (
                      <button
                        onClick={() => { setTextId('all'); setTestamentFilter('all'); setSelectedBooks([]) }}
                        className="flex-shrink-0 text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                      >Clear all</button>
                    )}
                  </div>

                  {/* One scope pill row, governing everything below it — not just a
                      Canon-Books-only filter anymore. "OT"/"NT"/"Apocrypha" narrow to canon
                      books of that testament (Edition and Other Books drop out, since
                      neither one IS a testament); "Pseudepigrapha" narrows to Other Books
                      the same way. This replaces having a whole separate pill row nested
                      inside the Canon Books section specifically. */}
                  <div className="flex items-center gap-1 flex-wrap px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
                    {scopeOptions.map((s, i) => (
                      <button
                        key={s}
                        onClick={() => { setTestamentFilter(s); setSelectedBooks([]) }}
                        {...testamentNav.getItemProps(i)}
                        className={`text-[10.5px] px-2 py-1 rounded-full border cursor-pointer transition-colors ${testamentFilter === s ? 'bg-[rgb(var(--color-accent))]/16 border-[rgb(var(--color-accent))]/45 text-[rgb(var(--color-accent))] font-semibold' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                      >
                        {s === 'all' ? 'All' : s}
                      </button>
                    ))}
                  </div>

                  <div className="overflow-y-auto flex-1 py-1 min-h-[240px]">
                    {!hasEditionMatch && !hasCanonMatch && !hasOtherMatch && (
                      <div className="px-3 py-6 text-sm text-center text-[rgb(var(--color-text-muted))]">
                        {scopeSearch ? `Nothing matches "${scopeSearch}"` : 'Nothing in this scope'}
                      </div>
                    )}

                    {/* ── Bible Edition — which translation of the canon to search. ── */}
                    {hasEditionMatch && (
                      <div>
                        {showAllEditionsOption && scopeItem('edition-all', textId === 'all', () => selectTranslation('all'), 'All editions', true, editionNav.getItemProps(0))}
                        {filteredEditions.map((t, i) => scopeItem(
                          t.id,
                          textId === t.id,
                          () => selectTranslation(t.id),
                          <>
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.id === 'kjva' ? 'bg-amber-500' : 'bg-sky-500'}`} />
                            {fullEditionLabel(t.id, t.label)}
                          </>,
                          true,
                          editionNav.getItemProps((showAllEditionsOption ? 1 : 0) + i)
                        ))}
                      </div>
                    )}

                    {hasEditionMatch && (hasCanonMatch || hasOtherMatch) && (
                      <div className="mx-3 my-1 h-px bg-[rgb(var(--color-surface-4))]" />
                    )}

                    {/* ── Canon Books — flat grid, no OT/NT/Apocrypha sub-headers: the scope
                         pill row above already tells you what you're looking at when it's
                         narrowed, and when it's "All" the testament order (OT then NT then
                         Apocrypha, canonBooksAll's own natural order) still reads fine
                         without a label repeating what's visually obvious from scrolling. ── */}
                    {hasCanonMatch && (
                      <div className="grid grid-cols-3 gap-0.5 px-2 py-1">
                        {filteredCanonBooks.map((book, i) =>
                          scopeItem(book.id, selectedBooks.includes(book.id), () => setSelectedBooks((cur) => toggleBook(cur, book.id)), <span className="flex-1 truncate">{book.name}</span>, false, canonNav.getItemProps(i))
                        )}
                      </div>
                    )}

                    {hasCanonMatch && hasOtherMatch && (
                      <div className="mx-3 my-1 h-px bg-[rgb(var(--color-surface-4))]" />
                    )}

                    {/* ── Other Books — each pseudepigrapha text is its own single-book edition ── */}
                    {hasOtherMatch && (
                      <div>
                        {filteredOtherBooks.map((t) => {
                          if (!MULTI_BOOK_OTHER.has(t.id)) {
                            return scopeItem(t.id, textId === t.id, () => selectTranslation(t.id), fullEditionLabel(t.id, t.label))
                          }
                          const subBooks = subBooksFor(t.id)
                          const filteredSubBooks = filteredSubBooksFor(t.id)
                          if (filteredSubBooks.length === 0) return null
                          const group = { id: t.id, label: fullEditionLabel(t.id, t.label), books: subBooks.map((b) => b.id) }
                          const wholeGroupSelected = isGroupActive(selectedBooks, group)
                          return (
                            <div key={t.id}>
                              <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5">
                                <p className="text-[10px] font-medium text-[rgb(var(--color-text-muted))]">{group.label}</p>
                                <button
                                  onClick={() => setSelectedBooks((cur) => toggleGroup(cur, group))}
                                  className={`text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${wholeGroupSelected ? 'text-[rgb(var(--color-accent))] font-semibold' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                                >
                                  {wholeGroupSelected ? 'Clear all' : 'Select all'}
                                </button>
                              </div>
                              <div className="grid grid-cols-3 gap-0.5 px-2 pb-1.5">
                                {filteredSubBooks.map((b, i) =>
                                  scopeItem(b.id, selectedBooks.includes(b.id), () => setSelectedBooks((cur) => toggleBook(cur, b.id)), <span className="flex-1 truncate">{shortSubBookName(t.id, b)}</span>, false, otherGroupNav[t.id]?.getItemProps(i))
                                )}
                              </div>
                            </div>
                          )
                        })}
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
        onScroll={(e) => {
          const scrollTop = (e.currentTarget as HTMLDivElement).scrollTop
          lastScrollTopRef.current = scrollTop
          if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
          scrollSaveTimerRef.current = setTimeout(() => {
            onStateChangeRef.current?.({ query, textId, wordMode, testamentFilter, bookFilter: selectedBooks.join(',') || 'all', sortMode, scrollTop })
          }, 150)
        }}
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
              {effectiveMode(query) === 'strongs' && (() => {
                const parsed = parseMultiStrongsQuery(query)
                return parsed ? ` for ${[...parsed.strongsNums, ...parsed.words].join(' + ')}` : ''
              })()}
            </p>
            {/* Virtualized flat row list — each book/chapter GROUP still reads as its own
                separated, rounded card (not one merged continuous panel — an earlier
                virtualization pass collapsed all groups into a single bordered box, which
                lost that separation and was reported as "you combined all the sections").
                Restoring the per-group card look while staying virtualized means the visual
                gap between groups can't be a CSS margin (tanstack-virtual's measureElement
                doesn't account for a child's margin escaping the measured box via margin
                collapsing, which would silently throw off the computed total height/
                positions) — it's `pt-1.5` PADDING on each group's header wrapper instead,
                which the virtualizer's own height measurement always includes correctly.
                Only rows actually scrolled into view are ever mounted — this is what makes
                an uncapped, thousands-of-rows Strong's occurrence list safe to render at all. */}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = flatRows[virtualRow.index]
                  if (!row) return null
                  if (row.type === 'header') {
                    const key = row.key
                    const group = row.group
                    const collapsed = collapsedGroups.has(key)
                    const editionDot = group.textId === 'kjva' ? 'bg-amber-500' : group.textId === 'lxx' ? 'bg-sky-500' : 'bg-[rgb(var(--color-text-muted))]'
                    // A collapsed group (or one with no results, in practice never happens
                    // since groups are only created from an actual match) has no result row
                    // to close the card's bottom — the header closes it itself instead.
                    const selfClosing = collapsed || group.results.length === 0
                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        className={`absolute top-0 left-0 w-full ${virtualRow.index > 0 ? 'pt-1.5' : ''}`}
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        <div
                          className={`mx-2 flex items-center gap-2 px-3 py-2 bg-[rgb(var(--color-surface-3))] border-t border-l border-r border-[rgb(var(--color-surface-4))] rounded-t-lg cursor-pointer select-none hover:bg-[rgb(var(--color-surface-4))] transition-colors ${selfClosing ? 'border-b rounded-b-lg' : ''}`}
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
                      </div>
                    )
                  }
                  const r = row.result
                  const isFocused = row.visibleIdx === focusedIdx
                  const isLastInGroup = row.indexInGroup === row.group.results.length - 1
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className="absolute top-0 left-0 w-full"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <button
                        onClick={() => onNavigate(r.book_id, r.chapter, r.verse_num, r._textId ?? textId, highlightForResult(r))}
                        onContextMenu={(e) => { e.preventDefault(); const tid = r._textId ?? textId; openCtxMenu({ bookId: r.book_id, chapter: r.chapter, verse: r.verse_num, textId: tid, text: r.text, x: e.clientX, y: e.clientY }) }}
                        className={`mx-2 w-[calc(100%-16px)] flex items-start gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer group bg-[rgb(var(--color-surface-2))] border-l border-r border-[rgb(var(--color-surface-4))] ${isLastInGroup ? 'border-b rounded-b-lg' : ''} ${row.indexInGroup > 0 ? 'border-t border-[rgb(var(--color-surface-4))/50]' : ''} ${isFocused ? 'bg-[rgb(var(--color-accent))]/10 ring-inset ring-1 ring-[rgb(var(--color-accent))]/30' : 'hover:bg-[rgb(var(--color-surface-3))]'}`}
                      >
                        <span className="text-[10.5px] font-mono font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded-md w-14 flex-shrink-0 text-center py-1">
                          {r.chapter}:{r.verse_num}
                        </span>
                        {(contextMode === 'plusMinus1' || contextMode === 'plusMinus2') ? (() => {
                          const span = contextMode === 'plusMinus1' ? 1 : 2
                          const chapterVerses = getContextVerses(r)
                          if (!chapterVerses) {
                            return <span className="flex-1 text-[13px] text-[rgb(var(--color-text-muted))] italic pt-0.5">Loading context…</span>
                          }
                          const lo = r.verse_num - span
                          const hi = r.verse_num + span
                          const contextRows = chapterVerses
                            .filter((v) => v.verse_num >= lo && v.verse_num <= hi)
                            .sort((a, b) => a.verse_num - b.verse_num)
                          return (
                            <span className="flex-1 flex flex-col gap-0.5 pt-0.5">
                              {contextRows.map((v) => {
                                const isMatch = v.verse_num === r.verse_num
                                const vText = wordReplacerEnabled && wordReplacerRules.length > 0 ? applyWordReplacer(v.text, wordReplacerRules) : v.text
                                // Ranges are computed against v.text (pre-replacer) — see
                                // highlightWithAnnotations' doc comment for why this is an
                                // approximation, not exact, when the word replacer is on.
                                const vAnnRanges = getAnnotationRanges(v.text_tagged, r._textId ?? textId)
                                return (
                                  <span key={v.verse_num} className={`text-[13px] leading-relaxed ${isMatch ? 'text-[rgb(var(--color-text-primary))] font-medium' : 'text-[rgb(var(--color-text-muted))]'}`}>
                                    <span className="font-mono text-[10px] mr-1 opacity-70">{v.verse_num}</span>
                                    {isMatch && effectiveMode(query) === 'strongs'
                                      ? highlightStrongs(vText, strongsMatches[`${r.book_id}:${r.chapter}:${r.verse_num}`] ?? [], parseMultiStrongsQuery(query)?.words ?? [])
                                      : isMatch
                                        ? highlightWithAnnotations(vText, vAnnRanges, wordReplacerEnabled && wordReplacerRules.length > 0 ? applyWordReplacer(query, wordReplacerRules) : query, wordMode)
                                        : highlightWithAnnotations(vText, vAnnRanges, '', wordMode)}
                                  </span>
                                )
                              })}
                            </span>
                          )
                        })() : (
                          // line-clamp-2 (the earlier default) rarely differed visually from full text
                          // for typical one-sentence verse snippets, which made the toggle feel like it
                          // "did nothing" — clamping to a single line makes the two modes clearly
                          // different at a glance.
                          <span className={`flex-1 text-[13px] text-[rgb(var(--color-text-primary))] leading-relaxed pt-0.5 ${showContext ? '' : 'line-clamp-1'}`}>
                            {(() => {
                              const rawText = wordReplacerEnabled && wordReplacerRules.length > 0
                                ? applyWordReplacer(r.text, wordReplacerRules)
                                : r.text
                              if (effectiveMode(query) === 'strongs') {
                                // rawText here too (not r.text) — Strong's results were skipping the
                                // word replacer entirely, so a search for "G5485" still showed "Jesus"
                                // even with the Yeshua replacer rule on. Word indices from
                                // getOccurrences are positional and replacer rules are (in practice)
                                // single-word swaps, so alignment holds.
                                // extraWords: a combined query like "G5485 god" has a plain-word part
                                // too (parseMultiStrongsQuery's `.words`) — that needs highlighting
                                // alongside the Strong's-indexed word(s), not just the latter alone.
                                const parsed = parseMultiStrongsQuery(query)
                                const rawIndices = strongsMatches[`${r.book_id}:${r.chapter}:${r.verse_num}`] ?? []
                                const extraWords = parsed?.words ?? []
                                // Strong's results had NO snippet/windowing at all — unlike "all words"
                                // below, line-clamp-1 clipped from character 0 regardless of where the
                                // tagged word actually landed, so a match late in a long verse (e.g.
                                // 3 Maccabees 6:36, 1 Peter 2:20) was clipped away entirely with the
                                // highlight never visible. getWordWindow (already used elsewhere for this
                                // same purpose) trims to a word window around the match and remaps its
                                // indices — reused here instead of inventing a second windowing scheme.
                                // extraWords aren't remapped (splitStrongsHighlight matches them by text,
                                // not index) — they still highlight correctly as long as they land inside
                                // the window the Strong's match determined.
                                if (!showContext) {
                                  const win = getWordWindow(rawText, rawIndices)
                                  if (win) return highlightStrongs(win.windowText, win.windowMatchIndices, extraWords)
                                }
                                return highlightStrongs(rawText, rawIndices, extraWords)
                              }
                              // Only "all words" mode needs the dynamic-start snippet — "any word" only
                              // needs one match visible (line-clamp already lands on it often enough),
                              // and "phrase" highlights a single contiguous span CSS clamping already handles.
                              const displayText = !showContext && wordMode === 'all'
                                ? buildAllWordsSnippet(rawText, query)
                                : rawText
                              // The highlight query goes through the SAME word-replacer transform as the
                              // text it's matched against — text shows "Yeshua" (replaced), so a query of
                              // literal "jesus" needs to become "Yeshua" too, or it never matches the
                              // (now-replaced) displayed text at all. Applying the identical transform to
                              // both sides keeps them in sync regardless of which wording the user typed.
                              const highlightQuery = wordReplacerEnabled && wordReplacerRules.length > 0
                                ? applyWordReplacer(query, wordReplacerRules)
                                : query
                              // Annotation ranges are only valid against the FULL (unwindowed) rawText —
                              // once buildAllWordsSnippet trims/shifts the string its char offsets no
                              // longer line up, so fall back to plain highlight() for that case.
                              if (displayText !== rawText) return highlight(displayText, highlightQuery, wordMode)
                              const annRanges = getAnnotationRanges(r.text_tagged, r._textId ?? textId)
                              return highlightWithAnnotations(displayText, annRanges, highlightQuery, wordMode)
                            })()}
                          </span>
                        )}
                        <ChevronRight size={13} className="flex-shrink-0 mt-1 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </div>
                  )
                })}
            </div>
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

      {/* Jump-to-book — shared floating trigger/panel widget, see
           FloatingHoverPanel.tsx for the resize/positioning/clipping mechanics.
           Collapsed shape matches FloatingRail.tsx's own idle trigger (thin vertical
           pill, not FloatingHoverPanel's default circle) and sits flush against the
           results panel's right edge — this widget IS a jump rail, so it should read
           as one instead of a generic floating hover-circle. Collapsed content is a
           stack of BookOpen glyphs (this IS a book-jumping rail, and consistent icons
           read more clearly than one icon + a separate dot stack) with generous gap
           between them so they read as distinct marks, not a smear — the count tracks
           how many book sections are jumpable right now (clamped to a sensible 2–4
           range), which also drives the pill's own height instead of a fixed height
           that doesn't reflect what's actually in the results. */}
      {filteredGroups.length > 1 && (effectiveMode(query) === 'text' || effectiveMode(query) === 'strongs') && (() => {
        const railQuery = normalizeBookQuery(railSearch.trim().toLowerCase())
        const railGroups = railQuery ? filteredGroups.filter((g) => g.bookName.toLowerCase().includes(railQuery)) : filteredGroups
        const railIconCount = Math.min(Math.max(filteredGroups.length, 2), 4)
        const railIconSize = 10
        const railIconGap = 8
        const railCollapsedHeight = railIconCount * railIconSize + (railIconCount - 1) * railIconGap + 16
        return (
          <FloatingHoverPanel
            ref={railPanelRef}
            expandedWidth={300}
            expandedHeight={400}
            anchorRightClass="-right-2"
            collapsedWidth={16}
            collapsedHeight={railCollapsedHeight}
            collapsedRadius={8}
            onExpandedChange={handleRailExpandedChange}
            collapsedContent={
              <div className="flex flex-col items-center justify-center" style={{ gap: railIconGap }}>
                {Array.from({ length: railIconCount }).map((_, i) => (
                  <BookOpen key={i} size={railIconSize} className="text-[rgb(var(--color-text-muted))]" />
                ))}
              </div>
            }
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
                    onClick={() => {
                      const idx = headerFlatIndex.get(key)
                      // 'auto' (instant), not 'smooth' — native smooth-scroll's easing/duration
                      // isn't tunable from app code, and the virtualizer re-issues it on every
                      // reconciliation pass as still-unrendered rows' estimated heights settle
                      // (see reconcileScroll below), which read as a slow, restarting scroll
                      // rather than one quick jump.
                      if (idx !== undefined) rowVirtualizer.scrollToIndex(idx, { align: 'start', behavior: 'auto' })
                      railPanelRef.current?.close()
                    }}
                    className="flex items-start gap-2 w-[calc(100%-8px)] mx-1 rounded-shell px-3 py-1.5 text-[12.5px] text-left text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
                  >
                    {textId === 'all' && <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${editionDot}`} />}
                    {/* Wraps to 2 lines instead of truncating — a fixed-width panel plus
                        single-line truncation was cutting off names like "Recognitions,
                        Book 10" to the point of being unreadable. Widening the panel to fit
                        the single longest name outright would make it noticeably bulkier
                        for every OTHER (mostly short) row just to cover a few edge cases;
                        wrapping keeps the panel's width modest while never losing text. */}
                    <span className="flex-1 line-clamp-2 leading-snug">{g.bookName}</span>
                    {textId === 'all' && <span className="text-[9.5px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide flex-shrink-0 mt-0.5">{g.textLabel}</span>}
                  </button>
                )
              })}
            </div>
          </FloatingHoverPanel>
        )
      })()}
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
            onClick={() => {
              onNavigate(ctxMenu.bookId, ctxMenu.chapter, ctxMenu.verse, ctxMenu.textId, highlightForResult({
                book_id: ctxMenu.bookId, chapter: ctxMenu.chapter, verse_num: ctxMenu.verse, text: ctxMenu.text, _textId: ctxMenu.textId,
              }))
              closeCtxMenu()
            }}
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
              if (wordReplacerEnabled && wordReplacerRules.length > 0) text = applyWordReplacer(text, wordReplacerRules)
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
