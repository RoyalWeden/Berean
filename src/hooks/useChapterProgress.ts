import { useEffect, useState } from 'react'
import type { Verse } from '@/types'

/**
 * Shared "how far through the chapter is Read Aloud" data — the chapter's verse list plus the
 * current-verse fraction (0..1) through it. Used by BOTH the always-visible circular progress
 * ring (AudioPlayer.tsx's idle pill, CircularPlayButton.tsx) and the draggable progress bar
 * (ChapterProgressBar.tsx, shown on hover) so the two never drift out of sync by each doing
 * their own verse-count fetch + fraction math.
 */
export function useChapterProgress(bookId: string, chapter: number, textId: string, currentVerseNum: number) {
  const [verses, setVerses] = useState<Verse[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setVerses(null)
    if (!bookId) return // caller has no active chapter yet (e.g. AudioPlayer before playback starts)
    window.bible.queryChapter(bookId, chapter, textId).then((vs) => {
      if (!cancelled) setVerses(vs)
    }).catch(() => { if (!cancelled) setVerses(null) })
    return () => { cancelled = true }
  }, [bookId, chapter, textId])

  const currentIdx = verses ? Math.max(0, verses.findIndex((v) => v.verse_num === currentVerseNum)) : 0
  const fraction = verses && verses.length > 1 ? currentIdx / (verses.length - 1) : verses ? 1 : 0

  return { verses, currentIdx, fraction }
}
