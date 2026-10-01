import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runScriptureSearch, runStrongsSearch, groupHitsByBook, runRawScriptureSearch, buildVerseTagFilter, filterHitsByVerseTags, takeGroupRows, expandScriptureQuery, type ScriptureHit } from '../scriptureSearch'
import type { VerseTagMember } from '@/types'
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
  'lord said': [{ book_id: 'GEN', chapter: 4, verse_num: 6, text: 'And the LORD said unto Cain' }],
}
// H3068 occurrences span BOTH kjva and lxx (mirrors lexiconService.ts's getOccurrences for
// Greek numbers; H-numbers are really kjva-only, but the bridge's own merge logic must not
// assume that — exercised by the 'all'-target test below).
const H3068_OCC = [
  { book_id: 'GEN', chapter: 2, verse_num: 4, text: 'the LORD God made the earth', text_id: 'kjva', matchWordIndices: [1] },
  { book_id: 'GEN', chapter: 4, verse_num: 6, text: 'And the LORD said unto Cain', text_id: 'kjva', matchWordIndices: [2] },
  { book_id: 'GEN', chapter: 2, verse_num: 4, text: 'the Lord God made the earth', text_id: 'lxx', matchWordIndices: [1] },
]
beforeEach(() => {
  calls.length = 0
  ;(globalThis as unknown as { window: unknown }).window = {
    bible: { searchText: async (q: string, textId: string, mode: string, books?: string[]) => { calls.push({ q, textId, mode, books }); return (corpus[q.toLowerCase()] ?? []).filter((r) => !books || books.includes(r.book_id)) } },
    lexicon: { getOccurrences: async (num: string) => num === 'H3068' ? H3068_OCC : [] },
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

  // ── expandScriptureQuery + the Strong's bridge (word-replacer → Strong's number) ──
  const strongsRules: WordReplacerRule[] = [
    { id: 's-h3068', queries: [], strongsNum: 'H3068', replacement: 'Yehovah', wholeWord: false, enabled: true },
  ]

  it('expandScriptureQuery: plain text rule produces both directions as variants', () => {
    const rules: WordReplacerRule[] = [{ id: 'r1', queries: ['jesus'], replacement: 'Yeshua', wholeWord: true, enabled: true }]
    const { variants, strongsBridge } = expandScriptureQuery('Yeshua', rules, 'all')
    expect(variants.map((v) => v.toLowerCase())).toEqual(expect.arrayContaining(['yeshua', 'jesus']))
    expect(strongsBridge).toBeNull()
  })

  it('a Strong\'s-only rule ("Yehovah") bridges to occurrence search, merged with FTS results', async () => {
    const hits = await runScriptureSearch('Yehovah', { textId: 'kjva', wordMode: 'all', wordReplacerEnabled: true, wordReplacerRules: strongsRules })
    expect(hits.map((h) => `${h.book_id}.${h.chapter}.${h.verse_num}`).sort()).toEqual(['GEN.2.4', 'GEN.4.6'])
    expect(hits.every((h) => h.textId === 'kjva')).toBe(true)
    expect(hits.find((h) => h.verse_num === 4)?.strongsWords).toEqual([1])
  })

  it('the Strong\'s-only bridge also works when searching "all" texts, scoped to Strong\'s-tagged texts only', async () => {
    const hits = await runScriptureSearch('Yehovah', {
      textId: 'all', wordMode: 'all', wordReplacerEnabled: true, wordReplacerRules: strongsRules,
      targets: ['kjva', 'lxx', 'enoch'], // enoch has no Strong's tagging — bridge must not touch it
    })
    const byText = hits.map((h) => `${h.textId}:${h.book_id}.${h.chapter}.${h.verse_num}`).sort()
    expect(byText).toEqual(['kjva:GEN.2.4', 'kjva:GEN.4.6', 'lxx:GEN.2.4'])
  })

  it('dedupes when the bridge and an FTS variant both find the same verse', async () => {
    // "lord said" is a real FTS hit for GEN.4.6 (corpus above); the H3068 occurrence bridge
    // also carries GEN.4.6 — the merged result must list it once, with strongsWords attached.
    const rules: WordReplacerRule[] = [...strongsRules, { id: 'said', queries: ['said'], replacement: 'said', wholeWord: true, enabled: false }]
    const hits = await runScriptureSearch('lord said', { textId: 'kjva', wordMode: 'all', wordReplacerEnabled: true, wordReplacerRules: rules })
    const gen46 = hits.filter((h) => h.book_id === 'GEN' && h.chapter === 4 && h.verse_num === 6)
    expect(gen46).toHaveLength(1)
  })

  it('phrase mode: a Strong\'s-only rule bridges via a literal-rendering substitution ("Yehovah said" → "LORD said")', async () => {
    const hits = await runScriptureSearch('Yehovah said', { textId: 'kjva', wordMode: 'phrase', wordReplacerEnabled: true, wordReplacerRules: strongsRules })
    expect(hits.map((h) => `${h.book_id}.${h.chapter}.${h.verse_num}`)).toEqual(['GEN.4.6'])
    // GEN.2.4 ("the LORD God made the earth") carries H3068 but doesn't contain the phrase
    // "LORD said" — the phrase post-filter must exclude it even though it's a Strong's hit.
    expect(hits.some((h) => h.verse_num === 4)).toBe(false)
  })

  it('Strong\'s queries resolve through lexicon occurrences with word indices; non-Strong\'s → null', async () => {
    expect(await runStrongsSearch('in the beginning')).toBeNull()
    const hits = await runStrongsSearch('H3068')
    // H3068_OCC (shared mock above) now carries 3 distinct occurrence rows (two kjva, one lxx)
    expect(hits?.map((h) => [h.book_id, h.chapter, h.verse_num, h.strongsWords]).sort((a, b) => (a[2] as number) - (b[2] as number)))
      .toEqual([['GEN', 2, 4, [1]], ['GEN', 2, 4, [1]], ['GEN', 4, 6, [2]]])
  })

  it('groups hits by book in order of appearance with verses sorted', () => {
    const g = groupHitsByBook([
      { book_id: 'EXO', chapter: 20, verse_num: 8, text: '', textId: 'kjva' },
      { book_id: 'GEN', chapter: 2, verse_num: 3, text: '', textId: 'kjva' },
      { book_id: 'EXO', chapter: 16, verse_num: 23, text: '', textId: 'kjva' },
    ])
    expect(g.map((x) => [x.bookId, x.hits.map((h) => `${h.chapter}:${h.verse_num}`)])).toEqual([['EXO', ['16:23', '20:8']], ['GEN', ['2:3']]])
  })

  // ── Tag filter + sort + chunking (phone filter sheet; same semantics as ScriptureSearchView) ──
  const member = (tagId: string, verses: Array<[string, number, number]>, chapters: Array<[string, number]> = []): VerseTagMember => ({
    memberId: `${tagId}-m`, tagId, tagName: tagId, tagColor: null, kind: 'verses', label: '', ranges: [],
    verses: verses.map(([bookId, chapter, verse]) => ({ bookId, chapter, verse })),
    wholeChapters: chapters.map(([bookId, chapter]) => ({ bookId, chapter })),
  })
  const hit = (book_id: string, chapter: number, verse_num: number, textId = 'kjva'): ScriptureHit => ({ book_id, chapter, verse_num, text: '', textId })

  it('verse-tag filter: a hit passes when the verse or its whole chapter is in a selected tag; AND vs OR', () => {
    const members = [member('t1', [['GEN', 1, 1]], [['EXO', 20]]), member('t2', [['GEN', 1, 1], ['GEN', 1, 2]])]
    const any = buildVerseTagFilter(members, ['t1', 't2'], false)
    expect(any('GEN', 1, 1)).toBe(true)
    expect(any('GEN', 1, 2)).toBe(true)      // only t2
    expect(any('EXO', 20, 8)).toBe(true)     // whole chapter in t1
    expect(any('EXO', 21, 1)).toBe(false)
    const all = buildVerseTagFilter(members, ['t1', 't2'], true)
    expect(all('GEN', 1, 1)).toBe(true)
    expect(all('GEN', 1, 2)).toBe(false)     // t1 lacks it
    expect(all('EXO', 20, 8)).toBe(false)
    // no selection → everything passes, and the hit list is returned untouched
    expect(buildVerseTagFilter(members, [], true)('XXX', 9, 9)).toBe(true)
    const hits = [hit('GEN', 1, 1), hit('GEN', 1, 2, 'lxx'), hit('EXO', 20, 8), hit('EXO', 21, 1)]
    expect(filterHitsByVerseTags(hits, members, [], false)).toBe(hits)
    expect(filterHitsByVerseTags(hits, members, ['t1'], false).map((h) => `${h.book_id}.${h.chapter}.${h.verse_num}`)).toEqual(['GEN.1.1', 'EXO.20.8'])
    // a selected tag with no members yet narrows to nothing rather than to everything
    expect(filterHitsByVerseTags(hits, [], ['t9'], false)).toEqual([])
  })

  it('sort modes: relevance keeps FTS order inside groups; book order is canonical; direction reverses', () => {
    const hits = [hit('EXO', 20, 8), hit('GEN', 2, 3), hit('EXO', 16, 23), hit('GEN', 1, 1)]
    const rel = groupHitsByBook(hits, { sort: 'relevance' })
    expect(rel.map((g) => [g.bookId, g.hits.map((h) => `${h.chapter}:${h.verse_num}`)])).toEqual([['EXO', ['20:8', '16:23']], ['GEN', ['2:3', '1:1']]])
    const relAsc = groupHitsByBook(hits, { sort: 'relevance', direction: 'asc' })
    expect(relAsc.map((g) => [g.bookId, g.hits.map((h) => `${h.chapter}:${h.verse_num}`)])).toEqual([['GEN', ['1:1', '2:3']], ['EXO', ['16:23', '20:8']]])
    const book = groupHitsByBook(hits, { sort: 'bookOrder' })
    expect(book.map((g) => [g.bookId, g.hits.map((h) => `${h.chapter}:${h.verse_num}`)])).toEqual([['GEN', ['1:1', '2:3']], ['EXO', ['16:23', '20:8']]])
    const bookDesc = groupHitsByBook(hits, { sort: 'bookOrder', direction: 'desc' })
    expect(bookDesc.map((g) => [g.bookId, g.hits.map((h) => `${h.chapter}:${h.verse_num}`)])).toEqual([['EXO', ['20:8', '16:23']], ['GEN', ['2:3', '1:1']]])
    // the option-less call is unchanged (order of appearance, verses sorted) — see the test above
    expect(groupHitsByBook(hits)).toEqual(groupHitsByBook(hits, {}))
  })

  it('takeGroupRows keeps groups intact while capping the total rows shown', () => {
    const groups = [{ bookId: 'GEN', hits: [hit('GEN', 1, 1), hit('GEN', 1, 2), hit('GEN', 1, 3)] }, { bookId: 'EXO', hits: [hit('EXO', 1, 1)] }, { bookId: 'LEV', hits: [hit('LEV', 1, 1)] }]
    expect(takeGroupRows(groups, 2)).toEqual({ groups: [{ bookId: 'GEN', hits: groups[0].hits.slice(0, 2) }], shown: 2, total: 5 })
    expect(takeGroupRows(groups, 4).groups.map((g) => [g.bookId, g.hits.length])).toEqual([['GEN', 3], ['EXO', 1]])
    expect(takeGroupRows(groups, 50)).toEqual({ groups, shown: 5, total: 5 })
    expect(takeGroupRows([], 50)).toEqual({ groups: [], shown: 0, total: 0 })
  })
})
