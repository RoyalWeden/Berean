import { describe, it, expect, vi, beforeAll } from 'vitest'

// Regression tests for defect #2 (wrong scope/wrong book): detectFocusTextId used to be a bare
// substring check over ~45 aliases, and detectBookInQuestion built a fresh RegExp per book name
// on every call and had no defense against book names that are also common English words. Both
// functions are exported from aiLookup.ts purely for this test.
//
// aiLookup.ts pulls in several other main-process modules that themselves open real
// better-sqlite3 databases — not usable under plain `vitest` (see lexicon.occurrences.test.ts's
// comment on the native-binding ABI mismatch) — so every DB-backed dependency is mocked here.
// None of it is exercised by the functions under test; it only needs to not throw on import and
// (for the `books` table) return a small, fake canonical book list.

interface FakeBookRow { id: string; name: string; short_name: string; testament: string }
const FAKE_BOOKS: FakeBookRow[] = [
  { id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT' },
  { id: 'JOB', name: 'Job', short_name: 'Job', testament: 'OT' },
  { id: 'DAN', name: 'Daniel', short_name: 'Dan', testament: 'OT' },
  { id: 'AMO', name: 'Amos', short_name: 'Amos', testament: 'OT' },
  { id: 'ISA', name: 'Isaiah', short_name: 'Isa', testament: 'OT' },
  { id: 'WIS', name: 'Wisdom', short_name: 'Wis', testament: 'Apocrypha' },
  { id: 'MAT', name: 'Matthew', short_name: 'Matt', testament: 'NT' },
  { id: 'ZEC', name: 'Zechariah', short_name: 'Zech', testament: 'OT' },
  { id: 'SNG', name: 'Song of Solomon', short_name: 'Song', testament: 'OT' },
  { id: 'ROM', name: 'Romans', short_name: 'Rom', testament: 'NT' },
]

vi.mock('../../db/bible', () => ({
  getTextDb: (textId: string) => {
    if (textId !== 'kjva') return null
    return {
      prepare: (sql: string) => ({
        all: () => (sql.includes('FROM books') ? FAKE_BOOKS : []),
      }),
    }
  },
}))
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
vi.mock('@/lib/parseRef', () => ({ parseRef: () => null, isExactBookToken: () => false }))
vi.mock('../archaicVocab', () => ({ PSEUDEPIGRAPHA_ARCHAIC_VOCAB: [] }))

describe('detectFocusTextId / detectBookInQuestion (scope detection)', () => {
  let detectFocusTextId: typeof import('../aiLookup').detectFocusTextId
  let detectBookInQuestion: typeof import('../aiLookup').detectBookInQuestion

  beforeAll(async () => {
    ;({ detectFocusTextId, detectBookInQuestion } = await import('../aiLookup'))
  })

  it('does not hijack focus text from "enoch" appearing inside a quoted verse', () => {
    const q = 'What does this mean: "and Enoch walked with God"?'
    expect(detectFocusTextId(q)).toBeNull()
  })

  it('still detects an explicitly named work outside quotes', () => {
    expect(detectFocusTextId('why does Abraham leave his family in Jubilees 12')).toBe('jubilees')
    expect(detectFocusTextId('tell me about the book of Enoch')).toBe('enoch')
  })

  it('does not match a substring inside a longer unrelated word', () => {
    // "hermas" must not fire from a word that merely contains it as a substring.
    expect(detectFocusTextId('the fishermastery guild')).toBeNull()
  })

  it('does not scope to an ambiguous book name used as an ordinary word', () => {
    expect(detectBookInQuestion('I need a job to pay rent')).toBeNull()
    expect(detectBookInQuestion('Dan and Amos went to the store')).toBeNull()
  })

  // Regression test for a LIVE BUG (Team B retrieval round): kjva.db's Apocrypha includes a book
  // literally named "Wisdom" (WIS), so "what does the Bible say about wisdom" used to scope
  // keyword/Strong's-occurrence/notes search to WIS alone — Proverbs, James, and Ecclesiastes
  // (where "wisdom" is a major KJV theme) became unreachable for that question. See
  // AMBIGUOUS_BOOK_WORDS's own comment for the full audit of every other book name/short_name
  // this could plausibly affect.
  it('does not scope to WIS (Wisdom of Solomon) from the ordinary word "wisdom"', () => {
    expect(detectBookInQuestion('what does the Bible say about wisdom')).toBeNull()
    expect(detectBookInQuestion('I need wisdom to make this decision')).toBeNull()
  })

  it('does scope to an ambiguous book name when named explicitly with a chapter or "book of"', () => {
    expect(detectBookInQuestion('what happens in Job 5')).toBe('JOB')
    expect(detectBookInQuestion('tell me about the book of Job')).toBe('JOB')
    expect(detectBookInQuestion('Amos 3 talks about this')).toBe('AMO')
    expect(detectBookInQuestion('the book of Wisdom talks about this')).toBe('WIS')
    expect(detectBookInQuestion('Wisdom 7 talks about this')).toBe('WIS')
  })

  it('does not scope to a book name mentioned only inside a quoted verse', () => {
    expect(detectBookInQuestion('what does this mean: "in the beginning, Genesis says"')).toBeNull()
  })

  it('still detects an unambiguous book name anywhere in the question', () => {
    expect(detectBookInQuestion('where in Matthew is this quoted')).toBe('MAT')
  })

  it('longest match still wins for a multi-word book name', () => {
    expect(detectBookInQuestion('what does Song of Solomon say about love')).toBe('SNG')
  })
})

// Regression tests for the reported bug: "verse about people not hearing the fame of god" found
// nothing, then "its in the old testament" still returned non-OT verses — detectTestamentInQuestion
// gives the keyword/semantic pipeline a real book-id scope for these phrases, where previously
// "testament" had no meaning anywhere in this file at all.
describe('detectTestamentInQuestion', () => {
  let detectTestamentInQuestion: typeof import('../aiLookup').detectTestamentInQuestion

  beforeAll(async () => {
    ;({ detectTestamentInQuestion } = await import('../aiLookup'))
  })

  it('scopes "old testament" to OT book ids only', () => {
    const ids = detectTestamentInQuestion('its in the old testament')
    expect(ids).toEqual(expect.arrayContaining(['GEN', 'JOB', 'DAN', 'AMO', 'ISA', 'ZEC', 'SNG']))
    expect(ids).not.toContain('MAT')
    expect(ids).not.toContain('ROM')
    expect(ids).not.toContain('WIS') // Apocrypha is neither OT nor NT here
  })

  it('scopes "new testament" to NT book ids only', () => {
    const ids = detectTestamentInQuestion('try the new testament')
    expect(ids).toEqual(expect.arrayContaining(['MAT', 'ROM']))
    expect(ids).not.toContain('GEN')
  })

  it('recognizes named book groups (Gospels, Paul\'s epistles, the Prophets)', () => {
    expect(detectTestamentInQuestion('one of the gospels')).toEqual(['MAT', 'MRK', 'LUK', 'JHN'])
    expect(detectTestamentInQuestion("paul's epistles")).toContain('ROM')
    expect(detectTestamentInQuestion('the prophets')).toContain('ISA')
  })

  it('returns null when no testament/group phrase is present', () => {
    expect(detectTestamentInQuestion('what does John 3:16 say')).toBeNull()
  })
})
