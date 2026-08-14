import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked wholesale — this file's own job is the fusion/filtering glue, not embeddings.ts's Ollama
// call or index scan (those are covered by embeddingQuantize.test.ts and manual measurement; see
// the mission report). Never hits the network or a real index in a test.
const embedQueryMock = vi.fn()
const semanticSearchMock = vi.fn()
const hasEmbeddingIndexMock = vi.fn()
vi.mock('../../embeddings', () => ({
  embedQuery: (...args: unknown[]) => embedQueryMock(...args),
  semanticSearch: (...args: unknown[]) => semanticSearchMock(...args),
  hasEmbeddingIndex: () => hasEmbeddingIndexMock(),
}))

import { gatherSemanticCandidates } from '../semanticCandidates'

describe('gatherSemanticCandidates', () => {
  beforeEach(() => {
    embedQueryMock.mockReset()
    semanticSearchMock.mockReset()
    hasEmbeddingIndexMock.mockReset()
    hasEmbeddingIndexMock.mockReturnValue(true)
    embedQueryMock.mockResolvedValue(new Float32Array([1, 0, 0]))
  })

  it('returns [] immediately when no index is built, without calling embedQuery', async () => {
    hasEmbeddingIndexMock.mockReturnValue(false)
    const out = await gatherSemanticCandidates('what does the Bible say about anxiety', [], new Set())
    expect(out).toEqual([])
    expect(embedQueryMock).not.toHaveBeenCalled()
  })

  it('returns [] when embedQuery throws (Ollama unreachable) instead of propagating', async () => {
    embedQueryMock.mockRejectedValue(new Error('Ollama request failed: 500'))
    const out = await gatherSemanticCandidates('what does the Bible say about anxiety', [], new Set())
    expect(out).toEqual([])
  })

  it('returns [] when semanticSearch returns null (index present but failed to load)', async () => {
    semanticSearchMock.mockReturnValue(null)
    const out = await gatherSemanticCandidates('q', [], new Set())
    expect(out).toEqual([])
  })

  it('excludes hits already present in alreadySeenKeys', async () => {
    semanticSearchMock.mockReturnValue([
      { textId: 'kjva', bookId: 'MAT', chapter: 6, verseNum: 25, score: 0.9 },
      { textId: 'kjva', bookId: 'PHP', chapter: 4, verseNum: 6, score: 0.8 },
    ])
    const seen = new Set(['kjva|MAT|6|25'])
    const out = await gatherSemanticCandidates('anxiety', [], seen)
    expect(out).toEqual([{ textId: 'kjva', bookId: 'PHP', chapter: 4, verseNum: 6 }])
  })

  it('caps results at resultCap', async () => {
    semanticSearchMock.mockReturnValue([
      { textId: 'kjva', bookId: 'MAT', chapter: 6, verseNum: 25, score: 0.9 },
      { textId: 'kjva', bookId: 'PHP', chapter: 4, verseNum: 6, score: 0.8 },
      { textId: 'kjva', bookId: '1PE', chapter: 5, verseNum: 7, score: 0.7 },
    ])
    const out = await gatherSemanticCandidates('anxiety', [], new Set(), { resultCap: 2 })
    expect(out).toHaveLength(2)
  })

  it('passes restrictToTextId through to semanticSearch (focus-text scoping)', async () => {
    semanticSearchMock.mockReturnValue([])
    await gatherSemanticCandidates('q', [], new Set(), { restrictToTextId: 'jubilees' })
    expect(semanticSearchMock).toHaveBeenCalledWith(expect.anything(), 20, 'jubilees')
  })

  it('a candidate that ALSO appears in the keyword-ranked list ranks ahead of a semantic-only one, via RRF', async () => {
    // Both are new (not in alreadySeenKeys) so both are eligible to be returned — RRF should
    // still favor the one corroborated by both signals.
    semanticSearchMock.mockReturnValue([
      { textId: 'kjva', bookId: 'JOB', chapter: 3, verseNum: 21, score: 0.5 }, // semantic-only, rank 1 in semantic list
      { textId: 'kjva', bookId: 'REV', chapter: 9, verseNum: 6, score: 0.4 }, // rank 2 in semantic list, but ALSO in keyword list
    ])
    const keywordRankedKeys = ['kjva|REV|9|6'] // appears here too -> should win the fused ordering
    const out = await gatherSemanticCandidates('q', keywordRankedKeys, new Set())
    expect(out[0]).toEqual({ textId: 'kjva', bookId: 'REV', chapter: 9, verseNum: 6 })
  })
})
