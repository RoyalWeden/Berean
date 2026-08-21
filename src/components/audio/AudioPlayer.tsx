import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, X, ArrowDownToLine, BookHeadphones, Gauge, AudioLines, CheckCircle2, Download, ListMusic } from 'lucide-react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { getVoices } from '@/lib/tts/ttsEngine'
import { useChapterProgress } from '@/hooks/useChapterProgress'
import VoicePicker from '@/components/audio/VoicePicker'
import ChapterProgressBar from '@/components/audio/ChapterProgressBar'
import CircularPlayButton from '@/components/audio/CircularPlayButton'
import AudioQueuePopover from '@/components/audio/AudioQueuePopover'
import type { BibleTabState } from '@/types'

// Debounced-collapse delay — mirrors Ribbon.tsx's hover-open/close popover convention (350ms
// open / 320ms close via setTimeout refs), applied here to just the collapse side (expand stays
// instant on mouse-enter). This exists to fix a click-race: because the card is horizontally
// centered via `left-1/2 -translate-x-1/2`, an instant collapse on mouseleave shifts every
// button's actual screen X position mid-shrink, so a click can land where a button *was*. A
// short delay gives an in-flight click time to land before the shape starts changing back.
const COLLAPSE_DELAY_MS = 150

// ONE spring config for the entire player, applied via <MotionConfig> so every nested `motion.*`
// element (the outer shape morph, the expanded-panel height reveal, the collapsed-content
// crossfade) inherits it by default instead of each piece picking its own — the previous round's
// bug was three independently-timed animations (an outer spring, a separate 180ms linear tween
// for the panel, and a hard instant pop for the circle↔row content swap) firing at once, which
// reads as chaotic no matter how good any one piece is alone. Round-11.11 feedback: the calmer
// (340/40/0.9) tuning from that fix read as sluggish rather than smooth — higher stiffness + lower
// mass here gets it moving immediately, with just enough damping to settle cleanly without
// overshoot (damping ratio ≈0.86, i.e. still a hair underdamped — a tiny bit of natural give
// reads as "alive," fully critical damping reads stiff/mechanical for something this size).
const PLAYER_SPRING = { type: 'spring' as const, stiffness: 520, damping: 32, mass: 0.7 }

/**
 * Read Aloud floating player — `position: fixed`, bottom-center, renders nothing when no
 * playback is active. One global instance mounted once in App.tsx.
 *
 * Idle (not hovered): a small circular play/pause button with a thin progress ring traced
 * around its edge (CircularPlayButton.tsx) — genuinely minimal, no skip/label/stop controls.
 * Hover: morphs into the full horizontal pill (progress bar, transport row, label/jump/stop,
 * speed/voice panel). The outer shape (`layout` + animated `borderRadius`), the collapsed
 * content's circle↔row crossfade (`AnimatePresence mode="popLayout"`), and the expanded panel's
 * height reveal all share the one `PLAYER_SPRING` above via `<MotionConfig>`, so the whole morph
 * reads as one coordinated motion instead of several pieces animating on their own timelines.
 * `popLayout` is what lets the entering/exiting collapsed content cross-fade smoothly WHILE the
 * outer card's `layout` animation resizes around it, rather than the exiting element still
 * occupying space and fighting the resize.
 *
 * The collapsed row and the expanded section are stacked with `flex-col-reverse` so the
 * collapsed row (first in DOM order) is pinned to the bottom of the card and never moves; the
 * expanded section appears ABOVE it as the card's own height grows upward, anchored via the
 * plain (non-motion) outer wrapper's `bottom` offset so the card's screen position doesn't
 * drift as it resizes.
 *
 * z-index is deliberately BELOW Settings' overlay (z-50, see SettingsModal.tsx) — while
 * Settings is open the player should sit behind that dimmed/blurred backdrop like the rest of
 * the app, not float on top of the dialog.
 */
export default function AudioPlayer() {
  const audioPlayback = useAppStore((s) => s.audioPlayback)
  const togglePlayPause = useAppStore((s) => s.togglePlayPause)
  const stopPlayback = useAppStore((s) => s.stopPlayback)
  const skipVerse = useAppStore((s) => s.skipVerse)
  const seekToVerse = useAppStore((s) => s.seekToVerse)
  const startPlaybackFrom = useAppStore((s) => s.startPlaybackFrom)
  const ttsRate = useAppStore((s) => s.ttsRate)
  const setTTSRate = useAppStore((s) => s.setTTSRate)
  const ttsVoiceURI = useAppStore((s) => s.ttsVoiceURI)
  const setTTSVoiceURI = useAppStore((s) => s.setTTSVoiceURI)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const activeTabId = useAppStore((s) => s.activeTabId.scripture)
  const tabs = useAppStore((s) => s.tabs.scripture)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const activateTab = useAppStore((s) => s.activateTab)
  const openSettingsToAudio = useAppStore((s) => s.openSettingsToAudio)

  const [expanded, setExpanded] = useState(false)
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false)
  const queuePopoverOpenRef = useRef(false)
  useEffect(() => { queuePopoverOpenRef.current = queuePopoverOpen }, [queuePopoverOpen])
  const playbackQueue = useAppStore((s) => s.playbackQueue)
  // Debounced-collapse + pointer-interaction guard (see COLLAPSE_DELAY_MS doc comment above and
  // the click-race fix described in the file-level doc comment).
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInteractingRef = useRef(false)

  function clearCollapseTimer() {
    if (collapseTimerRef.current != null) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null }
  }
  function scheduleCollapse() {
    clearCollapseTimer()
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null
      // A pointer is actively down inside the pill (e.g. mid-drag on the progress bar, or the
      // instant after a click lands) — don't collapse out from under it. Re-check shortly
      // instead of just bailing outright, so the collapse still eventually happens once the
      // interaction ends even if the mouse never re-enters. Same treatment for the queue
      // popover: it's portaled to document.body (outside this wrapper's DOM subtree), so
      // hovering it doesn't naturally count as "still hovering the player" — without this check
      // the pill would collapse out from under an open, actively-being-used popover.
      if (isInteractingRef.current || queuePopoverOpenRef.current) { scheduleCollapse(); return }
      setExpanded(false)
    }, COLLAPSE_DELAY_MS)
  }
  function handleMouseEnter() {
    clearCollapseTimer()
    setExpanded(true)
  }
  function handleMouseLeave() {
    scheduleCollapse()
  }
  function handlePointerDown() {
    isInteractingRef.current = true
    clearCollapseTimer()
  }
  function handlePointerUp() {
    isInteractingRef.current = false
  }
  useEffect(() => () => clearCollapseTimer(), [])

  // Idle-ring fraction — computed unconditionally (hooks can't be called after the early return
  // below) via the same shared hook ChapterProgressBar.tsx uses, so the two stay in lockstep.
  // Falls back to empty/1-ish inputs when there's no active playback yet; the hook itself no-ops
  // its fetch when bookId is falsy.
  const { fraction: idleFraction } = useChapterProgress(
    audioPlayback?.bookId ?? '', audioPlayback?.chapter ?? 1, audioPlayback?.textId ?? '', audioPlayback?.verse ?? 1,
    audioPlayback?.endVerse,
  )

  if (!audioPlayback) return null

  const label = `${bookChapterVerseLabel(audioPlayback.bookId, audioPlayback.chapter, audioPlayback.verse)}${audioPlayback.textId === 'lxx' ? ' LXX' : ''}`

  // The currently VISIBLE scripture tab may or may not be the chapter actually playing —
  // playback continues in the background regardless of what's on screen (useTTSPlayback.ts).
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeState = activeTab?.state as BibleTabState | undefined
  const isViewingPlayingChapter = activeState?.bookId === audioPlayback.bookId && activeState?.chapter === audioPlayback.chapter
  const showSyncRow = !isViewingPlayingChapter && !audioPlayback.finished

  function jumpToPlaying() {
    if (!audioPlayback) return
    setActiveSpace('scripture')
    if (activeTab) {
      activateTab(activeTab)
      updateTabState('scripture', activeTab.id, {
        bookId: audioPlayback.bookId, chapter: audioPlayback.chapter,
        // The visible tab's translation must switch to match what's actually playing —
        // without this, the view can land on a book/chapter that doesn't exist in whatever
        // translation the tab was previously showing (e.g. jumping to an Enoch chapter while
        // the tab is still set to KJVA), which reads as "there's no data here."
        translation: audioPlayback.textId.toUpperCase(),
        targetVerse: audioPlayback.verse, scrollPosition: 0,
      })
    }
  }

  /** The reverse of "jump to playing": retarget Read Aloud to whatever chapter is currently
   *  on screen, leaving the view exactly where it is. */
  function playThisChapterInstead() {
    if (!activeState?.bookId) return
    const textId = (activeState.translation ?? 'KJVA').toLowerCase()
    startPlaybackFrom(activeState.bookId, activeState.chapter, 1, textId)
  }

  function openVoiceSettings() {
    openSettingsToAudio()
  }

  // Every Kokoro voice is worth offering (the two lowest-graded ones are excluded from the
  // catalog itself — see kokoroVoiceData.ts), so there's no quality filtering left to do here.
  // getGoodVoices/scanVoices existed to sort usable system voices from the junk Chromium exposes
  // and to nudge users toward downloading better ones; both went with the Web Speech backend.
  const voices = getVoices()

  return (
    <MotionConfig transition={PLAYER_SPRING}>
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 no-drag"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <motion.div
          layout
          // Inline (not Tailwind-class) borderRadius so framer-motion's `layout` animation can
          // read and interpolate it as part of the same FLIP transform driving the size change —
          // this is what makes the circle-to-capsule morph one coherent shape animation instead
          // of two independently-configured pieces.
          style={{ borderRadius: expanded ? 26 : 20 }}
          className="relative flex flex-col-reverse items-stretch shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))/95] backdrop-blur overflow-hidden"
        >
          {/* Collapsed section — first in DOM order + flex-col-reverse pins it to the card's
              visual bottom, so it never shifts as the card above it grows/shrinks. The idle
              circle and the full transport row cross-fade via AnimatePresence (mode="popLayout"
              removes the exiting element from layout flow immediately, so it doesn't fight the
              card's own resize) instead of hard-swapping with no transition at all. */}
          <div>
            <AnimatePresence mode="popLayout" initial={false}>
              {!expanded ? (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  className="p-1"
                >
                  <CircularPlayButton
                    fraction={idleFraction}
                    isPaused={audioPlayback.isPaused}
                    finished={audioPlayback.finished}
                    onToggle={togglePlayPause}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="row"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                >
                  {!audioPlayback.finished && (
                    <ChapterProgressBar
                      bookId={audioPlayback.bookId}
                      chapter={audioPlayback.chapter}
                      textId={audioPlayback.textId}
                      currentVerseNum={audioPlayback.verse}
                      endVerseNum={audioPlayback.endVerse}
                      onSeek={seekToVerse}
                      // The bar only mounts once the WHOLE pill is already expanded — passing
                      // that down (rather than making the bar re-derive its own hover state from
                      // scratch) is what fixes it: a plain mouseenter on the bar itself often
                      // never fires at all, since the bar appears directly underneath an already-
                      // stationary cursor the instant the pill morphs open (no mouse EVENT is
                      // generated just because a DOM element appeared under an unmoved pointer).
                      active
                    />
                  )}
                  {/* Reference label gets its own centered row, out of the button row entirely
                      — it was the main thing weighing down the RIGHT side of the button row
                      below, working against keeping play/pause centered. When the visible tab
                      isn't showing what's actually playing, the WHOLE label becomes the "jump to
                      what's playing" button (previously a separate icon squeezed into the
                      transport row below) — clicking anywhere on "2 Peter 3:3" jumps there, with
                      "read this chapter instead" (retarget playback to what's on screen) sitting
                      right beside it instead of buried in the speed/voice row underneath. */}
                  <div className="flex items-center justify-center gap-1 pt-0.5 select-none">
                    {audioPlayback.finished ? (
                      <CheckCircle2 size={12} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
                    ) : (
                      <AudioLines size={12} className={`text-[rgb(var(--color-accent))] flex-shrink-0 ${audioPlayback.isPaused ? '' : 'animate-pulse'}`} />
                    )}
                    {showSyncRow ? (
                      <button
                        onClick={jumpToPlaying}
                        className="flex items-center gap-1 px-1 py-0.5 -my-0.5 rounded text-[11px] font-medium text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/12] cursor-pointer transition-colors whitespace-nowrap"
                        title="Jump to what's playing"
                      >
                        {label}
                        <ArrowDownToLine size={11} />
                      </button>
                    ) : (
                      <span className="text-[11px] font-medium text-[rgb(var(--color-text-primary))] whitespace-nowrap">
                        {audioPlayback.finished ? 'Finished' : label}
                      </span>
                    )}
                    {showSyncRow && (
                      <button
                        onClick={playThisChapterInstead}
                        className="flex items-center justify-center w-5 h-5 rounded-full text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors flex-shrink-0"
                        title="Read this chapter instead — retarget Read Aloud to what you're viewing"
                      >
                        <BookHeadphones size={12} />
                      </button>
                    )}
                  </div>

                  {/* Three-column grid, not a flex row — play/pause sits in the fixed-width
                      CENTER column, with the left/right columns both `1fr` (mathematically
                      forced to equal width, whichever needs more just leaves blank space on the
                      shorter side). That's what actually keeps play/pause dead-center regardless
                      of how much is on either side — a flex row with play/pause simply first in
                      DOM order (the previous layout) has nothing forcing symmetry: adding
                      buttons only to its right shifts the whole card wider, and since the card
                      re-centers around ITS OWN middle, a button sitting near the card's left
                      edge (not at its middle) drifts left as a direct side effect. This also
                      fixes "clicking play/pause during expand/collapse sometimes misses" at the
                      root — the button now never moves at all, regardless of what's animating
                      around it. */}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center pl-1.5 pr-2 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => skipVerse('prev')}
                        className="flex items-center justify-center w-7 h-7 rounded-full text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
                        title="Previous verse"
                      >
                        <SkipBack size={13} />
                      </button>
                    </div>

                    <button
                      onClick={togglePlayPause}
                      className="flex items-center justify-center w-8 h-8 mx-1.5 rounded-full bg-[rgb(var(--color-accent))] text-white cursor-pointer hover:opacity-90 active:scale-95 transition-all shadow-sm"
                      title={audioPlayback.isPaused ? 'Resume' : 'Pause'}
                    >
                      {audioPlayback.isPaused ? <Play size={14} className="translate-x-[1px]" /> : <Pause size={14} />}
                    </button>

                    <div className="flex items-center justify-start gap-1">
                      <button
                        onClick={() => skipVerse('next')}
                        className="flex items-center justify-center w-7 h-7 rounded-full text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
                        title="Next verse"
                      >
                        <SkipForward size={13} />
                      </button>
                      {/* Was the Stop (X) button — that moved to the card's top-right corner
                          (always in the same spot regardless of expand state) so it reads as
                          "close this player," freeing this spot for the queue button. */}
                      <button
                        onClick={() => setQueuePopoverOpen((v) => !v)}
                        className={`relative flex items-center justify-center w-7 h-7 rounded-full cursor-pointer transition-colors ${queuePopoverOpen ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/12]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
                        title="Playlist queue"
                      >
                        <ListMusic size={13} />
                        {playbackQueue.length > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[rgb(var(--color-accent))] text-white text-[8px] font-medium leading-3 text-center">
                            {playbackQueue.length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Expanded controls — second in DOM order, so flex-col-reverse renders it ABOVE the
              collapsed row, growing the card upward from the pinned bottom edge.
              Round-11.12: this used to animate its OWN height (0 → 'auto' → 0) independently of
              the outer card's `layout` FLIP transform driving the width change below — two
              separate motion systems computing overlapping-but-not-identical paths to the same
              end state, which read as "closes vertically, then horizontally" instead of one
              motion. Switched to `popLayout` + a plain opacity/scale fade (no explicit height
              values at all), same technique as the collapsed row's circle↔pill content swap —
              now BOTH dimensions are driven purely by the outer card's `layout` prop, so they're
              mathematically the same transform, not just two timers tuned to match. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="overflow-hidden"
              >
                {/* Round-11.11: collapsed from 3-4 stacked labeled rows into ONE compact row —
                    speed + voice side by side (no separate icon-labeled row each), nudge/sync
                    reduced to small icon buttons with a tooltip instead of full-width text rows.
                    "Fluid, not too many unnecessary details" — the icons are self-explanatory
                    (gauge = speed, mic = voice) and every control fits on one line. The queue
                    button and "read this chapter instead" both moved out of this row (to the
                    transport row and the label row respectively) — this is now just speed + voice. */}
                {/* Speed slider widened (w-11 → w-28, panel 260px → 300px to fit) — reported too
                    cramped to comfortably drag at w-11's 44px; the 0.25 step across a 0.25-3
                    range now has real room per notch instead of being squeezed into a couple
                    dozen pixels total. */}
                <div className="w-[300px] px-2.5 py-2 flex items-center gap-1.5 border-b border-[rgb(var(--color-surface-3))]">
                  <Gauge size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                  <input
                    type="range" min={0.25} max={3} step={0.25}
                    value={ttsRate}
                    onChange={(e) => setTTSRate(parseFloat(e.target.value))}
                    title={`${ttsRate.toFixed(2)}x`}
                    className="w-28 accent-[rgb(var(--color-accent))] flex-shrink-0"
                  />
                  <span className="text-[10px] font-medium text-[rgb(var(--color-text-secondary))] w-7 flex-shrink-0 tabular-nums">{ttsRate.toFixed(2)}x</span>

                  {voices.length > 0 && (
                    // No auto-preview here (unlike Settings → Audio) — this picker can be used
                    // mid-playback, and previewing would collide with the actual chapter audio on
                    // speechSynthesis' single queue. iconOnly: a compact button that opens the
                    // same picker, rather than a wide dropdown-style display crowding this row.
                    <VoicePicker voices={voices} value={ttsVoiceURI} onChange={setTTSVoiceURI} compact iconOnly />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stop/close — fixed at the card's top-right corner regardless of what else is going
              on in the transport row beneath it (previously lived in the transport row itself,
              at the same height as skip/play — that spot now belongs to the queue button). Only
              shown expanded: the collapsed circle has no room for it and IS itself the
              play/pause target. */}
          {expanded && (
            <button
              onClick={stopPlayback}
              className="absolute top-1.5 right-1.5 z-10 flex items-center justify-center w-6 h-6 rounded-full text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
              title="Stop"
            >
              <X size={14} />
            </button>
          )}
        </motion.div>
      </div>
      {queuePopoverOpen && <AudioQueuePopover onClose={() => setQueuePopoverOpen(false)} />}
    </MotionConfig>
  )
}
