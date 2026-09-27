import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ExternalLink } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { aggregateVerseNotes, type AggregatedNote } from '@/lib/verseNotesAggregate'
import { verseRefDisplay } from '@/lib/parseRef'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { openDestination } from '@/lib/navigation/destination'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { NoteInsertButton, useSheetOverlayZ } from '../notes/NoteInsertButton'
import { renderPhoneSelectionToolbar } from '../notes/phoneEditorChrome'
import '../notes/verseNotes.css'
import { useNoteAutosave } from '../notes/useNoteAutosave'
import { StrongsSheet } from './StrongsSheet'

/** Push the in-place editor for a note into the current sheet, at its full height. */
export function pushSheetNoteEditor(api: SheetApi, noteId: string, context: string, onOpenInNotes: (id: string) => void, fullDetent: number) {
  api.push({ key: `note-${noteId}`, title: context, render: (a) => <SheetNoteEditor noteId={noteId} context={context} api={a} onOpenInNotes={onOpenInNotes} /> })
  if (api.detent < fullDetent) api.setDetent(fullDetent)
}

/**
 * Notes that reference one verse, inside the verse sheet (SEP25, TEST25-NOTES-003): the notes as
 * preview cards (title + a few lines) — tap → edit it right here (the verse stays the sheet's
 * context — "‹ Deuteronomy 29:3" goes back). No note yet → only a floating glass + at the sheet's
 * bottom-right, which creates a note for the verse and opens it for editing in place. The Notes tab
 * stays one tap away (the editor's "Open in Notes").
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
  const [creating, setCreating] = useState(false)
  const token = useAppStore((s) => s.noteChangeToken)
  const anchorRef = useRef<HTMLDivElement>(null)
  const overlayZ = useSheetOverlayZ(anchorRef)
  useEffect(() => {
    let alive = true
    window.notes.getVerseNotes(verseRef, textId).then((n) => { if (alive) setNotes(n) }).catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [verseRef, textId, token])
  const edit = (id: string) => pushSheetNoteEditor(api, id, label, (nid) => { api.close(); onOpenNote(nid) }, fullDetent)
  const create = () => {
    if (creating) return
    setCreating(true)
    void haptic.light()
    void onNewNote().then((id) => { if (id) edit(id) }).finally(() => setCreating(false))
  }
  return (
    <div className="mobile-verse-notes" ref={anchorRef} aria-label={`Notes on ${label}`}>
      {/* At the sheet's root nothing else names the verse; pushed views have "‹ <verse>" above. */}
      {api.depth === 0 && <div className="m-verse-notes-context">{label}</div>}
      {notes === null && <div className="mobile-empty">Loading…</div>}
      {notes?.length === 0 && <div className="mobile-empty">No notes on this verse yet.</div>}
      {notes && notes.length > 0 && (
        <div className="m-verse-note-cards">
          {notes.map((n) => {
            const preview = previewOf(n)
            return (
              <button key={n.id} type="button" className="m-verse-note-card" onClick={() => edit(n.id)}>
                <span className="m-verse-note-card-title">{n.icon && <span aria-hidden>{n.icon} </span>}{n.title || 'Untitled'}</span>
                {preview && <span className="m-verse-note-card-preview">{preview}</span>}
              </button>
            )
          })}
          {/* The floating + is only for a verse without notes; another note stays one tap away
              (a verse can carry several notes — no capability lost). */}
          <button type="button" className="m-verse-note-add" disabled={creating} onClick={create}>Add another note</button>
        </div>
      )}
      {notes?.length === 0 && createPortal(
        <button type="button" className="m-note-fab m-verse-notes-fab" style={overlayZ != null ? { zIndex: overlayZ } : undefined}
          aria-label={`New note on ${label}`} disabled={creating} onMouseDown={(e) => e.preventDefault()} onClick={create}>
          <Plus size={24} aria-hidden />
        </button>,
        document.body,
      )}
    </div>
  )
}

/**
 * Notes on SEVERAL selected verses (SEP27-VERSE-002) — the same cards and in-place editing as one
 * verse, from the same notes store: every note attached to any selected verse, each note ONCE
 * (with the verses it belongs to when that helps). A note attaches to one verse, so there is no +
 * here — the empty state says how to add one.
 */
export function MultiVerseNotesSheet({ verses, label, api, onOpenNote, fullDetent = 2 }: {
  verses: ReadonlyArray<{ bookId: string; chapter: number; verse: number; textId: string }>
  label: string; api: SheetApi
  onOpenNote: (noteId: string) => void
  fullDetent?: number
}) {
  const [items, setItems] = useState<AggregatedNote[] | null>(null)
  const token = useAppStore((s) => s.noteChangeToken)
  const key = verses.map((v) => `${v.textId}|${v.bookId}.${v.chapter}.${v.verse}`).join(',')
  useEffect(() => {
    let alive = true
    void Promise.all(verses.map(async (v) => {
      const ref = `${v.bookId}.${v.chapter}.${v.verse}`
      return { ref, notes: await window.notes.getVerseNotes(ref, v.textId).catch(() => [] as Note[]) }
    })).then((per) => { if (alive) setItems(aggregateVerseNotes(per)) })
    return () => { alive = false }
  }, [key, token]) // eslint-disable-line react-hooks/exhaustive-deps
  const textId = verses[0]?.textId
  const edit = (id: string, context: string) => pushSheetNoteEditor(api, id, context, (nid) => { api.close(); onOpenNote(nid) }, fullDetent)
  return (
    <div className="mobile-verse-notes" aria-label={`Notes on ${label}`}>
      {api.depth === 0 && <div className="m-verse-notes-context">{label}</div>}
      {items === null && <div className="mobile-empty">Loading…</div>}
      {items?.length === 0 && <div className="mobile-empty">No notes on these verses yet. Select one verse to add a note.</div>}
      {items && items.length > 0 && (
        <div className="m-verse-note-cards">
          {items.map(({ note: n, refs }) => {
            const preview = previewOf(n)
            const where = refs.map((r) => verseRefDisplay(r, textId)).join(' · ')
            return (
              <button key={n.id} type="button" className="m-verse-note-card" onClick={() => edit(n.id, verseRefDisplay(refs[0], textId))}>
                <span className="m-verse-note-card-title">{n.icon && <span aria-hidden>{n.icon} </span>}{n.title || 'Untitled'}</span>
                {preview && <span className="m-verse-note-card-preview">{preview}</span>}
                {verses.length > 1 && <span className="m-verse-note-card-refs">{where}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A note edited inside a sheet — the same editor and save semantics as the Notes tab. The sheet's
 *  own title already names the verse, so it is not repeated under the note title. */
export function SheetNoteEditor({ noteId, api, onOpenInNotes }: { noteId: string; context?: string; api: SheetApi; onOpenInNotes: (id: string) => void }) {
  const { note, persist, lastSavedAt, editorContent } = useNoteAutosave(noteId)
  const typingLook = useAppStore((s) => s.noteTypingLook)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
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
      <NoteEditorPM
        content={editorContent}
        noteId={note.id}
        onChange={(content) => persist({ content })}
        mode="edit"
        typingLook={typingLook}
        notes={[]}
        lastSavedAt={lastSavedAt}
        onWikilinkClick={() => onOpenInNotes(note.id)}
        onVerseRefClick={(ref) => { api.close(); openDestination({ kind: 'passage', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null }, 'current-tab', { origin: { kind: 'note-wikilink', noteId: note.id, noteTitle: note.title ?? '' } }) }}
        onLexiconRefClick={(id) => api.push({ key: `strongs-${id}`, title: id, render: (a) => <StrongsSheet strongsNum={id} api={a} /> })}
        placeholder="Write…"
        className="mobile-pm"
        chrome="phone"
        renderSelectionToolbar={renderPhoneSelectionToolbar}
        onEditorReady={setEditorView}
      />
      <NoteInsertButton view={editorView} placement="viewport" />
    </div>
  )
}

function previewOf(n: Note): string {
  try { return stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 220) } catch { return (n.content ?? '').slice(0, 220) }
}
