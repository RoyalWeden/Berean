import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, BookOpen, Hash, BookMarked, StickyNote } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { useAppStore } from '@/store'
import { parseRef, isStrongsRef, getTranslationForBook } from '@/lib/parseRef'
import type { Book, LexiconEntry, Note } from '@/types'

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
}

function normalizeBookName(name: string): string {
  return name.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ')
}

function detectTranslationPrefix(q: string): { textId: string; cleanQuery: string } | null {
  const lower = q.trim().toLowerCase()
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

  type SearchWordMode = 'all' | 'any' | 'phrase'

  const inputRef = useRef<HTMLInputElement>(null)
  const selectedItemRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [searchWordMode, setSearchWordMode] = useState<SearchWordMode>('all')
  const [searchTextId, setSearchTextId] = useState(defaultBibleTranslation.toLowerCase())
  const [books, setBooks] = useState<Book[]>([])
  const [verseResults, setVerseResults] = useState<VerseResult[]>([])
  const [lexiconResults, setLexiconResults] = useState<LexiconEntry[]>([])
  const [noteResults, setNoteResults] = useState<Note[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchOpen) {
      const tid = defaultBibleTranslation.toLowerCase()
      setSearchTextId(tid)
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setVerseResults([])
      setLexiconResults([])
      setNoteResults([])
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
    if (mode === 'phrase') return `"${trimmed}"`
    if (mode === 'any') return trimmed.split(/\s+/).filter(Boolean).join(' OR ')
    return trimmed // 'all' — FTS5 default treats space as AND
  }

  // Debounced FTS search
  const runSearch = useCallback((q: string, tid: string, mode: SearchWordMode = 'all') => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const trimmed = q.trim()
      setVerseResults([])
      setLexiconResults([])
      setNoteResults([])
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
      const [verses, notes, ...extraAll] = await Promise.allSettled([
        window.bible.searchText(ftsQ, tid),
        window.notes.searchNotes(trimmed, 5),
        ...extraSearches,
      ])

      const primaryVerse = verses.status === 'fulfilled' ? verses.value as unknown as VerseResult[] : []
      const extraVerses: VerseResult[] = extraAll.flatMap((r) => r.status === 'fulfilled' ? r.value : [])
      setVerseResults([...primaryVerse, ...extraVerses])
      setNoteResults(notes.status === 'fulfilled' ? notes.value : [])
    }, 350)
  }, [])

  function handleInput(val: string) {
    setQuery(val)
    setSelectedIdx(0)
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

    if (searchMode === 'new') {
      const id = `bible-${Date.now()}`
      addTab({
        id,
        spaceId: 'scripture',
        type: 'bible',
        title: targetVerse ? `${chapterLabel}:${targetVerse}` : chapterLabel,
        state: { bookId, chapter, endChapter, translation, showStrongs: false, scrollPosition: 0, targetVerse, endVerse },
      })
    } else {
      const activeId = activeTabId['scripture']
      const scriptureTab = activeId
        ? tabs['scripture'].find((t) => t.id === activeId)
        : tabs['scripture'].find((t) => t.type === 'bible')
      if (scriptureTab) {
        const title = targetVerse ? `${chapterLabel}:${targetVerse}` : chapterLabel
        updateTabState('scripture', scriptureTab.id, { bookId, chapter, endChapter, scrollPosition: 0, targetVerse, endVerse, translation })
        renameTab('scripture', scriptureTab.id, title)
      }
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
  const results: Array<{ type: 'ref' | 'verse' | 'lexicon' | 'note'; label: string; sub: string; action: () => void }> = []

  if (parsedRef) {
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
      action: () => navigate(
        parsedRef.bookId,
        parsedRef.chapter,
        parsedRef.verse,
        parsedRef.endVerse,
        getTranslationForBook(parsedRef.bookId) ?? undefined,
        parsedRef.endChapter,
      ),
    })
  }

  for (const entry of lexiconResults) {
    results.push({
      type: 'lexicon',
      label: `${entry.strongsNum}  ${entry.lemma}  (${entry.transliteration})`,
      sub: entry.gloss,
      action: () => goToLexicon(entry.strongsNum),
    })
  }

  for (const note of noteResults.slice(0, 4)) {
    const snippet = note.content
      .replace(/^---[\s\S]*?---\n?/, '')
      .replace(/[#*`_>~\[\]]/g, '')
      .replace(/\n/g, ' ')
      .trim()
    results.push({
      type: 'note' as const,
      label: note.title || 'Untitled note',
      sub: snippet.length > 80 ? snippet.slice(0, 80) + '…' : snippet || 'Empty note',
      action: () => {
        ensureTab('note')
        setActiveSpace('notes')
        requestOpenNote(note.id)
        closeSearch()
      },
    })
  }

  for (const v of verseResults.slice(0, 12)) {
    const book = books.find((b) => b.id === v.book_id)
    const sourceLabel = v.sourceTextName ? ` · ${v.sourceTextName}` : ''
    results.push({
      type: 'verse',
      label: `${book?.short_name ?? v.book_id} ${v.chapter}:${v.verse_num}${sourceLabel}`,
      sub: v.text.length > 80 ? v.text.slice(0, 80) + '…' : v.text,
      action: () => navigate(v.book_id, v.chapter, v.verse_num, undefined, v.sourceTextId),
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
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="
            fixed left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2
            z-50 w-full max-w-2xl
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden
            animate-in fade-in-0 zoom-in-95
          "
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
            {isStrongs && (
              <span className="text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] px-1.5 py-0.5 rounded">
                Strong's
              </span>
            )}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="max-h-72 overflow-y-auto py-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  ref={i === selectedIdx ? selectedItemRef : undefined}
                  onClick={r.action}
                  className="w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer hover:bg-[rgb(var(--color-surface-3))]"
                  style={i === selectedIdx ? {
                    backgroundColor: 'rgb(var(--color-accent) / 0.18)',
                    borderLeft: '2px solid rgb(var(--color-accent))',
                    paddingLeft: '14px',
                  } : { borderLeft: '2px solid transparent', paddingLeft: '14px' }}
                >
                  <span className="flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))]">
                    {r.type === 'ref' ? <BookOpen size={14} /> : r.type === 'lexicon' ? <BookMarked size={14} /> : r.type === 'note' ? <StickyNote size={14} /> : <Hash size={14} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[rgb(var(--color-text-primary))] block">
                      {r.label}
                    </span>
                    <span className="text-xs text-[rgb(var(--color-text-muted))] truncate block">
                      {r.sub}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Hint when empty */}
          {showHint && (
            <div className="px-4 py-4 text-center text-xs text-[rgb(var(--color-text-muted))]">
              Try{' '}
              <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">Gen 1:1</span>
              {' · '}
              <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">Exodus 20</span>
              {' · '}
              <span className="font-mono bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded">in the beginning</span>
            </div>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
