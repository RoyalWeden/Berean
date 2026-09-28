import { resolveBookToken, isExactBookToken } from './parseRef'

/**
 * A note's title as SHOWN (NOTES-REF-001). Verse notes that came through the Octarine vault carry
 * the vault's file-name form ("1 Chronicles 16.22", "Matthew 5.3-5" — a colon cannot be used in a
 * file name), so the stored title uses a period. Every surface that shows a note title shows the
 * Scripture form instead: "1 Chronicles 16:22", "Matthew 5:3-5". Only a title that IS a reference
 * (a known book + chapter.verse) is rewritten — "Version 1.2 notes" stays as typed. The stored title
 * is never changed (it is synced user data and the vault's own convention).
 */
const REF_TITLE = /^(.+?)\s+(\d{1,3})\.(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?(\s+LXX)?$/i

export function displayNoteTitle(title: string | null | undefined, fallback = 'Untitled'): string {
  const t = (title ?? '').trim()
  if (!t) return fallback
  const m = REF_TITLE.exec(t)
  if (!m) return t
  // An exact book name / abbreviation only — never a fuzzy guess ("Version" is not a book).
  if (!isExactBookToken(m[1]) || !resolveBookToken(m[1])) return t
  return `${m[1]} ${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ''}${m[5] ? ' LXX' : ''}`
}

/**
 * The inverse, for a title FIELD that shows `displayNoteTitle` (the note editors): when the stored
 * title is the vault's period form and the edited text is still that reference in colon form, store
 * the period form back — so opening and typing in the title never renames the vault file
 * (noteFileName turns ':' into a space). Any other edit is stored exactly as typed.
 */
export function storedNoteTitle(edited: string, stored: string | null | undefined): string {
  const prev = (stored ?? '').trim()
  if (!prev || displayNoteTitle(prev, '') === prev) return edited
  const m = /^(.+?)\s+(\d{1,3}):(\d{1,3})(.*)$/.exec(edited)
  if (!m) return edited
  const back = `${m[1]} ${m[2]}.${m[3]}${m[4]}`
  return displayNoteTitle(back, '') === edited ? back : edited
}
