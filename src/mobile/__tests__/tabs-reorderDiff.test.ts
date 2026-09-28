import { describe, it, expect } from 'vitest'
import { singleMove } from '../tabs/reorderDiff'

describe('singleMove', () => {
  it('detects an item dragged later', () => {
    expect(singleMove(['a', 'b', 'c', 'd'], ['b', 'c', 'a', 'd'])).toEqual({ from: 0, to: 2 })
  })
  it('detects an item dragged earlier', () => {
    expect(singleMove(['a', 'b', 'c', 'd'], ['a', 'd', 'b', 'c'])).toEqual({ from: 3, to: 1 })
  })
  it('returns null for no change or different sets', () => {
    expect(singleMove(['a', 'b'], ['a', 'b'])).toBeNull()
    expect(singleMove(['a', 'b'], ['a'])).toBeNull()
  })
  it('handles adjacent swaps both ways', () => {
    expect(singleMove(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual({ from: 0, to: 1 })
    expect(singleMove(['a', 'b', 'c'], ['a', 'c', 'b'])).toEqual({ from: 1, to: 2 })
  })
})
