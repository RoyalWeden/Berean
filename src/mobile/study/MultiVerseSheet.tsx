import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Hash, Tag as TagIcon, Volume2, Eraser, Check, GitFork, Share2, Link2, NotepadText } from 'lucide-react'
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
import { MultiVerseNotesSheet } from './VerseNotesSheet'
import { aggregateVerseNotes } from '@/lib/verseNotesAggregate'
import { useAppStore } from '@/store'
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
export function MultiVerseSheet({ tabId, api, onOpenNote }: { tabId: string; api: SheetApi; onOpenNote?: (noteId: string) => void }) {
  const openNote = (id: string) => onOpenNote?.(id)
  const { sel, label, copyVerses, share, applyHighlight, removeHighlights, tagRanges, play } = useVerseSelectionActions(tabId)
  const [copied, setCopied] = useState<'verses' | 'refs' | null>(null)
  const sheets = useSheets()
  const mode = useVerseSheetMode()
  const oneChapter = sel.length > 0 && sel.every((v) => v.bookId === sel[0].bookId && v.chapter === sel[0].chapter && v.textId === sel[0].textId)
  // Strong's mode shows every selected verse with its numbers — at the compact position (inner
  // scroll) and expanded (flowing in the sheet).
  const showStrongs = mode === 'strongs'
  const verses = useSelectedVerses(sel, showStrongs)
  const rootRef = useRef<HTMLDivElement>(null)
  // LOW position = the same compact height as one verse's sheet in the same mode (SEP27-VERSE-003):
  // never taller just because more verses are selected. What does not fit scrolls INSIDE the
  // Strong's block; expanded, the block has no cap and simply flows in the sheet's own scroll.
  const strongsRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const block = strongsRef.current
    if (!block) return
    if (!api.atLow) { block.style.maxHeight = ''; return }
    const measure = () => {
    // What the sheet actually shows on screen at its compact position (whatever height one verse
    // gave it), minus the home-indicator inset: the block fills exactly the rest and scrolls.
    const visibleBottom = window.innerHeight - safeAreaBottom()
    block.style.maxHeight = `${Math.max(56, Math.round(visibleBottom - block.getBoundingClientRect().top - 10))}px`
    }
    measure()
    // Again once the sheet has settled (it may still be sliding into place).
    const t = setTimeout(measure, 320)
    return () => clearTimeout(t)
  }, [api.atLow, api.detent, mode, verses]) // eslint-disable-line react-hooks/exhaustive-deps
  const noteCount = useSelectedNoteCount(sel)

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
  const showNotes = () => {
    api.push({ key: 'notes', title: 'Notes', render: (a) => <MultiVerseNotesSheet verses={sel} label={label} api={a} onOpenNote={openNote} /> })
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

      {/* The same four slots as one verse (SEP27-VERSE-001): Copy · Notes · Refs · Strong's. */}
      <div className="mobile-verse-primary" role="group" aria-label={`Actions for ${label}`}>
        <Action icon={copied === 'verses' ? Check : Copy} label={copied === 'verses' ? 'Copied' : 'Copy'} onClick={() => { void copy(false) }} />
        <Action icon={NotepadText} label="Notes" badge={noteCount} onClick={showNotes} />
        {oneChapter && <Action icon={GitFork} label="Refs" onClick={showRefs} />}
        {api.atLow && <Action icon={Hash} label="Strong's" pressed={mode === 'strongs'} onClick={toggleStrongs} />}
      </div>

      {showStrongs && (
        <div ref={strongsRef} className={`mobile-verse-strongs is-multi${api.atLow ? ' is-capped' : ''}`}>
          {verses === null ? <div className="mobile-muted">Loading…</div> : verses.map((v) => (
            <div key={`${v.book_id}.${v.chapter}.${v.verse_num}`} className="mobile-verse-strongs-item">
              <span className="mobile-verse-strongs-num">{v.verse_num}</span>
              <StrongsVerse verse={v} textId={(v as Verse & { textId?: string }).textId ?? sel[0].textId} onStrongs={(num) => { api.push({ key: `strongs-${num}`, title: num, render: (a) => <StrongsSheet strongsNum={num} api={a} /> }); if (api.atLow) api.setDetent(1) }} />
            </div>
          ))}
        </div>
      )}

      {!(showStrongs && api.atLow) && (
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
          <button type="button" className="mobile-action-row" onClick={() => { void copy(true) }}>{copied === 'refs' ? <Check size={20} aria-hidden /> : <Link2 size={20} aria-hidden />}<span>{copied === 'refs' ? 'Copied' : 'Copy references'}</span></button>
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

/** How many distinct notes the selected verses have (the Notes badge). */
function useSelectedNoteCount(sel: ReadonlyArray<{ bookId: string; chapter: number; verse: number; textId: string }>): number {
  const [n, setN] = useState(0)
  const token = useAppStore((s) => s.noteChangeToken)
  const key = sel.map((v) => `${v.textId}|${v.bookId}.${v.chapter}.${v.verse}`).join(',')
  useEffect(() => {
    let alive = true
    void Promise.all(sel.map(async (v) => {
      const ref = `${v.bookId}.${v.chapter}.${v.verse}`
      return { ref, notes: await window.notes.getVerseNotes(ref, v.textId).catch(() => []) }
    })).then((per) => { if (alive) setN(aggregateVerseNotes(per).length) })
    return () => { alive = false }
  }, [key, token]) // eslint-disable-line react-hooks/exhaustive-deps
  return n
}
