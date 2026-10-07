import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { BackButton } from '../primitives/Page'
import type { Book } from '@/types'
import { parseRef, ALL_BOOKS, bookName, displayBookName } from '@/lib/parseRef'
export { PassagePicker, type PassagePick, type PassagePickerProps } from './PassagePicker'
import { haptic } from '../primitives/haptics'
import { displayChapter, chapterNumberingNote } from '@/lib/chapterNumbering'

type Pick = (bookId: string, chapter: number, verse?: number, endVerse?: number) => void

/** Books whose full name (or a word of it) starts with the query, then those containing it. */
export function matchBooks<T extends { id: string; name: string }>(books: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return [...books]
  const starts: T[] = [], words: T[] = [], contains: T[] = []
  for (const b of books) {
    const n = b.name.toLowerCase()
    if (n.startsWith(q)) starts.push(b)
    else if (n.split(/\s+/).some((w) => w.startsWith(q))) words.push(b)
    else if (n.includes(q)) contains.push(b)
  }
  return [...starts, ...words, ...contains]
}

/**
 * LEGACY flat passage navigator — superseded by the hierarchical `PassagePicker` (NEW-11,
 * re-exported above); kept with its old props so existing callers compile until they are rewired.
 *
 * The reader's passage navigator (TEST-041): tapping the book/chapter title opens this floating
 * search. Type naturally — "John 3:16", "Genesis 1", "1 Corinthians 13", "Psalm 23:1-6" — or
 * filter books by their FULL names and tap book → chapter (→ verses; tap a second verse for a
 * range). It edits the CURRENT tab through the shared navigateToVerse (caller's onPick), so an
 * LXX reader jumping to a New Testament book lands in KJV, and an impossible chapter opens 1.
 * Books of the current text come first; every other Scripture book in the library is listed
 * under "Other books".
 */
export function ReferencePicker({ books, bookId, chapter, onPick }: { books: Book[]; bookId: string; chapter: number; onPick: Pick }) {
  const [query, setQuery] = useState('')
  const [pickBook, setPickBook] = useState<{ id: string; name: string; chapters: number } | null>(null)
  const [pickChapter, setPickChapter] = useState<number | null>(null)
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 250); return () => clearTimeout(t) }, [])

  const parsed = useMemo(() => {
    const q = query.trim()
    // A reference needs a number AFTER the book name — "1 cor" is still a book search (1 Corinthians),
    // "1 cor 13" is a reference.
    if (!q || !/\p{L}.*\d/u.test(q)) return null
    return parseRef(q)
  }, [query])
  const inText = useMemo(() => books.map((b) => ({ id: b.id, name: displayBookName(b.name, b.id), chapters: b.chapters_count, testament: b.testament })), [books])
  const others = useMemo(() => {
    const have = new Set(books.map((b) => b.id))
    return ALL_BOOKS.filter((b) => !have.has(b.id)).map((b) => ({ id: b.id, name: b.name, chapters: 0, testament: 'Other books' }))
  }, [books])
  const bookQuery = parsed ? '' : query
  const matched = useMemo(() => [...matchBooks(inText, bookQuery), ...matchBooks(others, bookQuery)], [inText, others, bookQuery])

  const go: Pick = (b, c, v, e) => { void haptic.selection(); onPick(b, c, v, e) }
  const verseCount = 176 // grid upper bound; the reader clamps to the real chapter

  // ── verse step ──────────────────────────────────────────────────────────────────────────
  if (pickBook && pickChapter != null) {
    return (
      <div className="mobile-ref-picker">
        <div className="mobile-ref-picker-head"><BackButton onClick={() => { setPickChapter(null); setRangeStart(null) }} label={pickBook.name} /><span className="mobile-ref-picker-title">{pickBook.name} {displayChapter(pickBook.id, pickChapter)}</span></div>
        <p className="mobile-muted mobile-ref-hint">{rangeStart ? `From verse ${rangeStart} — tap the last verse, or ${rangeStart} again for one verse` : 'Tap a verse, or two verses for a range'}</p>
        <div className="mobile-grid-numbers">
          <button type="button" className="mobile-grid-cell is-wide" onClick={() => go(pickBook.id, pickChapter)}>Whole chapter</button>
          {Array.from({ length: verseCount }, (_, i) => i + 1).map((v) => (
            <button key={v} type="button" className={`mobile-grid-cell${rangeStart === v ? ' is-current' : ''}`} onClick={() => {
              if (rangeStart == null) { setRangeStart(v); void haptic.selection(); return }
              if (v === rangeStart) { go(pickBook.id, pickChapter, v); return }
              go(pickBook.id, pickChapter, Math.min(rangeStart, v), Math.max(rangeStart, v))
            }}>{v}</button>
          ))}
        </div>
      </div>
    )
  }
  // ── chapter step ────────────────────────────────────────────────────────────────────────
  if (pickBook) {
    const count = pickBook.chapters || 150
    return (
      <div className="mobile-ref-picker">
        <div className="mobile-ref-picker-head"><BackButton onClick={() => setPickBook(null)} label="Books" /><span className="mobile-ref-picker-title">{pickBook.name}</span></div>
        {chapterNumberingNote(pickBook.id) && <p className="mobile-muted mobile-ref-hint">{chapterNumberingNote(pickBook.id)}</p>}
        <div className="mobile-grid-numbers">
          {Array.from({ length: count }, (_, i) => i + 1).map((c) => (
            <button key={c} type="button" className={`mobile-grid-cell${pickBook.id === bookId && c === chapter ? ' is-current' : ''}`}
              onClick={() => go(pickBook.id, c)} aria-label={`${pickBook.name} ${displayChapter(pickBook.id, c)}`}>{displayChapter(pickBook.id, c)}</button>
          ))}
        </div>
        <button type="button" className="mobile-button" onClick={() => setPickChapter(pickBook.id === bookId ? chapter : 1)}>Choose verses…</button>
      </div>
    )
  }
  // ── search / book step ──────────────────────────────────────────────────────────────────
  const groups: Array<[string, typeof matched]> = []
  for (const b of matched) {
    const g = groups.find(([t]) => t === b.testament)
    if (g) g[1].push(b); else groups.push([b.testament, [b]])
  }
  const goLabel = parsed ? `${bookName(parsed.bookId)} ${displayChapter(parsed.bookId, parsed.chapter)}${parsed.verse ? `:${parsed.verse}${parsed.endVerse ? `–${parsed.endVerse}` : ''}` : ''}` : ''
  return (
    <div className="mobile-ref-picker">
      <form className="mobile-search-field" onSubmit={(e) => {
        e.preventDefault()
        if (parsed) go(parsed.bookId, parsed.chapter, parsed.verse, parsed.endVerse)
        else if (matched[0]) setPickBook(matched[0])
      }}>
        <Search size={18} aria-hidden />
        <input ref={inputRef} className="mobile-search-input" type="search" inputMode="text" autoCorrect="off" enterKeyHint="go"
          placeholder="John 3:16, Genesis 1, Psalm 23:1-6…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Book, chapter or verse" />
      </form>
      {parsed && (
        <button type="button" className="mobile-ref-go" onClick={() => go(parsed.bookId, parsed.chapter, parsed.verse, parsed.endVerse)}>
          <CornerDownLeft size={18} aria-hidden /><span>Go to <strong>{goLabel}</strong></span>
        </button>
      )}
      {!parsed && groups.map(([testament, list]) => (
        <section key={testament} className="mobile-book-group">
          <h3>{testament}</h3>
          <div className="mobile-book-list">
            {list.map((b) => (
              <button key={b.id} type="button" className={`mobile-book-row${b.id === bookId ? ' is-current' : ''}`} onClick={() => {
                if (b.chapters === 1) { go(b.id, 1); return }
                setPickBook(b)
              }}>{b.name}</button>
            ))}
          </div>
        </section>
      ))}
      {!parsed && matched.length === 0 && <div className="mobile-empty">No book matches “{query}”.</div>}
    </div>
  )
}
