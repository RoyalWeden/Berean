import type { SelectedVerseRef } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'

/**
 * Scripture verse-selection model shared by desktop and iPhone (TEST-001, TEST-007, TEST-019).
 *
 * A tab's selection is the ordered `SelectedVerseRef[]` in `selectedVersesByTab`. It can be
 *   • none, • a single verse, • a contiguous range (same text/book/chapter, no gaps, ≥ 2), or
 *   • multiple (any other combination — click-toggled verses, several chapters).
 * Actions ask `selectionAllows()` instead of counting verses themselves, so an action that has
 * no meaning for several verses (a verse note is anchored to ONE verse) is disabled the same way
 * everywhere. Text selection inside verses is separate (the browser/native selection); a text
 * selection spanning verses converts into a verse selection with `versesSpanned()`.
 */
export type SelectionKind = 'none' | 'single' | 'range' | 'multiple'

export type VerseSelectionAction =
  | 'add-note'        // a verse note is anchored to exactly one verse
  | 'verse-notes'     // "notes for this verse" list
  | 'cross-refs'      // cross references of one verse
  | 'copy' | 'copy-refs' | 'highlight' | 'tag' | 'play' | 'compare' | 'share'

const SINGLE_ONLY: ReadonlySet<VerseSelectionAction> = new Set(['add-note', 'verse-notes', 'cross-refs'])

const sameChapter = (a: SelectedVerseRef, b: SelectedVerseRef) =>
  a.textId === b.textId && a.bookId === b.bookId && a.chapter === b.chapter

/** Verses from `anchor` to `current` inclusive, ascending, within the anchor's chapter. A target
 *  in another chapter/text clamps to the anchor alone (a drag never jumps chapters). */
export function verseRange(anchor: SelectedVerseRef, current: SelectedVerseRef, available?: readonly number[]): SelectedVerseRef[] {
  if (!sameChapter(anchor, current)) return [anchor]
  const lo = Math.min(anchor.verse, current.verse)
  const hi = Math.max(anchor.verse, current.verse)
  const nums = available ? available.filter((n) => n >= lo && n <= hi) : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  return nums.map((verse) => ({ ...anchor, verse }))
}

export function sortVerseRefs(sel: readonly SelectedVerseRef[]): SelectedVerseRef[] {
  return [...sel].sort((a, b) => a.textId.localeCompare(b.textId) || a.bookId.localeCompare(b.bookId) || a.chapter - b.chapter || a.verse - b.verse)
}

export function selectionKind(sel: readonly SelectedVerseRef[]): SelectionKind {
  if (sel.length === 0) return 'none'
  if (sel.length === 1) return 'single'
  const s = sortVerseRefs(sel)
  for (let i = 1; i < s.length; i++) {
    if (!sameChapter(s[0], s[i]) || s[i].verse !== s[i - 1].verse + 1) return 'multiple'
  }
  return 'range'
}

export function selectionAllows(sel: readonly SelectedVerseRef[], action: VerseSelectionAction): boolean {
  const kind = selectionKind(sel)
  if (kind === 'none') return false
  return SINGLE_ONLY.has(action) ? kind === 'single' : true
}

/** "Genesis 1:3–7" for a range, "Genesis 1:3" for one verse, "5 verses" otherwise. */
export function selectionLabel(sel: readonly SelectedVerseRef[]): string {
  const kind = selectionKind(sel)
  if (kind === 'none') return ''
  const s = sortVerseRefs(sel)
  if (kind === 'single') return bookChapterVerseLabel(s[0].bookId, s[0].chapter, s[0].verse)
  if (kind === 'range') return `${bookChapterVerseLabel(s[0].bookId, s[0].chapter, s[0].verse)}–${s[s.length - 1].verse}`
  return `${s.length} verses`
}

/** The verses a text selection touches: every verse between the first and last touched verse
 *  (inclusive) of the same chapter — "select these verses" from a cross-verse text selection. */
export function versesSpanned(first: SelectedVerseRef, last: SelectedVerseRef, available?: readonly number[]): SelectedVerseRef[] {
  return verseRange(first, last, available)
}
