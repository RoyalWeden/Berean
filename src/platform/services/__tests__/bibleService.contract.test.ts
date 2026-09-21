import { describe, it, expect, beforeAll } from 'vitest'
import { fixtureTextDb, makeContext, realDataDb } from '../../db/__tests__/testDb'
import { createBibleService, cleanWords, safeFtsQuery } from '../bibleService'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

describe('bibleService (fixture text)', () => {
  let text: DatabaseAdapter
  let svc: ReturnType<typeof createBibleService>

  beforeAll(async () => {
    text = await fixtureTextDb([
      { book: 'GEN', ch: 1, v: 1, text: 'In the beginning God created the heaven and the earth.', tagged: 'In the beginning{H7225} God{H430} created{H1254}' },
      { book: 'GEN', ch: 1, v: 2, text: 'And the earth was without form, and void;' },
      { book: 'GEN', ch: 1, v: 3, text: 'And God said, Let there be light: and there was light.' },
      { book: 'GEN', ch: 2, v: 1, text: 'Thus the heavens and the earth were finished, and all the host of them.' },
      { book: 'JHN', ch: 3, v: 16, text: 'For God so loved the world, that he gave his only begotten Son' },
      { book: 'JHN', ch: 1, v: 1, text: 'In the beginning was the Word, and the Word was with God' },
    ])
    svc = createBibleService(makeContext({ texts: { kjva: text, lxx: null } }))
  })

  it('getBooks returns rows in rowid order and fills chapters_count=0 from verses', async () => {
    const books = await svc.getBooks('kjva')
    expect(books.map((b) => b.id)).toEqual(['GEN', 'JHN'])
    expect(books[0]).toEqual({ id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT', chapters_count: 50 })
    const zeroText = await fixtureTextDb([{ book: 'X', ch: 4, v: 1, text: 'a' }, { book: 'X', ch: 9, v: 1, text: 'b' }], { books: [{ id: 'X', name: 'X', short: 'X', testament: 'OT', chapters: 0 }] })
    const s2 = createBibleService(makeContext({ texts: { t: zeroText } }))
    expect((await s2.getBooks('t'))[0].chapters_count).toBe(9)
    expect(await svc.getBooks('missing')).toEqual([])
  })

  it('queryChapter includes text_tagged when the column exists and orders by verse', async () => {
    const rows = await svc.queryChapter('GEN', 1, 'kjva')
    expect(rows.map((r) => r.verse_num)).toEqual([1, 2, 3])
    expect(rows[0].text_tagged).toContain('{H7225}')
    expect(rows[0]).not.toHaveProperty('title')
    expect(await svc.queryChapter('GEN', 1, 'lxx')).toEqual([])
  })

  it('queryVerse returns the verse or null', async () => {
    expect(await svc.queryVerse('JHN', 3, 16)).toEqual({ verse_num: 16, text: 'For God so loved the world, that he gave his only begotten Son', text_tagged: null })
    expect(await svc.queryVerse('JHN', 3, 99)).toBeNull()
  })

  it('queryVerses batches by chapter and keys by book.chapter.verse', async () => {
    const out = await svc.queryVerses([{ bookId: 'GEN', chapter: 1, verse: 1 }, { bookId: 'GEN', chapter: 1, verse: 3 }, { bookId: 'JHN', chapter: 3, verse: 16 }, { bookId: 'GEN', chapter: 1, verse: 99 }])
    expect(Object.keys(out).sort()).toEqual(['GEN.1.1', 'GEN.1.3', 'JHN.3.16'])
    expect(out['GEN.1.3'].text).toMatch(/^And God said/)
  })

  it('searchText: all / phrase / any word modes and book scoping', async () => {
    const all = await svc.searchText('beginning God', 'kjva', 'all')
    expect(all.map((r) => `${r.book_id}.${r.chapter}.${r.verse_num}`).sort()).toEqual(['GEN.1.1', 'JHN.1.1'])
    const phrase = await svc.searchText('in the beginning was', 'kjva', 'phrase')
    expect(phrase.map((r) => r.book_id)).toEqual(['JHN'])
    const any = await svc.searchText('void light', 'kjva', 'any')
    expect(any.map((r) => r.verse_num).sort()).toEqual([2, 3])
    const scoped = await svc.searchText('God', 'kjva', 'all', ['JHN'])
    expect(scoped.every((r) => r.book_id === 'JHN')).toBe(true)
    expect(scoped.length).toBe(2)
    const chapterScoped = await svc.searchText('God', 'kjva', 'all', ['JHN'], 3)
    expect(chapterScoped.map((r) => r.verse_num)).toEqual([16])
    expect(await svc.searchText('   ', 'kjva')).toEqual([])
    expect(await svc.searchText('"', 'kjva')).toEqual([])
  })

  it('cleanWords / safeFtsQuery preserve the desktop query-building rules', () => {
    expect(cleanWords('  Let there be "light" ')).toEqual(['Let', 'there', 'be', 'light'])
    expect(safeFtsQuery('let there', 'all')).toBe('let* AND there*')
    expect(safeFtsQuery('let there', 'phrase')).toBe('"let there"')
    expect(safeFtsQuery('7 days', 'all')).toMatch(/^\((7\*|seven\*)( OR (7\*|seven\*))+\) AND days\*$/)
    expect(safeFtsQuery('', 'all')).toBe('')
  })
})

describe('bibleService (real kjva.db, skipped when data is absent)', () => {
  const real = realDataDb('kjva.db')
  const run = real ? it : it.skip
  const svc = real ? createBibleService(makeContext({ texts: { kjva: real } })) : null

  run('reads Genesis 1 with 31 verses and Strong\'s tags', async () => {
    const rows = await svc!.queryChapter('GEN', 1)
    expect(rows.length).toBe(31)
    expect(rows[0].text).toMatch(/^In the beginning/)
    expect(rows[0].text_tagged).toContain('{H')
  })

  run('FTS phrase search finds "in the beginning" in Genesis and John', async () => {
    const rows = await svc!.searchText('in the beginning', 'kjva', 'phrase')
    const keys = new Set(rows.map((r) => `${r.book_id}.${r.chapter}.${r.verse_num}`))
    expect(keys.has('GEN.1.1')).toBe(true)
    expect(keys.has('JHN.1.1')).toBe(true)
  })

  run('getBooks lists 80 KJVA books (66 + 14 Apocrypha) in canonical order', async () => {
    const books = await svc!.getBooks('kjva')
    expect(books.length).toBeGreaterThanOrEqual(66)
    expect(books[0].id).toBe('GEN')
  })
})
