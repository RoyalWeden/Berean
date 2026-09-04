import { useEffect, useRef, useState } from 'react'
import { NotepadText, Trash2, FileUp, GripHorizontal } from 'lucide-react'
import type { TrailStickyNote as TrailStickyNoteData } from '@/types/studyTrail'
import { CARET_COLLAPSED_ROTATE } from './trailStyle'

// Sticky notes and section headers on the map, per direct feedback: "with the headings thing...
// maybe like putting notes or something as like resizable sticky notes sort of things", and
// "the user can choose if it is a real berean note or if it just exists in the study trail place."
//
// Two kinds, one table (v39):
//   • section    — a labelled divider ON the spine. Everything under it belongs to that section
//                  until the next one, and folding it folds that whole range (see MapView).
//   • annotation — a free, resizable sticky pinned beside the stop it's anchored to.
//
// The "real Berean note" switch is one-way on purpose. Promoting a trail-only sticky creates an
// actual note (so it syncs to the vault, can be opened full-size, and survives the trail being
// deleted); demoting it again would have to either orphan or delete that note, and neither is
// something a small button on a sticky should decide.

/** Debounced save — a sticky is edited by typing into it, and a write per keystroke would fire
 *  broadcastDataChanged (and so a full re-render of every window) on every character. */
function useDebouncedSave(id: string, delayMs = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (patch: Parameters<typeof window.studyTrail.updateNote>[1]) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void window.studyTrail.updateNote(id, patch) }, delayMs)
  }
}

export function TrailSectionHeader({ note, collapsed, onToggle, onChanged }: {
  note: TrailStickyNoteData
  collapsed: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [title, setTitle] = useState(note.title ?? '')
  const save = useDebouncedSave(note.id)
  // Re-sync when the underlying row changes from elsewhere (another window, an undo) — but not
  // while this field is focused, or a live remote refresh would yank the caret mid-word.
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setTitle(note.title ?? '')
  }, [note.title])
  useEffect(() => { if (!note.title) ref.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // A translucent slab rather than a hairline rule, per direct feedback that a section should
    // "show above with a translucent background sorta" — it reads as a band the stops below sit
    // inside, which is what a section actually is, instead of as one more line on a map that
    // already has plenty.
    <div
      className="no-drag"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, margin: '18px 0 8px', padding: '7px 12px',
        borderRadius: 9, background: 'rgb(var(--color-accent) / 0.10)',
        border: '1px solid rgb(var(--color-accent) / 0.28)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <button
        onClick={onToggle}
        title={collapsed ? 'Expand this section' : 'Collapse this section'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
          fontSize: 13, lineHeight: 1, color: 'rgb(var(--color-accent))',
          transform: collapsed ? CARET_COLLAPSED_ROTATE : undefined, transition: 'transform 120ms',
        }}
      >▾</button>
      <input
        ref={ref}
        value={title}
        onChange={(e) => { setTitle(e.target.value); save({ title: e.target.value }) }}
        onBlur={onChanged}
        placeholder="Name this section…"
        style={{
          flex: 1, minWidth: 60, background: 'transparent', border: 'none', outline: 'none',
          fontSize: 13, fontWeight: 700, letterSpacing: '.03em',
          color: 'rgb(var(--color-accent))',
        }}
      />
      <button
        onClick={() => { void window.studyTrail.deleteNote(note.id).then(onChanged) }}
        title="Remove this section"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.6, flexShrink: 0 }}
      ><Trash2 size={13} /></button>
    </div>
  )
}

export function TrailAnnotation({ note, onChanged, resolveAnchor, zoom = 1 }: {
  note: TrailStickyNoteData
  onChanged: () => void
  /** Which stop a given viewport y belongs to — used on drop so a note dragged well away from
   *  where it started still belongs to the stop it now sits beside, and so folding that stop takes
   *  the note with it. */
  resolveAnchor?: (clientY: number) => string | null
  /** The map's zoom, so a drag moves the note exactly as far as the pointer moved on screen. */
  zoom?: number
}) {
  const [body, setBody] = useState(note.body)
  const [size, setSize] = useState({ w: note.width ?? 210, h: note.height ?? 90 })
  const [offset, setOffset] = useState({ x: note.offsetX ?? 0, y: note.offsetY ?? 0 })
  const save = useDebouncedSave(note.id)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const resizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Re-sync a position changed elsewhere (another window), but never mid-drag.
  useEffect(() => {
    if (dragging.current) return
    setOffset({ x: note.offsetX ?? 0, y: note.offsetY ?? 0 })
  }, [note.offsetX, note.offsetY])

  // Drag to move. Pointer events on window rather than on the handle, because the pointer leaves
  // the small handle the instant the drag starts.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragging.current
      if (!d) return
      // Divided by zoom: the offset is stored in the map's own local units, but the pointer moves
      // in screen pixels, so at 2x zoom a 100px drag is a 50-unit move.
      setOffset({ x: d.ox + (e.clientX - d.x) / zoom, y: d.oy + (e.clientY - d.y) / zoom })
    }
    const up = (e: PointerEvent) => {
      const d = dragging.current
      if (!d) return
      dragging.current = null
      setIsDragging(false)
      const nextAnchor = resolveAnchor?.(e.clientY) ?? null
      setOffset((o) => {
        const rounded = { x: Math.round(o.x), y: Math.round(o.y) }
        void window.studyTrail.updateNote(note.id, {
          offsetX: rounded.x, offsetY: rounded.y,
          // Re-anchoring keeps the note attached to whatever stop it now sits beside. Its visual
          // position doesn't jump, because the offset it's saved with is the one it was just
          // dragged to; only which stop owns it changes.
          ...(nextAnchor && nextAnchor !== note.anchorNodeId ? { anchorNodeId: nextAnchor } : {}),
        }).then(() => { if (nextAnchor && nextAnchor !== note.anchorNodeId) onChanged() })
        return rounded
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [note.id, note.anchorNodeId, onChanged, resolveAnchor, zoom])

  useEffect(() => {
    if (document.activeElement !== textRef.current) setBody(note.body)
  }, [note.body])

  // Resize by dragging the corner. Pointer events on window (not on the handle) so the drag keeps
  // tracking once the cursor leaves the small handle, which it immediately does.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = resizing.current
      if (!r) return
      setSize({
        w: Math.max(120, Math.min(520, r.w + (e.clientX - r.x))),
        h: Math.max(56, Math.min(600, r.h + (e.clientY - r.y))),
      })
    }
    const up = () => {
      if (!resizing.current) return
      resizing.current = null
      // Committed only on release — a write per pixel of drag would be absurd.
      setSize((s) => { void window.studyTrail.updateNote(note.id, { width: Math.round(s.w), height: Math.round(s.h) }); return s })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [note.id])

  const linked = !!note.noteId

  async function promoteToBereanNote() {
    // Title from the first line, which is how a sticky is actually written — the whole point is
    // not making the user fill in a title field to get a real note out of it.
    const firstLine = body.split('\n')[0]?.trim()
    const created = await window.notes.createNote({
      type: 'general',
      title: firstLine || 'Study trail note',
      content: body,
      tags: ['study-trail'],
    })
    if (!created.success || !created.note) return
    await window.studyTrail.updateNote(note.id, { noteId: created.note.id })
    onChanged()
  }

  return (
    <div
      // `no-drag`: the timeline's marquee select treats this whole element as off-limits, so
      // dragging the note by its header doesn't also rubber-band a selection box behind it.
      className="no-drag"
      // Stops a click inside the sticky from reaching the row underneath, which would fold the
      // stop away mid-sentence.
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'relative', width: size.w, marginTop: 6, marginBottom: 4,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        zIndex: isDragging ? 20 : undefined,
        background: note.color ? `${note.color}1f` : 'rgb(var(--color-surface-3))',
        border: `1px solid ${isDragging ? 'rgb(var(--color-accent) / 0.6)' : 'rgb(var(--color-surface-4))'}`,
        borderRadius: 8, padding: '6px 8px 10px',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.32)' : undefined,
      }}
    >
      <div
        // The header strip is the drag handle — the body has to stay selectable for editing.
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          dragging.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
          setIsDragging(true)
        }}
        title="Drag to move"
        style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <NotepadText size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
        <span style={{ fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', color: 'rgb(var(--color-text-muted))' }}>
          {linked ? 'Berean note' : 'Trail note'}
        </span>
        <span style={{ flex: 1 }} />
        {!linked && (
          <button
            onClick={promoteToBereanNote}
            title="Make this a real Berean note (syncs to the vault)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.7 }}
          ><FileUp size={13} /></button>
        )}
        <button
          onClick={() => { void window.studyTrail.deleteNote(note.id).then(onChanged) }}
          title={linked ? 'Unpin from the trail (the Berean note itself is kept)' : 'Delete this note'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.6 }}
        ><Trash2 size={13} /></button>
      </div>
      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          save({ body: e.target.value, ...(linked ? {} : {}) })
          // A promoted sticky writes through to its real note too, so the vault copy doesn't
          // silently diverge from what's on the map.
          if (note.noteId) void window.notes.updateNote(note.noteId, { content: e.target.value })
        }}
        onBlur={onChanged}
        placeholder="Note…"
        style={{
          width: '100%', height: size.h, resize: 'none', background: 'transparent', border: 'none',
          outline: 'none', fontSize: 13, lineHeight: 1.5, color: 'rgb(var(--color-text-primary))',
          fontFamily: 'inherit',
        }}
      />
      <div
        onPointerDown={(e) => { resizing.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h } }}
        title="Resize"
        style={{
          position: 'absolute', right: 2, bottom: 2, cursor: 'nwse-resize',
          color: 'rgb(var(--color-text-muted))', opacity: 0.5, lineHeight: 0,
        }}
      ><GripHorizontal size={13} /></div>
    </div>
  )
}
