import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runScriptureSearch, runStrongsSearch, groupHitsByBook, runRawScriptureSearch } from '../scriptureSearch'
import type { WordReplacerRule } from '@/store'

/**
 * The phone search runs this shared algorithm; these tests pin the behaviours it must share with
 * ScriptureSearchView: word-replacer variants are separate queries merged + deduped, phrase
 * mode post-filters exactly (punctuation-insensitive), book scoping is pushed to the query,
 * the replacer → Strong's bridge adds KJVA verses, and Strong's queries use occurrences.
 */
type Row = { book_id: string; chapter: number; verse_num: number; text: string }
const calls: Array<{ q: string; textId: string; mode: string; books?: string[] }> = []
const corpus: Record<string, Row[]> = {
  'jesus': [{ book_id: 'JHN', chapter: 1, verse_num: 17, text: 'grace and truth came by Jesus Christ.' }],
  'yeshua': [],
  'faith hope charity': [
    { book_id: '1CO', chapter: 13, verse_num: 13, text: 'And now abideth faith, hope, charity, these three' },
    { book_id: 'XXX', chapter: 1, verse_num: 1, text: 'hope and faith and charity' },
  ],
}
beforeEach(() => {
  calls.length = 0
  ;(globalThis as unknown as { window: unknown }).window = {
    bible: { searchText: async (q: string, textId: string, mode: string, books?: string[]) => { calls.push({ q, textId, mode, books }); return (corpus[q.toLowerCase()] ?? []).filter((r) => !books || books.includes(r.book_id)) } },
    lexicon: { getOccurrences: async (num: string) => num === 'H3068' ? [{ book_id: 'GEN', chapter: 2, verse_num: 4, text: 'the LORD God made the earth', text_id: 'kjva', matchWordIndices: [1] }] : [] },
  }
})

describe('scriptureSearch (shared algorithm)', () => {
  it('runs each word-replacer variant as its own query and merges without duplicates', async () => {
    const rules: WordReplacerRule[] = [{ id: 'r1', queries: ['jesus'], replacement: 'Yeshua', wholeWord: true, enabled: true }]
    const hits = await runScriptureSearch('Yeshua', { textId: 'kjva', wordMode: 'all', wordReplacerEnabled: true, wordReplacerRules: rules })
    expect(calls.map((c) => c.q.toLowerCase())).toContain('jesus')
    expect(hits.map((h) => `${h.book_id}.${h.chapter}.${h.verse_num}`)).toEqual(['JHN.1.17'])
    // disabled replacer → only the literal query
    calls.length = 0
    await runScriptureSearch('Yeshua', { textId: 'kjva', wordMode: 'all', wordReplacerEnabled: false, wordReplacerRules: rules })
    expect(calls.map((c) => c.q)).toEqual(['Yeshua'])
  })

  it('phrase mode keeps only verses containing the exact phrase (punctuation ignored)', async () => {
    const hits = await runRawScriptureSearch('faith hope charity', 'kjva', 'phrase', ['faith hope charity'], undefined)
    expect(hits.map((h) => h.book_id)).toEqual(['1CO'])
  })

  it('pushes the book scope into the query and searches every text for "all"', async () => {
    await runScriptureSearch('faith hope charity', { textId: 'kjva', wordMode: 'all', bookIds: ['1CO'], wordReplacerEnabled: false, wordReplacerRules: [] })
    expect(calls[0].books).toEqual(['1CO'])
    calls.length = 0
    const hits = await runScriptureSearch('faith hope charity', { textId: 'all', wordMode: 'all', wordReplacerEnabled: false, wordReplacerRules: [] })
    expect(new Set(calls.map((c) => c.textId)).size).toBeGreaterThan(10)
    expect(hits.every((h) => typeof h.textId === 'string')).toBe(true)
  })

  it('Strong\'s queries resolve through lexicon occurrences with word indices; non-Strong\'s → null', async () => {
    expect(await runStrongsSearch('in the beginning')).toBeNull()
    const hits = await runStrongsSearch('H3068')
    expect(hits?.map((h) => [h.book_id, h.chapter, h.verse_num, h.strongsWords])).toEqual([['GEN', 2, 4, [1]]])
  })

  it('groups hits by book in order of appearance with verses sorted', () => {
    const g = groupHitsByBook([
      { book_id: 'EXO', chapter: 20, verse_num: 8, text: '', textId: 'kjva' },
      { book_id: 'GEN', chapter: 2, verse_num: 3, text: '', textId: 'kjva' },
      { book_id: 'EXO', chapter: 16, verse_num: 23, text: '', textId: 'kjva' },
    ])
    expect(g.map((x) => [x.bookId, x.hits.map((h) => `${h.chapter}:${h.verse_num}`)])).toEqual([['EXO', ['16:23', '20:8']], ['GEN', ['2:3']]])
  })
})
