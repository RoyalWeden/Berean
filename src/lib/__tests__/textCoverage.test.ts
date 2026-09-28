/**
 * TEST-009 / TEST-025 (docs/mobile/testing-backlog-2026-09-22.md): shared navigation fallbacks —
 * a reference the current text cannot show opens in KJV; a book switch never keeps a chapter the
 * new book does not have.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { BibleTabState, Tab } from '@/types'
import { textHasBook, resolveTextForBook, chapterForBookSwitch } from '@/lib/textCoverage'
import { navigateToVerse } from '@/lib/verseNavigation'

describe('textHasBook', () => {
  it('LXX has the Old Testament but no New Testament', () => {
    expect(textHasBook('lxx', 'GEN')).toBe(true)
    expect(textHasBook('LXX', 'ISA')).toBe(true)
    expect(textHasBook('lxx', 'JHN')).toBe(false)
    expect(textHasBook('lxx', 'REV')).toBe(false)
  })
  it('LXX lacks books it does not carry even in the OT (Hebrew Esther is ESG there)', () => {
    expect(textHasBook('lxx', 'EST')).toBe(false)
    expect(textHasBook('lxx', 'ESG')).toBe(true)
  })
  it('KJVA carries every canonical book', () => {
    for (const b of ['GEN', 'MAL', 'MAT', 'REV', 'TOB', 'SIR']) expect(textHasBook('kjva', b)).toBe(true)
  })
  it('a dedicated text only carries its own book', () => {
    expect(textHasBook('enoch', 'GEN')).toBe(false)
  })
})

describe('resolveTextForBook', () => {
  it('LXX → NT falls back to KJV', () => expect(resolveTextForBook('lxx', 'JHN')).toBe('kjva'))
  it('LXX → OT keeps the LXX', () => expect(resolveTextForBook('LXX', 'GEN')).toBeUndefined())
  it('KJV → NT keeps KJV', () => expect(resolveTextForBook('kjva', 'MAT')).toBeUndefined())
  it('a text missing the book (LXX has no Hebrew Esther) falls back', () => expect(resolveTextForBook('lxx', 'EST')).toBe('kjva'))
  it('a dedicated text → canonical book falls back to KJV', () => expect(resolveTextForBook('enoch', 'GEN')).toBe('kjva'))
  it('undefined current text keeps the default', () => expect(resolveTextForBook(undefined, 'GEN')).toBeUndefined())
})

describe('chapterForBookSwitch', () => {
  it('keeps the chapter when the new book has it', () => expect(chapterForBookSwitch('EXO', 20)).toBe(20))
  it('opens chapter 1 when the new book is shorter (Genesis 50 → Ruth)', () => expect(chapterForBookSwitch('RUT', 50)).toBe(1))
  it('prefers the loaded chapter count over the static table', () => expect(chapterForBookSwitch('GEN', 12, 10)).toBe(1))
  it('never returns less than 1', () => expect(chapterForBookSwitch('GEN', 0)).toBe(1))
})

describe('navigateToVerse translation fallback (shared by desktop and iPhone)', () => {
  const tab = (translation: string): Tab => ({ id: 't1', spaceId: 'scripture', type: 'bible', title: 'Isaiah 53', state: { bookId: 'ISA', chapter: 53, translation, showStrongs: false, scrollPosition: 0 } } as Tab)
  const stateOf = () => useAppStore.getState().tabs.scripture[0].state as BibleTabState
  beforeEach(() => {
    useAppStore.setState({
      tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
      activeSpace: 'scripture', tabMRUList: [], tabNavStacks: {}, selectedVersesByTab: {},
    })
  })
  const seed = (translation: string) => useAppStore.setState({ tabs: { scripture: [tab(translation)], notes: [], lexicon: [], youtube: [], search: [] }, activeTabId: { scripture: 't1', notes: null, lexicon: null, youtube: null, search: null } })

  it('LXX → cross ref to the New Testament opens the destination in KJV, keeping the LXX in scriptureBack', () => {
    seed('lxx')
    navigateToVerse({ bookId: 'ACT', chapter: 8, verse: 32, origin: { kind: 'cross-ref', source: 'tske' } })
    expect(stateOf()).toMatchObject({ bookId: 'ACT', chapter: 8, targetVerse: 32, translation: 'kjva' })
    expect(stateOf().scriptureBack).toMatchObject({ bookId: 'ISA', chapter: 53, translation: 'lxx' })
  })
  it('LXX → Old Testament stays in the LXX', () => {
    seed('lxx')
    navigateToVerse({ bookId: 'GEN', chapter: 1, verse: 1, origin: { kind: 'cross-ref', source: 'tske' } })
    expect(stateOf().translation).toBe('lxx')
  })
  it('KJV → New Testament stays in KJV', () => {
    seed('kjva')
    navigateToVerse({ bookId: 'JHN', chapter: 3, verse: 16, origin: { kind: 'search-result', query: 'x' } })
    expect(stateOf().translation).toBe('kjva')
  })
  it('an explicit override still wins', () => {
    seed('kjva')
    navigateToVerse({ bookId: 'GEN', chapter: 1, origin: { kind: 'other' }, translationOverride: 'lxx' })
    expect(stateOf().translation).toBe('lxx')
  })
  it('a book switch onto a chapter the book lacks opens chapter 1 (TEST-025)', () => {
    seed('kjva')
    navigateToVerse({ bookId: 'RUT', chapter: 50, origin: { kind: 'book-chapter-picker' } })
    expect(stateOf()).toMatchObject({ bookId: 'RUT', chapter: 1 })
  })
  it('a valid chapter is kept', () => {
    seed('kjva')
    navigateToVerse({ bookId: 'EXO', chapter: 20, origin: { kind: 'book-chapter-picker' } })
    expect(stateOf().chapter).toBe(20)
  })
})
