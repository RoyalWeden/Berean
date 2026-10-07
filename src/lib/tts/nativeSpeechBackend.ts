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

/**
 * iOS ships dozens of `AVSpeechSynthesisVoice`s per language, most of them the old compact
 * "Default"-quality synthesiser (what the user calls "generic/system-sounding") plus a long tail
 * of novelty/Eloquence voices (Zarvox, Bubbles, Organ, …) that were never meant for reading
 * prose. Berean has no paid/offline-neural option on iOS yet (see docs/mobile/voices.md for why
 * Kokoro-in-WKWebView isn't feasible today), so the only "high quality, natural, free, offline"
 * voices available are Apple's own Enhanced/Premium tiers — this curates the picker down to
 * those, the same way a hand-picked list would, without hand-maintaining per-device voice ids
 * (identifiers vary by iOS version/locale; names and quality tiers do not).
 */

// Apple ships these as "novelty"/Eloquence or special-purpose voices (sound effects, whispering,
// accessibility-only registers) — never appropriate for reading Scripture aloud, regardless of
// their reported quality tier. Matched case-insensitively against the voice's base name (below).
const NOVELTY_VOICE_NAMES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester',
  'organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'grandma', 'grandpa', 'eddy',
  'flo', 'reed', 'rocko', 'sandy', 'shelley',
].map((n) => n.toLowerCase()))

// Preferred, in this order, when more than MAX_CURATED_VOICES otherwise qualify. Matched against
// the base name (see normalizeName) so "Samantha (Enhanced)"/"Samantha" both match "samantha".
const PREFERRED_VOICE_NAMES = ['ava', 'zoe', 'evan', 'nathan', 'samantha', 'daniel', 'serena']

const MAX_CURATED_VOICES = 6

/** Apple voice names sometimes carry a "(Enhanced)"/"(Premium)" suffix baked into the name
 *  itself (in addition to the separate `quality` field) — strip it so name-based matching
 *  (novelty deny-list, preferred-names ranking) works regardless of which form a given iOS
 *  version reports. */
function normalizeName(name: string): string {
  return name.replace(/\s*\((enhanced|premium)\)\s*$/i, '').trim().toLowerCase()
}

function isEnglish(lang: string): boolean {
  return lang.toLowerCase().startsWith('en')
}

function isNovelty(name: string): boolean {
  return NOVELTY_VOICE_NAMES.has(normalizeName(name))
}

function preferredRank(name: string): number {
  const i = PREFERRED_VOICE_NAMES.indexOf(normalizeName(name))
  return i === -1 ? PREFERRED_VOICE_NAMES.length : i
}

function byQualityThenPreference(a: TTSVoiceOption, b: TTSVoiceOption): number {
  const tierRank = (t: TTSVoiceOption['tier']) => (t === 'Premium' ? 0 : t === 'Enhanced' ? 1 : 2)
  const tr = tierRank(a.tier) - tierRank(b.tier)
  if (tr !== 0) return tr
  const pr = preferredRank(a.name) - preferredRank(b.name)
  if (pr !== 0) return pr
  return a.name.localeCompare(b.name)
}

/** The explanatory, non-selectable row shown when no Premium/Enhanced English voice is
 *  installed — apps cannot download Apple's higher-quality voices programmatically, so the best
 *  Berean can do is say where to get one. Exported so the settings UI can recognise it (kind
 *  === 'hint') and so the test suite can assert on it directly. */
export const NO_PREMIUM_VOICE_HINT: TTSVoiceOption = {
  voiceURI: '__ios-voice-hint__',
  name: 'Download higher-quality voices: Settings → Accessibility → Spoken Content → Voices → English',
  lang: '',
  tier: null,
  kind: 'hint',
}

/**
 * Curates iOS's raw system voice list (everything `BereanSpeechPlugin.voices()` reports) down to
 * a small set of high-quality, natural-sounding, free, offline English voices:
 *  - English only, Premium/Enhanced quality only, novelty voices excluded outright;
 *  - ranked Premium before Enhanced, then by PREFERRED_VOICE_NAMES, then alphabetically;
 *  - capped at MAX_CURATED_VOICES.
 * If literally none qualify (a clean iOS install ships zero Enhanced/Premium voices until the
 * user downloads one), falls back to the single best non-novelty English voice available (any
 * tier) plus NO_PREMIUM_VOICE_HINT explaining how to get a better one. If there is no English
 * voice at all, only the hint row is returned.
 */
export function curateIosVoices(raw: TTSVoiceOption[]): TTSVoiceOption[] {
  const english = raw.filter((v) => isEnglish(v.lang) && !isNovelty(v.name))
  const highQuality = english.filter((v) => v.tier === 'Premium' || v.tier === 'Enhanced')
  if (highQuality.length > 0) {
    return [...highQuality].sort(byQualityThenPreference).slice(0, MAX_CURATED_VOICES)
  }
  if (english.length === 0) return [NO_PREMIUM_VOICE_HINT]
  const best = [...english].sort(byQualityThenPreference)[0]
  return [best, NO_PREMIUM_VOICE_HINT]
}

export function createNativeVoiceProvider(plugin: SpeechPluginLike): TTSVoiceProvider {
  let voices: TTSVoiceOption[] = []
  const subs = new Set<(v: TTSVoiceOption[]) => void>()
  let loaded = false
  const load = () => {
    if (loaded) return
    loaded = true
    plugin.voices().then((r) => {
      const all = r.voices.map((v): TTSVoiceOption => ({ voiceURI: v.id, name: v.name, lang: v.lang, tier: v.quality === 'Premium' ? 'Premium' : v.quality === 'Enhanced' ? 'Enhanced' : null }))
      voices = curateIosVoices(all)
      for (const cb of subs) cb(voices)
    }).catch(() => { loaded = false })
  }
  return {
    getVoices: () => { load(); return voices },
    subscribeVoices: (cb) => { subs.add(cb); load(); return () => { subs.delete(cb) } },
    isSupported: () => true,
  }
}
