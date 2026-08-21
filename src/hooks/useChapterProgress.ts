import { useEffect, useState } from 'react'
import type { Verse } from '@/types'

/**
 * Shared "how far through the chapter is Read Aloud" data — the chapter's verse list plus the
 * current-verse fraction (0..1) through it. Used by BOTH the always-visible circular progress
 * ring (AudioPlayer.tsx's idle pill, CircularPlayButton.tsx) and the draggable progress bar
 * (ChapterProgressBar.tsx, shown on hover) so the two never drift out of sync by each doing
 * their own verse-count fetch + fraction math.
 *
 * `endVerseNum` (optional): for verse-range playback (see AudioPlaybackState.endVerse /
 * useTTSPlayback.ts's queue truncation), the returned `verses` is clipped to end there too — so
 * "100%" means "reached the requested end verse," not "reached the end of the whole chapter,"
 * keeping the ring/bar honest about what's actually going to play.
 */
export function useChapterProgress(bookId: string, chapter: number, textId: string, currentVerseNum: number, endVerseNum?: number | null) {
  const [allVerses, setAllVerses] = useState<Verse[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setAllVerses(null)
    if (!bookId) return // caller has no active chapter yet (e.g. AudioPlayer before playback starts)
    window.bible.queryChapter(bookId, chapter, textId).then((vs) => {
      if (!cancelled) setAllVerses(vs)
    }).catch(() => { if (!cancelled) setAllVerses(null) })
    return () => { cancelled = true }
  }, [bookId, chapter, textId])

  const verses = (() => {
    if (!allVerses || endVerseNum == null) return allVerses
    const endIdx = allVerses.findIndex((v) => v.verse_num === endVerseNum)
    return endIdx >= 0 ? allVerses.slice(0, endIdx + 1) : allVerses
  })()

  const currentIdx = verses ? Math.max(0, verses.findIndex((v) => v.verse_num === currentVerseNum)) : 0
  const fraction = verses && verses.length > 1 ? currentIdx / (verses.length - 1) : verses ? 1 : 0

  return { verses, currentIdx, fraction }
}
