import { describe, it, expect } from 'vitest'
import { HybridLogicalClock, compareHlc, formatHlc, parseHlc, MAX_CLOCK_DRIFT_MS } from '../hlc'

describe('HybridLogicalClock', () => {
  it('formats fixed-width, parses back, and compares as strings', () => {
    const s = formatHlc({ wallMs: 1758416400123, counter: 7, deviceId: 'dev1' })
    expect(s).toBe('1758416400123-0007-dev1')
    expect(parseHlc(s)).toEqual({ wallMs: 1758416400123, counter: 7, deviceId: 'dev1' })
    expect(compareHlc('1758416400123-0007-a', '1758416400123-0008-a')).toBe(-1)
    expect(compareHlc('1758416400124-0000-a', '1758416400123-ffff-z')).toBe(1)
  })

  it('ticks monotonically even when the wall clock stalls or goes backwards', () => {
    let now = 1000
    const c = new HybridLogicalClock('d', { now: () => now })
    const t1 = c.tick()
    const t2 = c.tick()          // same ms → counter
    now = 900                    // clock went backwards
    const t3 = c.tick()
    now = 5000
    const t4 = c.tick()
    expect([t1, t2, t3, t4]).toEqual([...[t1, t2, t3, t4]].sort())
    expect(new Set([t1, t2, t3, t4]).size).toBe(4)
    expect(parseHlc(t4).counter).toBe(0)
  })

  it('receive() advances past remote timestamps so later local ticks sort after them', () => {
    let now = 1000
    const c = new HybridLogicalClock('local', { now: () => now })
    c.tick()
    const remote = formatHlc({ wallMs: 5000, counter: 3, deviceId: 'remote' })
    c.receive(remote)
    const next = c.tick()
    expect(compareHlc(next, remote)).toBe(1)
    expect(parseHlc(next)).toMatchObject({ wallMs: 5000, counter: 4 })
  })

  it('clamps a wall clock that jumped more than an hour ahead and reports drift', () => {
    let now = 10_000
    let drift = 0
    const c = new HybridLogicalClock('d', { now: () => now, onDrift: (ms) => { drift = ms } })
    c.tick()
    now = 10_000 + MAX_CLOCK_DRIFT_MS * 3
    const t = c.tick()
    expect(drift).toBeGreaterThan(0)
    expect(parseHlc(t).wallMs).toBe(10_000 + MAX_CLOCK_DRIFT_MS)
  })

  it('ignores a remote timestamp absurdly far in the future', () => {
    const now = 10_000
    const c = new HybridLogicalClock('d', { now: () => now })
    c.tick()
    c.receive(formatHlc({ wallMs: now + MAX_CLOCK_DRIFT_MS * 10, counter: 0, deviceId: 'x' }))
    expect(parseHlc(c.latest()).wallMs).toBe(now)
  })

  it('restores from a persisted latest() value', () => {
    const c1 = new HybridLogicalClock('d', { now: () => 100 })
    c1.tick(); c1.tick()
    const c2 = new HybridLogicalClock('d', { now: () => 100, last: c1.latest() })
    expect(compareHlc(c2.tick(), c1.latest())).toBe(1)
    expect(() => new HybridLogicalClock('bad-id')).toThrow()
  })
})
