import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCaretCommands } from '../commands/caretRegistry'
import { ArrowLeftRight, ArrowUpDown, BookOpen, ChevronLeft, ChevronRight, Hash, X } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Book, Tab, Verse, VerseTagLite, HighlightColor } from '@/types'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import VerseRow from '@/components/bible/VerseRow'
import { VerseInteractionContext } from '@/components/bible/verseInteraction'
import { bookName, normalizeBookName } from '@/lib/parseRef'
import { recordNavigation } from '@/lib/verseNavigation'
import { compareCounterpart, textChapterCount } from '@/lib/textCoverage'
import { zoomedFontSize } from '@/lib/zoom'
import { Page, IconTap } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { SelectionBar } from '../study/SelectionBar'
import { PassagePicker } from './PassagePicker'
import { useCompareVerseInteraction } from './compareInteraction'
import {
  columnsForState, compareAnchor, compareTitle, navigateColumns, swapColumns, correspondingVerse,
  translationLabel, translationSpokenName, makeCompareTab, type CompareColumn,
} from './compareState'
import './compare.css'
import './readerChrome.css'
import { useHideOnScroll } from './useHideOnScroll'
import { CompactPassageHeader } from './CompactPassageHeader'
import { chromeState } from '../navigation/chromeState'
import { displayChapter } from '@/lib/chapterNumbering'

type HighlightEntry = { id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }
interface ColumnData { verses: Verse[]; highlights: Record<number, HighlightEntry[]>; noteCounts: Record<number, number> }
const EMPTY_HL: HighlightEntry[] = []
const EMPTY_TAGS: VerseTagLite[] = []
const colKey = (c: CompareColumn) => `${c.textId}:${c.bookId}:${c.chapter}`

/** Content-space top of every verse block in a column scroller, ascending. */
function verseBlocks(scroller: HTMLElement): Array<{ num: number; top: number; height: number }> {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-compare-verse]')).map((el) => {
    const r = el.getBoundingClientRect()
    return { num: Number(el.dataset.compareVerse), top: r.top - base, height: r.height }
  })
}

/**
 * Compare page (R088, T23-022…T23-027): LXX ↔ KJVA side by side. The left column is the text the
 * user came from, the right its counterpart chapter (versification-aware, `compareCounterpart`);
 * each column shows its own chapter continuously and scrolls on its own. With "Sync Scrolling" on
 * (default), the column the user is touching drives: its top-most visible verse (and progress
 * through it) is mirrored onto the same verse in the other column. Reads and writes the same
 * `compareColumns` / `compareSyncScroll` / `compareMode` tab-state fields as the Mac's CompareView.
 * Each verse is the shared VerseRow, so highlights, notes, tags, Strong's and the verse sheet work;
 * selection is per column (compareInteraction).
 */
export function ComparePage({ tab }: { tab: Tab }) {
  const state = tab.state as BibleTabState
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const sheets = useSheets()
  const pair = useMemo(() => columnsForState(state), [state.compareColumns, state.bookId, state.chapter, state.translation]) // eslint-disable-line react-hooks/exhaustive-deps
  const lead = useMemo(() => pair?.[0] ?? compareAnchor(state), [pair, state.compareColumns, state.bookId, state.chapter, state.translation]) // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo<CompareColumn[]>(() => pair ?? [], [pair])
  const syncOn = state.compareSyncScroll !== false
  const showStrongs = !!state.showStrongs

  // Persist the sanitized pair once (entered from a plain chapter, or an older / Mac state that
  // listed other or extra texts), so the Mac sees the same two columns.
  useEffect(() => {
    if (!pair) return
    const cur = state.compareColumns ?? []
    const same = cur.length === 2 && cur.every((c, i) => c && c.textId?.toLowerCase() === pair[i].textId && c.bookId === pair[i].bookId && c.chapter === pair[i].chapter)
    if (!same) updateTabState('scripture', tab.id, { compareColumns: pair })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [books, setBooks] = useState<Book[]>([])
  useEffect(() => { window.bible.getBooks(lead.textId).then((b) => setBooks(b.map((x) => ({ ...x, name: normalizeBookName(x.name) })))).catch(() => setBooks([])) }, [lead.textId])
  const leadBook = books.find((b) => b.id === lead.bookId)
  // lxx_brenton.db's chapters_count is mostly 0 — fall back to the LXX-aware static count.
  const chapterCount = leadBook?.chapters_count || textChapterCount(lead.textId, lead.bookId) || 1

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
    const title = compareTitle(columns.length ? columns : [lead])
    if (tab.title !== title) renameTab('scripture', tab.id, title)
  }, [columns, lead, tab.title, tab.id, renameTab])

  const goTo = useCallback((bookId: string, chapter: number, verse?: number) => {
    const next = navigateColumns(lead, bookId, chapter)
    recordNavigation({ bookId: lead.bookId, chapter: lead.chapter }, { bookId, chapter, verse }, { kind: 'compare-column' })
    updateTabState('scripture', tab.id, { compareColumns: next, bookId, chapter, targetVerse: verse })
    useAppStore.getState().addHistoryEntry({ type: 'bible', title: `${bookName(bookId)} ${displayChapter(bookId, chapter)}${verse ? `:${verse}` : ''}`, bookId, chapter, verse, translation: lead.textId })
  }, [lead, updateTabState, tab.id])
  const hasPair = (ch: number) => compareCounterpart(lead.textId, lead.bookId, ch) != null
  const prev = lead.chapter > 1 && hasPair(lead.chapter - 1) ? lead.chapter - 1 : null
  const next = lead.chapter < chapterCount && hasPair(lead.chapter + 1) ? lead.chapter + 1 : null

  // ── scroll sync (verse-correspondence, driver = the column being touched) ─────────────────
  const colRefs = useRef<Array<HTMLDivElement | null>>([null, null])
  const driver = useRef<number | null>(null)
  const lastSet = useRef<Array<number | null>>([null, null])
  const rafId = useRef<number | null>(null)
  const syncRef = useRef(syncOn)
  syncRef.current = syncOn

  const mirror = useCallback((from: number) => {
    const src = colRefs.current[from]
    const to = from === 0 ? 1 : 0
    const dst = colRefs.current[to]
    if (!src || !dst) return
    let target: number
    const srcMax = src.scrollHeight - src.clientHeight
    const dstMax = dst.scrollHeight - dst.clientHeight
    if (src.scrollTop <= 0) target = 0
    else if (src.scrollTop >= srcMax - 1) target = dstMax
    else {
      const a = verseBlocks(src)
      const b = verseBlocks(dst)
      if (a.length === 0 || b.length === 0) return
      // Top-most visible verse on the driving side, and progress through it.
      let i = 0
      while (i + 1 < a.length && a[i + 1].top <= src.scrollTop) i++
      const v = a[i]
      const frac = v.height > 0 ? Math.min(1, Math.max(0, (src.scrollTop - v.top) / v.height)) : 0
      const num = correspondingVerse(b.map((x) => x.num), v.num)
      const w = b.find((x) => x.num === num)
      if (!w) return
      target = w.top + frac * w.height
    }
    target = Math.max(0, Math.min(dstMax, Math.round(target)))
    if (Math.abs(dst.scrollTop - target) < 1) return
    lastSet.current[to] = target
    dst.scrollTop = target
  }, [])

  const onColumnScroll = (i: number) => () => {
    const el = colRefs.current[i]
    if (!el) return
    // A scroll we caused (programmatic mirror) never propagates back.
    const expected = lastSet.current[i]
    if (expected != null && Math.abs(el.scrollTop - expected) < 2) return
    lastSet.current[i] = null
    // Only the column the user is touching drives; the other one's momentum is ignored.
    if (!syncRef.current || driver.current !== i) return
    if (rafId.current != null) return
    rafId.current = requestAnimationFrame(() => { rafId.current = null; if (driver.current === i) mirror(i) })
  }
  const claimDriver = (i: number) => () => { driver.current = i; lastSet.current[i] = null }
  useEffect(() => () => { if (rafId.current != null) cancelAnimationFrame(rafId.current) }, [])
  // Turning sync on lines the other column up with the driving (else left) one straight away.
  useEffect(() => { if (syncOn) requestAnimationFrame(() => mirror(driver.current ?? 0)) }, [syncOn, mirror])

  // Scroll both columns to the target verse once its rows exist, then clear it (one-shot).
  const loaded = columns.length > 0 && columns.every((c) => data[colKey(c)])
  useEffect(() => {
    if (!state.targetVerse || !loaded) return
    let found = false
    colRefs.current.forEach((el, i) => {
      if (!el || !columns[i]) return
      const nums = (data[colKey(columns[i])]?.verses ?? []).map((v) => v.verse_num)
      const n = correspondingVerse(nums, state.targetVerse!)
      const row = n != null ? el.querySelector<HTMLElement>(`[data-compare-verse="${n}"]`) : null
      if (!row) return
      found = true
      const top = Math.round(row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop)
      lastSet.current[i] = top
      el.scrollTop = top
      if (n === state.targetVerse) row.classList.add('is-target')
    })
    if (found) updateTabState('scripture', tab.id, { targetVerse: undefined })
  }, [state.targetVerse, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── touch interaction (same sheets as the reader; selection per column) ────────────────────
  const { verseInteraction, openStrongs, openNoteInNotesSpace } = useCompareVerseInteraction(tab.id)

  // Same hierarchical picker as the reader (NEW-011C). Compare stays LXX ↔ KJV, so a pick's
  // passage is used and its collection only decides the book list shown.
  const openReference = () => sheets.open({
    id: 'reference', rootTitle: 'Library', detents: [0.34, 0.62, 0.92], initialDetent: 2, // low / medium / full (SEP24-013)
    render: (api) => <PassagePicker textId={lead.textId} bookId={lead.bookId} chapter={lead.chapter} onPick={(d) => { api.close(); goTo(d.bookId, d.chapter, d.verse) }} onChapter={(d) => goTo(d.bookId, d.chapter)} />,
  })
  const exitCompare = () => {
    // Back to a normal Scripture tab on the same passage, in the left column's text.
    updateTabState('scripture', tab.id, { compareMode: false, compareColumns: undefined, bookId: lead.bookId, chapter: lead.chapter, translation: lead.textId.toUpperCase() })
  }
  const swap = () => { if (pair) { void haptic.selection(); updateTabState('scripture', tab.id, { compareColumns: swapColumns(pair) }) } }

  // Compare's caret: Strong's + Sync Scrolling tiles; Swap sides + Exit compare rows. Navigation
  // lives in the header (‹ title ›), so there is no separate "Go to" tile.
  useCaretCommands(() => ({
    title: `${bookName(lead.bookId)} ${displayChapter(lead.bookId, lead.chapter)}`, subtitle: 'Compare',
    sections: [
      ...(pair ? [{ id: 'quick', style: 'tiles' as const, commands: [
        { kind: 'toggle' as const, id: 'strongs', label: "Strong's", icon: Hash, value: !!state.showStrongs, set: (v: boolean) => updateTabState('scripture', tab.id, { showStrongs: v }) },
        { kind: 'toggle' as const, id: 'sync', label: 'Sync Scrolling', icon: ArrowUpDown, value: state.compareSyncScroll !== false, set: (v: boolean) => updateTabState('scripture', tab.id, { compareSyncScroll: v }) },
      ] }] : []),
      { id: 'rows', title: 'Compare', commands: [
        ...(pair ? [{ kind: 'action' as const, id: 'swap', label: 'Swap sides', icon: ArrowLeftRight, run: swap }] : []),
        { kind: 'action' as const, id: 'exit', label: 'Exit compare', icon: X, run: exitCompare },
      ] },
    ],
  }))

  // Same chrome behaviour as the reader (SEP25): scrolling either column down collapses the
  // header into the island / notch pill and slides the bottom controls away; up brings both back.
  const compareRef = useRef<HTMLDivElement>(null)
  const headerHidden = useHideOnScroll(compareRef, { frozen: sheets.currentId != null, forceShown: sheets.currentId === 'caret', resetKey: `${lead.bookId}:${lead.chapter}:${tab.id}` })
  useEffect(() => { chromeState.set({ overlay: true }); return () => chromeState.set({ overlay: false, collapsed: false }) }, [])
  useEffect(() => { chromeState.set({ collapsed: headerHidden }) }, [headerHidden])

  const bibleFontSize = zoomedFontSize(useAppStore((s) => s.bibleFontSize), useAppStore((s) => s.appZoom))
  const displayBook = leadBook?.name ?? bookName(lead.bookId)
  const title = `${displayBook} ${lead.chapter}`
  return (
    <Page noScroll
      className={`is-compare is-scripture-chrome${headerHidden ? ' is-header-hidden' : ''}`}
      title={<button type="button" className="mobile-title-button" onClick={openReference} aria-label={`${title}. Choose passage`}><BookOpen size={16} aria-hidden /> {title}</button>}
      left={<IconTap icon={ChevronLeft} label="Previous chapter" disabled={prev == null} onClick={() => { if (prev != null) { void haptic.selection(); goTo(lead.bookId, prev) } }} />}
      right={<IconTap icon={ChevronRight} label="Next chapter" disabled={next == null} onClick={() => { if (next != null) { void haptic.selection(); goTo(lead.bookId, next) } }} />}
      headerBelow={pair ? (
        <div className="m-compare-labels" aria-hidden>
          {pair.map((c) => (
            <span key={c.textId} className="m-compare-label">{translationLabel(c.textId)}{c.chapter !== lead.chapter && <span className="m-compare-label-ch"> {c.chapter}</span>}</span>
          ))}
        </div>
      ) : undefined}
    >
      {/* VerseRow's Strong's chips need a Tooltip provider — ChapterView supplies one per chapter;
          these columns render VerseRow directly. */}
      <CompactPassageHeader label={title} visible={headerHidden} onOpen={openReference} />
      <RadixTooltip.Provider delayDuration={200} skipDelayDuration={500}>
      <VerseInteractionContext.Provider value={verseInteraction}>
        <div className="m-compare" ref={compareRef}>
          {!pair ? (
            <div className="mobile-empty m-compare-empty">
              Compare isn&rsquo;t available for {displayBook} &mdash; the Septuagint has no counterpart.
            </div>
          ) : (
            <div className="m-compare-columns" style={{ fontSize: bibleFontSize }}>
              {pair.map((c, i) => {
                const d = data[colKey(c)]
                const tags = tagsByChapter[`${c.bookId}:${c.chapter}`]
                return (
                  <div key={`${i}-${c.textId}`} ref={(el) => { colRefs.current[i] = el }}
                    className="m-compare-col m-compare-scroll" role="region" aria-label={`${translationSpokenName(c.textId)}, ${bookName(c.bookId)} ${displayChapter(c.bookId, c.chapter)}`}
                    data-compare-col={i} onScroll={onColumnScroll(i)}
                    onPointerDown={claimDriver(i)} onTouchStart={claimDriver(i)} onWheel={claimDriver(i)}>
                    {!d && <div className="m-compare-status">Loading…</div>}
                    {d && d.verses.length === 0 && <div className="m-compare-status">No verses here in {translationLabel(c.textId)}.</div>}
                    {d?.verses.map((v) => (
                      <div key={v.verse_num} className="m-compare-verse" data-compare-verse={v.verse_num}>
                        <VerseRow
                          verse={v}
                          showStrongs={showStrongs}
                          superscription={v.verse_num === 0}
                          textId={c.textId}
                          tabId={tab.id}
                          highlights={d.highlights[v.verse_num] ?? EMPTY_HL}
                          noteCount={d.noteCounts[v.verse_num] ?? 0}
                          verseTags={tags?.[v.verse_num] ?? EMPTY_TAGS}
                          hiddenAnnotations={state.hiddenAnnotations}
                          onStrongsClick={openStrongs}
                        />
                      </div>
                    ))}
                    <div className="mobile-reader-end" />
                  </div>
                )
              })}
            </div>
          )}
          <SelectionBar tabId={tab.id} onOpenNote={openNoteInNotesSpace} />
        </div>
      </VerseInteractionContext.Provider>
      </RadixTooltip.Provider>
    </Page>
  )
}

/** "Compare this verse" from the reader: opens a NEW compare tab (the reader's text vs its LXX /
 *  KJVA counterpart at that verse) and makes it the active scripture tab; the reader tab is left
 *  as it was. */
export function openCompareForVerse(fromTab: Tab, verse?: number): string {
  const s = useAppStore.getState()
  const tab = makeCompareTab(fromTab.state as BibleTabState, verse)
  s.addTab(tab)
  s.setActiveSpace('scripture')
  return tab.id
}

export { makeCompareTabState, makeCompareTab } from './compareState'
