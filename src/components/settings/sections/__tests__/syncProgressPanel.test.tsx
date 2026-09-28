// @vitest-environment jsdom
/** DATA-UX-010 — the first-sync panel shows honest progress: a real percentage only when the
 *  engine knows the total, otherwise an indeterminate bar; stages reflect the actual pass. */
import { describe, it, expect, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useSyncUi, __resetSyncUi } from '@/lib/syncUi'
import { SyncProgressPanel } from '../ICloudSection'
import type { SyncProgress, SyncStatusSnapshot } from '@/platform/sync/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const base: SyncStatusSnapshot = { enabled: true, deviceId: 'me', transport: { available: true }, pendingOutbox: 0, lastPushAt: null, lastPullAt: null, lastError: null, devices: [], unreadable: 0, state: 'synced' }
const cfg = { enabled: true, folder: '', folderOverride: null, containerId: 'c', containerExists: true, running: true }
const prog = (p: Partial<SyncProgress>): SyncProgress => ({ activity: 'applying', done: 0, total: null, byEntity: {}, firstSync: true, startedAt: 0, ...p })

function render() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<SyncProgressPanel />))
  return { host, done: () => { act(() => root.unmount()); host.remove() } }
}

describe('SyncProgressPanel', () => {
  beforeEach(() => __resetSyncUi())
  it('determinate with the real count, per-kind stages', () => {
    useSyncUi.setState({ config: cfg, status: { ...base, progress: prog({ done: 612, total: 850, byEntity: { note: { done: 600, total: 600 }, highlight: { done: 12, total: 250 } } }) } })
    const r = render()
    const bar = r.host.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('72')
    expect(r.host.textContent).toContain('Setting up iCloud…')
    expect(r.host.textContent).toContain('Restoring… 612 of 850')
    expect(r.host.textContent).toContain('Notes')
    expect(r.host.textContent).toContain('Highlights — 12 of 250')
    r.done()
  })
  it('indeterminate when the total is unknown — no invented percentage', () => {
    useSyncUi.setState({ config: cfg, status: { ...base, progress: prog({ activity: 'fetching', total: null }) } })
    const r = render()
    const bar = r.host.querySelector('[role="progressbar"]')!
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(bar.className).toContain('is-indeterminate')
    expect(r.host.textContent).not.toMatch(/\d+%/)
    r.done()
  })
  it('nothing is shown when idle and not setting up', () => {
    useSyncUi.setState({ config: cfg, status: base })
    const r = render()
    expect(r.host.textContent).toBe('')
    r.done()
  })
})
