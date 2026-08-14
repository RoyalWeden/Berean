import { describe, it, expect } from 'vitest'
import {
  cacheKeyFor, hashText, planEviction, encodeCachedChunk, decodeCachedChunk,
  DEFAULT_AUDIO_CACHE_CAP_BYTES, type AudioCacheEntry,
} from '../audioCacheStore'

describe('cacheKeyFor', () => {
  const base = { backendId: 'kokoro', textId: 'kjva', bookId: 'GEN', chapter: 1, voiceURI: 'af_heart', rate: 1, contentHash: 'abc' }

  it('is deterministic for identical inputs', () => {
    expect(cacheKeyFor(base)).toBe(cacheKeyFor({ ...base }))
  })

  it('rounds rate to 2 decimal places so near-identical rates collapse to the same key', () => {
    expect(cacheKeyFor({ ...base, rate: 1.0 })).toBe(cacheKeyFor({ ...base, rate: 1.001 }))
  })

  it('differs when any meaningful field differs', () => {
    const k = cacheKeyFor(base)
    expect(cacheKeyFor({ ...base, bookId: 'EXO' })).not.toBe(k)
    expect(cacheKeyFor({ ...base, chapter: 2 })).not.toBe(k)
    expect(cacheKeyFor({ ...base, voiceURI: 'af_bella' })).not.toBe(k)
    expect(cacheKeyFor({ ...base, rate: 1.5 })).not.toBe(k)
    expect(cacheKeyFor({ ...base, contentHash: 'xyz' })).not.toBe(k)
  })

  it('sanitizes characters unsafe for a filename', () => {
    const key = cacheKeyFor({ ...base, voiceURI: 'weird/voice:id' })
    expect(key).not.toMatch(/[/:]/)
  })
})

describe('hashText', () => {
  it('is deterministic', () => {
    expect(hashText('In the beginning')).toBe(hashText('In the beginning'))
  })

  it('differs for different text (so a word-replacer change busts the cache)', () => {
    expect(hashText('In the beginning God created')).not.toBe(hashText('In the beginning Yehovah created'))
  })
})

describe('encodeCachedChunk / decodeCachedChunk', () => {
  it('round-trips sampling rate and PCM samples exactly', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])
    const encoded = encodeCachedChunk(24000, samples)
    const decoded = decodeCachedChunk(encoded)
    expect(decoded.samplingRate).toBe(24000)
    expect(Array.from(decoded.samples)).toEqual(Array.from(samples))
  })

  it('handles an empty sample array', () => {
    const decoded = decodeCachedChunk(encodeCachedChunk(24000, new Float32Array(0)))
    expect(decoded.samples.length).toBe(0)
  })
})

describe('planEviction', () => {
  const entry = (key: string, sizeBytes: number, lastAccessedAt: number): AudioCacheEntry => ({ key, sizeBytes, lastAccessedAt })

  it('evicts nothing when the incoming entry fits under the cap', () => {
    const entries = [entry('a', 100, 1), entry('b', 100, 2)]
    expect(planEviction(entries, 50, 1000)).toEqual([])
  })

  it('evicts the OLDEST entries first (by lastAccessedAt), not insertion order', () => {
    const entries = [entry('newest', 100, 300), entry('oldest', 100, 100), entry('middle', 100, 200)]
    // Cap 250, existing total 300 — adding 50 more needs 100 bytes freed, i.e. one eviction.
    expect(planEviction(entries, 50, 250)).toEqual(['oldest'])
  })

  it('evicts multiple entries in age order until under the cap', () => {
    const entries = [entry('a', 100, 1), entry('b', 100, 2), entry('c', 100, 3)]
    // total=300, +100 incoming = 400 vs cap 150 → overBy 250, needs all three (300) evicted.
    expect(planEviction(entries, 100, 150)).toEqual(['a', 'b', 'c'])
  })

  it('stops evicting as soon as it\'s freed enough, even if older entries remain', () => {
    const entries = [entry('a', 100, 1), entry('b', 100, 2), entry('c', 100, 3)]
    // total=300, +50 incoming = 350 vs cap 250 → overBy 100, one eviction (100) is enough.
    expect(planEviction(entries, 50, 250)).toEqual(['a'])
  })

  it('evicts everything when even the new entry alone exceeds the cap', () => {
    const entries = [entry('a', 100, 1)]
    expect(planEviction(entries, 1000, 200)).toEqual(['a'])
  })

  it('never mutates the input array', () => {
    const entries = [entry('a', 100, 1), entry('b', 100, 2)]
    const copy = entries.map((e) => ({ ...e }))
    planEviction(entries, 500, 100)
    expect(entries).toEqual(copy)
  })

  it('treats a non-positive cap as "evict everything"', () => {
    const entries = [entry('a', 1, 1)]
    expect(planEviction(entries, 1, 0)).toEqual(['a'])
  })

  it('DEFAULT_AUDIO_CACHE_CAP_BYTES is a sane positive size', () => {
    expect(DEFAULT_AUDIO_CACHE_CAP_BYTES).toBeGreaterThan(10 * 1024 * 1024)
  })
})
