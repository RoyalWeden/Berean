/**
 * Read Aloud (TTS) — public facade over the active `TTSBackend` (see ttsBackend.ts for the
 * contract, kokoro/kokoroBackend.ts for the implementation).
 *
 * `useTTSPlayback.ts` and `store/index.ts` import `ttsEngine` from HERE, not from a concrete
 * backend module, and call the same methods regardless of what sits behind it.
 *
 * ── Kokoro is now the ONLY engine ────────────────────────────────────────────
 * The Web Speech (system voices) backend has been removed outright, at Michael's request, on the
 * grounds that the neural voices are simply better and maintaining a second engine meant every
 * feature had to work twice. Concretely, keeping it was costing:
 *   - two voice-id namespaces that don't overlap, so switching engines had to reset the user's
 *     voice selection;
 *   - two highlight paths — Kokoro has real per-chunk audio timings, Web Speech only had
 *     Chromium's `onboundary` charIndex with a nearest-word fallback that was never exact;
 *   - a pile of Web-Speech-only workarounds (a 12s utterance watchdog, pause-during-inter-chunk-
 *     gap bookkeeping, restart-on-rate-change, and a ~24-word chunk cap that existed purely to
 *     dodge a Chromium cutoff bug and actively HURT a neural model's sentence prosody).
 * All of that is gone with the backend.
 *
 * The tradeoff, stated plainly: Read Aloud now requires the one-time voice-pack download. Until
 * it's downloaded there is no speech at all, where previously system voices worked immediately.
 * `isTTSSupported()` reflects whether the ENVIRONMENT can run Kokoro at all (Worker + AudioContext
 * — true in effectively every real build), not whether the pack happens to be downloaded yet;
 * AudioSection.tsx uses `kokoroModelReady` separately to decide whether to show the download
 * prompt or the player. Conflating the two here previously meant every fresh install (an empty
 * `userData`, since activation only happens once a pack is ready) showed "not available in this
 * environment" instead of the download prompt.
 *
 * `setActiveTTSBackend` is kept (and still tested) — the seam is what made swapping the engine a
 * contained change in the first place, and it costs nothing to keep for the next one.
 */
import type { TTSBackend, TTSVoiceOption, TTSVoiceProvider, SpeakChapterOptions } from './ttsBackend'
import { KOKORO_VOICE_OPTIONS } from './kokoro/kokoroVoices'

export type { TTSBackend, TTSVoiceOption, TTSVoiceProvider, SpeakChapterOptions }

/** Stand-in used before the real Kokoro backend has been activated (i.e. before the voice pack is
 *  downloaded, or on the very first render). Every method is a no-op rather than a throw:
 *  playback controls are reachable from several surfaces (ChapterView, the audio bar, keyboard
 *  shortcuts), and a missing model should mean "nothing happens", never a crash. Its voice list is
 *  still the real Kokoro catalog so Settings can show and preselect a voice before downloading. */
const inertBackend: TTSBackend = {
  speakChapter: () => {},
  pause: () => {},
  resume: () => {},
  stop: () => {},
  skipToVerse: () => {},
  setRate: () => {},
  setVoice: () => {},
  previewVoice: (_text, _voiceURI, _rate, onEnd) => { onEnd?.() },
  isActive: false,
  isPaused: false,
  activeIndex: -1,
}

const inertVoiceProvider: TTSVoiceProvider = {
  getVoices: () => KOKORO_VOICE_OPTIONS,
  subscribeVoices: () => () => {},
  // Before the voice pack is downloaded (i.e. before activateKokoroBackend() ever runs), this is
  // the ONLY voice provider AudioSection.tsx ever sees — so it has to answer the real question
  // ("can this environment run Kokoro at all?"), not "has Kokoro been activated yet". Hardcoding
  // `false` here made every fresh install (prod's userData starts empty, unlike a dev profile
  // that already has a pack downloaded) permanently show "not available in this environment"
  // instead of the download prompt, since activation itself only happens once a pack is ready —
  // the one state this provider is active for. Mirrors kokoroVoiceProvider.isSupported() exactly
  // so swapping providers on activation never flips the answer.
  isSupported: () => typeof Worker !== 'undefined' && typeof AudioContext !== 'undefined',
}

let activeBackend: TTSBackend = inertBackend
let activeVoiceProvider: TTSVoiceProvider = inertVoiceProvider

// Created lazily on first activation: importing kokoroBackend.ts pulls in kokoro.worker.ts's
// module graph, and there's no reason to pay that at app start for a user who never plays audio.
// Constructing it is cheap on its own — no model load happens until the first synthesis call.
let kokoroBackendSingleton: TTSBackend | null = null
export async function activateKokoroBackend(): Promise<void> {
  const { KokoroBackend, kokoroVoiceProvider } = await import('./kokoro/kokoroBackend')
  if (!kokoroBackendSingleton) kokoroBackendSingleton = new KokoroBackend()
  setActiveTTSBackend(kokoroBackendSingleton, kokoroVoiceProvider)
}

/** Swaps which backend `ttsEngine` delegates to. */
export function setActiveTTSBackend(backend: TTSBackend, voiceProvider: TTSVoiceProvider) {
  activeBackend = backend
  activeVoiceProvider = voiceProvider
}

export function getActiveTTSBackend(): TTSBackend {
  return activeBackend
}

/** Stable object identity so `import { ttsEngine }` call sites never need to re-import after a
 *  backend swap — every method forwards to whatever `activeBackend` is at call time. */
export const ttsEngine: TTSBackend = {
  speakChapter: (queue, opts) => activeBackend.speakChapter(queue, opts),
  pause: () => activeBackend.pause(),
  resume: () => activeBackend.resume(),
  stop: () => activeBackend.stop(),
  skipToVerse: (verseIndex) => activeBackend.skipToVerse(verseIndex),
  setRate: (rate) => activeBackend.setRate(rate),
  setVoice: (voiceURI) => activeBackend.setVoice(voiceURI),
  previewVoice: (text, voiceURI, rate, onEnd) => activeBackend.previewVoice(text, voiceURI, rate, onEnd),
  get isActive() { return activeBackend.isActive },
  get isPaused() { return activeBackend.isPaused },
  get activeIndex() { return activeBackend.activeIndex },
}

export function getVoices(): TTSVoiceOption[] {
  return activeVoiceProvider.getVoices()
}

export function subscribeVoices(cb: (voices: TTSVoiceOption[]) => void): () => void {
  return activeVoiceProvider.subscribeVoices(cb)
}

/** "Can this environment run Kokoro at all" (Worker + AudioContext) — true whether or not the
 *  voice pack has been downloaded yet. See `kokoroModelReady` in the store for "is it ready to
 *  actually speak right now". */
export function isTTSSupported(): boolean {
  return activeVoiceProvider.isSupported()
}
