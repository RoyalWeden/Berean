import React, { useCallback, useState } from 'react'
import { Copy, Hash, NotepadText, GitFork, Volume2, Palette, Tag, X, Check, type LucideIcon } from 'lucide-react'
import { useAppStore, type SelectedVerseRef } from '@/store'
import { selectionAllows } from '@/lib/verseSelection'
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
 * Verse selection bar for the phone (R075): appears above the bottom navigation while verse numbers
 * are selected in the active scripture tab. Same actions as the desktop VerseSelectionBar,
 * sized for thumbs: copy verses / refs, add note, notes, cross refs (single verse), play,
 * tag, highlight, clear.
 */
/**
 * The actions on a tab's verse selection (one or several verses) — shared by the selection bar and
 * the verse sheet's multi-verse view (T23-028), so both copy / highlight / tag exactly the same
 * way (copy keeps the desktop multi-verse format: "John 3:6-7, 18" then one line per verse).
 */
export function useVerseSelectionActions(tabId: string, onOpenNote?: (noteId: string) => void) {
  const selectedRaw = useAppStore((s) => s.selectedVersesByTab[tabId] ?? EMPTY)
  const clearVerseSelectionRaw = useAppStore((s) => s.clearVerseSelection)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpVerseNoteToken = useAppStore((s) => s.bumpVerseNoteToken)
  const startPlaybackFrom = useAppStore((s) => s.startPlaybackFrom)
  const sel = sortSelection(selectedRaw)
  const clear = useCallback(() => clearVerseSelectionRaw(tabId), [clearVerseSelectionRaw, tabId])
  const copyVerses = async (refsOnly: boolean) => {
    const header = refLabel(sel)
    if (refsOnly) { await navigator.clipboard.writeText(header).catch(() => {}); return }
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string; textTagged: string | null }>
    if (fetched.length === 1) {
      const v = fetched[0]
      await navigator.clipboard.writeText(`${header} ${buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)}`).catch(() => {})
    } else {
      const lines = fetched.map((v) => `${v.verse} ${buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)}`)
      await navigator.clipboard.writeText([header, ...lines].join('\n')).catch(() => {})
    }
  }
  const addNote = async () => {
    if (!selectionAllows(sel, 'add-note')) return
    const anchor = sel[0]
    const result = await window.notes.createNote({ type: 'verse', title: refLabel(sel), verseRef: `${anchor.bookId}.${anchor.chapter}.${anchor.verse}`, content: '', textId: anchor.textId })
    if (result.success && result.note) { bumpNoteToken(); bumpVerseNoteToken(); clear(); onOpenNote?.(result.note.id) }
  }
  const applyHighlight = async (color: HighlightColor) => {
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string }>
    for (const v of fetched) await window.highlights.toggle({ bookId: v.bookId, chapter: v.chapter, verseNum: v.verse, color, textId: v.textId, startChar: 0, endChar: v.text.length })
    bumpHighlightToken(); void haptic.light()
  }
  const removeHighlights = async () => {
    for (const v of sel) await window.highlights.remove(v.bookId, v.chapter, v.verse, v.textId).catch(() => {})
    bumpHighlightToken()
  }
  const tagRanges = () => {
    const ranges = selectionToRanges(sel.map((r) => ({ bookId: r.bookId, chapter: r.chapter, verse: r.verse })))
    return { ranges, label: rangesLabel(ranges) }
  }
  const play = () => { const v = sel[0]; if (v) startPlaybackFrom(v.bookId, v.chapter, v.verse, v.textId); clear() }
  return { sel, label: sel.length ? refLabel(sel) : '', clear, copyVerses, addNote, applyHighlight, removeHighlights, tagRanges, play }
}

export function SelectionBar({ tabId, onOpenNote }: { tabId: string; onOpenNote: (noteId: string) => void }) {
  const sheets = useSheets()
  const [copied, setCopied] = useState<'verses' | 'refs' | null>(null)
  const [palette, setPalette] = useState(false)
  const { sel, clear, copyVerses: copy, addNote, applyHighlight: highlight, removeHighlights: unhighlight, tagRanges, play } = useVerseSelectionActions(tabId, onOpenNote)
  // One tapped verse is handled by the verse sheet (TEST-035); the bar serves ranges / several
  // verses (drag-to-select, TEST-001) and any selection while the verse sheet is closed.
  if (sel.length === 0 || sheets.isOpen('verse')) return null
  const single = sel.length === 1 ? sel[0] : null
  const flash = (w: 'verses' | 'refs') => { setCopied(w); void haptic.light(); setTimeout(() => setCopied(null), 1200) }
  const copyVerses = async (refsOnly: boolean) => { await copy(refsOnly); flash(refsOnly ? 'refs' : 'verses') }
  const applyHighlight = async (color: HighlightColor) => { await highlight(color); setPalette(false) }
  const removeHighlights = async () => { await unhighlight(); setPalette(false) }
  const tag = () => {
    const { ranges, label } = tagRanges()
    sheets.open({ id: 'tag-picker', detents: [0.6, 0.92], render: (api) => <TagPickerSheet ranges={ranges} label={label} kind="verses" api={api} /> })
  }
  // Cross references for the selected verse(s) of ONE chapter (SEP25: filtered to the selection).
  const oneChapter = sel.length > 0 && sel.every((v) => v.bookId === sel[0].bookId && v.chapter === sel[0].chapter && v.textId === sel[0].textId)
  const crossRefs = () => {
    if (!oneChapter) return
    const f = sel[0]
    sheets.open({ id: 'crossrefs', detents: [0.55, 0.92], render: (api) => <CrossRefsSheet bookId={f.bookId} chapter={f.chapter} verses={sel.map((v) => v.verse)} textId={f.textId} label={refLabel(sel)} api={api} /> })
  }
  const notes = () => {
    if (!single) return
    sheets.open({ id: 'verse-notes', detents: [0.5, 0.92], render: (api) => (
      <VerseNotesSheet verseRef={`${single.bookId}.${single.chapter}.${single.verse}`} textId={single.textId} label={refLabel(sel)} api={api} onOpenNote={onOpenNote} fullDetent={1}
        onNewNote={async () => {
          const r = await window.notes.createNote({ type: 'verse', title: refLabel(sel), verseRef: `${single.bookId}.${single.chapter}.${single.verse}`, content: '', textId: single.textId }).catch(() => null)
          if (!r?.success || !r.note) return null
          const st = useAppStore.getState(); st.bumpNoteToken(); st.bumpVerseNoteToken()
          return r.note.id
        }} />
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
          {/* A verse note anchors to one verse — hidden for several verses (TEST-007). */}
          {selectionAllows(sel, 'add-note') && <Btn icon={NotepadText} label="Add note" onClick={() => void addNote()} />}
          {single && <Btn icon={NotepadText} label="Notes" onClick={notes} />}
          {oneChapter && <Btn icon={GitFork} label="Cross references" onClick={crossRefs} />}
          <Btn icon={Volume2} label="Play from here" onClick={play} />
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
