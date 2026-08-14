import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { AiLookupResult } from '../aiLookup'

// Regression tests for defect #6a: deterministic, always-on (fast mode included) fact-checking of
// the commentary model's free-text summary/per-verse captions against the real, already-DB-
// verified candidate set — catches a fabricated reference or a misquoted/invented "quotation"
// before it ever reaches the user, with no extra model call. See mocking-rationale comment in
// aiLookup.scopeDetection.test.ts — same DB-dependency mocking approach applies here.

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
// The real parseRef/isExactBookToken (not mocked — needed for real reference extraction).

function makeResult(over: Partial<AiLookupResult>): AiLookupResult {
  return {
    textId: 'kjva', bookId: 'GEN', bookName: 'Genesis', chapter: 1, verse: 1,
    text: 'In the beginning God created the heaven and the earth.', source: 'ai-guess',
    ...over,
  }
}

describe('verifyGeneratedText / extractQuotedSpans / appendVerificationCaveat', () => {
  let verifyGeneratedText: typeof import('../aiLookup').verifyGeneratedText
  let extractQuotedSpans: typeof import('../aiLookup').extractQuotedSpans
  let appendVerificationCaveat: typeof import('../aiLookup').appendVerificationCaveat

  beforeAll(async () => {
    ;({ verifyGeneratedText, extractQuotedSpans, appendVerificationCaveat } = await import('../aiLookup'))
  })

  it('extracts a double-quoted span but not a single-quoted possessive', () => {
    expect(extractQuotedSpans('He said "let there be light" and God\'s will was done.')).toEqual(['let there be light'])
  })

  it('finds no problems when the summary only cites/quotes what was actually retrieved', () => {
    const candidates = [makeResult({})]
    const summary = 'Genesis 1:1 says "In the beginning God created the heaven and the earth."'
    const result = verifyGeneratedText(summary, candidates)
    expect(result.unverifiedRefs).toEqual([])
    expect(result.unverifiedQuotes).toEqual([])
  })

  it('flags a reference to a verse that was never among the retrieved candidates', () => {
    const candidates = [makeResult({})]
    const summary = 'This connects directly to Romans 8:28, which says something similar.'
    const result = verifyGeneratedText(summary, candidates)
    expect(result.unverifiedRefs).toEqual(['ROM 8:28'])
  })

  it('flags a quoted span that does not match any candidate\'s real text', () => {
    const candidates = [makeResult({})]
    const summary = 'Genesis 1:1 says "and darkness covered the deep like a blanket."'
    const result = verifyGeneratedText(summary, candidates)
    expect(result.unverifiedQuotes).toEqual(['and darkness covered the deep like a blanket.'])
  })

  it('does not flag a real reference that IS among the candidates, including a merged range', () => {
    const candidates = [makeResult({ verse: 1, endVerse: 3 })]
    const result = verifyGeneratedText('See Genesis 1:2 for more.', candidates)
    expect(result.unverifiedRefs).toEqual([])
  })

  it('appendVerificationCaveat adds a caveat only when something was flagged', () => {
    const clean = verifyGeneratedText('all good', [])
    expect(appendVerificationCaveat('A clean summary.', clean)).toBe('A clean summary.')

    const dirty = { unverifiedRefs: ['ROM 8:28'], unverifiedQuotes: [] }
    const withCaveat = appendVerificationCaveat('A summary.', dirty)
    expect(withCaveat).toContain('A summary.')
    expect(withCaveat).toContain('ROM 8:28')
  })

  it('appendVerificationCaveat is a no-op on an empty/undefined summary', () => {
    expect(appendVerificationCaveat(undefined, { unverifiedRefs: ['ROM 8:28'], unverifiedQuotes: [] })).toBeUndefined()
  })
})
