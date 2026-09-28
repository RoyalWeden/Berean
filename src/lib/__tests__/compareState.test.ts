/**
 * T23-022…T23-027: phone Compare state — LXX ↔ KJVA pair only, sanitizing older / Mac states.
 */
import { describe, it, expect } from 'vitest'
import type { BibleTabState } from '@/types'
import {
  columnsForState, makeCompareTabState, navigateColumns, swapColumns, correspondingVerse, translationLabel,
} from '@/mobile/reader/compareState'

const st = (p: Partial<BibleTabState>): BibleTabState => ({ bookId: 'GEN', chapter: 1, translation: 'KJVA', ...p } as BibleTabState)

describe('columnsForState', () => {
  it('defaults to the source text on the left and its counterpart on the right', () => {
    expect(columnsForState(st({}))).toEqual([{ textId: 'kjva', bookId: 'GEN', chapter: 1 }, { textId: 'lxx', bookId: 'GEN', chapter: 1 }])
    expect(columnsForState(st({ translation: 'LXX', bookId: 'PSA', chapter: 22 }))).toEqual([{ textId: 'lxx', bookId: 'PSA', chapter: 22 }, { textId: 'kjva', bookId: 'PSA', chapter: 23 }])
  })
  it('sanitizes persisted states with other / extra texts to the pair', () => {
    const cols = columnsForState(st({ compareColumns: [
      { textId: 'enoch', bookId: 'ENO', chapter: 1 }, { textId: 'LXX', bookId: 'GEN', chapter: 2 },
      { textId: 'kjva', bookId: 'GEN', chapter: 2 }, { textId: 'jubilees', bookId: 'JUB', chapter: 1 },
    ] }))
    expect(cols).toEqual([{ textId: 'lxx', bookId: 'GEN', chapter: 2 }, { textId: 'kjva', bookId: 'GEN', chapter: 2 }])
  })
  it('keeps a persisted equivalent right-hand chapter (KJV Ps 116 ↔ LXX 115)', () => {
    const cols = columnsForState(st({ compareColumns: [{ textId: 'kjva', bookId: 'PSA', chapter: 116 }, { textId: 'lxx', bookId: 'PSA', chapter: 115 }] }))
    expect(cols?.[1]).toEqual({ textId: 'lxx', bookId: 'PSA', chapter: 115 })
  })
  it('is null for a restored NT compare tab or bare shells in a non-pair text', () => {
    expect(columnsForState(st({ bookId: 'JHN', chapter: 3, compareColumns: [{ textId: 'kjva', bookId: 'JHN', chapter: 3 }, { textId: 'lxx', bookId: 'JHN', chapter: 3 }] }))).toBeNull()
    expect(columnsForState(st({ bookId: 'JHN', chapter: 3, compareColumns: [{}, {}] as never }))).toBeNull()
  })
})

describe('compare helpers', () => {
  it('makeCompareTabState turns sync on and writes the pair', () => {
    const p = makeCompareTabState(st({}), 3)
    expect(p.compareSyncScroll).toBe(true)
    expect(p.compareColumns).toHaveLength(2)
    expect(p.targetVerse).toBe(3)
  })
  it('navigateColumns remaps the counterpart, or keeps only the left when not comparable', () => {
    expect(navigateColumns({ textId: 'kjva', bookId: 'GEN', chapter: 1 }, 'PSA', 23)).toEqual([{ textId: 'kjva', bookId: 'PSA', chapter: 23 }, { textId: 'lxx', bookId: 'PSA', chapter: 22 }])
    expect(navigateColumns({ textId: 'kjva', bookId: 'GEN', chapter: 1 }, 'JHN', 1)).toEqual([{ textId: 'kjva', bookId: 'JHN', chapter: 1 }])
  })
  it('swapColumns / correspondingVerse / labels', () => {
    const a = { textId: 'kjva', bookId: 'GEN', chapter: 1 }, b = { textId: 'lxx', bookId: 'GEN', chapter: 1 }
    expect(swapColumns([a, b])).toEqual([b, a])
    expect(correspondingVerse([0, 1, 2, 5], 3)).toBe(2)
    expect(correspondingVerse([1, 2], 2)).toBe(2)
    expect(correspondingVerse([3, 4], 1)).toBe(3)
    expect(correspondingVerse([], 1)).toBeNull()
    expect(translationLabel('kjva')).toBe('KJV')
    expect(translationLabel('lxx')).toBe('LXX')
  })
})
