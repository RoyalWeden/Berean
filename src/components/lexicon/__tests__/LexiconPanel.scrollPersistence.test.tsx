import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, StrictMode } from 'react'
import LexiconPanel from '../LexiconPanel'
import { useAppStore } from '@/store'
import type { LexiconEntry, Tab, LexiconTabState } from '@/types'

// Regression: does the entry-view's saved scroll position survive switching away from a
// Lexicon tab and back, and does the double-rAF scroll-restore fix (replacing a racy
// setTimeout(80)) accidentally clobber a saved position on its own?

function makeEntry(strongsNum: string): LexiconEntry {
  return {
    strongsNum, lemma: 'x', transliteration: 'x', pronunciation: 'x',
    gloss: 'x', definition: 'x'.repeat(500), derivation: 'x', extendedDef: '', occurrences: 1,
  }
}

function makeLexTab(id: string, strongsNum: string, extraState: Partial<LexiconTabState> = {}): Tab {
  return { id, spaceId: 'lexicon', type: 'lexicon', title: id, state: { strongsNum, ...extraState } } as Tab
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<LexiconPanel floating />))
  return container
}

describe('LexiconPanel scroll persistence', () => {
  const entryA = makeEntry('H7225')
  const entryB = makeEntry('G3056')

  beforeEach(() => {
    ;(window as unknown as { lexicon: unknown }).lexicon = {
      getEntry: vi.fn(async (id: string) => (id === entryA.strongsNum ? entryA : id === entryB.strongsNum ? entryB : null)),
      getOccurrences: vi.fn(async () => []),
      getRelated: vi.fn(async () => []),
      search: vi.fn(async () => []),
    }
    ;(window as unknown as { app: unknown }).app = { pushViewerContent: vi.fn() }

    const tabA = makeLexTab('tab-a', entryA.strongsNum)
    const tabB = makeLexTab('tab-b', entryB.strongsNum)
    useAppStore.setState({
      tabs: { scripture: [], notes: [], lexicon: [tabA, tabB], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: null, lexicon: 'tab-a', youtube: null, search: null },
      activeSpace: 'lexicon',
    })
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('scroll position survives switching away and back to a lexicon entry', async () => {
    const el = mount()
    // Let the async entry fetch resolve.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const scroller = el.querySelector('[class*="overflow-y-auto"]') as HTMLElement
    expect(scroller).toBeTruthy()

    act(() => {
      scroller.scrollTop = 222
      scroller.dispatchEvent(new Event('scroll'))
    })
    // Flush the 150ms debounced save.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })

    let tabAState = useAppStore.getState().tabs.lexicon.find((t) => t.id === 'tab-a')?.state as LexiconTabState
    expect(tabAState.scrollTop).toBe(222)

    // Switch to entry B.
    await act(async () => {
      useAppStore.getState().setActiveTab('lexicon', 'tab-b')
      await Promise.resolve(); await Promise.resolve()
    })

    // Switch back to entry A.
    await act(async () => {
      useAppStore.getState().setActiveTab('lexicon', 'tab-a')
      await Promise.resolve(); await Promise.resolve()
    })
    // Flush the double-rAF restore.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })

    tabAState = useAppStore.getState().tabs.lexicon.find((t) => t.id === 'tab-a')?.state as LexiconTabState
    expect(tabAState.scrollTop).toBe(222)
    const scrollerAfter = el.querySelector('[class*="overflow-y-auto"]') as HTMLElement
    expect(scrollerAfter.scrollTop).toBe(222)
  })

  it('a fresh StrictMode double-invoke mount does not clobber a scroll the user makes while both stale restores are still pending', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<StrictMode><LexiconPanel floating /></StrictMode>)
      // Deliberately only ONE microtask tick — scrolling before either of StrictMode's two
      // duplicate restore requests has resolved, let alone had its double-rAF fire.
      await Promise.resolve()
    })

    const scroller = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement | null
    if (scroller) {
      act(() => {
        scroller.scrollTop = 333
        scroller.dispatchEvent(new Event('scroll'))
      })
    }

    // Let everything settle: both duplicate fetches, both duplicate double-rAF pairs, and the
    // debounced save.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })

    const finalScroller = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement
    expect(finalScroller).toBeTruthy()
    if (scroller) expect(finalScroller.scrollTop).toBe(333)
  })
})
