/** SRCH-001/004 — "Search Berean": every source, scopes narrow, the tab type never does. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runUnifiedSearch, goToItems, resolvePlace, DEFAULT_UNIFIED_FILTERS } from '../unifiedSearch'
import { parseSearchIntent } from '../searchIntent'

const searchText = vi.fn(async (q: string, textId: string, _mode?: string, bookIds?: string[]) => {
  const rows: Record<string, Array<{ book_id: string; chapter: number; verse_num: number; text: string }>> = {
    kjva: [{ book_id: 'JHN', chapter: 3, verse_num: 16, text: 'For God so loved the world' }, { book_id: 'SIR', chapter: 1, verse_num: 10, text: 'love of the Lord (Apocrypha)' }],
    lxx: [{ book_id: 'GEN', chapter: 29, verse_num: 20, text: 'he loved her' }],
    enoch: [{ book_id: 'ENO', chapter: 1, verse_num: 1, text: 'love in Enoch' }],
    jubilees: [{ book_id: 'JUB', chapter: 1, verse_num: 1, text: 'love in Jubilees' }],
  }
  return (rows[textId] ?? []).filter((r) => !bookIds || bookIds.includes(r.book_id)).filter(() => q.length > 0)
})
const searchNotes = vi.fn(async () => [{ id: 'n1', title: 'Love study', content: 'love', type: 'general' }])
const lexSearch = vi.fn(async () => [{ strongsNum: 'G26', lemma: 'ἀγάπη', gloss: 'love' }])
const getEntry = vi.fn(async (n: string) => (n === 'H430' ? { strongsNum: 'H430', lemma: 'אֱלֹהִים', gloss: 'God' } : null))

beforeEach(() => {
  searchText.mockClear(); searchNotes.mockClear(); lexSearch.mockClear(); getEntry.mockClear()
  ;(window as unknown as Record<string, unknown>).bible = { searchText, getBooks: async (t: string) => (t === 'kjva' ? [{ id: 'GEN', testament: 'OT' }, { id: 'TOB', testament: 'Apocrypha' }] : [{ id: 'GEN', testament: 'OT' }]) }
  ;(window as unknown as Record<string, unknown>).notes = { searchNotes }
  ;(window as unknown as Record<string, unknown>).lexicon = { search: lexSearch, getEntry, getOccurrences: async () => [] }
})

const opts = (over = {}) => ({ scope: 'all' as const, filters: DEFAULT_UNIFIED_FILTERS, wordReplacerEnabled: false, wordReplacerRules: [], ...over })

describe('runUnifiedSearch', () => {
  it('All: KJV + Apocrypha, LXX, Enoch, Jubilees verses + Strong\'s + notes', async () => {
    const r = await runUnifiedSearch('love', opts())
    const texts = new Set(r.verses!.map((h) => h.textId))
    for (const t of ['kjva', 'lxx', 'enoch', 'jubilees']) expect(texts.has(t)).toBe(true)
    expect(r.verses!.some((h) => h.book_id === 'SIR')).toBe(true) // Apocrypha (in KJVA)
    expect(r.entries!.map((e) => e.strongsNum)).toEqual(['G26'])
    expect(r.notes!.map((n) => n.id)).toEqual(['n1'])
  })

  it('a scope narrows; the other sources are not searched', async () => {
    const notes = await runUnifiedSearch('love', opts({ scope: 'notes' }))
    expect(notes.verses).toBeNull(); expect(notes.entries).toBeNull(); expect(notes.notes).toHaveLength(1)
    expect(searchText).not.toHaveBeenCalled()
    const lex = await runUnifiedSearch('love', opts({ scope: 'lexicon' }))
    expect(lex.verses).toBeNull(); expect(lex.notes).toBeNull(); expect(lex.entries).toHaveLength(1)
  })

  it('a text filter or a named source searches that text only', async () => {
    const f = await runUnifiedSearch('love', opts({ filters: { ...DEFAULT_UNIFIED_FILTERS, textId: 'lxx' } }))
    expect(new Set(f.verses!.map((h) => h.textId))).toEqual(new Set(['lxx']))
    const named = await runUnifiedSearch('enoch: love', opts())
    expect(new Set(named.verses!.map((h) => h.textId))).toEqual(new Set(['enoch']))
  })

  it('individual books narrow the verses', async () => {
    const r = await runUnifiedSearch('love', opts({ filters: { ...DEFAULT_UNIFIED_FILTERS, books: ['JHN'] } }))
    expect(r.verses!.map((h) => h.book_id)).toEqual(['JHN'])
    expect(searchText.mock.calls.every((c) => JSON.stringify(c[3]) === '["JHN"]')).toBe(true)
  })

  it('exact phrase uses phrase mode', async () => {
    await runUnifiedSearch('"so loved"', opts())
    expect(searchText.mock.calls.every((c) => c[2] === 'phrase')).toBe(true)
  })

  it("'strong 430' offers only the numbers that exist, and no notes", async () => {
    const r = await runUnifiedSearch('strong 430', opts())
    expect(r.goTo.map((g) => g.label)).toEqual(['H430'])
    expect(r.notes).toBeNull()
  })

  it('a reference is a Go-to with no word search', async () => {
    const r = await runUnifiedSearch('Matthew 10', opts())
    expect(r.goTo[0]).toMatchObject({ kind: 'passage', destination: { kind: 'passage', bookId: 'MAT', chapter: 10 } })
    expect(r.verses).toBeNull()
  })

  it('case does not matter for the query sent to the services', async () => {
    await runUnifiedSearch('LOVE', opts())
    expect(searchText.mock.calls[0][0]).toBe('LOVE')
  })
})

describe('Go to', () => {
  it('notes keyword offers Notes; strong numbers only in scopes that include the lexicon', () => {
    expect(goToItems(parseSearchIntent('my notes'), 'all')[0]).toMatchObject({ kind: 'notes' })
    expect(goToItems(parseSearchIntent('H430'), 'scripture')).toEqual([])
  })
  it('a collection resolves to its first book (Apocrypha → its first book)', async () => {
    const lxx = goToItems(parseSearchIntent('lxx'), 'all')[0]
    expect(await resolvePlace(lxx.place!)).toMatchObject({ kind: 'passage', bookId: 'GEN', chapter: 1, textId: 'lxx' })
  })
})
