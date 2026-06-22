/**
 * Filter model for the redesigned advanced scripture search: canonical book-group
 * presets, multi-select book filtering, and a "current book/chapter" scope. Pure and
 * unit-tested so the chip UI can rely on it.
 *
 * Book ids follow the app's scheme (GEN, EXO, … 1SA, MAT, 1CO, REV, plus the
 * pseudepigrapha HER_VIS etc.). A group is just a named, ordered list of book ids.
 */

export interface BookGroup {
  id: string
  label: string
  books: string[]
}

/** Canonical groupings of the 66-book Protestant canon (Apocrypha / Pseudepigrapha
 *  are handled by the existing testament filter, not here). */
export const CANONICAL_BOOK_GROUPS: BookGroup[] = [
  { id: 'torah', label: 'Torah', books: ['GEN', 'EXO', 'LEV', 'NUM', 'DEU'] },
  { id: 'history', label: 'History', books: ['JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST'] },
  { id: 'wisdom', label: 'Wisdom', books: ['JOB', 'PSA', 'PRO', 'ECC', 'SNG'] },
  { id: 'major-prophets', label: 'Major Prophets', books: ['ISA', 'JER', 'LAM', 'EZK', 'DAN'] },
  { id: 'minor-prophets', label: 'Minor Prophets', books: ['HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'] },
  { id: 'gospels', label: 'Gospels', books: ['MAT', 'MRK', 'LUK', 'JHN'] },
  { id: 'acts', label: 'Acts', books: ['ACT'] },
  { id: 'pauline', label: 'Pauline Epistles', books: ['ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM'] },
  { id: 'general-epistles', label: 'General Epistles', books: ['HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD'] },
  { id: 'revelation', label: 'Revelation', books: ['REV'] },
]

export function bookGroupById(id: string): BookGroup | undefined {
  return CANONICAL_BOOK_GROUPS.find((g) => g.id === id)
}

/** Toggle a book in a multi-select set, returning a new array (order-preserving append). */
export function toggleBook(selected: string[], bookId: string): string[] {
  return selected.includes(bookId) ? selected.filter((b) => b !== bookId) : [...selected, bookId]
}

/**
 * Apply a group chip to the current selection: if every book of the group is already
 * selected, remove them (toggle off); otherwise add the missing ones (toggle on).
 */
export function toggleGroup(selected: string[], group: BookGroup): string[] {
  const allSelected = group.books.every((b) => selected.includes(b))
  if (allSelected) return selected.filter((b) => !group.books.includes(b))
  const set = new Set(selected)
  for (const b of group.books) set.add(b)
  // keep a stable order: existing selection first, then newly added in group order
  return [...selected, ...group.books.filter((b) => !selected.includes(b))].filter((b, i, a) => a.indexOf(b) === i && set.has(b))
}

/** True when every book of the group is in the selection (chip shows as active). */
export function isGroupActive(selected: string[], group: BookGroup): boolean {
  return group.books.length > 0 && group.books.every((b) => selected.includes(b))
}

/**
 * Does a result book pass the book filter?
 * Empty selection = no book restriction (everything passes).
 */
export function bookPassesFilter(selectedBooks: string[], bookId: string): boolean {
  return selectedBooks.length === 0 || selectedBooks.includes(bookId)
}

/** Filter a book list to those whose name or id contains the (case-insensitive) query. */
export function filterBookList<T extends { id: string; name: string }>(books: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return books
  return books.filter((b) => b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
}

/** Short human summary of the active book filter, for the chip label. */
export function bookFilterSummary(selectedBooks: string[], nameOf: (id: string) => string): string {
  if (selectedBooks.length === 0) return 'Any book'
  if (selectedBooks.length === 1) return nameOf(selectedBooks[0])
  const group = CANONICAL_BOOK_GROUPS.find((g) =>
    g.books.length === selectedBooks.length && g.books.every((b) => selectedBooks.includes(b)))
  if (group) return group.label
  return `${selectedBooks.length} books`
}
