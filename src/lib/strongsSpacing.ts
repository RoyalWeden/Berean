// Per-verse extra right-margins (px) applied to Strong's-tagged words so their centered
// number pills don't overlap the next word's pill. Measured once (in VerseRow's layout effect)
// and cached here so switching back to a scripture tab — or paging to a chapter you've already
// viewed with Strong's on — re-applies the exact same spacing instantly, with no re-measure
// and no visible reflow. Keyed by `${textId}:${bookId}:${chapter}:${verse}`.
const cache = new Map<string, Record<number, number>>()

export function strongsSpacingKey(textId: string, bookId: string, chapter: number, verse: number): string {
  return `${textId}:${bookId}:${chapter}:${verse}`
}

export function getStrongsSpacing(key: string): Record<number, number> | null {
  return cache.get(key) ?? null
}

export function setStrongsSpacing(key: string, margins: Record<number, number>): void {
  if (cache.size > 4000) cache.clear() // bounded; cheap to rebuild on next view
  cache.set(key, margins)
}

/** Settings → About → Clear cached content. */
export function clearStrongsSpacingCache(): void {
  cache.clear()
}
