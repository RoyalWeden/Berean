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
    // Playing from a queue (Read Aloud playlist) — advance to the next queued item instead of
    // "next chapter in the same book," and stop (rather than fall back to book-chapter advance)
    // once the queue is exhausted, since the queue's whole point is playing a specific, freeform
    // set of chapters rather than continuing to read straight through a book.
    if (s.playbackQueue.length > 0 && s.playbackQueueIndex >= 0) {
      const nextIndex = s.playbackQueueIndex + 1
      const nextItem = s.playbackQueue[nextIndex]
      if (!nextItem) {
        s.setAudioPlayback({ isPlaying: false, isPaused: false, finished: true })
        return
      }
      const pauseMs = Math.max(0, useAppStore.getState().ttsAutoAdvancePauseSec) * 1000
      advanceTimerRef.current = setTimeout(() => {
        useAppStore.getState().playQueueIndex(nextIndex)
      }, pauseMs)
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
        const st = useAppStore.getState()
        // Auto-follow the on-screen scripture tab to the next chapter — but only if it was
        // already showing the chapter that just finished. Without this the audio itself already
        // advances (see above), but the visible reading pane doesn't, leaving the user to
        // manually hit "jump to playing" (AudioPlayer.tsx) every chapter. Restricting it to
        // "was already watching" means a user who deliberately navigated elsewhere mid-playback
        // (to read ahead, or something unrelated, while listening) doesn't get yanked back.
        const activeTab = st.tabs.scripture.find((t) => t.id === st.activeTabId.scripture)
        const activeState = activeTab?.state as import('@/types').BibleTabState | undefined
        const wasViewingEndedChapter = activeState?.bookId === bookId && activeState?.chapter === chapter
        if (wasViewingEndedChapter && activeTab) {
          st.updateTabState('scripture', activeTab.id, {
            bookId: ref.bookId, chapter: ref.chapter, translation: textId.toUpperCase(),
            targetVerse: 1, scrollPosition: 0,
          })
        }
        st.startPlaybackFrom(ref.bookId, ref.chapter, 1, textId)
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
    // Stop any still-playing previous session RIGHT NOW, not only once speakChapter() is
    // finally called after the query below resolves. speakChapter() itself calls stop() too,
    // but that left a window — for the whole duration of the async queryChapter() IPC call —
    // during which a previous session's onVerseStart/onWordBoundary callbacks kept firing and
    // overwriting audioPlayback with the OLD verse, clobbering the verse this request just
    // asked to start from (e.g. "read from verse 1" briefly/visibly landing on a later verse
    // while the old session's callbacks kept winning the race).
    ttsEngine.stop()

    window.bible.queryChapter(ap.bookId, ap.chapter, ap.textId).then((verses) => {
      if (cancelled) return
      // Speak the same substituted words the user sees on screen (e.g. "Yehovah" instead of
      // "LORD") — buildChapterSpokenQueue previously built spoken text directly from the raw
      // DB text with no awareness of word-replacer rules at all, so TTS was speaking the
      // ORIGINAL word regardless of what was actually displayed/configured.
      const wrState = useAppStore.getState()
      const rules = wrState.wordReplacerEnabled ? wrState.wordReplacerRules : []
      let queue = buildChapterSpokenQueue(verses, ap.bookId, ap.chapter, rules)
      // Verse-range playback (a queue item like "Luke 16:1-5", or any direct startPlaybackFrom
      // call with an endVerse): truncate the queue right after the requested end verse so
      // ttsEngine's own onChapterEnd fires there — same "chapter end" pipeline every other
      // playback path already goes through (auto-advance to the next queue item, or stop),
      // just reached earlier. Falls back to the full chapter if endVerse doesn't land inside it
      // (e.g. a stale/out-of-range value) rather than silently playing nothing.
      if (ap.endVerse != null) {
        const endIdx = queue.findIndex((v) => v.verseNum === ap.endVerse)
        if (endIdx >= 0) queue = queue.slice(0, endIdx + 1)
      }
      queueRef.current = queue
      queueKeyRef.current = `${ap.bookId}:${ap.chapter}:${ap.textId}`
      const startIdx = queue.findIndex((v) => v.verseNum === ap.verse)
      const s = useAppStore.getState()
      ttsEngine.speakChapter(queue, {
        startVerseIndex: startIdx >= 0 ? startIdx : 0,
        rate: s.ttsRate,
        voiceURI: s.ttsVoiceURI,
        onVerseStart: (_idx, verse) => {
          // `isPaused` reads the ENGINE's own live state rather than hardcoding false. This
          // callback fires eagerly for a chunk's first verse even while genuinely paused (e.g.
          // dragging the progress-bar slider mid-pause triggers `skipToVerse` → a new chunk
          // whose first-verse event fires before `waitIfPaused()` actually lets it play — see
          // kokoroBackend.ts's `playChunkBuffer`) — hardcoding false there falsely told the
          // store playback had resumed when it hadn't, which then made the NEXT press of the
          // play/pause button call `pause()` (a no-op — the engine already thought it was
          // paused) instead of the `resume()` the user actually needed, so nothing ever
          // audibly continued.
          useAppStore.getState().setAudioPlayback({
            isPlaying: true, isPaused: ttsEngine.isPaused, textId: ap.textId,
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
    // Prefer the engine's OWN current index over re-deriving one from ap.verse. ap.verse is
    // only ever as accurate as Kokoro's estimated (not measured) verse-boundary timing — see
    // kokoroBackend.ts/timestampAlignment.ts — so basing repeated skips on it lets any drift
    // between the estimate and true playback compound with every click. ttsEngine.activeIndex
    // is the engine's own authoritative position and needs no lookup at all.
    const curIdx = ttsEngine.isActive ? ttsEngine.activeIndex : queue.findIndex((v) => v.verseNum === ap.verse)
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
    // Carries ap.endVerse through — otherwise seeking while paused/stopped on a verse-range
    // playback (e.g. a "Luke 16:1-5" queue item) would silently drop the range boundary and
    // resume playing to the end of the whole chapter instead of stopping back at verse 5.
    else s.startPlaybackFrom(ap.bookId, ap.chapter, targetVerseNum, ap.textId, ap.endVerse)
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
