import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { YoutubeVideoSearchResult, YoutubeTranscriptSearchResult } from '../youtube'

// Regression tests for Team 3b item #3: transcript-content video search merged alongside the
// existing title/channel-name search — see mergeVideoSearchResults' own comment in aiLookup.ts
// for the interleaving rationale. Same DB-dependency mocking approach as
// aiLookup.verifyGeneratedText.test.ts — this file only exercises the pure merge function, never
// touches a real DB.

vi.mock('../../db/bible', () => ({ getTextDb: () => null }))
vi.mock('../../db/berean', () => ({ getBereanDb: () => { throw new Error('not used') } }))
vi.mock('../crossrefs', () => ({
  getCrossRefsForVerse: () => [], getTskeForVerse: () => [],
  getIncomingCrossRefsForVerse: () => [], getIncomingTskeForVerse: () => [],
}))
vi.mock('../lexicon', () => ({ getLexiconEntry: () => null, getLexiconOccurrences: () => [] }))
vi.mock('../../ollama', () => ({
  checkOllamaAvailable: async () => ({ available: false }),
  runOllamaJson: async () => ({}), runOllamaText: async () => '',
  DEFAULT_OLLAMA_MODEL: 'test-model', unloadOllamaImmediately: () => {},
  NUM_CTX: 16384, NUM_PREDICT_JSON: 512,
}))
vi.mock('../youtube', () => ({ searchYoutubeVideos: () => [], searchYoutubeTranscripts: () => [] }))
vi.mock('../archaicVocab', () => ({ PSEUDEPIGRAPHA_ARCHAIC_VOCAB: [] }))

function titleMatch(over: Partial<YoutubeVideoSearchResult>): YoutubeVideoSearchResult {
  return { videoId: 'v1', title: 'Title', channelName: 'Chan', thumbnailUrl: 'thumb.jpg', type: 'video', published: '2024-01-01', ...over }
}
function transcriptMatch(over: Partial<YoutubeTranscriptSearchResult>): YoutubeTranscriptSearchResult {
  return { videoId: 't1', title: 'Title', channelName: 'Chan', thumbnailUrl: 'thumb.jpg', startMs: 12000, snippet: 'a snippet', ...over }
}

describe('mergeVideoSearchResults', () => {
  let mergeVideoSearchResults: typeof import('../aiLookup').mergeVideoSearchResults

  beforeAll(async () => {
    ;({ mergeVideoSearchResults } = await import('../aiLookup'))
  })

  it('interleaves title and transcript matches rather than exhausting one list first', () => {
    const titles = [titleMatch({ videoId: 'a' }), titleMatch({ videoId: 'b' })]
    const transcripts = [transcriptMatch({ videoId: 'c' }), transcriptMatch({ videoId: 'd' })]
    const merged = mergeVideoSearchResults(titles, transcripts, 4)
    expect(merged.map((v) => v.videoId)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('a transcript hit carries startMs/snippet; a title hit does not', () => {
    const merged = mergeVideoSearchResults([titleMatch({ videoId: 'a' })], [transcriptMatch({ videoId: 'c' })], 4)
    const titleResult = merged.find((v) => v.videoId === 'a')!
    const transcriptResult = merged.find((v) => v.videoId === 'c')!
    expect(titleResult.startMs).toBeUndefined()
    expect(titleResult.snippet).toBeUndefined()
    expect(transcriptResult.startMs).toBe(12000)
    expect(transcriptResult.snippet).toBe('a snippet')
  })

  it('dedupes the same video appearing in both lists, keeping the title-match version', () => {
    const merged = mergeVideoSearchResults([titleMatch({ videoId: 'same' })], [transcriptMatch({ videoId: 'same' })], 4)
    expect(merged).toHaveLength(1)
    expect(merged[0].startMs).toBeUndefined() // title version won, not the transcript one
  })

  it('respects the limit', () => {
    const titles = [titleMatch({ videoId: 'a' }), titleMatch({ videoId: 'b' }), titleMatch({ videoId: 'c' })]
    const transcripts = [transcriptMatch({ videoId: 'd' }), transcriptMatch({ videoId: 'e' })]
    const merged = mergeVideoSearchResults(titles, transcripts, 3)
    expect(merged).toHaveLength(3)
  })

  it('handles an empty transcript list gracefully (falls back to title-only, same as before this feature)', () => {
    const titles = [titleMatch({ videoId: 'a' }), titleMatch({ videoId: 'b' })]
    const merged = mergeVideoSearchResults(titles, [], 8)
    expect(merged.map((v) => v.videoId)).toEqual(['a', 'b'])
  })
})
