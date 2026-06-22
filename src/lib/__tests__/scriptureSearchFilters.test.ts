import { describe, it, expect } from 'vitest'
import {
  CANONICAL_BOOK_GROUPS, bookGroupById, toggleBook, toggleGroup, isGroupActive,
  bookPassesFilter, filterBookList, bookFilterSummary,
} from '../scriptureSearchFilters'

const torah = bookGroupById('torah')!
const gospels = bookGroupById('gospels')!

describe('canonical groups', () => {
  it('covers the 66-book canon exactly once across all groups', () => {
    const all = CANONICAL_BOOK_GROUPS.flatMap((g) => g.books)
    expect(all.length).toBe(66)
    expect(new Set(all).size).toBe(66)
  })
  it('Torah and Gospels have the expected books', () => {
    expect(torah.books).toEqual(['GEN', 'EXO', 'LEV', 'NUM', 'DEU'])
    expect(gospels.books).toEqual(['MAT', 'MRK', 'LUK', 'JHN'])
  })
})

describe('toggleBook', () => {
  it('adds then removes a book', () => {
    expect(toggleBook([], 'GEN')).toEqual(['GEN'])
    expect(toggleBook(['GEN', 'EXO'], 'GEN')).toEqual(['EXO'])
  })
})

describe('toggleGroup', () => {
  it('adds all group books when none/some selected', () => {
    expect(toggleGroup([], torah)).toEqual(['GEN', 'EXO', 'LEV', 'NUM', 'DEU'])
    expect(toggleGroup(['GEN'], torah)).toEqual(['GEN', 'EXO', 'LEV', 'NUM', 'DEU'])
  })
  it('removes all group books when all already selected', () => {
    expect(toggleGroup(['GEN', 'EXO', 'LEV', 'NUM', 'DEU'], torah)).toEqual([])
  })
  it('preserves unrelated selections', () => {
    expect(toggleGroup(['MAT', 'GEN', 'EXO', 'LEV', 'NUM', 'DEU'], torah)).toEqual(['MAT'])
  })
})

describe('isGroupActive', () => {
  it('is true only when every group book is selected', () => {
    expect(isGroupActive(['GEN', 'EXO', 'LEV', 'NUM', 'DEU'], torah)).toBe(true)
    expect(isGroupActive(['GEN', 'EXO'], torah)).toBe(false)
  })
})

describe('bookPassesFilter', () => {
  it('passes everything when nothing selected', () => {
    expect(bookPassesFilter([], 'GEN')).toBe(true)
  })
  it('restricts to the selected books', () => {
    expect(bookPassesFilter(['GEN'], 'GEN')).toBe(true)
    expect(bookPassesFilter(['GEN'], 'EXO')).toBe(false)
  })
})

describe('filterBookList', () => {
  const books = [{ id: 'GEN', name: 'Genesis' }, { id: 'PSA', name: 'Psalms' }, { id: 'MAT', name: 'Matthew' }]
  it('matches by name or id, case-insensitive', () => {
    expect(filterBookList(books, 'psal').map((b) => b.id)).toEqual(['PSA'])
    expect(filterBookList(books, 'gen').map((b) => b.id)).toEqual(['GEN'])
    expect(filterBookList(books, '').length).toBe(3)
  })
})

describe('bookFilterSummary', () => {
  const nameOf = (id: string) => ({ GEN: 'Genesis', MAT: 'Matthew' } as Record<string, string>)[id] ?? id
  it('summarizes empty / single / group / count', () => {
    expect(bookFilterSummary([], nameOf)).toBe('Any book')
    expect(bookFilterSummary(['GEN'], nameOf)).toBe('Genesis')
    expect(bookFilterSummary(torah.books, nameOf)).toBe('Torah')
    expect(bookFilterSummary(['GEN', 'MAT'], nameOf)).toBe('2 books')
  })
})
