import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Hash, NotepadText, Files, GitFork, Volume2, Palette, Tag, X, Check } from 'lucide-react'
import { IconButton, Toolbar, Divider, ColorSwatchRow, Button, type Swatch } from '@/components/ui'
import { selectionAllows, selectionKind, selectionLabel } from '@/lib/verseSelection'
import { useAppStore, type SelectedVerseRef } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { displayChapter } from '@/lib/chapterNumbering'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { selectionToRanges, rangesLabel } from '@/lib/verseTagRanges'
import { TagPickPopover } from '@/components/tags/TagPickPopover'
import { HIGHLIGHT_COLORS } from './verseRowStyles'
import type { HighlightColor } from '@/types'

const HIGHLIGHT_SWATCHES: Swatch[] = HIGHLIGHT_COLORS.map((c) => ({ id: c.id, rgb: `var(--highlight-${c.id})`, label: c.label }))

/**
 * Floating action bar shown at the bottom of the window whenever one or more verses are
 * selected via verse-number click (see VerseRow.tsx). Icon-only actions mirroring the
 * single-verse popover — Copy / Reference / Add note / Show notes / Cross references /
 * Play audio / Tag / highlight colours — operating on the whole selection.
 *
 * Per-verse-only actions (Show notes, Cross references) are enabled only when exactly one
 * verse is selected; everything else applies to every selected verse.
 */

export function sortSelection(sel: SelectedVerseRef[]): SelectedVerseRef[] {
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
export function refLabel(sel: SelectedVerseRef[]): string {
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
    return `${bookName(first.bookId)} ${displayChapter(first.bookId, first.chapter)}:${parts.join(', ')}${lxxSuffix(first.textId)}`
  }
  return sel
    .map((r) => `${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${lxxSuffix(r.textId)}`)
    .join(', ')
}

export async function fetchVerse(r: SelectedVerseRef) {
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
  // Brief "copied" confirmation swapped onto whichever copy button was pressed.
  const [copied, setCopied] = useState<'verses' | 'refs' | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])
  const flashCopied = useCallback((which: 'verses' | 'refs') => {
    setCopied(which)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(null), 1400)
  }, [])
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

  // Publish whether the bar is actually rendered (same gate as the early-return below) so the
  // Study Trail arrival toast only dodges upward while a bar is genuinely on screen.
  const setVerseSelectionBarOpen = useAppStore((s) => s.setVerseSelectionBarOpen)
  const barVisible = sel.length > 0 && activeSpace === 'scripture'
  useEffect(() => {
    setVerseSelectionBarOpen(barVisible)
    return () => setVerseSelectionBarOpen(false)
  }, [barVisible, setVerseSelectionBarOpen])

  const copyVerses = useCallback(async (refsOnly: boolean) => {
    const header = refLabel(sel)
    if (refsOnly) { navigator.clipboard.writeText(header).catch(() => {}); flashCopied('refs'); return }
    const fetched = (await Promise.all(sel.map(fetchVerse))).filter(Boolean) as Array<SelectedVerseRef & { text: string; textTagged: string | null }>
    // Single verse: match the right-click popover — "Reference text" on one line, no
    // leading verse-number and no newline break.
    if (fetched.length === 1) {
      const v = fetched[0]
      const body = buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)
      navigator.clipboard.writeText(`${header} ${body}`).catch(() => {})
      flashCopied('verses')
      return
    }
    const lines = fetched.map((v) => `${v.verse} ${buildVerseDisplayText(v.text, v.textTagged, v.textId, wordReplacerEnabled, wordReplacerRules)}`)
    navigator.clipboard.writeText([header, ...lines].join('\n')).catch(() => {})
    flashCopied('verses')
  }, [sel, wordReplacerEnabled, wordReplacerRules, flashCopied])

  const canAddNote = selectionAllows(sel, 'add-note')
  const addNote = useCallback(async () => {
    if (!selectionAllows(sel, 'add-note')) return
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

  // Ranges + label for tagging this selection (grouped per chapter into spans).
  const tagRanges = selectionToRanges(sel.map((r) => ({ bookId: r.bookId, chapter: r.chapter, verse: r.verse })))
  const tagLabel = rangesLabel(tagRanges)

  return createPortal(
    <>
      <div
        className={`fixed left-1/2 bottom-5 -translate-x-1/2 material-floating-bar pl-1 pr-1 py-1 ${modalOpen ? 'z-raised' : 'z-overlay'}`}
        // While a full-screen overlay (floating search / settings / history) is up, drop to
        // z-raised: still above every bit of app chrome so it stays visible in the dimmed/
        // blurred background, but behind the overlay itself — same token PresenterControls
        // uses for the same dodge.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Toolbar material="none" edge="none" size="sm" itemVariant="ghost" className="px-0 gap-0.5 h-auto">
          <span className="pl-2.5 pr-1.5 text-footnote font-medium text-text-secondary whitespace-nowrap tabular-nums" title={`${sel.length} selected`}>{selectionKind(sel) === 'multiple' ? `${sel.length} selected` : selectionLabel(sel)}</span>
          <Divider orientation="vertical" className="mx-1" />

          <IconButton shape="round" size={28} label={copied === 'verses' ? 'Copied' : sel.length > 1 ? 'Copy verses' : 'Copy verse'} onClick={() => copyVerses(false)}
            icon={copied === 'verses' ? Check : Copy} iconClassName={copied === 'verses' ? 'text-success' : undefined} />
          <IconButton shape="round" size={28} label={copied === 'refs' ? 'Copied' : sel.length > 1 ? 'Copy references' : 'Copy reference'} onClick={() => copyVerses(true)}
            icon={copied === 'refs' ? Check : Hash} iconClassName={copied === 'refs' ? 'text-success' : undefined} />
          {/* A verse note anchors to ONE verse — no "note on all selected verses" (TEST-007). */}
          <IconButton shape="round" size={28} label={canAddNote ? 'Add note' : 'Select a single verse to add a note'} icon={NotepadText} disabled={!canAddNote} onClick={() => { if (canAddNote) void addNote() }} />
          <IconButton shape="round" size={28} label={single ? 'Show notes for this verse' : 'Select a single verse'} icon={Files} disabled={!single}
            onClick={() => single && filterBiblePanelByVerse(`${single.bookId}.${single.chapter}.${single.verse}`)} />
          <IconButton shape="round" size={28} label={single ? 'Show cross references' : 'Select a single verse'} icon={GitFork} disabled={!single}
            onClick={() => single && openCrossRefsInBiblePanel(`${single.bookId}.${single.chapter}.${single.verse}`)} />
          <IconButton shape="round" size={28} label="Play audio from here" icon={Volume2}
            onClick={() => startPlaybackFrom(sel[0].bookId, sel[0].chapter, sel[0].verse, sel[0].textId)} />

          <Divider orientation="vertical" className="mx-1" />
          <IconButton ref={tagBtnRef} shape="round" size={28} label="Tag verses" icon={Tag}
            onClick={() => setTagAnchor(tagAnchor ? null : tagBtnRef.current?.getBoundingClientRect() ?? null)} />
          <IconButton ref={colorBtnRef} shape="round" size={28} label="Highlight" icon={Palette} onClick={() => setColorOpen((v) => !v)} />

          <Divider orientation="vertical" className="mx-1" />
          <IconButton shape="round" size={28} label="Clear selection" icon={X} onClick={clearVerseSelection} />
        </Toolbar>
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
      className="fixed z-overlay material-popover rounded-menu p-2"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ColorSwatchRow swatches={HIGHLIGHT_SWATCHES} value={undefined} onChange={(id) => id && onPick(id as HighlightColor)} rows={2} />
      <Button variant="ghost" size="sm" icon={X} onClick={onRemove} className="mt-2 w-full text-text-muted hover:text-destructive">
        Remove highlights
      </Button>
    </div>
  )
}
