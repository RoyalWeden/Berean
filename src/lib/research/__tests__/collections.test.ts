import { describe, it, expect } from 'vitest'
import { activeCollections, collectionOf, detectQuestionScope, textIdsFor, DEFAULT_COLLECTIONS } from '../collections'

describe('collections (decision 9, scenario 20)', () => {
  it('labels every text and the KJV Apocrypha books; Esther is ordinary canon', () => {
    expect(collectionOf('kjva', 'EST')).toBe('canon')
    expect(collectionOf('kjva', 'TOB')).toBe('apocrypha')
    expect(collectionOf('kjva', 'ESG')).toBe('apocrypha') // Additions to Esther
    expect(collectionOf('jubilees', 'JUB')).toBe('pseudepigrapha')
    expect(collectionOf('hermas', 'HER')).toBe('early-christian')
    expect(collectionOf('lxx', 'GEN')).toBe('lxx')
  })

  it('reads an explicit scope from the question', () => {
    expect(detectQuestionScope('verses about wisdom only in the Apocrypha')).toEqual({ only: ['apocrypha'] })
    expect(detectQuestionScope('just the 66 books please')).toEqual({ only: ['canon'] })
    expect(detectQuestionScope('remove the Apocrypha')).toEqual({ exclude: ['apocrypha'] })
    expect(detectQuestionScope('without the pseudepigrapha, verses about angels')).toEqual({ exclude: ['pseudepigrapha'] })
    expect(detectQuestionScope('verses about grace')).toEqual({})
  })

  it('question scope beats the setting; an empty result falls back to the canon', () => {
    expect(activeCollections(undefined, {})).toEqual([...DEFAULT_COLLECTIONS])
    expect(activeCollections(['canon'], { only: ['apocrypha'] })).toEqual(['apocrypha'])
    expect(activeCollections(undefined, { exclude: ['apocrypha', 'pseudepigrapha'] })).toEqual(['canon', 'early-christian'])
    expect(activeCollections(['apocrypha'], { exclude: ['apocrypha'] })).toEqual(['canon'])
  })

  it('maps collections to text ids', () => {
    expect(textIdsFor(['canon'])).toEqual(['kjva'])
    expect(textIdsFor(['apocrypha'])).toEqual(['kjva'])
    expect(textIdsFor(['pseudepigrapha'])).toContain('jubilees')
    expect(textIdsFor(['pseudepigrapha'])).not.toContain('hermas')
  })
})
