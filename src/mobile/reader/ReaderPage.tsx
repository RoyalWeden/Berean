import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { BookOpen, Hash, MoreHorizontal, Languages } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Book, Tab } from '@/types'
import ChapterView from '@/components/bible/ChapterView'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { navigateToVerse } from '@/lib/verseNavigation'
import { Page, IconTap } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import { ReferencePicker } from './ReferencePicker'
import { usePinchFontSize } from './usePinchFontSize'

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
  const openMore = () => {
    actions('reader-more', undefined, [
      { id: 'strongs', label: state.showStrongs ? "Hide Strong's numbers" : "Show Strong's numbers", icon: Hash, onSelect: () => updateTabState('scripture', tab.id, { showStrongs: !state.showStrongs }) },
    ])
  }

  const title = `${bookName(state.bookId)} ${state.chapter}`
  return (
    <Page
      noScroll
      title={<button type="button" className="mobile-title-button" onClick={openReference} aria-label={`${title}. Choose passage`}><BookOpen size={16} aria-hidden /> {title}</button>}
      left={<IconTap icon={Languages} label={`Translation: ${textId.toUpperCase()}`} onClick={openTranslation} />}
      right={<><IconTap icon={Hash} label="Strong's numbers" active={state.showStrongs} onClick={() => updateTabState('scripture', tab.id, { showStrongs: !state.showStrongs })} /><IconTap icon={MoreHorizontal} label="More" onClick={openMore} /></>}
    >
      <div className="mobile-reader" {...pinch.handlers}>
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
        {pinch.badge && <div className="mobile-pinch-badge" aria-live="polite">{pinch.badge}</div>}
      </div>
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
