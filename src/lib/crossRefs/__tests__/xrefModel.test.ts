/** XREF-001 — the structured cross-reference result every iPhone surface renders. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeVerseXRefs, chapterXRefsFromNotes, resolveXRefTexts, targetVerses, xrefKey, __clearXRefTextCache, type RawVerseXRefs, type XRefItem } from '../xrefModel'

describe('verse context', () => {
  const data: RawVerseXRefs[] = [
    { verse: 3, groups: [{ heading: 'Poor in spirit', refs: [{ bookId: 'ISA', chapter: 57, verse: 15, text: 'For thus saith…' }, { bookId: 'MAT', chapter: 5, verse: 4, text: 'Blessed are they that mourn' }] }] },
    { verse: 4, groups: [{ refs: [{ bookId: 'ISA', chapter: 57, verse: 15, text: 'For thus saith…' }, { bookId: 'ISA', chapter: 61, verse: 2, endVerse: 3, text: 'first verse only' }] }] },
  ]
  it('several verses: one section per verse, each target once with every verse it belongs to', () => {
    const r = normalizeVerseXRefs(data, 'tske', { bookId: 'MAT', chapter: 5, verses: [3, 4] })
    expect(r.total).toBe(3)
    expect(r.sections.map((s) => s.heading)).toEqual(['v. 3 · Poor in spirit', 'v. 4'])
    const isa = r.sections[0].items.find((i) => i.bookId === 'ISA')!
    expect(isa.fromVerses).toEqual([3, 4])
    expect(r.sections[1].items.map((i) => i.key)).toEqual(['ISA.61.2-3'])
  })
  it('a reference to a selected verse is kept and marked current', () => {
    const r = normalizeVerseXRefs(data, 'tske', { bookId: 'MAT', chapter: 5, verses: [3, 4] })
    expect(r.sections[0].items.find((i) => i.bookId === 'MAT')!.isCurrent).toBe(true)
    expect(r.sections[0].items.find((i) => i.bookId === 'ISA')!.isCurrent).toBe(false)
  })
  it('a range drops the source’s first-verse-only text so the whole passage is resolved', () => {
    const r = normalizeVerseXRefs([data[1]], 'tske', { bookId: 'MAT', chapter: 5, verses: [4] })
    expect(r.sections[0].items.find((i) => i.endVerse === 3)!.text).toBeUndefined()
    expect(r.sections[0].heading).toBeUndefined()
  })
})

describe('chapter context (no verse selected)', () => {
  const notes = [
    { id: 'c1', title: 'Sermon on the Mount', verseRef: 'MAT.5', content: 'See Luke 6:20 and Isaiah 61:1-3. Also Matthew 5.' },
    { id: 'v1', title: 'Genesis 1.1', verseRef: 'GEN.1.1', content: 'Compare Matthew 5 on the kingdom.' },
    { id: 'gone', title: 'Deleted', verseRef: 'MAT.5', content: 'Romans 8:1', deletedAt: 1 },
  ]
  it('the references made by the chapter’s notes, and the notes that cite the chapter — each once', () => {
    const r = chapterXRefsFromNotes(notes, 'MAT', 5)
    expect(r.sections.map((s) => s.id)).toEqual(['makes', 'cites'])
    expect(r.sections[0].items.map((i) => i.key)).toEqual(['LUK.6.20', 'ISA.61.1-3'])
    expect(r.sections[0].items[0].noteTitle).toBe('Sermon on the Mount')
    expect(r.sections[1].items.map((i) => i.key)).toEqual(['GEN.1.1'])
    expect(r.sections[1].items[0].noteTitle).toBe('Genesis 1:1')   // the vault title, shown with a colon
    expect(r.total).toBe(3)
  })
  it('an empty chapter has no sections', () => {
    expect(chapterXRefsFromNotes([], 'MAT', 5)).toEqual({ sections: [], mentions: [], total: 0 })
  })
})

describe('passage text', () => {
  beforeEach(() => __clearXRefTextCache())
  const item = (p: Partial<XRefItem>): XRefItem => ({ key: xrefKey({ bookId: 'ROM', chapter: 5, verse: 8, ...p } as XRefItem), bookId: 'ROM', chapter: 5, verse: 8, source: 'notes', fromVerses: [], ...p })
  it('ranges resolve in full, in one batched query per text, and are cached', async () => {
    const queryVerses = vi.fn(async (refs: Array<{ bookId: string; chapter: number; verse: number }>) =>
      Object.fromEntries(refs.map((r) => [`${r.bookId}.${r.chapter}.${r.verse}`, { text: `v${r.verse}` }])))
    ;(window as unknown as { bible: unknown }).bible = { queryVerses }
    const items = [item({ verse: 6, endVerse: 8, key: 'ROM.5.6-8' }), item({ bookId: 'GEN', chapter: 1, verse: 1, lxx: true, key: 'GEN.1.1|lxx' }), item({ text: 'given' })]
    const out = await resolveXRefTexts(items)
    expect(out.map((i) => i.text)).toEqual(['v6 v7 v8', 'v1', 'given'])
    expect(queryVerses).toHaveBeenCalledTimes(2)                // kjva + lxx
    await resolveXRefTexts(items)
    expect(queryVerses).toHaveBeenCalledTimes(2)                // cached
  })
  it('a whole-chapter target has no text to resolve; long ranges are capped', () => {
    expect(targetVerses({ bookId: 'PSA', chapter: 119, verse: 0 })).toEqual([])
    expect(targetVerses({ bookId: 'PSA', chapter: 119, verse: 1, endVerse: 176 })).toHaveLength(40)
  })
})

describe('cross-reference text keeps Strong\'s tags (TEST 2026-09-29 word replacer in cross refs)', () => {
  it('resolved items carry textTagged + textId so LORD → Yehovah applies', async () => {
    const { resolveXRefTexts, __clearXRefTextCache } = await import('../xrefModel')
    __clearXRefTextCache()
    ;(window as unknown as { bible: unknown }).bible = {
      queryVerses: async () => ({ 'ISA.29.6': { text: 'visited of the Lord of hosts', text_tagged: 'visited{H6485} of the Lord{H3068} of hosts{H6635}' } }),
    }
    const [item] = await resolveXRefTexts([{ key: 'ISA.29.6', bookId: 'ISA', chapter: 29, verse: 6, source: 'tske', fromVerses: [1] } as never])
    expect(item.text).toBe('visited of the Lord of hosts')
    expect(item.textTagged).toContain('{H3068}')
    expect(item.textId).toBe('kjva')
  })
})
