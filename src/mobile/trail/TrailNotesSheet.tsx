import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import type { TrailStickyNote, TrailSessionDetail } from '@/types/studyTrail'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'

/**
 * Sticky notes of one session (R042): section headers and annotations, listed with the stop each
 * is anchored to, editable in place. Same `window.studyTrail.listNotes/createNote/updateNote/
 * deleteNote` the desktop map's inline stickies use — the map (hosted on the Map segment) shows
 * them in position; this sheet is the touch editor.
 */
export function TrailNotesSheet({ sessionId, api }: { sessionId: string; api: SheetApi }) {
  const [notes, setNotes] = useState<TrailStickyNote[]>([])
  const [detail, setDetail] = useState<TrailSessionDetail | null>(null)
  useEffect(() => { window.studyTrail.getSession(sessionId).then(setDetail).catch(() => setDetail(null)) }, [sessionId])
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const load = useCallback(() => window.studyTrail.listNotes(sessionId).then(setNotes).catch(() => setNotes([])), [sessionId])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.studyTrail.onDataChanged((id) => { if (id === undefined || id === sessionId) void load() }), [load, sessionId])

  const anchorLabel = (n: TrailStickyNote) => {
    const node = detail?.nodes.find((x) => x.id === n.anchorNodeId)
    return node ? bookChapterVerseLabel(node.bookId, node.chapter) : 'Unanchored'
  }
  const startEdit = (n: TrailStickyNote) => { setEditing(n.id); setTitle(n.title ?? ''); setBody(n.body) }
  const save = async () => {
    if (!editing) return
    await window.studyTrail.updateNote(editing, { title: title.trim() || null, body })
    void haptic.success()
    setEditing(null)
    await load()
  }
  const add = async (kind: 'section' | 'annotation') => {
    // Anchor to the latest stop, as the desktop's "Add note here" does from a stop's menu.
    const last = detail?.nodes[detail.nodes.length - 1]
    const n = await window.studyTrail.createNote({ trailSessionId: sessionId, kind, anchorNodeId: last?.id, title: kind === 'section' ? 'New section' : undefined, body: '' })
    await load()
    startEdit(n)
  }
  const remove = async (n: TrailStickyNote) => {
    if (!confirm(`Delete this ${n.kind === 'section' ? 'section header' : 'note'}?`)) return
    await window.studyTrail.deleteNote(n.id)
    if (editing === n.id) setEditing(null)
    await load()
  }

  return (
    <div className="m-trail-notes">
      <div className="m-trail-notes-actions">
        <button type="button" className="mobile-chip" onClick={() => void add('annotation')}><Plus size={16} aria-hidden /> Note</button>
        <button type="button" className="mobile-chip" onClick={() => void add('section')}><Plus size={16} aria-hidden /> Section</button>
      </div>
      {notes.length === 0 && <div className="mobile-empty">No sticky notes in this session yet.</div>}
      {notes.map((n) => (
        <div key={n.id} className={`m-trail-note is-${n.kind}`}>
          {editing === n.id ? (
            <>
              <input className="mobile-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={n.kind === 'section' ? 'Section title' : 'Title (optional)'} aria-label="Title" />
              <textarea className="mobile-input m-trail-note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" aria-label="Body" rows={4} />
              <div className="m-trail-note-row">
                <button type="button" className="mobile-chip is-on" onClick={() => void save()}><Check size={16} aria-hidden /> Save</button>
                <button type="button" className="mobile-chip" onClick={() => setEditing(null)}><X size={16} aria-hidden /> Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="m-trail-note-head">
                <span className="m-trail-note-kind">{n.kind === 'section' ? 'Section' : 'Note'} · {anchorLabel(n)}</span>
                <span className="m-trail-note-tools">
                  <button type="button" className="mobile-icon-tap" aria-label="Edit" onClick={() => startEdit(n)}><Pencil size={18} aria-hidden /></button>
                  <button type="button" className="mobile-icon-tap" aria-label="Delete" onClick={() => void remove(n)}><Trash2 size={18} aria-hidden /></button>
                </span>
              </div>
              {n.title && <div className="m-trail-note-title">{n.title}</div>}
              {n.body && <div className="m-trail-note-text">{n.body}</div>}
            </>
          )}
        </div>
      ))}
      <button type="button" className="mobile-button" onClick={api.close}>Done</button>
    </div>
  )
}
