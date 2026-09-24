import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { BookOpen, Hash, Languages, ChevronLeft, ChevronRight, ALargeSmall, Volume2, AlignJustify, ScrollText, Type, Palette, Columns2, GitFork, Tag as TagIcon, Route, Copy, Share2 } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Book, Tab } from '@/types'
import ChapterView from '@/components/bible/ChapterView'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { navigateToVerse } from '@/lib/verseNavigation'
import { chapterForBookSwitch } from '@/lib/textCoverage'
import { isHermasBook, getHermasShortLabel, hermasVariantForTextId } from '@/lib/hermasMap'
import { Page } from '../primitives/Page'
import { useCaretCommands } from '../commands/caretRegistry'
import { requestMore } from '../navigation/shellNav'
import { makeCompareTab } from './compareState'
import { TagPickerSheet } from '../study/TagPickerSheet'
import { chapterRanges, rangesLabel } from '@/lib/verseTagRanges'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { perfMark } from '@/platform/ios/perf'
import { SelectionBar } from '../study/SelectionBar'
import { VerseInteractionContext } from '@/components/bible/verseInteraction'
import { ReferencePicker } from './ReferencePicker'
import { usePinchFontSize, BIBLE_FONT_MAX, BIBLE_FONT_MIN } from './usePinchFontSize'
import { ReaderOptionsSheet } from './ReaderOptionsSheet'
import { useVerseSheets } from './verseSheets'
import { useHideOnScroll } from './useHideOnScroll'
import { readerScrollMemory, captureReaderAnchor, applyReaderAnchor, type ReaderAnchor } from './readerScrollMemory'
import ContinuousChapterScroll from '@/components/bible/ContinuousChapterScroll'

/**
 * Scripture reader (R070/R077/R078; reworked for the 2026-09-22 testing wave). The active Bible
 * tab of the scripture space rendered as a horizontal chapter pager (previous / current / next
 * pages, follows the finger, respects book boundaries, never fights vertical scroll) or as one
 * continuous scroll, with:
 *  • the compact, high-density Scripture layout (verse numbers near the left edge, ~90% text
 *    width, inline superscript Strong's) — TEST-036/038/044 (mobile.css);
 *  • the verse model of verseSheets.tsx — tap selects a verse, long-press selects text, the verse
 *    sheet opens at its low position (TEST-035/039/040);
 *  • edge taps and swipes for chapters (TEST-037), a top bar that hides while reading downward
 *    (TEST-029), and a passage navigator on the title (TEST-041);
 *  • per-tab scroll memory, device-local (scroll-state audit, TEST-003).
 * The content is the shared ChapterView — the same verses, highlights, tags, notes and Strong's
 * data as desktop.
 */
export function ReaderPage({ tab }: { tab: Tab }) {
  const state = tab.state as BibleTabState
  const updateTabState = useAppStore((s) => s.updateTabState)
  const sheets = useSheets()
  const actions = useActionSheet()
  const textId = (state.translation ?? getTranslationForBook(state.bookId) ?? 'KJVA').toLowerCase()
  const [books, setBooks] = useState<Book[]>([])
  useEffect(() => { window.bible.getBooks(textId).then(setBooks).catch(() => setBooks([])) }, [textId])
  const book = books.find((b) => b.id === state.bookId)
  const chapterCount = book?.chapters_count ?? 1
  // The loaded text's real chapter count wins: switching book or translation onto a chapter the
  // book does not have opens chapter 1 rather than an empty page (TEST-025, shared rule).
  useEffect(() => {
    if (!book || isHermasBook(book.id)) return // Hermas has its own numbering + clamp (hermasMap)
    const ch = chapterForBookSwitch(book.id, state.chapter, book.chapters_count)
    if (ch !== state.chapter) updateTabState('scripture', tab.id, { chapter: ch, targetVerse: undefined, scrollPosition: 0 })
  }, [book, state.chapter, tab.id, updateTabState])
  const bookIndex = books.findIndex((b) => b.id === state.bookId)

  // Neighbouring pages: previous/next chapter, crossing into the previous/next book.
  const neighbours = useMemo(() => {
    const prev = state.chapter > 1 ? { bookId: state.bookId, chapter: state.chapter - 1 }
      : bookIndex > 0 ? { bookId: books[bookIndex - 1].id, chapter: books[bookIndex - 1].chapters_count } : null
    const next = state.chapter < chapterCount ? { bookId: state.bookId, chapter: state.chapter + 1 }
      : bookIndex >= 0 && bookIndex < books.length - 1 ? { bookId: books[bookIndex + 1].id, chapter: 1 } : null
    return { prev, next }
  }, [state.bookId, state.chapter, chapterCount, bookIndex, books])

  // Tab title + history + per-tab back stack on every chapter change — the same contract the
  // desktop BiblePanel keeps (its title effect), so tabs, history and sync see identical data.
  const renameTab = useAppStore((s) => s.renameTab)
  useEffect(() => {
    if (!book) return
    const title = state.endChapter && state.endChapter > state.chapter
      ? `${book.name} ${state.chapter}–${state.endChapter}`
      : isHermasBook(state.bookId)
        ? `Hermas ${getHermasShortLabel(state.bookId, state.chapter, hermasVariantForTextId(textId))}`
        : `${book.name} ${state.chapter}`
    if (tab.title !== title) renameTab('scripture', tab.id, title)
    const historyTitle = state.targetVerse && !(state.endChapter && state.endChapter > state.chapter) ? `${title}:${state.targetVerse}` : title
    const s = useAppStore.getState()
    s.addHistoryEntry({ type: 'bible', title: historyTitle, bookId: state.bookId, chapter: state.chapter, verse: state.targetVerse, translation: textId })
    s.pushTabNav(tab.id, { type: 'bible', title: historyTitle, bookId: state.bookId, chapter: state.chapter, verse: state.targetVerse, translation: textId.toUpperCase() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bookId, state.chapter, state.endChapter, book?.id, tab.id])

  // First Scripture render mark for the perf baseline (once per launch).
  useEffect(() => { if (book) perfMark('reader:first-chapter') }, [book])
  const goTo = useCallback((bookId: string, chapter: number, verse?: number, endVerse?: number) => {
    navigateToVerse({ bookId, chapter, verse, endVerse, origin: { kind: 'sequential-nav' } })
  }, [])
  const goNeighbour = useCallback((dir: 'prev' | 'next') => {
    const t = dir === 'prev' ? neighbours.prev : neighbours.next
    if (!t) { void haptic.warning(); return }
    void haptic.selection()
    goTo(t.bookId, t.chapter)
  }, [neighbours, goTo])

  // ── pager (horizontal swipe between chapters) ──────────────────────────────────────────
  const width = typeof window !== 'undefined' ? window.innerWidth : 390
  const x = useMotionValue(0)
  const settling = useRef(false)
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (settling.current) return
    const threshold = width * 0.28
    const goNext = (info.offset.x < -threshold || info.velocity.x < -500) && neighbours.next
    const goPrev = (info.offset.x > threshold || info.velocity.x > 500) && neighbours.prev
    if (!goNext && !goPrev) { animate(x, 0, { type: 'spring', stiffness: 400, damping: 40 }); return }
    settling.current = true
    void haptic.selection()
    animate(x, goNext ? -width : width, { type: 'spring', stiffness: 400, damping: 42 }).then(() => {
      const t = goNext ? neighbours.next! : neighbours.prev!
      goTo(t.bookId, t.chapter)
      x.set(0)
      settling.current = false
    })
  }

  // ── pinch → font size ───────────────────────────────────────────────────────────────────
  const pinch = usePinchFontSize()

  // ── verse model (tap / long-press / verse sheet) ────────────────────────────────────────
  const { verseInteraction, openStrongs, openNoteInNotesSpace } = useVerseSheets({ tabId: tab.id })
  // Leaving a chapter clears a tapped-verse selection's sheet.
  useEffect(() => () => { sheets.close('verse') }, [state.bookId, state.chapter]) // eslint-disable-line react-hooks/exhaustive-deps

  const openReference = () => {
    sheets.open({
      id: 'reference', detents: [0.92], initialDetent: 0,
      render: (api) => <ReferencePicker books={books} bookId={state.bookId} chapter={state.chapter} onPick={(b, c, v, e) => { api.close(); goTo(b, c, v, e) }} />,
    })
  }
  const openTranslation = () => {
    actions('translation', 'Translation', TRANSLATIONS.map((t) => ({
      id: t.id, label: `${t.label} — ${t.description}`,
      onSelect: () => { updateTabState('scripture', tab.id, { translation: t.id.toUpperCase() }) },
    })))
  }
  const openOptions = () => sheets.open({ id: 'reader-options', title: 'Reading', detents: [0.72, 0.92], render: () => <ReaderOptionsSheet /> })
  const continuous = useAppStore((s) => s.continuousChapterScroll)

  // ── caret commands (TEST-033/034): everything the old translation / Aa / … controls did ──────
  useCaretCommands(() => {
    const st = useAppStore.getState()
    const ref = `${bookName(state.bookId)} ${state.chapter}`
    return {
      title: ref, subtitle: TRANSLATIONS.find((t) => t.id === textId)?.description ?? textId.toUpperCase(),
      sections: [
        { id: 'quick', style: 'tiles', commands: [
          { kind: 'action', id: 'translation', label: textId.toUpperCase(), detail: 'Translation', icon: Languages, run: openTranslation },
          { kind: 'action', id: 'goto', label: 'Go to', icon: BookOpen, run: openReference },
          { kind: 'toggle', id: 'strongs', label: "Strong's", icon: Hash, value: !!state.showStrongs, set: (v) => updateTabState('scripture', tab.id, { showStrongs: v }) },
          { kind: 'action', id: 'audio', label: 'Read aloud', icon: Volume2, run: () => st.startPlaybackFrom(state.bookId, state.chapter, 1, textId) },
        ] },
        { id: 'reading', title: 'Reading', commands: [
          { kind: 'segmented', id: 'quick-translation', label: 'Text', icon: Languages, value: textId === 'lxx' ? 'lxx' : textId === 'kjva' ? 'kjva' : '', options: [['kjva', 'KJV'], ['lxx', 'LXX']], set: (v) => updateTabState('scripture', tab.id, { translation: v.toUpperCase() }) },
          { kind: 'action', id: 'all-translations', label: 'All translations…', icon: Languages, run: openTranslation },
          { kind: 'stepper', id: 'size', label: 'Text size', icon: ALargeSmall, value: st.bibleFontSize, min: BIBLE_FONT_MIN, max: BIBLE_FONT_MAX, set: st.setBibleFontSize },
          { kind: 'segmented', id: 'line-height', label: 'Line height', icon: AlignJustify, value: st.bibleLineHeight, options: [['compact', 'Compact'], ['comfortable', 'Normal'], ['spacious', 'Airy']], set: (v) => st.setBibleLineHeight(v as 'compact' | 'comfortable' | 'spacious') },
          { kind: 'toggle', id: 'continuous', label: 'Continuous scroll', detail: 'Chapters flow into one page', icon: ScrollText, value: st.continuousChapterScroll, set: st.setContinuousChapterScroll },
          { kind: 'toggle', id: 'verse-numbers', label: 'Verse numbers', icon: Hash, value: st.showVerseNumbers, set: st.setShowVerseNumbers },
          { kind: 'toggle', id: 'red-letters', label: 'Red letter text', icon: Type, value: st.showRedLetters, set: st.setShowRedLetters },
          { kind: 'action', id: 'reading-more', label: 'Font, theme and more reading options…', icon: Palette, run: openOptions },
        ] },
        { id: 'navigate', title: 'Navigate', commands: [
          { kind: 'action', id: 'prev', label: neighbours.prev ? `Previous chapter · ${bookName(neighbours.prev.bookId)} ${neighbours.prev.chapter}` : 'Previous chapter', icon: ChevronLeft, disabled: !neighbours.prev, run: () => goNeighbour('prev') },
          { kind: 'action', id: 'next', label: neighbours.next ? `Next chapter · ${bookName(neighbours.next.bookId)} ${neighbours.next.chapter}` : 'Next chapter', icon: ChevronRight, disabled: !neighbours.next, run: () => goNeighbour('next') },
          { kind: 'action', id: 'compare', label: 'Compare translations', icon: Columns2, run: () => st.addTab(makeCompareTab({ ...state }, state.targetVerse)) },
        ] },
        { id: 'study', title: 'Study', commands: [
          { kind: 'segmented', id: 'xref-source', label: 'Cross references', icon: GitFork, value: st.crossRefSource === 'classic' ? 'classic' : 'tske', options: [['tske', 'TSKe'], ['classic', 'Classic']], set: (v) => st.setCrossRefSource(v as 'tske' | 'classic') },
          { kind: 'action', id: 'tag-chapter', label: `Tag ${ref}…`, icon: TagIcon, run: () => { const ranges = chapterRanges(state.bookId, state.chapter); sheets.open({ id: 'tag-picker', detents: [0.6, 0.92], render: (api) => <TagPickerSheet ranges={ranges} label={rangesLabel(ranges)} kind="chapter" api={api} /> }) } },
          { kind: 'action', id: 'trail', label: 'Study trail', icon: Route, run: () => requestMore('trail') },
        ] },
        { id: 'share', title: 'Share', commands: [
          { kind: 'action', id: 'copy-ref', label: `Copy “${ref}”`, icon: Copy, run: () => { void navigator.clipboard.writeText(ref) } },
          { kind: 'action', id: 'share', label: 'Share chapter…', icon: Share2, run: () => { void import('@capacitor/share').then(({ Share }) => Share.share({ title: ref, text: ref }).catch(() => {})) } },
        ] },
      ],
    }
  })

  // ── top bar hides while reading downward (TEST-029) ─────────────────────────────────────
  const readerRef = useRef<HTMLDivElement>(null)
  const headerHidden = useHideOnScroll(readerRef, { frozen: sheets.currentId != null, resetKey: `${state.bookId}:${state.chapter}:${tab.id}` })

  // ── per-tab scroll memory (device-local; scroll-state audit) ───────────────────────────
  // The position is a verse anchor, so it survives a translation switch and a paged ⇄ continuous
  // switch without the reader visibly jumping (T23-003/T23-004).
  const saveAnchor = useCallback((el: HTMLElement) => {
    const a = captureReaderAnchor(el)
    if (a) readerScrollMemory.save(tab.id, state.bookId, a)
  }, [tab.id, state.bookId])
  const pagedAnchor = readerScrollMemory.restore(tab.id, state.bookId, state.chapter)
  const scrollRaf = useRef(0)
  const onContinuousScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    cancelAnimationFrame(scrollRaf.current)
    scrollRaf.current = requestAnimationFrame(() => saveAnchor(el))
  }, [saveAnchor])

  const title = `${bookName(state.bookId)} ${state.chapter}`
  return (
    <Page
      noScroll
      className={`is-reader${headerHidden ? ' is-header-hidden' : ''}`}
      // Translation, Reading (Aa) and "…" moved into the caret (TEST-033/034); the title stays the
      // passage navigator (TEST-041).
      title={<button type="button" className="mobile-title-button" onClick={openReference} aria-label={`${title}, ${textId.toUpperCase()}. Go to a passage`}><BookOpen size={16} aria-hidden /> {title}<span className="mobile-title-sub">{textId.toUpperCase()}</span></button>}
    >
      <VerseInteractionContext.Provider value={verseInteraction}>
      <div className="mobile-reader" ref={readerRef} {...pinch.handlers}>
        {continuous ? (
          <div className="mobile-reader-pane is-continuous" style={{ width }}>
            <ContinuousChapterScroll
              key={`${state.bookId}-${textId}`}
              initialAnchor={readerScrollMemory.restore(tab.id, state.bookId, state.chapter)}
              onScroll={onContinuousScroll}
              bookId={state.bookId} chapter={state.chapter} totalChapters={chapterCount}
              showStrongs={state.showStrongs} textId={textId}
              targetVerse={state.targetVerse} onTargetVerseConsumed={() => updateTabState('scripture', tab.id, { targetVerse: undefined })}
              onStrongsClick={openStrongs}
              onChapterChange={(ch) => { if (ch !== state.chapter) updateTabState('scripture', tab.id, { chapter: ch }) }}
            />
          </div>
        ) : (
        <motion.div
          className="mobile-reader-track"
          style={{ x, width: width * 3, left: -width }}
          drag="x" dragDirectionLock
          dragConstraints={{ left: neighbours.next ? -width : 0, right: neighbours.prev ? width : 0 }}
          dragElastic={0.12}
          onDragEnd={onDragEnd}
        >
          <ReaderPane key={neighbours.prev ? `${neighbours.prev.bookId}-${neighbours.prev.chapter}` : 'none-prev'} width={width} target={neighbours.prev} textId={textId} showStrongs={state.showStrongs} preview />
          <ReaderPane key={`${state.bookId}-${state.chapter}-${textId}`} width={width} target={{ bookId: state.bookId, chapter: state.chapter }} textId={textId} showStrongs={state.showStrongs}
            targetVerse={state.targetVerse} onTargetVerseConsumed={() => updateTabState('scripture', tab.id, { targetVerse: undefined })}
            onStrongsClick={openStrongs} tabId={tab.id} initialAnchor={pagedAnchor} onSaveAnchor={saveAnchor} />
          <ReaderPane key={neighbours.next ? `${neighbours.next.bookId}-${neighbours.next.chapter}` : 'none-next'} width={width} target={neighbours.next} textId={textId} showStrongs={state.showStrongs} preview />
        </motion.div>
        )}
        {/* Far-left / far-right taps turn the chapter (TEST-037); swipes keep working through the
            pager. Thin strips, so text selection and the verse tap zone are unaffected. */}
        <button type="button" className="mobile-reader-edge is-left" aria-label={neighbours.prev ? `Previous chapter, ${bookName(neighbours.prev.bookId)} ${neighbours.prev.chapter}` : 'No previous chapter'} onClick={() => goNeighbour('prev')} />
        <button type="button" className="mobile-reader-edge is-right" aria-label={neighbours.next ? `Next chapter, ${bookName(neighbours.next.bookId)} ${neighbours.next.chapter}` : 'No next chapter'} onClick={() => goNeighbour('next')} />
        {pinch.badge && <div className="mobile-pinch-badge" aria-live="polite">{pinch.badge}</div>}
        <SelectionBar tabId={tab.id} onOpenNote={openNoteInNotesSpace} />
      </div>
      </VerseInteractionContext.Provider>
    </Page>
  )
}

function ReaderPane({ width, target, textId, showStrongs, preview, targetVerse, onTargetVerseConsumed, onStrongsClick, tabId, initialAnchor, onSaveAnchor }: {
  width: number; target: { bookId: string; chapter: number } | null; textId: string; showStrongs: boolean; preview?: boolean
  targetVerse?: number; onTargetVerseConsumed?: () => void; onStrongsClick?: (num: string) => void; tabId?: string
  initialAnchor?: ReaderAnchor; onSaveAnchor?: (el: HTMLElement) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  // A pane that has a position to restore stays invisible until it is restored, so a remount
  // (translation switch, returning to the tab) never shows the chapter's top for a frame and then
  // jumps — the "new text shows above the sheet for a moment" flash (T23-004).
  const [ready, setReady] = useState(() => !initialAnchor || !!targetVerse)
  const onVersesLoaded = useCallback(() => {
    if (restored.current) return
    restored.current = true
    if (initialAnchor && !targetVerse && scrollRef.current) applyReaderAnchor(scrollRef.current, initialAnchor)
    setReady(true)
  }, [targetVerse, initialAnchor])
  const raf = useRef(0)
  const onScroll = onSaveAnchor ? (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => onSaveAnchor(el))
  } : undefined
  return (
    <div className="mobile-reader-pane" style={{ width, visibility: ready ? undefined : 'hidden' }} aria-hidden={preview || undefined}>
      {target ? (
        <div ref={scrollRef} className="mobile-reader-scroll" onScroll={onScroll}>
          <ChapterView bookId={target.bookId} chapter={target.chapter} textId={textId} showStrongs={showStrongs}
            targetVerse={targetVerse} onTargetVerseConsumed={onTargetVerseConsumed} onStrongsClick={onStrongsClick} tabId={tabId}
            onVersesLoaded={preview ? undefined : onVersesLoaded} />
          <div className="mobile-reader-end" />
        </div>
      ) : (
        <div className="mobile-reader-boundary">{preview ? 'Beginning / end of the library' : ''}</div>
      )}
    </div>
  )
}
