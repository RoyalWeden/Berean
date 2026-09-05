import { describe, it, expect, vi, beforeEach } from 'vitest'
import { debouncedLocalStorage, readThroughLocalStorage } from '../debouncedStorage'

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('debouncedLocalStorage (main window)', () => {
  it('coalesces bursts and defers stringify + write until the debounce fires', () => {
    vi.useFakeTimers()
    const stringifySpy = vi.spyOn(JSON, 'stringify')
    debouncedLocalStorage.setItem('k', { state: { n: 1 } })
    debouncedLocalStorage.setItem('k', { state: { n: 2 } })
    debouncedLocalStorage.setItem('k', { state: { n: 3 } })
    expect(localStorage.getItem('k')).toBeNull() // nothing written yet
    expect(stringifySpy).not.toHaveBeenCalled() // stringify deferred, not per set()
    // a pending read still sees the latest value, as the parsed object
    expect(debouncedLocalStorage.getItem('k')).toEqual({ state: { n: 3 } })
    vi.advanceTimersByTime(600)
    expect(localStorage.getItem('k')).toBe('{"state":{"n":3}}')
    expect(stringifySpy).toHaveBeenCalledTimes(1) // exactly one stringify for the whole burst
    stringifySpy.mockRestore()
  })

  it('getItem parses the on-disk value when nothing is pending', () => {
    localStorage.setItem('k', '{"state":{"theme":"dark"},"version":8}')
    expect(debouncedLocalStorage.getItem('k')).toEqual({ state: { theme: 'dark' }, version: 8 })
  })

  it('getItem returns null for absent or corrupt on-disk values', () => {
    expect(debouncedLocalStorage.getItem('missing')).toBeNull()
    localStorage.setItem('bad', 'not json{')
    expect(debouncedLocalStorage.getItem('bad')).toBeNull()
  })
})

describe('readThroughLocalStorage (secondary windows)', () => {
  it('reads through to localStorage, parsed', () => {
    localStorage.setItem('berean-app-state', '{"state":{"theme":"dark"}}')
    expect(readThroughLocalStorage.getItem('berean-app-state')).toEqual({ state: { theme: 'dark' } })
  })

  it('never writes — setItem and removeItem are no-ops', () => {
    localStorage.setItem('berean-app-state', 'ORIGINAL')
    readThroughLocalStorage.setItem('berean-app-state', { state: { theme: 'light' } })
    readThroughLocalStorage.removeItem('berean-app-state')
    expect(localStorage.getItem('berean-app-state')).toBe('ORIGINAL')
  })

  it('getItem tolerates a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    expect(readThroughLocalStorage.getItem('x')).toBeNull()
    spy.mockRestore()
  })
})
