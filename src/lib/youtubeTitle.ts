/** Placeholder shown in a YouTube tab/history entry until the real video title is known. */
export const YOUTUBE_LOADING_TITLE = 'Loading…'

// videoId → title for every video seen this session. Populated by YouTubeTab
// whenever it loads the video list, and lazily by ensureYouTubeTitles() for
// surfaces (the back/forward history dropdown) that need a title for a video
// the user may never have had open in this session.
const titleCache = new Map<string, string>()

export function rememberYouTubeTitles(entries: Array<{ videoId: string; title: string }>): void {
  for (const e of entries) {
    if (e.videoId && e.title) titleCache.set(e.videoId, e.title)
  }
}

/** Cached title for a video id, or undefined if it hasn't been seen yet. */
export function youtubeTitleFor(videoId: string): string | undefined {
  return titleCache.get(videoId)
}

/** Copy of the cache, for callers that want it as React state. */
export function snapshotYouTubeTitles(): Map<string, string> {
  return new Map(titleCache)
}

let loadAllPromise: Promise<void> | null = null

/**
 * Fill the cache from the video DB, then return a snapshot. Memoized — repeated
 * calls share one load (the YouTube tab may never have been opened this session,
 * so the cache can otherwise be empty).
 */
export async function ensureYouTubeTitles(): Promise<Map<string, string>> {
  if (!loadAllPromise) {
    loadAllPromise = window.youtube.loadAll()
      .then((entries) => { rememberYouTubeTitles(entries) })
      .catch(() => { loadAllPromise = null })
  }
  await loadAllPromise
  return snapshotYouTubeTitles()
}
