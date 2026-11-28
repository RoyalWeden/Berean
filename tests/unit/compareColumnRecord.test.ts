import { describe, expect, it } from 'vitest'
import { compareColumnOrderKey, compareColumnRecord } from '../../src/lib/compareColumnRecord'

describe('Compare column metadata compatibility', () => {
  it('persists reordering even when the destinations are identical', () => {
    const destination = { textId: 'kjva', bookId: 'EXO', chapter: 32 }
    const first = { ...destination, id: 'col-0' }
    const second = { ...destination, id: 'col-1' }
    expect(compareColumnOrderKey([first, second])).not.toBe(compareColumnOrderKey([second, first]))
    expect(compareColumnOrderKey([first, second])).toBe(compareColumnOrderKey([{ ...first }, { ...second }]))
  })

  it('keeps metadata with its column when duplicate destinations reorder', () => {
    const destination = { textId: 'kjva', bookId: 'EXO', chapter: 32 }
    const first = { ...destination, savedRecord: { ...destination, nativeColumnID: 'first', future: { enabled: true } } }
    const second = { ...destination, savedRecord: { ...destination, nativeColumnID: 'second' } }
    const reordered = [second, first].map(column => compareColumnRecord(column))
    expect(reordered.map(column => column.nativeColumnID)).toEqual(['second', 'first'])
    expect(reordered[1].future).toEqual({ enabled: true })
    expect(first.savedRecord.nativeColumnID).toBe('first')
  })

  it('updates destination and local scroll without losing newer configuration fields', () => {
    const savedRecord = { textId: 'kjva', bookId: 'EXO', chapter: 32, nativeColumnID: 'stable', nativePinnedPassage: true }
    const position = { verseNum: 4, frac: 0.25 }
    const result = compareColumnRecord({ textId: 'lxx', bookId: 'PSA', chapter: 22, savedRecord }, position)
    expect(result).toEqual({ ...savedRecord, textId: 'lxx', bookId: 'PSA', chapter: 22, scrollPos: position })
    expect(savedRecord.chapter).toBe(32)
  })

  it('does not invent identity for older columns and clears obsolete scroll data', () => {
    const destination = { textId: 'kjva', bookId: 'JHN', chapter: 1 }
    const result = compareColumnRecord({ ...destination, savedRecord: { ...destination, scrollPos: { verseNum: 2, frac: 0.5 } } })
    expect(result.nativeColumnID).toBeUndefined()
    expect(result.scrollPos).toBeUndefined()
    expect(result.textId).toBe('kjva')
  })
})
