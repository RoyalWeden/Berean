import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Info, Check, ArrowLeft, ArrowRight } from 'lucide-react'
import BookChapterPicker from './BookChapterPicker'
import { ANNOTATION_KEYS, TRANSLATIONS } from '@/lib/bibleTexts'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { useAppStore } from '@/store'
import type { Verse, Book } from '@/types'

function applyFindHighlight(text: string, query: string, wordMode: 'phrase' | 'all' | 'any' = 'phrase'): React.ReactNode {
  if (!query.trim()) return text
  let pattern: string
  if (wordMode === 'phrase') {
    pattern = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  } else {
    const words = query.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
    if (!words.length) return text
    pattern = words.join('|')
  }
  const splitRe = new RegExp(`(${pattern})`, 'gi')
  const matchRe = new RegExp(`^(?:${pattern})$`, 'i')
  const parts = text.split(splitRe)
  if (parts.length <= 1) return text
  return (
    <>
      {parts.map((p, i) =>
        matchRe.test(p)
          ? <mark key={i} style={{ backgroundColor: 'rgba(234,179,8,0.42)', borderRadius: '2px', padding: '0 1px' }}>{p}</mark>
          : p
      )}
    </>
  )
}

interface ColState {
  id: string
  textId: string
  bookId: string
  chapter: number
  verses: Verse[]
  loading: boolean
}

interface Props {
  bookId: string
  chapter: number
  targetVerse?: number
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  onColumnFocus?: (colIdx: number) => void
  onColumnRef?: (colIdx: number, el: HTMLDivElement | null) => void
  books?: Book[]
  addColRef?: React.MutableRefObject<(() => void) | null>
}

// ── Annotation info popover (read-only, per column) ───────────────────────────

function ColInfoPopover({ textId, onClose }: { textId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const annInfo = ANNOTATION_KEYS[textId]
  if (!annInfo) return null
  const label = TRANSLATIONS.find(t => t.id === textId)?.label ?? textId.toUpperCase()

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 z-50 w-64 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden"
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-[rgb(var(--color-surface-4))]">
        <span className="text-xs font-semibold text-[rgb(var(--color-text-secondary))]">
          {label} — Annotations
        </span>
      </div>
      <div className="px-3 py-2 space-y-2.5">
        {annInfo.keys.map(k => (
          <div key={k.key} className="flex gap-2 items-start">
            <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] flex-shrink-0 mt-0.5">
              {k.symbol}
            </code>
            <span className="text-[11px] leading-relaxed text-[rgb(var(--color-text-secondary))]">{k.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Per-column translation dropdown ──────────────────────────────────────────

function TranslationDropdown({ textId, onChange }: { textId: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const label = TRANSLATIONS.find(t => t.id === textId)?.label ?? textId.toUpperCase()

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
      >
        {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 z-50 min-w-[170px] bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden py-1">
          {TRANSLATIONS.map(t => (
            <button
              key={t.id}
              onClick={e => { e.stopPropagation(); onChange(t.id); setOpen(false) }}
              className={`flex items-center gap-2 w-full px-2.5 py-1 text-left transition-colors cursor-pointer ${
                textId === t.id
                  ? 'text-[rgb(var(--color-accent))]'
                  : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
              }`}
            >
              <Check size={10} className={textId === t.id ? 'opacity-100 flex-shrink-0' : 'opacity-0 flex-shrink-0'} />
              <span className="text-[11px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main compare view ──────────────────────────────────────────────────────────

export default function CompareView({ bookId, chapter, targetVerse, findQuery = '', findWordMode = 'phrase', onColumnFocus, onColumnRef, books: propBooks, addColRef }: Props) {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const bibleFontSize = useAppStore((s) => s.bibleFontSize)
  const [booksByText, setBooksByText] = useState<Record<string, Book[]>>({})
  const [columns, setColumns] = useState<ColState[]>(() => [
    { id: 'col-0', textId: 'kjva', bookId, chapter, verses: [], loading: true },
    { id: 'col-1', textId: 'lxx',  bookId, chapter, verses: [], loading: true },
  ])
  const [focusedCol, setFocusedCol] = useState(0)
  const [infoOpenFor, setInfoOpenFor] = useState<string | null>(null)
  const colRefs = useRef<(HTMLDivElement | null)[]>([])
  const fetchingRef = useRef<Set<string>>(new Set())
  const requestedBooksRef = useRef<Set<string>>(new Set())
  const colIdCounter = useRef(2)

  function ensureBooksFor(textId: string) {
    if (requestedBooksRef.current.has(textId)) return
    requestedBooksRef.current.add(textId)
    window.bible.getBooks(textId)
      .then(bks => setBooksByText(prev => ({ ...prev, [textId]: bks })))
      .catch(() => {})
  }

  useEffect(() => {
    ensureBooksFor('kjva')
    ensureBooksFor('lxx')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (propBooks && propBooks.length > 0) {
      setBooksByText(prev => prev['kjva'] ? prev : { ...prev, kjva: propBooks })
      requestedBooksRef.current.add('kjva')
    }
  }, [propBooks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep addColRef pointing at the latest addColumn
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  useEffect(() => {
    if (!addColRef) return
    addColRef.current = () => {
      const cols = columnsRef.current
      const last = cols[cols.length - 1] ?? { textId: 'kjva', bookId, chapter }
      const newId = `col-${colIdCounter.current++}`
      const usedIds = new Set(cols.map(c => c.textId))
      const next = TRANSLATIONS.find(t => !usedIds.has(t.id)) ?? TRANSLATIONS[0]
      ensureBooksFor(next.id)
      setColumns(prev => [...prev, {
        id: newId,
        textId: next.id,
        bookId: last.bookId,
        chapter: last.chapter,
        verses: [],
        loading: true,
      }])
    }
    return () => { if (addColRef) addColRef.current = null }
  }) // runs every render to keep addColumn fresh

  // Fetch verses for columns that need loading
  useEffect(() => {
    for (const col of columns) {
      if (!col.loading) continue
      const key = `${col.id}|${col.textId}|${col.bookId}|${col.chapter}`
      if (fetchingRef.current.has(key)) continue
      fetchingRef.current.add(key)
      window.bible.queryChapter(col.bookId, col.chapter, col.textId)
        .then(verses => {
          fetchingRef.current.delete(key)
          setColumns(prev => prev.map(c =>
            c.id === col.id && c.textId === col.textId && c.bookId === col.bookId && c.chapter === col.chapter
              ? { ...c, verses: verses ?? [], loading: false }
              : c
          ))
        })
        .catch(() => {
          fetchingRef.current.delete(key)
          setColumns(prev => prev.map(c =>
            c.id === col.id && c.textId === col.textId && c.bookId === col.bookId && c.chapter === col.chapter
              ? { ...c, verses: [], loading: false }
              : c
          ))
        })
    }
  }, [columns]) // eslint-disable-line react-hooks/exhaustive-deps

  function removeColumn(colId: string) {
    setColumns(prev => prev.length <= 1 ? prev : prev.filter(c => c.id !== colId))
  }

  function moveColumn(colId: string, dir: -1 | 1) {
    setColumns(prev => {
      const idx = prev.findIndex(c => c.id === colId)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }

  function navigateColumn(colId: string, newBookId: string, newChapter: number) {
    setColumns(prev => prev.map(c =>
      c.id === colId ? { ...c, bookId: newBookId, chapter: newChapter, verses: [], loading: true } : c
    ))
  }

  function changeTranslation(colId: string, newTextId: string) {
    ensureBooksFor(newTextId)
    setColumns(prev => prev.map(c =>
      c.id === colId ? { ...c, textId: newTextId, verses: [], loading: true } : c
    ))
  }

  // Each column renders its own verse list independently — no shared alignment.
  // If column A has 12 verses and column B has 15, they each show their own count.

  return (
    <div className="flex-1 overflow-hidden flex">
      {columns.map((col, colIdx) => {
        const isFocused = focusedCol === colIdx
        const booksForCol = booksByText[col.textId] ?? propBooks ?? []
        const currentBook = booksForCol.find(b => b.id === col.bookId)
        const maxChapter = currentBook?.chapters_count ?? 999
        const hasInfo = !!ANNOTATION_KEYS[col.textId]

        return (
          <div
            key={col.id}
            ref={el => {
              colRefs.current[colIdx] = el
              onColumnRef?.(colIdx, el)
            }}
            onClick={() => { setFocusedCol(colIdx); onColumnFocus?.(colIdx) }}
            className={`flex-1 overflow-y-auto min-w-0 flex flex-col ${colIdx < columns.length - 1 ? 'border-r border-[rgb(var(--color-surface-4))]' : ''}`}
          >
            {/* Column header */}
            <div
              className={`sticky top-0 z-10 border-b border-[rgb(var(--color-surface-4))] flex flex-col flex-shrink-0 ${isFocused ? 'bg-[rgb(var(--color-surface-3))]' : 'bg-[rgb(var(--color-surface-2))]'}`}
              onClick={e => e.stopPropagation()}
            >
              {/* Row 1: translation + reorder/close controls */}
              <div className="flex items-center gap-1 px-2 pt-1.5 pb-1">
                <TranslationDropdown
                  textId={col.textId}
                  onChange={id => changeTranslation(col.id, id)}
                />
                <div className="flex-1" />
                {hasInfo && (
                  <div className="relative">
                    <button
                      onClick={() => setInfoOpenFor(infoOpenFor === col.id ? null : col.id)}
                      title="Annotation key"
                      className={`p-0.5 rounded transition-colors cursor-pointer ${infoOpenFor === col.id ? 'text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                    >
                      <Info size={11} />
                    </button>
                    {infoOpenFor === col.id && (
                      <ColInfoPopover textId={col.textId} onClose={() => setInfoOpenFor(null)} />
                    )}
                  </div>
                )}
                <button
                  onClick={() => moveColumn(col.id, -1)}
                  disabled={colIdx === 0}
                  title="Move left"
                  className="p-0.5 rounded transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-default"
                >
                  <ArrowLeft size={11} />
                </button>
                <button
                  onClick={() => moveColumn(col.id, 1)}
                  disabled={colIdx === columns.length - 1}
                  title="Move right"
                  className="p-0.5 rounded transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-default"
                >
                  <ArrowRight size={11} />
                </button>
                <button
                  onClick={() => removeColumn(col.id)}
                  disabled={columns.length <= 1}
                  title="Close panel"
                  className="p-0.5 rounded transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-default"
                >
                  <X size={11} />
                </button>
              </div>

              {/* Row 2: prev | book/chapter picker | next */}
              <div className="flex items-center gap-0.5 px-2 pb-1.5">
                <button
                  onClick={() => navigateColumn(col.id, col.bookId, Math.max(1, col.chapter - 1))}
                  disabled={col.chapter <= 1}
                  className="p-0.5 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-default transition-colors flex-shrink-0"
                >
                  <ChevronLeft size={12} />
                </button>
                <div className="flex-1 min-w-0">
                  <BookChapterPicker
                    books={booksForCol}
                    currentBookId={col.bookId}
                    currentChapter={col.chapter}
                    onNavigate={(bId, ch) => navigateColumn(col.id, bId, ch)}
                    compact
                  />
                </div>
                <button
                  onClick={() => navigateColumn(col.id, col.bookId, Math.min(maxChapter, col.chapter + 1))}
                  disabled={col.chapter >= maxChapter}
                  className="p-0.5 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-default transition-colors flex-shrink-0"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>

            {/* Verse content */}
            {col.loading ? (
              <div className="px-3 py-4 space-y-2 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-3 bg-[rgb(var(--color-surface-4))] rounded w-full" />
                ))}
              </div>
            ) : col.verses.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[rgb(var(--color-text-muted))] text-center">
                Not available in this text
              </div>
            ) : (
              <div className="px-3 py-3 space-y-2 berean-scripture-text" style={{ fontSize: bibleFontSize }}>
                {col.verses.map(verse => {
                  const vn = verse.verse_num
                  const isTarget = targetVerse === vn
                  const isFindMatch = isFocused && !!findQuery.trim() && (() => {
                    const t = verse.text.toLowerCase(); const q = findQuery.trim().toLowerCase()
                    if (findWordMode === 'phrase') return t.includes(q)
                    const ws = q.split(/\s+/).filter(Boolean)
                    return findWordMode === 'all' ? ws.every(w => t.includes(w)) : ws.some(w => t.includes(w))
                  })()
                  return (
                    <div
                      key={vn}
                      data-verse={vn}
                      className={`flex gap-2 leading-relaxed ${isTarget ? 'bg-[rgb(var(--color-accent))/8] -mx-1 px-1 rounded' : ''}`}
                      style={isFindMatch ? { borderLeft: '3px solid rgba(234,179,8,0.5)', paddingLeft: '0.375rem', marginLeft: '-0.5rem', borderRadius: '0 3px 3px 0', backgroundColor: 'rgba(234,179,8,0.06)' } : undefined}
                    >
                      <span className={`font-mono flex-shrink-0 pt-0.5 w-6 text-right text-[0.8em] ${isTarget ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
                        {vn}
                      </span>
                      <span className="text-[rgb(var(--color-text-primary))]" data-verse-text>
                        {(() => {
                          const t = (wordReplacerEnabled && wordReplacerRules.length > 0)
                            ? applyWordReplacer(verse.text, wordReplacerRules)
                            : verse.text
                          return isFocused ? applyFindHighlight(t, findQuery, findWordMode) : t
                        })()}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
