import type { Note } from '@/types'
import { getWarmStartNotes } from './notesCache'

// Last-seen Note object per id, shared across NotesPanel mounts. Since NotesPanel starts
// activeNote at null and waits on an async window.notes.getNote() call to resolve, without this
// `editing = activeNote !== null` would be false during that gap and briefly show the notes LIST
// view before the editor. Seeding the initial state from this cache (when warm) skips that gap,
// matching the chapterCache/notesCache pattern used elsewhere for the same class of flash.
const cache = new Map<string, Note>()

// Soft LRU cap so a long session that opens many notes can't grow this without bound — a note's
// raw markdown can be several MB when vault sync is off (pasted images are stored inline as
// base64, per CLAUDE.md §9). Map keeps insertion order; both accessors re-insert on write so the
// oldest key is genuinely the least-recently-used. A revisit to an evicted note just refetches
// once, same as a cold start.
const MAX_ENTRIES = 80

function evictOldest(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

export function getCachedNote(id: string): Note | null {
  const hit = cache.get(id)
  if (hit) {
    cache.delete(id)
    cache.set(id, hit) // move to most-recently-used
    return hit
  }
  // Cold in-memory cache (e.g. right after an app launch, before this note has been opened
  // this session) — fall back to notesCache's token-independent warm start (this session's
  // last "all notes" fetch, or a previous session's via localStorage) instead of always eating
  // one restore-fetch flash per note. Deliberately NOT getCachedAllNotes(token)-based: it's
  // exact-token-keyed for freshness, and the startup vault reconcile in App.tsx routinely bumps
  // noteChangeToken within the first render or two, which made a token-pinned lookup miss here
  // almost every time.
  const fromAllNotes = getWarmStartNotes()?.find((n) => n.id === id) ?? null
  if (fromAllNotes) { cache.set(id, fromAllNotes); evictOldest() }
  return fromAllNotes
}

export function setCachedNote(note: Note): void {
  cache.delete(note.id)
  cache.set(note.id, note)
  evictOldest()
}

/** Drop every cached note object (Settings → About → Clear cached content). */
export function clearNoteCache(): void {
  cache.clear()
}
