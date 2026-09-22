import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { BookOpen, Hash, MoreHorizontal, Languages, ChevronLeft, ChevronRight, ALargeSmall } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Book, Tab } from '@/types'
import ChapterView from '@/components/bible/ChapterView'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { navigateToVerse } from '@/lib/verseNavigation'
import { isHermasBook, getHermasShortLabel, hermasVariantForTextId } from '@/lib/hermasMap'
import { Page, IconTap } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { perfMark } from '@/platform/ios/perf'
import { StrongsSheet } from '../study/StrongsSheet'
import { VerseActionSheet } from '../study/VerseActionSheet'
import { VerseNotesSheet } from '../study/VerseNotesSheet'
import { CrossRefsSheet } from '../study/CrossRefsSheet'
import { TagPickerSheet } from '../study/TagPickerSheet'
import { SelectionBar } from '../study/SelectionBar'
import { VerseInteractionContext, type VerseActionContext, type VerseInteraction } from '@/components/bible/verseInteraction'
import { ReferencePicker } from './ReferencePicker'
import { usePinchFontSize } from './usePinchFontSize'
import { ReaderOptionsSheet } from './ReaderOptionsSheet'
import ContinuousChapterScroll from '@/components/bible/ContinuousChapterScroll'

/**
 * Scripture reader (R070/R077/R078): the active Bible tab of the scripture space rendered as a
 * horizontal chapter pager (previous / current / next pages, follows the finger, respects book
 * boundaries, never fights vertical scroll), with pinch-to-resize writing `bibleFontSize`, the
 * reference picker and translation picker as sheets, and Strong's numbers opening the Strong's
 * sheet. The content itself is the shared ChapterView — the same verses, highlights, tags, notes
 * and Strong's chips as desktop.
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
  const goTo = useCallback((bookId: string, chapter: number, verse?: number) => {
    navigateToVerse({ bookId, chapter, verse, origin: { kind: 'sequential-nav' } })
  }, [])

  // ── pager ──────────────────────────────────────────────────────────────────────────────
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

  // ── Strong's / verse actions ────────────────────────────────────────────────────────────
  const openStrongs = useCallback((num: string) => {
    sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={num} api={api} /> })
  }, [sheets])

  // ── verse long-press → action sheet → notes / cross refs / tag sheets ───────────────────
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const openNoteInNotesSpace = useCallback((noteId: string) => {
    setActiveSpace('notes')
    useAppStore.getState().ensureTab('note')
    requestOpenNote(noteId)
  }, [setActiveSpace, requestOpenNote])
  const openVerseNotes = useCallback((ctx: VerseActionContext) => {
    sheets.open({ id: 'verse-notes', detents: [0.5, 0.92], render: (api) => (
      <VerseNotesSheet verseRef={ctx.verseRef} textId={ctx.textId} label={ctx.label} api={api}
        onOpenNote={openNoteInNotesSpace}
        onNewNote={() => { void ctx.addVerseNote().then((id) => { if (id) openNoteInNotesSpace(id) }) }} />
    ) })
  }, [sheets, openNoteInNotesSpace])
  const openCrossRefs = useCallback((ctx: VerseActionContext) => {
    sheets.open({ id: 'crossrefs', detents: [0.55, 0.92], render: (api) => (
      <CrossRefsSheet bookId={ctx.verse.book_id} chapter={ctx.verse.chapter} verse={ctx.verse.verse_num} textId={ctx.textId} label={ctx.label} api={api} />
    ) })
  }, [sheets])
  const openTagPicker = useCallback((ctx: VerseActionContext, scope: 'verse' | 'chapter') => {
    const { ranges, label, kind } = ctx.tagRanges(scope)
    sheets.open({ id: 'tag-picker', detents: [0.6, 0.92], render: (api) => <TagPickerSheet ranges={ranges} label={label} kind={kind} api={api} /> })
  }, [sheets])
  const verseInteraction = useMemo<VerseInteraction>(() => ({
    interaction: 'touch',
    onRequestActions: (ctx) => {
      void haptic.medium()
      sheets.open({ id: 'verse-actions', detents: [0.62, 0.92], render: (api) => (
        <VerseActionSheet ctx={ctx} api={api}
          onShowNotes={() => openVerseNotes(ctx)}
          onShowCrossRefs={() => openCrossRefs(ctx)}
          onTag={(scope) => openTagPicker(ctx, scope)}
          onNoteCreated={openNoteInNotesSpace} />
      ) })
    },
  }), [sheets, openVerseNotes, openCrossRefs, openTagPicker, openNoteInNotesSpace])

  const openReference = () => {
    sheets.open({
      id: 'reference', title: 'Go to', detents: [0.92], initialDetent: 0,
      render: (api) => <ReferencePicker books={books} bookId={state.bookId} chapter={state.chapter} onPick={(b, c, v) => { api.close(); goTo(b, c, v) }} />,
    })
  }
  const openTranslation = () => {
    actions('translation', 'Translation', TRANSLATIONS.map((t) => ({
      id: t.id, label: `${t.label} — ${t.description}`,
      onSelect: () => { updateTabState('scripture', tab.id, { translation: t.id.toUpperCase() }) },
    })))
  }
  const openOptions = () => sheets.open({ id: 'reader-options', title: 'Reading', detents: [0.72, 0.92], render: () => <ReaderOptionsSheet /> })
  const openMore = () => {
    actions('reader-more', undefined, [
      { id: 'strongs', label: state.showStrongs ? "Hide Strong's numbers" : "Show Strong's numbers", icon: Hash, onSelect: () => updateTabState('scripture', tab.id, { showStrongs: !state.showStrongs }) },
      { id: 'options', label: 'Reading options (text size, font, continuous scroll)…', icon: ALargeSmall, onSelect: openOptions },
      { id: 'prev', label: neighbours.prev ? `Previous chapter (${bookName(neighbours.prev.bookId)} ${neighbours.prev.chapter})` : 'Previous chapter', icon: ChevronLeft, disabled: !neighbours.prev, onSelect: () => neighbours.prev && goTo(neighbours.prev.bookId, neighbours.prev.chapter) },
      { id: 'next', label: neighbours.next ? `Next chapter (${bookName(neighbours.next.bookId)} ${neighbours.next.chapter})` : 'Next chapter', icon: ChevronRight, disabled: !neighbours.next, onSelect: () => neighbours.next && goTo(neighbours.next.bookId, neighbours.next.chapter) },
    ])
  }
  const continuous = useAppStore((s) => s.continuousChapterScroll)

  const title = `${bookName(state.bookId)} ${state.chapter}`
  return (
    <Page
      noScroll
      title={<button type="button" className="mobile-title-button" onClick={openReference} aria-label={`${title}. Choose passage`}><BookOpen size={16} aria-hidden /> {title}</button>}
      left={<IconTap icon={Languages} label={`Translation: ${textId.toUpperCase()}`} onClick={openTranslation} />}
      right={<><IconTap icon={ALargeSmall} label="Reading options" onClick={openOptions} /><IconTap icon={MoreHorizontal} label="More" onClick={openMore} /></>}
    >
      <VerseInteractionContext.Provider value={verseInteraction}>
      <div className="mobile-reader" {...pinch.handlers}>
        {continuous ? (
          <div className="mobile-reader-pane" style={{ width }}>
            <ContinuousChapterScroll
              key={`${state.bookId}-${textId}`}
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
            onStrongsClick={openStrongs} tabId={tab.id} />
          <ReaderPane key={neighbours.next ? `${neighbours.next.bookId}-${neighbours.next.chapter}` : 'none-next'} width={width} target={neighbours.next} textId={textId} showStrongs={state.showStrongs} preview />
        </motion.div>
        )}
        {pinch.badge && <div className="mobile-pinch-badge" aria-live="polite">{pinch.badge}</div>}
        <SelectionBar tabId={tab.id} onOpenNote={openNoteInNotesSpace} />
      </div>
      </VerseInteractionContext.Provider>
    </Page>
  )
}

function ReaderPane({ width, target, textId, showStrongs, preview, targetVerse, onTargetVerseConsumed, onStrongsClick, tabId }: {
  width: number; target: { bookId: string; chapter: number } | null; textId: string; showStrongs: boolean; preview?: boolean
  targetVerse?: number; onTargetVerseConsumed?: () => void; onStrongsClick?: (num: string) => void; tabId?: string
}) {
  return (
    <div className="mobile-reader-pane" style={{ width }} aria-hidden={preview}>
      {target ? (
        <div className="mobile-reader-scroll">
          <ChapterView bookId={target.bookId} chapter={target.chapter} textId={textId} showStrongs={showStrongs}
            targetVerse={targetVerse} onTargetVerseConsumed={onTargetVerseConsumed} onStrongsClick={onStrongsClick} tabId={tabId} />
          <div className="mobile-reader-end" />
        </div>
      ) : (
        <div className="mobile-reader-boundary">{preview ? 'Beginning / end of the library' : ''}</div>
      )}
    </div>
  )
}
