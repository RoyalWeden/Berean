import { useEffect, useState } from 'react'
import { Volume2, Download, AudioLines, Sparkles, Trash2, X } from 'lucide-react'
import { useAppStore } from '@/store'
import Switch from '@/components/shell/Switch'
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
      <div className="text-sm text-[rgb(var(--color-text-muted))]">
        Text-to-speech is not available in this environment.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Volume2 size={14} className="text-[rgb(var(--color-text-muted))]" />
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Read Aloud</p>
        </div>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          Listen to scripture read aloud with a local neural voice, the verse and word being
          spoken highlighted as it plays. Runs fully offline once the voice pack is downloaded.
        </p>
      </div>

      {/* Voice pack. Kokoro is now the ONLY engine (the Web Speech backend was removed — see
          ttsEngine.ts), so this download is a prerequisite for Read Aloud rather than an optional
          upgrade, and the copy says so. Still never a silent background fetch: it takes an
          explicit click (see useKokoroModelDownload.ts). */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-2">Voice Pack</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          Read Aloud uses a local neural voice model (~360MB, one-time download). It runs entirely
          on your machine — no account, no network once installed, no per-use cost.
        </p>

        {!kokoroModelReady && (
          <div className="mt-3 px-3 py-2.5 rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]">
            {kokoroDownload.state.status === 'idle' || kokoroDownload.state.status === 'error' ? (
              <>
                {kokoroDownload.state.status === 'error' && (
                  <p className="text-xs text-red-500 mb-2">Download failed: {kokoroDownload.state.error}</p>
                )}
                <button
                  onClick={() => void kokoroDownload.startDownload()}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-[rgb(var(--color-accent))] text-white cursor-pointer"
                >
                  <Download size={12} /> Download neural voice model
                </button>
              </>
            ) : kokoroDownload.state.status === 'verifying' ? (
              <p className="text-xs text-[rgb(var(--color-text-secondary))]">Verifying download…</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-[rgb(var(--color-text-secondary))]">
                    Downloading… {(kokoroDownload.state.receivedBytes / 1024 / 1024).toFixed(1)}MB
                    {kokoroDownload.state.totalBytes > 0 && ` / ~${(kokoroDownload.state.totalBytes / 1024 / 1024).toFixed(0)}MB`}
                  </p>
                  <button onClick={kokoroDownload.cancelDownload} title="Cancel" className="cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]">
                    <X size={13} />
                  </button>
                </div>
                <div className="h-1.5 rounded-full bg-[rgb(var(--color-surface-3))] overflow-hidden">
                  <div
                    className="h-full bg-[rgb(var(--color-accent))] transition-[width]"
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
          <div className="mt-3 flex items-center justify-between text-xs text-[rgb(var(--color-text-muted))]">
            <span>
              Neural model ready.
              {audioCacheStats && audioCacheStats.entryCount > 0 && ` Audio cache: ${(audioCacheStats.totalBytes / 1024 / 1024).toFixed(0)}MB (${audioCacheStats.entryCount} clips).`}
            </span>
            <div className="flex items-center gap-3">
              {audioCacheStats && audioCacheStats.entryCount > 0 && (
                <button onClick={handleClearAudioCache} disabled={clearingAudioCache} className="cursor-pointer hover:text-[rgb(var(--color-text-primary))] flex items-center gap-1 disabled:opacity-50">
                  <Trash2 size={11} /> Clear audio cache
                </button>
              )}
              <button onClick={() => void kokoroDownload.clearModelCache()} className="cursor-pointer hover:text-red-500 flex items-center gap-1">
                <Trash2 size={11} /> Remove model
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Voice picker — auto-previews Genesis 1:1 whenever the selection changes */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-2">Voice</p>
        <div className="flex items-center gap-2">
          <VoicePicker voices={englishVoices} value={ttsVoiceURI} onChange={handleVoiceChange} />
          {previewing && (
            <span title="Playing Genesis 1:1 preview…" className="flex items-center justify-center w-8 h-8 flex-shrink-0">
              <AudioLines size={15} className="text-[rgb(var(--color-accent))] animate-pulse" />
            </span>
          )}
        </div>

      </div>

      {/* Speed */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-2">Speed</p>
        <div className="flex items-center gap-3">
          <input
            type="range" min={0.25} max={3} step={0.25}
            value={ttsRate}
            onChange={(e) => setTTSRate(parseFloat(e.target.value))}
            className="flex-1 accent-[rgb(var(--color-accent))]"
          />
          <span className="text-xs text-[rgb(var(--color-text-secondary))] w-10 text-right">{ttsRate.toFixed(2)}x</span>
        </div>
        {ttsRate > 2 && (
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-1">
            Speeds above ~2x may sound distorted, depending on the voice.
          </p>
        )}
      </div>

      {/* Highlight words while speaking */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Highlight words while speaking</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Highlight the exact word being read, in addition to the current verse.
          </p>
        </div>
        <Switch checked={ttsHighlightWordsEnabled} onCheckedChange={() => setTTSHighlightWordsEnabled(!ttsHighlightWordsEnabled)} />
      </div>

      {/* Auto-advance */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Auto-advance</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Automatically continue to the next chapter (and next book) when a chapter finishes.
          </p>
        </div>
        <Switch checked={ttsAutoAdvanceEnabled} onCheckedChange={() => setTTSAutoAdvanceEnabled(!ttsAutoAdvanceEnabled)} />
      </div>
      {ttsAutoAdvanceEnabled && (
        <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-secondary))]">
          Pause between chapters
          <input
            type="number" min={0} max={30} step={0.5}
            value={ttsAutoAdvancePauseSec}
            onChange={(e) => setTTSAutoAdvancePauseSec(parseFloat(e.target.value) || 0)}
            className="w-16 text-center px-2 py-1 rounded bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs outline-none"
          />
          seconds
        </label>
      )}
    </div>
  )
}
