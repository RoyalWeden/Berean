import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { isCacheKey } from '../ttsAudioCache'

describe('audio cache keys', () => {
  it('accepts the keys Read Aloud makes', () => {
    expect(isCacheKey('kjva__GEN__1__af_heart__abc123__t9f8e')).toBe(true)
  })
  it('refuses anything that could leave the cache folder', () => {
    for (const k of ['../../secret', '..\\\\x', 'a/b', 'a\\\\b', '', 'x'.repeat(513), null, 1]) expect(isCacheKey(k)).toBe(false)
  })
})
