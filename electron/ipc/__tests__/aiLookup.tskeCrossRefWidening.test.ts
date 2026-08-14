import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { AiLookupResult } from '../aiLookup'

// Unit tests for the TSKE-heading-search and cross-ref-seed-and-expand ACTIVE retrieval sources
// (Team C, task #11 — see the long comment block above searchTskeHeadingCandidates in
// aiLookup.ts for the full design rationale). Covers the pure/near-pure pieces directly:
//
//  - pickTopVotedNeighbors / selectCrossRefAnchors: genuinely pure, no DB involved.
//  - searchTskeHeadingCandidates / expandCrossRefNeighbors: thin DB-orchestration wrappers around
//    the above — tested here with crossrefs.ts/bible.ts mocked to fixed fixture data, so these
//    tests exercise the real capping/dedup/candidate-shaping logic without touching a real DB
//    (see aiLookup.scopeDetection.test.ts's own comment for why every DB-backed dependency of
//    this file must be mocked under plain vitest).
//
// Regression coverage: the vote-dedup fix in pickTopVotedNeighbors (a real bug found via the
// xref-stripes-healed/xref-creation-by-faith eval fixtures — see its own comment in aiLookup.ts)
// and the widenGuesses routing fix (TSKE/cross-ref-seed candidates must never structurally
// out-rank a real keyword hit — see the "Team C fix" comment above the evidencedGuesses split in
// runLookup) are the two most load-bearing behaviors here, so they're covered explicitly below.

let tskeMock: any[] = []
let crossRefsMock: Record<string, { refs: any[] }> = {}
let incomingCrossRefsMock: Record<string, { refs: any[] }> = {}
let verseDb: Record<string, string> = {}

vi.mock('../../db/bible', () => ({ getTextDb: () => null }))
vi.mock('../../db/berean', () => ({ getBereanDb: () => { throw new Error('not used') } }))
vi.mock('../bible', () => ({
  queryVerse: (bookId: string, chapter: number, verse: number) => {
    const key = `${bookId}|${chapter}|${verse}`
    return key in verseDb ? { verse_num: verse, text: verseDb[key] } : null
  },
  searchVerses: () => [],
}))
vi.mock('../crossrefs', () => ({
  searchTskeHeadingsByKeywords: () => tskeMock,
  getCrossRefsForVerse: (bookId: string, chapter: number, verse: number) =>
    crossRefsMock[`${bookId}|${chapter}|${verse}`] ?? { refs: [] },
  getIncomingCrossRefsForVerse: (bookId: string, chapter: number, verse: number) =>
    incomingCrossRefsMock[`${bookId}|${chapter}|${verse}`] ?? { refs: [] },
  getTskeForVerse: () => [], getIncomingTskeForVerse: () => [],
}))
vi.mock('../lexicon', () => ({ getLexiconEntry: () => null, getLexiconOccurrences: () => [], searchLexiconGloss: () => [], findByNormalizedTransliteration: () => null }))
vi.mock('../../ollama', () => ({
  checkOllamaAvailable: async () => ({ available: false }),
  runOllamaJson: async () => ({}), runOllamaText: async () => '',
  DEFAULT_OLLAMA_MODEL: 'test-model', unloadOllamaImmediately: () => {},
  NUM_CTX: 16384, NUM_PREDICT_JSON: 512,
}))
vi.mock('../youtube', () => ({ searchYoutubeVideos: () => [], searchYoutubeTranscripts: () => [] }))
vi.mock('@/lib/parseRef', () => ({ parseRef: () => null, isExactBookToken: () => false }))
vi.mock('../archaicVocab', () => ({ PSEUDEPIGRAPHA_ARCHAIC_VOCAB: [] }))
vi.mock('../semanticCandidates', () => ({ gatherSemanticCandidates: async () => [] }))

function makeResult(over: Partial<AiLookupResult>): AiLookupResult {
  return {
    textId: 'kjva', bookId: 'GEN', bookName: 'Genesis', chapter: 1, verse: 1,
    text: 'In the beginning God created the heaven and the earth.', source: 'ai-guess',
    ...over,
  }
}

function neighbor(over: Partial<{ bookId: string; chapter: number; verse: number; text: string; votes: number }>) {
  return { bookId: 'JHN', chapter: 1, verse: 1, text: 'sample text', votes: 100, ...over }
}

describe('TSKE heading search + cross-ref seed-and-expand widening', () => {
  let searchTskeHeadingCandidates: typeof import('../aiLookup').searchTskeHeadingCandidates
  let pickTopVotedNeighbors: typeof import('../aiLookup').pickTopVotedNeighbors
  let selectCrossRefAnchors: typeof import('../aiLookup').selectCrossRefAnchors
  let expandCrossRefNeighbors: typeof import('../aiLookup').expandCrossRefNeighbors

  beforeAll(async () => {
    ;({ searchTskeHeadingCandidates, pickTopVotedNeighbors, selectCrossRefAnchors, expandCrossRefNeighbors } = await import('../aiLookup'))
  })

  describe('pickTopVotedNeighbors', () => {
    it('dedupes the SAME verse appearing in both outgoing and incoming edges, keeping the higher vote', () => {
      // Regression test for the real bug found via xref-creation-by-faith: Gen 1:1 -> Jhn 1:1
      // (367, outgoing) and Jhn 1:1 -> Gen 1:1 (333, incoming) are two DB rows for the same real
      // edge. Without dedup, John 1:1 would occupy BOTH top-2 slots, starving out a genuinely
      // different neighbor (Heb 11:3, 268 votes) that should have made the cut on its own merit.
      const outgoing = [neighbor({ bookId: 'JHN', verse: 1, votes: 367 }), neighbor({ bookId: 'HEB', chapter: 11, verse: 3, votes: 268, text: 'through faith' })]
      const incoming = [neighbor({ bookId: 'JHN', verse: 1, votes: 333 })]
      const result = pickTopVotedNeighbors(outgoing, incoming)
      expect(result).toHaveLength(2)
      expect(result.map((r) => `${r.bookId} ${r.chapter}:${r.verse}`)).toEqual(['JHN 1:1', 'HEB 11:3'])
      // The higher of the two JHN 1:1 votes (367, not 333) is the one kept.
      expect(result[0].votes).toBe(367)
    })

    it('drops an edge below the min-vote floor', () => {
      const outgoing = [neighbor({ bookId: 'PSA', chapter: 1, verse: 1, votes: 5 })]
      expect(pickTopVotedNeighbors(outgoing, [])).toEqual([])
    })

    it('drops a negative-vote (crowd-flagged) edge even if it would otherwise be top-ranked', () => {
      const outgoing = [neighbor({ bookId: 'ROM', chapter: 1, verse: 1, votes: -20 }), neighbor({ bookId: 'PSA', chapter: 1, verse: 1, votes: 25 })]
      const result = pickTopVotedNeighbors(outgoing, [])
      expect(result.map((r) => r.bookId)).toEqual(['PSA'])
    })

    it('drops a neighbor with no resolved text rather than showing an empty body', () => {
      const outgoing = [neighbor({ bookId: 'PSA', chapter: 1, verse: 1, votes: 50, text: '' })]
      expect(pickTopVotedNeighbors(outgoing, [])).toEqual([])
    })

    it('caps at CROSS_REF_EXPAND_PER_ANCHOR_CAP (2) even with many qualifying edges', () => {
      const outgoing = [
        neighbor({ bookId: 'A', verse: 1, votes: 100 }),
        neighbor({ bookId: 'B', verse: 1, votes: 90 }),
        neighbor({ bookId: 'C', verse: 1, votes: 80 }),
      ]
      expect(pickTopVotedNeighbors(outgoing, [])).toHaveLength(2)
    })
  })

  describe('selectCrossRefAnchors', () => {
    it('only trusts a candidate with real corroborated evidence (score >= 2) as an anchor', () => {
      const strong = makeResult({ text: 'the fear of the Lord is the beginning of wisdom and a good understanding' })
      const weak = makeResult({ bookId: 'PSA', chapter: 2, text: 'unrelated text with no keyword overlap at all' })
      const anchors = selectCrossRefAnchors([strong, weak], ['fear of the lord'], [], false, 2)
      expect(anchors).toHaveLength(1)
      expect(anchors[0]).toBe(strong)
    })

    it('respects the cap', () => {
      const items = ['GEN', 'EXO', 'LEV'].map((b) => makeResult({ bookId: b, text: 'the fear of the Lord is real' }))
      const anchors = selectCrossRefAnchors(items, ['fear of the lord'], [], false, 1)
      expect(anchors).toHaveLength(1)
    })

    it('returns nothing when no candidate clears the evidence bar', () => {
      const weak = makeResult({ text: 'totally unrelated verse text' })
      expect(selectCrossRefAnchors([weak], ['fear of the lord'], [], false)).toEqual([])
    })
  })

  describe('searchTskeHeadingCandidates', () => {
    beforeAll(() => { verseDb = {} })

    it('resolves each TSKE hit against the real verse DB and tags it source: "tske"', () => {
      tskeMock = [{ heading: 'a good understanding', fromBook: 'PSA', fromCh: 111, fromVs: 10, toBook: 'JOS', toCh: 1, toVs: 7, toVsEnd: null, sortOrder: 2 }]
      verseDb = { 'JOS|1|7': 'Only be thou strong and very courageous...' }
      const out = searchTskeHeadingCandidates(['good understanding'])
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ source: 'tske', bookId: 'JOS', chapter: 1, verse: 7 })
    })

    it('drops a hit that does not resolve to a real verse rather than fabricating text', () => {
      tskeMock = [{ heading: 'a good understanding', fromBook: 'PSA', fromCh: 111, fromVs: 10, toBook: 'ZZZ', toCh: 99, toVs: 99, toVsEnd: null, sortOrder: 0 }]
      verseDb = {}
      expect(searchTskeHeadingCandidates(['good understanding'])).toEqual([])
    })

    it('dedupes repeated (toBook,toCh,toVs) hits across multiple heading rows', () => {
      tskeMock = [
        { heading: 'fear', fromBook: 'PSA', fromCh: 111, fromVs: 10, toBook: 'JOB', toCh: 28, toVs: 28, toVsEnd: null, sortOrder: 0 },
        { heading: 'fear', fromBook: 'PRO', fromCh: 1, fromVs: 7, toBook: 'JOB', toCh: 28, toVs: 28, toVsEnd: null, sortOrder: 0 },
      ]
      verseDb = { 'JOB|28|28': 'the fear of the Lord, that is wisdom' }
      expect(searchTskeHeadingCandidates(['fear'])).toHaveLength(1)
    })

    it('caps at TSKE_HEADING_CANDIDATE_CAP (6)', () => {
      tskeMock = Array.from({ length: 10 }, (_, i) => ({
        heading: 'fear', fromBook: 'PSA', fromCh: 111, fromVs: 10, toBook: 'GEN', toCh: 1, toVs: i + 1, toVsEnd: null, sortOrder: i,
      }))
      verseDb = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`GEN|1|${i + 1}`, `verse ${i + 1}`]))
      expect(searchTskeHeadingCandidates(['fear'])).toHaveLength(6)
    })
  })

  describe('expandCrossRefNeighbors', () => {
    it('turns an anchor into real, DB-verified neighbor candidates tagged source: "cross-ref-seed"', () => {
      crossRefsMock = { 'ISA|53|5': { refs: [{ bookId: '1PE', chapter: 3, verse: 18, votes: 128, text: 'For Christ also hath once suffered for sins' }] } }
      incomingCrossRefsMock = {}
      const anchor = makeResult({ bookId: 'ISA', chapter: 53, verse: 5, text: 'with his stripes we are healed' })
      const out = expandCrossRefNeighbors([anchor])
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ source: 'cross-ref-seed', bookId: '1PE', chapter: 3, verse: 18 })
    })

    it('caps total output at CROSS_REF_EXPAND_TOTAL_CAP (6) across multiple anchors', () => {
      const anchors = ['GEN', 'EXO', 'LEV', 'NUM'].map((b, i) => makeResult({ bookId: b, chapter: i + 1, verse: 1 }))
      crossRefsMock = Object.fromEntries(anchors.map((a) => [
        `${a.bookId}|${a.chapter}|${a.verse}`,
        { refs: [{ bookId: 'X', chapter: a.chapter, verse: 1, votes: 50, text: `n1-${a.bookId}` }, { bookId: 'Y', chapter: a.chapter, verse: 2, votes: 40, text: `n2-${a.bookId}` }] },
      ]))
      incomingCrossRefsMock = {}
      expect(expandCrossRefNeighbors(anchors)).toHaveLength(6)
    })

    it('dedupes a neighbor already produced by an earlier anchor', () => {
      crossRefsMock = {
        'GEN|1|1': { refs: [{ bookId: 'JHN', chapter: 1, verse: 1, votes: 300, text: 'In the beginning was the Word' }] },
        'PSA|33|6': { refs: [{ bookId: 'JHN', chapter: 1, verse: 1, votes: 200, text: 'In the beginning was the Word' }] },
      }
      incomingCrossRefsMock = {}
      const anchors = [makeResult({ bookId: 'GEN', chapter: 1, verse: 1 }), makeResult({ bookId: 'PSA', chapter: 33, verse: 6 })]
      expect(expandCrossRefNeighbors(anchors)).toHaveLength(1)
    })
  })
})
