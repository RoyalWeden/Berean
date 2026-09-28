/** DATA-SYNC-007 — the shared host lifecycle: event-driven, never overlapping, never losing a request. */
import { describe, it, expect } from 'vitest'
import { createSyncHostCore } from '../hostCore'
import type { SyncEngine } from '../engine'
import type { SyncStore } from '../types'

function fakeEngine(syncMs: number) {
  let listener: (() => void) | null = null
  const calls = { sync: 0, push: 0, concurrent: 0, maxConcurrent: 0 }
  const engine = {
    setLocalChangeListener: (cb: (() => void) | null) => { listener = cb },
    noteNotified: () => {},
    sync: async () => { calls.sync++; calls.concurrent++; calls.maxConcurrent = Math.max(calls.maxConcurrent, calls.concurrent); await new Promise((r) => setTimeout(r, syncMs)); calls.concurrent-- },
    push: async () => { calls.push++ },
    status: async () => ({ state: 'synced' }),
  } as unknown as SyncEngine
  return { engine, calls, localChange: () => listener?.() }
}

describe('createSyncHostCore', () => {
  it('a burst of local changes (typing) coalesces into ONE sync after the debounce', async () => {
    const f = fakeEngine(5)
    let notify: ((i?: { paths: number }) => void) | null = null
    const store = { watch: (cb: (i?: { paths: number }) => void) => { notify = cb; return () => {} } } as unknown as SyncStore
    const core = createSyncHostCore({ engine: f.engine, store, localDebounceMs: 40, fallbackIntervalMs: null })
    for (let i = 0; i < 10; i++) { f.localChange(); await new Promise((r) => setTimeout(r, 5)) }
    await new Promise((r) => setTimeout(r, 120)); await core.idle()
    expect(f.calls.sync).toBe(1)
    expect(notify).not.toBeNull()
    core.stop()
  })

  it('a notification that arrives DURING a sync causes one more pass (never lost), and passes never overlap', async () => {
    const f = fakeEngine(40)
    let notify: ((i?: { paths: number }) => void) | null = null
    const store = { watch: (cb: (i?: { paths: number }) => void) => { notify = cb; return () => {} } } as unknown as SyncStore
    const core = createSyncHostCore({ engine: f.engine, store, fallbackIntervalMs: null })
    core.requestSync('start')
    await new Promise((r) => setTimeout(r, 10))
    notify!({ paths: 1 }); notify!({ paths: 1 })        // two notifications mid-pass
    await core.idle()
    expect(f.calls.sync).toBe(2)
    expect(f.calls.maxConcurrent).toBe(1)
    core.stop()
  })

  it('stop() detaches the local-change wake and the watch', async () => {
    const f = fakeEngine(1)
    let unwatched = false
    const store = { watch: () => () => { unwatched = true } } as unknown as SyncStore
    const core = createSyncHostCore({ engine: f.engine, store, localDebounceMs: 5, fallbackIntervalMs: null })
    core.stop()
    f.localChange()
    await new Promise((r) => setTimeout(r, 30))
    expect(f.calls.sync).toBe(0)
    expect(unwatched).toBe(true)
  })
})
