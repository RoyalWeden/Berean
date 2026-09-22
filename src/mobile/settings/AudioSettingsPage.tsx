import React, { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { getVoices, subscribeVoices, ttsEngine, type TTSVoiceOption } from '@/lib/tts/ttsEngine'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { Toggle, RateStepper } from './SettingsControls'
import './settings.css'

/**
 * Settings → Audio / Read Aloud (R087). Desktop's AudioSection.tsx is Kokoro-specific (voice
 * pack download via `window.ttsModel`, cache stats via `window.ttsAudioCache`) — neither exists
 * on the phone (src/platform/ios/bridge.ts deliberately omits them; the phone's TTSBackend is
 * `NativeSpeechBackend` over iOS's own system speech synthesiser, swapped in at boot in
 * platform/ios/main.tsx). So this is a phone-native page rather than an embed of AudioSection,
 * built on the same backend-agnostic facade (`ttsEngine`/`getVoices`/`subscribeVoices` from
 * lib/tts/ttsEngine.ts) desktop uses — the voice list, rate, and playback controls are real,
 * live iOS voices, not a stub. No voice-pack download step applies (nothing to download; the
 * system voices are already on the device). No pitch control: the shared TTSBackend contract
 * (speakChapter/setRate/setVoice) has no pitch parameter on either platform.
 */
export function AudioSettingsPage({ onBack }: { onBack?: () => void }) {
  const nav = useNavigation()
  const ttsVoiceURI = useAppStore((s) => s.ttsVoiceURI)
  const setTTSVoiceURI = useAppStore((s) => s.setTTSVoiceURI)
  const ttsRate = useAppStore((s) => s.ttsRate)
  const setTTSRate = useAppStore((s) => s.setTTSRate)
  const ttsHighlightWordsEnabled = useAppStore((s) => s.ttsHighlightWordsEnabled)
  const setTTSHighlightWordsEnabled = useAppStore((s) => s.setTTSHighlightWordsEnabled)
  const ttsAutoAdvanceEnabled = useAppStore((s) => s.ttsAutoAdvanceEnabled)
  const setTTSAutoAdvanceEnabled = useAppStore((s) => s.setTTSAutoAdvanceEnabled)
  const ttsAutoAdvancePauseSec = useAppStore((s) => s.ttsAutoAdvancePauseSec)
  const setTTSAutoAdvancePauseSec = useAppStore((s) => s.setTTSAutoAdvancePauseSec)
  const ttsAutoplayOnOpen = useAppStore((s) => s.ttsAutoplayOnOpen)
  const setTTSAutoplayOnOpen = useAppStore((s) => s.setTTSAutoplayOnOpen)

  const [voices, setVoices] = useState<TTSVoiceOption[]>(getVoices())
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => subscribeVoices(setVoices), [])

  const activeVoice = voices.find((v) => v.voiceURI === ttsVoiceURI) ?? voices[0]

  const preview = (voiceURI: string | null) => {
    setPreviewing(true)
    window.bible.queryVerse('GEN', 1, 1, 'kjva').then((verse) => {
      const text = verse?.text ?? 'In the beginning God created the heaven and the earth.'
      ttsEngine.previewVoice(text, voiceURI, ttsRate, () => setPreviewing(false))
    }).catch(() => setPreviewing(false))
  }

  return (
    <Page title="Read Aloud" onBack={onBack}>
      <ListSection title="Voice">
        <Row
          title="Voice"
          subtitle={activeVoice ? `${activeVoice.name}${activeVoice.tier ? ` · ${activeVoice.tier}` : ''}` : 'System default'}
          chevron
          onClick={() => nav.push('settings-tts-voice', (
            <Page title="Voice" onBack={nav.pop}>
              <ListSection>
                {voices.length === 0 && <Row title="No voices found" subtitle="Add voices in iOS Settings → Accessibility → Spoken Content → Voices" />}
                {voices.map((v) => (
                  <Row
                    key={v.voiceURI}
                    title={<>{v.name}{v.tier && <span className="settings-voice-tier">{v.tier}</span>}</>}
                    subtitle={v.lang}
                    right={v.voiceURI === ttsVoiceURI ? '✓' : undefined}
                    onClick={() => { setTTSVoiceURI(v.voiceURI); preview(v.voiceURI) }}
                  />
                ))}
              </ListSection>
            </Page>
          ))}
        />
        {previewing && <div className="settings-section-note">Playing Genesis 1:1 preview…</div>}
      </ListSection>

      <ListSection title="Speed">
        <div className="mobile-embedded-section">
          <RateStepper value={ttsRate} min={0.25} max={3} step={0.25} format={(v) => `${v.toFixed(2)}x`} onChange={setTTSRate} />
        </div>
      </ListSection>

      <ListSection>
        <Row title="Autoplay when player opens" subtitle="Off waits, paused, for you to press play" right={<Toggle checked={ttsAutoplayOnOpen} onChange={setTTSAutoplayOnOpen} label="Autoplay when player opens" />} />
        <Row title="Highlight words while speaking" subtitle="Highlight the exact word being read" right={<Toggle checked={ttsHighlightWordsEnabled} onChange={setTTSHighlightWordsEnabled} label="Highlight words while speaking" />} />
        <Row title="Auto-advance" subtitle="Continue to the next chapter when one finishes" right={<Toggle checked={ttsAutoAdvanceEnabled} onChange={setTTSAutoAdvanceEnabled} label="Auto-advance" />} />
      </ListSection>
      {ttsAutoAdvanceEnabled && (
        <ListSection title="Pause between chapters">
          <div className="mobile-embedded-section">
            <RateStepper value={ttsAutoAdvancePauseSec} min={0} max={30} step={0.5} format={(v) => `${v}s`} onChange={setTTSAutoAdvancePauseSec} />
          </div>
        </ListSection>
      )}
    </Page>
  )
}
