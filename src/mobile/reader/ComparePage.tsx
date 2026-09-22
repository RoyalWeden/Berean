import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, MoreHorizontal, Hash, Plus, X, Columns2 } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Book, Tab, Verse, VerseTagLite, HighlightColor } from '@/types'
import VerseRow from '@/components/bible/VerseRow'
import { VerseInteractionContext } from '@/components/bible/verseInteraction'
import { bookName, normalizeBookName } from '@/lib/parseRef'
import { recordNavigation } from '@/lib/verseNavigation'
import { zoomedFontSize } from '@/lib/zoom'
import { Page, IconTap } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { SelectionBar } from '../study/SelectionBar'
import { ReferencePicker } from './ReferencePicker'
import { useCompareVerseInteraction } from './compareInteraction'
import {
  columnsForState, compareTitle, navigateColumns, addColumn, removeColumn, replaceColumnText, availableTranslations,
  interleaveCompareRows, translationLabel, makeCompareTab, COMPARE_MAX_COLUMNS, type CompareColumn,
} from './compareState'
import './compare.css'

type HighlightEntry = { id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }
interface ColumnData { verses: Verse[]; highlights: Record<number, HighlightEntry[]>; noteCounts: Record<number, number> }
const EMPTY_HL: HighlightEntry[] = []
const EMPTY_TAGS: VerseTagLite[] = []
const colKey = (c: CompareColumn) => `${c.textId}:${c.bookId}:${c.chapter}`

/**
 * Compare page (R088): a scripture tab in compare mode, verse by verse — for each verse number the
 * text of every selected translation under it (2–4 columns become 2–4 stacked cells), translation
 * chips to add / swap / remove texts, the reference picker sheet, previous / next chapter. Reads and
 * writes the same `compareColumns` / `compareSyncScroll` / `compareMode` tab-state fields the Mac's
 * CompareView persists, so a compare tab opens identically on either device. Each cell is the shared
 * VerseRow, so highlights, notes, tags, Strong's chips and the long-press action sheet all work.
 */
export function ComparePage({ tab }: { tab: Tab }) {
  const state = tab.state as BibleTabState
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const sheets = useSheets()
  const actions = useActionSheet()
  const columns = useMemo(() => columnsForState(state), [state.compareColumns, state.bookId, state.chapter, state.translation]) // eslint-disable-line react-hooks/exhaustive-deps
  const setColumns = useCallback((next: CompareColumn[]) => updateTabState('scripture', tab.id, { compareColumns: next }), [updateTabState, tab.id])
  // A tab that arrived without persisted columns (entered from a plain chapter) writes its default pair
  // once, so the Mac sees the same two columns.
  useEffect(() => { if (!state.compareColumns || state.compareColumns.length === 0) setColumns(columns) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lead = columns[0]
  const [books, setBooks] = useState<Book[]>([])
  useEffect(() => { window.bible.getBooks(lead.textId).then((b) => setBooks(b.map((x) => ({ ...x, name: normalizeBookName(x.name) })))).catch(() => setBooks([])) }, [lead.textId])
  const leadBook = books.find((b) => b.id === lead.bookId)
  const chapterCount = leadBook?.chapters_count ?? 1

  // ── per-column data: verses + highlights + note counts; verse tags per book/chapter ────────
  const noteToken = useAppStore((s) => s.noteChangeToken)
  const highlightToken = useAppStore((s) => s.highlightChangeToken)
  const tagToken = useAppStore((s) => s.verseTagChangeToken)
  const [data, setData] = useState<Record<string, ColumnData>>({})
  const [tagsByChapter, setTagsByChapter] = useState<Record<string, Record<number, VerseTagLite[]>>>({})
  const genRef = useRef(0)
  useEffect(() => {
    const gen = ++genRef.current
    Promise.all(columns.map(async (c) => {
      const [verses, highlights, noteCounts] = await Promise.all([
        window.bible.queryChapter(c.bookId, c.chapter, c.textId).catch(() => [] as Verse[]),
        window.highlights.getChapter(c.bookId, c.chapter, c.textId).catch(() => ({} as Record<number, HighlightEntry[]>)),
        window.notes.getChapterCounts(c.bookId, c.chapter, c.textId).catch(() => ({} as Record<number, number>)),
      ])
      return [colKey(c), { verses, highlights, noteCounts }] as const
    })).then((entries) => { if (genRef.current === gen) setData(Object.fromEntries(entries)) })
  }, [columns, noteToken, highlightToken])
  useEffect(() => {
    const chapters = [...new Set(columns.map((c) => `${c.bookId}:${c.chapter}`))]
    Promise.all(chapters.map(async (k) => {
      const [bookId, ch] = k.split(':')
      const res = await window.verseTags.getForChapter(bookId, Number(ch)).catch(() => ({ verseTags: {} as Record<number, VerseTagLite[]> }))
      return [k, res.verseTags ?? {}] as const
    })).then((entries) => setTagsByChapter(Object.fromEntries(entries)))
  }, [columns, tagToken])

  // Title + history contract, as ReaderPage / BiblePanel keep it.
  useEffect(() => {
    const title = compareTitle(columns)
    if (tab.title !== title) renameTab('scripture', tab.id, title)
  }, [columns, tab.title, tab.id, renameTab])

  const goTo = useCallback((bookId: string, chapter: number, verse?: number) => {
    const next = navigateColumns(columns, bookId, chapter, lead.textId)
    recordNavigation({ bookId: lead.bookId, chapter: lead.chapter }, { bookId, chapter, verse }, { kind: 'compare-column' })
    updateTabState('scripture', tab.id, { compareColumns: next, bookId, chapter, targetVerse: verse })
    useAppStore.getState().addHistoryEntry({ type: 'bible', title: `${bookName(bookId)} ${chapter}${verse ? `:${verse}` : ''}`, bookId, chapter, verse, translation: lead.textId })
  }, [columns, lead, updateTabState, tab.id])
  const prev = lead.chapter > 1 ? lead.chapter - 1 : null
  const next = lead.chapter < chapterCount ? lead.chapter + 1 : null

  // Scroll to the target verse once its row exists, then clear it (one-shot, like ChapterView).
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => interleaveCompareRows(columns.map((c) => ({ textId: c.textId, verses: data[colKey(c)]?.verses ?? [] }))), [columns, data])
  useEffect(() => {
    if (!state.targetVerse || rows.length === 0) return
    const el = scrollRef.current?.querySelector(`[data-compare-verse="${state.targetVerse}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    el.classList.add('is-target')
    updateTabState('scripture', tab.id, { targetVerse: undefined })
  }, [state.targetVerse, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── touch interaction (same sheets as the reader) ──────────────────────────────────────────
  const { verseInteraction, openStrongs, openNoteInNotesSpace } = useCompareVerseInteraction()

  // ── chips / pickers ────────────────────────────────────────────────────────────────────────
  const collapseIfSingle = (cols: CompareColumn[]) => {
    if (cols.length >= 2) { setColumns(cols); return }
    // Down to one text → leave compare mode for that column, exactly as the Mac's onCollapseToSingle.
    const last = cols[0]
    updateTabState('scripture', tab.id, { compareMode: false, compareColumns: undefined, bookId: last.bookId, chapter: last.chapter, translation: last.textId.toUpperCase() })
  }
  const pickTranslation = (title: string, onPick: (textId: string) => void) => {
    actions('compare-translation', title, availableTranslations(columns).map((t) => ({ id: t.id, label: `${t.label} — ${t.description}`, onSelect: () => onPick(t.id) })))
  }
  const chipActions = (i: number) => {
    const c = columns[i]
    actions('compare-column', `${translationLabel(c.textId)} · ${bookName(c.bookId)} ${c.chapter}`, [
      { id: 'swap', label: 'Change translation…', icon: Columns2, onSelect: () => pickTranslation('Translation', (t) => setColumns(replaceColumnText(columns, i, t))) },
      { id: 'remove', label: 'Remove', icon: X, destructive: true, onSelect: () => collapseIfSingle(removeColumn(columns, i)) },
    ])
  }
  const openReference = () => sheets.open({
    id: 'reference', title: 'Go to', detents: [0.92],
    render: (api) => <ReferencePicker books={books} bookId={lead.bookId} chapter={lead.chapter} onPick={(b, c, v) => { api.close(); goTo(b, c, v) }} />,
  })
  const openMore = () => actions('compare-more', undefined, [
    { id: 'strongs', label: state.showStrongs ? "Hide Strong's numbers" : "Show Strong's numbers", icon: Hash, onSelect: () => updateTabState('scripture', tab.id, { showStrongs: !state.showStrongs }) },
    { id: 'sync', label: state.compareSyncScroll ? 'Stop syncing scroll on Mac' : 'Sync scroll on Mac (matching chapters)', icon: Columns2, onSelect: () => updateTabState('scripture', tab.id, { compareSyncScroll: !state.compareSyncScroll }) },
    { id: 'exit', label: 'Exit compare (keep first text)', icon: X, onSelect: () => collapseIfSingle([columns[0]]) },
  ])

  const bibleFontSize = zoomedFontSize(useAppStore((s) => s.bibleFontSize), useAppStore((s) => s.appZoom))
  const title = `${leadBook?.name ?? bookName(lead.bookId)} ${lead.chapter}`
  return (
    <Page noScroll
      title={<button type="button" className="mobile-title-button" onClick={openReference} aria-label={`${title}. Choose passage`}><BookOpen size={16} aria-hidden /> {title}</button>}
      left={<IconTap icon={ChevronLeft} label="Previous chapter" disabled={prev == null} onClick={() => { if (prev != null) { void haptic.selection(); goTo(lead.bookId, prev) } }} />}
      right={<><IconTap icon={ChevronRight} label="Next chapter" disabled={next == null} onClick={() => { if (next != null) { void haptic.selection(); goTo(lead.bookId, next) } }} /><IconTap icon={MoreHorizontal} label="More" onClick={openMore} /></>}
      headerBelow={
        <div className="mobile-chip-row mobile-chip-row-scroll m-compare-chips" role="list" aria-label="Translations">
          {columns.map((c, i) => (
            <button key={`${c.textId}-${i}`} type="button" role="listitem" className="mobile-chip is-on m-compare-chip" onClick={() => chipActions(i)} aria-label={`${translationLabel(c.textId)}, ${bookName(c.bookId)} ${c.chapter}`}>
              {translationLabel(c.textId)}{c.chapter !== lead.chapter && <span className="m-compare-chip-ch">{c.chapter}</span>}
            </button>
          ))}
          {columns.length < COMPARE_MAX_COLUMNS && (
            <button type="button" className="mobile-chip m-compare-chip" aria-label="Add translation" onClick={() => pickTranslation('Add translation', (t) => setColumns(addColumn(columns, t)))}><Plus size={16} aria-hidden /></button>
          )}
        </div>
      }
    >
      <VerseInteractionContext.Provider value={verseInteraction}>
        <div className="m-compare">
          <div ref={scrollRef} className="m-compare-scroll" style={{ fontSize: bibleFontSize }}>
            {rows.length === 0 && <div className="mobile-empty">{Object.keys(data).length === 0 ? 'Loading…' : 'No verses here in these texts.'}</div>}
            {rows.map((row) => (
              <div key={row.verseNum} className="m-compare-verse" data-compare-verse={row.verseNum}>
                {row.cells.map((cell, i) => {
                  const c = columns[i]
                  const d = data[colKey(c)]
                  return (
                    <div key={`${c.textId}-${i}`} className="m-compare-cell">
                      <span className="m-compare-cell-label" aria-hidden>{translationLabel(c.textId)}</span>
                      {cell.verse ? (
                        <VerseRow
                          verse={cell.verse}
                          showStrongs={!!state.showStrongs}
                          showVerseNumber={i === 0}
                          superscription={cell.verse.verse_num === 0}
                          textId={c.textId}
                          tabId={tab.id}
                          highlights={d?.highlights[cell.verse.verse_num] ?? EMPTY_HL}
                          noteCount={d?.noteCounts[cell.verse.verse_num] ?? 0}
                          verseTags={tagsByChapter[`${c.bookId}:${c.chapter}`]?.[cell.verse.verse_num] ?? EMPTY_TAGS}
                          hiddenAnnotations={state.hiddenAnnotations}
                          onStrongsClick={openStrongs}
                        />
                      ) : (
                        <span className="m-compare-missing">— not in {translationLabel(c.textId)} —</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            <div className="mobile-reader-end" />
          </div>
          <SelectionBar tabId={tab.id} onOpenNote={openNoteInNotesSpace} />
        </div>
      </VerseInteractionContext.Provider>
    </Page>
  )
}

/** "Compare this verse" from the reader: opens a NEW compare tab (KJV vs LXX at that verse) and
 *  makes it the active scripture tab; the reader tab is left as it was. */
export function openCompareForVerse(fromTab: Tab, verse?: number): string {
  const s = useAppStore.getState()
  const tab = makeCompareTab(fromTab.state as BibleTabState, verse)
  s.addTab(tab)
  s.setActiveSpace('scripture')
  return tab.id
}

export { makeCompareTabState, makeCompareTab } from './compareState'
