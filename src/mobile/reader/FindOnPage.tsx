import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, Search, X } from 'lucide-react'
import { useAppStore } from '@/store'
import type { Verse } from '@/types'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { verseMatchesFind } from '@/lib/scriptureFind'
import { haptic } from '../primitives/haptics'

export interface BookFindMatch { chapter: number; verse: number }

/** Verses of a whole book, loaded once per text+book and cached for the session. */
const bookCache = new Map<string, Promise<Verse[]>>()
function loadBook(textId: string, bookId: string, chapters: number): Promise<Verse[]> {
  const key = `${textId}:${bookId}`
  let p = bookCache.get(key)
  if (!p) {
    p = (async () => {
      const out: Verse[] = []
      for (let start = 1; start <= chapters; start += 12) {
        const batch = await Promise.all(Array.from({ length: Math.min(12, chapters - start + 1) }, (_, i) => window.bible.queryChapter(bookId, start + i, textId).catch(() => [] as Verse[])))
        for (const vs of batch) out.push(...vs)
      }
      return out
    })()
    bookCache.set(key, p)
  }
  return p
}

/** Pure matcher (exported for tests): every verse whose displayed text contains the query
 *  (case-insensitive; all words when several are typed), in book order. */
export function findInVerses(verses: ReadonlyArray<{ chapter: number; verse_num: number; text: string }>, query: string, display: (v: { text: string }) => string = (v) => v.text): BookFindMatch[] {
  if (!query.trim()) return []
  const out: BookFindMatch[] = []
  // The shared rule (src/lib/scriptureFind.ts): raw AND displayed text, case-insensitive.
  for (const v of verses) {
    if (verseMatchesFind(v.text, display(v), query, 'all')) out.push({ chapter: v.chapter, verse: v.verse_num })
  }
  return out.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
}

/**
 * Find on Page (SEP24-019): find within the CURRENT BOOK — every chapter, not only what is on
 * screen — with all matches highlighted in the reader (ChapterView's find highlighting, paged or
 * continuous) and next / previous stepping through them in book order. It moves the current tab
 * to the match without adding history entries. It is not the global Search tab.
 */
export function FindOnPageBar({ textId, bookId, chapters, query, onQuery, onGo, onClose }: {
  textId: string; bookId: string; chapters: number
  query: string; onQuery: (q: string) => void
  onGo: (m: BookFindMatch) => void
  onClose: () => void
}) {
  const [verses, setVerses] = useState<Verse[] | null>(null)
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const enabled = useAppStore((s) => s.wordReplacerEnabled)
  const rules = useAppStore((s) => s.wordReplacerRules)
  useEffect(() => { let alive = true; setVerses(null); loadBook(textId, bookId, chapters).then((v) => { if (alive) setVerses(v) }); return () => { alive = false } }, [textId, bookId, chapters])
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 60); return () => clearTimeout(t) }, [])
  const matches = useMemo(() => (verses ? findInVerses(verses, query, (v) => buildVerseDisplayText(v.text, (v as Verse & { text_tagged?: string | null }).text_tagged ?? null, textId, enabled, rules)) : []), [verses, query, textId, enabled, rules])
  useEffect(() => { setIdx(0) }, [query])
  const go = (i: number) => {
    if (!matches.length) return
    const n = (i + matches.length) % matches.length
    setIdx(n)
    void haptic.selection()
    onGo(matches[n])
  }
  const m = matches[idx]
  const status = !query.trim() ? '' : verses == null ? 'Searching…' : matches.length ? `${idx + 1} of ${matches.length}` : 'No matches'
  return (
    <div className="mobile-find-bar m-glass" role="search" aria-label="Find in this book">
      <form className="mobile-find-field" onSubmit={(e) => { e.preventDefault(); go(idx + (m ? 1 : 0)) }}>
        <Search size={15} aria-hidden />
        <input ref={inputRef} type="search" enterKeyHint="search" autoCorrect="off" placeholder="Find in this book"
          value={query} onChange={(e) => onQuery(e.target.value)} aria-label="Find in this book" />
        <span className="mobile-find-status" aria-live="polite">{status}{m && query.trim() ? <small> · {bookChapterVerseLabel(bookId, m.chapter, m.verse)}</small> : null}</span>
      </form>
      <button type="button" className="mobile-find-btn" aria-label="Previous match" disabled={!matches.length} onClick={() => go(idx - 1)}><ChevronUp size={20} aria-hidden /></button>
      <button type="button" className="mobile-find-btn" aria-label="Next match" disabled={!matches.length} onClick={() => go(idx + 1)}><ChevronDown size={20} aria-hidden /></button>
      <button type="button" className="mobile-find-btn is-done" aria-label="Done" onClick={onClose}><X size={18} aria-hidden /></button>
    </div>
  )
}
