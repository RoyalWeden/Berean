import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, BookOpen, Hash, BookMarked, StickyNote, Youtube, GitFork, Clock, Terminal } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { parseRef, isStrongsRef, getTranslationForBook, bookName } from '@/lib/parseRef'
import { applyFindHighlight, makeSnippet } from '@/lib/highlight'
import { applyWordReplacer, expandQueryForWordReplacer } from '@/lib/wordReplacer'
import { decodeEntities } from '@/lib/youtubeSearch'
import { getCommands, filterCommands } from '@/lib/commands'
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
  [['recognitions:', 'recog_clement '], 'recog_clement'],
  [['apoc elijah:', 'apocalypse of elijah '], 'apoc_elijah'],
  [['t12p:', 'testaments:', 'twelve patriarchs '], 't12p'],
  [['gad the seer:', 'gad seer:', 'words of gad '], 'gad'],
  [['testament of job:', 'test job:', 'tjob '], 't_job'],
  [['1 clement:', '1clement:', '1clem '], '1clement'],
  [['apoc abraham:', 'apocalypse of abraham '], 'apoc_abraham'],
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
}

function normalizeBookName(name: string): string {
  return name.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ')
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
  const closeSearch = useAppStore((s) => s.closeSearch)
  const tabs = useAppStore((s) => s.tabs)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const createTab = useAppStore((s) => s.createTab)
  const addTab = useAppStore((s) => s.addTab)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const defaultBibleTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const openScriptureSearchTab = useAppStore((s) => s.openScriptureSearchTab)
  const floatingSearchDensity = useAppStore((s) => s.floatingSearchDensity)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const recentSearchQueries = useAppStore((s) => s.recentSearchQueries)
  const addRecentSearchQuery = useAppStore((s) => s.addRecentSearchQuery)

  type SearchWordMode = 'all' | 'any' | 'phrase'
  type ScopeFilter = 'all' | 'ot' | 'nt'

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
  const [selectedIdx, setSelectedIdx] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const crossRefDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setSelectedIdx(0)
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

  // Derived from query: strip trailing/leading translation qualifier
  const detected = query.trim() ? detectTranslationPrefix(query) : null
  const cleanQuery = detected ? detected.cleanQuery : query
  const parsedRef = cleanQuery.trim() ? parseRef(cleanQuery) : null
  const isStrongs = isStrongsRef(query)

  function buildFTSQuery(q: string, mode: SearchWordMode): string {
    const trimmed = q.trim()
    // Expand with original terms when the user typed a replacement word (e.g. "yeshua" → also "jesus")
    const expanded = wordReplacerEnabled
      ? expandQueryForWordReplacer(trimmed, wordReplacerRules)
      : trimmed
    if (mode === 'phrase') return `"${expanded}"`
    if (mode === 'any') return expanded.split(/\s+/).filter(Boolean).join(' OR ')
    return expanded // 'all' — FTS5 default treats space as AND
  }

  // Debounced FTS search
  const runSearch = useCallback((q: string, tid: string, mode: SearchWordMode = 'all') => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const trimmed = q.trim()
      setVerseResults([])
      setLexiconResults([])
      setNoteResults([])
      setYoutubeResults([])
      if (!trimmed) return

      if (isStrongsRef(trimmed)) {
        try {
          const entry = await window.lexicon.getEntry(trimmed)
          setLexiconResults(entry ? [entry] : [])
        } catch {
          setLexiconResults([])
        }
        return
      }

      if (parseRef(trimmed)) return

      if (trimmed.length < 3) return

      // When searching the primary text and no text-prefix was detected,
      // also search all extra books in parallel.
      const isDefaultSearch = !Object.keys(EXTRA_TEXT_IDS).includes(tid)
      const extraSearches = isDefaultSearch
        ? Object.entries(EXTRA_TEXT_IDS).map(([extraId, label]) =>
            window.bible.searchText(trimmed, extraId)
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

      const ftsQ = buildFTSQuery(trimmed, mode)
      try {
        const ytSearch = (window.youtube && typeof window.youtube.searchVideos === 'function')
          ? window.youtube.searchVideos(trimmed, 5).catch(() => [])
          : Promise.resolve([])
        // Request up to 3 transcript segments per video for rich results
        const ytTranscriptSearch = (window.youtube && typeof window.youtube.searchTranscripts === 'function')
          ? window.youtube.searchTranscripts(trimmed, 5, 3).catch(() => [])
          : Promise.resolve([])

        const [verses, notes, ytVideos, ytTranscripts, ...extraAll] = await Promise.allSettled([
          window.bible.searchText(ftsQ, tid),
          window.notes.searchNotes(trimmed, 5),
          ytSearch,
          ytTranscriptSearch,
          ...extraSearches,
        ])

        const primaryVerse = verses.status === 'fulfilled' ? verses.value as unknown as VerseResult[] : []
        const extraVerses: VerseResult[] = extraAll.flatMap((r) => r.status === 'fulfilled' ? r.value : [])
        setVerseResults([...primaryVerse, ...extraVerses])
        setNoteResults(notes.status === 'fulfilled' ? notes.value : [])

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
    }, 350)
  }, [])

  // Load cross-references when the query is a verse ref with a verse number
  useEffect(() => {
    if (!searchOpen) return
    const det = query.trim() ? detectTranslationPrefix(query) : null
    const q = (det ? det.cleanQuery : query).trim()
    const ref = q ? parseRef(q) : null
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
  }, [query, searchOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleInput(val: string) {
    setQuery(val)
    setSelectedIdx(0)
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
          const activeId = activeTabId['scripture']
          return activeId
            ? tabs['scripture'].find((t) => t.id === activeId)
            : tabs['scripture'].find((t) => t.type === 'bible')
        })()
      : undefined

    if (targetTab) {
      // Navigating to a verse exits the advanced-search view if the tab was in it.
      updateTabState('scripture', targetTab.id, { bookId, chapter, endChapter, scrollPosition: 0, targetVerse, endVerse, translation, searchMode: false })
      renameTab('scripture', targetTab.id, title)
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
    const book = books.find((b) => b.id === parsedRef.bookId)
    const chapterDisplay = parsedRef.endChapter && parsedRef.endChapter > parsedRef.chapter
      ? `${parsedRef.chapter}–${parsedRef.endChapter}`
      : parsedRef.chapter
    const label = book
      ? `${book.name} ${chapterDisplay}${parsedRef.verse ? `:${parsedRef.verse}` : ''}`
      : `${parsedRef.bookId} ${chapterDisplay}`
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
  }

  // Cross-references — shown when query is a verse ref with a verse number
  if (parsedRef?.verse && crossRefResults.length > 0) {
    for (const cr of crossRefResults.slice(0, 5)) {
      const ref = cr.endVerse
        ? `${bookName(cr.bookId)} ${cr.chapter}:${cr.verse}–${cr.endVerse}`
        : `${bookName(cr.bookId)} ${cr.chapter}:${cr.verse}`
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

  for (const entry of lexiconResults) {
    results.push({
      type: 'lexicon',
      label: `${entry.strongsNum}  ${entry.lemma}  (${entry.transliteration})`,
      sub: entry.gloss,
      action: () => { addRecentSearchQuery(query.trim()); goToLexicon(entry.strongsNum) },
    })
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

  // YouTube videos — transcript hits show the matching line + timestamp as the sub-label.
  // Multiple entries may exist for the same video when perVideoLimit > 1.
  for (const vid of youtubeResults) {
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
        const next = Math.min(i + 1, results.length - 1)
        setTimeout(() => selectedItemRef.current?.scrollIntoView({ block: 'nearest' }), 0)
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => {
        const prev = Math.max(i - 1, 0)
        setTimeout(() => selectedItemRef.current?.scrollIntoView({ block: 'nearest' }), 0)
        return prev
      })
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      closeSearch()
      openScriptureSearchTab(query.trim())
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      results[selectedIdx]?.action()
    }
  }

  const showHint = !query.trim()

  return (
    <Dialog.Root open={searchOpen} onOpenChange={(open) => !open && closeSearch()}>
      <AnimatePresence>
        {searchOpen && (
      <Dialog.Portal forceMount>
        <Dialog.Overlay asChild forceMount>
          <motion.div
            className="fixed inset-0 bg-black/50 z-50"
            style={{ backdropFilter: 'blur(4px)' }}
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
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Gen 1:1 · Exodus 20 · in the beginning..."
              className="
                flex-1 bg-transparent text-[rgb(var(--color-text-primary))]
                placeholder:text-[rgb(var(--color-text-muted))] text-sm outline-none
              "
            />
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
                        <kbd className="flex-shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">
                          {r.sub}
                        </kbd>
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
                      setSelectedIdx(0)
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
            <span><kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">↑↓</kbd> Navigate</span>
            <span><kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">↵</kbd> Open</span>
            <span><kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">⇧↵</kbd> Adv. search</span>
            <div className="flex-1" />
            {/* Word mode toggle */}
            <div className="flex items-center gap-0.5 bg-[rgb(var(--color-surface-4))] rounded p-0.5">
              {(['all', 'any', 'phrase'] as SearchWordMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => handleWordModeChange(m)}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors capitalize
                    ${searchWordMode === m ? 'bg-[rgb(var(--color-surface-2))] text-[rgb(var(--color-text-primary))] shadow-sm' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              onClick={() => { closeSearch(); openScriptureSearchTab(query.trim() || undefined) }}
              className="text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
            >
              Advanced →
            </button>
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
