import { createContext } from 'react'
import type { Verse, HighlightColor, VerseTagRange } from '@/types'

/**
 * How a VerseRow presents its actions. Desktop leaves the default (`pointer`: right-click
 * popover, hover menus, selection toolbar). The iPhone reader provides `touch`: VerseRow then
 * turns a long-press (or a contextmenu event) into `onRequestActions(ctx)` and the shell shows a
 * bottom sheet built from `ctx` — the SAME action implementations, presented natively (R075).
 * A context rather than props so ChapterView's three VerseRow render sites stay untouched.
 */
export interface VerseActionContext {
  verse: Verse
  textId: string
  /** `GEN.1.1` form used by notes / cross-refs. */
  verseRef: string
  /** "Genesis 1:1" (with the LXX marker when applicable). */
  label: string
  activeHighlight: HighlightColor | null
  /** The user's text selection inside this verse at the moment of the request, if any. */
  selection: { startChar: number; endChar: number; text: string } | null
  copyVerse: () => void
  copyReference: () => void
  /** Creates an empty verse note; resolves to its id (null on failure). */
  addVerseNote: () => Promise<string | null>
  playAudioFromHere: () => void
  highlightVerse: (color: HighlightColor) => Promise<void>
  removeVerseHighlight: () => Promise<void>
  highlightRange: (startChar: number, endChar: number, color: HighlightColor) => Promise<void>
  clearRangeHighlights: (startChar: number, endChar: number) => Promise<void>
  /** Tag-picker payload for this verse (or the chapter). */
  tagRanges: (scope: 'verse' | 'chapter') => { ranges: VerseTagRange[]; label: string; kind: 'verses' | 'chapter' }
}

export interface VerseInteraction {
  interaction: 'pointer' | 'touch'
  onRequestActions?: (ctx: VerseActionContext) => void
  /** Touch: a single tap anywhere in a verse row (text, whitespace, number) — TEST-035. Not
   *  called when the tap only dismissed an active text selection (TEST-039). */
  onVerseTap?: (ctx: VerseActionContext) => void
  /** Touch: VerseRows register a context builder keyed `${textId}|${book}|${chapter}|${verse}`
   *  so the reader's single `selectionchange` listener can build the verse sheet for a native
   *  long-press text selection without one listener per row. Returns the unregister function. */
  registerRow?: (key: string, build: () => VerseActionContext) => () => void
}

export const verseRowKey = (textId: string, bookId: string, chapter: number, verse: number) => `${textId}|${bookId}|${chapter}|${verse}`

export const VerseInteractionContext = createContext<VerseInteraction>({ interaction: 'pointer' })
