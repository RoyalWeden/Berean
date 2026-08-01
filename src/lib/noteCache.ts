import type { Note } from '@/types'

// Last-seen Note object per id, shared across NotesPanel mounts. ActivePanel fully
// remounts NotesPanel on every tab switch, so without this, reopening a note tab
// always starts activeNote at null and waits on an async window.notes.getNote() call
// to resolve — during that gap `editing = activeNote !== null` is false, so the notes
// LIST view renders first and is then replaced by the editor once the fetch resolves,
// which reads as a brief flash. Seeding the initial state from this cache (when warm)
// skips that gap, matching the booksCache/savedSearch pattern used elsewhere for the
// same class of remount-flash bug.
const cache = new Map<string, Note>()

export function getCachedNote(id: string): Note | null {
  return cache.get(id) ?? null
}

export function setCachedNote(note: Note): void {
  cache.set(note.id, note)
}
