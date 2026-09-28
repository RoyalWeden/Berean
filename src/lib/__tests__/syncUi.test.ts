/** DATA-UX-001/002/010 — one source of truth for the iCloud UI; honest progress. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSyncUi, wireSyncUi, __resetSyncUi, presentSync, progressFraction, groupProgress, describeDevices, formatSyncedAt } from '../syncUi'
import type { SyncStatusSnapshot, SyncProgress } from '@/platform/sync/types'

const base: SyncStatusSnapshot = { enabled: true, deviceId: 'me', transport: { available: true }, pendingOutbox: 0, lastPushAt: null, lastPullAt: null, lastError: null, devices: [], unreadable: 0, state: 'synced' }
const cfg = (enabled: boolean) => ({ enabled, folder: '', folderOverride: null, containerId: 'c', containerExists: true, running: enabled })
const prog = (p: Partial<SyncProgress>): SyncProgress => ({ activity: 'applying', done: 0, total: null, byEntity: {}, firstSync: false, startedAt: 0, ...p })

describe('presentSync', () => {
  it('off / up to date / waiting / offline / unavailable / held / error', () => {
    expect(presentSync(cfg(false), null).key).toBe('disabled')
    expect(presentSync(cfg(false), null).detail).toMatch(/nothing is deleted/)
    expect(presentSync(cfg(true), base).key).toBe('upToDate')
    expect(presentSync(cfg(true), { ...base, state: 'pending', pendingOutbox: 3 }).short).toBe('3 changes waiting')
    expect(presentSync(cfg(true), { ...base, state: 'offline' }).key).toBe('offline')
    expect(presentSync(cfg(true), { ...base, state: 'unavailable', transport: { available: false } }).key).toBe('accountUnavailable')
    expect(presentSync(cfg(true), { ...base, state: 'held', hold: { kind: 'account', at: 1 } }).key).toBe('held')
    expect(presentSync(cfg(true), { ...base, state: 'attention', lastError: 'x' }).key).toBe('error')
  })
  it('a pass in progress names its stage; the first sync is "Setting up" and counts are real', () => {
    const p = presentSync(cfg(true), { ...base, progress: prog({ activity: 'applying', done: 42, total: 180, firstSync: true }) })
    expect(p.key).toBe('bootstrapping'); expect(p.short).toBe('Restoring… 42 of 180')
    expect(presentSync(cfg(true), { ...base, progress: prog({ activity: 'uploading', done: 1, total: 4 }) }).key).toBe('uploadingLocalChanges')
    expect(presentSync(cfg(true), { ...base, progress: prog({ activity: 'fetching', done: 0, total: 2 }) }).short).toBe('Checking iCloud…')
  })
})

describe('honest progress', () => {
  it('determinate only when the total is known, never invented', () => {
    expect(progressFraction(prog({ done: 30, total: 120 }))).toBe(0.25)
    expect(progressFraction(prog({ done: 30, total: null }))).toBeNull()
    expect(progressFraction(prog({ activity: 'finalizing', done: 0, total: null }))).toBeNull()
    expect(progressFraction(prog({ activity: 'checking', done: 0, total: 5 }))).toBeNull()
    expect(progressFraction(null)).toBeNull()
  })
  it('stage list shows only the kinds present, grouped', () => {
    const g = groupProgress(prog({ byEntity: { note: { done: 5, total: 5 }, note_version: { done: 1, total: 2 }, highlight: { done: 3, total: 3 } } }))
    expect(g).toEqual([{ id: 'notes', label: 'Notes', done: 6, total: 7, complete: false }, { id: 'highlights', label: 'Highlights', done: 3, total: 3, complete: true }])
  })
})

describe('devices and time', () => {
  it('this device first; devices silent for 90 days are inactive (never removed)', () => {
    const now = 1_800_000_000_000
    const d = describeDevices({ ...base, devices: [{ device: 'old', name: 'Old iPhone', platform: 'ios', seq: 1, applied: 1, lastSeenAt: now - 100 * 86_400_000 }, { device: 'me', name: 'Mac', platform: 'darwin', seq: 5, applied: 5, lastSeenAt: now }, { device: 'mac2', name: 'Studio', platform: 'darwin', seq: 3, applied: 3, lastSeenAt: now - 1000 }] }, now)
    expect(d.map((x) => [x.id, x.isThis, x.inactive])).toEqual([['me', true, false], ['mac2', false, false], ['old', false, true]])
  })
  it('last synced reads naturally', () => {
    const now = new Date(2026, 8, 28, 15, 0).getTime()
    expect(formatSyncedAt(new Date(2026, 8, 28, 13, 27).getTime(), now)).toMatch(/^Today at 1:27/)
    expect(formatSyncedAt(new Date(2026, 8, 27, 9, 0).getTime(), now)).toMatch(/^Yesterday/)
    expect(formatSyncedAt(null, now)).toBe('Never')
  })
})

describe('one source of truth', () => {
  let listeners: Array<(s: SyncStatusSnapshot | null) => void>
  let enabled: boolean
  beforeEach(() => {
    __resetSyncUi(); listeners = []; enabled = false
    ;(window as unknown as { sync: unknown }).sync = {
      getConfig: async () => cfg(enabled), getStatus: async () => (enabled ? base : null),
      enable: vi.fn(async () => { enabled = true; return { ok: true } }), disable: vi.fn(async () => { enabled = false; return { ok: true } }),
      onStatus: (cb: (s: SyncStatusSnapshot | null) => void) => { listeners.push(cb); return () => {} },
    }
  })
  it('both toggles are the same state: turning on anywhere updates every reader; status pushes flow in', async () => {
    wireSyncUi(); wireSyncUi()
    expect(listeners).toHaveLength(1)                        // subscribed once
    await useSyncUi.getState().setEnabled(true)
    expect(useSyncUi.getState().config?.enabled).toBe(true)
    expect(useSyncUi.getState().setupInProgress).toBe(true)
    listeners[0]({ ...base, progress: prog({ firstSync: true, done: 1, total: 10 }) })
    expect(useSyncUi.getState().status?.progress?.done).toBe(1)
    listeners[0]({ ...base, progress: null, lastSyncedAt: 123 })
    expect(useSyncUi.getState().setupInProgress).toBe(false)  // first sync finished
    await useSyncUi.getState().setEnabled(false)
    expect(useSyncUi.getState().config?.enabled).toBe(false)
  })
  it('a failed enable is reported and leaves sync off', async () => {
    ;(window.sync as unknown as { enable: unknown }).enable = async () => ({ ok: false, reason: 'Not signed in to iCloud' })
    const r = await useSyncUi.getState().setEnabled(true)
    expect(r.ok).toBe(false)
    expect(useSyncUi.getState().error).toBe('Not signed in to iCloud')
    expect(useSyncUi.getState().config?.enabled).toBe(false)
  })
})
