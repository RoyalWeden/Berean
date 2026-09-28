/**
 * TEST-008 (docs/mobile/testing-backlog-2026-09-22.md): each side-panel sub-tab returns to its
 * own scroll position after switching to another sub-tab and back, and the offsets are
 * device-local tab state (never synced).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useRef } from 'react'
import { useKeyedScrollMemory } from '../useKeyedScrollMemory'
import { splitTabState } from '@/platform/sync/tabFields'
import type { TabState } from '@/types'

type K = 'crossrefs' | 'notes'

function Panel({ active, initial, onChange }: { active: K; initial?: Partial<Record<K, number>>; onChange?: (m: Partial<Record<K, number>>) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const mem = useKeyedScrollMemory<K>({ rootRef: root, activeKey: active, initial, onChange, debounceMs: 0 })
  return (
    <div ref={root} onScrollCapture={mem.onScrollCapture}>
      {(['crossrefs', 'notes'] as const).map((k) => (
        <div key={k} data-scroll-key={k} style={{ display: k === active ? undefined : 'none' }}>
          <div data-panel-scroll-root="" id={`s-${k}`} />
        </div>
      ))}
    </div>
  )
}

let host: HTMLDivElement | null = null
let root: Root | null = null
const scroller = (k: K) => document.getElementById(`s-${k}`) as HTMLDivElement
const scrollTo = (k: K, top: number) => { scroller(k).scrollTop = top; scroller(k).dispatchEvent(new Event('scroll')) }
const flushFrames = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) }) }

afterEach(() => { act(() => root?.unmount()); host?.remove(); host = null; root = null })

function mount(el: React.ReactElement) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
}

describe('useKeyedScrollMemory', () => {
  it('restores each key to its own offset after switching away and back', async () => {
    mount(<Panel active="crossrefs" />)
    scrollTo('crossrefs', 420)
    act(() => root!.render(<Panel active="notes" />))
    // Hidden with display:none — the browser would drop the offset; simulate that.
    scroller('crossrefs').scrollTop = 0
    scrollTo('notes', 90)
    act(() => root!.render(<Panel active="crossrefs" />))
    await flushFrames()
    expect(scroller('crossrefs').scrollTop).toBe(420)
    act(() => root!.render(<Panel active="notes" />))
    scroller('notes').scrollTop = 0
    await flushFrames()
    expect(scroller('notes').scrollTop).toBe(90)
  })

  it('restores the persisted map on mount (tab switch remount / relaunch)', async () => {
    mount(<Panel active="notes" initial={{ notes: 250, crossrefs: 30 }} />)
    await flushFrames()
    expect(scroller('notes').scrollTop).toBe(250)
  })

  it('reports the whole map for persistence', async () => {
    const onChange = vi.fn()
    mount(<Panel active="crossrefs" onChange={onChange} />)
    scrollTo('crossrefs', 77)
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    expect(onChange).toHaveBeenLastCalledWith({ crossrefs: 77 })
  })

  it('side-panel offsets are device-local tab state, not synced', () => {
    const { sync, local } = splitTabState('bible', { bookId: 'GEN', chapter: 1, rightPanelScrollTops: { crossrefs: 5 }, rightPanelScrollTopsB: { notes: 1 } } as unknown as TabState)
    expect(local).toMatchObject({ rightPanelScrollTops: { crossrefs: 5 }, rightPanelScrollTopsB: { notes: 1 } })
    expect(sync).not.toHaveProperty('rightPanelScrollTops')
  })
})
