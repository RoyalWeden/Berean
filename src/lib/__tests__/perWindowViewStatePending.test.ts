// @vitest-environment jsdom
/**
 * Workspace restore when the saved workspace isn't in the localStorage blob yet (TEST 2026-10-05:
 * a workspace created right before the app was killed relaunched into Session 1): the wish is kept
 * for the SQLite mirror and never overwritten by the fallback session meanwhile.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import { initPerWindowViewState, takePendingViewRestore } from '../perWindowViewState'

const empty = { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }
const none = { scripture: null, notes: null, lexicon: null, youtube: null, search: null }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  takePendingViewRestore()
  useAppStore.setState({
    currentSessionId: 'default', activeSpace: 'scripture', tabs: { ...empty }, activeTabId: { ...none },
    sessions: [{ id: 'default', name: 'Session 1', tabs: { ...empty }, activeTabId: { ...none } }],
  })
})
afterEach(() => { vi.useRealTimers() })

describe('per-window workspace restore', () => {
  it('keeps an unknown saved workspace pending and does not overwrite it', () => {
    localStorage.setItem('berean-window-primary', JSON.stringify({ currentSessionId: 'session-new', activeSpace: 'notes', activeTabId: { ...none, notes: 'n1' } }))
    const dispose = initPerWindowViewState()
    expect(useAppStore.getState().currentSessionId).toBe('default')
    useAppStore.setState({ activeSpace: 'lexicon' })          // any view change triggers a write
    vi.advanceTimersByTime(300)
    expect(JSON.parse(localStorage.getItem('berean-window-primary')!).currentSessionId).toBe('session-new')
    expect(takePendingViewRestore()).toMatchObject({ currentSessionId: 'session-new', activeSpace: 'notes' })
    expect(takePendingViewRestore()).toBeNull()               // one-shot
    dispose()
  })

  it('a known saved workspace is switched to directly', () => {
    useAppStore.setState({ sessions: [...useAppStore.getState().sessions, { id: 'b', name: 'B', tabs: { ...empty }, activeTabId: { ...none } }] })
    localStorage.setItem('berean-window-primary', JSON.stringify({ currentSessionId: 'b' }))
    const dispose = initPerWindowViewState()
    expect(useAppStore.getState().currentSessionId).toBe('b')
    expect(takePendingViewRestore()).toBeNull()
    dispose()
  })

  it('a workspace switch is saved at once (a kill right after cannot lose it)', () => {
    useAppStore.setState({ sessions: [...useAppStore.getState().sessions, { id: 'c', name: 'C', tabs: { ...empty }, activeTabId: { ...none } }] })
    const dispose = initPerWindowViewState()
    useAppStore.getState().switchSession('c')
    expect(JSON.parse(localStorage.getItem('berean-window-primary')!).currentSessionId).toBe('c')
    dispose()
  })
})
