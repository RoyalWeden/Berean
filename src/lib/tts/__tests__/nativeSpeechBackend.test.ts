import { describe, it, expect } from 'vitest'
import { NativeSpeechBackend, createNativeVoiceProvider } from '../nativeSpeechBackend'
import type { SpokenVerse } from '../extractSpokenText'

/** A fake of BereanSpeechPlugin: records speak calls and lets the test fire the delegate events. */
function fakePlugin() {
  const listeners = new Map<string, Array<(e: { id: string; charIndex?: number; charLength?: number }) => void>>()
  const spoken: Array<{ id: string; text: string; voice?: string | null; rate?: number }> = []
  const calls: string[] = []
  return {
    spoken, calls,
    fire(event: string, e: { id: string; charIndex?: number; charLength?: number }) { for (const cb of listeners.get(event) ?? []) cb(e) },
    async voices() { return { voices: [{ id: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', lang: 'en-US', quality: 'Default' }, { id: 'fr', name: 'Thomas', lang: 'fr-FR', quality: 'Enhanced' }] } },
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

  it('voice provider lists system voices (English first, tiers mapped) and notifies subscribers', async () => {
    const p = fakePlugin()
    const vp = createNativeVoiceProvider(p)
    const seen: string[][] = []
    vp.subscribeVoices((v) => seen.push(v.map((x) => x.name)))
    await tick(); await tick()
    expect(seen).toEqual([['Samantha', 'Thomas']])
    expect(vp.getVoices()[1].tier).toBe('Enhanced')
    expect(vp.isSupported()).toBe(true)
  })
})
