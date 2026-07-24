import type { Note } from '@/types'

/** Returns true for notes whose title must not be edited (daily, verse, e-Sword, BibleGateway). */
export function isSystemNote(note: Note): boolean {
  if (note.type === 'verse' || note.type === 'daily' || note.type === 'journal') return true
  if (note.tags?.includes('biblegateway') || note.tags?.includes('esword')) return true
  if (note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — ')) return true
  return false
}

/** True for daily/journal notes — same detection CalendarWidget.tsx's findDailyNote uses in
 *  the date→note direction; this is the note→bool direction. */
export function isDailyNote(note: Note): boolean {
  return note.type === 'daily' || note.type === 'journal' ||
    (note.type === 'general' && !!(note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — ')))
}

/** Reverse of CalendarWidget.tsx's findDailyNote — given a daily/journal note, extract the
 *  "YYYY-MM-DD" date it represents from its title (handles both the current ISO format,
 *  "Daily — 2026-01-09", and the old localized one, "Daily — January 9, 2026"). Returns null
 *  for non-daily notes or a title that doesn't parse to a valid date. */
export function dailyNoteDateKey(note: Note): string | null {
  if (!isDailyNote(note)) return null
  const raw = note.title ?? ''
  const dateStr = raw.replace(/^(Daily|Journal) — /, '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

/**
 * Normalize a wikilink target to a bare, lowercased note title for matching.
 *
 * Octarine/Obsidian wikilinks are often path-qualified and may carry a heading
 * anchor or display alias: `[[Daily/2026-01-09#Morning|My Day]]`. Berean note
 * titles are bare ("2026-01-09"), so strip the leading folder path, the `#anchor`,
 * and the `|alias` before comparing.
 */
export function normalizeWikiTarget(str: string): string {
  return (str.split('/').pop() ?? '').split('#')[0].split('|')[0].trim().toLowerCase()
}
