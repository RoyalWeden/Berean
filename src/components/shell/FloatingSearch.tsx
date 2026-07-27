import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, BookOpen, Hash, BookMarked, StickyNote, Youtube, GitFork, Clock, Terminal, ArrowRight, ChevronDown, Check } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { parseRef, isStrongsRef, getTranslationForBook, bookName, bookChapterVerseLabel, resolveBookToken, normalizeBookName } from '@/lib/parseRef'
import { parseMultiBookQuery } from '@/lib/multiBookSearch'
import { applyFindHighlight, makeSnippet } from '@/lib/highlight'
import { applyWordReplacer, getWordReplacerSearchVariants } from '@/lib/wordReplacer'
import { parseMultiStrongsQuery, searchMultiStrongs } from '@/lib/strongsSearch'
import { decodeEntities } from '@/lib/youtubeSearch'
import { getCommands, filterCommands } from '@/lib/commands'
import ShortcutKeys from './ShortcutKeys'
import type { Book, LexiconEntry, Note } from '@/types'

interface CrossRef {
  bookId: string
  chapter: number
  verse: number
  endVerse: number | null
  votes: number
  text: string
}

// How many result-list lines each density shows
const DENSITY_HEIGHT: Record<'compact' | 'comfortable' | 'spacious', string> = {
  compact:     '18rem',
  comfortable: '30rem',
  spacious:    '44rem',
}
/** Format milliseconds as M:SS or H:MM:SS for transcript timestamp labels. */
function formatTranscriptTs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Fuzzy match: every character of `needle` appears in `haystack` in order (case-insensitive). */
function fuzzyMatch(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()
  let ni = 0
  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (n[ni] === h[hi]) ni++
  }
  return ni === n.length
}

// Sub-text truncation per density
const DENSITY_SUB_LEN: Record<'compact' | 'comfortable' | 'spacious', number> = {
  compact:     80,
  comfortable: 140,
  spacious:    240,
}
// Sub-text line-clamp css class per density
const DENSITY_CLAMP: Record<'compact' | 'comfortable' | 'spacious', string> = {
  compact:     'line-clamp-1',
  comfortable: 'line-clamp-2',
  spacious:    'line-clamp-3',
}

interface VerseResult {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  /** Only set when the result comes from a non-default text */
  sourceTextId?: string
  sourceTextName?: string
}

const TRANSLATION_PREFIXES: Array<[string[], string]> = [
  [['lxx:', 'lxx ', 'septuagint:', 'septuagint ', 'brenton:', 'brenton '], 'lxx'],
  [['enoch:', 'enoch ', '1 enoch:', '1 enoch '], 'enoch'],
  [['jubilees:', 'jubilees '], 'jubilees'],
  [['hermas:', 'hermas '], 'hermas'],
  [['barnabas:', 'barnabas ', 'ep barnabas:', 'epistle of barnabas '], 'ep_barnabas'],
  [['ascension of isaiah:', 'asc isaiah:', 'asc_isaiah '], 'asc_isaiah'],
  [['recognitions:', 'recog_clement ', 'roc:', 'roc '], 'recog_clement'],
  [['apoc elijah:', 'apocalypse of elijah '], 'apoc_elijah'],
  [['t12p:', 'testaments:', 'twelve patriarchs '], 't12p'],
  [['gad the seer:', 'gad seer:', 'words of gad '], 'gad'],
  [['testament of job:', 'test job:', 'tjob '], 't_job'],
  [['1 clement:', '1clement:', '1clem '], '1clement'],
  [['apoc abraham:', 'apocalypse of abraham '], 'apoc_abraham'],
  [['testament of jacob:', 'test jacob:', 'tjac '], 't_jacob'],
]

/** All extra-book text IDs searched automatically in parallel for keyword queries */
const EXTRA_TEXT_IDS: Record<string, string> = {
  enoch:         '1 Enoch',
  jubilees:      'Jubilees',
  lxx:           'LXX',
  hermas:        'Hermas',
  ep_barnabas:   'Barnabas',
  asc_isaiah:    'Asc. Isaiah',
  recog_clement: 'Recog. Clement',
  apoc_elijah:   'Apoc. Elijah',
  t12p:          '12 Patriarchs',
  gad:           'Gad the Seer',
  t_job:         'T. Job',
  '1clement':    '1 Clement',
  apoc_abraham:  'Apoc. Abraham',
  t_jacob:       'T. Jacob',
}

function detectTranslationPrefix(q: string): { textId: string; cleanQuery: string } | null {
  const lower = q.trim().toLowerCase()
  // A space-only prefix (no colon) is ambiguous whenever the book itself is
  // named that way — "jubilees 17", "enoch 5", "hermas 3" are meant as a
  // REFERENCE into that dedicated text, not "search the word '17' within
  // the jubilees translation". If the untouched query already resolves as a
  // real reference on its own, prefer that reading over stripping it down
  // to a query fragment that (as with a bare chapter number) often fails to
  // parse as anything at all. Colon-qualified prefixes ("jubilees:creation")
  // are unambiguous and always meant as a translation-scoped keyword search,
  // so they skip this check.
  if (parseRef(q.trim())) return null
  // Check leading prefix form: "lxx creation", "enoch 1"
  for (const [patterns, id] of TRANSLATION_PREFIXES) {
    for (const pat of patterns) {
      if (lower.startsWith(pat)) {
        return { textId: id, cleanQuery: q.slice(pat.length).trim() }
      }
    }
  }
  // Check trailing qualifier form: "isa 28 lxx", "genesis 1 enoch" (not super common but user reported it)
  const trailingMatch = lower.match(/^(.+)\s+(lxx|enoch|jubilees|septuagint|brenton)$/)
  if (trailingMatch) {
    const qualifier = trailingMatch[2]
    const textId = qualifier === 'septuagint' || qualifier === 'brenton' ? 'lxx' : qualifier
    return { textId, cleanQuery: q.slice(0, q.lastIndexOf(trailingMatch[2])).trim() }
  }
  return null
}

export default function FloatingSearch() {
  const searchOpen = useAppStore((s) => s.searchOpen)
  const searchMode = useAppStore((s) => s.searchMode)
  // 'verses' — set by the Scripture tab's "Search scripture" button — shows
  // only the verse-results section below, reading as a lightweight version of
  // Advanced Search rather than the app-wide mixed search.
  const searchScope = useAppStore((s) => s.searchScope)
  const versesOnly = searchScope === 'verses'
  const closeSearch = useAppStore((s) => s.closeSearch)
  // Narrowed to the one space this reads — see BiblePanel.tsx's identical comment for why.
  const tabs = useAppStore((s) => s.tabs.scripture)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const activateTab = useAppStore((s) => s.activateTab)
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const createTab = useAppStore((s) => s.createTab)
  const addTab = useAppStore((s) => s.addTab)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const defaultBibleTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const openScriptureSearchTab = useAppStore((s) => s.openScriptureSearchTab)
  const openLexiconSearchTab = useAppStore((s) => s.openLexiconSearchTab)
  const openNotesSearchTab = useAppStore((s) => s.openNotesSearchTab)
  const openYouTubeSearchTab = useAppStore((s) => s.openYouTubeSearchTab)
  const floatingSearchDensity = useAppStore((s) => s.floatingSearchDensity)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const recentSearchQueries = useAppStore((s) => s.recentSearchQueries)
  const addRecentSearchQuery = useAppStore((s) => s.addRecentSearchQuery)

  type SearchWordMode = 'all' | 'any' | 'phrase'
  type ScopeFilter = 'all' | 'ot' | 'nt'
  const WORD_MODE_LABELS: Record<SearchWordMode, string> = { all: 'All words', any: 'Any word', phrase: 'Exact phrase' }

  const inputRef = useRef<HTMLInputElement>(null)
  const selectedItemRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [searchWordMode, setSearchWordMode] = useState<SearchWordMode>('all')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [searchTextId, setSearchTextId] = useState(defaultBibleTranslation.toLowerCase())
  const [books, setBooks] = useState<Book[]>([])
  const [verseResults, setVerseResults] = useState<VerseResult[]>([])
  const [crossRefResults, setCrossRefResults] = useState<CrossRef[]>([])
  const [crossRefLoading, setCrossRefLoading] = useState(false)
  const [lexiconResults, setLexiconResults] = useState<LexiconEntry[]>([])
  const [noteResults, setNoteResults] = useState<Note[]>([])
  const [youtubeResults, setYoutubeResults] = useState<Array<{ videoId: string; title: string; channelName: string; snippet?: string; startMs?: number }>>([])
  const openYouTubeVideoInNewTab = useAppStore((s) => s.openYouTubeVideoInNewTab)
  const openYouTubeVideo         = useAppStore((s) => s.openYouTubeVideo)
  // -1 means "nothing selected yet" — no result row is highlighted until the user
  // explicitly arrows through the list OR hovers a row with the mouse. Distinguishes
  // "pressed Enter without selecting anything" (fires the smart destination
  // prediction below, when one exists) from "selected a specific row, then Enter"
  // (always fires that row's own action, unchanged from prior behavior). Reset to
  // -1 on every keystroke — new typing invalidates any prior selection.
  const [selectedIdx, setSelectedIdx] = useState(-1)
  // Word-mode dropdown — was a 3-button segmented control ("all"/"any"/"phrase"
  // always all visible at once); replaced with a single trigger + portaled popover,
  // same pattern as ScriptureSearchView.tsx's sort/context-length dropdowns (portal
  // to document.body with a fixed position computed from the trigger's own rect —
  // an in-flow `absolute` dropdown here would sit inside this modal's own stacking
  // context and risk the same "renders behind other content" bug that pattern was
  // introduced to fix there).
  const [wordModeMenuOpen, setWordModeMenuOpen] = useState(false)
  const [wordModeMenuPos, setWordModeMenuPos] = useState<{ left: number; top: number } | null>(null)
  const wordModeTriggerRef = useRef<HTMLButtonElement>(null)
  const wordModeMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!wordModeMenuOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (wordModeTriggerRef.current?.contains(t)) return
      if (wordModeMenuRef.current?.contains(t)) return
      setWordModeMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [wordModeMenuOpen])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const crossRefDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped once per runSearch invocation; every async result-setter below checks its
  // own captured generation against this before writing state, so a slow-resolving
  // batch from an earlier keystroke can never clobber a faster-resolving later one.
  const searchGenRef = useRef(0)

  useEffect(() => {
    if (searchOpen) {
      const tid = defaultBibleTranslation.toLowerCase()
      setSearchTextId(tid)
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setVerseResults([])
      setCrossRefResults([])
      setLexiconResults([])
      setNoteResults([])
      setYoutubeResults([])
      setSelectedIdx(-1)
    }
  }, [searchOpen, defaultBibleTranslation])

  // Reload books whenever searchTextId or open state changes
  useEffect(() => {
    if (searchOpen) {
      window.bible.getBooks(searchTextId)
        .then((raw) => setBooks(raw.map((b) => ({ ...b, name: normalizeBookName(b.name), short_name: normalizeBookName(b.short_name) }))))
        .catch(() => {})
    }
  }, [searchOpen, searchTextId])

  // Derived from query: strip trailing/leading translation qualifier. Memoized (keyed only on
  // `query`) because parseRef/resolveBookToken aren't free — resolveBookToken's misspelling
  // fallback runs a Levenshtein comparison against every book name — and this used to get
  // recomputed from scratch up to 3 times per keystroke (once here in the render body, once
  // more in the cross-ref effect below, and again inside handleInput), compounding into
  // noticeable input lag on some keystrokes.
  const detected = useMemo(() => (query.trim() ? detectTranslationPrefix(query) : null), [query])
  const cleanQuery = detected ? detected.cleanQuery : query
  // Recognitions of Clement / Shepherd of Hermas get their own richer grammar first
  // (book-numbered/section-numbered addressing parseRef's own regex can't express —
  // see multiBookSearch.ts) — falls through to the general-purpose parseRef for
  // everything else, including a remainder multiBookSearch didn't recognize.
  const parsedRef = useMemo(
    () => (cleanQuery.trim() ? (parseMultiBookQuery(cleanQuery) ?? parseRef(cleanQuery)) : null),
    [cleanQuery]
  )
  const isStrongs = isStrongsRef(query)
  // Render-scope mirror of the same check `runSearch`'s debounced callback does — needed
  // here too so the smart destination-prediction logic (below) can exclude Strong's-number
  // combinations from prediction the same way it excludes bare Strong's numbers and refs.
  const multiStrongs = useMemo(() => parseMultiStrongsQuery(cleanQuery), [cleanQuery])
  // Only meaningful once parsedRef has already failed to match (see the bare-book-name
  // fallback below) — computed here too so it shares the same memoization key as parsedRef
  // instead of re-running resolveBookToken's Levenshtein scan again inline during render.
  const bareBookId = useMemo(
    () => (!parsedRef && !/\d/.test(cleanQuery) ? resolveBookToken(cleanQuery) : null),
    [cleanQuery, parsedRef]
  )

  // Bidirectional word-replacer search: return every variant query to run and merge —
  // the original typed text plus, for any matching rule, the query with the matched
  // word/phrase substituted for its counterpart (e.g. typed "yeshua" also searches
  // "jesus", since the DB still stores the original word). Each variant is run as
  // its OWN independent window.bible.searchText call below (see runSearch) — NOT
  // encoded as a single "term1 OR term2" query string. electron/ipc/bible.ts's FTS
  // query builder deliberately treats every word (including a literal "OR") as a
  // required token, so that used to silently produce an impossible query requiring
  // the literal word "or" too — confirmed broken (this was the actual bug report).
  function expandForSearch(q: string): string[] {
    const trimmed = q.trim()
    return wordReplacerEnabled ? getWordReplacerSearchVariants(trimmed, wordReplacerRules) : [trimmed]
  }

  // Debounced FTS search. Split into two phases so the search *feels* instant:
  // a small "fast" phase (primary-translation verses + notes, ~2 IPC calls) renders
  // first, then a "slow" phase (12+ extra apocryphal/pseudepigrapha texts + YouTube)
  // is only dispatched afterward and merges in once ready. Previously all ~16 IPC
  // calls were fired in one batch — Electron's IPC is a single channel into one
  // main-process event loop, so even though the renderer dispatched them "in
  // parallel", the main process still executed all of the underlying synchronous
  // better-sqlite3 queries one after another before ANY of them resolved, so the
  // rarely-relevant extra-book searches were silently blocking the primary,
  // highest-value results too. A `searchGenRef` generation counter guards every
  // async result-setter so a slow-resolving batch from an earlier keystroke can
  // never clobber state a faster, later keystroke already set (previously
  // unguarded — a real stale-response race on fast typing).
  const runSearch = useCallback((q: string, tid: string, mode: SearchWordMode = 'all') => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const trimmed = q.trim()
      const gen = ++searchGenRef.current

      if (!trimmed) {
        setVerseResults([])
        setLexiconResults([])
        setNoteResults([])
        setYoutubeResults([])
        return
      }

      if (isStrongsRef(trimmed)) {
        // Bare single Strong's number — jump straight to its lexicon entry, same as before.
        setVerseResults([]); setNoteResults([]); setYoutubeResults([])
        try {
          const entry = await window.lexicon.getEntry(trimmed)
          if (gen !== searchGenRef.current) return
          setLexiconResults(entry ? [entry] : [])
        } catch {
          if (gen === searchGenRef.current) setLexiconResults([])
        }
        return
      }

      // A combination of Strong's numbers and/or a Strong's number plus plain word(s)
      // ("G5485 G54", "G5485 jacob") — not a bare single number, so there's no single
      // lexicon entry to jump to. Runs the same AND'd occurrence search Advanced Scripture
      // Search uses (strongsSearch.ts) and shows matching verses instead.
      const multiStrongs = parseMultiStrongsQuery(trimmed)
      if (multiStrongs) {
        setLexiconResults([]); setNoteResults([]); setYoutubeResults([])
        try {
          const found = await searchMultiStrongs(multiStrongs, window.lexicon.getOccurrences)
          if (gen !== searchGenRef.current) return
          setVerseResults(found.map((o) => ({ book_id: o.book_id, chapter: o.chapter, verse_num: o.verse_num, text: o.text })))
        } catch {
          if (gen === searchGenRef.current) setVerseResults([])
        }
        return
      }

      if (parseMultiBookQuery(trimmed) ?? parseRef(trimmed)) {
        setVerseResults([]); setLexiconResults([]); setNoteResults([]); setYoutubeResults([])
        return
      }

      if (trimmed.length < 3) {
        setVerseResults([]); setLexiconResults([]); setNoteResults([]); setYoutubeResults([])
        return
      }

      setLexiconResults([])
      const isDefaultSearch = !Object.keys(EXTRA_TEXT_IDS).includes(tid)
      const variants = expandForSearch(trimmed)
      const variantSearches = variants.map((variant) =>
        window.bible.searchText(variant, tid, mode)
          .then((rows) => rows as unknown as VerseResult[])
          .catch(() => [] as VerseResult[])
      )

      try {
        // ── Fast phase — dispatched and awaited first ──────────────────────
        const [notes, ...variantResults] = await Promise.allSettled([
          window.notes.searchNotes(trimmed, 5, searchWordMode),
          ...variantSearches,
        ])
        if (gen !== searchGenRef.current) return

        // Merge + dedupe every variant's results (bidirectional word-replacer search
        // can return the same verse from more than one variant query).
        const seenVerse = new Set<string>()
        const primaryVerse: VerseResult[] = []
        for (const r of variantResults) {
          if (r.status !== 'fulfilled') continue
          for (const row of r.value as unknown as VerseResult[]) {
            const key = `${row.book_id}|${row.chapter}|${row.verse_num}`
            if (seenVerse.has(key)) continue
            seenVerse.add(key)
            primaryVerse.push(row)
          }
        }
        setVerseResults(primaryVerse)
        setNoteResults(notes.status === 'fulfilled' ? notes.value : [])

        // ── Slow phase — only dispatched now, so it can never delay the above ──
        const extraSearches = isDefaultSearch
          ? Object.entries(EXTRA_TEXT_IDS).map(([extraId, label]) =>
              window.bible.searchText(trimmed, extraId, mode)
                .then((rows) =>
                  (rows as unknown as VerseResult[]).slice(0, 3).map((r) => ({
                    ...r,
                    sourceTextId: extraId,
                    sourceTextName: label,
                  }))
                )
                .catch(() => [] as VerseResult[])
            )
          : []
        const ytSearch = (window.youtube && typeof window.youtube.searchVideos === 'function')
          ? window.youtube.searchVideos(trimmed, 5).catch(() => [])
          : Promise.resolve([])
        // Request up to 3 transcript segments per video for rich results
        const ytTranscriptSearch = (window.youtube && typeof window.youtube.searchTranscripts === 'function')
          ? window.youtube.searchTranscripts(trimmed, 5, 3).catch(() => [])
          : Promise.resolve([])

        const [ytVideos, ytTranscripts, ...extraAll] = await Promise.allSettled([
          ytSearch,
          ytTranscriptSearch,
          ...extraSearches,
        ])
        if (gen !== searchGenRef.current) return

        const extraVerses: VerseResult[] = extraAll.flatMap((r) => r.status === 'fulfilled' ? r.value : [])
        if (extraVerses.length) setVerseResults((prev) => [...prev, ...extraVerses])

        // Build merged YouTube results:
        // • Title hits appear first (each with best-matching snippet if a transcript hit exists)
        // • Transcript-only hits follow
        // • When perVideoLimit > 1, additional timestamp entries for the same video appear
        //   after their parent entry (labelled with the timestamp).
        const titleHits = ytVideos.status === 'fulfilled'
          ? (ytVideos.value as Array<{ videoId: string; title: string; channelName: string }>) : []
        const transcriptHits = ytTranscripts.status === 'fulfilled'
          ? (ytTranscripts.value as Array<{ videoId: string; snippet: string; startMs: number; title: string; channelName: string }>) : []
        // Group transcript hits by videoId for lookup
        const transcriptByVideo = new Map<string, Array<{ snippet: string; startMs: number }>>()
        for (const t of transcriptHits) {
          const arr = transcriptByVideo.get(t.videoId) ?? []
          arr.push({ snippet: t.snippet, startMs: t.startMs })
          transcriptByVideo.set(t.videoId, arr)
        }
        const seen = new Set<string>()
        const merged: Array<{ videoId: string; title: string; channelName: string; snippet?: string; startMs?: number }> = []
        for (const v of titleHits) {
          seen.add(v.videoId)
          const segs = transcriptByVideo.get(v.videoId) ?? []
          merged.push({ ...v, snippet: segs[0]?.snippet, startMs: segs[0]?.startMs })
          // Additional timestamp entries for this video (beyond the first)
          for (let i = 1; i < segs.length; i++) {
            merged.push({ videoId: v.videoId, title: v.title, channelName: v.channelName, snippet: segs[i].snippet, startMs: segs[i].startMs })
          }
        }
        // Transcript-only matches
        for (const t of transcriptHits) {
          if (seen.has(t.videoId)) continue
          seen.add(t.videoId)
          const segs = transcriptByVideo.get(t.videoId) ?? []
          for (const seg of segs) {
            merged.push({ videoId: t.videoId, title: t.title, channelName: t.channelName, snippet: seg.snippet, startMs: seg.startMs })
          }
        }
        setYoutubeResults(merged.slice(0, 10))
      } catch (err) {
      }
    }, 120)
  }, [])

  // Load cross-references when the query is a verse ref with a verse number
  useEffect(() => {
    if (!searchOpen) return
    const ref = parsedRef
    if (!ref?.verse) { setCrossRefResults([]); return }
    if (crossRefDebounceRef.current) clearTimeout(crossRefDebounceRef.current)
    setCrossRefLoading(true)
    crossRefDebounceRef.current = setTimeout(async () => {
      try {
        const result = await window.crossrefs.getForVerse(ref.bookId, ref.chapter, ref.verse!)
        setCrossRefResults(result?.refs ?? [])
      } catch {
        setCrossRefResults([])
      } finally {
        setCrossRefLoading(false)
      }
    }, 250)
  }, [parsedRef, searchOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleInput(val: string) {
    setQuery(val)
    setSelectedIdx(-1)
    // Command mode (">") — no reference/keyword lookup to run at all, the
    // `>`-prefixed text is matched against the command list client-side.
    if (val.trim().startsWith('>')) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setVerseResults([]); setLexiconResults([]); setNoteResults([]); setYoutubeResults([])
      return
    }
    const det = val.trim() ? detectTranslationPrefix(val) : null
    const tid = det ? det.textId : defaultBibleTranslation.toLowerCase()
    if (tid !== searchTextId) {
      setSearchTextId(tid)
      setVerseResults([])
    }
    const q = det ? det.cleanQuery : val
    runSearch(q, tid, searchWordMode)
  }

  function handleWordModeChange(mode: SearchWordMode) {
    setSearchWordMode(mode)
    const det = query.trim() ? detectTranslationPrefix(query) : null
    const tid = det ? det.textId : searchTextId
    const q = det ? det.cleanQuery : query
    if (q.trim()) runSearch(q, tid, mode)
  }

  function navigate(bookId: string, chapter: number, targetVerse?: number, endVerse?: number, translationOverride?: string, endChapter?: number) {
    const bookNames: Record<string, string> = {}
    books.forEach((b) => { bookNames[b.id] = b.name })
    const bookLabel = bookNames[bookId] ?? bookId
    const chapterLabel = endChapter && endChapter > chapter
      ? `${bookLabel} ${chapter}–${endChapter}`
      : `${bookLabel} ${chapter}`
    const translation = (translationOverride ?? searchTextId).toUpperCase()

    const title = targetVerse ? `${chapterLabel}:${targetVerse}` : chapterLabel

    // In 'current' mode, reuse the active (or first) bible tab. If none exists,
    // fall through to creating a new tab — opening "in current tab" when there is
    // no current tab should still open the verse, not do nothing.
    const targetTab = searchMode === 'current'
      ? (() => {
          const activeId = useAppStore.getState().activeTabId.scripture
          return activeId
            ? tabs.find((t) => t.id === activeId)
            : tabs.find((t) => t.type === 'bible')
        })()
      : undefined

    if (targetTab) {
      // Navigating to a verse exits the advanced-search view if the tab was in it.
      // Field set mirrors BiblePanel.tsx's own onNavigate (the prop ScriptureSearchView's
      // Enter/click uses, which scrolls to the verse correctly) exactly — this one used to
      // omit the targetVerseQuery/WordMode/StrongsWords/StrongsExtraWords keys entirely
      // rather than explicitly clearing them, which left a PREVIOUS search's stale
      // highlight fields in place on the merged tab state instead of clearing them for
      // this new jump.
      updateTabState('scripture', targetTab.id, {
        bookId, chapter, endChapter, scrollPosition: 0, targetVerse, endVerse, translation, searchMode: false,
        targetVerseQuery: undefined, targetVerseWordMode: undefined,
        targetVerseStrongsWords: undefined, targetVerseStrongsExtraWords: undefined,
        noteBack: null,
      })
      renameTab('scripture', targetTab.id, title)
      // Without this, jumping to a tab that wasn't already the active scripture tab left the
      // state update applied to a tab the user wasn't looking at — the visible tab never
      // scrolled anywhere.
      activateTab(targetTab)
    } else {
      // 'new' mode, or 'current' mode with no existing bible tab
      const id = `bible-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      addTab({
        id,
        spaceId: 'scripture',
        type: 'bible',
        title,
        state: { bookId, chapter, endChapter, translation, showStrongs: false, scrollPosition: 0, targetVerse, endVerse },
      })
    }
    setActiveSpace('scripture')
    closeSearch()
  }

  function goToLexicon(strongsNum: string) {
    if (searchMode === 'new') {
      createTab('lexicon')
    } else {
      ensureTab('lexicon')
    }
    openLexiconEntry(strongsNum)
    setActiveSpace('lexicon')
    closeSearch()
  }

  // Build result list for keyboard nav
  const results: Array<{
    type: 'ref' | 'verse' | 'lexicon' | 'note' | 'youtube' | 'crossref' | 'command'
    label: string
    sub: string
    action: () => void
  }> = []

  // Command mode (">") — Obsidian's own convention: search/run ACTIONS
  // instead of references, notes, or keywords. Short-circuits the rest of
  // this function entirely (parsedRef will always be null for a
  // ">"-prefixed query anyway, so nothing below would match regardless).
  const isCommandMode = query.trim().startsWith('>')
  if (isCommandMode) {
    const commandQuery = query.trim().slice(1)
    for (const cmd of filterCommands(getCommands(), commandQuery)) {
      results.push({
        type: 'command',
        label: cmd.label,
        sub: cmd.shortcut ?? '',
        action: () => { cmd.run(); closeSearch() },
      })
    }
  }

  if (!isCommandMode && parsedRef) {
    const chapterDisplay = parsedRef.endChapter && parsedRef.endChapter > parsedRef.chapter
      ? `${parsedRef.chapter}–${parsedRef.endChapter}`
      : parsedRef.chapter
    // Always the full canonical name (bookName(), from parseRef.ts's own book table) rather
    // than the DB-fetched `books` list's `.name` field — that fetch can still be in flight
    // when the user starts typing, or (for non-canonical/Pseudepigrapha books) might not be
    // in `books` at all depending on which text is currently selected, both of which
    // previously fell back to showing the bare 3-letter bookId ("GEN") instead of a name.
    const refName = bookName(parsedRef.bookId)
    const refSep = /Book \d+$/.test(refName) ? ', ' : ' '
    const label = `${refName}${refSep}${chapterDisplay}${parsedRef.verse ? `:${parsedRef.verse}` : ''}`
    const subLabel = detected
      ? `${parsedRef.verse ? `Go to verse ${parsedRef.verse}` : 'Go to chapter'} in ${detected.textId.toUpperCase()}`
      : parsedRef.verse ? `Go to verse ${parsedRef.verse}` : 'Go to chapter'
    results.push({
      type: 'ref',
      label,
      sub: subLabel,
      action: () => {
        addRecentSearchQuery(query.trim())
        navigate(
          parsedRef.bookId,
          parsedRef.chapter,
          parsedRef.verse,
          parsedRef.endVerse,
          getTranslationForBook(parsedRef.bookId) ?? undefined,
          parsedRef.endChapter,
        )
      },
    })
  } else if (!isCommandMode && cleanQuery.trim()) {
    // Bare book name, no chapter/verse ("Genesis", "Romans", "1 Kings") — parseRef's own
    // regex requires a trailing chapter number to match at all, so a plain book name never
    // produces a parsedRef. Offer chapter 1 of that book directly rather than requiring the
    // user to also type "1" themselves. Guarded so it only fires for a token that resolves
    // to a REAL book (not just any random text) and doesn't already look like a reference
    // with digits in it (that case is parsedRef's job, or genuinely didn't parse for a
    // different reason — e.g. an out-of-range chapter — and shouldn't silently become ch.1).
    if (bareBookId) {
      const label = bookChapterVerseLabel(bareBookId, 1)
      results.push({
        type: 'ref',
        label,
        sub: 'Go to chapter',
        action: () => {
          addRecentSearchQuery(query.trim())
          navigate(bareBookId, 1, undefined, undefined, getTranslationForBook(bareBookId) ?? undefined, undefined)
        },
      })
    }
  }

  // Cross-references — shown when query is a verse ref with a verse number
  if (parsedRef?.verse && crossRefResults.length > 0) {
    for (const cr of crossRefResults.slice(0, 5)) {
      const ref = cr.endVerse
        ? `${bookChapterVerseLabel(cr.bookId, cr.chapter, cr.verse)}–${cr.endVerse}`
        : bookChapterVerseLabel(cr.bookId, cr.chapter, cr.verse)
      const strength = Math.max(0, Math.min(Math.ceil(cr.votes / 3), 5))
      const dots = '●'.repeat(strength) + '○'.repeat(5 - strength)
      results.push({
        type: 'crossref',
        label: ref,
        sub: cr.text ? `${dots}  ${cr.text.slice(0, 100)}` : dots,
        action: () => {
          addRecentSearchQuery(query.trim())
          navigate(cr.bookId, cr.chapter, cr.verse)
        },
      })
    }
  }

  if (!versesOnly) {
    for (const entry of lexiconResults) {
      results.push({
        type: 'lexicon',
        label: `${entry.strongsNum}  ${entry.lemma}  (${entry.transliteration})`,
        sub: entry.gloss,
        action: () => { addRecentSearchQuery(query.trim()); goToLexicon(entry.strongsNum) },
      })
    }
  }

  const subLen = DENSITY_SUB_LEN[floatingSearchDensity]
  const wr = (t: string) => wordReplacerEnabled ? applyWordReplacer(t, wordReplacerRules) : t

  // Scripture verses first — most relevant for a Bible-study keyword search.
  // Apply scope filter (OT/NT) to verse results.
  const scopedVerseResults = scopeFilter === 'all'
    ? verseResults
    : verseResults.filter((v) => {
        const bk = books.find((b) => b.id === v.book_id)
        if (!bk) return true
        return scopeFilter === 'ot' ? bk.testament === 'OT' : bk.testament === 'NT'
      })

  // Smart destination prediction — guesses which single space (Scripture/Notes/YouTube)
  // a plain keyword query is most likely aimed at, from the live result counts each
  // space's search already produced (no separate intent-classifier exists anywhere in
  // the app; this reuses data the component was already fetching). Deliberately scoped
  // to plain keyword queries only — a parsed reference, Strong's number/combination, or
  // command-mode query already has an unambiguous, correct top result, and changing
  // Enter's behavior for those would regress the "type a ref, hit Enter, jump there" flow.
  // Lexicon is excluded from the signal: lexicon results only ever populate via Strong's-
  // number syntax today, never plain-keyword search, so there's no live lexicon count to
  // compare against here. Scripture wins ties (the app's home space); no prediction at
  // all when every count is 0 (nothing confident to suggest).
  const predictedSpace: 'scripture' | 'notes' | 'youtube' | null = (() => {
    if (parsedRef || isStrongs || multiStrongs || query.trim().startsWith('>') || cleanQuery.trim().length < 3) return null
    const counts: Array<['scripture' | 'notes' | 'youtube', number]> = [
      ['scripture', scopedVerseResults.length],
      ['notes', versesOnly ? 0 : noteResults.length],
      ['youtube', versesOnly ? 0 : youtubeResults.length],
    ]
    const max = Math.max(...counts.map(([, n]) => n))
    if (max === 0) return null
    return counts.find(([, n]) => n === max)![0]
  })()

  for (const v of scopedVerseResults.slice(0, 12)) {
    const book = books.find((b) => b.id === v.book_id)
    const sourceLabel = v.sourceTextName ? ` · ${v.sourceTextName}` : ''
    const rawText = wr(v.text)
    const subText = makeSnippet(rawText, cleanQuery, subLen, searchWordMode)
    results.push({
      type: 'verse',
      label: `${book?.short_name ?? v.book_id} ${v.chapter}:${v.verse_num}${sourceLabel}`,
      sub: subText,
      action: () => { addRecentSearchQuery(query.trim()); navigate(v.book_id, v.chapter, v.verse_num, undefined, v.sourceTextId) },
    })
  }

  // Then the user's notes.
  if (!versesOnly) {
    for (const note of noteResults.slice(0, 4)) {
      const rawSnippet = note.content
        .replace(/^---[\s\S]*?---\n?/, '')
        .replace(/[#*`_>~\[\]]/g, '')
        .replace(/\n/g, ' ')
        .trim()
      const snippet = wr(rawSnippet)
      results.push({
        type: 'note' as const,
        label: wr(note.title || 'Untitled note'),
        sub: snippet ? makeSnippet(snippet, cleanQuery, subLen, searchWordMode) : 'Empty note',
        action: () => {
          addRecentSearchQuery(query.trim())
          ensureTab('note')
          setActiveSpace('notes')
          requestOpenNote(note.id)
          closeSearch()
        },
      })
    }
  }

  // YouTube videos — transcript hits show the matching line + timestamp as the sub-label.
  // Multiple entries may exist for the same video when perVideoLimit > 1.
  for (const vid of versesOnly ? [] : youtubeResults) {
    const hasTimestamp = vid.startMs !== undefined && vid.startMs !== null
    const tsLabel = hasTimestamp ? formatTranscriptTs(vid.startMs!) : null
    results.push({
      type: 'youtube' as const,
      label: tsLabel ? `${vid.title} — ${tsLabel}` : vid.title,
      sub: vid.snippet ? `”${decodeEntities(vid.snippet)}”` : vid.channelName,
      action: () => {
        addRecentSearchQuery(query.trim())
        if (hasTimestamp) {
          openYouTubeVideo(vid.videoId, vid.startMs! / 1000)
        } else {
          openYouTubeVideoInNewTab(vid.videoId)
        }
        setActiveSpace('youtube')
        closeSearch()
      },
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => {
        // From "nothing selected" (-1), land on the first row rather than the second.
        const next = i < 0 ? 0 : Math.min(i + 1, results.length - 1)
        setTimeout(() => selectedItemRef.current?.scrollIntoView({ block: 'nearest' }), 0)
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => {
        const prev = i < 0 ? 0 : Math.max(i - 1, 0)
        setTimeout(() => selectedItemRef.current?.scrollIntoView({ block: 'nearest' }), 0)
        return prev
      })
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      closeSearch()
      openScriptureSearchTab(query.trim())
    } else if (e.key === 'Enter' && selectedIdx < 0 && predictedSpace) {
      // Enter with nothing selected (no arrowing, no mouse hover) — jump straight to
      // the predicted destination's own search tab with the current query, rather
      // than the somewhat arbitrary first item in a merged results list. Selecting a
      // row (arrow keys or hovering it with the cursor) opts back into the old
      // "activate that specific row" behavior below.
      e.preventDefault()
      closeSearch()
      if (predictedSpace === 'scripture') openScriptureSearchTab(query.trim())
      else if (predictedSpace === 'notes') openNotesSearchTab(query.trim())
      else openYouTubeSearchTab(query.trim())
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      results[Math.max(0, selectedIdx)]?.action()
    }
  }

  const showHint = !query.trim()

  return (
    <Dialog.Root open={searchOpen} onOpenChange={(open) => !open && closeSearch()}>
      <AnimatePresence>
        {searchOpen && (
      <Dialog.Portal forceMount>
        <Dialog.Overlay asChild forceMount>
          {/* Explicit onClick rather than relying solely on Radix's built-in outside-click
              dismissal (onOpenChange above): Dialog.Content here is `asChild forceMount` wrapping
              a motion.div inside AnimatePresence, and Radix's onPointerDownOutside detection can
              misfire with animated/portal-mounted content — with no manual fallback (the pattern
              used everywhere else in this codebase for outside-click, e.g. BookChapterPicker.tsx),
              clicking the overlay sometimes did nothing. */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-50"
            style={{ backdropFilter: 'blur(4px)' }}
            onClick={closeSearch}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        </Dialog.Overlay>
        <Dialog.Content
          aria-describedby={undefined}
          asChild
          forceMount
        >
          <motion.div
            className="
              fixed left-1/2 top-[12%]
              z-50 w-full max-w-2xl
              glass-panel-modal rounded-shell-lg overflow-hidden
            "
            initial={{ opacity: 0, scale: 0.96, x: '-50%', y: -8 }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, scale: 0.96, x: '-50%', y: -8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
          <Dialog.Title className="sr-only">Search</Dialog.Title>

          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgb(var(--color-surface-4))]">
            <Search size={18} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            {/* Ghost-text destination hint (Safari/Spotlight-style) — an invisible spacer
                spanning the already-typed text, so the actual suggestion label starts
                exactly at the caret, sitting behind the real <input> (which has a
                transparent background so its own typed text renders on top, and the
                ghost label shows through in the space after it). Both this div and the
                input below must share identical font/size/padding for the alignment to
                hold — both already use text-sm with no extra padding on either side. */}
            <div className="relative flex-1 min-w-0">
              <div aria-hidden className="absolute inset-0 flex items-center text-sm pointer-events-none whitespace-pre overflow-hidden">
                <span className="invisible">{query}</span>
                {predictedSpace && selectedIdx < 0 && (
                  <span className="flex items-center gap-1 ml-1 flex-shrink-0 opacity-60">
                    <span className="text-[rgb(var(--color-text-muted))]">
                      → {predictedSpace === 'scripture' ? 'Scripture' : predictedSpace === 'notes' ? 'Notes' : 'YouTube'}
                    </span>
                    <ShortcutKeys keys="↵" />
                  </span>
                )}
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Gen 1:1 · Exodus 20 · in the beginning..."
                className="
                  relative w-full bg-transparent text-[rgb(var(--color-text-primary))]
                  placeholder:text-[rgb(var(--color-text-muted))] text-sm outline-none
                "
              />
            </div>
            {crossRefLoading && (
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] animate-pulse flex-shrink-0">…</span>
            )}
            {isStrongs && (
              <span className="text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] px-1.5 py-0.5 rounded">
                Strong's
              </span>
            )}
            {/* Scope chips — visible when doing a text keyword search */}
            {!parsedRef && !isStrongs && query.trim().length >= 2 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {(['all', 'ot', 'nt'] as ScopeFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScopeFilter(s)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                      scopeFilter === s
                        ? 'bg-[rgb(var(--color-accent))]/20 border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]'
                        : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'
                    }`}
                  >
                    {s === 'all' ? 'All' : s.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {/* Word mode dropdown — moved here (right-aligned in the input row, where the
                user is actually typing) from the footer, so it's immediately next to the
                query instead of below a whole results list's worth of scroll distance.
                Was a 3-button segmented control always showing all three options at once;
                now a single trigger + popover, matching the app's other refined dropdowns
                (BookChapterPicker's trigger styling, ScriptureSearchView's sort/context
                menus' portal pattern). */}
            <button
              ref={wordModeTriggerRef}
              onClick={() => {
                if (!wordModeMenuOpen) { const r = wordModeTriggerRef.current?.getBoundingClientRect(); if (r) setWordModeMenuPos({ left: r.right - 130, top: r.bottom + 4 }) }
                setWordModeMenuOpen((v) => !v)
              }}
              title="Word matching"
              className="flex items-center gap-1 rounded-md border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] px-1.5 py-0.5 text-[10px] font-medium text-[rgb(var(--color-text-secondary))] hover:border-[rgb(var(--color-accent))/50] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
            >
              {WORD_MODE_LABELS[searchWordMode]}
              <ChevronDown size={9} className={`transition-transform ${wordModeMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {wordModeMenuOpen && wordModeMenuPos && createPortal(
              <div
                ref={wordModeMenuRef}
                // pointerEvents: 'auto' is required here — Radix's Dialog (this whole search
                // bar is a Dialog.Root) sets `pointer-events: none` on <body> while modal-open
                // so only ITS OWN portaled content stays interactive; this dropdown is a
                // SEPARATE portal appended directly to document.body (a sibling to Radix's
                // own portal, not inside it), so without overriding it back to 'auto' here it
                // inherited that body-level lock — clicks passed straight through it to
                // whatever result row sat behind it (reported as "cursor going through it").
                style={{ position: 'fixed', left: wordModeMenuPos.left, top: wordModeMenuPos.top, zIndex: 9999, pointerEvents: 'auto' }}
                className="min-w-[130px] rounded-shell context-menu overflow-hidden py-1"
              >
                {(['all', 'any', 'phrase'] as SearchWordMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { handleWordModeChange(m); setWordModeMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                  >
                    <span className="flex-1">{WORD_MODE_LABELS[m]}</span>
                    {searchWordMode === m && <Check size={12} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div
              className="overflow-y-auto py-1"
              // Cap to the density preference, but never taller than the space between the
              // modal's top offset (12vh) and the bottom of the viewport, minus the input
              // header + footer chrome (~7rem). Keeps the modal fully on-screen and scrolls.
              style={{ maxHeight: `min(${DENSITY_HEIGHT[floatingSearchDensity]}, calc(88vh - 7rem))` }}
            >
              {results.map((r, i) => {
                // Only highlight matches on verse/note sub-text, not ref labels
                const highlightQ = (r.type === 'verse' || r.type === 'note' || r.type === 'youtube') ? cleanQuery : ''
                const isSelected = i === selectedIdx
                const sharedStyle = isSelected ? {
                  backgroundColor: 'rgb(var(--color-accent) / 0.18)',
                  borderLeft: '2px solid rgb(var(--color-accent))',
                  paddingLeft: '14px',
                } : { borderLeft: '2px solid transparent', paddingLeft: '14px' }

                return (
                  <button
                    key={i}
                    ref={i === selectedIdx ? selectedItemRef : undefined}
                    onClick={r.action}
                    // Moving the mouse over a row selects it too (not just arrow keys) — so
                    // Enter after a hover activates that specific row, consistent with arrow
                    // navigation, rather than only ever falling back to the smart-prediction
                    // jump once the cursor has clearly indicated an actual row.
                    onMouseEnter={() => setSelectedIdx(i)}
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer hover:bg-[rgb(var(--color-surface-3))]"
                    style={sharedStyle}
                  >
                    <span className="flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))]">
                      {r.type === 'ref' ? <BookOpen size={14} /> : r.type === 'lexicon' ? <BookMarked size={14} /> : r.type === 'note' ? <StickyNote size={14} /> : r.type === 'youtube' ? <Youtube size={14} className="text-red-400" /> : r.type === 'crossref' ? <GitFork size={14} className="text-[rgb(var(--color-accent))]" /> : r.type === 'command' ? <Terminal size={14} className="text-[rgb(var(--color-accent))]" /> : <Hash size={14} />}
                    </span>
                    <span className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] block">
                          {r.label}
                        </span>
                        {r.type !== 'command' && (
                          <span className={`text-xs text-[rgb(var(--color-text-muted))] block whitespace-normal ${DENSITY_CLAMP[floatingSearchDensity]}`}>
                            {highlightQ ? applyFindHighlight(r.sub, highlightQ, searchWordMode) : r.sub}
                          </span>
                        )}
                      </span>
                      {r.type === 'command' && r.sub && (
                        <ShortcutKeys keys={r.sub} className="flex-shrink-0" />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Hint when empty — show recent queries if available */}
          {showHint && (
            recentSearchQueries.length > 0 ? (
              <div
                className="overflow-y-auto py-1"
                style={{ maxHeight: `min(${DENSITY_HEIGHT[floatingSearchDensity]}, calc(88vh - 7rem))` }}
              >
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] font-semibold">
                  Recent
                </div>
                {recentSearchQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(q)
                      setSelectedIdx(-1)
                      const det = q.trim() ? detectTranslationPrefix(q) : null
                      const tid = det ? det.textId : searchTextId
                      runSearch(det ? det.cleanQuery : q, tid, searchWordMode)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
                  >
                    <Clock size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                    <span className="text-sm text-[rgb(var(--color-text-secondary))]">{q}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-4 py-4 text-center text-xs text-[rgb(var(--color-text-muted))]">
                Try{' '}
                <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">Gen 1:1</span>
                {' · '}
                <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">Exodus 20</span>
                {' · '}
                <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">in the beginning</span>
                {' · '}
                <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">&gt; toggle strongs</span>
              </div>
            )
          )}

          {/* Footer */}
          <div className="px-4 py-2 border-t border-[rgb(var(--color-surface-4))] flex items-center gap-3 text-xs text-[rgb(var(--color-text-muted))]">
            <span className="inline-flex items-center gap-1"><ShortcutKeys keys="↑↓" /> Navigate</span>
            <span className="inline-flex items-center gap-1"><ShortcutKeys keys="↵" /> Open</span>
            <div className="flex-1" />
            {!isCommandMode && (
              <div className="flex items-center gap-1.5">
                {/* Advanced Scripture search — previously its own accent-colored CTA pill
                    with a Search icon; restyled to match the plain "↑↓ Navigate"/"↵ Open"
                    hint labels at the left edge of this same footer (shortcut keycap + text,
                    muted color, no icon) rather than standing out as a visually distinct
                    button — the icon didn't fit that minimal language, so it's dropped
                    rather than swapped for another one. Still a real clickable action (unlike
                    the inert hint spans), so it keeps a hover color shift for affordance.
                    Works with or without a typed query (opens blank if empty). */}
                <button
                  onClick={() => { closeSearch(); openScriptureSearchTab(query.trim() || undefined) }}
                  className="flex items-center gap-1.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <ShortcutKeys keys="⇧↵" />
                  <span className="text-[10.5px] font-medium whitespace-nowrap">Advanced scripture search</span>
                </button>
                {/* Remaining destination buttons — icon + arrow, hover-expand label, dimmed
                    until a query exists (unlike Scripture above, these genuinely need a
                    query to be useful). All three are hidden entirely in `versesOnly` mode
                    (opened via the Scripture tab's own "Search scripture" button/shortcut)
                    — that entry point is scoped to scripture, so offering destinations for
                    other spaces there is out of place. */}
                {(versesOnly ? [] : [
                  { label: 'Notes',   icon: <StickyNote size={12} />, run: () => openNotesSearchTab(query.trim()) },
                  { label: 'Lexicon', icon: <BookMarked size={12} />, run: () => openLexiconSearchTab(query.trim()) },
                  { label: 'YouTube', icon: <Youtube size={12} className="text-red-400" />, run: () => openYouTubeSearchTab(query.trim()) },
                ]).map((d) => {
                  const active = !!query.trim()
                  return (
                    <button
                      key={d.label}
                      disabled={!active}
                      onClick={() => { if (active) { closeSearch(); d.run() } }}
                      className={`group flex items-center gap-1 pl-1.5 pr-1 py-1 rounded transition-colors cursor-pointer ${
                        active
                          ? 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                          : 'opacity-40 pointer-events-none text-[rgb(var(--color-text-muted))]'
                      }`}
                    >
                      {d.icon}
                      <span className="max-w-0 group-hover:max-w-[5rem] overflow-hidden whitespace-nowrap text-[10px] font-medium transition-[max-width] duration-150">
                        {d.label}
                      </span>
                      <ArrowRight size={10} className="flex-shrink-0" />
                    </button>
                  )
                })}
              </div>
            )}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              searchMode === 'new'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))]'
            }`}>
              {searchMode === 'new' ? 'New tab' : 'Current tab'}
            </span>
          </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
