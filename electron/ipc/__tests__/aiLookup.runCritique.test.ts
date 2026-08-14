import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression test for Team 3b item #1: the critique call must degrade to "no opinion" (null) on
// ANY failure — timeout, malformed JSON, an Ollama hiccup, or Ollama being unavailable — never
// throw out of runLookup. Same DB-dependency mocking approach as the other aiLookup test files.

vi.mock('../../db/bible', () => ({ getTextDb: () => null }))
vi.mock('../../db/berean', () => ({ getBereanDb: () => { throw new Error('not used') } }))
vi.mock('../crossrefs', () => ({
  getCrossRefsForVerse: () => [], getTskeForVerse: () => [],
  getIncomingCrossRefsForVerse: () => [], getIncomingTskeForVerse: () => [],
}))
vi.mock('../lexicon', () => ({ getLexiconEntry: () => null, getLexiconOccurrences: () => [] }))
vi.mock('../youtube', () => ({ searchYoutubeVideos: () => [], searchYoutubeTranscripts: () => [] }))
vi.mock('../archaicVocab', () => ({ PSEUDEPIGRAPHA_ARCHAIC_VOCAB: [] }))

const runOllamaJsonMock = vi.fn()
vi.mock('../../ollama', () => ({
  checkOllamaAvailable: async () => ({ available: false }),
  runOllamaJson: (...args: unknown[]) => runOllamaJsonMock(...args),
  runOllamaText: async () => '',
  DEFAULT_OLLAMA_MODEL: 'test-model', unloadOllamaImmediately: () => {},
  NUM_CTX: 16384, NUM_PREDICT_JSON: 512,
}))

describe('runCritique', () => {
  let runCritique: typeof import('../aiLookup').runCritique

  beforeEach(async () => {
    runOllamaJsonMock.mockReset()
    ;({ runCritique } = await import('../aiLookup'))
  })

  it('returns the real verdict on a clean call', async () => {
    const verdict = { answersQuestion: true, leadKind: 'verses' as const }
    runOllamaJsonMock.mockResolvedValueOnce(verdict)
    const result = await runCritique('q', { keywords: ['a'] }, [], [], [], 'test-model')
    expect(result).toEqual(verdict)
  })

  it('degrades to null on a thrown error (malformed JSON, timeout, Ollama hiccup)', async () => {
    runOllamaJsonMock.mockRejectedValueOnce(new Error('boom'))
    const result = await runCritique('q', { keywords: ['a'] }, [], [], [], 'test-model')
    expect(result).toBeNull()
  })
})
