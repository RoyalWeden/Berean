import type { Note } from '@/types'

/** Returns true for notes whose title must not be edited (daily, verse, e-Sword, BibleGateway). */
export function isSystemNote(note: Note): boolean {
  if (note.type === 'verse' || note.type === 'daily' || note.type === 'journal') return true
  if (note.tags?.includes('biblegateway') || note.tags?.includes('esword')) return true
  if (note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — ')) return true
  return false
}

/**
 * Notes that cannot be moved between user folders (system-folder notes).
 * This is the same set as isSystemNote — kept separate in case the sets diverge later.
 */
export function isMovableNote(note: Note): boolean {
  return !isSystemNote(note)
}

/**
 * Parse an internal verse ref (e.g. "GEN.1.1" or "Matthew 24:32") into
 * { bookId, chapter, verse } for navigation. Returns null if unparseable.
 */
export function parseVerseRef(ref: string): { bookId: string; chapter: number; verse?: number } | null {
  // Machine format: BOOK_ID.CHAPTER or BOOK_ID.CHAPTER.VERSE
  if (/^[A-Z0-9_]+\.\d+/.test(ref)) {
    const parts = ref.split('.')
    const bookId = parts[0]
    const chapter = parseInt(parts[1])
    const verse = parts[2] ? parseInt(parts[2]) : undefined
    if (bookId && !isNaN(chapter)) return { bookId, chapter, verse }
  }
  return null
}
