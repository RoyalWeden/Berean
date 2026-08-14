import { describe, it, expect } from 'vitest'
import { KOKORO_VOICE_OPTIONS, KOKORO_VOICE_IDS, DEFAULT_KOKORO_VOICE_ID, isKokoroVoiceId } from '../kokoroVoices'

describe('KOKORO_VOICE_OPTIONS', () => {
  it('has unique voiceURIs', () => {
    const ids = KOKORO_VOICE_OPTIONS.map((v) => v.voiceURI)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('KOKORO_VOICE_IDS is exactly the same set of ids, in the same order', () => {
    expect(KOKORO_VOICE_IDS).toEqual(KOKORO_VOICE_OPTIONS.map((v) => v.voiceURI))
  })

  it('every voice has a non-empty name and lang', () => {
    for (const v of KOKORO_VOICE_OPTIONS) {
      expect(v.name.length).toBeGreaterThan(0)
      expect(v.lang.length).toBeGreaterThan(0)
    }
  })

  it('only uses the Premium/Enhanced/null tier vocabulary shared with Web Speech voices', () => {
    for (const v of KOKORO_VOICE_OPTIONS) {
      expect([null, 'Premium', 'Enhanced']).toContain(v.tier)
    }
  })

  it('the default voice id is a real, known voice', () => {
    expect(KOKORO_VOICE_IDS).toContain(DEFAULT_KOKORO_VOICE_ID)
  })
})

describe('isKokoroVoiceId', () => {
  it('true for a real Kokoro voice id', () => {
    expect(isKokoroVoiceId('af_heart')).toBe(true)
  })

  it('false for a Web Speech voiceURI (different id space entirely)', () => {
    expect(isKokoroVoiceId('com.apple.speech.synthesis.voice.samantha')).toBe(false)
  })

  it('false for null', () => {
    expect(isKokoroVoiceId(null)).toBe(false)
  })
})
