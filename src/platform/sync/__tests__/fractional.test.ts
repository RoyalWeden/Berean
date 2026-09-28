import { describe, it, expect } from 'vitest'
import { keyBetween, keysAfter, compareOrder, isValidOrderKey } from '../fractional'

describe('fractional order keys', () => {
  it('starts at a0 and generates strictly ordered keys at open ends and between neighbours', () => {
    const first = keyBetween(undefined, undefined)
    expect(first).toBe('a0')
    const after = keyBetween(first, undefined)
    const before = keyBetween(undefined, first)
    expect(before < first && first < after).toBe(true)
    const mid = keyBetween(before, first)
    expect(before < mid && mid < first).toBe(true)
    expect(keyBetween('a0', 'a1')).toBe('a0V')
    expect(keyBetween('a0', 'a0V')).toBe('a0G')
  })

  it('always finds room between adjacent keys (deep nesting)', () => {
    let lo = keyBetween(undefined, undefined)
    let hi = keyBetween(lo, undefined)
    for (let i = 0; i < 300; i++) {
      const m = keyBetween(lo, hi)
      expect(lo < m && m < hi, `${lo} < ${m} < ${hi}`).toBe(true)
      expect(isValidOrderKey(m)).toBe(true)
      if (i % 2) lo = m; else hi = m
    }
  })

  it('appending at the end only bumps the integer part (keys stay short)', () => {
    const keys = keysAfter(undefined, 500)
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true)
    for (const k of keys) expect(isValidOrderKey(k)).toBe(true)
    expect(keys[499].length).toBeLessThanOrEqual(3)
  })

  it('prepending at the start repeatedly keeps ordering and stays short', () => {
    let first = keyBetween(undefined, undefined)
    for (let i = 0; i < 500; i++) {
      const b = keyBetween(undefined, first)
      expect(b < first).toBe(true)
      first = b
    }
    expect(first.length).toBeLessThanOrEqual(3)
  })

  it('rejects malformed input', () => {
    expect(() => keyBetween('a1', 'a0')).toThrow()
    expect(() => keyBetween('a00', undefined)).toThrow()   // trailing 0 in fraction
    expect(() => keyBetween('', undefined)).toThrow()
    expect(() => keyBetween('!0', undefined)).toThrow()
    expect(isValidOrderKey('a0')).toBe(true)
    expect(isValidOrderKey('Zz')).toBe(true)
    expect(isValidOrderKey('a')).toBe(false)
  })

  it('compareOrder tie-breaks equal keys by id', () => {
    const rows = [{ orderKey: 'a1', id: 'z' }, { orderKey: 'a1', id: 'b' }, { orderKey: 'a0', id: 'q' }]
    expect(rows.sort(compareOrder).map((r) => r.id)).toEqual(['q', 'b', 'z'])
  })
})
