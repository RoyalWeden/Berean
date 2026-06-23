import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronDown, BookOpen, ExternalLink, GitFork, Hash } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Book } from '@/types'
import { parseRef, bookName } from '@/lib/parseRef'
import { isStrongsQuery, parseStrongsQuery } from '@/lib/strongsSearch'
import { useAppStore } from '@/store'

function normalizeBookName(name: string): string {
  return name.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ')
}

type SearchMode = 'auto' | 'text' | 'crossref'
type ScopeFilter = 'all' | 'ot' | 'nt'

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
}

interface Props {
  onNavigate: (bookId: string, chapter: number, verse: number, textId: string) => void
  onAdvancedSearch: (query: string) => void
  onClose: () => void
  currentTextId?: string
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        new RegExp(escaped, 'gi').test(p)
          ? <mark key={i} className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm">{p}</mark>
          : p
      )}
    </>
  )
}

export default function ScriptureSearchFloating({ onNavigate, onAdvancedSearch, onClose, currentTextId = 'kjva' }: Props) {
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)

  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('auto')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [selectedTextId, setSelectedTextId] = useState(currentTextId)
  const [textDropdownOpen, setTextDropdownOpen] = useState(false)
  const [textDropRect, setTextDropRect] = useState<{ left: number; top: number } | null>(null)
  const textDropBtnRef = useRef<HTMLButtonElement>(null)
  const [bookFilter, setBookFilter] = useState<string>('all')
  const [books, setBooks] = useState<Book[]>([])
  const [results, setResults] = useState<(RawResult & { _textId: string })[]>([])
  const [crossRefs, setCrossRefs] = useState<CrossRef[]>([])
  const [crossRefsLoading, setCrossRefsLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [versePreview, setVersePreview] = useState<{ ref: string; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textDropRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus on open
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  // Load books for selected text
  useEffect(() => {
    window.bible.getBooks(selectedTextId)
      .then((raw) => setBooks(raw.map((b) => ({ ...b, name: normalizeBookName(b.name) }))))
      .catch(() => {})
    setBookFilter('all')
    setResults([])
  }, [selectedTextId])

  // Close text dropdown on outside click
  useEffect(() => {
    if (!textDropdownOpen) return
    function onDown(e: MouseEvent) {
      if (textDropRef.current && !textDropRef.current.contains(e.target as Node)) setTextDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [textDropdownOpen])

  const runSearch = useCallback(async (q: string, tid: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const rows = await window.bible.searchText(q.trim(), tid)
      setResults((rows as unknown as RawResult[]).map((r) => ({ ...r, _textId: tid })))
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

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
    if (searchMode === 'text') return 'text'
    if (searchMode === 'crossref') return 'crossref'
    // auto: strongs first, then ref, then text
    if (isStrongsQuery(q)) return 'strongs'
    return parseRef(q.trim()) ? 'crossref' : 'text'
  }

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

  function handleInput(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const mode = effectiveMode(val)
    if (mode === 'crossref') {
      debounceRef.current = setTimeout(() => runCrossRefSearch(val), 300)
    } else if (mode === 'text') {
      debounceRef.current = setTimeout(() => runSearch(val, selectedTextId), 300)
    }
    // strongs: no inline search — just surface the "Open Lexicon" action
  }

  function openLexicon(strongsNum: string) {
    openLexiconEntry(strongsNum)
    ensureTab('lexicon')
    setActiveSpace('lexicon')
    onClose()
  }

  const selectedText = ALL_TEXTS.find((t) => t.id === selectedTextId)

  // Apply scope filter (OT/NT) then book filter
  const scopedResults = results.filter((r) => {
    if (scopeFilter === 'all') return true
    const bk = books.find((b) => b.id === r.book_id)
    if (!bk) return true
    return scopeFilter === 'ot' ? bk.testament === 'OT' : bk.testament === 'NT'
  })
  const filteredResults = scopedResults.filter((r) => bookFilter === 'all' || r.book_id === bookFilter)
  const displayResults = filteredResults.slice(0, 30)
  const availableBooks = books.filter((b) => scopedResults.some((r) => r.book_id === b.id))

  const mode = effectiveMode(query)
  const strongsNum = mode === 'strongs' ? parseStrongsQuery(query) : null

  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="
            fixed left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2
            z-50 w-full max-w-xl
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden
            animate-in fade-in-0 zoom-in-95
          "
        >
          <Dialog.Title className="sr-only">Scripture Search</Dialog.Title>

          {/* Header — input + text selector */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgb(var(--color-surface-4))]">
            <Search size={16} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); onClose() }
                if (e.key === 'Enter' && strongsNum) { e.preventDefault(); openLexicon(strongsNum) }
              }}
              placeholder={searchMode === 'crossref' ? 'Verse reference… (e.g. Gen 1:1)' : 'Search scripture or Strong’s (H/G)…'}
              spellCheck={false}
              className="flex-1 bg-transparent text-sm outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] min-w-0"
            />
            {(loading || crossRefsLoading) && (
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] animate-pulse flex-shrink-0">Searching…</span>
            )}
            {!loading && !crossRefsLoading && filteredResults.length > 0 && mode === 'text' && (
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] tabular-nums flex-shrink-0">
                {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
              </span>
            )}

            {/* Text selector — hidden in crossref and strongs modes */}
            {mode !== 'crossref' && mode !== 'strongs' && (
              <div ref={textDropRef} className="relative flex-shrink-0">
                <button
                  ref={textDropBtnRef}
                  onClick={() => {
                    setTextDropdownOpen((v) => {
                      const next = !v
                      if (next && textDropBtnRef.current) {
                        const r = textDropBtnRef.current.getBoundingClientRect()
                        const W = 176, MAX_H = window.innerHeight * 0.6, pad = 8
                        const left = Math.max(pad, Math.min(r.right - W, window.innerWidth - W - pad))
                        const spaceBelow = window.innerHeight - r.bottom - pad
                        const top = spaceBelow >= MAX_H / 2 ? r.bottom + 4 : Math.max(pad, r.top - MAX_H - 4)
                        setTextDropRect({ left, top })
                      }
                      return next
                    })
                  }}
                  className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  {selectedText?.label ?? selectedTextId.toUpperCase()}
                  <ChevronDown size={10} />
                </button>
                {textDropdownOpen && textDropRect && createPortal(
                  <div
                    className="fixed z-[9999] w-44 max-h-[60vh] overflow-y-auto bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl py-1"
                    style={{ left: textDropRect.left, top: textDropRect.top }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Bible</div>
                    {ALL_TEXTS.filter((t) => t.category === 'bible').map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setSelectedTextId(t.id); setTextDropdownOpen(false); if (query.trim().length >= 2) runSearch(query, t.id) }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${selectedTextId === t.id ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}
                      >
                        {t.label}
                      </button>
                    ))}
                    <div className="px-2 py-1 mt-1 text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Pseudepigrapha</div>
                    {ALL_TEXTS.filter((t) => t.category === 'pseudo').map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setSelectedTextId(t.id); setTextDropdownOpen(false); if (query.trim().length >= 2) runSearch(query, t.id) }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${selectedTextId === t.id ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>

          {/* Mode + scope bar */}
          <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))]">
            <span className="text-[9px] uppercase tracking-wider text-[rgb(var(--color-text-muted))] mr-1">Mode</span>
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

            {/* Scope chips — only relevant for text search */}
            {mode === 'text' && (
              <>
                <div className="w-px h-3 bg-[rgb(var(--color-surface-4))] mx-1" />
                {(['all', 'ot', 'nt'] as ScopeFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setScopeFilter(s); setBookFilter('all') }}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      scopeFilter === s
                        ? 'bg-[rgb(var(--color-accent))]/20 border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]'
                        : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'
                    }`}
                  >
                    {s === 'all' ? 'All' : s === 'ot' ? 'OT' : 'NT'}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Strong's detection prompt */}
          {mode === 'strongs' && strongsNum && (
            <div className="px-4 py-3 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash size={13} className="text-[rgb(var(--color-accent))]" />
                <span className="text-xs font-semibold text-[rgb(var(--color-accent))]">{strongsNum}</span>
                <span className="text-[11px] text-[rgb(var(--color-text-muted))]">Strong's lexicon entry</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openLexicon(strongsNum)}
                  className="flex items-center gap-1 text-[11px] px-3 py-1 rounded-lg bg-[rgb(var(--color-accent))] text-white font-medium hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Open in Lexicon
                </button>
                <button
                  onClick={() => { onAdvancedSearch(query) }}
                  className="flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                  title="Search all verses with this number in Advanced Search"
                >
                  Search verses →
                </button>
              </div>
            </div>
          )}

          {/* Book filter (shown only when there are results with multiple books) */}
          {mode === 'text' && availableBooks.length > 1 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))] overflow-x-auto">
              <button
                onClick={() => setBookFilter('all')}
                className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${bookFilter === 'all' ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'}`}
              >
                All
              </button>
              {availableBooks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBookFilter(b.id === bookFilter ? 'all' : b.id)}
                  className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${bookFilter === b.id ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white' : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))]'}`}
                >
                  {b.short_name ?? b.name}
                </button>
              ))}
            </div>
          )}

          {/* Verse preview */}
          {mode === 'crossref' && versePreview && (
            <div className="px-4 py-3 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))]">
              <p className="text-[10px] font-semibold text-[rgb(var(--color-accent))] mb-1">{versePreview.ref}</p>
              <p className="text-[11px] text-[rgb(var(--color-text-primary))] leading-relaxed">{versePreview.text}</p>
            </div>
          )}

          {/* Cross-ref results */}
          {mode === 'crossref' && crossRefs.length > 0 && (
            <div className="overflow-y-auto max-h-80">
              {crossRefs.slice(0, 30).map((r, i) => {
                const ref = r.endVerse
                  ? `${bookName(r.bookId)} ${r.chapter}:${r.verse}–${r.endVerse}`
                  : `${bookName(r.bookId)} ${r.chapter}:${r.verse}`
                const strength = Math.max(0, Math.min(Math.ceil(r.votes / 3), 5))
                return (
                  <button
                    key={i}
                    onClick={() => onNavigate(r.bookId, r.chapter, r.verse, 'kjva')}
                    className="w-full text-left px-4 py-2.5 hover:bg-[rgb(var(--color-surface-3))] transition-colors border-b border-[rgb(var(--color-surface-4))]/50 last:border-b-0 cursor-pointer group"
                  >
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-[11px] font-semibold text-[rgb(var(--color-accent))]">{ref}</span>
                      <span className="text-[9px] text-[rgb(var(--color-text-muted))]">{'●'.repeat(strength)}{'○'.repeat(5 - strength)}</span>
                    </div>
                    {r.text && (
                      <div className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-snug line-clamp-2">
                        {r.text.length > 120 ? r.text.slice(0, 120) + '…' : r.text}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {mode === 'crossref' && !crossRefsLoading && crossRefs.length === 0 && query.trim().length >= 2 && (
            <div className="px-4 py-5 text-center text-xs text-[rgb(var(--color-text-muted))]">
              {parseRef(query.trim())
                ? 'No cross-references found for this verse'
                : 'Enter a verse reference (e.g. Gen 1:1)'}
            </div>
          )}

          {/* Text search results */}
          {mode === 'text' && displayResults.length > 0 && (
            <div className="overflow-y-auto max-h-80">
              {displayResults.map((r, i) => {
                const book = books.find((b) => b.id === r.book_id)
                const ref = book ? `${book.name} ${r.chapter}:${r.verse_num}` : `${r.book_id} ${r.chapter}:${r.verse_num}`
                const snippet = r.text.length > 130 ? r.text.slice(0, 130) + '…' : r.text
                return (
                  <button
                    key={i}
                    onClick={() => onNavigate(r.book_id, r.chapter, r.verse_num, r._textId)}
                    className="w-full text-left px-4 py-2.5 hover:bg-[rgb(var(--color-surface-3))] transition-colors border-b border-[rgb(var(--color-surface-4))]/50 last:border-b-0 cursor-pointer"
                  >
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-[11px] font-semibold text-[rgb(var(--color-accent))]">{ref}</span>
                    </div>
                    <div className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-snug">
                      {highlight(snippet, query)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {mode === 'text' && query.length >= 2 && !loading && filteredResults.length === 0 && (
            <div className="px-4 py-5 text-center text-xs text-[rgb(var(--color-text-muted))]">
              No results for <span className="font-medium text-[rgb(var(--color-text-secondary))]">"{query}"</span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-[rgb(var(--color-surface-4))]">
            <span className="text-[10px] text-[rgb(var(--color-text-muted))]">
              <kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">↵</kbd> Open
              {' · '}
              <kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> Close
            </span>
            <button
              onClick={() => onAdvancedSearch(query)}
              className="flex items-center gap-1 text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
            >
              <BookOpen size={10} />
              More filters →
              <ExternalLink size={9} />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
