/** SEP26-TABS-001…003 — duplicating a tab copies its state and an INDEPENDENT copy of its history. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Tab } from '@/types'

const bible = (): Tab => ({ id: 'A', spaceId: 'scripture', type: 'bible', title: 'Genesis 1', state: { bookId: 'GEN', chapter: 1, translation: 'KJVA', showStrongs: true, scrollPosition: 0 } } as Tab)

function reset(tabs: Tab[]) {
  useAppStore.setState({
    tabs: { scripture: tabs.filter((t) => t.spaceId === 'scripture'), notes: tabs.filter((t) => t.spaceId === 'notes'), lexicon: [], youtube: [], search: tabs.filter((t) => t.spaceId === 'search') },
    activeTabId: { scripture: tabs.find((t) => t.spaceId === 'scripture')?.id ?? null, notes: tabs.find((t) => t.spaceId === 'notes')?.id ?? null, lexicon: null, youtube: null, search: tabs.find((t) => t.spaceId === 'search')?.id ?? null },
    activeSpace: tabs[0].spaceId, tabNavStacks: {}, isNavJumping: false, scrollByTab: {}, tabMRUList: [],
  })
}
const go = (id: string, bookId: string, chapter: number) => useAppStore.getState().updateTabState('scripture', id, { bookId, chapter })
const pos = (id: string) => { const t = useAppStore.getState().tabs.scripture.find((x) => x.id === id)!; return `${(t.state as { bookId: string }).bookId} ${(t.state as { chapter: number }).chapter}` }
const hist = (id: string) => { const st = useAppStore.getState().tabNavStacks[id]; return { entries: st.stack.map((e) => `${e.bookId} ${e.chapter}`), idx: st.idx } }
const tick = () => vi.advanceTimersByTime(60)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('duplicateTab', () => {
  beforeEach(() => {
    reset([bible()])
    useAppStore.setState({ tabNavStacks: {} })
    go('A', 'GEN', 2); go('A', 'MAT', 10); go('A', 'MAT', 11)
  })

  it('copies the complete history with the same current position', () => {
    const before = hist('A')
    const B = useAppStore.getState().duplicateTab('scripture', 'A')!
    expect(B).not.toBe('A')
    expect(hist(B)).toEqual(before)
    expect(pos(B)).toBe('MAT 11')
    expect(useAppStore.getState().activeTabId.scripture).toBe(B)
    // New ids — never the same entry objects.
    const a = useAppStore.getState().tabNavStacks.A.stack, b = useAppStore.getState().tabNavStacks[B].stack
    a.forEach((e, i) => { expect(b[i]).not.toBe(e); expect(b[i].id).not.toBe(e.id) })
    expect(useAppStore.getState().tabs.scripture.find((t) => t.id === B)!.state).not.toBe(useAppStore.getState().tabs.scripture.find((t) => t.id === 'A')!.state)
  })

  it('the two histories are independent both ways, and back / forward work separately', () => {
    const B = useAppStore.getState().duplicateTab('scripture', 'A')!
    go(B, 'ROM', 4)
    expect(pos('A')).toBe('MAT 11')
    expect(hist('A').entries.at(-1)).toBe('MAT 11')
    expect(hist(B).entries.at(-1)).toBe('ROM 4')
    go('A', 'JHN', 3)
    expect(hist(B).entries).not.toContain('JHN 3')
    expect(pos(B)).toBe('ROM 4')

    useAppStore.setState({ activeTabId: { ...useAppStore.getState().activeTabId, scripture: B } })
    useAppStore.getState().navTabBack(); tick()
    expect(pos(B)).toBe('MAT 11')
    expect(pos('A')).toBe('JHN 3')

    useAppStore.setState({ activeTabId: { ...useAppStore.getState().activeTabId, scripture: 'A' } })
    useAppStore.getState().navTabBack(); tick()
    expect(pos('A')).toBe('MAT 11')
    expect(pos(B)).toBe('MAT 11') // B unchanged by A's back
    useAppStore.getState().navTabForward(); tick()
    expect(pos('A')).toBe('JHN 3')
  })

  it('duplicates other tab types with their history (Search)', () => {
    const search: Tab = { id: 'S', spaceId: 'search', type: 'search', title: '“love”', state: { query: 'love', scope: 'scripture' } } as unknown as Tab
    reset([search])
    const s = useAppStore.getState()
    s.pushTabNav('S', { type: 'search', title: '“grace”', state: { query: 'grace', scope: 'scripture' } })
    s.pushTabNav('S', { type: 'search', title: '“love”', state: { query: 'love', scope: 'scripture' } })
    const D = useAppStore.getState().duplicateTab('search', 'S')!
    expect((useAppStore.getState().tabs.search.find((t) => t.id === D)!.state as { query: string }).query).toBe('love')
    expect(useAppStore.getState().tabNavStacks[D].stack.map((e) => e.title)).toEqual(['“grace”', '“love”'])
  })

  it('a tab with no history yet duplicates cleanly', () => {
    reset([bible()])
    const B = useAppStore.getState().duplicateTab('scripture', 'A')!
    expect(useAppStore.getState().tabNavStacks[B]).toBeUndefined()
    expect(pos(B)).toBe('GEN 1')
  })
})
