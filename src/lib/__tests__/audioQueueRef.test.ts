import { describe, it, expect } from 'vitest'
import { parseQueueRefInput } from '../audioQueueRef'

describe('parseQueueRefInput', () => {
  it('parses a whole chapter ("Luke 15")', () => {
    const items = parseQueueRefInput('Luke 15', 'kjva')
    expect(items).toEqual([
      { bookId: 'LUK', chapter: 15, startVerse: 1, endVerse: null, textId: 'kjva', label: 'Luke 15' },
    ])
  })

  it('parses a same-chapter verse range ("Luke 16:1-5")', () => {
    const items = parseQueueRefInput('Luke 16:1-5', 'kjva')
    expect(items).toEqual([
      { bookId: 'LUK', chapter: 16, startVerse: 1, endVerse: 5, textId: 'kjva', label: 'Luke 16:1-5' },
    ])
  })

  it('expands a chapter range ("Luke 13-15") into one item per chapter', () => {
    const items = parseQueueRefInput('Luke 13-15', 'kjva')
    expect(items).toEqual([
      { bookId: 'LUK', chapter: 13, startVerse: 1, endVerse: null, textId: 'kjva', label: 'Luke 13' },
      { bookId: 'LUK', chapter: 14, startVerse: 1, endVerse: null, textId: 'kjva', label: 'Luke 14' },
      { bookId: 'LUK', chapter: 15, startVerse: 1, endVerse: null, textId: 'kjva', label: 'Luke 15' },
    ])
  })

  it('expands a cross-chapter verse range ("Luke 15:10-16:3") per chapter touched', () => {
    const items = parseQueueRefInput('Luke 15:10-16:3', 'kjva')
    expect(items).toEqual([
      { bookId: 'LUK', chapter: 15, startVerse: 10, endVerse: null, textId: 'kjva', label: 'Luke 15:10–end' },
      { bookId: 'LUK', chapter: 16, startVerse: 1, endVerse: 3, textId: 'kjva', label: 'Luke 16:1–3' },
    ])
  })

  it('returns null for input that does not parse as a reference', () => {
    expect(parseQueueRefInput('not a reference', 'kjva')).toBeNull()
    expect(parseQueueRefInput('', 'kjva')).toBeNull()
  })
})
