/**
 * Per-tab history for Search and Settings tabs (SEP25): committed search steps (seeded with the
 * pre-change state), dedupe of an unchanged snapshot, restores that record nothing, and the
 * Settings subsection route steps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Tab } from '@/types'
import { commitSearchStep, markSearchCommitted, searchSnapshot, searchStep, _resetSearchCommitted, recordTabStep } from '../search/searchHistory'
import { settingsRouteOf, settingsStep, isSettingsRoute } from '../settings/settingsRoutes'

const search: Tab = { id: 's1', spaceId: 'search', type: 'search', title: 'Search', state: { query: '', results: [] } } as unknown as Tab
const settings: Tab = { id: 'set1', spaceId: 'search', type: 'settings', title: 'Settings', state: {} } as unknown as Tab
function reset() {
  useAppStore.setState({
    tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [search, settings] },
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: 's1' },
    activeSpace: 'search', tabNavStacks: {}, isNavJumping: false,
  })
  _resetSearchCommitted()
}
const stack = (id: string) => useAppStore.getState().tabNavStacks[id]
const liveState = (id: string) => useAppStore.getState().tabs.search.find((t) => t.id === id)!.state as Record<string, unknown>

beforeEach(() => { vi.useFakeTimers(); reset() })
afterEach(() => { vi.useRealTimers() })

describe('Search steps', () => {
  it('snapshots are normalised (defaults filled, trimmed query, stable key order)', () => {
    const a = searchSnapshot({ query: ' grace ', filters: { books: ['GEN'] } })
    expect(a.query).toBe('grace')
    expect(a.scope).toBe('scripture')
    expect(Object.keys(a.filters)).toEqual(['textId', 'wordMode', 'books', 'tagIds', 'tagMatchAll', 'sort', 'direction'])
    expect(searchStep(a)).toMatchObject({ type: 'search', title: '“grace”' })
    expect(searchStep(searchSnapshot(undefined)).title).toBe('Search')
  })

  it('first commit seeds the pre-change state; an unchanged snapshot records nothing', () => {
    const empty = searchSnapshot(liveState('s1'))
    markSearchCommitted('s1', empty, true)
    expect(commitSearchStep('s1', empty, searchSnapshot({ query: 'grace' }))).toBe(true)
    expect(stack('s1').stack.map((e) => e.title)).toEqual(['Search', '“grace”'])
    expect(commitSearchStep('s1', empty, searchSnapshot({ query: 'grace' }))).toBe(false)
    expect(commitSearchStep('s1', empty, searchSnapshot({ query: 'grace', scope: 'notes' }))).toBe(true)
    expect(stack('s1').stack).toHaveLength(3)
    expect(stack('s1').stack[2].state).toMatchObject({ query: 'grace', scope: 'notes' })
  })

  it('back re-applies the previous query / scope / filters to the tab, and the stamped scroll', () => {
    markSearchCommitted('s1', searchSnapshot(undefined), true)
    commitSearchStep('s1', searchSnapshot(undefined), searchSnapshot({ query: 'grace', filters: { textId: 'lxx' } }))
    useAppStore.getState().updateTabState('search', 's1', { query: 'grace', filters: { textId: 'lxx' }, scrollTop: 420 } as never)
    commitSearchStep('s1', searchSnapshot(undefined), searchSnapshot({ query: 'mercy' }))
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    const st = liveState('s1')
    expect(st.query).toBe('grace')
    expect((st.filters as { textId: string }).textId).toBe('lxx')
    expect(st.scrollTop).toBe(420)
  })

  it('nothing is recorded while a restore is in progress', () => {
    markSearchCommitted('s1', searchSnapshot(undefined), true)
    useAppStore.setState({ isNavJumping: true })
    expect(commitSearchStep('s1', searchSnapshot(undefined), searchSnapshot({ query: 'x' }))).toBe(false)
    expect(stack('s1')).toBeUndefined()
  })
})

describe('Settings route steps', () => {
  it('route parsing and step titles', () => {
    expect(settingsRouteOf({ settingsRoute: 'preset' })).toBe('preset')
    expect(settingsRouteOf({ settingsRoute: 'nope' })).toBeNull()
    expect(settingsRouteOf(undefined)).toBeNull()
    expect(isSettingsRoute('font-ui')).toBe(true)
    expect(settingsStep('preset')).toEqual({ type: 'settings', title: 'Settings · Color preset', state: { settingsRoute: 'preset' } })
    expect(settingsStep(null)).toEqual({ type: 'settings', title: 'Settings', state: { settingsRoute: null } })
  })

  it('open a section → back restores the root → forward reopens it', () => {
    useAppStore.setState({ activeTabId: { ...useAppStore.getState().activeTabId, search: 'set1' } })
    recordTabStep('set1', settingsStep(null), settingsStep('notes'))
    useAppStore.getState().updateTabState('search', 'set1', { settingsRoute: 'notes' } as never)
    useAppStore.getState().navTabBack(); vi.advanceTimersByTime(60)
    expect(liveState('set1').settingsRoute).toBeNull()
    useAppStore.getState().navTabForward(); vi.advanceTimersByTime(60)
    expect(liveState('set1').settingsRoute).toBe('notes')
  })
})
