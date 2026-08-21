import { parseRef } from './parseRef'
import { bookChapterVerseLabel } from './parseRef'
import type { PlaybackQueueItem } from '@/store'

/**
 * Parses a free-typed scripture reference (the same grammar parseRef already understands —
 * "Luke 15", "Luke 16:1-5", "Luke 13-15", "Luke 15:10-16:3") into one or more Read Aloud
 * playback queue items, for the "type a reference, press Enter to add" input in
 * AudioQueuePopover.tsx.
 *
 * A single typed reference can expand into MULTIPLE queue items: each queue item is still "one
 * chapter (or part of one), start verse to end verse" — useTTSPlayback.ts truncates the spoken
 * queue to `endVerse` when set, so a chapter RANGE ("Luke 13-15") becomes one whole-chapter item
 * per chapter, and a cross-chapter verse range ("Luke 15:10-16:3") becomes one item per chapter
 * it touches, each correctly bounded (verse 10 to the end of ch. 15, then verse 1 to 3 of ch. 16).
 *
 * Returns null for input that doesn't parse as a reference at all (unknown book, malformed
 * syntax, etc.) — the caller shows an inline error rather than silently adding nothing.
 */
export function parseQueueRefInput(input: string, textId: string): PlaybackQueueItem[] | null {
  const parsed = parseRef(input)
  if (!parsed) return null
  const { bookId, chapter, verse, endVerse, endChapter } = parsed

  // Chapter range, no verse specificity at either end ("Luke 13-15") — one whole-chapter item
  // per chapter in the range.
  if (endChapter !== undefined && verse === undefined) {
    const items: PlaybackQueueItem[] = []
    for (let ch = chapter; ch <= endChapter; ch++) {
      items.push({ bookId, chapter: ch, startVerse: 1, endVerse: null, textId, label: bookChapterVerseLabel(bookId, ch) })
    }
    return items
  }

  // Cross-chapter verse range ("Luke 15:10-16:3") — first item plays from the start verse to
  // the end of its chapter, remaining items play from verse 1 up to (eventually) endVerse.
  if (endChapter !== undefined && verse !== undefined) {
    const items: PlaybackQueueItem[] = []
    for (let ch = chapter; ch <= endChapter; ch++) {
      const startVerse = ch === chapter ? verse : 1
      const chEndVerse = ch === endChapter ? (endVerse ?? null) : null
      const label = ch === chapter
        ? `${bookChapterVerseLabel(bookId, ch)}:${startVerse}–end`
        : ch === endChapter
          ? `${bookChapterVerseLabel(bookId, ch)}:1–${chEndVerse}`
          : bookChapterVerseLabel(bookId, ch)
      items.push({ bookId, chapter: ch, startVerse, endVerse: chEndVerse, textId, label })
    }
    return items
  }

  // Same-chapter verse range ("Luke 16:1-5") or a single verse/whole chapter ("Luke 15").
  const startVerse = verse ?? 1
  const label = verse !== undefined
    ? endVerse !== undefined
      ? `${bookChapterVerseLabel(bookId, chapter)}:${verse}-${endVerse}`
      : bookChapterVerseLabel(bookId, chapter, verse)
    : bookChapterVerseLabel(bookId, chapter)
  return [{ bookId, chapter, startVerse, endVerse: endVerse ?? null, textId, label }]
}
