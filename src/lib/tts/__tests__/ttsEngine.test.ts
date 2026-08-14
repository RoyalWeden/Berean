import { describe, it, expect, vi } from 'vitest'
import { ttsEngine, setActiveTTSBackend, getActiveTTSBackend } from '../ttsEngine'
import type { TTSBackend, TTSVoiceProvider, TTSVoiceOption } from '../ttsBackend'

// Verifies the item-1 seam: `ttsEngine` (and `getVoices`/`subscribeVoices`/`isTTSSupported`,
// covered indirectly) is a stable-identity facade that forwards to whatever backend is
// currently active, NOT a hardcoded reference to the Web Speech implementation. This is what
// lets a future backend (e.g. Kokoro) be registered via setActiveTTSBackend() with zero changes
// to useTTSPlayback.ts/store/index.ts/AudioSection.tsx, which all import `ttsEngine` from this
// module and never touch a concrete backend class directly.
function makeFakeBackend(): TTSBackend & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    speakChapter: (...args) => { calls.push('speakChapter'); void args },
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    stop: () => calls.push('stop'),
    skipToVerse: (i) => { calls.push(`skipToVerse:${i}`) },
    setRate: (r) => { calls.push(`setRate:${r}`) },
    setVoice: (v) => { calls.push(`setVoice:${v}`) },
    previewVoice: (text, voiceURI, rate, onEnd) => { calls.push(`previewVoice:${text}:${voiceURI}:${rate}`); onEnd?.() },
    isActive: true,
    isPaused: false,
    activeIndex: 3,
  }
}

const fakeVoiceProvider: TTSVoiceProvider = {
  getVoices: () => [{ voiceURI: 'fake-1', name: 'Fake Voice', lang: 'en-US' } satisfies TTSVoiceOption],
  subscribeVoices: () => () => {},
  isSupported: () => true,
}

describe('ttsEngine facade — swappable backend', () => {
  it('forwards every TTSBackend method to the currently active backend', () => {
    const fake = makeFakeBackend()
    setActiveTTSBackend(fake, fakeVoiceProvider)
    expect(getActiveTTSBackend()).toBe(fake)

    ttsEngine.speakChapter([], { rate: 1, voiceURI: null })
    ttsEngine.pause()
    ttsEngine.resume()
    ttsEngine.skipToVerse(2)
    ttsEngine.setRate(1.5)
    ttsEngine.setVoice('some-voice')
    const onEnd = vi.fn()
    ttsEngine.previewVoice('hello', 'v1', 1, onEnd)
    ttsEngine.stop()

    expect(fake.calls).toEqual([
      'speakChapter', 'pause', 'resume', 'skipToVerse:2', 'setRate:1.5',
      'setVoice:some-voice', 'previewVoice:hello:v1:1', 'stop',
    ])
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('getter properties (isActive/isPaused/activeIndex) also read through to the active backend', () => {
    const fake = makeFakeBackend()
    setActiveTTSBackend(fake, fakeVoiceProvider)
    expect(ttsEngine.isActive).toBe(true)
    expect(ttsEngine.isPaused).toBe(false)
    expect(ttsEngine.activeIndex).toBe(3)
  })

  it('`ttsEngine` keeps the same object identity across a backend swap — existing call sites never re-import it', () => {
    const before = ttsEngine
    setActiveTTSBackend(makeFakeBackend(), fakeVoiceProvider)
    expect(ttsEngine).toBe(before)
  })
})
