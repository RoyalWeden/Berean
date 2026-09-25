import React, { useEffect, useState } from 'react'
import { Copy, Hash, NotepadText, GitFork, Volume2, Tag as TagIcon, Eraser, Share2, Columns2, Check, type LucideIcon } from 'lucide-react'
import type { HighlightColor, BibleTabState } from '@/types'
import { useAppStore } from '@/store'
import { makeCompareTabState } from '../reader/compareState'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { VerseActionContext } from '@/components/bible/verseInteraction'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { safeAreaBottom } from '../primitives/safeArea'
import { StrongsVerse, VerseStudy } from './VerseStudy'
import type { CrossRefSourceId, XRef } from './useVerseCrossRefs'
import { setVerseSheetMode, useVerseSheetMode, verseSheetLowPx } from './verseSheetMode'
import './study.css'

/** Visible height of the verse sheet's compact (brief) position, before safe area. */
export const VERSE_SHEET_LOW_PX = 150

/**
 * The verse sheet (SEP25 rework). A TAP on a verse opens it at the compact position:
 *   • the reference ("Deuteronomy 29:3", "… LXX" only for the Septuagint),
 *   • the four study actions — Notes · Strong's · Refs · Copy — then the highlight colours.
 * Modes: "Strong's" toggles the compact sheet between BRIEF (actions only) and STRONG'S (the verse
 * with its Strong's numbers, tappable) — an explicit choice, remembered on this device. Dragging
 * up is the EXPANDED state: the study view (verse + Strong's + cross references TSK/e · Classic ·
 * My Notes) and every other action (share, copy reference, audio, compare, tags).
 * Notes and cross references open INSIDE this sheet ("‹ Deuteronomy 29:3"), where notes are
 * edited in place.
 */
export function VerseActionSheet({ ctx, api, onShowNotes, onShowCrossRefs, onTag, onStrongs, onNavigateRef }: {
  ctx: VerseActionContext
  api: SheetApi
  onShowNotes: () => void
  onShowCrossRefs: () => void
  onTag: (scope: 'verse' | 'chapter') => void
  onStrongs: (num: string) => void
  onNavigateRef: (r: XRef, source: CrossRefSourceId) => void
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const sheets = useSheets()
  const mode = useVerseSheetMode()
  const noteCount = useVerseNoteCount(ctx.verseRef, ctx.textId)
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
  // Copy stays in the sheet with a check mark (the most frequent action; closing would lose context).
  const copy = async () => {
    if (sel) await navigator.clipboard.writeText(sel.text.trim()).catch(() => {})
    else ctx.copyVerse()
    void haptic.success()
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const share = run(async () => { const { Share } = await import('@capacitor/share'); await Share.share({ title: ctx.label, text: `${ctx.label} ${sel ? sel.text.trim() : ctx.verse.text}` }).catch(() => {}) })
  // Compare THIS tab at this verse (SEP25: an action inside a tab changes that tab; ‹ returns to
  // the plain reader). A compare tab already comparing just moves to the verse.
  const compare = run(() => {
    const s = useAppStore.getState()
    const active = s.tabs.scripture.find((t) => t.id === s.activeTabId.scripture)
    if (!active || active.type !== 'bible') return
    const base = { ...(active.state as BibleTabState), bookId: ctx.verse.book_id, chapter: ctx.verse.chapter }
    s.updateTabState('scripture', active.id, (active.state as BibleTabState).compareMode ? { targetVerse: ctx.verse.verse_num } : makeCompareTabState(base, ctx.verse.verse_num))
  })
  const toggleStrongsMode = () => {
    const next = mode === 'strongs' ? 'brief' : 'strongs'
    void haptic.selection()
    setVerseSheetMode(next)
    // The compact position grows to hold the verse (and shrinks back).
    sheets.update('verse', { lowDetent: verseSheetLowPx(next, VERSE_SHEET_LOW_PX) + safeAreaBottom() })
  }
  const openAndExpand = (fn: () => void) => () => { fn(); if (api.atLow) api.setDetent(1) }
  const showVerseInline = mode === 'strongs' && !sel

  return (
    <div className={`mobile-verse-sheet${api.atLow ? ' is-low' : ''}${showVerseInline ? ' is-strongs' : ''}`}>
      <div className="mobile-verse-actions-head">
        <div className="mobile-verse-actions-ref">{ctx.label}{sel ? ' · selection' : ''}</div>
        {sel && <div className="mobile-verse-actions-text">“{sel.text.trim()}”</div>}
      </div>

      {/* The four study actions — every position. */}
      <div className="mobile-verse-primary" role="group" aria-label="Verse actions">
        <Action icon={NotepadText} label="Notes" badge={noteCount} onClick={openAndExpand(onShowNotes)} />
        <Action icon={Hash} label="Strong's" pressed={mode === 'strongs'} onClick={toggleStrongsMode} />
        <Action icon={GitFork} label="Refs" onClick={openAndExpand(onShowCrossRefs)} />
        <Action icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} onClick={() => { void copy() }} />
      </div>

      {showVerseInline && (
        <div className="mobile-verse-strongs" data-no-sheet-drag>
          <StrongsVerse verse={ctx.verse} textId={ctx.textId} onStrongs={onStrongs} />
        </div>
      )}

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

      {!api.atLow && (
        <>
          <VerseStudy verse={ctx.verse} textId={ctx.textId} showVerse={!showVerseInline} onStrongs={onStrongs} onNavigate={(r, source) => { api.close(); onNavigateRef(r, source) }} />
          <div className="mobile-action-list">
            {sel && <button type="button" className="mobile-action-row" onClick={run(ctx.copyVerse)}><Copy size={20} aria-hidden /><span>Copy whole verse</span></button>}
            <button type="button" className="mobile-action-row" onClick={run(ctx.copyReference)}><Hash size={20} aria-hidden /><span>Copy reference</span></button>
            <button type="button" className="mobile-action-row" onClick={share}><Share2 size={20} aria-hidden /><span>Share…</span></button>
            <button type="button" className="mobile-action-row" onClick={run(ctx.playAudioFromHere)}><Volume2 size={20} aria-hidden /><span>Play audio from here</span></button>
            <button type="button" className="mobile-action-row" onClick={compare}><Columns2 size={20} aria-hidden /><span>Compare translations</span></button>
            <button type="button" className="mobile-action-row" onClick={() => onTag('verse')}><TagIcon size={20} aria-hidden /><span>Tag verse…</span><span className="mobile-action-row-chevron" aria-hidden>›</span></button>
            <button type="button" className="mobile-action-row" onClick={() => onTag('chapter')}><TagIcon size={20} aria-hidden /><span>Tag whole chapter…</span><span className="mobile-action-row-chevron" aria-hidden>›</span></button>
          </div>
        </>
      )}
    </div>
  )
}

/** How many notes reference this verse (refreshes with the notes change token). */
function useVerseNoteCount(verseRef: string, textId: string): number {
  const [n, setN] = useState(0)
  const token = useAppStore((s) => s.noteChangeToken)
  useEffect(() => {
    let alive = true
    window.notes.getVerseNotes(verseRef, textId).then((list) => { if (alive) setN(list.length) }).catch(() => {})
    return () => { alive = false }
  }, [verseRef, textId, token])
  return n
}

function Action({ icon: Icon, label, onClick, badge, pressed }: { icon: LucideIcon; label: string; onClick: () => void; badge?: number; pressed?: boolean }) {
  return (
    <button type="button" className={`mobile-verse-action${pressed ? ' is-on' : ''}`} onClick={onClick}
      aria-pressed={pressed} aria-label={badge ? `${label}, ${badge}` : label}>
      <span className="mobile-verse-action-icon"><Icon size={20} aria-hidden />{badge ? <span className="mobile-verse-action-badge" aria-hidden>{badge}</span> : null}</span>
      <span>{label}</span>
    </button>
  )
}
