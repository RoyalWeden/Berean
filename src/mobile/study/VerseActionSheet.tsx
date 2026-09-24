import React, { useState } from 'react'
import { Copy, Hash, NotepadText, GitFork, Volume2, Tag as TagIcon, Eraser, Share2, Columns2, Files, ChevronUp, type LucideIcon } from 'lucide-react'
import type { HighlightColor, BibleTabState } from '@/types'
import { useAppStore } from '@/store'
import { makeCompareTab } from '../reader/compareState'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { VerseActionContext } from '@/components/bible/verseInteraction'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { VerseStudy } from './VerseStudy'

/** Visible height of the verse sheet's special low position (TEST-039/040), before safe area. */
export const VERSE_SHEET_LOW_PX = 150

/**
 * The verse sheet (R075, reworked for TEST-035/039/040/043). Opened by a TAP anywhere on a verse
 * (whole-verse context) or by a native long-press text selection inside a verse (selection
 * context). It opens at the special LOW position — reference, highlight colours and the most
 * frequent actions — so the reader and any selection handles stay usable above it. Dragging up
 * reveals the study view (verse with Strong's numbers + cross references, e-Sword-inspired) and
 * every other verse action. Every action is the desktop implementation handed over by VerseRow.
 */
export function VerseActionSheet({ ctx, api, onShowNotes, onShowCrossRefs, onTag, onNoteCreated, onStrongs, onNavigateRef }: {
  ctx: VerseActionContext
  api: SheetApi
  onShowNotes: () => void
  onShowCrossRefs: () => void
  onTag: (scope: 'verse' | 'chapter') => void
  onNoteCreated: (noteId: string) => void
  onStrongs: (num: string) => void
  onNavigateRef: (r: { bookId: string; chapter: number; verse: number; endVerse: number | null }, source: 'tske' | 'classic') => void
}) {
  const [busy, setBusy] = useState(false)
  const sel = ctx.selection
  const run = (fn: () => void | Promise<unknown>) => async () => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally {
      setBusy(false)
      // An action on a text selection consumes it (the native handles go away with the sheet).
      if (sel) window.getSelection()?.removeAllRanges()
      api.close()
    }
  }
  const highlight = (color: HighlightColor) => run(async () => {
    void haptic.light()
    if (sel) await ctx.highlightRange(sel.startChar, sel.endChar, color)
    else await ctx.highlightVerse(color)
  })
  const clear = run(async () => {
    void haptic.light()
    if (sel) await ctx.clearRangeHighlights(sel.startChar, sel.endChar)
    else await ctx.removeVerseHighlight()
  })
  const copy = run(() => (sel ? navigator.clipboard.writeText(sel.text.trim()) : ctx.copyVerse()))
  const share = run(async () => { const { Share } = await import('@capacitor/share'); await Share.share({ title: ctx.label, text: `${ctx.label} ${sel ? sel.text.trim() : ctx.verse.text}` }).catch(() => {}) })
  const addNote = run(async () => { const id = await ctx.addVerseNote(); if (id) onNoteCreated(id) })
  const compare = run(() => {
    // "Compare this verse" (R088): a new compare tab beside the reader tab, at this verse.
    const s = useAppStore.getState()
    const active = s.tabs.scripture.find((t) => t.id === s.activeTabId.scripture)
    const base: BibleTabState = active?.type === 'bible' ? (active.state as BibleTabState) : { bookId: ctx.verse.book_id, chapter: ctx.verse.chapter, translation: ctx.textId.toUpperCase(), showStrongs: false, scrollPosition: 0 }
    s.addTab(makeCompareTab({ ...base, bookId: ctx.verse.book_id, chapter: ctx.verse.chapter }, ctx.verse.verse_num))
  })

  return (
    <div className={`mobile-verse-sheet${api.atLow ? ' is-low' : ''}`}>
      <div className="mobile-verse-actions-head">
        <div className="mobile-verse-actions-ref">{ctx.label}{sel ? ' · selection' : ''}</div>
        {/* The study view below shows the verse; the head quotes only a text selection. */}
        {!api.atLow && sel && <div className="mobile-verse-actions-text">“{sel.text.trim()}”</div>}
      </div>

      {/* Highlight colours — one scrolling row; targets the selection when there is one. */}
      <div className="mobile-swatch-row is-scroll" role="group" aria-label={sel ? 'Highlight selection' : 'Highlight verse'} data-no-sheet-drag>
        {HIGHLIGHT_COLOR_IDS.map((c) => (
          <button key={c} type="button" className={`mobile-swatch${ctx.activeHighlight === c && !sel ? ' is-on' : ''}`}
            style={{ backgroundColor: highlightDotColor(c) }} aria-label={`${HIGHLIGHT_LABELS[c]}${sel ? ' (selection)' : ''}`} aria-pressed={ctx.activeHighlight === c && !sel}
            onClick={highlight(c)} disabled={busy} />
        ))}
        <button type="button" className="mobile-swatch is-clear" aria-label={sel ? 'Remove highlights from selection' : 'Remove highlight'} onClick={clear} disabled={busy}>
          <Eraser size={16} aria-hidden />
        </button>
      </div>

      {/* Most frequent actions — visible at every position (Arc-style tiles). */}
      <div className="mobile-tile-row">
        <Tile icon={Copy} label="Copy" onClick={copy} />
        <Tile icon={NotepadText} label="Note" onClick={addNote} />
        <Tile icon={GitFork} label="Refs" onClick={() => { if (api.atLow) api.setDetent(1); else onShowCrossRefs() }} />
        <Tile icon={Share2} label="Share" onClick={share} />
        {api.atLow && <Tile icon={ChevronUp} label="More" onClick={() => api.setDetent(1)} />}
      </div>

      {!api.atLow && (
        <>
          <VerseStudy verse={ctx.verse} textId={ctx.textId} onStrongs={onStrongs} onNavigate={(r, source) => { api.close(); onNavigateRef(r, source) }} />
          <div className="mobile-action-list">
            {sel && <button type="button" className="mobile-action-row" onClick={run(ctx.copyVerse)}><Copy size={20} aria-hidden /><span>Copy whole verse</span></button>}
            <button type="button" className="mobile-action-row" onClick={run(ctx.copyReference)}><Hash size={20} aria-hidden /><span>Copy reference</span></button>
            {/* These open inside this sheet ("‹ <verse>" at the top), so they don't close it. */}
            <button type="button" className="mobile-action-row" onClick={onShowNotes}><Files size={20} aria-hidden /><span>Notes for this verse</span></button>
            <button type="button" className="mobile-action-row" onClick={onShowCrossRefs}><GitFork size={20} aria-hidden /><span>Cross references (full list)</span></button>
            <button type="button" className="mobile-action-row" onClick={run(ctx.playAudioFromHere)}><Volume2 size={20} aria-hidden /><span>Play audio from here</span></button>
            <button type="button" className="mobile-action-row" onClick={compare}><Columns2 size={20} aria-hidden /><span>Compare translations</span></button>
            <button type="button" className="mobile-action-row" onClick={() => onTag('verse')}><TagIcon size={20} aria-hidden /><span>Tag verse…</span></button>
            <button type="button" className="mobile-action-row" onClick={() => onTag('chapter')}><TagIcon size={20} aria-hidden /><span>Tag whole chapter…</span></button>
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" className="mobile-tile" onClick={onClick}>
      <Icon size={20} aria-hidden />
      <span>{label}</span>
    </button>
  )
}
