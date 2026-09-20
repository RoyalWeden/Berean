import { useEffect, useState } from 'react'
import { Volume2, Download, AudioLines, Sparkles, Trash2, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Switch, Button, IconButton, TextField, SectionLabel, Slider, Tooltip } from '@/components/ui'
import VoicePicker from '@/components/audio/VoicePicker'
import { getVoices, subscribeVoices, isTTSSupported, ttsEngine, type TTSVoiceOption } from '@/lib/tts/ttsEngine'
import { KOKORO_VOICE_OPTIONS, DEFAULT_KOKORO_VOICE_ID } from '@/lib/tts/kokoro/kokoroVoices'
import { useKokoroModelDownload } from '@/hooks/useKokoroModelDownload'

/** Settings → Audio (Read Aloud / TTS). Self-wired via useAppStore, no props — matches
 *  HistorySection.tsx's pattern for settings sections that don't need external state. */
export default function AudioSection() {
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

  const kokoroModelReady = useAppStore((s) => s.kokoroModelReady)
  const kokoroDownload = useKokoroModelDownload()
  const [audioCacheStats, setAudioCacheStats] = useState<{ entryCount: number; totalBytes: number; capBytes: number } | null>(null)
  const [clearingAudioCache, setClearingAudioCache] = useState(false)

  const [voices, setVoices] = useState<TTSVoiceOption[]>(getVoices())
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => subscribeVoices(setVoices), [])
  useEffect(() => {
    if (kokoroModelReady) window.ttsAudioCache?.stats().then(setAudioCacheStats).catch(() => {})
  }, [kokoroModelReady, kokoroDownload.ready])

  // Kokoro's catalog already carries real per-voice grades and excludes the two lowest-graded
  // voices outright (see kokoroVoiceData.ts), so every entry is worth offering — no quality
  // filtering needed. The old getGoodVoices/scanVoices pass existed to sort usable system voices
  // from the junk Chromium exposes, and went with the Web Speech backend.
  const englishVoices = KOKORO_VOICE_OPTIONS

  async function handleClearAudioCache() {
    setClearingAudioCache(true)
    try {
      await window.ttsAudioCache?.clear()
      setAudioCacheStats(await window.ttsAudioCache?.stats() ?? null)
    } finally {
      setClearingAudioCache(false)
    }
  }

  // Auto-plays Genesis 1:1 in the given voice — called whenever the picker's selection
  // changes (see the VoicePicker onChange below), not from a separate button anymore.
  // Routed through the active TTSBackend's previewVoice() (not a raw SpeechSynthesisUtterance
  // built here) so this works unchanged once a non-Web-Speech backend exists.
  async function previewVoice(voiceURI: string | null) {
    if (!isTTSSupported()) return
    setPreviewing(true)
    try {
      const verse = await window.bible.queryVerse('GEN', 1, 1, 'kjva')
      const text = verse?.text ?? 'In the beginning God created the heaven and the earth.'
      ttsEngine.previewVoice(text, voiceURI, ttsRate, () => setPreviewing(false))
    } catch {
      setPreviewing(false)
    }
  }

  function handleVoiceChange(voiceURI: string | null) {
    setTTSVoiceURI(voiceURI)
    previewVoice(voiceURI)
  }

  if (!isTTSSupported()) {
    return (
      <div className="text-caption text-text-muted">
        Text-to-speech is not available in this environment.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Volume2 size={14} className="text-text-muted" />
          <p className="text-subhead font-medium text-text-primary">Read Aloud</p>
        </div>
        <p className="s-desc text-caption text-text-muted">
          Listen to scripture read aloud with a local neural voice, the verse and word being
          spoken highlighted as it plays. Runs fully offline once the voice pack is downloaded.
        </p>
      </div>

      {/* Voice pack. Kokoro is now the ONLY engine (the Web Speech backend was removed — see
          ttsEngine.ts), so this download is a prerequisite for Read Aloud rather than an optional
          upgrade, and the copy says so. Still never a silent background fetch: it takes an
          explicit click (see useKokoroModelDownload.ts). */}
      <div>
        <SectionLabel className="mb-2">Voice Pack</SectionLabel>
        <p className="s-desc text-caption text-text-muted">
          Read Aloud uses a local neural voice model (~360MB, one-time download). It runs entirely
          on your machine — no account, no network once installed, no per-use cost.
        </p>

        {!kokoroModelReady && (
          <div className="mt-3 px-3 py-2.5 rounded-card bg-surface-elevated">
            {kokoroDownload.state.status === 'idle' || kokoroDownload.state.status === 'error' ? (
              <>
                {kokoroDownload.state.status === 'error' && (
                  <p className="text-caption text-destructive mb-2">Download failed: {kokoroDownload.state.error}</p>
                )}
                <Button variant="primary" size="sm" icon={Download} onClick={() => void kokoroDownload.startDownload()}>
                  Download neural voice model
                </Button>
              </>
            ) : kokoroDownload.state.status === 'verifying' ? (
              <p className="text-caption text-text-secondary">Verifying download…</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-caption text-text-secondary">
                    Downloading… {(kokoroDownload.state.receivedBytes / 1024 / 1024).toFixed(1)}MB
                    {kokoroDownload.state.totalBytes > 0 && ` / ~${(kokoroDownload.state.totalBytes / 1024 / 1024).toFixed(0)}MB`}
                  </p>
                  <IconButton icon={X} label="Cancel" size={20} onClick={kokoroDownload.cancelDownload} />
                </div>
                <div className="h-1.5 rounded-control bg-lift-2 overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{
                      width: kokoroDownload.state.totalBytes > 0
                        ? `${Math.min(100, (kokoroDownload.state.receivedBytes / kokoroDownload.state.totalBytes) * 100)}%`
                        : '5%',
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {kokoroModelReady && (
          <div className="mt-3 flex items-center justify-between text-caption text-text-muted">
            <span>
              Neural model ready.
              {audioCacheStats && audioCacheStats.entryCount > 0 && ` Audio cache: ${(audioCacheStats.totalBytes / 1024 / 1024).toFixed(0)}MB (${audioCacheStats.entryCount} clips).`}
            </span>
            <div className="flex items-center gap-3">
              {audioCacheStats && audioCacheStats.entryCount > 0 && (
                <Button variant="ghost" size="sm" icon={Trash2} onClick={handleClearAudioCache} disabled={clearingAudioCache}>
                  Clear audio cache
                </Button>
              )}
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => void kokoroDownload.clearModelCache()} className="hover:text-destructive">
                Remove model
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Voice picker — auto-previews Genesis 1:1 whenever the selection changes */}
      <div>
        <SectionLabel className="mb-2">Voice</SectionLabel>
        <div className="flex items-center gap-2">
          <VoicePicker voices={englishVoices} value={ttsVoiceURI} onChange={handleVoiceChange} />
          {previewing && (
            <Tooltip label="Playing Genesis 1:1 preview…">
              <span className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                <AudioLines size={15} className="text-accent animate-pulse" />
              </span>
            </Tooltip>
          )}
        </div>

      </div>

      {/* Speed */}
      <div>
        <SectionLabel className="mb-2">Speed</SectionLabel>
        <Slider
          min={0.25} max={3} step={0.25}
          value={ttsRate}
          onValueChange={setTTSRate}
          readout={`${ttsRate.toFixed(2)}x`}
          aria-label="Speed"
        />
        {ttsRate > 2 && (
          <p className="s-desc text-caption text-text-muted mt-1">
            Speeds above ~2x may sound distorted, depending on the voice.
          </p>
        )}
      </div>

      {/* Autoplay when player opens */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-subhead font-medium text-text-primary">Autoplay when player opens</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">
            When off, opening the Read Aloud player (from a "play" action while it's closed)
            loads it at the right spot but waits, paused, for you to press play — it doesn't
            start speaking right away. Doesn't affect resuming or advancing while it's already
            open.
          </p>
        </div>
        <Switch checked={ttsAutoplayOnOpen} onCheckedChange={() => setTTSAutoplayOnOpen(!ttsAutoplayOnOpen)} />
      </div>

      {/* Highlight words while speaking */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-subhead font-medium text-text-primary">Highlight words while speaking</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">
            Highlight the exact word being read, in addition to the current verse.
          </p>
        </div>
        <Switch checked={ttsHighlightWordsEnabled} onCheckedChange={() => setTTSHighlightWordsEnabled(!ttsHighlightWordsEnabled)} />
      </div>

      {/* Auto-advance */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-subhead font-medium text-text-primary">Auto-advance</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">
            Automatically continue to the next chapter (and next book) when a chapter finishes.
          </p>
        </div>
        <Switch checked={ttsAutoAdvanceEnabled} onCheckedChange={() => setTTSAutoAdvanceEnabled(!ttsAutoAdvanceEnabled)} />
      </div>
      {ttsAutoAdvanceEnabled && (
        <label className="flex items-center gap-2 text-caption text-text-secondary">
          Pause between chapters
          <TextField
            type="number" min={0} max={30} step={0.5}
            value={ttsAutoAdvancePauseSec}
            onChange={(e) => setTTSAutoAdvancePauseSec(parseFloat(e.target.value) || 0)}
            className="text-center"
            wrapperClassName="w-16"
          />
          seconds
        </label>
      )}
    </div>
  )
}
