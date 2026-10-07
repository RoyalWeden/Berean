import type { Note } from '@/types'
import { isSystemNote } from '@/lib/noteUtils'

/**
 * What happens to a note when the user LEAVES it — it is no longer shown in any open tab (Back,
 * opening another note, closing its tab). TEST 2026-10-05:
 *
 *   no title + no meaningful body  → deleted (moved to Trash): a note created and abandoned
 *   no title + body                → named from the user's "Untitled notes are named" setting
 *   anything else                  → untouched
 *
 * System notes (daily, verse, imports) and idiom notes (their term is their title) are never
 * touched. A temporarily empty title while the note is still open is fine — this only runs on leave.
 */

export type UntitledNoteNameFormat = 'long' | 'medium' | 'iso' | 'numeric'
export const UNTITLED_NOTE_NAME_FORMATS: readonly UntitledNoteNameFormat[] = ['long', 'medium', 'iso', 'numeric']

/** "October 5, 2026" · "Oct 5, 2026" · "2026-10-05" · "10/5/2026" (locale-aware where it can be). */
export function untitledNoteName(date: Date, format: UntitledNoteNameFormat, locale?: string): string {
  if (format === 'iso') {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
  }
  const opts: Intl.DateTimeFormatOptions =
    format === 'long' ? { year: 'numeric', month: 'long', day: 'numeric' }
    : format === 'medium' ? { year: 'numeric', month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'numeric', day: 'numeric' }
  return new Intl.DateTimeFormat(locale, opts).format(date)
}

/** Body has real content (not just whitespace, empty markdown markers or an empty list item). */
export function hasMeaningfulBody(content: string | undefined | null): boolean {
  if (!content) return false
  return content.replace(/^---\n[\s\S]*?\n---\s*\n?/, '').replace(/[\s#>*_`~\-+|[\]()]/g, '').replace(/\d+\./g, '').length > 0
}

export type FinalizeAction = { kind: 'none' } | { kind: 'delete' } | { kind: 'name'; title: string }

export function finalizeActionFor(note: Note, format: UntitledNoteNameFormat, now = new Date()): FinalizeAction {
  if (isSystemNote(note) || note.type === 'idiom') return { kind: 'none' }
  if (note.title?.trim()) return { kind: 'none' }
  if (!hasMeaningfulBody(note.content)) return { kind: 'delete' }
  const created = note.createdAt ? new Date(note.createdAt) : now
  return { kind: 'name', title: untitledNoteName(Number.isNaN(created.getTime()) ? now : created, format) }
}

/** Apply finalizeActionFor through the notes bridge. Returns what was done. */
export async function finalizeLeftNote(noteId: string, format: UntitledNoteNameFormat, latest?: Pick<Note, 'title' | 'content'> | null): Promise<FinalizeAction> {
  const api = typeof window !== 'undefined' ? window.notes : undefined
  if (!api?.getNote) return { kind: 'none' }
  const stored = await api.getNote(noteId).catch(() => null)
  if (!stored || (stored as Note & { deletedAt?: number | null }).deletedAt) return { kind: 'none' }
  // `latest`: the editor's in-memory title / content when it was left. The database can lag behind
  // it (an autosave still in flight) — deciding from the stored copy alone deleted a note whose
  // text simply hadn't been written yet (TEST 2026-10-05, iPhone).
  const note = latest ? { ...stored, title: latest.title ?? stored.title, content: latest.content ?? stored.content } : stored
  const action = finalizeActionFor(note, format)
  if (action.kind === 'delete') await api.deleteNote(noteId).catch(() => {})
  else if (action.kind === 'name') await api.updateNote(noteId, { title: action.title }).catch(() => {})
  return action
}
