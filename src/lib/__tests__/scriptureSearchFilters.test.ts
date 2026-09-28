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

import {
  BOOK_SECTIONS, APOCRYPHA_BOOK_IDS, bookSections, booksSummary, selectGroup, clearGroup,
  groupSelectionState, sortBookIds,
} from '../scriptureSearchFilters'

describe('BOOK_SECTIONS', () => {
  it('orders OT, Apocrypha, NT with 39 / 17 / 27 individual books', () => {
    expect(BOOK_SECTIONS.map((s) => s.label)).toEqual(['Old Testament', 'Apocrypha', 'New Testament'])
    expect(BOOK_SECTIONS.map((s) => s.books.length)).toEqual([39, APOCRYPHA_BOOK_IDS.length, 27])
    expect(BOOK_SECTIONS[0].books[0]).toBe('GEN')
    expect(BOOK_SECTIONS[2].books.at(-1)).toBe('REV')
  })
})

describe('sortBookIds', () => {
  it('sorts canonically and de-duplicates', () => {
    expect(sortBookIds(['REV', 'TOB', 'GEN', 'GEN', 'MAL'])).toEqual(['GEN', 'MAL', 'TOB', 'REV'])
  })
  it('puts non-canon books after the sections', () => {
    expect(sortBookIds(['HER_VIS', 'GEN'])).toEqual(['GEN', 'HER_VIS'])
  })
})

describe('bookSections', () => {
  it('lists individual books with shared names, filtered by availability and query', () => {
    const all = bookSections()
    expect(all[0].books[0]).toEqual({ id: 'GEN', name: 'Genesis' })
    const onlyGenMat = bookSections({ available: ['GEN', 'MAT'] })
    expect(onlyGenMat.map((s) => s.id)).toEqual(['ot', 'nt'])
    const q = bookSections({ query: 'macc' })
    expect(q.map((s) => s.id)).toEqual(['apocrypha'])
    expect(q[0].books.map((b) => b.id)).toEqual(['1MA', '2MA', '3MA', '4MA'])
  })
})

describe('selectGroup / clearGroup / groupSelectionState', () => {
  it('select adds (never removes) and keeps canonical order; clear removes', () => {
    expect(selectGroup(['MAT', 'GEN'], torah.books)).toEqual(['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'MAT'])
    expect(selectGroup(torah.books, torah.books)).toEqual(torah.books)
    expect(clearGroup(['MAT', 'GEN', 'EXO'], torah.books)).toEqual(['MAT'])
  })
  it('reports none / some / all', () => {
    expect(groupSelectionState([], torah.books)).toBe('none')
    expect(groupSelectionState(['GEN'], torah.books)).toBe('some')
    expect(groupSelectionState(torah.books, torah.books)).toBe('all')
  })
})

describe('booksSummary', () => {
  it('summarizes empty, a whole section/group, and individual books', () => {
    expect(booksSummary([])).toBe('Every book')
    expect(booksSummary(BOOK_SECTIONS[0].books)).toBe('Old Testament')
    expect(booksSummary(['NUM', 'GEN', 'DEU', 'EXO', 'LEV'])).toBe('Torah')
    expect(booksSummary(['GEN'])).toBe('Genesis')
    expect(booksSummary(['EXO', 'GEN'])).toBe('Genesis, Exodus')
    expect(booksSummary(['GEN', 'EXO', 'MAT', 'REV', 'TOB'])).toBe('Genesis, Exodus +3')
  })
})
