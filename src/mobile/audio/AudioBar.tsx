import React, { useEffect, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, X, ChevronUp } from 'lucide-react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { getVoices, subscribeVoices, type TTSVoiceOption } from '@/lib/tts/ttsEngine'
import { useChapterProgress } from '@/hooks/useChapterProgress'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { Segmented, Toggle } from '../settings/SettingsPage'
import { ListSection, Row } from '../primitives/Page'
import { useIosAudioSession } from './useIosAudioSession'

/**
 * Read Aloud on the phone (Phase 16): a compact bar above the tab pill while playback exists
 * (play/pause, previous/next verse, current reference, progress, stop) and a full player sheet
 * (chapter progress with seek, rate, voice, auto-advance). Drives the same store actions
 * `useTTSPlayback` listens to, so the shared engine (Web Speech on iOS) does the speaking.
 */
export function AudioBar() {
  const playback = useAppStore((s) => s.audioPlayback)
  const togglePlayPause = useAppStore((s) => s.togglePlayPause)
  const stopPlayback = useAppStore((s) => s.stopPlayback)
  const skipVerse = useAppStore((s) => s.skipVerse)
  const sheets = useSheets()
  useIosAudioSession()
  if (!playback) return null
  const label = bookChapterVerseLabel(playback.bookId, playback.chapter, playback.verse)
  const openPlayer = () => sheets.open({ id: 'audio-player', title: 'Read Aloud', detents: [0.6, 0.92], render: () => <PlayerSheet /> })
  return (
    <div className="mobile-audio-bar" role="region" aria-label="Read Aloud">
      <button type="button" className="mobile-audio-ref" onClick={openPlayer} aria-label={`${label}. Open player`}>
        <ChevronUp size={16} aria-hidden /><span>{label}</span>{playback.finished && <span className="mobile-muted"> · finished</span>}
      </button>
      <button type="button" className="mobile-audio-btn" aria-label="Previous verse" onClick={() => { void haptic.selection(); skipVerse('prev') }}><SkipBack size={20} aria-hidden /></button>
      <button type="button" className="mobile-audio-btn is-primary" aria-label={playback.isPlaying && !playback.isPaused ? 'Pause' : 'Play'} onClick={() => { void haptic.light(); togglePlayPause() }}>
        {playback.isPlaying && !playback.isPaused ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden />}
      </button>
      <button type="button" className="mobile-audio-btn" aria-label="Next verse" onClick={() => { void haptic.selection(); skipVerse('next') }}><SkipForward size={20} aria-hidden /></button>
      <button type="button" className="mobile-audio-btn" aria-label="Stop" onClick={() => { void haptic.light(); stopPlayback() }}><X size={20} aria-hidden /></button>
    </div>
  )
}

function PlayerSheet() {
  const playback = useAppStore((s) => s.audioPlayback)
  const rate = useAppStore((s) => s.ttsRate)
  const setRate = useAppStore((s) => s.setTTSRate)
  const voiceURI = useAppStore((s) => s.ttsVoiceURI)
  const setVoice = useAppStore((s) => s.setTTSVoiceURI)
  const autoAdvance = useAppStore((s) => s.ttsAutoAdvanceEnabled)
  const setAutoAdvance = useAppStore((s) => s.setTTSAutoAdvanceEnabled)
  const seekToVerse = useAppStore((s) => s.seekToVerse)
  const [voices, setVoices] = useState<TTSVoiceOption[]>(() => getVoices())
  useEffect(() => subscribeVoices(setVoices), [])
  const { verses, currentIdx, fraction } = useChapterProgress(playback?.bookId ?? '', playback?.chapter ?? 0, playback?.textId ?? 'kjva', playback?.verse ?? 0, playback?.endVerse ?? null)
  if (!playback) return <div className="mobile-empty">Nothing is playing.</div>
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const shown = english.length ? english : voices
  return (
    <div className="mobile-audio-sheet">
      <div className="mobile-verse-actions-ref">{bookChapterVerseLabel(playback.bookId, playback.chapter, playback.verse)}</div>
      <div className="mobile-audio-progress" aria-label="Chapter progress">
        <div className="mobile-audio-progress-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <div className="mobile-muted" style={{ marginTop: 4 }}>{verses ? `Verse ${currentIdx + 1} of ${verses.length}` : ''}</div>
      {verses && (
        <div className="mobile-grid-numbers" style={{ marginTop: 8 }}>
          {verses.map((v) => (
            <button key={v.verse_num} type="button" className={`mobile-grid-cell${v.verse_num === playback.verse ? ' is-current' : ''}`} onClick={() => { void haptic.selection(); seekToVerse(v.verse_num) }}>{v.verse_num}</button>
          ))}
        </div>
      )}
      <div className="mobile-option-row"><span>Speed</span><Segmented value={String(rate)} options={[['0.8', '0.8×'], ['1', '1×'], ['1.2', '1.2×'], ['1.5', '1.5×']]} onChange={(v) => setRate(Number(v))} /></div>
      <div className="mobile-option-row"><span>Auto-advance to the next chapter</span><Toggle checked={autoAdvance} onChange={setAutoAdvance} label="Auto-advance" /></div>
      <ListSection title="Voice">
        <Row title="System default" right={voiceURI === null ? '✓' : undefined} onClick={() => setVoice(null)} />
        {shown.map((v) => <Row key={v.voiceURI} title={v.name} subtitle={`${v.lang}${v.tier ? ` · ${v.tier}` : ''}`} right={voiceURI === v.voiceURI ? '✓' : undefined} onClick={() => setVoice(v.voiceURI)} />)}
        {shown.length === 0 && <div className="mobile-empty">No voices reported yet — iOS lists them once speech has started.</div>}
      </ListSection>
      <p className="mobile-muted" style={{ padding: '8px 4px' }}>Voices come from iOS (Settings → Accessibility → Spoken Content → Voices to download more). The Mac's Kokoro neural voices are not available on the phone yet — see the feature matrix.</p>
    </div>
  )
}
