import { describe, it, expect } from 'vitest'
import { detectCompareIntent } from '../compareIntent'
import { detectLexicalIntent } from '../lexicalIntent'
import { wordsOnlyIn } from '../compareWords'

describe('detectCompareIntent', () => {
  it.each([
    'John 1:1 in the KJV and LXX',
    'compare Psalm 23:1 in the Septuagint',
    'how does the LXX read Isaiah 7:14',
    'show Genesis 1:1 side by side in KJV and Brenton',
  ])('translation parallel: %s', (q) => {
    const i = detectCompareIntent(q)
    expect(i?.kind).toBe('translation-parallel')
    expect(i?.refs).toHaveLength(1)
    expect(i?.textIds).toEqual(['kjva', 'lxx'])
  })

  it.each([
    ['compare Genesis 1:1 and John 1:1', 2],
    ['Psalm 22:1 vs Matthew 27:46', 2],
    ['compare Genesis 1:1, John 1:1, Psalm 33:6 and Hebrews 11:3', 4],
  ])('passage comparison: %s', (q, n) => {
    const i = detectCompareIntent(q)
    expect(i?.kind).toBe('passage-compare')
    expect(i?.refs).toHaveLength(n)
  })

  it('caps passages at four', () => {
    expect(detectCompareIntent('compare Gen 1:1, Exod 1:1, Lev 1:1, Num 1:1 and Deut 1:1')?.refs).toHaveLength(4)
  })

  it.each([
    'Compare H2617 and H7356',
    'compare G5485 and G1656 in John 1:16',
    'compare grace and mercy',
    'what is the difference between mercy and grace',
    'John 3:16',
    'John 3:16 LXX',
    'Genesis 1:1 in the LXX',
    'compare John 3:16',
    'John 3:16 and Romans 5:8',
    'verses about the jubilee',
  ])('does not fire: %s', (q) => {
    expect(detectCompareIntent(q)).toBeNull()
  })

  it('leaves Strong\'s comparisons to the lexical detector', () => {
    expect(detectLexicalIntent('Compare H2617 and H7356')?.kind).toBe('strongs-compare')
  })
})

describe('wordsOnlyIn', () => {
  it('returns only words absent from the other text', () => {
    expect(wordsOnlyIn(['In the beginning God created'], ['In the beginning God made'])).toEqual(['created'])
  })
  it('is empty for identical text', () => {
    expect(wordsOnlyIn(['Jesus wept'], ['Jesus wept'])).toEqual([])
  })
})
