import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import type { SheetApi } from '../primitives/Sheet'
import { Row, ListSection } from '../primitives/Page'

/** Notes attached to one verse (R075 "Show notes"): tap → open in the Notes space; + → new note. */
export function VerseNotesSheet({ verseRef, textId, label, api, onOpenNote, onNewNote }: {
  verseRef: string; textId: string; label: string; api: SheetApi
  onOpenNote: (noteId: string) => void; onNewNote: () => void
}) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const token = useAppStore((s) => s.noteChangeToken)
  useEffect(() => {
    let alive = true
    window.notes.getVerseNotes(verseRef, textId).then((n) => { if (alive) setNotes(n) }).catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [verseRef, textId, token])
  return (
    <div>
      <ListSection title={`Notes for ${label}`}>
        {notes === null && <div className="mobile-empty">Loading…</div>}
        {notes?.length === 0 && <div className="mobile-empty">No notes on this verse yet.</div>}
        {notes?.map((n) => (
          <Row key={n.id} title={n.title || 'Untitled'} subtitle={previewOf(n)} chevron onClick={() => { api.close(); onOpenNote(n.id) }} />
        ))}
      </ListSection>
      <ListSection>
        <Row leading={<Plus size={18} aria-hidden />} title="New note for this verse" onClick={() => { api.close(); onNewNote() }} />
      </ListSection>
    </div>
  )
}

function previewOf(n: Note): string {
  try { return stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) } catch { return (n.content ?? '').slice(0, 90) }
}
