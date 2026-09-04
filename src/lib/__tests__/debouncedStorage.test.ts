import { describe, it, expect, vi, beforeEach } from 'vitest'
import { debouncedLocalStorage, readThroughLocalStorage } from '../debouncedStorage'

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('debouncedLocalStorage (main window)', () => {
  it('coalesces bursts and flushes after the debounce', () => {
    vi.useFakeTimers()
    debouncedLocalStorage.setItem('k', 'a')
    debouncedLocalStorage.setItem('k', 'b')
    debouncedLocalStorage.setItem('k', 'c')
    expect(localStorage.getItem('k')).toBeNull() // nothing written yet
    // a pending read still sees the latest value
    expect(debouncedLocalStorage.getItem('k')).toBe('c')
    vi.advanceTimersByTime(600)
    expect(localStorage.getItem('k')).toBe('c')
  })
})

describe('readThroughLocalStorage (secondary windows)', () => {
  it('reads through to localStorage', () => {
    localStorage.setItem('berean-app-state', '{"state":{"theme":"dark"}}')
    expect(readThroughLocalStorage.getItem('berean-app-state')).toBe('{"state":{"theme":"dark"}}')
  })

  it('never writes — setItem and removeItem are no-ops', () => {
    localStorage.setItem('berean-app-state', 'ORIGINAL')
    readThroughLocalStorage.setItem('berean-app-state', 'CLOBBERED')
    readThroughLocalStorage.removeItem('berean-app-state')
    expect(localStorage.getItem('berean-app-state')).toBe('ORIGINAL')
  })

  it('getItem tolerates a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    expect(readThroughLocalStorage.getItem('x')).toBeNull()
    spy.mockRestore()
  })
})
