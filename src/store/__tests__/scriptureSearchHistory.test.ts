/**
 * Scripture-search history in ONE tab (TEST 2026-10-05): every submitted search is its own step,
 * a repeat after something else is a new step, and back / forward re-open each search with its
 * options (and remount the search view via searchRestoreSeq).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import { searchNavEntry } from '@/lib/searchNav'
import type { Tab } from '@/types'

const tab: Tab = { id: 's1', spaceId: 'scripture', type: 'bible', title: 'Search', state: { searchMode: true } } as Tab
const st = () => useAppStore.getState().tabs.scripture.find((t) => t.id === 's1')!.state as Record<string, unknown>
const flush = () => { vi.advanceTimersByTime(60) }

beforeEach(() => {
  vi.useFakeTimers()
  useAppStore.setState({
    tabs: { scripture: [tab], notes: [], lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: 's1', notes: null, lexicon: null, youtube: null, search: null },
    activeSpace: 'scripture', tabNavStacks: {}, isNavJumping: false,
  })
})
afterEach(() => { vi.useRealTimers() })

describe('searchNavEntry', () => {
  it('drops empty options so the same search dedups', () => {
    expect(searchNavEntry('peace', { searchWordMode: 'all', searchTagFilter: undefined, searchBookFilter: '' }))
      .toEqual({ type: 'bible', title: 'Search: "peace"', query: 'peace', state: { searchWordMode: 'all' } })
  })
})

describe('one Search tab, several searches', () => {
  it('keeps each submitted search; back/forward restore query + options and bump the remount seq', () => {
    const push = (q: string, mode: string) => useAppStore.getState().pushTabNav('s1', searchNavEntry(q, { searchWordMode: mode }))
    push('good tidings', 'phrase')
    push('gospel', 'all')
    push('peace', 'any')
    push('peace', 'any') // the same submission twice in a row is one step
    push('good tidings', 'phrase') // an intentional repeat later is a new step
    expect(useAppStore.getState().tabNavStacks.s1.stack.map((e) => e.query)).toEqual(['good tidings', 'gospel', 'peace', 'good tidings'])

    useAppStore.getState().navTabBack(); flush()
    expect(st()).toMatchObject({ searchMode: true, scriptureSearchQuery: 'peace', searchWordMode: 'any', searchRestoreSeq: 1 })
    useAppStore.getState().navTabBack(); flush()
    expect(st()).toMatchObject({ scriptureSearchQuery: 'gospel', searchWordMode: 'all', searchRestoreSeq: 2 })
    useAppStore.getState().navTabForward(); flush()
    expect(st()).toMatchObject({ scriptureSearchQuery: 'peace', searchRestoreSeq: 3 })
  })
})
