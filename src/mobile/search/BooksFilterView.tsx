import React, { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import {
  BOOK_SECTIONS, CANONICAL_BOOK_GROUPS, bookSections, booksSummary, toggleBook, selectGroup,
  clearGroup, groupSelectionState, sortBookIds,
} from '@/lib/scriptureSearchFilters'
import { haptic } from '../primitives/haptics'
import './booksFilter.css'

/**
 * iPhone Books filter (NEW-15): the selection is always a set of individual book ids.
 * Sections (Old Testament / Apocrypha / New Testament) list every book as a ≥44pt checkmark
 * row; section "Select all / Clear" and the quick-select chips (testaments + canonical groups)
 * only add/remove those individual ids. List, ordering and summary come from the shared
 * helpers in scriptureSearchFilters so desktop and phone never drift.
 */
export function BooksFilterView({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => bookSections({ query }), [query])
  const selected = value
  const set = (ids: string[]) => { void haptic.selection(); onChange(sortBookIds(ids)) }
  const quickGroups = [...BOOK_SECTIONS, ...CANONICAL_BOOK_GROUPS]

  return (
    <div className="mobile-books-filter">
      <div className="mobile-books-summary" aria-live="polite">
        <div className="mobile-books-summary-text">
          <span className="mobile-books-summary-label">{selected.length === 0 ? 'Searching' : `${selected.length} selected`}</span>
          <span className="mobile-books-summary-value">{booksSummary(selected)}</span>
        </div>
        {selected.length > 0 && (
          <button type="button" className="mobile-books-link" onClick={() => set([])}>Clear all</button>
        )}
      </div>

      <div className="mobile-search-field mobile-books-search">
        <Search size={17} aria-hidden />
        <input className="mobile-search-input" type="search" inputMode="text" autoCorrect="off" autoCapitalize="words"
          placeholder="Find a book" aria-label="Find a book" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button type="button" className="mobile-books-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>
        )}
      </div>

      {!query && (
        <div className="mobile-books-quick" role="group" aria-label="Quick select">
          {quickGroups.map((g) => {
            const on = groupSelectionState(selected, g.books) === 'all'
            return (
              <button key={g.id} type="button" className={`mobile-chip${on ? ' is-on' : ''}`} aria-pressed={on}
                onClick={() => set(on ? clearGroup(selected, g.books) : selectGroup(selected, g.books))}>{g.label}</button>
            )
          })}
        </div>
      )}

      {sections.length === 0 && <div className="mobile-books-empty mobile-muted">No books match “{query.trim()}”</div>}

      {sections.map((sec) => {
        const ids = sec.books.map((b) => b.id)
        const state = groupSelectionState(selected, ids)
        const picked = ids.filter((id) => selected.includes(id)).length
        return (
          <section key={sec.id} className="mobile-books-section" aria-label={sec.label}>
            <header className="mobile-books-section-header">
              <span className="mobile-books-section-title">
                {sec.label}{picked > 0 && <span className="mobile-books-section-count"> · {picked} of {ids.length}</span>}
              </span>
              <span className="mobile-books-section-actions">
                {state !== 'all' && <button type="button" className="mobile-books-link" onClick={() => set(selectGroup(selected, ids))}>Select all</button>}
                {state !== 'none' && <button type="button" className="mobile-books-link" onClick={() => set(clearGroup(selected, ids))}>Clear</button>}
              </span>
            </header>
            <ul className="mobile-books-list" aria-label={sec.label}>
              {sec.books.map((b) => {
                const on = selected.includes(b.id)
                return (
                  <li key={b.id}>
                    <button type="button" className={`mobile-books-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => set(toggleBook(selected, b.id))}>
                      <span className="mobile-books-row-name">{b.name}</span>
                      <span className="mobile-books-row-check" aria-hidden>{on && <Check size={18} strokeWidth={2.5} />}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export default BooksFilterView
