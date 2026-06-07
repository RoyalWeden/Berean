/**
 * 100 dedicated tests for progressPercent / progressWidth / progressComplete.
 */
import { describe, it, expect } from 'vitest'
import { progressPercent, progressWidth, progressComplete } from '@/lib/progressBar'

// ── progressPercent (60 tests) ────────────────────────────────────────────────

describe('progressPercent — basic arithmetic', () => {
  it('T01: 0/0 → 0', () => expect(progressPercent(0, 0)).toBe(0))
  it('T02: 0/1 → 0', () => expect(progressPercent(0, 1)).toBe(0))
  it('T03: 1/1 → 100', () => expect(progressPercent(1, 1)).toBe(100))
  it('T04: 1/2 → 50', () => expect(progressPercent(1, 2)).toBe(50))
  it('T05: 1/4 → 25', () => expect(progressPercent(1, 4)).toBe(25))
  it('T06: 3/4 → 75', () => expect(progressPercent(3, 4)).toBe(75))
  it('T07: 1/3 is between 33 and 34', () => {
    const p = progressPercent(1, 3)
    expect(p).toBeGreaterThan(33)
    expect(p).toBeLessThan(34)
  })
  it('T08: 2/3 is between 66 and 67', () => {
    const p = progressPercent(2, 3)
    expect(p).toBeGreaterThan(66)
    expect(p).toBeLessThan(67)
  })
  it('T09: 5/10 → 50', () => expect(progressPercent(5, 10)).toBe(50))
  it('T10: 9/10 → 90', () => expect(progressPercent(9, 10)).toBe(90))
  it('T11: 10/10 → 100', () => expect(progressPercent(10, 10)).toBe(100))
  it('T12: 1/100 → 1', () => expect(progressPercent(1, 100)).toBe(1))
  it('T13: 99/100 → 99', () => expect(progressPercent(99, 100)).toBe(99))
  it('T14: 50/100 → 50', () => expect(progressPercent(50, 100)).toBe(50))
  it('T15: 1/1000 → 0.1', () => expect(progressPercent(1, 1000)).toBeCloseTo(0.1, 5))
  it('T16: 999/1000 → 99.9', () => expect(progressPercent(999, 1000)).toBeCloseTo(99.9, 5))
  it('T17: 0/1000 → 0', () => expect(progressPercent(0, 1000)).toBe(0))
  it('T18: 1000/1000 → 100', () => expect(progressPercent(1000, 1000)).toBe(100))
  it('T19: 0.5/1 → 50', () => expect(progressPercent(0.5, 1)).toBe(50))
  it('T20: 0.1/1 → 10', () => expect(progressPercent(0.1, 1)).toBeCloseTo(10, 5))
})

describe('progressPercent — clamping', () => {
  it('T21: done > total → 100 (not > 100)', () => expect(progressPercent(11, 10)).toBe(100))
  it('T22: done >> total → 100', () => expect(progressPercent(1000, 10)).toBe(100))
  it('T23: done = total + 1 → 100', () => expect(progressPercent(11, 10)).toBe(100))
  it('T24: done = total * 2 → 100', () => expect(progressPercent(20, 10)).toBe(100))
  it('T25: negative done → 0', () => expect(progressPercent(-1, 10)).toBe(0))
  it('T26: very negative done → 0', () => expect(progressPercent(-9999, 10)).toBe(0))
  it('T27: negative total → 0', () => expect(progressPercent(5, -1)).toBe(0))
  it('T28: negative both → 0', () => expect(progressPercent(-5, -10)).toBe(0))
  it('T29: done=0, negative total → 0', () => expect(progressPercent(0, -5)).toBe(0))
  it('T30: result never exceeds 100', () => {
    const cases = [[200, 1], [1e9, 10], [100, 1], [101, 100]]
    cases.forEach(([d, t]) => expect(progressPercent(d, t)).toBeLessThanOrEqual(100))
  })
  it('T31: result never below 0', () => {
    const cases = [[-1, 10], [0, 0], [-100, -1], [5, -1]]
    cases.forEach(([d, t]) => expect(progressPercent(d, t)).toBeGreaterThanOrEqual(0))
  })
})

describe('progressPercent — NaN / Infinity / special values', () => {
  it('T32: NaN done → 0', () => expect(progressPercent(NaN, 10)).toBe(0))
  it('T33: NaN total → 0', () => expect(progressPercent(5, NaN)).toBe(0))
  it('T34: NaN both → 0', () => expect(progressPercent(NaN, NaN)).toBe(0))
  it('T35: Infinity done → 0 (non-finite is treated as invalid)', () => expect(progressPercent(Infinity, 10)).toBe(0))
  it('T36: Infinity total → 0', () => expect(progressPercent(5, Infinity)).toBe(0))
  it('T37: Infinity both → 0', () => expect(progressPercent(Infinity, Infinity)).toBe(0))
  it('T38: -Infinity done → 0', () => expect(progressPercent(-Infinity, 10)).toBe(0))
  it('T39: -Infinity total → 0', () => expect(progressPercent(5, -Infinity)).toBe(0))
  it('T40: result is always finite', () => {
    const inputs = [[0,0],[NaN,NaN],[Infinity,Infinity],[-Infinity,-Infinity],[5,0],[0,5]]
    inputs.forEach(([d,t]) => expect(Number.isFinite(progressPercent(d,t))).toBe(true))
  })
  it('T41: result is never NaN', () => {
    const inputs = [[NaN,10],[10,NaN],[NaN,NaN],[0,0],[-1,-1],[Infinity,0]]
    inputs.forEach(([d,t]) => expect(isNaN(progressPercent(d,t))).toBe(false))
  })
})

describe('progressPercent — phase-transition behaviour', () => {
  // Simulates what happens when the phase changes during a sync:
  // phase 1: channels (done=8, total=10) then phase 2: transcripts (done=0, total=500)
  it('T42: phase-2 start (0/500) → 0 (clean reset)', () => expect(progressPercent(0, 500)).toBe(0))
  it('T43: phase-2 mid (250/500) → 50', () => expect(progressPercent(250, 500)).toBe(50))
  it('T44: phase-2 done (500/500) → 100', () => expect(progressPercent(500, 500)).toBe(100))
  it('T45: single-item phase (1/1) → 100', () => expect(progressPercent(1, 1)).toBe(100))
  it('T46: progress from 0→100 is monotonically increasing', () => {
    const total = 20
    let prev = -1
    for (let i = 0; i <= total; i++) {
      const p = progressPercent(i, total)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })
  it('T47: large phase (0/11263) → 0', () => expect(progressPercent(0, 11263)).toBe(0))
  it('T48: large phase (5631/11263) ≈ 50', () => {
    const p = progressPercent(5631, 11263)
    expect(p).toBeGreaterThan(49)
    expect(p).toBeLessThan(51)
  })
  it('T49: large phase (11263/11263) → 100', () => expect(progressPercent(11263, 11263)).toBe(100))
  it('T50: typical channel sync (CHANNELS.length = 43, done=21) ≈ 48.8', () => {
    const p = progressPercent(21, 43)
    expect(p).toBeGreaterThan(48)
    expect(p).toBeLessThan(50)
  })
})

describe('progressPercent — type and precision', () => {
  it('T51: returns a number, not string', () => expect(typeof progressPercent(5, 10)).toBe('number'))
  it('T52: integer inputs → integer or simple decimal', () => {
    expect(progressPercent(5, 10)).toBe(50)
    expect(progressPercent(1, 4)).toBe(25)
  })
  it('T53: floating point inputs handled', () => {
    expect(progressPercent(0.5, 2)).toBeCloseTo(25, 5)
  })
  it('T54: very small percentage (1/10000) → > 0', () => {
    expect(progressPercent(1, 10000)).toBeGreaterThan(0)
  })
  it('T55: minimum truthy value (1/large) is > 0', () => {
    expect(progressPercent(1, 1e9)).toBeGreaterThan(0)
  })
  it('T56: total=1 acts like a boolean', () => {
    expect(progressPercent(0, 1)).toBe(0)
    expect(progressPercent(1, 1)).toBe(100)
  })
  it('T57: deterministic — same inputs always same output', () => {
    for (let i = 0; i < 5; i++) {
      expect(progressPercent(7, 10)).toBe(70)
    }
  })
  it('T58: 0.001/0.001 → 100 (fractional total)', () => expect(progressPercent(0.001, 0.001)).toBe(100))
  it('T59: 0/0.001 → 0 (zero done, fractional total)', () => expect(progressPercent(0, 0.001)).toBe(0))
  it('T60: 100 total produces near-integer results for integer done values', () => {
    // IEEE 754: (1/100)*100 can be 1.0000000000000002; test for close-enough
    for (let d = 0; d <= 100; d++) {
      const p = progressPercent(d, 100)
      expect(Math.round(p)).toBe(d)
    }
  })
})

// ── progressWidth (20 tests) ──────────────────────────────────────────────────

describe('progressWidth — CSS string output', () => {
  it('T61: always returns a string ending in %', () => expect(progressWidth(5, 10).endsWith('%')).toBe(true))
  it('T62: 0/0 → "0%"', () => expect(progressWidth(0, 0)).toBe('0%'))
  it('T63: 5/10 → "50%"', () => expect(progressWidth(5, 10)).toBe('50%'))
  it('T64: 10/10 → "100%"', () => expect(progressWidth(10, 10)).toBe('100%'))
  it('T65: done > total → "100%"', () => expect(progressWidth(15, 10)).toBe('100%'))
  it('T66: NaN inputs → "0%"', () => expect(progressWidth(NaN, NaN)).toBe('0%'))
  it('T67: Infinity total → "0%"', () => expect(progressWidth(5, Infinity)).toBe('0%'))
  it('T68: negative done → "0%"', () => expect(progressWidth(-5, 10)).toBe('0%'))
  it('T69: 1/4 → "25%"', () => expect(progressWidth(1, 4)).toBe('25%'))
  it('T70: 3/4 → "75%"', () => expect(progressWidth(3, 4)).toBe('75%'))
  it('T71: safe to use as inline style value', () => {
    const w = progressWidth(5, 10)
    expect(w).toMatch(/^[\d.]+%$/)
  })
  it('T72: "0%" is correct for empty progress', () => {
    expect(progressWidth(0, 100)).toBe('0%')
  })
  it('T73: works for large totals', () => {
    expect(progressWidth(5631, 11263)).toMatch(/^\d+\.?\d*%$/)
  })
  it('T74: fractional percentage → includes decimal', () => {
    const w = progressWidth(1, 3)
    expect(parseFloat(w)).toBeGreaterThan(33)
    expect(parseFloat(w)).toBeLessThan(34)
  })
  it('T75: output parseable as float after stripping %', () => {
    const w = progressWidth(7, 10)
    expect(parseFloat(w)).toBe(70)
  })
  it('T76: matches progressPercent(d,t) + "%"', () => {
    const cases = [[0,10],[5,10],[10,10],[3,4],[1,3]]
    cases.forEach(([d,t]) => {
      expect(progressWidth(d, t)).toBe(`${progressPercent(d, t)}%`)
    })
  })
  it('T77: 0/0 is "0%" not "NaN%"', () => expect(progressWidth(0, 0)).not.toContain('NaN'))
  it('T78: Infinity inputs never produce "Infinity%"', () => {
    expect(progressWidth(Infinity, 10)).not.toContain('Infinity')
    expect(progressWidth(10, Infinity)).not.toContain('Infinity')
  })
  it('T79: result never "undefined%"', () => {
    expect(progressWidth(5, 10)).not.toContain('undefined')
  })
  it('T80: valid for all typical sync sizes', () => {
    const totals = [10, 43, 100, 500, 1000, 11263]
    totals.forEach((t) => {
      const w = progressWidth(Math.floor(t / 2), t)
      expect(w).toMatch(/^[\d.]+%$/)
    })
  })
})

// ── progressComplete (20 tests) ───────────────────────────────────────────────

describe('progressComplete — completion detection', () => {
  it('T81: done = total > 0 → true', () => expect(progressComplete(10, 10)).toBe(true))
  it('T82: done < total → false', () => expect(progressComplete(5, 10)).toBe(false))
  it('T83: total = 0 → false (not started)', () => expect(progressComplete(0, 0)).toBe(false))
  it('T84: done > total → true (overshoot)', () => expect(progressComplete(15, 10)).toBe(true))
  it('T85: done = 0, total = 1 → false', () => expect(progressComplete(0, 1)).toBe(false))
  it('T86: done = 1, total = 1 → true', () => expect(progressComplete(1, 1)).toBe(true))
  it('T87: large sync done → true', () => expect(progressComplete(11263, 11263)).toBe(true))
  it('T88: large sync in progress → false', () => expect(progressComplete(5000, 11263)).toBe(false))
  it('T89: done = 0, any total > 0 → false', () => {
    [1, 10, 100, 1000].forEach((t) => expect(progressComplete(0, t)).toBe(false))
  })
  it('T90: negative done → false', () => expect(progressComplete(-1, 10)).toBe(false))
  it('T91: negative total → false', () => expect(progressComplete(5, -1)).toBe(false))
  it('T92: NaN done → false', () => expect(progressComplete(NaN, 10)).toBe(false))
  it('T93: NaN total → false', () => expect(progressComplete(5, NaN)).toBe(false))
  it('T94: Infinity both → true (Infinity > 0 and Infinity >= Infinity)', () => expect(progressComplete(Infinity, Infinity)).toBe(true))
  it('T95: total=1 transitions: 0→false, 1→true', () => {
    expect(progressComplete(0, 1)).toBe(false)
    expect(progressComplete(1, 1)).toBe(true)
  })
  it('T96: returns boolean (not truthy/falsy)', () => {
    expect(typeof progressComplete(5, 10)).toBe('boolean')
    expect(typeof progressComplete(10, 10)).toBe('boolean')
  })
  it('T97: transitions from false to true when done reaches total', () => {
    const total = 5
    const results = Array.from({ length: total + 2 }, (_, done) => progressComplete(done, total))
    const firstTrue = results.indexOf(true)
    // Everything before firstTrue should be false
    expect(results.slice(0, firstTrue).every((r) => r === false)).toBe(true)
    // Everything from firstTrue onward should be true
    expect(results.slice(firstTrue).every((r) => r === true)).toBe(true)
  })
  it('T98: phase=Done edge case: CHANNELS.length/CHANNELS.length → true', () => {
    const CHANNELS_LEN = 43 // typical value from the app
    expect(progressComplete(CHANNELS_LEN, CHANNELS_LEN)).toBe(true)
  })
  it('T99: transcript phase start (0/11263) → false', () => expect(progressComplete(0, 11263)).toBe(false))
  it('T100: transcript phase done (11263/11263) → true', () => expect(progressComplete(11263, 11263)).toBe(true))
})
