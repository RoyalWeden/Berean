import { describe, it, expect } from 'vitest'
import { parseMultiBookQuery } from '../multiBookSearch'

describe('parseMultiBookQuery — Recognitions of Clement (book-numbered)', () => {
  it('bare edition name + one number = BOOK, not chapter of Book 1', () => {
    expect(parseMultiBookQuery('recognitions of clement 5')).toMatchObject({ bookId: 'RCL5', chapter: 1 })
    expect(parseMultiBookQuery('rcl 5')).toMatchObject({ bookId: 'RCL5', chapter: 1 })
    expect(parseMultiBookQuery('roc 5')).toMatchObject({ bookId: 'RCL5', chapter: 1 })
  })

  it('two bare numbers = book, chapter', () => {
    expect(parseMultiBookQuery('recognitions of clement 5 3')).toMatchObject({ bookId: 'RCL5', chapter: 3 })
  })

  it('colon between the two bare numbers still reads as book:chapter', () => {
    expect(parseMultiBookQuery('recognitions of clement 5:3')).toMatchObject({ bookId: 'RCL5', chapter: 3 })
  })

  it('three bare numbers = book, chapter, verse', () => {
    expect(parseMultiBookQuery('recognitions of clement 5 3 2')).toMatchObject({ bookId: 'RCL5', chapter: 3, verse: 2 })
  })

  it('explicit "book N chapter M" keywords override position', () => {
    expect(parseMultiBookQuery('recognitions of clement book 5 chapter 3')).toMatchObject({ bookId: 'RCL5', chapter: 3 })
  })

  it('explicit "book N chapter M verse V"', () => {
    expect(parseMultiBookQuery('recognitions of clement book 5 chapter 3 verse 2')).toMatchObject({ bookId: 'RCL5', chapter: 3, verse: 2 })
  })

  it('a book-specific token ("rcl5") treats its own remainder as chapter[:verse], not book+chapter', () => {
    expect(parseMultiBookQuery('rcl5 3')).toMatchObject({ bookId: 'RCL5', chapter: 3 })
    expect(parseMultiBookQuery('rcl5 3:2')).toMatchObject({ bookId: 'RCL5', chapter: 3, verse: 2 })
    expect(parseMultiBookQuery('rcl5')).toMatchObject({ bookId: 'RCL5', chapter: 1 })
  })

  it('bare edition name with no number defers to the caller\'s own fallback', () => {
    expect(parseMultiBookQuery('recognitions of clement')).toBeNull()
    expect(parseMultiBookQuery('rcl')).toBeNull()
  })

  it('rejects an out-of-range book number', () => {
    expect(parseMultiBookQuery('recognitions of clement 11')).toBeNull()
    expect(parseMultiBookQuery('recognitions of clement 0')).toBeNull()
  })

  it('rejects a chapter beyond that book\'s known max', () => {
    // RCL6's max chapter is 15
    expect(parseMultiBookQuery('recognitions of clement 6 99')).toBeNull()
  })
})

describe('parseMultiBookQuery — Shepherd of Hermas (section-numbered)', () => {
  it('traditional section number maps to the correct flat db chapter', () => {
    expect(parseMultiBookQuery('hermas vision 3')).toMatchObject({ bookId: 'HER_VIS', chapter: 9 })
    expect(parseMultiBookQuery('hermas mandate 5')).toMatchObject({ bookId: 'HER_MAN', chapter: 9 })
    expect(parseMultiBookQuery('hermas similitude 9')).toMatchObject({ bookId: 'HER_SIM', chapter: 29 })
  })

  it('sub-chapter index selects within the section', () => {
    expect(parseMultiBookQuery('hermas vision 3.2')).toMatchObject({ bookId: 'HER_VIS', chapter: 10 })
    expect(parseMultiBookQuery('hermas similitude 9.4')).toMatchObject({ bookId: 'HER_SIM', chapter: 32 })
  })

  it('verse number carries through', () => {
    expect(parseMultiBookQuery('hermas similitude 9.4:2')).toMatchObject({ bookId: 'HER_SIM', chapter: 32, verse: 2 })
  })

  it('"shepherd of hermas" full name works the same as "hermas"', () => {
    expect(parseMultiBookQuery('shepherd of hermas similitude 5')).toMatchObject({ bookId: 'HER_SIM', chapter: 5 })
  })

  it('a bare flat-chapter form ("hermas visions 3") defers to parseRef, unchanged', () => {
    expect(parseMultiBookQuery('hermas visions 3')).toBeNull()
    expect(parseMultiBookQuery('hermas 9')).toBeNull()
    expect(parseMultiBookQuery('hermas')).toBeNull()
  })
})

describe('parseMultiBookQuery — everything else stays untouched', () => {
  it('non-RCL/Hermas references return null (defer to parseRef)', () => {
    expect(parseMultiBookQuery('Genesis 1:1')).toBeNull()
    expect(parseMultiBookQuery('gen 1')).toBeNull()
  })

  it('plain keyword searches return null', () => {
    expect(parseMultiBookQuery('in the beginning')).toBeNull()
    expect(parseMultiBookQuery('her 5 children')).toBeNull()
  })
})
