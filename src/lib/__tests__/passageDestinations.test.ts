/**
 * NEW-11 / NEW-11A / NEW-11B: the passage picker's collections, book naming and search
 * resolution (typed text → navigation destinations, not a filter).
 */
import { describe, it, expect } from 'vitest'
import {
  PASSAGE_COLLECTIONS, resolvePassageQuery, singleBookOf, bookLabelInCollection, collectionForText,
} from '@/lib/passageDestinations'
import { displayBookName, normalizeBookName } from '@/lib/parseRef'

const KJVA_BOOKS = [
  { id: 'GEN', name: 'Genesis' }, { id: '1SA', name: 'I Samuel' }, { id: '1MA', name: 'I Maccabees' },
  { id: '1CO', name: 'I Corinthians' }, { id: '1JN', name: 'I John' }, { id: '2JN', name: 'II John' },
  { id: '3JN', name: 'III John' }, { id: 'JHN', name: 'John' }, { id: 'REV', name: 'Revelation of John' },
]

describe('book names (NEW-11A)', () => {
  it('numbered books use arabic numerals, never roman', () => {
    expect(displayBookName('I John', '1JN')).toBe('1 John')
    expect(displayBookName('II John', '2JN')).toBe('2 John')
    expect(displayBookName('III John', '3JN')).toBe('3 John')
    expect(displayBookName('I Samuel', '1SA')).toBe('1 Samuel')
    expect(displayBookName('II Maccabees', '2MA')).toBe('2 Maccabees')
    expect(displayBookName('IV Maccabees', '4MA')).toBe('4 Maccabees')
    expect(displayBookName('Revelation of John', 'REV')).toBe('Revelation')
    expect(normalizeBookName('Recognitions of Clement — Book VIII')).toBe('Recognitions of Clement — Book 8')
  })
  it('leaves ordinary names alone and falls back to the canonical name for raw ids', () => {
    expect(displayBookName('Isaiah', 'ISA')).toBe('Isaiah')
    expect(displayBookName('Ivory', 'X')).toBe('Ivory')
    expect(displayBookName('3MA', '3MA')).toBe('3 Maccabees')
    expect(displayBookName('', 'GEN')).toBe('Genesis')
  })
  it('lists a book by its name inside the collection', () => {
    expect(bookLabelInCollection('Recognitions of Clement — Book III', 'RCL3')).toBe('Book 3')
    expect(bookLabelInCollection('Shepherd of Hermas — Visions', 'HER_VIS')).toBe('Visions')
    expect(bookLabelInCollection('II Kings', '2KI')).toBe('2 Kings')
  })
})

describe('collections (NEW-11)', () => {
  it('covers every translation plus the KJVA Apocrypha group', () => {
    const keys = PASSAGE_COLLECTIONS.map((c) => c.key)
    expect(keys.slice(0, 3)).toEqual(['kjva', 'kjva:Apocrypha', 'lxx'])
    for (const id of ['enoch', 'jubilees', 'recog_clement', 'hermas', 'hermas_taylor', 't12p', 'ep_barnabas']) expect(keys).toContain(id)
    expect(collectionForText('LXX')?.label).toBe('Septuagint (Brenton)')
  })
  it('knows single-book collections', () => {
    expect(singleBookOf('enoch')).toBe('ENO')
    expect(singleBookOf('jubilees')).toBe('JUB')
    expect(singleBookOf('kjva')).toBeNull()
    expect(singleBookOf('t12p')).toBeNull()
    expect(singleBookOf('hermas')).toBeNull()
  })
})

describe('resolvePassageQuery (NEW-11B)', () => {
  const r = (q: string, textId = 'kjva') => resolvePassageQuery(q, { textId, books: textId === 'kjva' ? KJVA_BOOKS : [] })

  it('collection aliases open the collection', () => {
    for (const q of ['LXX', 'septuagint', 'Brenton']) expect(r(q)[0]).toMatchObject({ kind: 'collection', textId: 'lxx' })
    for (const q of ['kjv', 'KJVA', 'king james']) expect(r(q, 'lxx')[0]).toMatchObject({ kind: 'collection', textId: 'kjva' })
    expect(r('apocrypha')[0]).toMatchObject({ kind: 'collection', textId: 'kjva', group: 'Apocrypha' })
    expect(r('jubilees')[0]).toMatchObject({ kind: 'collection', textId: 'jubilees' })
  })

  it('"Enoch" is the 1 Enoch collection once (its only book is not listed again)', () => {
    const res = r('Enoch')
    expect(res[0]).toMatchObject({ kind: 'collection', textId: 'enoch' })
    expect(res.some((d) => d.kind === 'book' && d.bookId === 'ENO')).toBe(false)
  })

  it('references resolve to passages in the current text', () => {
    expect(r('Genesis 3')[0]).toMatchObject({ kind: 'passage', textId: 'kjva', bookId: 'GEN', chapter: 3, label: 'Genesis 3' })
    expect(r('gen 3:5')[0]).toMatchObject({ kind: 'passage', bookId: 'GEN', chapter: 3, verse: 5 })
    expect(r('1 cor 13')[0]).toMatchObject({ kind: 'passage', bookId: '1CO', chapter: 13, label: '1 Corinthians 13' })
    expect(r('Psalm 23:1-6')[0]).toMatchObject({ kind: 'passage', bookId: 'PSA', chapter: 23, verse: 1, endVerse: 6 })
    expect(r('gen 3', 'lxx')[0]).toMatchObject({ kind: 'passage', textId: 'lxx', bookId: 'GEN' })
  })

  it('falls back to the text that has the book', () => {
    expect(r('John 3:16', 'lxx')[0]).toMatchObject({ kind: 'passage', textId: 'kjva', bookId: 'JHN', chapter: 3, verse: 16 })
    expect(r('1 Enoch 5')[0]).toMatchObject({ kind: 'passage', textId: 'enoch', bookId: 'ENO', chapter: 5 })
    expect(r('Genesis 1', 'enoch')[0]).toMatchObject({ kind: 'passage', textId: 'kjva' })
  })

  it('book names open the book (arabic-numbered labels)', () => {
    expect(r('1 cor')[0]).toMatchObject({ kind: 'book', bookId: '1CO', label: '1 Corinthians' })
    expect(r('genesis')[0]).toMatchObject({ kind: 'book', bookId: 'GEN', textId: 'kjva' })
    const john = r('john').filter((d) => d.kind === 'book').map((d) => d.label)
    expect(john[0]).toBe('John')
    expect(john).toEqual(expect.arrayContaining(['1 John', '2 John', '3 John']))
    expect(john.some((l) => /\bI+ John/.test(l))).toBe(false)
    expect(r('matthew', 'lxx')[0]).toMatchObject({ kind: 'book', bookId: 'MAT', textId: 'kjva' })
  })

  it('empty or unknown queries resolve to nothing', () => {
    expect(r('')).toEqual([])
    expect(r('zzzzqq')).toEqual([])
  })
})
