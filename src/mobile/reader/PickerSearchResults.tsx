import React from 'react'
import { Hash, Search as SearchIcon, BookOpen, Trash2 } from 'lucide-react'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { applyFindHighlight } from '@/lib/highlight'
import { buildAllWordsSnippet } from '@/components/bible/ScriptureSearchView'
import { displayHitText } from '@/lib/scriptureText'
import type { ScriptureHit } from '@/lib/scriptureSearch'
import { useIncrementalLimit } from '../search/useIncrementalLimit'
import { haptic } from '../primitives/haptics'
import type { ScriptureHistoryRow } from './scriptureHistory'
import { clearPickerSearchHistory } from './scriptureHistory'

/**
 * Verse results for the picker's inline search (text search or a Strong's-number query),
 * one incrementally-rendered group with a title ("Strong's" / "Verses"). Word-replacer display
 * text (scriptureText.ts) with the matched term(s) highlighted — Strong's hits highlight the
 * tagged WORDS (their `strongsWords` indices) instead of the typed number itself.
 */
export function TextSearchResults({ title, hits, query, kind, onPick }: {
  title: string
  hits: ScriptureHit[]
  query: string
  kind: 'text' | 'strongs'
  onPick: (h: ScriptureHit) => void
}) {
  const { limit, sentinelRef } = useIncrementalLimit(`${kind}:${query}:${hits.length}`, 50)
  const shown = hits.slice(0, limit)
  return (
    <section className="m-pp-section" aria-label={title}>
      <h3 className="m-pp-section-title">{title}</h3>
      <div className="m-pp-list" role="list" aria-label={title}>
        {shown.map((h, i) => {
          const ref = bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)
          const display = displayHitText(h)
          const snippet = buildAllWordsSnippet(display, kind === 'strongs' ? '' : query, 160).text
          const body = kind === 'strongs' && h.strongsWords?.length
            ? highlightWords(snippet, h.strongsWords)
            : applyFindHighlight(snippet, query, 'all')
          return (
            <button key={`${h.textId}:${h.book_id}:${h.chapter}:${h.verse_num}:${i}`} type="button" role="listitem" className="m-pp-row m-pp-verse-row"
              onClick={() => { void haptic.selection(); onPick(h) }}
              aria-label={`${ref}${h.textId === 'lxx' ? ', LXX' : ''}: ${snippet}`}>
              <span className="m-pp-row-text">
                <span className="m-pp-row-title">{ref}{h.textId === 'lxx' && <span className="m-pp-row-lxx"> LXX</span>}</span>
                <span className="m-pp-row-sub m-pp-verse-snippet">{body}</span>
              </span>
            </button>
          )
        })}
      </div>
      {limit < hits.length && <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />}
    </section>
  )
}

/** Highlights verse-text words at the given (space-split) indices — how Strong's search results
 *  are marked elsewhere in the app (see strongsSearch.ts's file comment). */
function highlightWords(text: string, indices: number[]): React.ReactNode {
  const set = new Set(indices)
  const words = text.split(' ')
  return (
    <>
      {words.map((w, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' '}
          {set.has(i) ? <mark className="berean-find-mark">{w}</mark> : w}
        </React.Fragment>
      ))}
    </>
  )
}

const rowIcon = (row: ScriptureHistoryRow) => row.kind === 'strongs' ? Hash : row.kind === 'text' ? SearchIcon : BookOpen

function rowTitle(row: ScriptureHistoryRow): string {
  if (row.kind !== 'visit') return row.entry.query
  const e = row.entry
  if (e.bookId) return bookChapterVerseLabel(e.bookId, e.chapter ?? 1, e.verse)
  return e.title
}

function rowSubtitle(row: ScriptureHistoryRow): string | undefined {
  if (row.kind === 'strongs') return "Strong's search"
  if (row.kind === 'text') return 'Scripture search'
  return row.entry.translation ? row.entry.translation.toUpperCase() : undefined
}

/**
 * Scripture-specific history inside the picker sheet (PICKER-SEARCH): Scripture visits (book /
 * chapter / verse) merged with text/Strong's searches run in this picker, most recent first.
 * Tapping a visit navigates there; tapping a search re-runs it (`onRerun` sets the query and
 * leaves history mode). Clear only removes the picker's own search log — Scripture visits stay
 * in the app-wide History (they're shared with the desktop History modal and the phone's own
 * History tab, historyModel.ts).
 */
export function PickerHistoryView({ rows, onVisit, onRerun }: {
  rows: ScriptureHistoryRow[]
  onVisit: (row: Extract<ScriptureHistoryRow, { kind: 'visit' }>) => void
  onRerun: (query: string, kind: 'text' | 'strongs') => void
}) {
  if (!rows.length) return <div className="mobile-empty">No recent Scripture activity yet.</div>
  return (
    <div className="m-pp">
      <div className="m-pp-history-head">
        <h3 className="m-pp-section-title">Recent</h3>
        <button type="button" className="m-pp-history-clear" onClick={() => { void haptic.light(); clearPickerSearchHistory() }} aria-label="Clear recent searches">
          <Trash2 size={14} aria-hidden /> Clear
        </button>
      </div>
      <div className="m-pp-list" role="list" aria-label="Scripture history">
        {rows.map((row) => {
          const Icon = rowIcon(row)
          const key = row.kind === 'visit' ? `v:${row.entry.id}` : `${row.kind}:${row.entry.id}`
          const sub = rowSubtitle(row)
          return (
            <button key={key} type="button" role="listitem" className="m-pp-row m-pp-history-row"
              onClick={() => { void haptic.selection(); row.kind === 'visit' ? onVisit(row) : onRerun(row.entry.query, row.kind) }}>
              <Icon size={16} aria-hidden className="m-pp-history-icon" />
              <span className="m-pp-row-text">
                <span className="m-pp-row-title">{rowTitle(row)}</span>
                {sub && <span className="m-pp-row-sub">{sub}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
