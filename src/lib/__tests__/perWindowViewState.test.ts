import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAppStore } from '@/store'
import { initPerWindowViewState } from '@/lib/perWindowViewState'

const KEY = 'berean-window-primary'
let teardown: (() => void) | null = null

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({
    activeSpace: 'scripture',
    panelLayout: 'standard' as never,
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
  })
})
afterEach(() => { teardown?.(); teardown = null })

describe('perWindowViewState', () => {
  it('restores a saved primary-window view on init', () => {
    localStorage.setItem(KEY, JSON.stringify({
      currentSessionId: useAppStore.getState().currentSessionId,
      activeSpace: 'notes',
      activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
      panelLayout: 'wide',
    }))
    teardown = initPerWindowViewState()
    expect(useAppStore.getState().activeSpace).toBe('notes')
    expect(useAppStore.getState().panelLayout).toBe('wide')
  })

  it('persists view changes (debounced) to the primary slot', async () => {
    teardown = initPerWindowViewState()
    useAppStore.getState().setActiveSpace('lexicon')
    await new Promise((r) => setTimeout(r, 300))
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(saved.activeSpace).toBe('lexicon')
  })

  it('ignores a saved session id that no longer exists', () => {
    localStorage.setItem(KEY, JSON.stringify({ currentSessionId: 'ghost-session', activeSpace: 'youtube' }))
    teardown = initPerWindowViewState()
    // session switch skipped, but the other fields still apply
    expect(useAppStore.getState().activeSpace).toBe('youtube')
    expect(useAppStore.getState().currentSessionId).not.toBe('ghost-session')
  })

  it('does not persist when spawned with ?mirrorFrom (ephemeral slot)', async () => {
    const orig = window.location.search
    Object.defineProperty(window, 'location', { value: { ...window.location, search: '?mirrorFrom=5' }, writable: true })
    teardown = initPerWindowViewState()
    useAppStore.getState().setActiveSpace('search')
    await new Promise((r) => setTimeout(r, 300))
    expect(localStorage.getItem(KEY)).toBeNull()
    Object.defineProperty(window, 'location', { value: { ...window.location, search: orig }, writable: true })
  })
})
