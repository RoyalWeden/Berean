import React, { useState } from 'react'
import { Copy, Hash, NotepadText, GitFork, Volume2, Tag as TagIcon, Highlighter, Eraser } from 'lucide-react'
import type { HighlightColor } from '@/types'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { VerseActionContext } from '@/components/bible/verseInteraction'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'

/**
 * The verse long-press sheet (R075): context-adaptive — with a text selection inside the verse
 * the highlight row targets the selection and "Copy selection" appears; otherwise the whole
 * verse. Every action is the desktop implementation handed over by VerseRow.
 */
export function VerseActionSheet({ ctx, api, onShowNotes, onShowCrossRefs, onTag, onNoteCreated }: {
  ctx: VerseActionContext
  api: SheetApi
  onShowNotes: () => void
  onShowCrossRefs: () => void
  onTag: (scope: 'verse' | 'chapter') => void
  onNoteCreated: (noteId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const sel = ctx.selection
  const run = (fn: () => void | Promise<unknown>) => async () => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false); api.close() }
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

  return (
    <div className="mobile-verse-actions">
      <div className="mobile-verse-actions-head">
        <div className="mobile-verse-actions-ref">{ctx.label}</div>
        <div className="mobile-verse-actions-text">{sel ? `“${sel.text.trim()}”` : ctx.verse.text}</div>
      </div>

      <div className="mobile-verse-actions-section">
        <div className="mobile-verse-actions-label"><Highlighter size={14} aria-hidden /> {sel ? 'Highlight selection' : 'Highlight verse'}</div>
        <div className="mobile-swatch-row" role="group" aria-label="Highlight colour">
          {HIGHLIGHT_COLOR_IDS.map((c) => (
            <button key={c} type="button" className={`mobile-swatch${ctx.activeHighlight === c && !sel ? ' is-on' : ''}`}
              style={{ backgroundColor: highlightDotColor(c) }} aria-label={HIGHLIGHT_LABELS[c]} aria-pressed={ctx.activeHighlight === c && !sel}
              onClick={highlight(c)} disabled={busy} />
          ))}
          <button type="button" className="mobile-swatch is-clear" aria-label={sel ? 'Remove highlights from selection' : 'Remove highlight'} onClick={clear} disabled={busy}>
            <Eraser size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="mobile-action-list">
        {sel && (
          <button type="button" className="mobile-action-row" onClick={run(() => navigator.clipboard.writeText(sel.text.trim()))}><Copy size={20} aria-hidden /><span>Copy selection</span></button>
        )}
        <button type="button" className="mobile-action-row" onClick={run(ctx.copyVerse)}><Copy size={20} aria-hidden /><span>Copy verse</span></button>
        <button type="button" className="mobile-action-row" onClick={run(ctx.copyReference)}><Hash size={20} aria-hidden /><span>Copy reference</span></button>
        <button type="button" className="mobile-action-row" onClick={run(async () => { const id = await ctx.addVerseNote(); if (id) onNoteCreated(id) })}><NotepadText size={20} aria-hidden /><span>Add note</span></button>
        <button type="button" className="mobile-action-row" onClick={run(onShowNotes)}><NotepadText size={20} aria-hidden /><span>Show notes for this verse</span></button>
        <button type="button" className="mobile-action-row" onClick={run(onShowCrossRefs)}><GitFork size={20} aria-hidden /><span>Cross references</span></button>
        <button type="button" className="mobile-action-row" onClick={run(ctx.playAudioFromHere)}><Volume2 size={20} aria-hidden /><span>Play audio from here</span></button>
        <button type="button" className="mobile-action-row" onClick={run(() => onTag('verse'))}><TagIcon size={20} aria-hidden /><span>Tag verse…</span></button>
        <button type="button" className="mobile-action-row" onClick={run(() => onTag('chapter'))}><TagIcon size={20} aria-hidden /><span>Tag whole chapter…</span></button>
      </div>
    </div>
  )
}
