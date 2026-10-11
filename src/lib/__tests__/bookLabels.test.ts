import { describe, it, expect } from 'vitest'
import { conciseBookLabels, plainNumberedPart } from '../bookLabels'

const RCL = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'].map((r, i) => ({ id: `RCL${i + 1}`, name: `Recognitions of Clement — Book ${r}` }))
const HERMAS = [
  { id: 'HER_VIS', name: 'Shepherd of Hermas — Visions' },
  { id: 'HER_MAN', name: 'Shepherd of Hermas — Mandates' },
  { id: 'HER_SIM', name: 'Shepherd of Hermas — Similitudes' },
]

describe('conciseBookLabels', () => {
  it('Recognitions of Clement: Book 1 … Book 10, same ids, work title kept for the group', () => {
    const { labels, workOf } = conciseBookLabels(RCL)
    expect(RCL.map((b) => labels.get(b.id))).toEqual(['Book 1', 'Book 2', 'Book 3', 'Book 4', 'Book 5', 'Book 6', 'Book 7', 'Book 8', 'Book 9', 'Book 10'])
    expect(workOf.get('RCL9')).toBe('Recognitions of Clement')
  })
  it('Shepherd of Hermas: the section names actually present', () => {
    const { labels } = conciseBookLabels(HERMAS)
    expect(HERMAS.map((b) => labels.get(b.id))).toEqual(['Visions', 'Mandates', 'Similitudes'])
  })
  it('leaves ordinary books, and a lone "Work — Part" book, unchanged', () => {
    const { labels } = conciseBookLabels([
      { id: 'GEN', name: 'Genesis' },
      { id: 'SNG', name: 'Song of Solomon' },
      { id: 'X1', name: 'Some Work — Only Part' },
    ])
    expect(labels.get('GEN')).toBe('Genesis')
    expect(labels.get('SNG')).toBe('Song of Solomon')
    expect(labels.get('X1')).toBe('Some Work — Only Part')
  })
  it('converts only "Book/Part <roman>"', () => {
    expect(plainNumberedPart('Book IV')).toBe('Book 4')
    expect(plainNumberedPart('Book XIV')).toBe('Book 14')
    expect(plainNumberedPart('Visions')).toBe('Visions')
  })
})
