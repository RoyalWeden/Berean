import React, { useEffect } from 'react'
import { Play, Pause, Volume2, LocateFixed } from 'lucide-react'
import './audio.css'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { useSheets } from '../primitives/Sheet'
import { useChromeState } from '../navigation/chromeState'
import { haptic } from '../primitives/haptics'
import { useIosAudioSession } from './useIosAudioSession'
import { useAudioControlsHidden, setAudioControlsHidden } from './audioControls'
import { useSleepTimerRuntime } from './sleepTimer'
import { useAudioFollowRuntime, useAudioFollowPaused, resumeAudioFollow } from './followState'
import { audioSheetOptions, AUDIO_SHEET_ID } from './AudioSheet'

/**
 * Read Aloud on the phone (TEST25-AUDIO-001/002/006). While audio is active (playing, or paused
 * with a session loaded) two floating glass controls sit over the page instead of the old bottom
 * bar:
 *   • a circular play/pause, lower-centre above the bottom navigation (it follows the navigation
 *     down when the reader collapses it, and hides while a sheet is up or "Hide Controls" is on),
 *     with a small "Follow" chip beside it when the reader stopped following the spoken verse;
 *   • a speaker button at the top-right that opens the audio sheet (AudioSheet.tsx).
 * Also mounts the audio session (lock screen / remote commands), the sleep-timer clock and the
 * auto-follow runtime, so they live as long as the shell does, independent of any sheet.
 * The component keeps its old name/export — MobileApp mounts it unchanged.
 */
export function AudioBar() {
  const active = useAppStore((s) => s.audioPlayback != null)
  const playing = useAppStore((s) => !!s.audioPlayback && s.audioPlayback.isPlaying && !s.audioPlayback.isPaused)
  const passage = useAppStore((s) => (s.audioPlayback ? bookChapterVerseLabel(s.audioPlayback.bookId, s.audioPlayback.chapter) : ''))
  const togglePlayPause = useAppStore((s) => s.togglePlayPause)
  const sheets = useSheets()
  const hidden = useAudioControlsHidden()
  const followPaused = useAudioFollowPaused()
  // Chrome collapsed on scroll (reader: overlay+collapsed; other pages: pageCollapsed): the top-right
  // button hides with the header, and the play/pause drops to where the bottom controls were.
  const chrome = useChromeState()
  const collapsed = chrome.overlay ? chrome.collapsed : chrome.pageCollapsed
  const topShown = active && !collapsed
  useIosAudioSession()
  useSleepTimerRuntime()
  useAudioFollowRuntime()
  // Audio stopped: the next session starts with its controls shown, and an open audio sheet goes.
  useEffect(() => {
    if (active) return
    setAudioControlsHidden(false)
    if (sheets.isOpen(AUDIO_SHEET_ID)) sheets.close(AUDIO_SHEET_ID)
  }, [active, sheets])
  // Layout contract: while the top-right button is visible, page header rows pad 56px on the right.
  useEffect(() => {
    if (!topShown) return
    const html = document.documentElement
    html.dataset.floatingRight = '1'
    return () => { delete html.dataset.floatingRight }
  }, [topShown])
  if (!active) return null

  const sheetUp = sheets.currentId != null
  const openSheet = () => { void haptic.selection(); sheets.open(audioSheetOptions()) }
  const fabShown = !hidden && !sheetUp
  return (
    <>
      <button type="button" className={`m-audio-float m-audio-topbtn${topShown ? '' : ' is-hidden'}`} tabIndex={topShown ? undefined : -1} aria-hidden={!topShown || undefined} aria-label={`Read Aloud, ${passage}. Audio controls`} onClick={openSheet}>
        <Volume2 size={18} aria-hidden />
      </button>
      <div className={`m-audio-fab-wrap${fabShown ? '' : ' is-hidden'}${collapsed ? ' is-low' : ''}`} aria-hidden={!fabShown || undefined}>
        <button
          type="button" className="m-audio-float m-audio-fab" tabIndex={fabShown ? undefined : -1}
          aria-label={playing ? 'Pause reading' : 'Play reading'}
          onClick={() => { void haptic.light(); togglePlayPause() }}
        >
          {playing ? <Pause size={24} fill="currentColor" aria-hidden /> : <Play size={24} fill="currentColor" aria-hidden className="m-audio-play-glyph" />}
        </button>
        {followPaused && (
          <button type="button" className="m-audio-float m-audio-follow-chip" tabIndex={fabShown ? undefined : -1} aria-label="Follow reading" onClick={() => { void haptic.selection(); resumeAudioFollow() }}>
            <LocateFixed size={14} aria-hidden /><span>Follow</span>
          </button>
        )}
      </div>
    </>
  )
}
