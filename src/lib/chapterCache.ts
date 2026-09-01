import type { Verse } from '@/types'

// Last-seen verses array per "bookId:chapter:textId" key, shared across ChapterView mounts.
// ActivePanel fully remounts BiblePanel (and therefore ChapterView) on every tab switch, so
// without this, switching back to an already-viewed chapter always starts `verses` at [] and
// shows the loading skeleton again while window.bible.queryChapter() re-resolves — even though
// the data was on screen a moment ago. Seeding the initial state from this cache (when warm)
// skips that gap, matching the noteCache.ts pattern used for the same class of remount-flash bug.
const cache = new Map<string, Verse[]>()

// Soft cap so a very long session can't grow this unboundedly. ~150 chapters of verse text is
// only a few MB, but past that we evict least-recently-used entries (Map keeps insertion order;
// getCachedVerses re-inserts on hit to make it LRU). A revisit to an evicted chapter just
// refetches once — same as a cold start.
const MAX_ENTRIES = 150

export function chapterCacheKey(bookId: string, chapter: number, textId: string): string {
  return `${bookId}:${chapter}:${textId}`
}

export function getCachedVerses(key: string): Verse[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  cache.delete(key)
  cache.set(key, hit) // move to most-recently-used
  return hit
}

export function setCachedVerses(key: string, verses: Verse[]): void {
  cache.delete(key)
  cache.set(key, verses)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** Drop every cached chapter (Settings → About → Clear cached content). */
export function clearChapterCache(): void {
  cache.clear()
}
