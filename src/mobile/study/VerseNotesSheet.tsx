import React, { useEffect, useState } from 'react'
import { Plus, ExternalLink } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { navigateToVerse } from '@/lib/verseNavigation'
import type { SheetApi } from '../primitives/Sheet'
import { Row, ListSection } from '../primitives/Page'
import { useNoteAutosave } from '../notes/useNoteAutosave'
import { StrongsSheet } from './StrongsSheet'

/** Push the in-place editor for a note into the current sheet, at its full height. */
export function pushSheetNoteEditor(api: SheetApi, noteId: string, context: string, onOpenInNotes: (id: string) => void, fullDetent: number) {
  api.push({ key: `note-${noteId}`, title: context, render: (a) => <SheetNoteEditor noteId={noteId} context={context} api={a} onOpenInNotes={onOpenInNotes} /> })
  if (api.detent < fullDetent) api.setDetent(fullDetent)
}

/**
 * Notes that reference one verse, inside the verse sheet (SEP25): tap a note → edit it right here
 * (the verse stays the sheet's context — "‹ Deuteronomy 29:3" goes back); + → a new note for the
 * verse, opened for editing in place. The Notes tab stays one tap away ("Open in Notes").
 */
export function VerseNotesSheet({ verseRef, textId, label, api, onOpenNote, onNewNote, fullDetent = 2 }: {
  verseRef: string; textId: string; label: string; api: SheetApi
  onOpenNote: (noteId: string) => void
  /** Creates the note; resolves to its id. */
  onNewNote: () => Promise<string | null>
  /** The sheet's full-height detent index (verse sheet: low, medium, full → 2). */
  fullDetent?: number
}) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const token = useAppStore((s) => s.noteChangeToken)
  useEffect(() => {
    let alive = true
    window.notes.getVerseNotes(verseRef, textId).then((n) => { if (alive) setNotes(n) }).catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [verseRef, textId, token])
  const edit = (id: string) => pushSheetNoteEditor(api, id, label, (nid) => { api.close(); onOpenNote(nid) }, fullDetent)
  return (
    <div className="mobile-verse-notes">
      <ListSection title={notes && notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} on ${label}` : label}>
        {notes === null && <div className="mobile-empty">Loading…</div>}
        {notes?.length === 0 && <div className="mobile-empty">No notes on this verse yet.</div>}
        {notes?.map((n) => (
          <Row key={n.id} title={n.title || 'Untitled'} subtitle={previewOf(n)} chevron onClick={() => edit(n.id)} />
        ))}
        <Row leading={<Plus size={18} aria-hidden />} title="New note" onClick={() => { void onNewNote().then((id) => { if (id) edit(id) }) }} />
      </ListSection>
    </div>
  )
}

/** A note edited inside a sheet — the same editor and save semantics as the Notes tab. */
export function SheetNoteEditor({ noteId, context, api, onOpenInNotes }: { noteId: string; context: string; api: SheetApi; onOpenInNotes: (id: string) => void }) {
  const { note, persist, lastSavedAt } = useNoteAutosave(noteId)
  const typingLook = useAppStore((s) => s.noteTypingLook)
  if (note === undefined) return <div className="mobile-empty">Loading…</div>
  if (note === null) return <div className="mobile-empty">This note no longer exists.</div>
  return (
    <div className="mobile-sheet-note">
      <div className="mobile-sheet-note-head">
        <input className="mobile-sheet-note-title" value={note.title} placeholder="Untitled" aria-label="Note title" onChange={(e) => persist({ title: e.target.value })} />
        <button type="button" className="mobile-sheet-note-open" onClick={() => onOpenInNotes(note.id)} aria-label="Open in Notes">
          <ExternalLink size={17} aria-hidden />
        </button>
      </div>
      {note.title.trim() !== context && <div className="mobile-sheet-note-context">{context}</div>}
      <NoteEditorPM
        content={note.content}
        noteId={note.id}
        onChange={(content) => persist({ content })}
        mode="edit"
        typingLook={typingLook}
        notes={[]}
        lastSavedAt={lastSavedAt}
        onWikilinkClick={() => onOpenInNotes(note.id)}
        onVerseRefClick={(ref) => { api.close(); navigateToVerse({ bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null, origin: { kind: 'note-wikilink', noteId: note.id, noteTitle: note.title ?? '' } }) }}
        onLexiconRefClick={(id) => api.push({ key: `strongs-${id}`, title: id, render: (a) => <StrongsSheet strongsNum={id} api={a} /> })}
        placeholder="Write…"
        className="mobile-pm"
      />
    </div>
  )
}

function previewOf(n: Note): string {
  try { return stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) } catch { return (n.content ?? '').slice(0, 90) }
}
