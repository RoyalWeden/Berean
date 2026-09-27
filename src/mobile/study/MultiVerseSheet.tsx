import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Hash, Tag as TagIcon, Volume2, Eraser, Check, GitFork, Share2, Link2 } from 'lucide-react'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { Verse } from '@/types'
import { fetchVerse } from '@/components/bible/VerseSelectionBar'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { safeAreaBottom } from '../primitives/safeArea'
import { useVerseSelectionActions } from './SelectionBar'
import { TagPickerSheet } from './TagPickerSheet'
import { CrossRefsSheet } from './CrossRefsSheet'
import { Action, VERSE_SHEET_LOW_PX } from './VerseActionSheet'
import { StrongsVerse } from './VerseStudy'
import { StrongsSheet } from './StrongsSheet'
import { setVerseSheetMode, useVerseSheetMode, verseSheetLowPx } from './verseSheetMode'
import './study.css'

/**
 * The verse sheet for SEVERAL selected verses (SEP26-VERSE-001…005) — the same component family
 * as the one-verse sheet, not a separate "bulk mode": the same title style (the Scripture
 * reference — "Matthew 23:12-14", non-contiguous "John 3:6-7, 18" — never "3 verses"), the same
 * four-slot action row with Copy FIRST (Copy · Copy refs · Refs · Strong's), the same highlight
 * colours, the same Strong's mode at the lowest position (every selected verse with its numbers,
 * no colours), and the same expanded list (Share, Read aloud, Tag). Copy refs takes the Notes
 * slot because a note attaches to one verse. No Clear button: dismissing the sheet clears the
 * selection; tapping another verse updates this same sheet (same detent).
 */
export function MultiVerseSheet({ tabId, api }: { tabId: string; api: SheetApi }) {
  const { sel, label, copyVerses, share, applyHighlight, removeHighlights, tagRanges, play } = useVerseSelectionActions(tabId)
  const [copied, setCopied] = useState<'verses' | 'refs' | null>(null)
  const sheets = useSheets()
  const mode = useVerseSheetMode()
  const oneChapter = sel.length > 0 && sel.every((v) => v.bookId === sel[0].bookId && v.chapter === sel[0].chapter && v.textId === sel[0].textId)
  const showStrongs = mode === 'strongs' && api.atLow
  const verses = useSelectedVerses(sel, showStrongs)
  const rootRef = useRef<HTMLDivElement>(null)
  // Strong's mode fits every selected verse (capped at 60 % of the screen) — as for one verse.
  useLayoutEffect(() => {
    if (!showStrongs) return
    const el = rootRef.current
    const sheetEl = el?.closest('.mobile-sheet') as HTMLElement | null
    if (!el || !sheetEl) return
    const chrome = el.getBoundingClientRect().top - sheetEl.getBoundingClientRect().top
    const want = Math.min(Math.round(chrome + el.scrollHeight + 10), Math.round(window.innerHeight * 0.6))
    sheets.update('verse', { lowDetent: want + safeAreaBottom() })
  }, [showStrongs, verses, label]) // eslint-disable-line react-hooks/exhaustive-deps

  if (sel.length < 2) return null
  const copy = async (refsOnly: boolean) => {
    await copyVerses(refsOnly)
    void haptic.success()
    setCopied(refsOnly ? 'refs' : 'verses')
    setTimeout(() => setCopied(null), 1200)
  }
  const toggleStrongs = () => {
    const next = mode === 'strongs' ? 'brief' : 'strongs'
    void haptic.selection()
    setVerseSheetMode(next)
    if (next === 'brief') sheets.update('verse', { lowDetent: verseSheetLowPx('brief', VERSE_SHEET_LOW_PX) + safeAreaBottom() })
  }
  const showRefs = () => {
    const f = sel[0]
    api.push({ key: 'crossrefs', title: 'Cross references', render: (a) => <CrossRefsSheet bookId={f.bookId} chapter={f.chapter} verses={sel.map((v) => v.verse)} textId={f.textId} label={label} api={a} /> })
    if (api.atLow) api.setDetent(1)
  }
  const tag = () => {
    const { ranges, label: l } = tagRanges()
    api.push({ key: 'tag', title: 'Tag verses', render: (a) => <TagPickerSheet ranges={ranges} label={l} kind="verses" api={a} /> })
    if (api.atLow) api.setDetent(1)
  }

  return (
    <div ref={rootRef} className={`mobile-verse-sheet${api.atLow ? ' is-low' : ''}${showStrongs ? ' is-strongs' : ''}`}>
      <div className="mobile-verse-actions-head">
        <div className="mobile-verse-actions-ref">{label}</div>
      </div>

      <div className="mobile-verse-primary" role="group" aria-label={`Actions for ${label}`}>
        <Action icon={copied === 'verses' ? Check : Copy} label={copied === 'verses' ? 'Copied' : 'Copy'} onClick={() => { void copy(false) }} />
        <Action icon={copied === 'refs' ? Check : Link2} label={copied === 'refs' ? 'Copied' : 'Copy refs'} onClick={() => { void copy(true) }} />
        {oneChapter && <Action icon={GitFork} label="Refs" onClick={showRefs} />}
        {api.atLow && <Action icon={Hash} label="Strong's" pressed={mode === 'strongs'} onClick={toggleStrongs} />}
      </div>

      {showStrongs && (
        <div className="mobile-verse-strongs is-multi">
          {verses === null ? <div className="mobile-muted">Loading…</div> : verses.map((v) => (
            <div key={`${v.book_id}.${v.chapter}.${v.verse_num}`} className="mobile-verse-strongs-item">
              <span className="mobile-verse-strongs-num">{v.verse_num}</span>
              <StrongsVerse verse={v} textId={(v as Verse & { textId?: string }).textId ?? sel[0].textId} onStrongs={(num) => { api.push({ key: `strongs-${num}`, title: num, render: (a) => <StrongsSheet strongsNum={num} api={a} /> }); if (api.atLow) api.setDetent(1) }} />
            </div>
          ))}
        </div>
      )}

      {!showStrongs && (
        <div className="mobile-swatch-row is-scroll" role="group" aria-label="Highlight selected verses" data-no-sheet-drag>
          {HIGHLIGHT_COLOR_IDS.map((c) => (
            <button key={c} type="button" className="mobile-swatch" style={{ backgroundColor: highlightDotColor(c) }} aria-label={`${HIGHLIGHT_LABELS[c]} (${sel.length} verses)`} onClick={() => void applyHighlight(c)} />
          ))}
          <button type="button" className="mobile-swatch is-clear" aria-label="Remove highlights from selected verses" onClick={() => void removeHighlights()}>
            <Eraser size={16} aria-hidden />
          </button>
        </div>
      )}

      {!api.atLow && (
        <div className="mobile-action-list">
          <button type="button" className="mobile-action-row" onClick={() => { void share() }}><Share2 size={20} aria-hidden /><span>Share…</span></button>
          <button type="button" className="mobile-action-row" onClick={() => { play(); api.close() }}><Volume2 size={20} aria-hidden /><span>{oneChapter ? 'Read aloud' : 'Read aloud from the first verse'}</span></button>
          <button type="button" className="mobile-action-row" onClick={tag}><TagIcon size={20} aria-hidden /><span>Tag verses…</span><span className="mobile-action-row-chevron" aria-hidden>›</span></button>
        </div>
      )}
    </div>
  )
}

/** The selected verses' text (for Strong's mode), loaded only while it is shown. */
function useSelectedVerses(sel: ReadonlyArray<{ bookId: string; chapter: number; verse: number; textId: string }>, enabled: boolean): Verse[] | null {
  const [verses, setVerses] = useState<Verse[] | null>(null)
  const key = sel.map((v) => `${v.textId}|${v.bookId}.${v.chapter}.${v.verse}`).join(',')
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setVerses(null)
    void Promise.all(sel.map((r) => fetchVerse(r as Parameters<typeof fetchVerse>[0]))).then((rows) => {
      if (!alive) return
      setVerses(rows.filter(Boolean).map((r) => {
        const v = r as { bookId: string; chapter: number; verse: number; text: string; textTagged: string | null; textId: string }
        return { book_id: v.bookId, chapter: v.chapter, verse_num: v.verse, text: v.text, text_tagged: v.textTagged, textId: v.textId } as unknown as Verse
      }))
    })
    return () => { alive = false }
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return verses
}
