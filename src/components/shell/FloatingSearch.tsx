import { useEffect, useRef, useState, useCallback, useMemo, useDeferredValue } from 'react'
import { createPortal } from 'react-dom'
import { Search, BookOpen, Hash, BookMarked, NotepadText, Youtube, GitFork, Clock, Terminal, ChevronDown, Check, Tag, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { recordNavigation } from '@/lib/verseNavigation'
import { parseRef, isStrongsRef, getTranslationForBook, bookName, bookChapterVerseLabel, resolveBookToken, normalizeBookName, type ParsedRef } from '@/lib/parseRef'
import { parseMultiBookQuery } from '@/lib/multiBookSearch'
import { applyFindHighlight, makeSnippet } from '@/lib/highlight'
import { applyWordReplacer, getWordReplacerSearchVariants, getWordReplacerStrongsSearch } from '@/lib/wordReplacer'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { parseMultiStrongsQuery, searchMultiStrongs, searchAnyStrongs } from '@/lib/strongsSearch'
import { decodeEntities } from '@/lib/youtubeSearch'
import { getCommands, filterCommands } from '@/lib/commands'
import { rankVerseTags } from '@/lib/verseTagSearch'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import ShortcutKeys from './ShortcutKeys'
import type { Book, LexiconEntry, Note, VerseTag } from '@/types'

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
  /** Strong's-tagged form of `text` — carried through from window.bible.searchText where the
   *  text's DB has the column (KJVA). Used to rebuild the exact word-replaced display string. */
  text_tagged?: string
  /** Only set when the result comes from a non-default text */
  sourceTextId?: string
  sourceTextName?: string
  /** Word-replacer → Strong's bridge rows only: the plain-text word indices carrying the
   *  searched Strong's number, and the replacement string to substitute in at those words
   *  (e.g. "the LORD God" + [1] + "Yehovah" → "the Yehovah God"). The bridge row's raw
   *  `text` is un-tagged KJV, so this is the only way to word-replace it consistently. */
  wrIndices?: number[]
  wrReplacement?: string
}

/** Substitute `replacement` for a single space-delimited word, carrying over a possessive
 *  suffix and any leading/trailing punctuation attached to the original word — mirrors
 *  applyStrongsWordReplacer's affix handling for tagged tokens (wordReplacer.ts). */
function replaceWordPreservingAffixes(word: string, replacement: string): string {
  const m = word.match(/^(\W*)([A-Za-z]+)('[Ss])?(\W*)$/)
  if (!m) return replacement
  const [, lead, , poss, trail] = m
  return lead + replacement + (poss ? "'s" : '') + (trail ?? '')
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
  [['2 baruch:', '2baruch:', 'apocalypse of baruch '], '2baruch'],
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
  '2baruch':     '2 Baruch',
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

// ── Diagnostics ────────────────────────────────────────────────────────────────
// Flip to false once the "typing a verse ref (e.g. `1corinthians12`) freezes the
// floating search" investigation is closed. Every line is prefixed [FloatingSearch]
// so it can be filtered in the console / mcp read_console_messages.
const DIAG = true

// Timeline of the CURRENT keystroke: when handleInput last saw a change, and for which
// value. `sinceKeystroke(q)` returns "ms since the user typed this exact value" (or '' when
// the value has moved on), so every log line can show elapsed-since-input, not just its own
// internal duration — this is what surfaces "keystroke → results on screen" latency.
const keystroke = { q: '', t0: 0 }
function markKeystroke(q: string) { keystroke.q = q; keystroke.t0 = performance.now() }
function sinceKeystroke(q: string): string {
  return keystroke.q === q ? ` [+${(performance.now() - keystroke.t0).toFixed(0)}ms since keystroke]` : ''
}
/** Wall-clock ms (one decimal), monotonic, for ordering lines and eyeballing gaps. */
const ts = () => `t=${performance.now().toFixed(1)}`
const dlog = (...a: unknown[]) => { if (DIAG) console.log('[FloatingSearch]', ts(), ...a) }
/** Run `fn`, and if DIAG is on and it took longer than `warnMs`, log the label + duration. */
function timed<T>(label: string, fn: () => T, warnMs = 1): T {
  if (!DIAG) return fn()
  const t0 = performance.now()
  const r = fn()
  const dt = performance.now() - t0
  if (dt >= warnMs) console.log('[FloatingSearch]', ts(), label, dt.toFixed(1) + 'ms')
  return r
}

export default function FloatingSearch() {
  const searchOpen = useAppStore((s) => s.searchOpen)
  const searchMode = useAppStore((s) => s.searchMode)
  const searchNewTabPosition = useAppStore((s) => s.searchNewTabPosition)
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
  const verseTags = useAppStore((s) => s.verseTags)
  const openLexiconSearchTab = useAppStore((s) => s.openLexiconSearchTab)
  const openNotesSearchTab = useAppStore((s) => s.openNotesSearchTab)
  const openYouTubeSearchTab = useAppStore((s) => s.openYouTubeSearchTab)
  const floatingSearchDensity = useAppStore((s) => s.floatingSearchDensity)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const recentSearchQueries = useAppStore((s) => s.recentSearchQueries)
  const addRecentSearchQuery = useAppStore((s) => s.addRecentSearchQuery)

  type SearchWordMode = 'all' | 'any' | 'phrase'
  // OT/NT scoping moved to the advanced Scripture search — the floating search
  // is always unscoped now. Kept as a const so `scopedVerseResults` below still
  // type-checks without dead setter state.
  type ScopeFilter = 'all' | 'ot' | 'nt'
  const WORD_MODE_LABELS: Record<SearchWordMode, string> = { all: 'All words', any: 'Any word', phrase: 'Exact phrase' }

  const inputRef = useRef<HTMLInputElement>(null)
  const selectedItemRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [searchWordMode, setSearchWordMode] = useState<SearchWordMode>('all')
  const scopeFilter: ScopeFilter = 'all'
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

  // Diagnostics: count renders and log each commit with the query that produced it, so a
  // "frozen while typing" report shows up as either a render storm (many commits per
  // keystroke) or a single very-late commit.
  const renderCountRef = useRef(0)
  renderCountRef.current++
  // Last query value we've already logged a "results on screen" line for — so the
  // keystroke→visible latency line fires exactly once per distinct typed value.
  const resultsShownForRef = useRef<string | null>(null)
  useEffect(() => {
    if (DIAG && searchOpen) dlog('commit #' + renderCountRef.current, 'query=' + JSON.stringify(query) + sinceKeystroke(query))
  })

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
      setSelectedTags([])
      setTagFocusIdx(0)
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

  // Everything downstream of the raw keystroke (parseRef/resolveBookToken's Levenshtein
  // fallback, and — more expensively — rebuilding the whole `results` list every render,
  // including a makeSnippet()+word-replacer pass over every verse/note row) is deferred a
  // low-priority tick behind the actual typed character via useDeferredValue. `query` itself
  // (bound to the `<input>` below) is NEVER deferred, so the character you just typed always
  // paints immediately — only the results panel below it is allowed to lag a frame behind on
  // a fast keystroke, then catch up, instead of the keystroke itself waiting on that work.
  // (Memoizing `detected`/`cleanQuery` alone used to be the fix here, but that only capped
  // the cost per keystroke — it didn't stop that cost from being paid synchronously, inside
  // the SAME render the character needed to appear in, which is what actually reads as lag.)
  const deferredQuery = useDeferredValue(query)
  const detected = useMemo(
    () => timed(`detectTranslationPrefix(${JSON.stringify(deferredQuery)})`, () => (deferredQuery.trim() ? detectTranslationPrefix(deferredQuery) : null)),
    [deferredQuery],
  )
  const cleanQuery = detected ? detected.cleanQuery : deferredQuery
  // Recognitions of Clement / Shepherd of Hermas get their own richer grammar first
  // (book-numbered/section-numbered addressing parseRef's own regex can't express —
  // see multiBookSearch.ts) — falls through to the general-purpose parseRef for
  // everything else, including a remainder multiBookSearch didn't recognize.
  const parsedRef = useMemo(
    () => timed(`parseRef(${JSON.stringify(cleanQuery)})`, () => (cleanQuery.trim() ? (parseMultiBookQuery(cleanQuery) ?? parseRef(cleanQuery)) : null)),
    [cleanQuery]
  )
  const isStrongs = isStrongsRef(query)

  // ── Verse-tag search ────────────────────────────────────────────────────────
  // "#" is an explicit tag mode (like ">" for commands); "#" alone lists every
  // tag. `selectedTags` accumulate as the user clicks tag chips — they persist
  // while they keep typing, and ⇧↵ / "Search tags" opens the advanced Scripture
  // search filtered by them.
  const isTagMode = query.trim().startsWith('#')
  const [selectedTags, setSelectedTags] = useState<VerseTag[]>([])
  const [tagFocusIdx, setTagFocusIdx] = useState(0)
  const candidateTags = useMemo(() => {
    const selectedIds = new Set(selectedTags.map((t) => t.id))
    const pool = verseTags.filter((t) => !selectedIds.has(t.id))
    if (isTagMode) return rankVerseTags(pool, query.trim().slice(1)).slice(0, 12)
    if (!query.trim().startsWith('>') && !parsedRef && !isStrongs && cleanQuery.trim().length >= 2) {
      return rankVerseTags(pool, cleanQuery).slice(0, 6)
    }
    return []
  }, [verseTags, selectedTags, isTagMode, query, cleanQuery, parsedRef, isStrongs])

  const addTag = useCallback((t: VerseTag) => {
    setSelectedTags((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]))
    setTagFocusIdx(0)
    setSelectedIdx(-1)
    // Clear the input entirely — the tag is now a persistent filter shown in the
    // chip row. Don't type "#" for the user; they can type it again themselves
    // to pick more tags, or just start a keyword search. Also drop any lingering
    // results from the query that produced these candidates.
    setQuery('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setVerseResults([]); setLexiconResults([]); setNoteResults([]); setYoutubeResults([]); setCrossRefResults([])
    inputRef.current?.focus()
  }, [])
  const removeTag = useCallback((id: string) => {
    setSelectedTags((prev) => prev.filter((x) => x.id !== id))
    inputRef.current?.focus()
  }, [])

  // Member verses / whole chapters of the currently-selected tags — used to
  // scope the floating search's own verse results (a keyword hit only shows if
  // it actually carries a selected tag). Refetched whenever the selection
  // changes; null while loading / when nothing is selected.
  const [tagVerseFilter, setTagVerseFilter] = useState<{ verses: Set<string>; chapters: Set<string> } | null>(null)
  useEffect(() => {
    if (selectedTags.length === 0) { setTagVerseFilter(null); return }
    let cancelled = false
    setTagVerseFilter(null)
    window.verseTags.getMembers(selectedTags.map((t) => t.id)).then((members) => {
      if (cancelled) return
      const verses = new Set<string>()
      const chapters = new Set<string>()
      for (const m of members) {
        for (const v of m.verses) verses.add(`${v.bookId}:${v.chapter}:${v.verse}`)
        for (const c of m.wholeChapters) chapters.add(`${c.bookId}:${c.chapter}`)
      }
      setTagVerseFilter({ verses, chapters })
    }).catch(() => { if (!cancelled) setTagVerseFilter({ verses: new Set(), chapters: new Set() }) })
    return () => { cancelled = true }
  }, [selectedTags])

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
      dlog(`runSearch fired gen=${gen} q=${JSON.stringify(q)}` + sinceKeystroke(q))
      const phaseT0 = performance.now()

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

      // Word-replacer → Strong's bridge: a query like "yehovah" restores from H3068/H3069,
      // which plain FTS (index still says "LORD") can never find. Search those by occurrence
      // instead and merge alongside the variant results. See getWordReplacerStrongsSearch.
      // KJVA-only: Strong's occurrence data (and the H-number rules) are Hebrew-OT tagging.
      const wrStrongs = (wordReplacerEnabled && tid === 'kjva') ? getWordReplacerStrongsSearch(trimmed, wordReplacerRules) : null
      // The replacement wording for whichever rule owns a searched Strong's number — the
      // displayed word for every bridge row ("LORD"→"Yehovah"). Multiple matched rules are
      // rare (H3068/H3069 share one "Yehovah" rule in practice); any one is fine.
      const wrReplacement = wrStrongs
        ? (wordReplacerRules.find((r) => r.enabled && r.strongsNum && wrStrongs.strongsNums.includes(r.strongsNum))?.replacement ?? '')
        : ''
      const wrStrongsSearch: Promise<VerseResult[]> = wrStrongs
        ? searchAnyStrongs(wrStrongs.strongsNums, wrStrongs.residualWords, window.lexicon.getOccurrences)
            .then((rows) => rows.map((o) => ({
              book_id: o.book_id, chapter: o.chapter, verse_num: o.verse_num, text: o.text,
              wrIndices: o.matchWordIndices, wrReplacement,
            } as VerseResult)))
            .catch(() => [] as VerseResult[])
        : Promise.resolve([] as VerseResult[])

      try {
        // ── Fast phase — dispatched and awaited first ──────────────────────
        const [notes, wrStrongsRes, ...variantResults] = await Promise.allSettled([
          window.notes.searchNotes(trimmed, 5, searchWordMode),
          wrStrongsSearch,
          ...variantSearches,
        ])
        if (gen !== searchGenRef.current) return
        dlog(`fast phase resolved gen=${gen}`, (performance.now() - phaseT0).toFixed(1) + 'ms (notes+verses IPC)' + sinceKeystroke(q))

        // Merge + dedupe every variant's results (bidirectional word-replacer search
        // can return the same verse from more than one variant query).
        const seenVerse = new Set<string>()
        const primaryVerse: VerseResult[] = []
        const mergeRows = (rows: VerseResult[]) => {
          for (const row of rows) {
            const key = `${row.book_id}|${row.chapter}|${row.verse_num}`
            if (seenVerse.has(key)) continue
            seenVerse.add(key)
            primaryVerse.push(row)
          }
        }
        if (wrStrongsRes.status === 'fulfilled') mergeRows(wrStrongsRes.value as VerseResult[])
        for (const r of variantResults) {
          if (r.status !== 'fulfilled') continue
          mergeRows(r.value as unknown as VerseResult[])
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
        dlog(`slow phase resolved gen=${gen}`, (performance.now() - phaseT0).toFixed(1) + 'ms (extra texts + youtube)' + sinceKeystroke(q))

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

  // Load cross-references when the query is a verse ref with a verse number.
  // `lastCrossRefKeyRef` dedupes: while the user types onward through a reference
  // ("1co12", "1co12:", "1co12:1", "1co12:11") the resolved (book,chapter,verse)
  // only actually changes on the last step, so this no longer re-dispatches the
  // (synchronous, main-process, better-sqlite3) crossref query for every keystroke
  // in between — the leading suspect for the "typing a verse ref freezes" report.
  const lastCrossRefKeyRef = useRef<string>('')
  useEffect(() => {
    if (!searchOpen) return
    const ref = parsedRef
    if (!ref?.verse || ref.endChapter) {
      lastCrossRefKeyRef.current = ''
      setCrossRefResults([])
      return
    }
    const key = `${ref.bookId}|${ref.chapter}|${ref.verse}`
    if (key === lastCrossRefKeyRef.current) return
    lastCrossRefKeyRef.current = key
    if (crossRefDebounceRef.current) clearTimeout(crossRefDebounceRef.current)
    setCrossRefLoading(true)
    crossRefDebounceRef.current = setTimeout(async () => {
      const t0 = performance.now()
      try {
        const result = await window.crossrefs.getForVerse(ref.bookId, ref.chapter, ref.verse!)
        dlog(`crossrefs.getForVerse ${key}`, (performance.now() - t0).toFixed(1) + 'ms', (result?.refs?.length ?? 0) + ' refs' + sinceKeystroke(query))
        setCrossRefResults(result?.refs ?? [])
      } catch {
        setCrossRefResults([])
      } finally {
        setCrossRefLoading(false)
      }
    }, 400)
  }, [parsedRef, searchOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleInput(val: string) {
    if (DIAG) { markKeystroke(val); dlog('keystroke', JSON.stringify(val)) }
    setQuery(val)
    setSelectedIdx(-1)
    setTagFocusIdx(0)
    // Command mode (">") / tag mode ("#") — no reference/keyword lookup to run,
    // the prefixed text is matched client-side (against the command list, or the
    // verse-tag list already in the store).
    if (val.trim().startsWith('>') || val.trim().startsWith('#')) {
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
      // If this tab was showing Advanced Search, record the search itself as a nav-stack
      // entry BEFORE leaving it, so Cmd+[ (navTabBack) returns to those results (query
      // restored) instead of skipping past to whatever chapter was open before the search
      // (previously it fell back to the tab's GEN/1 seed — "back went to Genesis 1").
      const leavingSearch = (targetTab.state as { searchMode?: boolean; scriptureSearchQuery?: string })
      if (leavingSearch.searchMode && leavingSearch.scriptureSearchQuery) {
        useAppStore.getState().pushTabNav(targetTab.id, {
          type: 'bible',
          title: `Search: "${leavingSearch.scriptureSearchQuery}"`,
          query: leavingSearch.scriptureSearchQuery,
        })
      }
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
      // Land at the top of the opened chapter — a no-verse reference jump into the SAME
      // chapter the tab is already scrolled into wouldn't otherwise move (BiblePanel's
      // chapter-keyed scroll reset only fires on a real book/chapter change). A verse jump
      // owns its own scroll, so skip it there.
      if (targetVerse == null) {
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('berean:scriptureScrollToTop')))
      }
    } else {
      // 'new' mode, or 'current' mode with no existing bible tab
      const id = `bible-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      addTab({
        id,
        spaceId: 'scripture',
        type: 'bible',
        title,
        state: { bookId, chapter, endChapter, translation, showStrongs: false, scrollPosition: 0, targetVerse, endVerse },
      }, searchNewTabPosition)
    }

    // Study Trail: a plain typed reference (no query text at all) is book-chapter-picker
    // ambiguous; a real keyword/reference-with-text search is a search-result with the typed
    // query as its own reason.
    {
      const priorTab = targetTab ?? tabs.find((t) => t.type === 'bible' && t.id === useAppStore.getState().activeTabId.scripture)
      const priorState = priorTab?.state as { bookId?: string; chapter?: number; targetVerse?: number } | undefined
      const q = query.trim()
      recordNavigation(
        { bookId: priorState?.bookId, chapter: priorState?.chapter, verse: priorState?.targetVerse },
        { bookId, chapter, verse: targetVerse },
        q ? { kind: 'search-result', query: q } : { kind: 'book-chapter-picker' },
      )
    }
    setActiveSpace('scripture')
    closeSearch()
  }

  function goToLexicon(strongsNum: string) {
    if (searchMode === 'new') {
      createTab('lexicon', searchNewTabPosition)
    } else {
      ensureTab('lexicon')
    }
    openLexiconEntry(strongsNum)
    setActiveSpace('lexicon')
    closeSearch()
  }

  // Builds the "ref" result row + its navigate() action for a parsed reference. Factored out
  // of the render-time results-list building below so handleKeyDown's Enter-immediately path
  // can build the exact same action from a freshly (synchronously) parsed reference, rather
  // than trusting the deferred `parsedRef` — see the immediateRef comment in handleKeyDown.
  function refResultFor(ref: ParsedRef, detectedTextId: string | undefined) {
    const chapterDisplay = ref.endChapter && ref.endChapter > ref.chapter
      ? `${ref.chapter}–${ref.endChapter}`
      : ref.chapter
    // Always the full canonical name (bookName(), from parseRef.ts's own book table) rather
    // than the DB-fetched `books` list's `.name` field — that fetch can still be in flight
    // when the user starts typing, or (for non-canonical/Pseudepigrapha books) might not be
    // in `books` at all depending on which text is currently selected, both of which
    // previously fell back to showing the bare 3-letter bookId ("GEN") instead of a name.
    const refName = bookName(ref.bookId)
    const refSep = /Book \d+$/.test(refName) ? ', ' : ' '
    const label = `${refName}${refSep}${chapterDisplay}${ref.verse ? `:${ref.verse}` : ''}`
    // A trailing " LXX" suffix now parses inside parseRef itself (as `forcedTranslation`), so
    // detectTranslationPrefix's own trailing-qualifier branch no longer sees it — read the
    // target text from either source. This is also what makes the suffix actually NAVIGATE to
    // the LXX: `detected` only ever fed this label, never the navigate() call below.
    const refTextId = ref.forcedTranslation ?? detectedTextId
    // Smart LXX redirect: a typed reference is always in MT/KJV numbering (parseRef's BOOK_MAP
    // is KJV-keyed), but the Septuagint renumbers Psalms 9 onward, reorders the back half of
    // Jeremiah, and splits one chapter each in Joel and Malachi — see translationChapterMap.ts
    // (already used by the KJV/LXX toggle button and Compare view; this was the one place that
    // typed a KJV reference and then navigated WITHOUT going through it). "Psalm 10 LXX shows
    // as Psalm 11" was the actual bug report: LXX Psalm 10 really is MT/KJV Psalm 11, so typing
    // "Psalm 10 LXX" landed on the wrong chapter's content with no indication why. Only applied
    // to a single chapter target, not a chapter RANGE query — remapping just the range's start
    // would leave the end chapter inconsistent for the rarer merge/split-crossing case.
    const mappedChapter = !ref.endChapter && refTextId
      ? mapChapterOnTranslationSwitch(ref.bookId, ref.chapter, 'kjva', refTextId)
      : ref.chapter
    const chapterRemapped = mappedChapter !== ref.chapter
    const navChapter = mappedChapter
    // A remapped LXX chapter can merge two KJV chapters into one (Ps 9, Ps 113) or only cover
    // part of a split KJV chapter (Ps 116, Ps 147; Joel 2; Malachi 3) — a KJV verse number
    // doesn't carry over to the right place in either case, so land at the chapter's start
    // instead of a wrong verse (same "chapter-level only" scope translationChapterMap.ts
    // documents for its other two call sites).
    const navVerse = chapterRemapped ? undefined : ref.verse
    const subLabel = chapterRemapped
      ? `Go to ${refTextId!.toUpperCase()} ${bookName(ref.bookId)} ${navChapter} — Septuagint numbering differs from KJV here`
      : refTextId
        ? `${ref.verse ? `Go to verse ${ref.verse}` : 'Go to chapter'} in ${refTextId.toUpperCase()}`
        : ref.verse ? `Go to verse ${ref.verse}` : 'Go to chapter'
    return {
      type: 'ref' as const,
      label,
      sub: subLabel,
      action: () => {
        addRecentSearchQuery(query.trim())
        navigate(
          ref.bookId,
          navChapter,
          navVerse,
          chapterRemapped ? undefined : ref.endVerse,
          // forcedTranslation ("Isaiah 66:3 LXX") outranks the book's own required
          // translation — same precedence NotesPanel.tsx uses for verse-ref clicks.
          ref.forcedTranslation ?? getTranslationForBook(ref.bookId) ?? undefined,
          ref.endChapter,
        )
      },
    }
  }

  // Build result list for keyboard nav
  // Diagnostics: time the whole synchronous results-list build (makeSnippet +
  // word-replacer + buildVerseDisplayText over every row). If "freezing" is this,
  // it shows up as a multi-hundred-ms entry here on the render after a keystroke.
  const _resultsBuildT0 = DIAG ? performance.now() : 0

  const results: Array<{
    type: 'ref' | 'verse' | 'lexicon' | 'note' | 'youtube' | 'crossref' | 'command' | 'tag'
    label: string
    sub: string
    action: () => void
    /** Verse rows only: every term that may actually appear in `sub` after word-replacement
     *  (typed term + its replacer substitution + a bridge row's replaced word) — all marked. */
    highlightTerms?: string[]
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

  // Tag mode ("#…") is handled entirely by the selectable chip row rendered
  // above the results (see `candidateTags` / `selectedTags`); it produces no
  // result rows of its own. It still short-circuits the ref/keyword lookup, the
  // same way command mode does.

  if (!isCommandMode && !isTagMode && parsedRef) {
    results.push(refResultFor(parsedRef, detected?.textId))
  } else if (!isCommandMode && !isTagMode && cleanQuery.trim()) {
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
  const rawScopedVerses = scopeFilter === 'all'
    ? verseResults
    : verseResults.filter((v) => {
        const bk = books.find((b) => b.id === v.book_id)
        if (!bk) return true
        return scopeFilter === 'ot' ? bk.testament === 'OT' : bk.testament === 'NT'
      })
  // When verse tags are selected they act as a LIVE filter: only keyword hits
  // that actually carry one of the selected tags are shown. Until the tag's
  // member verses have loaded, show nothing rather than an unfiltered list.
  const scopedVerseResults = selectedTags.length === 0
    ? rawScopedVerses
    : tagVerseFilter
      ? rawScopedVerses.filter((v) =>
          tagVerseFilter.verses.has(`${v.book_id}:${v.chapter}:${v.verse_num}`) ||
          tagVerseFilter.chapters.has(`${v.book_id}:${v.chapter}`))
      : []

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
    if (parsedRef || isStrongs || multiStrongs || query.trim().startsWith('>') || query.trim().startsWith('#') || cleanQuery.trim().length < 3) return null
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

    // Reproduce exactly what the reader would show for this verse, so a word-replaced query
    // ("yehovah") finds its match in the snippet instead of the un-replaced "LORD".
    let displayText: string
    if (v.wrIndices?.length && v.wrReplacement) {
      // Bridge row: raw un-tagged KJV text — substitute the replacement at the matched word
      // indices, then run text-pattern rules over the result.
      const idxSet = new Set(v.wrIndices)
      const substituted = v.text.split(' ')
        .map((w, i) => (idxSet.has(i) ? replaceWordPreservingAffixes(w, v.wrReplacement!) : w))
        .join(' ')
      displayText = wordReplacerEnabled ? applyWordReplacer(substituted, wordReplacerRules) : substituted
    } else if (v.text_tagged) {
      displayText = buildVerseDisplayText(
        v.text, v.text_tagged, v.sourceTextId ?? searchTextId, wordReplacerEnabled, wordReplacerRules,
      )
    } else {
      displayText = wr(v.text)
    }

    // The term that actually appears in `displayText` — prefer the concrete replacement word,
    // then the text-pattern-replaced query, then the raw query.
    const replacedQuery = wordReplacerEnabled ? applyWordReplacer(cleanQuery, wordReplacerRules) : cleanQuery
    const snippetTerm = v.wrReplacement || replacedQuery || cleanQuery
    const subText = makeSnippet(displayText, snippetTerm, subLen, searchWordMode)
    const highlightTerms = [cleanQuery, replacedQuery, v.wrReplacement].filter((t): t is string => !!t && t.trim().length > 0)
    results.push({
      type: 'verse',
      label: `${book?.short_name ?? v.book_id} ${v.chapter}:${v.verse_num}${sourceLabel}`,
      sub: subText,
      highlightTerms,
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

  // (Matching verse tags for a plain keyword query are shown as selectable chips
  // in the tag row above the results — see `candidateTags` — not as rows here.)

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

  if (DIAG) {
    const dt = performance.now() - _resultsBuildT0
    if (dt >= 4) dlog('results build', dt.toFixed(1) + 'ms', `(${results.length} rows, ${verseResults.length} verse / ${noteResults.length} note / ${youtubeResults.length} yt in state)`)
    // Latency line: this render is the one that will paint `results` for the current typed
    // value (deferred value has caught up to the input). Fires once per distinct value.
    if (deferredQuery === query && results.length > 0 && resultsShownForRef.current !== query) {
      resultsShownForRef.current = query
      dlog(`results on screen: ${results.length} rows for ${JSON.stringify(query)}` + sinceKeystroke(query))
    }
  }

  // `parsedRef` (used to build `results` above) is derived from `deferredQuery`, which
  // intentionally lags a tick behind the raw keystroke (see the useDeferredValue comment near
  // its declaration). That's fine for the rendered results list, but pressing Enter immediately
  // after typing a reference ("dan12", "1ki11") could fire before the deferred value catches up,
  // so `parsedRef` was still null/stale at that moment — falling through to `predictedSpace`
  // routing or a stale `results[0]` (e.g. a note match) instead of the just-typed reference.
  // Reparsing synchronously off the raw `query` here is cheap (a regex + table lookup) and
  // guarantees Enter always sees exactly what's on screen, regardless of the deferred value's
  // catch-up timing.
  function getImmediateRef(): { ref: ParsedRef; textId: string | undefined } | null {
    const trimmed = query.trim()
    if (!trimmed) return null
    const det = detectTranslationPrefix(trimmed)
    const clean = det ? det.cleanQuery : trimmed
    const ref = clean.trim() ? (parseMultiBookQuery(clean) ?? parseRef(clean)) : null
    return ref ? { ref, textId: det?.textId } : null
  }

  // Open the advanced Scripture search tab, carrying any selected verse tags and
  // (outside tag mode) the typed keyword.
  function openAdvancedScriptureSearch() {
    const keyword = isTagMode ? '' : query.trim()
    let tags = selectedTags
    // In tag mode with nothing explicitly picked yet, fold in the focused chip so
    // ⇧↵ "just works" straight after typing a filter.
    if (isTagMode && tags.length === 0 && candidateTags.length > 0) {
      tags = [candidateTags[Math.min(tagFocusIdx, candidateTags.length - 1)]]
    }
    const tagIds = tags.map((t) => t.id)
    if (query.trim()) addRecentSearchQuery(query.trim())
    closeSearch()
    openScriptureSearchTab(keyword || undefined, tagIds.length ? { tagIds } : undefined)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // ── Tag mode ("#…") owns the keyboard: arrow through candidate tag chips,
    //    Enter selects the focused one, ⇧↵ (or Enter with nothing left to pick)
    //    opens the advanced Scripture search with the selected tags. ──
    if (isTagMode) {
      if (e.key === 'ArrowDown' && candidateTags.length) {
        e.preventDefault(); setTagFocusIdx((i) => Math.min(i + 1, candidateTags.length - 1)); return
      }
      if (e.key === 'ArrowUp' && candidateTags.length) {
        e.preventDefault(); setTagFocusIdx((i) => Math.max(i - 1, 0)); return
      }
      if (e.key === 'Enter' && !e.shiftKey && candidateTags.length) {
        e.preventDefault(); addTag(candidateTags[Math.min(tagFocusIdx, candidateTags.length - 1)]); return
      }
      if (e.key === 'Enter') { e.preventDefault(); openAdvancedScriptureSearch(); return }
      // Backspace on a bare "#" pops the last selected tag (quick de-select).
      if (e.key === 'Backspace' && query.trim() === '#' && selectedTags.length > 0) {
        e.preventDefault(); setSelectedTags((prev) => prev.slice(0, -1)); return
      }
      return // no other keys do anything special in tag mode
    }

    const immediateRef = e.key === 'Enter' ? getImmediateRef() : null
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
      openAdvancedScriptureSearch()
    } else if (e.key === 'Enter' && selectedIdx < 0 && immediateRef) {
      e.preventDefault()
      // navigate() (called inside .action()) already closes the search overlay itself.
      refResultFor(immediateRef.ref, immediateRef.textId).action()
    } else if (e.key === 'Enter' && selectedIdx < 0 && selectedTags.length > 0) {
      // Tag(s) selected and nothing in the list highlighted — go straight to the
      // tagged-verses view (carrying any keyword). Arrowing/hovering a result row
      // opts back into activating that row below.
      e.preventDefault()
      openAdvancedScriptureSearch()
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

  // No empty-state hint once tag filters are in play — the chip row + footer
  // "Search N tags" action are the whole UI at that point.
  const showHint = !query.trim() && selectedTags.length === 0

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
                  <span className="flex items-center gap-1 ml-1.5 flex-shrink-0 opacity-35 text-[rgb(var(--color-text-muted))] text-[11px]">
                    → {predictedSpace === 'scripture' ? 'Scripture' : predictedSpace === 'notes' ? 'Notes' : 'YouTube'}
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
            {/* Clear the query (and any selected tag filters). OT/NT scoping lives
                in the advanced Scripture search, not here. */}
            {(query.length > 0 || selectedTags.length > 0) && (
              <button
                onClick={() => { setQuery(''); setSelectedTags([]); setTagFocusIdx(0); setSelectedIdx(-1); if (debounceRef.current) clearTimeout(debounceRef.current); setVerseResults([]); setLexiconResults([]); setNoteResults([]); setYoutubeResults([]); setCrossRefResults([]); inputRef.current?.focus() }}
                title="Clear search"
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] transition-colors"
              >
                <X size={13} />
              </button>
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

          {/* Verse-tag chips — selected (removable) + candidates (click to add).
              A floating pill group tucked just under the input, no hard divider. */}
          {(selectedTags.length > 0 || candidateTags.length > 0) && (
            <div className="mx-2.5 mt-2 mb-1 rounded-xl bg-[rgb(var(--color-surface-3))]/50 px-3 py-2 flex flex-col gap-2">
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-muted))] font-medium mr-0.5">Filter by tag</span>
                  {selectedTags.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => removeTag(t.id)}
                      title={`Remove #${t.name}`}
                      className="group inline-flex items-center gap-1 rounded-full bg-[rgb(var(--color-accent))/16] border border-[rgb(var(--color-accent))/40] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/24] transition-colors cursor-pointer"
                    >
                      <Tag size={10} />
                      {t.name}
                      <X size={10} className="opacity-60 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
              {candidateTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedTags.length === 0 && (
                    <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-muted))] font-semibold mr-1">Tags</span>
                  )}
                  {candidateTags.map((t, idx) => (
                    <button
                      key={t.id}
                      onMouseEnter={() => setTagFocusIdx(idx)}
                      onClick={() => addTag(t)}
                      title={`${t.verseCount} verse${t.verseCount === 1 ? '' : 's'} · ${t.chapterCount} chapter${t.chapterCount === 1 ? '' : 's'}`}
                      // Candidates stay neutral — no accent. The keyboard-focused one
                      // (↑↓ in "#" mode) gets a plain surface fill, not the accent used
                      // for the SELECTED chips above.
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer border-[rgb(var(--color-surface-4))] ${
                        isTagMode && idx === tagFocusIdx
                          ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                          : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]/60 hover:text-[rgb(var(--color-text-primary))]'
                      }`}
                    >
                      <Tag size={10} className="opacity-60" />
                      {t.name}
                      <span className="opacity-45 tabular-nums">{t.verseCount}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
                      {r.type === 'ref' ? <BookOpen size={14} /> : r.type === 'lexicon' ? <BookMarked size={14} /> : r.type === 'note' ? <NotepadText size={14} /> : r.type === 'youtube' ? <Youtube size={14} className="text-red-400" /> : r.type === 'crossref' ? <GitFork size={14} className="text-[rgb(var(--color-accent))]" /> : r.type === 'command' ? <Terminal size={14} className="text-[rgb(var(--color-accent))]" /> : r.type === 'tag' ? <Tag size={14} className="text-[rgb(var(--color-accent))]" /> : <Hash size={14} />}
                    </span>
                    <span className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] block">
                          {r.label}
                        </span>
                        {r.type !== 'command' && (
                          <span className={`text-xs text-[rgb(var(--color-text-muted))] block whitespace-normal ${DENSITY_CLAMP[floatingSearchDensity]}`}>
                            {highlightQ
                              ? applyFindHighlight(r.sub, r.highlightTerms?.length ? r.highlightTerms : highlightQ, searchWordMode)
                              : r.sub}
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

          {/* Footer — minimal: only shown when there's something actionable
              (a query, tag mode, or selected tag filters). Just the advanced-
              search affordance + quick destination icons; the ↑↓ / ↵ hints and
              the new/current-tab badge were removed as noise. */}
          {!isCommandMode && (query.trim().length > 0 || isTagMode || selectedTags.length > 0) && (
            <div className="px-4 py-2 border-t border-[rgb(var(--color-surface-4))] flex items-center gap-3 text-xs text-[rgb(var(--color-text-muted))]">
              {isTagMode && candidateTags.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10.5px] font-medium whitespace-nowrap">
                  <ShortcutKeys keys="↵" /> add tag
                </span>
              )}
              {isTagMode && verseTags.length === 0 && (
                <span className="text-[10.5px] font-medium whitespace-nowrap">No verse tags yet</span>
              )}
              <div className="flex-1" />
              <button
                onClick={openAdvancedScriptureSearch}
                className="flex items-center gap-1.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              >
                <ShortcutKeys keys="⇧↵" />
                <span className="text-[10.5px] font-medium whitespace-nowrap">
                  {selectedTags.length > 0
                    ? `Search ${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'} in Scripture`
                    : 'Advanced scripture search'}
                </span>
              </button>
              {/* Quick "send this query to…" destinations — bare icons (no
                  hover-expand label), sized to match the app's other toolbar
                  icons. Hidden in tag / verses-only mode. */}
              {!versesOnly && !isTagMode && query.trim().length > 0 && (
                <div className="flex items-center gap-0.5">
                  {[
                    { label: 'Search Notes',   icon: <NotepadText size={15} />, run: () => openNotesSearchTab(query.trim()) },
                    { label: 'Search Lexicon', icon: <BookMarked size={15} />, run: () => openLexiconSearchTab(query.trim()) },
                    { label: 'Search YouTube', icon: <Youtube size={15} className="text-red-400" />, run: () => openYouTubeSearchTab(query.trim()) },
                  ].map((d) => (
                    <button
                      key={d.label}
                      title={d.label}
                      onClick={() => { closeSearch(); d.run() }}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                    >
                      {d.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
