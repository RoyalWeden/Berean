import React from 'react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { openDestination } from '@/lib/navigation/destination'
import { XRefList, useXRefs, type XRefVariant } from './XRefList'
import type { SheetApi } from '../primitives/Sheet'
import { Segmented } from '../settings/SettingsPage'
import type { CrossRefSourceId, XRef } from './useVerseCrossRefs'

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
 * Cross references of one or several verses — or, with no verse, of the chapter — as the shared
 * cards (XREF-002, XRefList): reference + full verse text, expandable, de-duplicated across a
 * selection, TSK/e headings kept. Tapping a reference navigates the current tab through
 * `onNavigate(ref, source, 'current-tab')`; the long-press "Open in New Tab" passes 'new-tab'.
 */
export function CrossRefList({ bookId, chapter, verses, textId, onNavigate, source: forced, variant = 'regular' }: {
  bookId: string; chapter: number; verses: readonly number[]; textId: string
  onNavigate: (r: XRef, source: CrossRefSourceId, intent: 'current-tab' | 'new-tab') => void
  /** Show this source regardless of the app-wide choice (the caret's My Notes). */
  source?: CrossRefSourceId
  variant?: XRefVariant
}) {
  const chosen = useAppStore((s) => s.crossRefSource) as CrossRefSourceId
  const source = forced ?? chosen
  const result = useXRefs({ bookId, chapter, verses, textId }, source)
  return (
    <XRefList result={result} variant={variant} showSource={verses.length === 0}
      empty={emptyText(source, bookId, chapter, verses)}
      onOpen={(i, intent) => onNavigate({ bookId: i.bookId, chapter: i.chapter, verse: i.verse || 1, endVerse: i.endVerse ?? null, lxx: i.lxx }, source, intent)} />
  )
}

function emptyText(source: CrossRefSourceId, bookId: string, chapter: number, verses: readonly number[]): string {
  if (verses.length === 0) return `No chapter-level cross references for ${bookName(bookId)} ${chapter} yet — your notes on this chapter, and notes that cite it, appear here. Select a verse for its TSK/e and Classic references.`
  const where = verses.length === 1 ? bookChapterVerseLabel(bookId, chapter, verses[0]) : 'these verses'
  return source === 'notes' ? `None of your notes reference ${where} yet.` : `No cross references for ${where}.`
}

/**
 * Cross references as a view of the verse sheet: source picker + the list for the selected
 * verse(s). Tapping a reference closes the sheet and navigates the current tab.
 */
export function CrossRefsSheet({ bookId, chapter, verses, textId, label, api }: { bookId: string; chapter: number; verses: readonly number[]; textId: string; label: string; api: SheetApi }) {
  const go = (r: XRef, source: CrossRefSourceId, intent: 'current-tab' | 'new-tab') => {
    api.close()
    openDestination({ kind: 'passage', bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, ...(r.lxx ? { textId: 'lxx' } : {}) }, intent, { origin: { kind: 'cross-ref', source, fromVerse: verses[0] } })
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

/**
 * The Scripture caret's Cross References section (XREF-003), rendered inline in the caret's own
 * scroll when its collapsible row is expanded. No selection → the chapter-level references; a
 * selection → the chosen source's references for those verses (de-duplicated), with the picker.
 * Tapping a reference closes the caret and navigates this tab.
 */
export function CaretCrossRefs({ bookId, chapter, verses, textId, api }: { bookId: string; chapter: number; verses: readonly number[]; textId: string; api: SheetApi }) {
  const go = (r: XRef, source: CrossRefSourceId, intent: 'current-tab' | 'new-tab') => {
    api.close()
    openDestination({ kind: 'passage', bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, ...(r.lxx ? { textId: 'lxx' } : {}) }, intent, { origin: { kind: 'cross-ref', source, fromVerse: verses[0] } })
  }
  return (
    <div className="m-caret-xrefs">
      {verses.length > 0 && <CrossRefSourcePicker />}
      <CrossRefList bookId={bookId} chapter={chapter} verses={verses} textId={textId} variant="compact" onNavigate={go}
        {...(verses.length === 0 ? { source: 'notes' as const } : {})} />
    </div>
  )
}
