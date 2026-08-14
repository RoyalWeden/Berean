import { describe, it, expect, vi, beforeAll } from 'vitest'

// Regression tests for Team 3b items #1/#2: the plan/critique loop's `answerKind`/`leadKind`
// degradation, and the notes-vs-scripture lead decision replacing the old "the NOTE_ASK_TRIGGER
// regex fired" rule. Same DB-dependency mocking approach as the other aiLookup unit test files —
// only pure functions are exercised here, no real DB/Ollama ever touched.

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

describe('decideNotesAreLead', () => {
  let decideNotesAreLead: typeof import('../aiLookup').decideNotesAreLead

  beforeAll(async () => {
    ;({ decideNotesAreLead } = await import('../aiLookup'))
  })

  it('never leads with notes when no notes were actually found, regardless of every other signal', () => {
    expect(decideNotesAreLead({
      explicitNoteAsk: true, noteResultsCount: 0, hasVerseEvidence: false,
      planAnswerKind: 'notes', critiqueLeadKind: 'notes',
    })).toBe(false)
  })

  it('the critique leadKind wins when present, even overriding an explicit notes-ask', () => {
    // A real scripture answer exists AND the critique — the most-informed signal, having seen
    // both — says verses should lead. Notes are still found (a real match), just not the lead.
    expect(decideNotesAreLead({
      explicitNoteAsk: true, noteResultsCount: 2, hasVerseEvidence: true,
      planAnswerKind: 'notes', critiqueLeadKind: 'verses',
    })).toBe(false)
  })

  it('the critique leadKind can also confirm notes should lead', () => {
    expect(decideNotesAreLead({
      explicitNoteAsk: false, noteResultsCount: 1, hasVerseEvidence: true,
      planAnswerKind: 'verses', critiqueLeadKind: 'notes',
    })).toBe(true)
  })

  it('falls back to the plan answerKind when no critique ran (e.g. skipped by the cost guard)', () => {
    expect(decideNotesAreLead({
      explicitNoteAsk: true, noteResultsCount: 1, hasVerseEvidence: true,
      planAnswerKind: 'notes', critiqueLeadKind: null,
    })).toBe(true)
    expect(decideNotesAreLead({
      explicitNoteAsk: true, noteResultsCount: 1, hasVerseEvidence: true,
      planAnswerKind: 'verses', critiqueLeadKind: null,
    })).toBe(false)
  })

  it('degrades to the no-model-signal heuristic when both answerKind and leadKind are absent (Ollama unavailable, extraction failed, or a malformed/failed critique call)', () => {
    // Explicit ask + a real note found + no model opinion at all -> notes lead (old behavior
    // preserved when there is truly no better signal available).
    expect(decideNotesAreLead({
      explicitNoteAsk: true, noteResultsCount: 1, hasVerseEvidence: true,
    })).toBe(true)
    // No explicit ask, a note only turned up as incidental implicit augmentation, and real verse
    // evidence exists -> notes do NOT silently steal the lead from a real scripture answer.
    expect(decideNotesAreLead({
      explicitNoteAsk: false, noteResultsCount: 1, hasVerseEvidence: true,
    })).toBe(false)
    // No explicit ask, but genuinely no verse evidence either -> the note is the only real thing
    // found, so it leads.
    expect(decideNotesAreLead({
      explicitNoteAsk: false, noteResultsCount: 1, hasVerseEvidence: false,
    })).toBe(true)
  })

  it('an unrecognized/unknown answerKind value is treated the same as absent (degrades to the heuristic), never crashes or silently becomes a default lead', () => {
    const result = decideNotesAreLead({
      explicitNoteAsk: false,
      noteResultsCount: 1,
      hasVerseEvidence: true,
      // @ts-expect-error deliberately passing a bogus value to prove it doesn't special-case.
      // The directive has to sit on the line the error is actually reported on — the object
      // literal spans several lines, so putting it above `decideNotesAreLead({` suppressed
      // nothing and TS flagged it as an unused directive.
      planAnswerKind: 'bogus',
    })
    // 'bogus' !== 'notes', so per the (a) priority rule it should resolve to false rather than
    // throwing or defaulting to true.
    expect(result).toBe(false)
  })
})
