/**
 * Read Aloud (TTS) — the Kokoro neural `TTSBackend`. Unlike webSpeechBackend.ts, this backend
 * gets REAL audio data back from synthesis, so playback is driven by an `HTMLAudioElement` per
 * chunk instead of `speechSynthesis` — that means real `currentTime`-based word/verse boundary
 * tracking and none of Web Speech's utterance-lifecycle workarounds (no watchdog, no inter-chunk
 * setTimeout chaining — see webSpeechBackend.ts's file header for why those exist there and
 * nowhere else).
 *
 * PLAYBACK RATE, PITCH-PRESERVING: always synthesize at the model's best (1x) quality and drive
 * speed purely through `HTMLAudioElement.playbackRate` + `preservesPitch = true` — the exact
 * mechanism YouTube/every other browser-based player uses for a "2x speed, no chipmunk voice"
 * control (Chromium implements a real time-stretch algorithm under `preservesPitch`, not a naive
 * resample). Two things this replaces:
 *  - Feeding a non-1x `speed` straight into the model (an earlier version of this file did this)
 *    — Kokoro's own `speed` parameter is a phoneme-DURATION scale baked into synthesis, not a
 *    resample, and only sounds clean within a narrow band around 1x; push it further and the
 *    model compresses phoneme durations below what it was trained to articulate cleanly, which
 *    is heard as slurring, not just a pitch change.
 *  - `AudioBufferSourceNode.playbackRate` (a plain Web Audio buffer source) — that DOES resample,
 *    but naive resampling shifts pitch right along with speed (chipmunk at 2x+, muffled/deep
 *    below 1x); `HTMLAudioElement`'s `preservesPitch` avoids that by design.
 * Since synthesis is always 1x, it's also rate-independent — the SAME synthesized chunk plays
 * back at any rate with zero resynthesis, so `setRate()` never needs to restart playback at all
 * (see its doc comment) and the disk cache (electron/ipc/ttsAudioCache.ts) no longer needs rate
 * as part of its key.
 *
 * Chromium's autoplay policy normally requires a recent user gesture before playing audible
 * media — Electron's `autoplay-policy=no-user-gesture-required` switch (see main.ts) disables
 * that for this app, since each chunk's `<audio>.play()` call happens many `await`s away from
 * the original "Read Aloud" button click that started the chapter.
 */
import { buildLatencyChunks } from './kokoroChunking'
import { estimateWordTimings, advanceToTime, type WordTimingEvent } from './timestampAlignment'
import { cacheKeyFor, hashText, encodeCachedChunk, decodeCachedChunk } from './audioCacheStore'
import { KOKORO_MODEL_ID, KOKORO_VOICE_OPTIONS, DEFAULT_KOKORO_VOICE_ID } from './kokoroVoices'
import type { SentenceChunk, SpokenVerse } from '../extractSpokenText'
import type { TTSBackend, TTSVoiceOption, TTSVoiceProvider, SpeakChapterOptions } from '../ttsBackend'

const BACKEND_ID = 'kokoro'
// Small deliberate silence between chunks — real speech doesn't run sentence-to-sentence with
// zero gap. Much shorter than Web Speech's inter-chunk delays (CHUNK_DELAY_MS_* in
// webSpeechBackend.ts) since those exist to dodge Chromium onend-timing flakiness, not for
// naturalness — this gap is purely aesthetic.
const INTER_CHUNK_GAP_SEC = 0.12
// How often the playback poller checks the audio element's currentTime to fire word/verse
// boundary events. 50ms is well under human word-boundary perception (~150-200ms) and cheap for
// a plain interval.
const POLL_INTERVAL_MS = 50

interface DecodedChunkAudio {
  chunk: SentenceChunk
  /** Blob URL for this chunk's synthesized audio (see pcmToWavBlob) — revoked once no longer
   *  needed (chunk finished playing, or abandoned by a restart/stop) to avoid leaking memory
   *  over a long chapter. */
  url: string
  /** Real, measured duration of the synthesized audio — computed directly from the raw PCM
   *  sample count/rate rather than waiting on the `<audio>` element's own metadata-load event,
   *  which would otherwise be an extra async race for no benefit (we already know this exactly). */
  durationSec: number
}

/** Wraps raw mono PCM samples in a minimal 16-bit RIFF/WAVE container so they can be handed to
 *  an `<audio>` element as a `src` — `<audio>` needs a real container format, not raw samples;
 *  WAV needs no external encoder and is universally supported. Deliberately separate from
 *  `encodeCachedChunk` in audioCacheStore.ts (that format is Berean's own disk-cache format,
 *  never played directly — this one specifically has to be something Chromium's media pipeline
 *  can decode). */
function pcmToWavBlob(samplingRate: number, samples: Float32Array): Blob {
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = bytesPerSample // mono
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  let offset = 0
  const writeString = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)) }
  writeString('RIFF')
  view.setUint32(offset, 36 + dataSize, true); offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true); offset += 4 // fmt chunk size (PCM)
  view.setUint16(offset, 1, true); offset += 2 // audio format = PCM
  view.setUint16(offset, 1, true); offset += 2 // mono
  view.setUint32(offset, samplingRate, true); offset += 4
  view.setUint32(offset, samplingRate * blockAlign, true); offset += 4 // byte rate
  view.setUint16(offset, blockAlign, true); offset += 2
  view.setUint16(offset, 8 * bytesPerSample, true); offset += 2 // bits per sample
  writeString('data')
  view.setUint32(offset, dataSize, true); offset += 4
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export class KokoroBackend implements TTSBackend {
  private worker: Worker | null = null
  private modelLoadPromise: Promise<void> | null = null

  private queue: SpokenVerse[] = []
  private opts: SpeakChapterOptions | null = null
  private rate = 1
  private voiceURI: string = DEFAULT_KOKORO_VOICE_ID
  private currentIndex = -1
  // The verse the CURRENTLY PLAYING chunk started at — the floor `restartAtCurrentVerse()`
  // backs off to, never earlier. See its doc comment for why the restart needs a floor at all.
  private currentChunkStartVerseIndex = -1
  private stopped = true
  private paused = false
  // Bumped on every stop()/speakFrom()/skip — an in-flight playLoop checks this before every
  // await-boundary continuation and quietly abandons itself if it's gone stale, the same
  // generation-guard pattern webSpeechBackend.ts uses for its own async continuations.
  private generation = 0

  private activeSource: HTMLAudioElement | null = null
  private activeUrl: string | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private synthCounter = 0
  // Resolvers for any playback currently blocked in `waitIfPaused()` — see pause()/resume().
  // `<audio>.play()` (unlike Web Audio's schedule-now-play-whenever-resumed model) has no native
  // "start but stay silent until resumed" behavior, so pause semantics between chunks (i.e. when
  // no `activeSource` exists yet to literally pause) have to be implemented explicitly.
  private pauseWaiters: Array<() => void> = []

  // ── Worker + model lifecycle ────────────────────────────────────────────────────────────
  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    return this.worker
  }

  /** Resolves once the model is loaded in the worker (idempotent — safe to call before every
   *  synthesis; only the FIRST call actually posts the loadModel message). Rejects if the
   *  worker reports a load error (e.g. the model files aren't downloaded yet, or a corrupt
   *  partial download slipped past ttsModel.ts's verification somehow) — callers surface that
   *  through `opts.onError` rather than crashing. */
  private ensureModelLoaded(): Promise<void> {
    if (this.modelLoadPromise) return this.modelLoadPromise
    const worker = this.ensureWorker()
    this.modelLoadPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg?.type === 'loadComplete') {
          worker.removeEventListener('message', onMessage)
          resolve()
        } else if (msg?.type === 'loadError') {
          worker.removeEventListener('message', onMessage)
          this.modelLoadPromise = null // allow a retry (e.g. after the user re-downloads)
          reject(new Error(msg.message))
        }
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ type: 'loadModel', modelId: KOKORO_MODEL_ID })
    })
    return this.modelLoadPromise
  }

  private synthesizeRaw(text: string, voice: string): Promise<{ samplingRate: number; samples: Float32Array }> {
    const worker = this.ensureWorker()
    const id = `synth-${++this.synthCounter}`
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg?.id !== id) return
        if (msg.type === 'synthesisResult') {
          worker.removeEventListener('message', onMessage)
          resolve({ samplingRate: msg.samplingRate, samples: new Float32Array(msg.buffer) })
        } else if (msg.type === 'synthesisError') {
          worker.removeEventListener('message', onMessage)
          reject(new Error(msg.message))
        }
      }
      worker.addEventListener('message', onMessage)
      // Always synthesizes at the model's own default (1x) speed — see this file's header for
      // why user-facing rate is handled entirely via playback, not synthesis.
      worker.postMessage({ type: 'synthesize', id, text, voice, speed: 1 })
    })
  }

  // ── Audio cache ──────────────────────────────────────────────────────────────────────────
  // Cached for the whole `speakChapter()` run — the spoken-text content hash (not a `textId`,
  // which `SpeakChapterOptions`/`SpokenVerse` deliberately carry nowhere — see ttsBackend.ts's
  // interface, kept identical to Web Speech's on purpose) already fully disambiguates WHICH
  // translation/text this is: KJV Genesis 1 and LXX Genesis 1 produce different `spokenText`,
  // so they hash differently and can never collide in the cache even without a textId field.
  private queueContentHash = ''

  /** Keyed by a hash of the chunk's OWN TEXT — not by its position within whatever `chunks`
   *  array THIS PARTICULAR `speakFrom`/`playLoop` call happens to have built (an earlier version
   *  keyed on that positional index, and a version after that on `startVerseIndex`; both were
   *  wrong the same way — a stand-in for "which chunk is this" that isn't actually collision-free).
   *  Positional index collided because `buildLatencyChunks` is called fresh on every play/seek,
   *  and its first chunk is always array index 0 regardless of which verse that run started at —
   *  "the first chunk of starting-from-verse-1" and "the first chunk of starting-from-verse-20"
   *  shared a cache key despite being completely different text, so a later seek could silently
   *  play back verse 1's stale cached audio under a genuinely-correct verse-20 chunk (sounded
   *  like the seek "restarted from verse 1"). `startVerseIndex` fixed THAT collision but has its
   *  own: a single verse long enough to span two consecutive chunks (`FIRST_CHUNK_MAX_WORDS`
   *  caps the very FIRST chunk of any run to just 12 words — see kokoroChunking.ts — so this
   *  reliably happens on the first verse of nearly every chapter, if that verse runs longer than
   *  12 words) means chunk 2 starts in the middle of the SAME verse chunk 1 started in — both
   *  chunks share `startVerseIndex`, so chunk 2's lookup hit chunk 1's just-cached entry and
   *  played its audio again — audibly "the first verse plays twice." A chunk's TEXT is the one
   *  thing that's actually unique to what audio it needs — two chunks with the same text are
   *  legitimately the same audio (safe, even DESIRABLE to share a cache hit), and two chunks
   *  with different text never collide, regardless of index/position/verse-span games. */
  private cacheKeyForChunk(chunkText: string): string | null {
    const first = this.queue[0]
    if (!first) return null
    return cacheKeyFor({
      backendId: BACKEND_ID,
      textId: 'kokoro-v1', // fixed placeholder — see queueContentHash's doc comment
      bookId: first.bookId,
      chapter: first.chapter,
      voiceURI: this.voiceURI,
      contentHash: this.queueContentHash,
    }) + `__t${hashText(chunkText)}`
  }

  private async loadOrSynthesizeChunk(chunk: SentenceChunk): Promise<{ samplingRate: number; samples: Float32Array }> {
    const key = this.cacheKeyForChunk(chunk.text)
    if (key && typeof window !== 'undefined' && window.ttsAudioCache) {
      try {
        const cached = await window.ttsAudioCache.get(key)
        if (cached) return decodeCachedChunk(cached)
      } catch { /* cache miss/error — fall through to synthesis */ }
    }
    const result = await this.synthesizeRaw(chunk.text, this.voiceURI)
    if (key && typeof window !== 'undefined' && window.ttsAudioCache) {
      // Fire-and-forget — a failed cache write should never block/break playback.
      window.ttsAudioCache.put(key, encodeCachedChunk(result.samplingRate, result.samples)).catch(() => {})
    }
    return result
  }

  // ── Pause coordination ──────────────────────────────────────────────────────────────────
  /** Resolves immediately if not paused; otherwise resolves once `resume()` is next called.
   *  Awaited right before every `<audio>.play()` call so a pause that lands BETWEEN chunks
   *  (no `activeSource` yet to literally `.pause()`) still holds up the next chunk instead of
   *  playing straight through it — see `pauseWaiters`' doc comment. */
  private waitIfPaused(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((resolve) => { this.pauseWaiters.push(resolve) })
  }

  private flushPauseWaiters(): void {
    const waiters = this.pauseWaiters
    this.pauseWaiters = []
    waiters.forEach((w) => w())
  }

  // ── Playback pipeline ────────────────────────────────────────────────────────────────────
  private async speakFrom(startIndex: number): Promise<void> {
    this.generation++
    const gen = this.generation
    let i = startIndex
    while (i < this.queue.length && !this.queue[i].spokenText.trim()) i++
    if (i >= this.queue.length) {
      this.stopped = true
      this.opts?.onChapterEnd?.()
      return
    }

    try {
      await this.ensureModelLoaded()
    } catch (e) {
      if (gen === this.generation) this.opts?.onError?.(e)
      return
    }
    if (gen !== this.generation || this.stopped) return

    const chunks = buildLatencyChunks(this.queue, i)
    await this.playLoop(chunks, gen)
  }

  private async playLoop(chunks: SentenceChunk[], gen: number): Promise<void> {
    if (chunks.length === 0) { this.stopped = true; this.opts?.onChapterEnd?.(); return }
    let nextPromise = this.loadOrSynthesizeChunk(chunks[0])
    for (let i = 0; i < chunks.length; i++) {
      let raw: { samplingRate: number; samples: Float32Array }
      try {
        raw = await nextPromise
      } catch (e) {
        if (gen === this.generation) this.opts?.onError?.(e)
        return
      }
      if (gen !== this.generation) return
      // Kick off the NEXT chunk's synthesis now (before awaiting this chunk's playback) so it
      // races ahead in the background — this is the whole point of chunking for Kokoro (see
      // kokoroChunking.ts's file header): keep synthesis ahead of playback, not behind it.
      if (i + 1 < chunks.length) nextPromise = this.loadOrSynthesizeChunk(chunks[i + 1])
      const url = URL.createObjectURL(pcmToWavBlob(raw.samplingRate, raw.samples))
      const durationSec = raw.samples.length / raw.samplingRate
      await this.playChunkBuffer({ chunk: chunks[i], url, durationSec }, gen)
      if (gen !== this.generation) return
    }
    if (gen === this.generation) {
      this.stopped = true
      this.opts?.onChapterEnd?.()
    }
  }

  /** Plays one already-synthesized chunk to completion (resolving on real playback end, i.e.
   *  respecting pause/resume), firing verse/word boundary callbacks along the way via the
   *  proportional-duration estimate from timestampAlignment.ts.
   *
   *  Speed is applied via `HTMLAudioElement.playbackRate` + `preservesPitch` (see this file's
   *  header) rather than baked into synthesis, so `audio.currentTime` already advances through
   *  the chunk's OWN original timeline regardless of rate — no elapsed-time scaling needed for
   *  `fireDueEvents` (unlike a raw Web Audio buffer source, where `ctx.currentTime` is wall-clock
   *  and would need correcting for playbackRate itself). */
  private playChunkBuffer(decoded: DecodedChunkAudio, gen: number): Promise<void> {
    const { chunk, url, durationSec } = decoded
    this.currentIndex = chunk.startVerseIndex
    this.currentChunkStartVerseIndex = chunk.startVerseIndex
    const events: WordTimingEvent[] = estimateWordTimings(chunk, this.queue, durationSec)
    let firedIndex = -1
    let lastReportedVerseIndex = -1

    return new Promise<void>((resolve) => {
      const audio = new Audio(url)
      audio.playbackRate = this.rate
      audio.preservesPitch = true
      this.activeSource = audio
      this.activeUrl = url

      const cleanup = () => {
        if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
        if (this.activeSource === audio) { this.activeSource = null; this.activeUrl = null }
        URL.revokeObjectURL(url)
      }

      const fireDueEvents = () => {
        const upTo = advanceToTime(events, audio.currentTime, firedIndex)
        for (let k = firedIndex + 1; k <= upTo; k++) {
          const ev = events[k]
          this.currentIndex = ev.verseIndex
          if (ev.verseIndex !== lastReportedVerseIndex) {
            lastReportedVerseIndex = ev.verseIndex
            this.opts?.onVerseStart?.(ev.verseIndex, this.queue[ev.verseIndex])
          }
          this.opts?.onWordBoundary?.(ev.verseIndex, ev.word)
        }
        firedIndex = upTo
      }
      // Report the chunk's first verse eagerly (mirrors webSpeechBackend.ts's playChunk — a
      // one-word chunk can finish between poll ticks with no event otherwise fired for it).
      if (chunk.startVerseIndex !== lastReportedVerseIndex) {
        lastReportedVerseIndex = chunk.startVerseIndex
        this.opts?.onVerseStart?.(chunk.startVerseIndex, this.queue[chunk.startVerseIndex])
      }

      audio.onended = () => {
        cleanup()
        if (gen !== this.generation) { resolve(); return }
        // Deliberate small silence gap before resolving (which lets playLoop move to the next
        // chunk) — see INTER_CHUNK_GAP_SEC's doc comment.
        setTimeout(resolve, INTER_CHUNK_GAP_SEC * 1000)
      }
      audio.onerror = () => {
        cleanup()
        if (gen === this.generation) this.opts?.onError?.(audio.error ?? new Error('Read Aloud audio playback failed'))
        resolve()
      }

      void this.waitIfPaused().then(() => {
        if (gen !== this.generation) { cleanup(); resolve(); return }
        this.pollTimer = setInterval(fireDueEvents, POLL_INTERVAL_MS)
        audio.play().catch((e) => {
          cleanup()
          if (gen === this.generation) this.opts?.onError?.(e)
          resolve()
        })
      })
    })
  }

  // ── TTSBackend ───────────────────────────────────────────────────────────────────────────
  speakChapter(queue: SpokenVerse[], opts: SpeakChapterOptions): void {
    this.stop()
    this.queue = queue
    this.queueContentHash = hashText(queue.map((v) => v.spokenText).join('\n'))
    this.opts = opts
    this.rate = opts.rate
    this.voiceURI = opts.voiceURI ?? DEFAULT_KOKORO_VOICE_ID
    this.stopped = false
    this.paused = false
    void this.speakFrom(opts.startVerseIndex ?? 0)
  }

  pause(): void {
    if (this.stopped || this.paused) return
    this.paused = true
    this.activeSource?.pause()
  }

  resume(): void {
    if (this.stopped || !this.paused) return
    this.paused = false
    // Two cases, handled unconditionally: mid-chunk pause (an `activeSource` exists, loaded and
    // paused — resume it directly) and between-chunk pause (no `activeSource` yet; whatever's
    // stuck in `waitIfPaused()` gets woken by the flush below instead).
    void this.activeSource?.play().catch(() => {})
    this.flushPauseWaiters()
  }

  stop(): void {
    this.stopped = true
    this.paused = false
    this.generation++
    if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.activeSource) {
      try { this.activeSource.onended = null; this.activeSource.onerror = null; this.activeSource.pause() } catch { /* already stopped */ }
      this.activeSource = null
    }
    if (this.activeUrl) { URL.revokeObjectURL(this.activeUrl); this.activeUrl = null }
    this.flushPauseWaiters() // wake any chunk stuck waiting on a pause so it can see the new generation and bail
    this.opts = null
  }

  skipToVerse(verseIndex: number): void {
    if (this.stopped || !this.queue.length || !this.opts) return
    if (this.activeSource) {
      try { this.activeSource.onended = null; this.activeSource.onerror = null; this.activeSource.pause() } catch { /* already stopped */ }
      this.activeSource = null
    }
    if (this.activeUrl) { URL.revokeObjectURL(this.activeUrl); this.activeUrl = null }
    if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
    void this.speakFrom(verseIndex)
  }

  /** Synthesis is always rate-independent (see this file's header), so a rate change is ALWAYS
   *  just retuning the live `playbackRate` on whatever's already loaded/playing — never a
   *  restart, never a resynthesis, never any risk of the word-loss `restartAtCurrentVerse()`'s
   *  doc comment describes (that risk was specific to a restart having to pick a resume point;
   *  since nothing restarts for a rate change anymore, it simply cannot arise here). */
  setRate(rate: number): void {
    this.rate = rate
    if (this.activeSource) this.activeSource.playbackRate = rate
  }

  setVoice(voiceURI: string | null): void {
    this.voiceURI = voiceURI ?? DEFAULT_KOKORO_VOICE_ID
    this.restartAtCurrentVerse()
  }

  /** Same tradeoff webSpeechBackend.ts's setVoice documents: an in-flight chunk can't have its
   *  voice changed without resynthesizing it, so this restarts from a verse boundary with the
   *  new voice — audible but brief, and now additionally CACHED (see loadOrSynthesizeChunk), so
   *  switching back to a previously-used voice for the same chapter is instant on the second
   *  occurrence. (setRate no longer calls this at all — see its own doc comment.)
   *
   *  Deliberately restarts ONE VERSE BEHIND `currentIndex`, not exactly at it. `currentIndex`
   *  is only ever as good as `estimateWordTimings()`'s proportional-duration guess (see
   *  timestampAlignment.ts — Kokoro exposes no real per-word timestamps), and that estimate can
   *  legitimately credit playback as having reached the next verse slightly before the real
   *  audio actually has — worse the longer/less-punctuated the sentence. Since a restart always
   *  resynthesizes from the exact START of a verse (Kokoro has no per-word seek), restarting
   *  exactly at a `currentIndex` that ran ahead of the real audio would permanently drop
   *  whatever of the previous verse's tail was still truly sounding when the source was cut —
   *  those words are gone at any rate, not just delayed. Backing off one verse trades that
   *  (silent, permanent word loss) for occasionally re-speaking a verse's opening (audible but
   *  harmless). Never backs off past `currentChunkStartVerseIndex` — the verse the
   *  currently-playing chunk actually started at — so this can't wander earlier than what's
   *  actually mid-playback. */
  private restartAtCurrentVerse(): void {
    if (this.stopped || this.currentIndex < 0 || !this.opts) return
    const idx = Math.max(this.currentChunkStartVerseIndex, this.currentIndex - 1)
    if (this.activeSource) {
      try { this.activeSource.onended = null; this.activeSource.onerror = null; this.activeSource.pause() } catch { /* already stopped */ }
      this.activeSource = null
    }
    if (this.activeUrl) { URL.revokeObjectURL(this.activeUrl); this.activeUrl = null }
    if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
    void this.speakFrom(idx)
  }

  previewVoice(text: string, voiceURI: string | null, rate: number, onEnd?: () => void): void {
    void (async () => {
      let url: string | null = null
      try {
        await this.ensureModelLoaded()
        const raw = await this.synthesizeRaw(text, voiceURI ?? DEFAULT_KOKORO_VOICE_ID)
        url = URL.createObjectURL(pcmToWavBlob(raw.samplingRate, raw.samples))
        const audio = new Audio(url)
        audio.playbackRate = rate
        audio.preservesPitch = true
        const finish = () => { if (url) URL.revokeObjectURL(url); onEnd?.() }
        audio.onended = finish
        audio.onerror = finish
        await audio.play()
      } catch {
        if (url) URL.revokeObjectURL(url)
        onEnd?.()
      }
    })()
  }

  get isActive(): boolean { return !this.stopped }
  get isPaused(): boolean { return this.paused }
  get activeIndex(): number { return this.currentIndex }
}

/** `TTSVoiceProvider` for Kokoro — the voice LIST is static (no model load required just to
 *  browse voices in Settings, see kokoroVoices.ts's file header), so `subscribeVoices` never
 *  actually needs to notify anyone; it exists only to satisfy the shared interface. */
export const kokoroVoiceProvider: TTSVoiceProvider = {
  getVoices(): TTSVoiceOption[] {
    return KOKORO_VOICE_OPTIONS
  },
  subscribeVoices(): () => void {
    return () => {}
  },
  isSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof Audio !== 'undefined'
  },
}
