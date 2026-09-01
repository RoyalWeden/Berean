import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Hash, NotepadText, Files, GitFork, Volume2, Palette, Tag, X } from 'lucide-react'
import { useAppStore, type SelectedVerseRef } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { selectionToRanges, rangesLabel } from '@/lib/verseTagRanges'
import { TagPickPopover } from '@/components/tags/TagPickPopover'
import { HIGHLIGHT_COLORS } from './verseRowStyles'
import type { HighlightColor } from '@/types'

/**
 * Floating action bar shown at the bottom of the window whenever one or more verses are
 * selected via verse-number click (see VerseRow.tsx). Icon-only actions mirroring the
 * single-verse popover — Copy / Reference / Add note / Show notes / Cross references /
 * Play audio / Tag / highlight colours — operating on the whole selection.
 *
 * Per-verse-only actions (Show notes, Cross references) are enabled only when exactly one
 * verse is selected; everything else applies to every selected verse.
 */

function sortSelection(sel: SelectedVerseRef[]): SelectedVerseRef[] {
  return [...sel].sort((a, b) =>
    a.textId.localeCompare(b.textId) ||
    a.bookId.localeCompare(b.bookId) ||
    a.chapter - b.chapter ||
    a.verse - b.verse,
  )
}

const lxxSuffix = (textId: string) => (textId === 'lxx' ? ' LXX' : '')

/** "Genesis 1:3, 5-7" style label when every ref shares one book+chapter+text, else a
 *  comma-joined list of full refs. */
function refLabel(sel: SelectedVerseRef[]): string {
  const first = sel[0]
  const sameChapter = sel.every(
    (r) => r.textId === first.textId && r.bookId === first.bookId && r.chapter === first.chapter,
  )
  if (sameChapter) {
    const nums = sel.map((r) => r.verse)
    const parts: string[] = []
    let start = nums[0]
    let prev = nums[0]
    for (let i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === prev + 1) { prev = nums[i]; continue }
      parts.push(start === prev ? `${start}` : `${start}-${prev}`)
      if (i < nums.length) { start = nums[i]; prev = nums[i] }
    }
    return `${bookName(first.bookId)} ${first.chapter}:${parts.join(', ')}${lxxSuffix(first.textId)}`
  }
  return sel
    .map((r) => `${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${lxxSuffix(r.textId)}`)
    .join(', ')
}

async function fetchVerse(r: SelectedVerseRef) {
  const v = await window.bible.queryVerse(r.bookId, r.chapter, r.verse, r.textId)
  return v ? { ...r, text: v.text, textTagged: v.text_tagged ?? null } : null
}

export default function VerseSelectionBar() {
  // The bar is bound to the ACTIVE scripture tab only — each tab keeps its own selection,
  // and the bar is hidden entirely when the active space isn't scripture.
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeScriptureTabId = useAppStore((s) => s.activeTabId['scripture'])
  const selectedRaw = useAppStore((s) => (activeScriptureTabId ? (s.selectedVersesByTab[activeScriptureTabId] ?? []) : []))
  const clearVerseSelectionRaw = useAppStore((s) => s.clearVerseSelection)
  const clearVerseSelection = useCallback(() => clearVerseSelectionRaw(activeScriptureTabId ?? undefined), [clearVerseSelectionRaw, activeScriptureTabId])
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpVerseNoteToken = useAppStore((s) => s.bumpVerseNoteToken)
  const openNoteInBiblePanel = useAppStore((s) => s.openNoteInBiblePanel)
  const filterBiblePanelByVerse = useAppStore((s) => s.filterBiblePanelByVerse)
  const openCrossRefsInBiblePanel = useAppStore((s) => s.openCrossRefsInBiblePanel)
  const startPlaybackFrom = useAppStore((s) => s.startPlaybackFrom)
  // Drop below the modal backdrop (but stay visible, dimmed) while a full-screen overlay is up.
  const modalOpen = useAppStore((s) => s.searchOpen || s.settingsOpen || s.historyOpen)

  const [colorOpen, setColorOpen] = useState(false)
  const [tagAnchor, setTagAnchor] = useState<DOMRect | null>(null)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const tagBtnRef = useRef<HTMLButtonElement>(null)

  const sel = sortSelection(selectedRaw)
  const single = sel.length === 1 ? sel[0] : null

  useEffect(() => {
    if (selectedRaw.length === 0) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearVerseSelection() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedRaw.length, clearVerseSelection])

  useEffect(() => { if (selectedRaw.length === 0) { setColorOpen(false); setTagAnchor(null) } }, [selectedRaw.length])

  // Tell the store when the tag/colour popover is open so the bottom-right Study Trail toast
  // can lift clear of it (it opens ABOVE this bar).
  const setVerseSelectionMenuOpen = useAppStore((s) => s.setVerseSelectionMenuOpen)
  useEffect(() => {
    setVerseSelectionMenuOpen(colorOpen || tagAnchor != null)
    return () => setVerseSelectionMenuOpen(false)
  }, [colorOpen, tagAnchor, setVerseSelectionMenuOpen])

  const copyVerses = useCallback(async (refsOnly: boolean) => {
    const header = refLabel(sel)
    if (refsOnly) { navigator.clipboard.writeText(header).catch(() => {}); return }
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string; textTagged: string | null }>
    const lines = fetched.map((v) => `${v.verse} ${buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)}`)
    navigator.clipboard.writeText([header, ...lines].join('\n')).catch(() => {})
  }, [sel, wordReplacerEnabled, wordReplacerRules])

  const addNote = useCallback(async () => {
    const anchor = sel[0]
    const result = await window.notes.createNote({
      type: 'verse', title: refLabel(sel), verseRef: `${anchor.bookId}.${anchor.chapter}.${anchor.verse}`, content: '', textId: anchor.textId,
    })
    if (result.success && result.note) {
      bumpNoteToken(); bumpVerseNoteToken(); openNoteInBiblePanel(result.note.id)
    }
  }, [sel, bumpNoteToken, bumpVerseNoteToken, openNoteInBiblePanel])

  const applyHighlight = useCallback(async (color: HighlightColor) => {
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string }>
    for (const v of fetched) {
      await window.highlights.toggle({ bookId: v.bookId, chapter: v.chapter, verseNum: v.verse, color, textId: v.textId, startChar: 0, endChar: v.text.length })
    }
    bumpHighlightToken()
  }, [sel, bumpHighlightToken])

  const removeHighlights = useCallback(async () => {
    for (const v of sel) await window.highlights.remove(v.bookId, v.chapter, v.verse, v.textId).catch(() => {})
    bumpHighlightToken()
  }, [sel, bumpHighlightToken])

  if (sel.length === 0 || activeSpace !== 'scripture') return null

  const BTN = 'flex items-center justify-center w-7 h-7 rounded text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent'

  // Ranges + label for tagging this selection (grouped per chapter into spans).
  const tagRanges = selectionToRanges(sel.map((r) => ({ bookId: r.bookId, chapter: r.chapter, verse: r.verse })))
  const tagLabel = rangesLabel(tagRanges)

  return createPortal(
    <>
      <div
        className="fixed left-1/2 bottom-5 -translate-x-1/2 flex items-center gap-0.5 rounded-shell context-menu px-1.5 py-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-lg"
        style={{ backgroundColor: 'rgb(var(--color-surface-2) / 0.62)', zIndex: modalOpen ? 40 : 95 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="px-2 text-xs font-semibold text-[rgb(var(--color-text-secondary))] whitespace-nowrap">{sel.length} selected</span>
        <div className="w-px self-stretch bg-[rgb(var(--color-surface-4))] mx-0.5" />

        <button className={BTN} title="Copy verses" onClick={() => copyVerses(false)}><Copy size={14} /></button>
        <button className={BTN} title={sel.length > 1 ? 'Copy references' : 'Copy reference'} onClick={() => copyVerses(true)}><Hash size={14} /></button>
        <button className={BTN} title="Add note" onClick={addNote}><NotepadText size={14} /></button>
        <button className={BTN} title={single ? 'Show notes for this verse' : 'Select a single verse'} disabled={!single}
          onClick={() => single && filterBiblePanelByVerse(`${single.bookId}.${single.chapter}.${single.verse}`)}><Files size={14} /></button>
        <button className={BTN} title={single ? 'Show cross references' : 'Select a single verse'} disabled={!single}
          onClick={() => single && openCrossRefsInBiblePanel(`${single.bookId}.${single.chapter}.${single.verse}`)}><GitFork size={14} /></button>
        <button className={BTN} title="Play audio from here"
          onClick={() => startPlaybackFrom(sel[0].bookId, sel[0].chapter, sel[0].verse, sel[0].textId)}><Volume2 size={14} /></button>

        <div className="w-px self-stretch bg-[rgb(var(--color-surface-4))] mx-0.5" />
        <button ref={tagBtnRef} className={BTN} title="Tag verses"
          onClick={() => setTagAnchor(tagAnchor ? null : tagBtnRef.current?.getBoundingClientRect() ?? null)}><Tag size={14} /></button>
        <button ref={colorBtnRef} className={BTN} title="Highlight" onClick={() => setColorOpen((v) => !v)}><Palette size={14} /></button>

        <div className="w-px self-stretch bg-[rgb(var(--color-surface-4))] mx-0.5" />
        <button className={BTN} title="Clear selection" onClick={clearVerseSelection}><X size={14} /></button>
      </div>

      {colorOpen && colorBtnRef.current && (
        <ColorGridPopover
          anchorRect={colorBtnRef.current.getBoundingClientRect()}
          onPick={(c) => { applyHighlight(c); setColorOpen(false) }}
          onRemove={() => { removeHighlights(); setColorOpen(false) }}
          onClose={() => setColorOpen(false)}
        />
      )}
      {tagAnchor && (
        <TagPickPopover
          anchorRect={tagAnchor}
          ranges={tagRanges}
          label={tagLabel}
          kind="verses"
          onClose={() => setTagAnchor(null)}
        />
      )}
    </>,
    document.body,
  )
}

function ColorGridPopover({ anchorRect, onPick, onRemove, onClose }: {
  anchorRect: DOMRect
  onPick: (c: HighlightColor) => void
  onRemove: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: anchorRect.left, y: anchorRect.top })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    let x = anchorRect.left + anchorRect.width / 2 - width / 2
    let y = anchorRect.top - height - 8
    if (y < pad) y = anchorRect.bottom + 8
    x = Math.max(pad, Math.min(x, window.innerWidth - width - pad))
    setPos({ x, y })
  }, [anchorRect])
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onDown) }
  }, [onClose])
  return (
    <div
      ref={ref}
      className="fixed z-[140] rounded-shell context-menu p-2"
      style={{ left: pos.x, top: pos.y, backgroundColor: 'rgb(var(--color-surface-2) / 0.97)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-5 gap-1.5">
        {HIGHLIGHT_COLORS.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} title={c.label} style={{ backgroundColor: c.dot }}
            className="w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110" />
        ))}
      </div>
      <button onClick={onRemove}
        className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer">
        <X size={11} /> Remove highlights
      </button>
    </div>
  )
}
