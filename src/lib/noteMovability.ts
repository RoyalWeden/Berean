import type { Note } from '@/types'

// ── System (virtual) folders ─────────────────────────────────────────────────
// Notes belong to a system folder by their type/tags. A note that has been moved
// into a user folder (folderId set) leaves its system folder. System-folder notes
// cannot be moved. Shared by the desktop folder view (NotesFolderView.tsx) and the
// iPhone notes list (mobile/notes/NotesHomePage.tsx).
export type SystemKey = 'daily' | 'esword' | 'biblegateway' | 'verse'

export function systemFolderOf(note: Note): SystemKey | null {
  if (note.tags?.includes('biblegateway')) return 'biblegateway'
  if (note.tags?.includes('esword')) return 'esword'
  if (note.type === 'daily' || note.type === 'journal' ||
      note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — ')) return 'daily'
  if (note.verseRef || note.type === 'verse') return 'verse'
  return null
}

// A note can be filed into / out of user folders only if it isn't owned by a
// system folder (daily, e-Sword, BibleGateway, verse notes).
export function noteIsMovable(note: Note): boolean {
  return systemFolderOf(note) === null
}
