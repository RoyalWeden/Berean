import React, { useEffect, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Timer, ListMusic, Square, LocateFixed, Eye, EyeOff, AudioLines, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { getVoices, subscribeVoices, type TTSVoiceOption } from '@/lib/tts/ttsEngine'
import { useChapterProgress } from '@/hooks/useChapterProgress'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { Toggle } from '../settings/SettingsControls'
import { ListSection, Row } from '../primitives/Page'
import { requestMore } from '../navigation/shellNav'
import { useAudioControlsHidden, setAudioControlsHidden, nextSpeed, speedLabel, verseProgressLabel } from './audioControls'
import { useSleepTimer, setSleepTimer, sleepStatusLabel, sleepPresetId, SLEEP_PRESETS } from './sleepTimer'
import { useAudioFollowPaused, resumeAudioFollow } from './followState'

/** Sheet id of the audio sheet (the floating controls check it). */
export const AUDIO_SHEET_ID = 'audio'

export function audioSheetOptions() {
  return { id: AUDIO_SHEET_ID, title: undefined, rootTitle: 'Read Aloud', detents: [0.6, 0.92], render: (api: SheetApi) => <AudioSheet api={api} /> }
}

/** Re-renders every second while a timed sleep timer counts down (the countdown lives only here). */
function useNowWhile(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function voiceName(voiceURI: string | null, voices: TTSVoiceOption[]): string {
  if (!voiceURI) return 'Default voice'
  return voices.find((v) => v.voiceURI === voiceURI)?.name ?? 'Default voice'
}

/**
 * The audio sheet (TEST25-AUDIO-003): what is being read and from which edition / voice, the
 * primary transport (previous / play-pause / next verse), a verse-based progress slider, and a
 * small secondary row — speed (left), Hide / Show Controls (centre), sleep timer (right) — with
 * Follow reading, Queue, Voice and Stop beneath. Everything drives the same store actions the
 * rest of Read Aloud uses, so useTTSPlayback / the lock screen stay in step.
 */
export function AudioSheet({ api }: { api: SheetApi }) {
  const playback = useAppStore((s) => s.audioPlayback)
  const togglePlayPause = useAppStore((s) => s.togglePlayPause)
  const skipVerse = useAppStore((s) => s.skipVerse)
  const seekToVerse = useAppStore((s) => s.seekToVerse)
  const stopPlayback = useAppStore((s) => s.stopPlayback)
  const rate = useAppStore((s) => s.ttsRate)
  const setRate = useAppStore((s) => s.setTTSRate)
  const voiceURI = useAppStore((s) => s.ttsVoiceURI)
  const hidden = useAudioControlsHidden()
  const followPaused = useAudioFollowPaused()
  const sleep = useSleepTimer()
  const now = useNowWhile(sleep.mode === 'time')
  const [voices, setVoices] = useState<TTSVoiceOption[]>(() => getVoices())
  useEffect(() => subscribeVoices(setVoices), [])
  const { verses, currentIdx } = useChapterProgress(playback?.bookId ?? '', playback?.chapter ?? 0, playback?.textId ?? 'kjva', playback?.verse ?? 0, playback?.endVerse ?? null)
  const [draft, setDraft] = useState<number | null>(null)
  if (!playback) return <div className="mobile-empty">Nothing is playing.</div>

  const playing = playback.isPlaying && !playback.isPaused
  const title = bookChapterVerseLabel(playback.bookId, playback.chapter)
  const source = `${playback.textId.toUpperCase()} · ${voiceName(voiceURI, voices)}`
  const idx = draft ?? currentIdx
  const shownVerse = verses?.[idx]?.verse_num ?? playback.verse
  const progress = verseProgressLabel(shownVerse, verses?.length ? verses[verses.length - 1].verse_num : null)
  const commitSeek = () => {
    if (draft == null || !verses) return
    const v = verses[draft]?.verse_num
    setDraft(null)
    if (v != null && v !== playback.verse) { void haptic.selection(); seekToVerse(v) }
  }
  const sleepLabel = sleepStatusLabel(sleep, now)

  return (
    <div className="m-audio-sheet">
      <div className="m-audio-sheet-head">
        <div className="m-audio-sheet-title" aria-live="polite">{title}</div>
        <div className="m-audio-sheet-source">{source}{playback.finished ? ' · Finished' : ''}</div>
      </div>

      <div className="m-audio-progress">
        <input
          type="range" className="m-audio-slider" min={0} max={Math.max(0, (verses?.length ?? 1) - 1)} step={1}
          value={idx} disabled={!verses || verses.length < 2}
          aria-label="Position in chapter" aria-valuetext={`Verse ${shownVerse}${progress.total ? ` ${progress.total}` : ''}`}
          style={{ '--m-audio-fill': `${verses && verses.length > 1 ? (idx / (verses.length - 1)) * 100 : 0}%` } as React.CSSProperties}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commitSeek} onTouchEnd={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek}
        />
        <div className="m-audio-times" aria-hidden>
          <span>{progress.elapsed}</span><span>{progress.total}</span>
        </div>
      </div>

      <div className="m-audio-transport">
        <button type="button" className="m-audio-transport-btn" aria-label="Previous verse" onClick={() => { void haptic.selection(); skipVerse('prev') }}><SkipBack size={30} fill="currentColor" aria-hidden /></button>
        <button type="button" className="m-audio-transport-btn is-primary" aria-label={playing ? 'Pause reading' : 'Play reading'} onClick={() => { void haptic.light(); togglePlayPause() }}>
          {playing ? <Pause size={34} fill="currentColor" aria-hidden /> : <Play size={34} fill="currentColor" aria-hidden className="m-audio-play-glyph" />}
        </button>
        <button type="button" className="m-audio-transport-btn" aria-label="Next verse" onClick={() => { void haptic.selection(); skipVerse('next') }}><SkipForward size={30} fill="currentColor" aria-hidden /></button>
      </div>

      <div className="m-audio-secondary">
        <button type="button" className="m-audio-chip" aria-label={`Reading speed ${speedLabel(rate)}. Change speed`} onClick={() => { void haptic.selection(); setRate(nextSpeed(rate)) }}>{speedLabel(rate)}</button>
        <button type="button" className="m-audio-chip" onClick={() => { void haptic.selection(); setAudioControlsHidden(!hidden) }}>
          {hidden ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}{hidden ? 'Show Controls' : 'Hide Controls'}
        </button>
        <button
          type="button" className={`m-audio-chip${sleep.mode !== 'off' ? ' is-on' : ''}`}
          aria-label={sleepLabel ? `Sleep timer, ${sleepLabel}` : 'Sleep timer, off'}
          onClick={() => api.push({ key: 'sleep', title: 'Sleep Timer', render: () => <SleepTimerView /> })}
        >
          <Timer size={16} aria-hidden />{sleepLabel && <span className="m-audio-countdown">{sleepLabel}</span>}
        </button>
      </div>

      <div className="m-audio-tertiary">
        <button type="button" className={`m-audio-link${followPaused ? ' is-attention' : ''}`} onClick={() => { void haptic.selection(); resumeAudioFollow() }} aria-label={followPaused ? 'Follow reading (paused because you scrolled)' : 'Show the verse being read'}>
          <LocateFixed size={16} aria-hidden />Follow reading
        </button>
        <button type="button" className="m-audio-link" onClick={() => { api.close(); requestMore('queue') }}><ListMusic size={16} aria-hidden />Queue</button>
        <button type="button" className="m-audio-link" onClick={() => api.push({ key: 'voice', title: 'Voice', render: () => <VoiceView /> })}><AudioLines size={16} aria-hidden />Voice</button>
        <button type="button" className="m-audio-link is-destructive" onClick={() => { void haptic.light(); api.close(); stopPlayback() }}><Square size={14} fill="currentColor" aria-hidden />Stop</button>
      </div>
    </div>
  )
}

function SleepTimerView() {
  const sleep = useSleepTimer()
  const now = useNowWhile(sleep.mode === 'time')
  const selected = sleepPresetId(sleep)
  const status = sleepStatusLabel(sleep, now)
  return (
    <div className="m-audio-subview">
      {status && <div className="m-audio-sleep-status" aria-live="off">{sleep.mode === 'time' ? `Pausing in ${status}` : `Pausing at the ${status.toLowerCase()}`}</div>}
      <ListSection>
        {SLEEP_PRESETS.map((p) => (
          <Row key={p.id} title={p.label} right={selected === p.id ? <Check size={18} aria-label="Selected" /> : undefined} onClick={() => { void haptic.selection(); setSleepTimer(p.preset) }} />
        ))}
      </ListSection>
    </div>
  )
}

function VoiceView() {
  const voiceURI = useAppStore((s) => s.ttsVoiceURI)
  const setVoice = useAppStore((s) => s.setTTSVoiceURI)
  const autoAdvance = useAppStore((s) => s.ttsAutoAdvanceEnabled)
  const setAutoAdvance = useAppStore((s) => s.setTTSAutoAdvanceEnabled)
  const [voices, setVoices] = useState<TTSVoiceOption[]>(() => getVoices())
  useEffect(() => subscribeVoices(setVoices), [])
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const shown = english.length ? english : voices
  return (
    <div className="m-audio-subview">
      <div className="mobile-option-row"><span>Auto-advance to the next chapter</span><Toggle checked={autoAdvance} onChange={setAutoAdvance} label="Auto-advance" /></div>
      <ListSection title="Voice">
        <Row title="System default" right={voiceURI === null ? <Check size={18} aria-label="Selected" /> : undefined} onClick={() => setVoice(null)} />
        {shown.map((v) => <Row key={v.voiceURI} title={v.name} subtitle={`${v.lang}${v.tier ? ` · ${v.tier}` : ''}`} right={voiceURI === v.voiceURI ? <Check size={18} aria-label="Selected" /> : undefined} onClick={() => setVoice(v.voiceURI)} />)}
        {shown.length === 0 && <div className="mobile-empty">No voices reported yet — iOS lists them once speech has started.</div>}
      </ListSection>
      <p className="mobile-muted m-audio-footnote">Voices come from iOS (Settings → Accessibility → Spoken Content → Voices to download more). The Mac's Kokoro neural voices are not available on the phone yet — see the feature matrix.</p>
    </div>
  )
}
