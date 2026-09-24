import React, { useState } from 'react'
import { Copy, Hash, Tag as TagIcon, Volume2, Eraser, Check, X } from 'lucide-react'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { useVerseSelectionActions } from './SelectionBar'
import { TagPickerSheet } from './TagPickerSheet'

/**
 * The verse sheet's view of a SEVERAL-verse selection (T23-028). Tapping a second verse adds it to
 * the selection and this same sheet (same height) switches to this view: the combined reference
 * ("John 3:6-7, 18"), highlight-all, copy (the shared multi-verse format), tag, play, clear.
 * Tapping a selected verse deselects it; back at one verse the sheet returns to the study view.
 */
export function MultiVerseSheet({ tabId, api }: { tabId: string; api: SheetApi }) {
  const { sel, label, clear, copyVerses, applyHighlight, removeHighlights, tagRanges, play } = useVerseSelectionActions(tabId)
  const [copied, setCopied] = useState<'verses' | 'refs' | null>(null)
  if (sel.length < 2) return null
  const copy = async (refsOnly: boolean) => {
    await copyVerses(refsOnly)
    void haptic.light()
    setCopied(refsOnly ? 'refs' : 'verses')
    setTimeout(() => setCopied(null), 1200)
  }
  return (
    <div className={`mobile-verse-sheet${api.atLow ? ' is-low' : ''}`}>
      <div className="mobile-verse-actions-head">
        <div className="mobile-verse-actions-ref">{label}<span className="mobile-verse-actions-count"> · {sel.length} verses</span></div>
      </div>
      <div className="mobile-swatch-row is-scroll" role="group" aria-label="Highlight selected verses" data-no-sheet-drag>
        {HIGHLIGHT_COLOR_IDS.map((c) => (
          <button key={c} type="button" className="mobile-swatch" style={{ backgroundColor: highlightDotColor(c) }} aria-label={`${HIGHLIGHT_LABELS[c]} (${sel.length} verses)`} onClick={() => void applyHighlight(c)} />
        ))}
        <button type="button" className="mobile-swatch is-clear" aria-label="Remove highlights from selected verses" onClick={() => void removeHighlights()}>
          <Eraser size={16} aria-hidden />
        </button>
      </div>
      <div className="mobile-tile-row">
        <Tile icon={copied === 'verses' ? Check : Copy} label="Copy" onClick={() => void copy(false)} />
        <Tile icon={copied === 'refs' ? Check : Hash} label="Copy refs" onClick={() => void copy(true)} />
        <Tile icon={TagIcon} label="Tag" onClick={() => {
          const { ranges, label: l } = tagRanges()
          api.push({ key: 'tag', title: 'Tag verses', expand: true, render: (a) => <TagPickerSheet ranges={ranges} label={l} kind="verses" api={a} /> })
        }} />
        <Tile icon={Volume2} label="Play" onClick={() => { play(); api.close() }} />
        <Tile icon={X} label="Clear" onClick={() => { clear(); api.close() }} />
      </div>
    </div>
  )
}

function Tile({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button type="button" className="mobile-tile" onClick={onClick}>
      <Icon size={20} aria-hidden />
      <span>{label}</span>
    </button>
  )
}
