import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight, Folder, FolderOpen, Pin, PinOff, Trash2, FolderInput, CheckCircle2, Circle, CalendarDays, BookOpen, FileInput, NotebookText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Note } from '@/types'
import { displayNoteTitle } from '@/lib/noteTitle'
import { rowDateLabel } from '@/lib/noteRecency'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { useLongPress } from '../primitives/useLongPress'
import { haptic } from '../primitives/haptics'
import { firstImageSrc, notePreviewText, type FolderNode } from './notesHomeModel'

/**
 * The Notes Home building blocks (NOTES-HOME-005…): an Apple-Notes list row (title · date +
 * preview · folder, thumbnail at the right), a gallery card in the tab-preview card language, and
 * a folder row. Rows swipe (left: Move · Delete, right: Pin), long-press into the floating
 * preview, and in Edit become selectable.
 */

// ── swipe ───────────────────────────────────────────────────────────────────────────────────
export interface SwipeAction { id: string; label: string; icon: LucideIcon; tone: 'red' | 'blue' | 'orange'; run: () => void }

let closeOpenRow: (() => void) | null = null
const ACTION_W = 74
const AXIS_SLOP = 10

/**
 * A horizontally swipeable row, axis-locked: a gesture that starts vertical stays a scroll (the
 * row has `touch-action: pan-y`, so iOS scrolls natively and the row never moves); one that starts
 * horizontal reveals the actions. Swiping far enough left runs the first trailing action (Delete),
 * like Mail / Notes. One row is open at a time; a tap on an open row closes it.
 */
export function SwipeRow({ leading = [], trailing = [], disabled, children, label }: {
  leading?: SwipeAction[]; trailing?: SwipeAction[]; disabled?: boolean; children: React.ReactNode; label: string
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const g = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null; id: number } | null>(null)
  const moved = useRef(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const maxL = leading.length * ACTION_W
  const maxR = trailing.length * ACTION_W
  const close = () => setDx(0)
  useEffect(() => () => { if (closeOpenRow === close) closeOpenRow = null })   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (disabled) setDx(0) }, [disabled])
  const width = () => rowRef.current?.offsetWidth ?? 360

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    g.current = { x: e.clientX, y: e.clientY, base: dx, axis: null, id: e.pointerId }
    moved.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    const ddx = e.clientX - s.x, ddy = e.clientY - s.y
    if (!s.axis) {
      if (Math.abs(ddx) < AXIS_SLOP && Math.abs(ddy) < AXIS_SLOP) return
      s.axis = Math.abs(ddx) > Math.abs(ddy) * 1.2 ? 'x' : 'y'
      if (s.axis === 'x') {
        if (closeOpenRow && closeOpenRow !== close) closeOpenRow()
        closeOpenRow = close
        setDragging(true)
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }
    }
    if (s.axis !== 'x') return
    moved.current = true
    let next = s.base + ddx
    // Rubber-band past the actions; a side with no actions does not move.
    if (next > 0) next = maxL ? (next > maxL ? maxL + (next - maxL) * 0.3 : next) : 0
    if (next < 0 && !maxR) next = 0   // trailing side: free travel — far enough is the full-swipe Delete
    setDx(next)
  }
  const end = (e: React.PointerEvent) => {
    const s = g.current
    g.current = null
    if (!s || s.axis !== 'x') return
    setDragging(false)
    const w = width()
    if (trailing.length && dx < -w * 0.6) { void haptic.medium(); setDx(0); trailing[0].run(); return }   // full swipe
    if (dx < -maxR / 2) { setDx(-maxR); void haptic.light() }
    else if (dx > maxL / 2) { setDx(maxL); void haptic.light() }
    else setDx(0)
    void e
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; return }
    if (dx !== 0) { e.stopPropagation(); e.preventDefault(); setDx(0) }
  }
  const run = (a: SwipeAction) => { setDx(0); void haptic.light(); a.run() }
  return (
    <div ref={rowRef} className={`m-swipe${dragging ? ' is-dragging' : ''}`}>
      {dx > 0 && (
        <div className="m-swipe-actions is-leading" style={{ width: Math.max(dx, 0) }}>
          {leading.map((a) => <button key={a.id} type="button" className={`m-swipe-action is-${a.tone}`} onClick={() => run(a)}><a.icon size={20} aria-hidden /><span>{a.label}</span></button>)}
        </div>
      )}
      {dx < 0 && (
        <div className="m-swipe-actions is-trailing" style={{ width: Math.max(-dx, 0) }}>
          {trailing.map((a) => <button key={a.id} type="button" className={`m-swipe-action is-${a.tone}`} onClick={() => run(a)}><a.icon size={20} aria-hidden /><span>{a.label}</span></button>)}
        </div>
      )}
      <div className="m-swipe-content" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end} onClickCapture={onClickCapture}
        // VoiceOver has no web equivalent of swipe actions: every swipe action is also in the row's
        // long-press preview menu (double-tap and hold) and in Edit's action bar.
        data-label={label}>
        {children}
      </div>
    </div>
  )
}

// ── note row (list) ─────────────────────────────────────────────────────────────────────────
const typeIcon = (n: Note) => (n.type === 'daily' ? CalendarDays : n.verseRef || n.type === 'verse' ? BookOpen : null)

export function NoteListRow({ note, now, folderName, selecting, selected, onOpen, onToggle, onLongPress, onPin, onMove, onDelete, canMove }: {
  note: Note; now: number
  /** Shown under the preview where the location doesn't already say it (All Notes, search, pinned). */
  folderName?: string | null
  selecting?: boolean; selected?: boolean
  onOpen: (n: Note) => void; onToggle?: (n: Note) => void
  onLongPress?: (n: Note, rect: DOMRect) => void
  onPin: (n: Note) => void; onMove: (n: Note) => void; onDelete: (n: Note) => void
  canMove: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const lp = useLongPress(() => { if (!onLongPress || selecting || !ref.current) return; void haptic.medium(); onLongPress(note, ref.current.getBoundingClientRect()) })
  const title = displayNoteTitle(note.title)
  const preview = notePreviewText(note, stripMarkdownFormatting)
  const thumb = firstImageSrc(note.content)
  const date = rowDateLabel(note.updatedAt, now)
  const Icon = typeIcon(note)
  const body = (
    <button ref={ref} type="button" className={`m-note-row${selected ? ' is-selected' : ''}`}
      aria-label={`${title}, ${date}${preview ? `, ${preview}` : ''}${folderName ? `, in ${folderName}` : ''}${note.pinned ? ', pinned' : ''}`}
      aria-pressed={selecting ? !!selected : undefined}
      onClick={() => (selecting ? onToggle?.(note) : onOpen(note))} {...(selecting ? {} : lp)} onContextMenu={(e) => e.preventDefault()}>
      {selecting && <span className="m-note-row-check" aria-hidden>{selected ? <CheckCircle2 size={22} /> : <Circle size={22} />}</span>}
      <span className="m-note-row-text">
        <span className="m-note-row-title">{note.icon && <span aria-hidden>{note.icon} </span>}{title}</span>
        <span className="m-note-row-line"><span className="m-note-row-date">{date}</span>{preview ? <span className="m-note-row-preview">{preview}</span> : <span className="m-note-row-preview is-empty">No additional text</span>}</span>
        {(folderName || Icon) && (
          <span className="m-note-row-folder">{Icon ? <Icon size={12} aria-hidden /> : <Folder size={12} aria-hidden />}{folderName ?? (note.type === 'daily' ? 'Daily Notes' : 'Verse Notes')}</span>
        )}
      </span>
      {thumb && <img className="m-note-row-thumb" src={thumb} alt="" loading="lazy" decoding="async" />}
    </button>
  )
  if (selecting) return body
  return (
    <SwipeRow label={title}
      leading={[{ id: 'pin', label: note.pinned ? 'Unpin' : 'Pin', icon: note.pinned ? PinOff : Pin, tone: 'orange', run: () => onPin(note) }]}
      trailing={[
        { id: 'delete', label: 'Delete', icon: Trash2, tone: 'red', run: () => onDelete(note) },
        ...(canMove ? [{ id: 'move', label: 'Move', icon: FolderInput, tone: 'blue' as const, run: () => onMove(note) }] : []),
      ]}>
      {body}
    </SwipeRow>
  )
}

// ── gallery card ────────────────────────────────────────────────────────────────────────────
/** The tab-preview card language (TabPreview's `.mobile-tab-preview is-note`) as a grid cell. */
export function NoteGalleryCard({ note, now, selecting, selected, onOpen, onToggle, onLongPress }: {
  note: Note; now: number; selecting?: boolean; selected?: boolean
  onOpen: (n: Note) => void; onToggle?: (n: Note) => void; onLongPress?: (n: Note, rect: DOMRect) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const lp = useLongPress(() => { if (!onLongPress || selecting || !ref.current) return; void haptic.medium(); onLongPress(note, ref.current.getBoundingClientRect()) })
  const title = displayNoteTitle(note.title)
  const thumb = firstImageSrc(note.content)
  const body = notePreviewText(note, stripMarkdownFormatting, 220)
  const date = rowDateLabel(note.updatedAt, now)
  return (
    <button ref={ref} type="button" className={`m-note-card${selected ? ' is-selected' : ''}`} aria-label={`${title}, ${date}${note.pinned ? ', pinned' : ''}`}
      aria-pressed={selecting ? !!selected : undefined}
      onClick={() => (selecting ? onToggle?.(note) : onOpen(note))} {...(selecting ? {} : lp)} onContextMenu={(e) => e.preventDefault()}>
      <span className="mobile-tab-preview is-note m-note-card-preview">
        {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" className="m-note-card-img" />
          : <><span className="mobile-tab-preview-passage">{note.icon ? `${note.icon} ` : ''}{title}</span><span className="mobile-tab-preview-text is-sans">{body}</span></>}
        {selecting && <span className="m-note-card-check" aria-hidden>{selected ? <CheckCircle2 size={22} /> : <Circle size={22} />}</span>}
        {note.pinned && !selecting && <Pin size={12} aria-hidden className="m-note-card-pin" />}
      </span>
      <span className="m-note-card-title">{title}</span>
      <span className="m-note-card-date">{date}</span>
    </button>
  )
}

// ── folder row ──────────────────────────────────────────────────────────────────────────────
export function FolderRow({ name, count, depth = 0, kind = 'folder', expandable, expanded, onToggleExpand, onOpen, onLongPress, trailing }: {
  name: string; count: number; depth?: number
  kind?: 'folder' | 'all' | 'daily' | 'verse' | 'import' | 'trash'
  expandable?: boolean; expanded?: boolean; onToggleExpand?: () => void
  onOpen: () => void; onLongPress?: () => void
  /** Edit mode: a trailing control instead of the chevron (folder actions). */
  trailing?: React.ReactNode
}) {
  const lp = useLongPress(() => { if (!onLongPress) return; void haptic.medium(); onLongPress() })
  const Icon = kind === 'all' ? NotebookText : kind === 'daily' ? CalendarDays : kind === 'verse' ? BookOpen : kind === 'import' ? FileInput : kind === 'trash' ? Trash2 : expanded ? FolderOpen : Folder
  return (
    <div className="m-folder-row" style={{ ['--depth' as string]: depth }} role="listitem">
      {expandable
        ? <button type="button" className={`m-folder-disclosure${expanded ? ' is-open' : ''}`} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} onClick={() => { void haptic.selection(); onToggleExpand?.() }}><ChevronRight size={16} aria-hidden /></button>
        : <span className="m-folder-disclosure is-spacer" aria-hidden />}
      <button type="button" className="m-folder-main" onClick={onOpen} {...(onLongPress ? lp : {})} onContextMenu={(e) => e.preventDefault()}
        aria-label={`${name}, ${count} note${count === 1 ? '' : 's'}`}>
        <Icon size={20} aria-hidden className={`m-folder-icon is-${kind}`} />
        <span className="m-folder-name">{name}</span>
        <span className="m-folder-count">{count}</span>
        {!trailing && <ChevronRight size={16} aria-hidden className="m-folder-chevron" />}
      </button>
      {trailing}
    </div>
  )
}

/** Visible folder rows of a tree node list, with expansion. */
export function FolderTreeRows({ rows, expanded, onToggle, onOpen, onLongPress, trailing }: {
  rows: FolderNode[]; expanded: ReadonlySet<string>; onToggle: (id: string) => void
  onOpen: (id: string) => void; onLongPress?: (n: FolderNode) => void; trailing?: (n: FolderNode) => React.ReactNode
}) {
  return (
    <>
      {rows.map((n) => (
        <FolderRow key={n.folder.id} name={n.folder.name} count={n.total} depth={n.depth} expandable={n.children.length > 0} expanded={expanded.has(n.folder.id)}
          onToggleExpand={() => onToggle(n.folder.id)} onOpen={() => onOpen(n.folder.id)} onLongPress={onLongPress ? () => onLongPress(n) : undefined} trailing={trailing?.(n)} />
      ))}
    </>
  )
}
