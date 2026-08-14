/**
 * Read Aloud (TTS) — the Kokoro neural `TTSBackend`. Unlike webSpeechBackend.ts, this backend
 * gets REAL audio data back from synthesis, so playback is driven by the Web Audio API
 * (AudioBufferSourceNode chained onto a single AudioContext) instead of `speechSynthesis` — that
 * means real `currentTime`-based seeking/pausing and none of Web Speech's utterance-lifecycle
 * workarounds (no watchdog, no inter-chunk setTimeout chaining, no restart-on-rate-change
 * hack — see webSpeechBackend.ts's file header for why those exist there and nowhere else).
 *
 * Synthesis itself happens off-thread in kokoro.worker.ts; this class owns the Worker, the
 * AudioContext, the chunk pipeline (synthesize chunk N+1 while chunk N plays — see `playLoop`),
 * and the disk-backed audio cache (electron/ipc/ttsAudioCache.ts) so re-reading the same
 * chapter/voice/rate never re-synthesizes.
 */
import { buildLatencyChunks } from './kokoroChunking'
import { estimateWordTimings, advanceToTime, type WordTimingEvent } from './timestampAlignment'
import { cacheKeyFor, hashText, encodeCachedChunk, decodeCachedChunk } from './audioCacheStore'
import { KOKORO_MODEL_ID, KOKORO_VOICE_OPTIONS, DEFAULT_KOKORO_VOICE_ID } from './kokoroVoices'
import type { SentenceChunk, SpokenVerse } from '../extractSpokenText'
import type { TTSBackend, TTSVoiceOption, TTSVoiceProvider, SpeakChapterOptions } from '../ttsBackend'

const BACKEND_ID = 'kokoro'
// Small deliberate silence between chunks — real speech doesn't run sentence-to-sentence with
// zero gap, and this is far cheaper than trying to bake silence into the synthesized audio
// itself. Much shorter than Web Speech's inter-chunk delays (CHUNK_DELAY_MS_* in
// webSpeechBackend.ts) since those exist to dodge Chromium onend-timing flakiness, not for
// naturalness — Web Audio's scheduling is sample-accurate, so this gap is purely aesthetic.
const INTER_CHUNK_GAP_SEC = 0.12
// How often the playback poller checks audioCtx.currentTime to fire word/verse boundary events.
// 50ms is well under human word-boundary perception (~150-200ms) and cheap for a plain interval.
const POLL_INTERVAL_MS = 50

interface DecodedChunkAudio {
  chunk: SentenceChunk
  buffer: AudioBuffer
}

export class KokoroBackend implements TTSBackend {
  private worker: Worker | null = null
  private modelLoadPromise: Promise<void> | null = null
  private audioCtx: AudioContext | null = null

  private queue: SpokenVerse[] = []
  private opts: SpeakChapterOptions | null = null
  private rate = 1
  private voiceURI: string = DEFAULT_KOKORO_VOICE_ID
  private currentIndex = -1
  private stopped = true
  private paused = false
  // Bumped on every stop()/speakFrom()/skip — an in-flight playLoop checks this before every
  // await-boundary continuation and quietly abandons itself if it's gone stale, the same
  // generation-guard pattern webSpeechBackend.ts uses for its own async continuations.
  private generation = 0

  private activeSource: AudioBufferSourceNode | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private synthCounter = 0

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

  private synthesizeRaw(text: string, voice: string, speed: number): Promise<{ samplingRate: number; samples: Float32Array }> {
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
      worker.postMessage({ type: 'synthesize', id, text, voice, speed })
    })
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext()
    // A freshly-constructed AudioContext (or one Chromium has auto-suspended after a period of
    // silence — e.g. while the next chunk is still synthesizing) can come up/settle in
    // `suspended` rather than `running`. Packaged builds load over `file://` (see main.ts's
    // loadFile vs dev's loadURL to the Vite dev server), and Chromium's autoplay/media-engagement
    // heuristics treat `file://` origins more conservatively than `http://localhost` — this is
    // what previously made Read Aloud hang after the first word in production only: the eager
    // "chunk started" event fires unconditionally, but every subsequent word/verse boundary in
    // playChunkBuffer is gated on `ctx.currentTime` actually advancing, which never happens while
    // suspended, so playback silently froze with no error. `resume()` is a no-op when already
    // running, so this is safe to call unconditionally every time the context is touched.
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume()
    return this.audioCtx
  }

  // ── Audio cache ──────────────────────────────────────────────────────────────────────────
  // Cached for the whole `speakChapter()` run — the spoken-text content hash (not a `textId`,
  // which `SpeakChapterOptions`/`SpokenVerse` deliberately carry nowhere — see ttsBackend.ts's
  // interface, kept identical to Web Speech's on purpose) already fully disambiguates WHICH
  // translation/text this is: KJV Genesis 1 and LXX Genesis 1 produce different `spokenText`,
  // so they hash differently and can never collide in the cache even without a textId field.
  private queueContentHash = ''

  private cacheKeyForChunk(chunkIndex: number): string | null {
    const first = this.queue[0]
    if (!first) return null
    return cacheKeyFor({
      backendId: BACKEND_ID,
      textId: 'kokoro-v1', // fixed placeholder — see queueContentHash's doc comment
      bookId: first.bookId,
      chapter: first.chapter,
      voiceURI: this.voiceURI,
      rate: this.rate,
      contentHash: this.queueContentHash,
    }) + `__c${chunkIndex}`
  }

  private async loadOrSynthesizeChunk(chunk: SentenceChunk, chunkIndex: number): Promise<{ samplingRate: number; samples: Float32Array }> {
    const key = this.cacheKeyForChunk(chunkIndex)
    if (key && typeof window !== 'undefined' && window.ttsAudioCache) {
      try {
        const cached = await window.ttsAudioCache.get(key)
        if (cached) return decodeCachedChunk(cached)
      } catch { /* cache miss/error — fall through to synthesis */ }
    }
    const result = await this.synthesizeRaw(chunk.text, this.voiceURI, this.rate)
    if (key && typeof window !== 'undefined' && window.ttsAudioCache) {
      // Fire-and-forget — a failed cache write should never block/break playback.
      window.ttsAudioCache.put(key, encodeCachedChunk(result.samplingRate, result.samples)).catch(() => {})
    }
    return result
  }

  private toAudioBuffer(samplingRate: number, samples: Float32Array): AudioBuffer {
    const ctx = this.getAudioContext()
    const buffer = ctx.createBuffer(1, samples.length, samplingRate)
    // `samples` can be a view over a SharedArrayBuffer-typed backing store (structured-clone/
    // transfer results are typed as `Float32Array<ArrayBufferLike>`), while `copyToChannel`'s
    // lib.dom types insist on the narrower `Float32Array<ArrayBuffer>` — copying into a plain
    // Float32Array first satisfies that at zero real cost (Web Audio would copy the data into
    // the AudioBuffer's own internal storage either way).
    buffer.copyToChannel(Float32Array.from(samples), 0)
    return buffer
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
    let nextPromise = this.loadOrSynthesizeChunk(chunks[0], 0)
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
      if (i + 1 < chunks.length) nextPromise = this.loadOrSynthesizeChunk(chunks[i + 1], i + 1)
      const buffer = this.toAudioBuffer(raw.samplingRate, raw.samples)
      await this.playChunkBuffer({ chunk: chunks[i], buffer }, gen)
      if (gen !== this.generation) return
    }
    if (gen === this.generation) {
      this.stopped = true
      this.opts?.onChapterEnd?.()
    }
  }

  /** Plays one already-decoded chunk's AudioBuffer to completion (resolving on real playback
   *  end, i.e. respecting pause/resume via `audioCtx.suspend()`), firing verse/word boundary
   *  callbacks along the way via the proportional-duration estimate from timestampAlignment.ts. */
  private playChunkBuffer(decoded: DecodedChunkAudio, gen: number): Promise<void> {
    const ctx = this.getAudioContext()
    const { chunk, buffer } = decoded
    this.currentIndex = chunk.startVerseIndex
    const events: WordTimingEvent[] = estimateWordTimings(chunk, this.queue, buffer.duration)
    let firedIndex = -1
    let lastReportedVerseIndex = -1

    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      this.activeSource = source
      const startedAt = ctx.currentTime

      const fireDueEvents = () => {
        const elapsed = ctx.currentTime - startedAt
        const upTo = advanceToTime(events, elapsed, firedIndex)
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

      this.pollTimer = setInterval(fireDueEvents, POLL_INTERVAL_MS)
      source.onended = () => {
        if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
        if (this.activeSource === source) this.activeSource = null
        if (gen !== this.generation) { resolve(); return }
        // Deliberate small silence gap before resolving (which lets playLoop move to the next
        // chunk) — see INTER_CHUNK_GAP_SEC's doc comment.
        setTimeout(resolve, INTER_CHUNK_GAP_SEC * 1000)
      }
      source.start()
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
    if (this.stopped || this.paused || !this.audioCtx) return
    this.paused = true
    void this.audioCtx.suspend()
  }

  resume(): void {
    if (this.stopped || !this.paused || !this.audioCtx) return
    this.paused = false
    void this.audioCtx.resume()
  }

  stop(): void {
    this.stopped = true
    this.paused = false
    this.generation++
    if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.activeSource) {
      try { this.activeSource.onended = null; this.activeSource.stop() } catch { /* already stopped */ }
      this.activeSource = null
    }
    this.opts = null
  }

  skipToVerse(verseIndex: number): void {
    if (this.stopped || !this.queue.length || !this.opts) return
    if (this.activeSource) {
      try { this.activeSource.onended = null; this.activeSource.stop() } catch { /* already stopped */ }
      this.activeSource = null
    }
    if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
    void this.speakFrom(verseIndex)
  }

  setRate(rate: number): void {
    this.rate = rate
    this.restartAtCurrentVerse()
  }

  setVoice(voiceURI: string | null): void {
    this.voiceURI = voiceURI ?? DEFAULT_KOKORO_VOICE_ID
    this.restartAtCurrentVerse()
  }

  /** Same tradeoff webSpeechBackend.ts's setRate/setVoice document: an in-flight chunk can't
   *  have its rate/voice changed without resynthesizing it, so this restarts from the current
   *  verse with the new setting — audible but brief, and now additionally CACHED (see
   *  loadOrSynthesizeChunk), so switching back to a previously-used rate/voice combo for the
   *  same chapter is instant on the second occurrence. */
  private restartAtCurrentVerse(): void {
    if (this.stopped || this.currentIndex < 0 || !this.opts) return
    const idx = this.currentIndex
    if (this.activeSource) {
      try { this.activeSource.onended = null; this.activeSource.stop() } catch { /* already stopped */ }
      this.activeSource = null
    }
    if (this.pollTimer != null) { clearInterval(this.pollTimer); this.pollTimer = null }
    void this.speakFrom(idx)
  }

  previewVoice(text: string, voiceURI: string | null, rate: number, onEnd?: () => void): void {
    void (async () => {
      try {
        await this.ensureModelLoaded()
        const raw = await this.synthesizeRaw(text, voiceURI ?? DEFAULT_KOKORO_VOICE_ID, rate)
        const buffer = this.toAudioBuffer(raw.samplingRate, raw.samples)
        const ctx = this.getAudioContext()
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        source.onended = () => onEnd?.()
        source.start()
      } catch {
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
    return typeof Worker !== 'undefined' && typeof AudioContext !== 'undefined'
  },
}
