import React, { useCallback, useState } from 'react'
import { Copy, Hash, NotepadText, GitFork, Volume2, Palette, Tag, X, Check, type LucideIcon } from 'lucide-react'
import { useAppStore, type SelectedVerseRef } from '@/store'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { selectionToRanges, rangesLabel } from '@/lib/verseTagRanges'
import { sortSelection, refLabel, fetchVerse } from '@/components/bible/VerseSelectionBar'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { HighlightColor } from '@/types'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { TagPickerSheet } from './TagPickerSheet'
import { CrossRefsSheet } from './CrossRefsSheet'
import { VerseNotesSheet } from './VerseNotesSheet'

/**
 * Verse selection bar for the phone (R075): appears above the tab pill while verse numbers
 * are selected in the active scripture tab. Same actions as the desktop VerseSelectionBar,
 * sized for thumbs: copy verses / refs, add note, notes, cross refs (single verse), play,
 * tag, highlight, clear.
 */
export function SelectionBar({ tabId, onOpenNote }: { tabId: string; onOpenNote: (noteId: string) => void }) {
  const selectedRaw = useAppStore((s) => s.selectedVersesByTab[tabId] ?? EMPTY)
  const clearVerseSelectionRaw = useAppStore((s) => s.clearVerseSelection)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpVerseNoteToken = useAppStore((s) => s.bumpVerseNoteToken)
  const startPlaybackFrom = useAppStore((s) => s.startPlaybackFrom)
  const sheets = useSheets()
  const [copied, setCopied] = useState<'verses' | 'refs' | null>(null)
  const [palette, setPalette] = useState(false)
  const sel = sortSelection(selectedRaw)
  const clear = useCallback(() => clearVerseSelectionRaw(tabId), [clearVerseSelectionRaw, tabId])
  if (sel.length === 0) return null
  const single = sel.length === 1 ? sel[0] : null
  const flash = (w: 'verses' | 'refs') => { setCopied(w); void haptic.light(); setTimeout(() => setCopied(null), 1200) }

  const copyVerses = async (refsOnly: boolean) => {
    const header = refLabel(sel)
    if (refsOnly) { navigator.clipboard.writeText(header).catch(() => {}); flash('refs'); return }
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string; textTagged: string | null }>
    if (fetched.length === 1) {
      const v = fetched[0]
      navigator.clipboard.writeText(`${header} ${buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)}`).catch(() => {})
    } else {
      const lines = fetched.map((v) => `${v.verse} ${buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)}`)
      navigator.clipboard.writeText([header, ...lines].join('\n')).catch(() => {})
    }
    flash('verses')
  }
  const addNote = async () => {
    const anchor = sel[0]
    const result = await window.notes.createNote({ type: 'verse', title: refLabel(sel), verseRef: `${anchor.bookId}.${anchor.chapter}.${anchor.verse}`, content: '', textId: anchor.textId })
    if (result.success && result.note) { bumpNoteToken(); bumpVerseNoteToken(); clear(); onOpenNote(result.note.id) }
  }
  const applyHighlight = async (color: HighlightColor) => {
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string }>
    for (const v of fetched) await window.highlights.toggle({ bookId: v.bookId, chapter: v.chapter, verseNum: v.verse, color, textId: v.textId, startChar: 0, endChar: v.text.length })
    bumpHighlightToken(); void haptic.light(); setPalette(false)
  }
  const removeHighlights = async () => {
    for (const v of sel) await window.highlights.remove(v.bookId, v.chapter, v.verse, v.textId).catch(() => {})
    bumpHighlightToken(); setPalette(false)
  }
  const tag = () => {
    const ranges = selectionToRanges(sel.map((r) => ({ bookId: r.bookId, chapter: r.chapter, verse: r.verse })))
    sheets.open({ id: 'tag-picker', detents: [0.6, 0.92], render: (api) => <TagPickerSheet ranges={ranges} label={rangesLabel(ranges)} kind="verses" api={api} /> })
  }
  const crossRefs = () => {
    if (!single) return
    sheets.open({ id: 'crossrefs', detents: [0.55, 0.92], render: (api) => <CrossRefsSheet bookId={single.bookId} chapter={single.chapter} verse={single.verse} textId={single.textId} label={refLabel(sel)} api={api} /> })
  }
  const notes = () => {
    if (!single) return
    sheets.open({ id: 'verse-notes', detents: [0.5, 0.92], render: (api) => (
      <VerseNotesSheet verseRef={`${single.bookId}.${single.chapter}.${single.verse}`} textId={single.textId} label={refLabel(sel)} api={api} onOpenNote={onOpenNote} onNewNote={() => void addNote()} />
    ) })
  }

  return (
    <div className="mobile-selection-bar" role="toolbar" aria-label={`${sel.length} verse${sel.length === 1 ? '' : 's'} selected`}>
      {palette ? (
        <div className="mobile-selection-palette">
          {HIGHLIGHT_COLOR_IDS.map((c) => (
            <button key={c} type="button" className="mobile-swatch" style={{ backgroundColor: highlightDotColor(c) }} aria-label={HIGHLIGHT_LABELS[c]} onClick={() => void applyHighlight(c)} />
          ))}
          <button type="button" className="mobile-swatch is-clear" aria-label="Remove highlights" onClick={() => void removeHighlights()}><X size={16} aria-hidden /></button>
          <button type="button" className="mobile-selection-btn" aria-label="Back" onClick={() => setPalette(false)}>Back</button>
        </div>
      ) : (
        <div className="mobile-selection-actions">
          <span className="mobile-selection-count">{sel.length}</span>
          <Btn icon={copied === 'verses' ? Check : Copy} label={sel.length > 1 ? 'Copy verses' : 'Copy verse'} onClick={() => void copyVerses(false)} />
          <Btn icon={copied === 'refs' ? Check : Hash} label="Copy references" onClick={() => void copyVerses(true)} />
          <Btn icon={NotepadText} label="Add note" onClick={() => void addNote()} />
          {single && <Btn icon={NotepadText} label="Notes" onClick={notes} />}
          {single && <Btn icon={GitFork} label="Cross references" onClick={crossRefs} />}
          <Btn icon={Volume2} label="Play from here" onClick={() => { const v = sel[0]; startPlaybackFrom(v.bookId, v.chapter, v.verse, v.textId); clear() }} />
          <Btn icon={Tag} label="Tag" onClick={tag} />
          <Btn icon={Palette} label="Highlight" onClick={() => setPalette(true)} />
          <Btn icon={X} label="Clear selection" onClick={clear} />
        </div>
      )}
    </div>
  )
}

const EMPTY: SelectedVerseRef[] = []

function Btn({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return <button type="button" className="mobile-selection-btn" aria-label={label} onClick={onClick}><Icon size={20} aria-hidden /></button>
}
