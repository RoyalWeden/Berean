import React, { useMemo, useState } from 'react'
import type { Book } from '@/types'
import { parseRef } from '@/lib/parseRef'
import { haptic } from '../primitives/haptics'

/**
 * Reference picker sheet (R070): type a reference, or tap book → chapter → (optional) verse.
 * Books are grouped by testament as the desktop picker does.
 */
export function ReferencePicker({ books, bookId, chapter, onPick }: { books: Book[]; bookId: string; chapter: number; onPick: (bookId: string, chapter: number, verse?: number) => void }) {
  const [query, setQuery] = useState('')
  const [pickBook, setPickBook] = useState<Book | null>(null)
  const [pickChapter, setPickChapter] = useState<number | null>(null)
  const groups = useMemo(() => {
    const g = new Map<string, Book[]>()
    for (const b of books) { const arr = g.get(b.testament) ?? []; arr.push(b); g.set(b.testament, arr) }
    return [...g.entries()]
  }, [books])
  const parsed = query.trim() ? parseRef(query) : null

  if (pickBook && pickChapter != null) {
    return (
      <div className="mobile-ref-picker">
        <button type="button" className="mobile-link-button" onClick={() => setPickChapter(null)}>‹ {pickBook.name} {pickChapter}</button>
        <div className="mobile-grid-numbers">
          <button type="button" className="mobile-grid-cell is-wide" onClick={() => onPick(pickBook.id, pickChapter)}>Whole chapter</button>
          {Array.from({ length: 176 }, (_, i) => i + 1).map((v) => (
            <button key={v} type="button" className="mobile-grid-cell" onClick={() => { void haptic.selection(); onPick(pickBook.id, pickChapter, v) }}>{v}</button>
          ))}
        </div>
      </div>
    )
  }
  if (pickBook) {
    return (
      <div className="mobile-ref-picker">
        <button type="button" className="mobile-link-button" onClick={() => setPickBook(null)}>‹ {pickBook.name}</button>
        <div className="mobile-grid-numbers">
          {Array.from({ length: pickBook.chapters_count }, (_, i) => i + 1).map((c) => (
            <button key={c} type="button" className={`mobile-grid-cell${pickBook.id === bookId && c === chapter ? ' is-current' : ''}`}
              onClick={() => { void haptic.selection(); setPickChapter(c) }}
              onDoubleClick={() => onPick(pickBook.id, c)}>{c}</button>
          ))}
        </div>
        <button type="button" className="mobile-button" onClick={() => onPick(pickBook.id, 1)}>Open {pickBook.name} 1</button>
      </div>
    )
  }
  return (
    <div className="mobile-ref-picker">
      <form onSubmit={(e) => { e.preventDefault(); if (parsed) onPick(parsed.bookId, parsed.chapter, parsed.verse) }}>
        <input className="mobile-input" type="search" inputMode="text" autoCorrect="off" autoCapitalize="words" placeholder="Gen 1:1, Exodus 20, Rev 22:1-5…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Reference" />
        {parsed && <button type="submit" className="mobile-button is-primary">Go to {query.trim()}</button>}
      </form>
      {groups.map(([testament, list]) => (
        <section key={testament} className="mobile-book-group">
          <h3>{testament}</h3>
          <div className="mobile-book-grid">
            {list.map((b) => (
              <button key={b.id} type="button" className={`mobile-book-cell${b.id === bookId ? ' is-current' : ''}`} onClick={() => setPickBook(b)}>{b.short_name || b.name}</button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
