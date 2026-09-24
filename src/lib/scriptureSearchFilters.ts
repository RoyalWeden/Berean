import { bookName, bookOrder } from './parseRef'

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

// ── Individual-book selection (NEW-15) ──────────────────────────────────────────────────
// The Books filter is ALWAYS a set of individual book ids. Testament sections and the
// canonical groups above are only quick-select helpers that add/remove those ids. Every
// Books UI (desktop Scope modal, iPhone BooksFilterView) reads its list, ordering and
// summary from here so they cannot drift.

/** Deuterocanonical books across the Bible editions (KJVA + Brenton LXX), in KJV-Apocrypha
 *  order with the LXX-only books appended. */
export const APOCRYPHA_BOOK_IDS: readonly string[] = [
  '1ES', '2ES', 'TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR', 'LJE', 'PRA', 'SUS', 'BEL', 'PRM',
  '1MA', '2MA', '3MA', '4MA',
]

const groupBooks = (ids: string[]) => CANONICAL_BOOK_GROUPS.filter((g) => ids.includes(g.id)).flatMap((g) => g.books)

/** Testament sections shown as headers in every Books picker, in display order. */
export const BOOK_SECTIONS: readonly BookGroup[] = [
  { id: 'ot', label: 'Old Testament', books: groupBooks(['torah', 'history', 'wisdom', 'major-prophets', 'minor-prophets']) },
  { id: 'apocrypha', label: 'Apocrypha', books: [...APOCRYPHA_BOOK_IDS] },
  { id: 'nt', label: 'New Testament', books: groupBooks(['gospels', 'acts', 'pauline', 'general-epistles', 'revelation']) },
]

const SECTION_INDEX = new Map<string, number>()
BOOK_SECTIONS.forEach((s) => s.books.forEach((b) => { if (!SECTION_INDEX.has(b)) SECTION_INDEX.set(b, SECTION_INDEX.size) }))

/** Canonical sort key: OT, Apocrypha, NT (section order), then anything else by parseRef order. */
export function bookSortKey(bookId: string): number {
  return SECTION_INDEX.get(bookId) ?? 1000 + bookOrder(bookId)
}

/** Book ids sorted canonically (stable, de-duplicated). */
export function sortBookIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => bookSortKey(a) - bookSortKey(b))
}

export interface BookListItem { id: string; name: string }
export interface BookSection { id: string; label: string; books: BookListItem[] }

/**
 * The sectioned book list for a picker. `available` (optional) limits it to books that exist
 * in the loaded texts; `query` filters by name or id; `nameOf` defaults to the shared bookName().
 * Empty sections are dropped.
 */
export function bookSections(opts: {
  available?: Iterable<string>
  query?: string
  nameOf?: (id: string) => string
} = {}): BookSection[] {
  const avail = opts.available ? new Set(opts.available) : null
  const nameOf = opts.nameOf ?? bookName
  return BOOK_SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    books: filterBookList(
      s.books.filter((id) => !avail || avail.has(id)).map((id) => ({ id, name: nameOf(id) })),
      opts.query ?? '',
    ),
  })).filter((s) => s.books.length > 0)
}

/** Add every book of a group to the selection (never removes). Result is canonically sorted. */
export function selectGroup(selected: readonly string[], books: readonly string[]): string[] {
  return sortBookIds([...selected, ...books])
}

/** Remove every book of a group from the selection. */
export function clearGroup(selected: readonly string[], books: readonly string[]): string[] {
  const drop = new Set(books)
  return selected.filter((b) => !drop.has(b))
}

/** How much of a group is selected — drives "Select all" vs "Clear" and mixed state. */
export function groupSelectionState(selected: readonly string[], books: readonly string[]): 'none' | 'some' | 'all' {
  if (books.length === 0) return 'none'
  const n = books.filter((b) => selected.includes(b)).length
  return n === 0 ? 'none' : n === books.length ? 'all' : 'some'
}

/**
 * Human summary of the Books selection:
 *  - empty → "Every book"
 *  - exactly one section / canonical group → its label ("Old Testament", "Torah")
 *  - 1–2 books → "Genesis, Exodus"
 *  - more → first two (canonical order) + remainder: "Genesis, Exodus +3"
 */
export function booksSummary(ids: readonly string[], nameOf: (id: string) => string = bookName): string {
  const sorted = sortBookIds(ids)
  if (sorted.length === 0) return 'Every book'
  if (sorted.length > 1) {
    const exact = [...BOOK_SECTIONS, ...CANONICAL_BOOK_GROUPS].find((g) =>
      g.books.length === sorted.length && g.books.every((b) => sorted.includes(b)))
    if (exact) return exact.label
  }
  const head = sorted.slice(0, 2).map(nameOf).join(', ')
  return sorted.length > 2 ? `${head} +${sorted.length - 2}` : head
}
