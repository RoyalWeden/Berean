/** SRCH-002 — the shared, deterministic query parser (every search entry point uses it). */
import { describe, it, expect } from 'vitest'
import { parseSearchIntent, detectTranslationPrefix, bareSourceToken } from '../searchIntent'

const p = (q: string, ctx = {}) => parseSearchIntent(q, ctx)

describe('parseSearchIntent', () => {
  it('plain words are a word search everywhere (never re-capitalized)', () => {
    expect(p('love')).toMatchObject({ text: 'love', textId: null, phrase: false, notesOnly: false, strongs: [] })
    expect(p('yehovah').text).toBe('yehovah')
    expect(p('clean animals').text).toBe('clean animals')
    expect(p('Clean ANIMALS').text).toBe('Clean ANIMALS')
  })

  it('"quoted" is an exact phrase', () => {
    expect(p('"love thy neighbour"')).toMatchObject({ text: 'love thy neighbour', phrase: true })
    expect(p('“love thy neighbour”')).toMatchObject({ text: 'love thy neighbour', phrase: true })
  })

  it("Strong's: H430, several numbers, and 'strong 430' (Hebrew and Greek)", () => {
    expect(p('H430')).toMatchObject({ strongs: ['H430'], strongsQuery: 'H430', text: '' })
    expect(p('h430').strongs).toEqual(['H430'])
    expect(p('G26 H430').strongs).toEqual(['G26', 'H430'])
    expect(p('strong 430')).toMatchObject({ strongs: ['H430', 'G430'], strongsQuery: null })
    expect(p("strong's 430").strongs).toEqual(['H430', 'G430'])
    expect(p('Strongs #430').strongs).toEqual(['H430', 'G430'])
  })

  it('a reference is a destination, not words (and picks its database)', () => {
    const m = p('Matthew 10')
    expect(m.text).toBe('')
    expect(m.places[0]).toMatchObject({ kind: 'passage', bookId: 'MAT', chapter: 10 })
    expect(p('Matthew 10 LXX').places[0]).toMatchObject({ kind: 'passage', bookId: 'MAT', chapter: 10 })
    const j = p('jubilees 23')
    expect(j.text).toBe('')
    expect(j.places[0]).toMatchObject({ kind: 'passage', chapter: 23, textId: 'jubilees' })
  })

  it('a book name offers the book AND searches the word', () => {
    const m = p('Matthew')
    expect(m.text).toBe('Matthew')
    expect(m.places.some((d) => d.kind === 'book' && d.bookId === 'MAT')).toBe(true)
    expect(p('zechariah').places.some((d) => d.kind === 'book' && d.bookId === 'ZEC')).toBe(true)
  })

  it('a source named alone goes to that text: lxx, 1 enoch, jubilees', () => {
    expect(p('lxx')).toMatchObject({ textId: 'lxx', text: '' })
    expect(p('lxx').places[0]).toMatchObject({ kind: 'collection', textId: 'lxx' })
    expect(p('1 enoch')).toMatchObject({ textId: 'enoch', text: '' })
    expect(p('Jubilees').textId).toBe('jubilees')
  })

  it('a source + words searches only that text (prefix, colon or trailing form)', () => {
    expect(p('lxx love')).toMatchObject({ textId: 'lxx', text: 'love' })
    expect(p('enoch: watchers')).toMatchObject({ textId: 'enoch', text: 'watchers' })
    expect(p('love lxx')).toMatchObject({ textId: 'lxx', text: 'love' })
  })

  it('notes / my notes search notes only', () => {
    expect(p('notes')).toMatchObject({ notesOnly: true, text: '' })
    expect(p('my notes')).toMatchObject({ notesOnly: true, text: '' })
    expect(p('notes: sabbath')).toMatchObject({ notesOnly: true, text: 'sabbath' })
    expect(p('my notes sabbath')).toMatchObject({ notesOnly: true, text: 'sabbath' })
    expect(p('notebook').notesOnly).toBe(false)
  })

  it('a bare chapter means the current book when there is one', () => {
    expect(p('10', { bookId: 'MAT', textId: 'kjva' }).places[0]).toMatchObject({ kind: 'passage', bookId: 'MAT', chapter: 10 })
  })

  it('empty is empty', () => {
    expect(p('   ')).toMatchObject({ raw: '', text: '', places: [] })
  })
})

describe('shared desktop prefixes', () => {
  it('detectTranslationPrefix is the desktop behaviour (a reference wins over a prefix)', () => {
    expect(detectTranslationPrefix('lxx creation')).toEqual({ textId: 'lxx', cleanQuery: 'creation' })
    expect(detectTranslationPrefix('jubilees 17')).toBeNull()
    expect(detectTranslationPrefix('isa 28 lxx')).toBeNull()
    expect(detectTranslationPrefix('grace lxx')).toEqual({ textId: 'lxx', cleanQuery: 'grace' })
  })
  it('bareSourceToken', () => {
    expect(bareSourceToken('septuagint')).toBe('lxx')
    expect(bareSourceToken('love')).toBeNull()
  })
})
