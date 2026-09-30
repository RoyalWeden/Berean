import { describe, it, expect } from 'vitest'
import { NativeSpeechBackend, createNativeVoiceProvider, curateIosVoices, NO_PREMIUM_VOICE_HINT } from '../nativeSpeechBackend'
import type { TTSVoiceOption } from '../ttsBackend'
import type { SpokenVerse } from '../extractSpokenText'

/** A fake of BereanSpeechPlugin: records speak calls and lets the test fire the delegate events. */
function fakePlugin(voiceList?: Array<{ id: string; name: string; lang: string; quality: string }>) {
  const listeners = new Map<string, Array<(e: { id: string; charIndex?: number; charLength?: number }) => void>>()
  const spoken: Array<{ id: string; text: string; voice?: string | null; rate?: number }> = []
  const calls: string[] = []
  return {
    spoken, calls,
    fire(event: string, e: { id: string; charIndex?: number; charLength?: number }) { for (const cb of listeners.get(event) ?? []) cb(e) },
    async voices() {
      return {
        voices: voiceList ?? [
          { id: 'com.apple.voice.enhanced.en-US.Ava', name: 'Ava', lang: 'en-US', quality: 'Enhanced' },
          { id: 'fr', name: 'Thomas', lang: 'fr-FR', quality: 'Enhanced' },
        ],
      }
    },
    async speak(o: { id: string; text: string; voice?: string | null; rate?: number }) { spoken.push(o); calls.push(`speak:${o.id}`) },
    async pause() { calls.push('pause') },
    async resume() { calls.push('resume') },
    async stop() { calls.push('stop') },
    async addListener(event: string, cb: (e: { id: string; charIndex?: number; charLength?: number }) => void) {
      const arr = listeners.get(event) ?? []; arr.push(cb); listeners.set(event, arr)
      return { remove: async () => {} }
    },
  }
}
const verse = (n: number, words: string[]): SpokenVerse => {
  let pos = 0
  const ws = words.map((w, i) => { const s = pos; pos += w.length + 1; return { text: w, charStart: s, charLen: w.length, wordIndex: i } })
  return { bookId: 'GEN', chapter: 1, verseNum: n, words: ws, spokenText: words.join(' ') }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('NativeSpeechBackend', () => {
  it('speaks verses one after another, reports verse starts, word boundaries and chapter end', async () => {
    const p = fakePlugin()
    const b = new NativeSpeechBackend(p)
    const events: string[] = []
    b.speakChapter([verse(1, ['In', 'the', 'beginning']), verse(2, ['And', 'the', 'earth'])], {
      rate: 1.2, voiceURI: 'v1',
      onVerseStart: (i, v) => events.push(`start:${i}:${v.verseNum}`),
      onWordBoundary: (i, w) => events.push(`word:${i}:${w.wordIndex}`),
      onChapterEnd: () => events.push('end'),
    })
    await tick(); await tick()
    expect(p.spoken.length).toBe(1)
    expect(p.spoken[0]).toMatchObject({ text: 'In the beginning', voice: 'v1', rate: 1.2 })
    expect(b.isActive).toBe(true); expect(b.activeIndex).toBe(0)
    p.fire('start', { id: p.spoken[0].id })
    p.fire('boundary', { id: p.spoken[0].id, charIndex: 3, charLength: 3 })     // "the"
    p.fire('boundary', { id: p.spoken[0].id, charIndex: 7, charLength: 9 })     // "beginning"
    p.fire('end', { id: p.spoken[0].id })
    await tick(); await tick()
    expect(p.spoken.length).toBe(2)
    expect(p.spoken[1].text).toBe('And the earth')
    p.fire('start', { id: p.spoken[1].id })
    p.fire('end', { id: p.spoken[1].id })
    await tick()
    expect(events).toEqual(['start:0:1', 'word:0:1', 'word:0:2', 'start:1:2', 'end'])
    expect(b.isActive).toBe(false)
  })

  it('ignores stale events after stop/skip and restarts at the requested verse', async () => {
    const p = fakePlugin()
    const b = new NativeSpeechBackend(p)
    const starts: number[] = []
    b.speakChapter([verse(1, ['a']), verse(2, ['b']), verse(3, ['c'])], { rate: 1, voiceURI: null, onVerseStart: (i) => starts.push(i) })
    await tick(); await tick()
    const first = p.spoken[0].id
    b.skipToVerse(2)
    await tick(); await tick()
    p.fire('end', { id: first })                 // the cancelled utterance ending late must not advance anything
    await tick()
    expect(p.spoken.map((s) => s.text)).toEqual(['a', 'c'])
    p.fire('start', { id: p.spoken[1].id })
    expect(starts).toEqual([2])
    b.pause(); expect(b.isPaused).toBe(true)
    b.resume(); expect(b.isPaused).toBe(false)
    b.stop()
    expect(b.isActive).toBe(false)
    expect(p.calls.filter((c) => c === 'stop').length).toBeGreaterThanOrEqual(2)
  })

  it('voice provider curates to English Premium/Enhanced voices only and notifies subscribers', async () => {
    const p = fakePlugin()
    const vp = createNativeVoiceProvider(p)
    const seen: string[][] = []
    vp.subscribeVoices((v) => seen.push(v.map((x) => x.name)))
    await tick(); await tick()
    // 'Thomas' (fr-FR) is filtered out: curation is English-only regardless of tier.
    expect(seen).toEqual([['Ava']])
    expect(vp.getVoices()[0].tier).toBe('Enhanced')
    expect(vp.isSupported()).toBe(true)
  })
})

describe('curateIosVoices', () => {
  const v = (over: Partial<TTSVoiceOption>): TTSVoiceOption => ({ voiceURI: over.name ?? 'id', name: 'Voice', lang: 'en-US', tier: null, ...over })

  it('filters out non-English voices', () => {
    const out = curateIosVoices([v({ name: 'Ava', tier: 'Enhanced' }), v({ name: 'Thomas', lang: 'fr-FR', tier: 'Premium' })])
    expect(out.map((x) => x.name)).toEqual(['Ava'])
  })

  it('filters out Default/compact-quality voices when a better one exists', () => {
    const out = curateIosVoices([v({ name: 'Ava', tier: 'Enhanced' }), v({ name: 'Samantha', tier: null })])
    expect(out.map((x) => x.name)).toEqual(['Ava'])
  })

  it('filters out novelty/Eloquence voices even if reported as high quality', () => {
    const out = curateIosVoices([v({ name: 'Ava', tier: 'Enhanced' }), v({ name: 'Zarvox', tier: 'Enhanced' }), v({ name: 'Bad News', tier: 'Premium' })])
    expect(out.map((x) => x.name)).toEqual(['Ava'])
  })

  it('ranks Premium before Enhanced, then by the preferred-name list, then alphabetically', () => {
    const out = curateIosVoices([
      v({ name: 'Nathan', tier: 'Enhanced' }),
      v({ name: 'Zoe', tier: 'Enhanced' }),
      v({ name: 'Karen', tier: 'Premium' }),
      v({ name: 'Ava', tier: 'Enhanced' }),
    ])
    // Karen is Premium so ranks first despite not being in the preferred list; among the
    // Enhanced voices, Ava and Zoe outrank Nathan per PREFERRED_VOICE_NAMES order.
    expect(out.map((x) => x.name)).toEqual(['Karen', 'Ava', 'Zoe', 'Nathan'])
  })

  it('caps the curated list at 6 voices', () => {
    const many = ['Ava', 'Zoe', 'Evan', 'Nathan', 'Karen', 'Daniel', 'Serena', 'Moira'].map((name) => v({ name, tier: 'Enhanced' }))
    expect(curateIosVoices(many)).toHaveLength(6)
  })

  it('matches "Name (Enhanced)"-suffixed names against the novelty/preferred lists the same as the bare name', () => {
    const out = curateIosVoices([v({ name: 'Samantha (Enhanced)', tier: 'Enhanced' }), v({ name: 'Zarvox (Enhanced)', tier: 'Enhanced' })])
    expect(out.map((x) => x.name)).toEqual(['Samantha (Enhanced)'])
  })

  it('falls back to the single best available voice plus the download hint when no Premium/Enhanced English voice is installed', () => {
    const out = curateIosVoices([v({ name: 'Samantha', tier: null }), v({ name: 'Daniel', tier: null })])
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Samantha') // earlier in PREFERRED_VOICE_NAMES than 'Daniel'
    expect(out[0].kind).toBeUndefined()
    expect(out[1]).toEqual(NO_PREMIUM_VOICE_HINT)
  })

  it('returns only the hint when there is no usable English voice at all', () => {
    const out = curateIosVoices([v({ name: 'Thomas', lang: 'fr-FR', tier: 'Enhanced' })])
    expect(out).toEqual([NO_PREMIUM_VOICE_HINT])
  })

  it('never exposes a generic system voice alongside a hint or a curated pick', () => {
    const out = curateIosVoices([v({ name: 'Ava', tier: 'Enhanced' }), v({ name: 'Samantha', tier: null })])
    expect(out.some((x) => x.name === 'Samantha')).toBe(false)
  })
})
