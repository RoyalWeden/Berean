import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { BereanAudio } from '@/platform/ios/plugins'
import { displayChapter } from '@/lib/chapterNumbering'

/**
 * Keeps the native audio session and the lock-screen card in step with the store's playback
 * state, and routes remote commands (headphones, Control Centre, lock screen) to the same store
 * actions the on-screen controls use.
 */
export function useIosAudioSession(): void {
  useEffect(() => {
    let active = false
    let handle: { remove: () => Promise<void> } | null = null
    void BereanAudio.addListener('command', ({ command }) => {
      const s = useAppStore.getState()
      if (!s.audioPlayback) return
      switch (command) {
        case 'play': if (s.audioPlayback.isPaused || !s.audioPlayback.isPlaying) s.togglePlayPause(); break
        case 'pause': if (s.audioPlayback.isPlaying && !s.audioPlayback.isPaused) s.togglePlayPause(); break
        case 'toggle': s.togglePlayPause(); break
        case 'next': s.skipVerse('next'); break
        case 'previous': s.skipVerse('prev'); break
        case 'stop': s.stopPlayback(); break
      }
    }).then((h) => { handle = h }).catch(() => {})
    const sync = async () => {
      const p = useAppStore.getState().audioPlayback
      if (!p) { if (active) { active = false; await BereanAudio.deactivateSession().catch(() => {}) } return }
      if (!active) { active = true; await BereanAudio.activateSession().catch(() => {}) }
      await BereanAudio.setNowPlaying({
        title: bookChapterVerseLabel(p.bookId, p.chapter, p.verse),
        artist: `${bookName(p.bookId)} ${displayChapter(p.bookId, p.chapter)} · ${p.textId.toUpperCase()}`,
        isPlaying: p.isPlaying && !p.isPaused,
        rate: useAppStore.getState().ttsRate,
      }).catch(() => {})
    }
    void sync()
    const unsub = useAppStore.subscribe((s, prev) => {
      const a = s.audioPlayback, b = prev.audioPlayback
      if (a === b) return
      if (!a || !b || a.verse !== b.verse || a.isPlaying !== b.isPlaying || a.isPaused !== b.isPaused || a.finished !== b.finished) void sync()
    })
    return () => { unsub(); void handle?.remove(); if (active) void BereanAudio.deactivateSession().catch(() => {}) }
  }, [])
}
