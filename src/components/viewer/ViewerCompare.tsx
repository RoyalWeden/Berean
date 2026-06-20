import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/store'
import { bookChapterLabel } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { buildVerseDisplayTokens } from '@/lib/verseUtils'
import { renderVerseText } from './ViewerBiblePage'
import type { DBHighlight } from './ViewerBiblePage'
import type { Verse } from '@/types'

interface ColSpec { textId: string; bookId: string; chapter: number }

function translationLabel(textId: string): string {
  return TRANSLATIONS.find(t => t.id === textId)?.label ?? textId.toUpperCase()
}

/** One read-only column in the presenter's compare view. */
function CompareColumn({ col, colIndex, fontScale, scrollPercent, muteColor, textColor, accentColor }: {
  col: ColSpec; colIndex: number; fontScale: number; scrollPercent?: number; muteColor: string; textColor: string; accentColor: string
}) {
  const [verses, setVerses] = useState<Verse[]>([])
  const [dbHls, setDbHls] = useState<Record<number, DBHighlight[]>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const reportRafRef = useRef<number | null>(null)
  const wrEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wrRules = useAppStore((s) => s.wordReplacerRules)
  const highlightChangeToken = useAppStore((s) => s.highlightChangeToken)

  useEffect(() => {
    window.bible.queryChapter(col.bookId, col.chapter, col.textId).then(setVerses).catch(() => setVerses([]))
  }, [col.bookId, col.chapter, col.textId])

  useEffect(() => {
    window.highlights.getChapter(col.bookId, col.chapter, col.textId)
      .then((raw) => setDbHls(raw as Record<number, DBHighlight[]>)).catch(() => {})
  }, [col.bookId, col.chapter, col.textId, highlightChangeToken])

  // Report this column's visible fraction + verse positions so the main window can outline it.
  const report = useCallback(() => {
    const c = scrollRef.current
    if (!c || c.scrollHeight <= 0) return
    if (reportRafRef.current) cancelAnimationFrame(reportRafRef.current)
    reportRafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el || el.scrollHeight <= 0) return
      const H = el.scrollHeight
      const cTop = el.getBoundingClientRect().top
      const verseFracs: Record<number, number> = {}
      for (const node of Array.from(el.querySelectorAll('[data-verse]'))) {
        const ex = node as HTMLElement
        const n = Number(ex.dataset.verse)
        if (Number.isFinite(n)) verseFracs[n] = (ex.getBoundingClientRect().top - cTop + el.scrollTop) / H
      }
      window.viewer?.reportVisibleRegion?.({ bookId: col.bookId, chapter: col.chapter, visibleFraction: Math.min(1, el.clientHeight / H), verseFracs, colIndex })
    })
  }, [col.bookId, col.chapter, colIndex])

  // Apply this column's own proportional scroll position.
  useEffect(() => {
    if (scrollPercent === undefined || scrollPercent === null) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) el.scrollTop = scrollPercent * max
      report()
    })
  }, [scrollPercent, verses, report])

  useEffect(() => { report() }, [verses, fontScale, report])

  const base = Math.round(15 * fontScale)
  return (
    <div className="flex-1 min-w-0 h-full flex flex-col" style={{ borderRight: '1px solid rgb(var(--color-surface-3, 50 50 70))' }}>
      <div
        className="flex-shrink-0 text-center select-none py-2 border-b"
        style={{ borderColor: 'rgb(var(--color-surface-3, 50 50 70))', background: 'rgb(var(--color-surface-2, 24 24 32))', fontSize: Math.round(13 * fontScale), fontWeight: 700, color: accentColor, letterSpacing: '0.04em' }}
      >
        {translationLabel(col.textId)}
        <span style={{ color: muteColor, fontWeight: 500, marginLeft: 6 }}>{bookChapterLabel(col.bookId, col.chapter)}{col.textId === 'lxx' ? ' LXX' : ''}</span>
      </div>
      <div ref={scrollRef} onScroll={report} className="flex-1 overflow-y-auto px-6 py-4" style={{ fontSize: base, lineHeight: 1.85, color: textColor }}>
        {verses.map((v) => (
          <div key={v.verse_num} data-verse={v.verse_num} className="flex gap-2.5 mb-0.5">
            <span className="select-none flex-shrink-0 tabular-nums text-right" style={{ fontSize: Math.round(base * 0.55), color: muteColor, width: Math.round(base * 1.5), paddingTop: '0.3em' }}>{v.verse_num}</span>
            <span className="flex-1">
              {renderVerseText(v.text, buildVerseDisplayTokens(v.text, v.text_tagged, col.textId, wrEnabled, wrRules), dbHls[v.verse_num] ?? [])}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ViewerCompare({ columns, fontScale, scrollPercents, muteColor, textColor, accentColor }: {
  columns: ColSpec[]; fontScale: number; scrollPercents?: number[]; muteColor: string; textColor: string; accentColor: string
}) {
  return (
    <div className="h-full w-full flex pt-[34px]">
      {columns.map((col, i) => (
        <CompareColumn key={`${col.textId}:${col.bookId}:${i}`} col={col} colIndex={i} fontScale={fontScale} scrollPercent={scrollPercents?.[i]} muteColor={muteColor} textColor={textColor} accentColor={accentColor} />
      ))}
    </div>
  )
}
