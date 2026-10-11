import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { computeWordStats } from '@/lib/wordCount'
import { selectionStatsKey, useSelectionStats } from './pm/selectionStats'
import { Link2, ChevronsUpDown, CircleDashed } from 'lucide-react'
import type { Note, NoteStatus } from '@/types'
import { NOTE_STATUSES, noteStatusMeta } from '@/lib/noteStatus'
import { NOTE_LOOKS } from './NoteLookDropdown'
import { useAppStore } from '@/store'
import DailyNoteEditsSection from './DailyNoteEditsSection'
import { dailyNoteDateKey } from '@/lib/noteUtils'
import { ListRow, cx, MenuItem, Popover, PopoverTrigger, PopoverSurface, ResizeHandle } from '@/components/ui'

// ── Heading parsing ────────────────────────────────────────────────────────────

interface Heading {
  level: number   // 1-6
  text: string
}

function headingPlainText(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}

function parseHeadings(content: string): Heading[] {
  const headings: Heading[] = []
  for (const line of content.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    // The heading's TEXT (what the editor shows and berean:scrollToHeading matches) — a linked
    // heading is `## [Text](berean://note/…)` in the markdown.
    if (m) headings.push({ level: m[1].length, text: headingPlainText(m[2]) })
  }
  return headings
}

// ── Backlink detection ─────────────────────────────────────────────────────────

// A note links here by a [[Title]] wikilink (also `[[Title|text]]` / `[[Title#Heading]]`), or by a
// note link the link editor made — `berean://note/<id>` (stable across renames).
function findBacklinks(noteTitle: string, allNotes: Note[], noteId: string): Note[] {
  const escaped = noteTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const byTitle = escaped ? new RegExp(`\\[\\[${escaped}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, 'i') : null
  const idEsc = encodeURIComponent(noteId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const byId = new RegExp(`\\]\\(berean(?:-dev)?://note/${idEsc}(?:[#)?])`)
  return allNotes.filter(n => n.id !== noteId && ((byTitle && byTitle.test(n.content ?? '')) || byId.test(n.content ?? '')))
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  content: string
  noteTitle: string
  noteId: string
  noteType?: string
  tabId?: string
  allNotes: Note[]
  onNoteClick: (note: Note) => void
  onOpenNewTab?: (note: Note) => void
  onOpenInFloatingTab?: (note: Note) => void
  folderPath?: string[]
  /** Document properties (TEST 2026-10-05: the Notes inspector is a NOTE-context inspector —
   *  status, look, details — not a copy of the Scripture study inspector). */
  status?: NoteStatus | null
  onStatusChange?: (s: NoteStatus | null) => void
  look?: string
  onLookChange?: (look: string) => void
  createdAt?: string | number
  updatedAt?: string | number
  /** Live two-finger swipe position (0 = fully open, 1 = fully closed), null when not swiping. */
  swipeFrac?: number | null
  /** A swipe is being tracked — follow it with no easing. */
  swiping?: boolean
  /** Upper bound on the inspector's width — a floating note window keeps it compact so the
   *  note stays the window's main content (the saved width is the main window's). */
  maxWidth?: number
}

// Attached-inspector width band — same 260-420 clamp as the Scripture side panel
// (BiblePanel.tsx's `panelSize`); this panel has no drag handle of its own yet, so
// it sits at a fixed width inside that band rather than exposing a resizer.
const INFO_WIDTH_DEFAULT = 300
const INFO_WIDTH_SNAPS = [260, 300, 380, 460]
const INFO_WIDTH_KEY = 'berean.noteInfoWidth'
/** Snap a dragged width to the nearest meaningful size (within 24px), else keep it, clamped. */
export function snapInfoWidth(w: number): number {
  const c = Math.max(INFO_WIDTH_SNAPS[0], Math.min(INFO_WIDTH_SNAPS[INFO_WIDTH_SNAPS.length - 1], Math.round(w)))
  const near = INFO_WIDTH_SNAPS.reduce((a, b) => Math.abs(b - c) < Math.abs(a - c) ? b : a)
  return Math.abs(near - c) <= 24 ? near : c
}

export default function NoteSidePanel({ content, noteTitle, noteId, noteType, tabId, allNotes, onNoteClick, onOpenNewTab, onOpenInFloatingTab, folderPath = [], status, onStatusChange, look, onLookChange, createdAt, updatedAt, swipeFrac = null, swiping = false, maxWidth }: Props) {
  // Same counter as the editor footer (lib/wordCount), over the note's text without markdown.
  const stats = useMemo(() => computeWordStats(content.replace(/^---\n[\s\S]*?\n---\s*\n?/, '').replace(/[#>*_`~]|\[\[|\]\]|\]\([^)]*\)|\[/g, '')), [content])
  // While text is selected in this note's editor, Words / Characters count the SELECTION — set in
  // italics and a quieter tint so the change reads without anything moving (TEST 2026-10-10: the
  // canvas no longer shows a selection count of its own).
  const selStats = useSelectionStats(selectionStatsKey(tabId, noteId))
  const headings = useMemo(() => parseHeadings(content), [content])
  const backlinks = useMemo(() => findBacklinks(noteTitle, allNotes, noteId), [noteTitle, allNotes, noteId])
  // Only set for daily/journal notes — drives the "Edited today" section below, matched
  // against THIS note's own date (not necessarily literal today, for a past daily note).
  const dailyDateKey = useMemo(
    () => dailyNoteDateKey({ id: noteId, title: noteTitle, type: noteType } as Note),
    [noteId, noteTitle, noteType]
  )

  const [savedWidth, setWidthState] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(INFO_WIDTH_KEY)); return v ? snapInfoWidth(v) : INFO_WIDTH_DEFAULT } catch { return INFO_WIDTH_DEFAULT }
  })
  const width = maxWidth ? Math.min(savedWidth, maxWidth) : savedWidth
  const setWidth = (w: number) => { setWidthState(w); try { localStorage.setItem(INFO_WIDTH_KEY, String(w)) } catch { /* per-viewer convenience only */ } }
  const [dragging, setDragging] = useState(false)
  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX, startW = width
    setDragging(true)
    let latest = startW
    const move = (ev: PointerEvent) => { latest = Math.max(INFO_WIDTH_SNAPS[0], Math.min(INFO_WIDTH_SNAPS[INFO_WIDTH_SNAPS.length - 1], startW + (startX - ev.clientX))); setWidthState(latest) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(false); setWidth(snapInfoWidth(latest)) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function scrollToHeading(text: string) {
    window.dispatchEvent(new CustomEvent('berean:scrollToHeading', { detail: { headingText: text } }))
  }

  // Shown/hidden by NotesPanel (inside AnimatePresence) — collapsed it is gone entirely, the
  // toggle living in the note's top bar like the sidebar's (TEST 2026-10-08). The outer box
  // animates its WIDTH (the note reflows beside it, as an attached macOS inspector does) while
  // the content keeps its own width and is clipped, so it slides in from the window edge. A
  // two-finger swipe drives it live (`swipeFrac`: 0 open → 1 closed), the Scripture panel's
  // gesture (useSwipePanelGesture).
  const openFrac = swipeFrac == null ? 1 : 1 - swipeFrac
  const instant = swiping || dragging

  const statusMeta = noteStatusMeta(status ?? null)
  const StatusIcon = statusMeta?.icon ?? CircleDashed
  const lookLabel = (NOTE_LOOKS.find((l) => l.value === look) ?? NOTE_LOOKS[0]).label

  return (
    <motion.div
      className="relative flex-shrink-0 h-full overflow-hidden flex justify-start"
      initial={{ width: 0 }}
      animate={{ width: Math.max(0, width * openFrac) }}
      exit={{ width: 0 }}
      transition={{ duration: instant ? 0 : 0.18, ease: 'easeOut' }}
    >
    <div className="relative flex-shrink-0 h-full material-inspector flex flex-col" style={{ width }}>
      {/* Resizable with snap widths (Compact 260 · Standard 300 · Wide 380 · Large 460), like a
          macOS inspector; double-click returns to Standard. */}
      <ResizeHandle
        className="!absolute left-0 top-0 bottom-0 -translate-x-1/2 z-raised"
        label="Resize note info"
        active={dragging}
        onReset={() => setWidth(INFO_WIDTH_DEFAULT)}
        onNudge={(d) => setWidth(snapInfoWidth(width - d))}
        onPointerDown={startResize}
      />
      {/* Header — the inspector's title (its show/hide toggle is in the note's top bar). Sized to
          its text now that the toggle left it (the 41px band was the toggle's; TEST 2026-10-08:
          "the gap between Info and the status line is too big"). */}
      <div className="flex-shrink-0 flex items-center pl-4 pr-2 pt-3 pb-1">
        <span className="text-subhead font-semibold text-text-primary">Info</span>
      </div>
      <div className="flex-1 overflow-y-auto pb-3 text-footnote">
        {/* ── The note's own properties (no heading: they ARE the note, like Pages' Document
             inspector). Values are quiet menu buttons, not capsules. ── */}
        {(onStatusChange || onLookChange || folderPath.length > 0) && (
          <InfoGroup>
            {onStatusChange && (
              <InfoRow label="Status">
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className={INFO_VALUE_BTN} aria-label={`Status: ${statusMeta ? statusMeta.label : 'No Status'}`}>
                      <StatusIcon size={13} strokeWidth={1.75} className="flex-shrink-0" style={statusMeta ? { color: statusMeta.color } : undefined} />
                      <span className="truncate">{statusMeta ? statusMeta.label : 'No Status'}</span>
                      <ChevronsUpDown size={11} className="flex-shrink-0 text-text-tertiary" />
                    </button>
                  </PopoverTrigger>
                  <PopoverSurface align="end" innerClassName="p-1 min-w-[180px]" role="menu">
                    <MenuItem active={!status} onClick={() => onStatusChange(null)} label={<span className="flex items-center gap-2"><CircleDashed size={13} className="opacity-60" />No Status</span>} />
                    {NOTE_STATUSES.map((st) => (
                      <MenuItem key={st.id} active={status === st.id} onClick={() => onStatusChange(st.id)} label={<span className="flex items-center gap-2"><st.icon size={13} style={{ color: st.color }} />{st.label}</span>} />
                    ))}
                  </PopoverSurface>
                </Popover>
              </InfoRow>
            )}
            {onLookChange && (
              <InfoRow label="Appearance">
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className={INFO_VALUE_BTN} aria-label={`Appearance: ${lookLabel}`}>
                      <span className="truncate">{lookLabel}</span>
                      <ChevronsUpDown size={11} className="flex-shrink-0 text-text-tertiary" />
                    </button>
                  </PopoverTrigger>
                  <PopoverSurface align="end" innerClassName="p-1 min-w-[160px]" role="menu">
                    {NOTE_LOOKS.map((l) => (
                      <MenuItem key={l.value} active={(look ?? 'default') === l.value} onClick={() => onLookChange(l.value)} label={<span style={{ fontFamily: l.sample }}>{l.label}</span>} />
                    ))}
                  </PopoverSurface>
                </Popover>
              </InfoRow>
            )}
            {folderPath.length > 0 && (
              <InfoRow label="Folder">
                <span className="truncate text-text-primary" title={folderPath.join(' › ')}>{folderPath.join(' › ')}</span>
              </InfoRow>
            )}
          </InfoGroup>
        )}

        {/* ── Details ── */}
        {(createdAt || updatedAt) && (
          <InfoGroup title="Details">
            {createdAt ? <InfoRow label="Created"><span className="text-text-primary tabular-nums">{formatInfoDate(createdAt)}</span></InfoRow> : null}
            {updatedAt ? <InfoRow label="Modified"><span className="text-text-primary tabular-nums">{formatInfoDate(updatedAt)}</span></InfoRow> : null}
            <InfoRow label="Words" selection={!!selStats}><span className="tabular-nums">{(selStats ?? stats).words.toLocaleString()}</span></InfoRow>
            <InfoRow label="Characters" selection={!!selStats}><span className="tabular-nums">{(selStats ?? stats).characters.toLocaleString()}</span></InfoRow>
            <InfoRow label="Reading Time"><span className="text-text-primary tabular-nums">{stats.words === 0 ? '—' : `${Math.max(1, stats.minutes)} min`}</span></InfoRow>
          </InfoGroup>
        )}

        {dailyDateKey && onOpenNewTab && onOpenInFloatingTab && (
          <div className="px-2 pt-2">
            <DailyNoteEditsSection
              dateKey={dailyDateKey}
              dailyNoteId={noteId}
              allNotes={allNotes}
              onSelect={onNoteClick}
              onOpenNewTab={onOpenNewTab}
              onOpenInFloatingTab={onOpenInFloatingTab}
            />
          </div>
        )}

        {/* ── Contents — the outline; an explicit "None" row rather than an empty-state blurb. ── */}
        <InfoGroup title="Contents" count={headings.length || undefined}>
          {headings.length === 0 ? (
            <InfoRow label="Headings"><span className="text-text-tertiary">None</span></InfoRow>
          ) : (
            <div className="flex flex-col py-0.5">
              {headings.map((h, i) => (
                <ListRow
                  key={i}
                  inset
                  dense
                  indent={10 + (h.level - 1) * 12}
                  onClick={() => scrollToHeading(h.text)}
                  title={<span className={cx(h.level === 1 ? 'font-semibold' : 'font-normal', h.level >= 4 && 'text-text-tertiary')}>{h.text}</span>}
                  titleSize="footnote"
                  buttonProps={{ title: h.text }}
                />
              ))}
            </div>
          )}
        </InfoGroup>

        {backlinks.length > 0 && (
          <InfoGroup title="Linked From" count={backlinks.length}>
            <div className="flex flex-col py-0.5">
              {backlinks.map((note) => (
                <ListRow
                  key={note.id}
                  inset
                  dense
                  onClick={() => onNoteClick(note)}
                  leading={<Link2 size={12} className="text-text-tertiary flex-shrink-0" />}
                  title={note.title || 'Untitled'}
                  titleSize="footnote"
                  buttonProps={{ title: note.title || 'Untitled' }}
                />
              ))}
            </div>
          </InfoGroup>
        )}
      </div>
    </div>
    </motion.div>
  )
}

/** A quiet value button for an inspector row (Finder Get Info / Pages): text + ⌃⌄, a fill only
 *  on hover — not a capsule per value. */
const INFO_VALUE_BTN = 'focus-ring no-drag inline-flex items-center gap-1.5 max-w-[calc(100%+6px)] h-6 -ml-1.5 px-1.5 rounded-control-sm text-footnote text-text-primary hover:bg-lift-2 active:bg-lift-3 data-[state=open]:bg-lift-2 transition-colors cursor-pointer'

/** A group of inspector rows: a small heading over a hairline (first group: no heading). */
function InfoGroup({ title, count, children }: { title?: string; count?: number; children: React.ReactNode }) {
  return (
    // An untitled group (the note's own properties, right under "Info") sits close to the header.
    <section className={cx('px-4 [&+&]:border-t [&+&]:border-separator-subtle [&+&]:mt-1', title ? 'pt-3' : 'pt-1')}>
      {title && (
        <h3 className="flex items-baseline gap-1.5 mb-1 text-caption font-semibold text-text-secondary">
          {title}
          {count != null && <span className="font-normal text-text-tertiary tabular-nums">{count}</span>}
        </h3>
      )}
      {children}
    </section>
  )
}

/** One label · value row: the label right-aligned in a fixed column, the value left-aligned
 *  beside it — the macOS inspector alignment (labels and values each line up). */
function InfoRow({ label, selection, children }: { label: string; selection?: boolean; children: React.ReactNode }) {
  // `selection` — the value counts the editor's text selection, not the whole note: label and value
  // turn italic and one step quieter (same size and metrics, so nothing shifts).
  return (
    <div
      className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 min-h-[26px]"
      title={selection ? `${label} in the selection` : undefined}
      data-selection={selection ? '' : undefined}
    >
      <span className={cx('text-footnote text-right truncate transition-colors', selection ? 'italic text-text-tertiary' : 'text-text-secondary')}>{label}</span>
      <span className={cx('min-w-0 flex items-center text-footnote transition-colors', selection != null && (selection ? 'italic text-text-secondary' : 'text-text-primary'))}>{children}</span>
    </div>
  )
}

function formatInfoDate(v: string | number): string {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)
}
