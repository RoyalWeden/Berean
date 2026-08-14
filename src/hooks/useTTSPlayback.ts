import { useEffect, useRef } from 'react'
import { useAppStore, type AudioPlaybackState } from '@/store'
import { ttsEngine } from '@/lib/tts/ttsEngine'
import { buildChapterSpokenQueue, type SpokenVerse } from '@/lib/tts/extractSpokenText'
import { getNextChapterRef } from '@/lib/bibleNav'

/**
 * Read Aloud (TTS) orchestration hook — mounted ONCE at App.tsx's shell root, deliberately
 * NOT inside any BiblePanel instance, so it survives tab/panel navigation and unmount. This is
 * what gives Read Aloud its "keeps playing if you navigate elsewhere" / background-playback
 * behavior for free: it never gets torn down by ActivePanel remounting BiblePanel on tab switch.
 *
 * Watches two request tokens on the store (bumped by startPlaybackFrom / skipVerse) rather
 * than the store's live audioPlayback fields directly — audioPlayback is written continuously
 * during playback (every word boundary) by THIS hook's own callbacks, so subscribing to it
 * here would re-run this effect on every word spoken.
 */
export function useTTSPlayback() {
  const requestToken = useAppStore((s) => s.audioPlaybackRequestToken)
  const skipVerseToken = useAppStore((s) => s.skipVerseToken)
  const seekToken = useAppStore((s) => s.seekToken)

  const queueRef = useRef<SpokenVerse[]>([])
  const queueKeyRef = useRef<string | null>(null) // `${bookId}:${chapter}:${textId}` the current queue was built for
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialMountRef = useRef(true)

  async function handleChapterEnd(bookId: string, chapter: number, textId: string) {
    const s = useAppStore.getState()
    if (!s.ttsAutoAdvanceEnabled) {
      s.setAudioPlayback({ isPlaying: false, isPaused: false, finished: true })
      return
    }
    try {
      const books = await window.bible.getBooks(textId)
      const book = books.find((b) => b.id === bookId)
      const chapterCount = book?.chapters_count ?? 1
      const ref = getNextChapterRef(books, bookId, chapter, chapterCount, textId)
      if (!ref) {
        s.setAudioPlayback({ isPlaying: false, isPaused: false, finished: true })
        return
      }
      const pauseMs = Math.max(0, useAppStore.getState().ttsAutoAdvancePauseSec) * 1000
      advanceTimerRef.current = setTimeout(() => {
        useAppStore.getState().startPlaybackFrom(ref.bookId, ref.chapter, 1, textId)
      }, pauseMs)
    } catch {
      s.setAudioPlayback({ isPlaying: false, isPaused: false, finished: true })
    }
  }

  // ── Start / restart playback whenever a new startPlaybackFrom() request comes in ──
  useEffect(() => {
    if (isInitialMountRef.current) { isInitialMountRef.current = false; return }
    const ap = useAppStore.getState().audioPlayback
    if (!ap) return
    let cancelled = false
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null }

    window.bible.queryChapter(ap.bookId, ap.chapter, ap.textId).then((verses) => {
      if (cancelled) return
      // Speak the same substituted words the user sees on screen (e.g. "Yehovah" instead of
      // "LORD") — buildChapterSpokenQueue previously built spoken text directly from the raw
      // DB text with no awareness of word-replacer rules at all, so TTS was speaking the
      // ORIGINAL word regardless of what was actually displayed/configured.
      const wrState = useAppStore.getState()
      const rules = wrState.wordReplacerEnabled ? wrState.wordReplacerRules : []
      const queue = buildChapterSpokenQueue(verses, ap.bookId, ap.chapter, rules)
      queueRef.current = queue
      queueKeyRef.current = `${ap.bookId}:${ap.chapter}:${ap.textId}`
      const startIdx = queue.findIndex((v) => v.verseNum === ap.verse)
      const s = useAppStore.getState()
      ttsEngine.speakChapter(queue, {
        startVerseIndex: startIdx >= 0 ? startIdx : 0,
        rate: s.ttsRate,
        voiceURI: s.ttsVoiceURI,
        onVerseStart: (_idx, verse) => {
          useAppStore.getState().setAudioPlayback({
            isPlaying: true, isPaused: false, textId: ap.textId,
            bookId: verse.bookId, chapter: verse.chapter, verse: verse.verseNum,
            wordIndex: null, finished: false,
          })
        },
        onWordBoundary: (_idx, word) => {
          if (!useAppStore.getState().ttsHighlightWordsEnabled) return
          useAppStore.getState().setAudioPlayback({ wordIndex: word.wordIndex })
        },
        onChapterEnd: () => handleChapterEnd(ap.bookId, ap.chapter, ap.textId),
        onError: () => useAppStore.getState().stopPlayback(),
      })
    }).catch(() => {
      if (!cancelled) useAppStore.getState().stopPlayback()
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestToken])

  // ── Prev/next-verse skip (from AudioPlayer.tsx) ──────────────────────────────
  useEffect(() => {
    if (skipVerseToken === 0) return
    const s = useAppStore.getState()
    const ap = s.audioPlayback
    const dir = s.skipVerseDirection
    if (!ap || !dir) return
    const queue = queueRef.current
    if (queueKeyRef.current !== `${ap.bookId}:${ap.chapter}:${ap.textId}`) return
    const curIdx = queue.findIndex((v) => v.verseNum === ap.verse)
    if (curIdx < 0) return
    const targetIdx = dir === 'next' ? curIdx + 1 : curIdx - 1
    if (targetIdx < 0) return // already at first verse of chapter — no cross-chapter skip-back
    if (targetIdx >= queue.length) {
      // Past the last verse of the chapter — same path as a natural chapter end.
      handleChapterEnd(ap.bookId, ap.chapter, ap.textId)
      return
    }
    ttsEngine.skipToVerse(targetIdx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipVerseToken])

  // ── Absolute seek (chapter progress bar drag, from AudioPlayer.tsx) ──────────
  useEffect(() => {
    if (seekToken === 0) return
    const s = useAppStore.getState()
    const ap = s.audioPlayback
    const targetVerseNum = s.seekTargetVerseNum
    if (!ap || targetVerseNum == null) return
    const queue = queueRef.current
    if (queueKeyRef.current !== `${ap.bookId}:${ap.chapter}:${ap.textId}`) return
    const targetIdx = queue.findIndex((v) => v.verseNum === targetVerseNum)
    if (targetIdx < 0) return

    // Point the STORE at the target FIRST. The progress bar and the verse highlight both render
    // from `audioPlayback.verse`, and nothing moved it here — it only caught up once the engine's
    // own `onVerseStart` fired for the new position. So between releasing the drag and the first
    // audio of the target verse, the UI still showed wherever playback had been, and the display
    // and the audio disagreed.
    s.setAudioPlayback({ verse: targetVerseNum, wordIndex: null })

    // `skipToVerse` is a NO-OP unless the engine is mid-playback — kokoroBackend.ts bails when
    // `stopped`, or when there's no live `opts` from an in-flight speakChapter. That is the real
    // cause of "I start sliding and it reads from verse 1": seeking while paused, or after
    // playback had finished, silently did nothing to the engine, so the next press of play
    // resumed from whatever verse the engine still held rather than the verse just dragged to and
    // visible on screen.
    //
    // Routing that case through startPlaybackFrom makes a seek mean the same thing whether or not
    // audio happens to be running: it bumps `requestToken`, which the start/restart effect above
    // consumes to rebuild the queue and begin at `ap.verse` — the value just written above.
    if (ttsEngine.isActive) ttsEngine.skipToVerse(targetIdx)
    else s.startPlaybackFrom(ap.bookId, ap.chapter, targetVerseNum, ap.textId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekToken])

  // ── Cross-window broadcast (presenter/viewer/floating windows) ──────────────
  // Fires on every spoken word (every audioPlayback write) — subscribed imperatively via the
  // vanilla store API rather than the `useAppStore` hook so this doesn't force App.tsx (this
  // hook is mounted at the shell root, deliberately outside any panel — see file header) and
  // its whole unmemoized child tree to re-render 4-8x/sec during playback. Matches the same
  // imperative-subscribe pattern App.tsx itself already uses for its settings-persist effect.
  useEffect(() => {
    window.app.broadcastAudioState?.(useAppStore.getState().audioPlayback)
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.audioPlayback !== prev.audioPlayback) {
        window.app.broadcastAudioState?.(state.audioPlayback)
      }
    })
    return unsub
  }, [])

  // Receive playback-state updates broadcast from another window (extension point — no other
  // window currently drives playback itself, but this keeps every window's store in sync with
  // whichever one does, matching onTabStateUpdate's own bidirectional pattern).
  useEffect(() => {
    if (typeof window.app.onAudioStateUpdate !== 'function') return
    window.app.onAudioStateUpdate((payload) => {
      useAppStore.getState().setAudioPlayback(payload as AudioPlaybackState | null)
    })
  }, [])

  // Stop speech synthesis cleanly if this hook's owning component ever unmounts (app close).
  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    ttsEngine.stop()
  }, [])
}
