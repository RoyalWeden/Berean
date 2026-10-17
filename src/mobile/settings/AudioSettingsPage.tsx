import React, { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useAppStore } from '@/store'
import { getVoices, subscribeVoices, ttsEngine, type TTSVoiceOption } from '@/lib/tts/ttsEngine'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { Toggle, RateStepper } from './SettingsControls'
import { GetVoicesView, useVoicePack, voicePackSubtitle } from '../audio/GetVoicesView'
import { DEFAULT_KOKORO_VOICE_ID } from '@/lib/tts/kokoro/kokoroVoices'
import './settings.css'

/**
 * Settings → Audio / Read Aloud (R087). A phone-native page over the same backend-agnostic
 * facade (`ttsEngine`/`getVoices`/`subscribeVoices` from lib/tts/ttsEngine.ts) desktop uses.
 * Read Aloud speaks with the iPhone's system voice until Berean Voices (the Mac's Kokoro voices)
 * are downloaded from Berean Voices (GetVoicesView, src/platform/ios/voicePack.ts); then the
 * Kokoro engine takes over and the voice list is Berean's. No pitch control: the shared
 * TTSBackend contract has no pitch parameter on either platform.
 */
/** The voice list of the active engine, plus which entry is speaking now. With Berean Voices a
 *  stored choice that isn't one of them (a system voice picked earlier) reads in the default
 *  Berean voice (kokoroBackend.ts), so it shows as that one. */
export function useActiveVoice() {
  const ttsVoiceURI = useAppStore((s) => s.ttsVoiceURI)
  const berean = useAppStore((s) => s.kokoroModelReady)
  const [voices, setVoices] = useState<TTSVoiceOption[]>(getVoices())
  useEffect(() => subscribeVoices(setVoices), [])
  useEffect(() => setVoices(getVoices()), [berean])
  const selectable = voices.filter((v) => v.kind !== 'hint')
  const bereanList = selectable.some((v) => v.voiceURI === DEFAULT_KOKORO_VOICE_ID)
  const found = ttsVoiceURI ? selectable.find((v) => v.voiceURI === ttsVoiceURI) : undefined
  const active = found ?? (bereanList ? selectable.find((v) => v.voiceURI === DEFAULT_KOKORO_VOICE_ID) : undefined)
  return { selectable, active, bereanList, ttsVoiceURI }
}

export const voiceLabel = (v: TTSVoiceOption | undefined) => (v ? `${v.name}${v.tier ? ` (${v.tier})` : ''}` : 'System default')

/**
 * The Settings root's Read Aloud rows: the current voice and Berean Voices — so the way to the
 * natural voices is on the first Settings screen, not two pages down.
 */
export function ReadAloudVoiceRows({ openVoices, openReadAloud }: { openVoices: () => void; openReadAloud: () => void }) {
  const { active } = useActiveVoice()
  const pack = useVoicePack()
  return (
    <>
      <Row title="Read Aloud" subtitle={`Voice: ${voiceLabel(active)} · speed, auto-advance`} chevron onClick={openReadAloud} />
      <Row title="Berean Voices" subtitle={voicePackSubtitle(pack)} chevron onClick={openVoices} />
    </>
  )
}

/** Live (a pushed page is a snapshot, so the row reads the download state itself). */
function BereanVoicesRow({ onClick }: { onClick: () => void }) {
  const pack = useVoicePack()
  return <Row title="Berean Voices" subtitle={voicePackSubtitle(pack)} chevron onClick={onClick} />
}

/** Settings → Read Aloud → Voice: live (reads the store and the voice list itself). */
function VoiceListPage({ onBack, preview, getVoicesRow }: { onBack: () => void; preview: (uri: string | null) => void; getVoicesRow: React.ReactNode }) {
  const setTTSVoiceURI = useAppStore((s) => s.setTTSVoiceURI)
  const { selectable, active, bereanList, ttsVoiceURI } = useActiveVoice()
  const pick = (uri: string | null) => { setTTSVoiceURI(uri); preview(uri) }
  return (
    <Page title="Voice" onBack={onBack}>
      <ListSection>{getVoicesRow}</ListSection>
      <ListSection title={bereanList ? 'Berean Voices' : 'iPhone voices'}>
        {!bereanList && <Row title="System default" subtitle="The voice iOS uses for speech" right={ttsVoiceURI == null ? <Check size={18} aria-label="Selected" /> : undefined} onClick={() => pick(null)} />}
        {selectable.map((v) => (
          <Row
            key={v.voiceURI}
            title={<>{v.name}{v.tier && <span className="settings-voice-tier">{v.tier}</span>}</>}
            subtitle={v.lang}
            right={v.voiceURI === active?.voiceURI ? <Check size={18} aria-label="Selected" /> : undefined}
            onClick={() => pick(v.voiceURI)}
          />
        ))}
      </ListSection>
    </Page>
  )
}

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

  const [previewing, setPreviewing] = useState(false)
  const { active: activeVoice } = useActiveVoice()

  const preview = (voiceURI: string | null) => {
    setPreviewing(true)
    window.bible.queryVerse('GEN', 1, 1, 'kjva').then((verse) => {
      const text = verse?.text ?? 'In the beginning God created the heaven and the earth.'
      ttsEngine.previewVoice(text, voiceURI, ttsRate, () => setPreviewing(false))
    }).catch(() => setPreviewing(false))
  }

  const openGetVoices = () => nav.push('settings-tts-get-voices', <Page title="Berean Voices" onBack={nav.pop}><GetVoicesView /></Page>)
  const getVoicesRow = <BereanVoicesRow onClick={openGetVoices} />

  return (
    <Page title="Read Aloud" onBack={onBack}>
      <ListSection title="Voice">
        <Row
          title="Voice"
          subtitle={voiceLabel(activeVoice)}
          chevron
          // A component, not an element built here: a pushed element is a snapshot, so the
          // checkmark never moved when another voice was picked (TEST 2026-10-11).
          onClick={() => nav.push('settings-tts-voice', <VoiceListPage onBack={nav.pop} preview={preview} getVoicesRow={getVoicesRow} />)}
        />
        {getVoicesRow}
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
