import type { Verse } from '@/types'

// Last-seen verses array per "bookId:chapter:textId" key, shared across ChapterView mounts.
// ActivePanel fully remounts BiblePanel (and therefore ChapterView) on every tab switch, so
// without this, switching back to an already-viewed chapter always starts `verses` at [] and
// shows the loading skeleton again while window.bible.queryChapter() re-resolves — even though
// the data was on screen a moment ago. Seeding the initial state from this cache (when warm)
// skips that gap, matching the noteCache.ts pattern used for the same class of remount-flash bug.
const cache = new Map<string, Verse[]>()

export function chapterCacheKey(bookId: string, chapter: number, textId: string): string {
  return `${bookId}:${chapter}:${textId}`
}

export function getCachedVerses(key: string): Verse[] | null {
  return cache.get(key) ?? null
}

export function setCachedVerses(key: string, verses: Verse[]): void {
  cache.set(key, verses)
}

/** Drop every cached chapter (Settings → About → Clear cached content). */
export function clearChapterCache(): void {
  cache.clear()
}
