// @vitest-environment jsdom
/**
 * QO-001 — resource identity + the 'reuse' intent: an open tab that shows the destination is
 * brought forward (current session only), meaningfully different resources stay distinct, an
 * intentional copy stays possible, other sessions' tabs are found but never switched to silently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore, type Session } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { openDestination, activateTabMatch, currentTab } from '../destination'
import { findOpenTabs, reusableTab, tabShowsDestination, tabsMatchingText, tabDestination } from '../tabResolution'

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const bible = (id: string, bookId = 'ROM', chapter = 13, translation = 'KJVA', extra: Record<string, unknown> = {}): Tab =>
  ({ id, spaceId: 'scripture', type: 'bible', title: `${bookId} ${chapter}`, state: { bookId, chapter, translation, showStrongs: false, scrollPosition: 0, ...extra } } as Tab)
const note = (id: string, noteId: string | null, title = 'Romans 13'): Tab => ({ id, spaceId: 'notes', type: 'note', title, state: { noteId, isNew: false } } as Tab)
const lex = (id: string, num: string): Tab => ({ id, spaceId: 'lexicon', type: 'lexicon', title: num, state: { strongsNum: num } } as Tab)
const byspace = (tabs: Tab[]) => Object.fromEntries(SPACES.map((sp) => [sp, tabs.filter((t) => t.spaceId === sp)])) as Record<SpaceId, Tab[]>

function reset(tabs: Tab[], activeId: string, others: Array<{ id: string; name: string; tabs: Tab[] }> = []) {
  const active = tabs.find((t) => t.id === activeId)!
  const activeTabId = Object.fromEntries(SPACES.map((sp) => [sp, tabs.find((t) => t.spaceId === sp)?.id ?? null])) as Record<SpaceId, string | null>
  activeTabId[active.spaceId] = active.id
  const sessions: Session[] = [
    { id: 'A', name: 'Study A', tabs: byspace(tabs), activeTabId },
    ...others.map((o) => ({ id: o.id, name: o.name, tabs: byspace(o.tabs), activeTabId: Object.fromEntries(SPACES.map((sp) => [sp, o.tabs.find((t) => t.spaceId === sp)?.id ?? null])) as Record<SpaceId, string | null> })),
  ]
  useAppStore.setState({
    tabs: byspace(tabs), activeTabId, activeSpace: active.spaceId, currentSessionId: 'A', sessions,
    sessionDisplayOrders: { A: tabs.map((t) => t.id) }, tabMRUList: [], tabNavStacks: {}, isNavJumping: false,
    pendingNoteId: null, pendingLexiconEntry: null, defaultBibleTranslation: 'kjva',
  })
}
const count = () => SPACES.reduce((n, sp) => n + useAppStore.getState().tabs[sp].length, 0)
const st = () => useAppStore.getState()

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })

describe('resource identity', () => {
  it('scripture vs a note with the same title are different resources', () => {
    expect(tabShowsDestination(note('n', 'x', 'Romans 13'), { kind: 'passage', bookId: 'ROM', chapter: 13 })).toBe(false)
    expect(tabShowsDestination(bible('b'), { kind: 'note', noteId: 'x' })).toBe(false)
  })
  it('two notes with identical titles stay distinct (by note id)', () => {
    reset([note('n1', 'a', 'Same'), note('n2', 'b', 'Same')], 'n1')
    expect(findOpenTabs({ kind: 'note', noteId: 'b' }, st()).map((m) => m.tab.id)).toEqual(['n2'])
  })
  it('a Notes LIST tab is no match for a note', () => {
    expect(tabShowsDestination(note('n', null), { kind: 'note', noteId: 'x' })).toBe(false)
  })
  it('different translations are different resources', () => {
    expect(tabShowsDestination(bible('b', 'GEN', 1, 'LXX'), { kind: 'passage', bookId: 'GEN', chapter: 1, textId: 'kjva' })).toBe(false)
    expect(tabShowsDestination(bible('b', 'GEN', 1, 'LXX'), { kind: 'passage', bookId: 'GEN', chapter: 1, textId: 'lxx' })).toBe(true)
    // no explicit text → the text a new tab would show (default translation, coverage rule)
    expect(tabShowsDestination(bible('b', 'GEN', 1, 'KJVA'), { kind: 'passage', bookId: 'GEN', chapter: 1 })).toBe(true)
    expect(tabShowsDestination(bible('b', 'GEN', 1, 'LXX'), { kind: 'passage', bookId: 'GEN', chapter: 1 })).toBe(false)
  })
  it('verses do not split identity; other chapters do; chapter spans count', () => {
    expect(tabShowsDestination(bible('b'), { kind: 'passage', bookId: 'ROM', chapter: 13, verse: 4, endVerse: 7 })).toBe(true)
    expect(tabShowsDestination(bible('b'), { kind: 'passage', bookId: 'ROM', chapter: 12 })).toBe(false)
    expect(tabShowsDestination(bible('b', 'ROM', 12, 'KJVA', { endChapter: 14 }), { kind: 'passage', bookId: 'ROM', chapter: 13 })).toBe(true)
  })
  it('Compare and Advanced-Search Scripture tabs are never a match', () => {
    expect(tabShowsDestination(bible('b', 'ROM', 13, 'KJVA', { compareMode: true }), { kind: 'passage', bookId: 'ROM', chapter: 13 })).toBe(false)
    expect(tabShowsDestination(bible('b', 'ROM', 13, 'KJVA', { searchMode: true }), { kind: 'passage', bookId: 'ROM', chapter: 13 })).toBe(false)
  })
  it("Strong's numbers match case-insensitively", () => {
    expect(tabShowsDestination(lex('l', 'g664'), { kind: 'strongs', num: 'G664' })).toBe(true)
  })
  it('tabDestination round-trips through the identity rule', () => {
    for (const t of [bible('b'), note('n', 'x'), lex('l', 'H7225')]) expect(tabShowsDestination(t, tabDestination(t)!)).toBe(true)
    expect(tabDestination(note('n', null))).toBeNull()
  })
})

describe("'reuse' intent", () => {
  it('opens a new tab when the resource is not open', () => {
    reset([bible('b1', 'GEN', 1)], 'b1')
    openDestination({ kind: 'passage', bookId: 'ROM', chapter: 13 }, 'reuse')
    expect(count()).toBe(2)
    expect(currentTab()).toMatchObject({ type: 'bible', state: { bookId: 'ROM', chapter: 13 } })
  })
  it('activates the open tab of the current session instead of a copy', () => {
    reset([bible('b1'), note('n1', 'x')], 'n1')
    const id = openDestination({ kind: 'passage', bookId: 'ROM', chapter: 13 }, 'reuse')
    expect(id).toBe('b1')
    expect(count()).toBe(2)
    expect(currentTab()!.id).toBe('b1')
  })
  it('the same reference through different entry points lands in the same tab', () => {
    reset([bible('b1', 'GEN', 1)], 'b1')
    const a = openDestination({ kind: 'passage', bookId: 'ROM', chapter: 13 }, 'reuse')
    st().setActiveTab('scripture', 'b1')
    const b = openDestination({ kind: 'passage', bookId: 'ROM', chapter: 13, verse: 8, textId: 'kjva' }, 'reuse')
    expect(b).toBe(a)
    expect(count()).toBe(2)
    expect(currentTab()!.state).toMatchObject({ bookId: 'ROM', chapter: 13, targetVerse: 8 })
  })
  it('reuses notes and lexicon entries', () => {
    reset([bible('b1'), note('n1', 'x'), lex('l1', 'G664')], 'b1')
    expect(openDestination({ kind: 'note', noteId: 'x' }, 'reuse')).toBe('n1')
    expect(openDestination({ kind: 'strongs', num: 'G664' }, 'reuse')).toBe('l1')
    expect(count()).toBe(3)
  })
  it("an intentional copy ('new-tab') still creates one", () => {
    reset([bible('b1')], 'b1')
    openDestination({ kind: 'passage', bookId: 'ROM', chapter: 13 }, 'new-tab')
    expect(count()).toBe(2)
  })
  it('closing the tab then opening again creates a fresh tab', () => {
    reset([bible('b1'), note('n1', 'x')], 'n1')
    st().closeTab('scripture', 'b1')
    openDestination({ kind: 'passage', bookId: 'ROM', chapter: 13 }, 'reuse')
    expect(count()).toBe(2)
    expect(currentTab()).toMatchObject({ type: 'bible', state: { bookId: 'ROM', chapter: 13 } })
  })
  it('a match in ANOTHER session is found but never switched to silently', () => {
    reset([bible('b1', 'GEN', 1)], 'b1', [{ id: 'B', name: 'Study B', tabs: [bible('bB')] }])
    const d = { kind: 'passage', bookId: 'ROM', chapter: 13 } as const
    const all = findOpenTabs(d, st())
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ sessionId: 'B', sessionName: 'Study B', current: false })
    expect(reusableTab(d, st())).toBeNull()
    openDestination(d, 'reuse')
    expect(st().currentSessionId).toBe('A')
    expect(count()).toBe(2) // a new copy in the current session
  })
  it('choosing the other session’s tab switches to it and activates it', () => {
    reset([bible('b1', 'GEN', 1)], 'b1', [{ id: 'B', name: 'Study B', tabs: [note('nB', 'q'), bible('bB')] }])
    const m = findOpenTabs({ kind: 'passage', bookId: 'ROM', chapter: 13 }, st())[0]!
    expect(activateTabMatch(m)).toBe('bB')
    expect(st().currentSessionId).toBe('B')
    expect(currentTab()!.id).toBe('bB')
    // the session we left kept its tabs
    expect(st().sessions.find((x) => x.id === 'A')!.tabs.scripture.map((t) => t.id)).toEqual(['b1'])
  })
  it('the current session wins over another session', () => {
    reset([bible('b1'), note('n1', 'x')], 'n1', [{ id: 'B', name: 'Study B', tabs: [bible('bB')] }])
    expect(findOpenTabs({ kind: 'passage', bookId: 'ROM', chapter: 13 }, st()).map((m) => m.tab.id)).toEqual(['b1', 'bB'])
  })
})

describe('text matching of open tabs', () => {
  it('matches every typed word against title + kind, across sessions', () => {
    reset([bible('b1'), note('n1', 'x', 'Apostate pastors and wolves')], 'b1', [{ id: 'B', name: 'Study B', tabs: [note('nB', 'y', 'Pastors in Acts')] }])
    const r = tabsMatchingText('pastors', st(), (t) => t.title)
    expect(r.map((m) => m.tab.id)).toEqual(['n1', 'nB'])
    expect(tabsMatchingText('apostate wolves', st(), (t) => t.title).map((m) => m.tab.id)).toEqual(['n1'])
    expect(tabsMatchingText('  ', st(), (t) => t.title)).toEqual([])
  })
})
