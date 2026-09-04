import { useEffect, useRef, useState } from 'react'
import { NotepadText, Trash2, FileUp, GripHorizontal } from 'lucide-react'
import type { TrailStickyNote as TrailStickyNoteData } from '@/types/studyTrail'

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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px', paddingLeft: 21 }}>
      <button
        onClick={onToggle}
        title={collapsed ? 'Expand this section' : 'Collapse this section'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
          fontSize: 10, color: 'rgb(var(--color-accent))',
          transform: collapsed ? 'rotate(-90deg)' : undefined, transition: 'transform 120ms',
        }}
      >▾</button>
      <input
        ref={ref}
        value={title}
        onChange={(e) => { setTitle(e.target.value); save({ title: e.target.value }) }}
        onBlur={onChanged}
        placeholder="Section…"
        style={{
          flexShrink: 0, minWidth: 80, maxWidth: 320, background: 'transparent', border: 'none', outline: 'none',
          fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
          color: 'rgb(var(--color-accent))',
        }}
      />
      <span style={{ flex: 1, height: 1, background: 'rgb(var(--color-accent) / 0.35)' }} />
      <button
        onClick={() => { void window.studyTrail.deleteNote(note.id).then(onChanged) }}
        title="Remove this section"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.6, flexShrink: 0 }}
      ><Trash2 size={11} /></button>
    </div>
  )
}

export function TrailAnnotation({ note, onChanged }: { note: TrailStickyNoteData; onChanged: () => void }) {
  const [body, setBody] = useState(note.body)
  const [size, setSize] = useState({ w: note.width ?? 210, h: note.height ?? 90 })
  const save = useDebouncedSave(note.id)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const resizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

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
      // Stops a click inside the sticky from reaching the row underneath, which would fold the
      // stop away mid-sentence.
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'relative', width: size.w, marginTop: 6, marginBottom: 4,
        background: note.color ? `${note.color}1f` : 'rgb(var(--color-surface-3))',
        border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, padding: '6px 8px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
        <NotepadText size={10} style={{ opacity: 0.6, flexShrink: 0 }} />
        <span style={{ fontSize: 9, letterSpacing: '.04em', textTransform: 'uppercase', color: 'rgb(var(--color-text-muted))' }}>
          {linked ? 'Berean note' : 'Trail note'}
        </span>
        <span style={{ flex: 1 }} />
        {!linked && (
          <button
            onClick={promoteToBereanNote}
            title="Make this a real Berean note (syncs to the vault)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.7 }}
          ><FileUp size={11} /></button>
        )}
        <button
          onClick={() => { void window.studyTrail.deleteNote(note.id).then(onChanged) }}
          title={linked ? 'Unpin from the trail (the Berean note itself is kept)' : 'Delete this note'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.6 }}
        ><Trash2 size={11} /></button>
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
          outline: 'none', fontSize: 11.5, lineHeight: 1.45, color: 'rgb(var(--color-text-primary))',
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
      ><GripHorizontal size={11} /></div>
    </div>
  )
}
