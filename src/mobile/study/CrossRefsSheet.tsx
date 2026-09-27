import React from 'react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import type { SheetApi } from '../primitives/Sheet'
import { Segmented } from '../settings/SettingsPage'
import { useVerseCrossRefs, type CrossRefSourceId, type VerseXRefs, type XRef } from './useVerseCrossRefs'

export const CROSS_REF_SOURCES: Array<[CrossRefSourceId, string]> = [['tske', 'TSK/e'], ['classic', 'Classic'], ['notes', 'My Notes']]

/** Short "Num 1:21" label for dense cross-reference lists. */
export function shortRefLabel(r: { bookId: string; chapter: number; verse: number; endVerse?: number | null }): string {
  const full = bookName(r.bookId)
  const short = full.replace(/^(\d)\s+/, '$1 ').split(' ').map((w, i, a) => (i === a.length - 1 && !/^\d/.test(w) ? w.slice(0, 3) : w)).join(' ')
  return `${short} ${r.chapter}:${r.verse}${r.endVerse && r.endVerse !== r.verse ? `–${r.endVerse}` : ''}`
}

/** The source picker (TSK/e · Classic · My Notes) — one app-wide choice, shared with the desktop. */
export function CrossRefSourcePicker() {
  const source = useAppStore((s) => s.crossRefSource)
  const setSource = useAppStore((s) => s.setCrossRefSource)
  return <Segmented full label="Cross-reference source" value={source} options={CROSS_REF_SOURCES} onChange={(v) => setSource(v as CrossRefSourceId)} />
}

/**
 * Cross references of one or several verses as dense reference links (e-Sword-like): one block
 * per verse when several are selected ("v. 6", "v. 7" — the desktop's multi-verse formatting),
 * TSK/e headings kept, My Notes showing the notes that mention the verse. Tapping a reference
 * navigates the current tab (shared navigateToVerse; LXX → New Testament opens in KJV).
 */
export function CrossRefList({ bookId, chapter, verses, textId, onNavigate }: {
  bookId: string; chapter: number; verses: readonly number[]; textId: string
  onNavigate: (r: XRef, source: CrossRefSourceId) => void
}) {
  const source = useAppStore((s) => s.crossRefSource) as CrossRefSourceId
  const data = useVerseCrossRefs(bookId, chapter, verses, textId, source)
  if (data === null) return <div className="mobile-muted mobile-study-pad">Loading…</div>
  if (data.every((v) => v.groups.length === 0)) return <div className="mobile-muted mobile-study-pad">{emptyText(source, bookId, chapter, verses)}</div>
  const multi = verses.length > 1
  return (
    <div className="mobile-xref-list">
      {data.filter((v) => v.groups.length).map((v: VerseXRefs) => (
        <div key={v.verse} className="mobile-xref-verse">
          {multi && <div className="mobile-xref-verse-head">v. {v.verse}</div>}
          {v.groups.map((g, gi) => (
            <p key={gi} className="mobile-study-refs">
              {g.heading && <span className="mobile-study-refs-heading">{g.heading}{g.reciprocal ? ' ↺' : ''} </span>}
              {g.mentions?.map((t, i) => <span key={i} className="mobile-xref-note">{t}{i < g.mentions!.length - 1 ? ', ' : ''}</span>)}
              {g.refs.map((r, i) => (
                <React.Fragment key={i}>
                  <button type="button" className="mobile-study-ref" onClick={() => onNavigate(r, source)}
                    aria-label={`${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${r.lxx ? ' LXX' : ''}${r.noteTitle ? `, from ${r.noteTitle}` : ''}`}>
                    {shortRefLabel(r)}{r.lxx ? ' LXX' : ''}
                  </button>{i < g.refs.length - 1 ? ', ' : ''}
                </React.Fragment>
              ))}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

function emptyText(source: CrossRefSourceId, bookId: string, chapter: number, verses: readonly number[]): string {
  const where = verses.length === 1 ? bookChapterVerseLabel(bookId, chapter, verses[0]) : 'these verses'
  return source === 'notes' ? `None of your notes reference ${where} yet.` : `No cross references for ${where}.`
}

/**
 * Cross references as a view of the verse sheet: source picker + the list for the selected
 * verse(s). Tapping a reference closes the sheet and navigates the current tab.
 */
export function CrossRefsSheet({ bookId, chapter, verses, textId, label, api }: { bookId: string; chapter: number; verses: readonly number[]; textId: string; label: string; api: SheetApi }) {
  const go = (r: XRef, source: CrossRefSourceId) => {
    api.close()
    navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, origin: { kind: 'cross-ref', source, fromVerse: verses[0] } })
  }
  return (
    <div className="mobile-crossrefs">
      <div className="mobile-crossrefs-head">
        <div className="mobile-verse-actions-ref">{label}</div>
        <CrossRefSourcePicker />
      </div>
      <CrossRefList bookId={bookId} chapter={chapter} verses={verses} textId={textId} onNavigate={go} />
    </div>
  )
}
