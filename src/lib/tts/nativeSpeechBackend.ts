import type { TTSBackend, TTSVoiceOption, TTSVoiceProvider, SpeakChapterOptions } from './ttsBackend'
import type { SpokenVerse } from './extractSpokenText'

/**
 * `TTSBackend` over the phone's system speech synthesiser (BereanSpeechPlugin.swift). Speaks a
 * chapter one verse at a time; `boundary` events map to `SpokenWord`s by character offset so
 * VerseRow's word highlight follows along; pause/resume/skip/rate/voice all go to the native
 * synthesiser. The Mac's Kokoro engine keeps its own backend — both satisfy the same contract.
 */
interface SpeechPluginLike {
  voices(): Promise<{ voices: Array<{ id: string; name: string; lang: string; quality: string }> }>
  speak(opts: { id: string; text: string; voice?: string | null; lang?: string; rate?: number }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  addListener(event: string, cb: (e: { id: string; charIndex?: number; charLength?: number }) => void): Promise<{ remove: () => Promise<void> }>
}

export class NativeSpeechBackend implements TTSBackend {
  private plugin: SpeechPluginLike
  private queue: SpokenVerse[] = []
  private opts: SpeakChapterOptions | null = null
  private index = -1
  private rate = 1
  private voiceURI: string | null = null
  private generation = 0
  private currentId: string | null = null
  private paused = false
  private listening: Promise<void> | null = null
  private previewEnd: (() => void) | null = null

  constructor(plugin: SpeechPluginLike) { this.plugin = plugin }

  private ensureListeners(): Promise<void> {
    if (this.listening) return this.listening
    this.listening = (async () => {
      await this.plugin.addListener('start', (e) => { if (e.id === this.currentId && this.opts) this.opts.onVerseStart?.(this.index, this.queue[this.index]) })
      await this.plugin.addListener('boundary', (e) => {
        if (e.id !== this.currentId || !this.opts) return
        const verse = this.queue[this.index]
        if (!verse) return
        const idx = e.charIndex ?? 0
        const word = verse.words.find((w) => idx >= w.charStart && idx < w.charStart + w.charLen) ?? verse.words.find((w) => w.charStart >= idx)
        if (word) this.opts.onWordBoundary?.(this.index, word)
      })
      await this.plugin.addListener('end', (e) => {
        if (e.id.startsWith('preview-')) { this.previewEnd?.(); this.previewEnd = null; return }
        if (e.id !== this.currentId) return
        this.currentId = null
        void this.speakNext(this.index + 1)
      })
      await this.plugin.addListener('cancel', (e) => { if (e.id.startsWith('preview-')) { this.previewEnd?.(); this.previewEnd = null } })
    })()
    return this.listening
  }

  private async speakNext(i: number): Promise<void> {
    const gen = this.generation
    if (!this.opts) return
    if (i >= this.queue.length) { this.index = -1; this.opts.onChapterEnd?.(); return }
    this.index = i
    const verse = this.queue[i]
    const id = `v-${gen}-${i}`
    this.currentId = id
    try {
      await this.plugin.speak({ id, text: verse.spokenText, voice: this.voiceURI, rate: this.rate })
    } catch (err) {
      if (gen === this.generation) this.opts.onError?.(err)
    }
  }

  speakChapter(queue: SpokenVerse[], opts: SpeakChapterOptions): void {
    this.generation++
    this.queue = queue
    this.opts = opts
    this.paused = false
    this.rate = opts.rate
    this.voiceURI = opts.voiceURI
    void this.plugin.stop().catch(() => {})
    void this.ensureListeners().then(() => this.speakNext(opts.startVerseIndex ?? 0))
  }
  pause(): void { this.paused = true; void this.plugin.pause().catch(() => {}) }
  resume(): void { this.paused = false; void this.plugin.resume().catch(() => {}) }
  stop(): void { this.generation++; this.currentId = null; this.index = -1; this.opts = null; this.paused = false; void this.plugin.stop().catch(() => {}) }
  skipToVerse(verseIndex: number): void {
    if (!this.opts) return
    this.generation++
    this.currentId = null
    void this.plugin.stop().then(() => this.speakNext(Math.max(0, Math.min(verseIndex, this.queue.length - 1)))).catch(() => {})
  }
  setRate(rate: number): void {
    this.rate = rate
    // A running utterance keeps its rate; the change applies from the next verse. Restart the
    // current verse so the new speed is heard right away.
    if (this.opts && this.index >= 0 && !this.paused) this.skipToVerse(this.index)
  }
  setVoice(voiceURI: string | null): void {
    this.voiceURI = voiceURI
    if (this.opts && this.index >= 0 && !this.paused) this.skipToVerse(this.index)
  }
  previewVoice(text: string, voiceURI: string | null, rate: number, onEnd?: () => void): void {
    this.previewEnd = onEnd ?? null
    void this.ensureListeners().then(() => this.plugin.speak({ id: `preview-${Date.now()}`, text, voice: voiceURI, rate })).catch(() => { onEnd?.(); this.previewEnd = null })
  }
  get isActive(): boolean { return this.opts !== null && this.index >= 0 }
  get isPaused(): boolean { return this.paused }
  get activeIndex(): number { return this.index }
}

export function createNativeVoiceProvider(plugin: SpeechPluginLike): TTSVoiceProvider {
  let voices: TTSVoiceOption[] = []
  const subs = new Set<(v: TTSVoiceOption[]) => void>()
  let loaded = false
  const load = () => {
    if (loaded) return
    loaded = true
    plugin.voices().then((r) => {
      voices = r.voices.map((v): TTSVoiceOption => ({ voiceURI: v.id, name: v.name, lang: v.lang, tier: v.quality === 'Premium' ? 'Premium' : v.quality === 'Enhanced' ? 'Enhanced' : null }))
        .sort((a, b) => (a.lang.startsWith('en') === b.lang.startsWith('en') ? a.name.localeCompare(b.name) : a.lang.startsWith('en') ? -1 : 1))
      for (const cb of subs) cb(voices)
    }).catch(() => { loaded = false })
  }
  return {
    getVoices: () => { load(); return voices },
    subscribeVoices: (cb) => { subs.add(cb); load(); return () => { subs.delete(cb) } },
    isSupported: () => true,
  }
}
