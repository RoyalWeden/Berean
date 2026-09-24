import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './readerChrome.css'
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { BookOpen, Hash, Languages, ALargeSmall, Volume2, AlignJustify, ScrollText, Type, Palette, Columns2, GitFork, Tag as TagIcon, Route, Copy, Share2, SunMoon, CaseSensitive, Repeat } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Book, Tab } from '@/types'
import ChapterView from '@/components/bible/ChapterView'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import { navigateToVerse } from '@/lib/verseNavigation'
import { compareApplicable, compareCounterpart, passageForTextBooks } from '@/lib/textCoverage'
import { isHermasBook, getHermasShortLabel, hermasVariantForTextId } from '@/lib/hermasMap'
import { Page } from '../primitives/Page'
import { useCaretCommands } from '../commands/caretRegistry'
import { requestMore } from '../navigation/shellNav'
import { makeCompareTab } from './compareState'
import { TagPickerSheet } from '../study/TagPickerSheet'
import { chapterRanges, rangesLabel } from '@/lib/verseTagRanges'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { perfMark } from '@/platform/ios/perf'
import { SelectionBar } from '../study/SelectionBar'
import { VerseInteractionContext } from '@/components/bible/verseInteraction'
import { PassagePicker } from './PassagePicker'
import { usePinchFontSize, BIBLE_FONT_MAX, BIBLE_FONT_MIN } from './usePinchFontSize'
import { TranslationChoices, FontChoices, ColorChoices, translationShortLabel, fontLabel } from './readerViews'
import { themePresetLabel } from '../settings/ThemePresetPage'
import { useVerseSheets } from './verseSheets'
import { useHideOnScroll } from './useHideOnScroll'
import { readerScrollMemory, captureReaderAnchor, applyReaderAnchor, type ReaderAnchor } from './readerScrollMemory'
import ContinuousChapterScroll from '@/components/bible/ContinuousChapterScroll'
import { CompactPassageHeader } from './CompactPassageHeader'
import { chromeState } from '../navigation/chromeState'
import { displayChapter } from '@/lib/chapterNumbering'

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
  const textId = (state.translation ?? getTranslationForBook(state.bookId) ?? 'KJVA').toLowerCase()
  const [books, setBooks] = useState<Book[]>([])
  // `booksFor` = which text `books` belongs to, so a stale list from the previous text never drives
  // a redirect.
  const [booksFor, setBooksFor] = useState<string | null>(null)
  useEffect(() => { window.bible.getBooks(textId).then((b) => { setBooks(b); setBooksFor(textId) }).catch(() => setBooks([])) }, [textId])
  const book = books.find((b) => b.id === state.bookId)
  const chapterCount = book?.chapters_count ?? 1
  // The loaded text's real chapter count wins: switching book or translation onto a chapter the
  // book does not have opens chapter 1 rather than an empty page (TEST-025, shared rule).
  // A text that doesn't have the current book at all (Matthew 22 → 1 Enoch) opens its first book,
  // chapter 1, instead of an empty Matthew 22 (NEW-005B).
  useEffect(() => {
    if (booksFor !== textId || books.length === 0) return
    if (book && isHermasBook(book.id)) return // Hermas has its own numbering + clamp (hermasMap)
    const dest = passageForTextBooks(books, state.bookId, state.chapter)
    if (!dest) return
    if (dest.bookId !== state.bookId) useAppStore.getState().clearVerseSelection(tab.id)
    updateTabState('scripture', tab.id, { bookId: dest.bookId, chapter: dest.chapter, targetVerse: undefined, endVerse: undefined, scrollPosition: 0 })
  }, [books, booksFor, textId, book, state.bookId, state.chapter, tab.id, updateTabState])
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
      ? `${book.name} ${displayChapter(state.bookId, state.chapter)}–${displayChapter(state.bookId, state.endChapter)}`
      : isHermasBook(state.bookId)
        ? `Hermas ${getHermasShortLabel(state.bookId, state.chapter, hermasVariantForTextId(textId))}`
        : `${book.name} ${displayChapter(state.bookId, state.chapter)}`
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
    if (settling.current) return // one chapter per accepted gesture; ignore while a transition settles
    const t = dir === 'prev' ? neighbours.prev : neighbours.next
    if (!t) { void haptic.warning(); return }
    void haptic.selection()
    goTo(t.bookId, t.chapter)
  }, [neighbours, goTo])

  // ── pager (horizontal swipe between chapters) ──────────────────────────────────────────
  // Transition policy (NEW-005C): each accepted swipe moves exactly one chapter. While that
  // transition settles, the track takes no new drag (the drag listener is off) and edge taps are
  // ignored, so gestures can't overlap. The settle always completes — on the spring's end, or at
  // the latest after 450 ms (a spring stopped early never resolves its promise, which used to leave
  // `settling` stuck and the track parked between chapters until the tab remounted) — and every
  // chapter change puts the track back at rest.
  const width = typeof window !== 'undefined' ? window.innerWidth : 390
  const x = useMotionValue(0)
  const settling = useRef(false)
  const [isSettling, setIsSettling] = useState(false)
  const finishSettle = useRef<(() => void) | null>(null)
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (settling.current) { animate(x, 0, { duration: 0.15 }); return }
    const threshold = width * 0.28
    const goNext = (info.offset.x < -threshold || info.velocity.x < -500) && neighbours.next
    const goPrev = (info.offset.x > threshold || info.velocity.x > 500) && neighbours.prev
    if (!goNext && !goPrev) { animate(x, 0, { type: 'spring', stiffness: 400, damping: 40 }); return }
    const t = goNext ? neighbours.next! : neighbours.prev!
    settling.current = true
    setIsSettling(true)
    void haptic.selection()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(guard)
      finishSettle.current = null
      goTo(t.bookId, t.chapter)
      x.set(0)
      settling.current = false
      setIsSettling(false)
    }
    finishSettle.current = finish
    const guard = setTimeout(finish, 450)
    animate(x, goNext ? -width : width, { type: 'spring', stiffness: 400, damping: 42, restDelta: 0.5, onComplete: finish })
  }
  // Any chapter change (swipe, edge tap, picker, deep link) leaves the track at rest.
  useEffect(() => {
    if (finishSettle.current) return
    x.stop(); x.set(0)
    settling.current = false
    setIsSettling(false)
  }, [state.bookId, state.chapter, x])

  // ── pinch → font size ───────────────────────────────────────────────────────────────────
  const pinch = usePinchFontSize()

  // ── verse model (tap / long-press / verse sheet) ────────────────────────────────────────
  const { verseInteraction, openStrongs, openNoteInNotesSpace } = useVerseSheets({ tabId: tab.id })
  // Leaving a chapter clears a tapped-verse selection's sheet.
  useEffect(() => () => { sheets.close('verse') }, [state.bookId, state.chapter]) // eslint-disable-line react-hooks/exhaustive-deps

  const openReference = () => {
    // The hierarchical picker (NEW-011): Library → collection → book → chapter (→ verse), all in
    // this one sheet; a pick in another collection switches this tab's text too.
    sheets.open({
      id: 'reference', rootTitle: 'Library', detents: [0.34, 0.62, 0.92], initialDetent: 2, // low / medium / full (SEP24-013); fresh each open
      render: (api) => <PassagePicker textId={textId} bookId={state.bookId} chapter={state.chapter} onPick={(d) => {
        api.close()
        if (d.textId.toLowerCase() !== textId) updateTabState('scripture', tab.id, { translation: d.textId.toUpperCase() })
        goTo(d.bookId, d.chapter, d.verse, d.endVerse)
      }} />,
    })
  }
  // Switching text maps the chapter the same way desktop does (LXX Psalms numbering etc.).
  const switchText = (to: string) => {
    const ch = mapChapterOnTranslationSwitch(state.bookId, state.chapter, textId, to)
    updateTabState('scripture', tab.id, { translation: to.toUpperCase(), ...(ch !== state.chapter ? { chapter: ch, targetVerse: undefined } : {}) })
  }
  const continuous = useAppStore((s) => s.continuousChapterScroll)

  // ── caret commands (reworked T23-014…021) ──────────────────────────────────────────────
  // One surface: quick tiles (Strong's with the KJV⇄LXX switch beside it, Compare, Read aloud),
  // then inline reading controls; All Translations, Font and Color open INSIDE the caret with
  // "‹ Scripture" at the top. Passage navigation lives on the title (tap → passage search) and on
  // edge taps / swipes, so the caret no longer repeats Go to, a translation tile or ‹ › chapter rows.
  useCaretCommands(() => {
    const st = useAppStore.getState()
    const ref = `${bookName(state.bookId)} ${displayChapter(state.bookId, state.chapter)}`
    // The quick switch only exists where the other text really has this passage (T23-017).
    const alt = compareCounterpart(textId, state.bookId, state.chapter)
    const canCompare = compareApplicable(state.bookId, state.chapter, textId)
    return {
      title: ref, backTitle: 'Scripture',
      sections: [
        { id: 'quick', style: 'tiles', commands: [
          { kind: 'toggle', id: 'strongs', label: "Strong's", icon: Hash, value: !!state.showStrongs, set: (v) => updateTabState('scripture', tab.id, { showStrongs: v }) },
          // Compact switch (NEW-010): icon + target text only ("LXX" / "KJV"), no "Switch text" label.
          ...(alt ? [{ kind: 'action' as const, id: 'switch-text', label: translationShortLabel(alt.textId) === 'KJVA' ? 'KJV' : translationShortLabel(alt.textId), icon: Repeat, keepOpen: true, a11yLabel: alt.textId === 'lxx' ? 'Switch to the Septuagint' : 'Switch to the King James Version', run: () => switchText(alt.textId) }] : []),
          ...(canCompare ? [{ kind: 'action' as const, id: 'compare', label: 'Compare', icon: Columns2, run: () => st.addTab(makeCompareTab({ ...state }, state.targetVerse)) }] : []),
          { kind: 'action', id: 'audio', label: 'Read aloud', icon: Volume2, run: () => st.startPlaybackFrom(state.bookId, state.chapter, 1, textId) },
        ] },
        { id: 'reading', title: 'Reading', commands: [
          { kind: 'view', id: 'all-translations', label: 'All Translations', icon: Languages, value: translationShortLabel(textId),
            view: () => ({ title: 'All Translations', render: (a) => <TranslationChoices api={a} textId={textId} onPick={switchText} /> }) },
          { kind: 'stepper', id: 'size', label: 'Text size', icon: ALargeSmall, value: st.bibleFontSize, min: BIBLE_FONT_MIN, max: BIBLE_FONT_MAX, set: st.setBibleFontSize },
          { kind: 'segmented', id: 'line-height', label: 'Line height', icon: AlignJustify, value: st.bibleLineHeight, options: [['compact', 'Compact'], ['comfortable', 'Normal'], ['spacious', 'Airy']], set: (v) => st.setBibleLineHeight(v as 'compact' | 'comfortable' | 'spacious') },
          { kind: 'view', id: 'font', label: 'Font', icon: CaseSensitive, value: fontLabel(st.scriptureFontFamily), view: () => ({ title: 'Font', render: (a) => <FontChoices api={a} /> }) },
          { kind: 'segmented', id: 'theme', label: 'Appearance', icon: SunMoon, value: st.theme, options: [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], set: (v) => st.setTheme(v as 'system' | 'light' | 'dark') },
          { kind: 'view', id: 'color', label: 'Color', icon: Palette, value: themePresetLabel(st.themePreset, st.customThemes), view: () => ({ title: 'Color', render: (a) => <ColorChoices api={a} /> }) },
          { kind: 'toggle', id: 'continuous', label: 'Continuous scroll', detail: 'Chapters flow into one page', icon: ScrollText, value: st.continuousChapterScroll, set: st.setContinuousChapterScroll },
          { kind: 'toggle', id: 'verse-numbers', label: 'Verse numbers', icon: Hash, value: st.showVerseNumbers, set: st.setShowVerseNumbers },
          { kind: 'toggle', id: 'red-letters', label: 'Red letter text', icon: Type, value: st.showRedLetters, set: st.setShowRedLetters },
        ] },
        { id: 'study', title: 'Study', commands: [
          { kind: 'segmented', id: 'xref-source', label: 'Cross references', icon: GitFork, value: st.crossRefSource === 'classic' ? 'classic' : 'tske', options: [['tske', 'TSKe'], ['classic', 'Classic']], set: (v) => st.setCrossRefSource(v as 'tske' | 'classic') },
          { kind: 'view', id: 'tag-chapter', label: `Tag ${ref}`, icon: TagIcon, view: () => { const ranges = chapterRanges(state.bookId, state.chapter); return { title: `Tag ${ref}`, render: (a) => <TagPickerSheet ranges={ranges} label={rangesLabel(ranges)} kind="chapter" api={a} /> } } },
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
  const headerHidden = useHideOnScroll(readerRef, { frozen: sheets.currentId != null, forceShown: sheets.currentId === 'caret', resetKey: `${state.bookId}:${state.chapter}:${tab.id}` })
  // The bottom controls overlay the reader and collapse with the header (NEW-012); a sheet being
  // open keeps them as they are (the hook is frozen then).
  useEffect(() => { chromeState.set({ overlay: true }); return () => chromeState.set({ overlay: false, collapsed: false }) }, [])
  useEffect(() => { chromeState.set({ collapsed: headerHidden }) }, [headerHidden])

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

  const title = `${bookName(state.bookId)} ${displayChapter(state.bookId, state.chapter)}`

  // ── text-switch double buffer (NEW-005A) ────────────────────────────────────────────────
  const centerKey = `${state.bookId}-${state.chapter}-${textId}`
  type PaneId = { key: string; textId: string; bookId: string; chapter: number }
  const [shownCenter, setShownCenter] = useState<PaneId>({ key: centerKey, textId, bookId: state.bookId, chapter: state.chapter })
  const [heldPane, setHeldPane] = useState<PaneId | null>(null)
  if (shownCenter.key !== centerKey) {
    // Derived-state update during render: only a TEXT switch holds the old pane (a chapter change
    // is the pager's own animation).
    setHeldPane(shownCenter.textId !== textId && !continuous ? shownCenter : null)
    setShownCenter({ key: centerKey, textId, bookId: state.bookId, chapter: state.chapter })
  }
  const releaseHeld = useCallback(() => setHeldPane(null), [])
  // A chapter that never loads (no such passage in that text) must not leave the old text up:
  // the hold ends after at most 1.5 s whatever happens.
  useEffect(() => { if (!heldPane) return; const t = setTimeout(releaseHeld, 1500); return () => clearTimeout(t) }, [heldPane, releaseHeld])
  return (
    <Page
      noScroll
      className={`is-reader${headerHidden ? ' is-header-hidden' : ''}`}
      // Translation, Reading (Aa) and "…" moved into the caret (TEST-033/034); the title stays the
      // passage navigator (TEST-041).
      // The text is named only when it is the Septuagint (T23-007) — KJV is the default, and the
      // caret's All Translations shows the current text.
      title={<button type="button" className="mobile-title-button" onClick={openReference} aria-label={`${title}, ${translationShortLabel(textId)}. Go to a passage`}><BookOpen size={16} aria-hidden /> {title}{textId === 'lxx' && <span className="mobile-title-sub">LXX</span>}</button>}
    >
      <CompactPassageHeader label={title} badge={textId === 'lxx' ? 'LXX' : null} visible={headerHidden} onOpen={openReference} />
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
          drag="x" dragDirectionLock dragListener={!isSettling}
          dragConstraints={{ left: neighbours.next ? -width : 0, right: neighbours.prev ? width : 0 }}
          dragElastic={0.12}
          onDragEnd={onDragEnd}
        >
          <ReaderPane key={neighbours.prev ? `${neighbours.prev.bookId}-${neighbours.prev.chapter}` : 'none-prev'} width={width} target={neighbours.prev} textId={textId} showStrongs={state.showStrongs} preview />
          {/* Center slot, double-buffered for a text switch (NEW-005A): the previous text's pane
              (same keyed DOM, same scroll position) stays on top until the new text has loaded and
              restored its position, then both swap in one commit — nothing half-rendered shows. */}
          <div className="mobile-reader-slot" style={{ width }}>
            {heldPane && (
              <ReaderPane key={heldPane.key} width={width} target={{ bookId: heldPane.bookId, chapter: heldPane.chapter }} textId={heldPane.textId} showStrongs={state.showStrongs} held />
            )}
            <ReaderPane key={centerKey} width={width} waitForLoad={!!heldPane} onReady={releaseHeld} target={{ bookId: state.bookId, chapter: state.chapter }} textId={textId} showStrongs={state.showStrongs}
            targetVerse={state.targetVerse} onTargetVerseConsumed={() => updateTabState('scripture', tab.id, { targetVerse: undefined })}
            onStrongsClick={openStrongs} tabId={tab.id} initialAnchor={pagedAnchor} onSaveAnchor={saveAnchor} />
          </div>
          <ReaderPane key={neighbours.next ? `${neighbours.next.bookId}-${neighbours.next.chapter}` : 'none-next'} width={width} target={neighbours.next} textId={textId} showStrongs={state.showStrongs} preview />
        </motion.div>
        )}
        {/* Far-left / far-right taps turn the chapter (TEST-037); swipes keep working through the
            pager. Thin strips, so text selection and the verse tap zone are unaffected. */}
        <button type="button" className="mobile-reader-edge is-left" aria-label={neighbours.prev ? `Previous chapter, ${bookName(neighbours.prev.bookId)} ${displayChapter(neighbours.prev.bookId, neighbours.prev.chapter)}` : 'No previous chapter'} onClick={() => goNeighbour('prev')} />
        <button type="button" className="mobile-reader-edge is-right" aria-label={neighbours.next ? `Next chapter, ${bookName(neighbours.next.bookId)} ${displayChapter(neighbours.next.bookId, neighbours.next.chapter)}` : 'No next chapter'} onClick={() => goNeighbour('next')} />
        {pinch.badge && <div className="mobile-pinch-badge" aria-live="polite">{pinch.badge}</div>}
        <SelectionBar tabId={tab.id} onOpenNote={openNoteInNotesSpace} />
      </div>
      </VerseInteractionContext.Provider>
    </Page>
  )
}

function ReaderPane({ width, target, textId, showStrongs, preview, held, waitForLoad, onReady, targetVerse, onTargetVerseConsumed, onStrongsClick, tabId, initialAnchor, onSaveAnchor }: {
  width: number; target: { bookId: string; chapter: number } | null; textId: string; showStrongs: boolean; preview?: boolean
  /** The previous text's pane kept on top during a text switch (NEW-005A). */
  held?: boolean
  /** Stay hidden until the verses are loaded (a held pane covers it meanwhile). */
  waitForLoad?: boolean
  onReady?: () => void
  targetVerse?: number; onTargetVerseConsumed?: () => void; onStrongsClick?: (num: string) => void; tabId?: string
  initialAnchor?: ReaderAnchor; onSaveAnchor?: (el: HTMLElement) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  // A pane that has a position to restore stays invisible until it is restored, so a remount
  // (translation switch, returning to the tab) never shows the chapter's top for a frame and then
  // jumps — the "new text shows above the sheet for a moment" flash (T23-004).
  const [ready, setReady] = useState(() => !waitForLoad && (!initialAnchor || !!targetVerse))
  useEffect(() => { if (ready) onReady?.() }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
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
    <div className={`mobile-reader-pane${held ? ' is-held' : ''}`} style={{ width, visibility: ready || held ? undefined : 'hidden' }} aria-hidden={preview || held || undefined}>
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
