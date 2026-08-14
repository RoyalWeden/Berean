/**
 * Read Aloud (TTS) — backend-agnostic contract shared by every synthesis engine Berean can
 * drive (today: Web Speech; a future neural engine such as Kokoro can be added later without
 * touching any consumer of `ttsEngine` in useTTSPlayback.ts/store/index.ts/AudioSection.tsx).
 *
 * This file intentionally has ZERO dependency on `window.speechSynthesis` — it's the seam that
 * lets a non-Web-Speech backend exist at all. `ttsEngine.ts` owns the swappable singleton and
 * the Web-Speech-specific default; `webSpeechBackend.ts` is the first (and, for now, only)
 * concrete implementation.
 */
import type { SpokenVerse, SpokenWord } from './extractSpokenText'

/**
 * A voice offered by SOME backend, abstracted away from `SpeechSynthesisVoice` so a future
 * non-Web-Speech backend (e.g. a Kokoro voice, which has no `SpeechSynthesisVoice` at all) can
 * be represented in the exact same picker/settings UI. `voiceURI` doubles as the opaque id
 * `SpeakChapterOptions.voiceURI` / `setVoice()` take — for the Web Speech backend it IS the
 * underlying `SpeechSynthesisVoice.voiceURI`; other backends just need something stable and
 * unique within their own voice list.
 */
export interface TTSVoiceOption {
  voiceURI: string
  name: string
  lang: string
  /** Quality tier, when a backend can express one (Web Speech: parsed from name/voiceURI —
   *  see voiceQuality.ts. Backends with no tier concept of their own return null.) */
  tier?: 'Premium' | 'Enhanced' | null
}

export interface SpeakChapterOptions {
  startVerseIndex?: number
  rate: number
  voiceURI: string | null
  onVerseStart?: (verseIndex: number, verse: SpokenVerse) => void
  onWordBoundary?: (verseIndex: number, word: SpokenWord) => void
  onChapterEnd?: () => void
  onError?: (error: unknown) => void
}

/**
 * Public surface every TTS backend must implement. Deliberately the exact method/getter set
 * `useTTSPlayback.ts` and `store/index.ts` already call on the old `TTSEngine` class — this
 * interface was extracted FROM that class's existing surface, not designed up front, so
 * swapping backends needs no changes at either call site.
 */
export interface TTSBackend {
  speakChapter(queue: SpokenVerse[], opts: SpeakChapterOptions): void
  pause(): void
  resume(): void
  stop(): void
  skipToVerse(verseIndex: number): void
  setRate(rate: number): void
  setVoice(voiceURI: string | null): void
  /** Plays a short one-off sample (Settings → Audio's voice preview) without disturbing any
   *  chapter playback already in progress. Each backend implements this with whatever it has
   *  available (Web Speech: a throwaway utterance; a future buffer-based backend: a generated
   *  clip) — callers never construct synthesis primitives themselves. `onEnd` fires once
   *  (success or failure) so the caller can drop a "previewing…" UI state; it is NOT told which. */
  previewVoice(text: string, voiceURI: string | null, rate: number, onEnd?: () => void): void
  readonly isActive: boolean
  readonly isPaused: boolean
  readonly activeIndex: number
}

/** Voice discovery is a separate, smaller contract from playback — a backend can be listed and
 *  previewed before it's ever asked to speak a chapter. */
export interface TTSVoiceProvider {
  getVoices(): TTSVoiceOption[]
  subscribeVoices(cb: (voices: TTSVoiceOption[]) => void): () => void
  isSupported(): boolean
}
