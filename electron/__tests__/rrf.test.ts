import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from '../rrf'

describe('reciprocalRankFusion', () => {
  it('scores rank-1 higher than rank-2 within a single list', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c']], (x) => x)
    expect(fused.map((f) => f.key)).toEqual(['a', 'b', 'c'])
    expect(fused[0].score).toBeGreaterThan(fused[1].score)
    expect(fused[1].score).toBeGreaterThan(fused[2].score)
  })

  it('an item appearing in two lists outranks one appearing in only one, even at a worse rank', () => {
    // 'x' is rank 3 in list A and rank 3 in list B (present in both).
    // 'y' is rank 1 in list A only (absent from B).
    const listA = ['y', 'z', 'x']
    const listB = ['w', 'v', 'x']
    const fused = reciprocalRankFusion([listA, listB], (i) => i)
    const scoreOf = (k: string) => fused.find((f) => f.key === k)!.score
    // x: 1/(60+3) + 1/(60+3) = 2/63 ≈ 0.03175
    // y: 1/(60+1) = 1/61 ≈ 0.01639
    expect(scoreOf('x')).toBeGreaterThan(scoreOf('y'))
  })

  it('matches the textbook RRF formula exactly for a simple case', () => {
    const fused = reciprocalRankFusion([['a']], (x) => x, 60)
    expect(fused[0].score).toBeCloseTo(1 / 61, 10)
  })

  it('fuses lists of structurally different item types via keyOf', () => {
    interface Keyword { kw: string; rank: number }
    interface Semantic { id: string }
    const keywordList: Keyword[] = [{ kw: 'a', rank: 0 }, { kw: 'b', rank: 1 }]
    const semanticList: Semantic[] = [{ id: 'b' }, { id: 'c' }]
    const fused = reciprocalRankFusion<Keyword | Semantic>(
      [keywordList, semanticList],
      (item) => ('kw' in item ? item.kw : item.id),
    )
    // 'b' appears in both lists (rank 2 in keywordList, rank 1 in semanticList) — should win.
    expect(fused[0].key).toBe('b')
  })

  it('handles empty lists without error', () => {
    expect(reciprocalRankFusion([], (x: string) => x)).toEqual([])
    expect(reciprocalRankFusion([[], []], (x: string) => x)).toEqual([])
  })

  it('deduplicates a key that appears multiple times in the SAME list by summing (not the usual case, but must not crash or double-count incorrectly)', () => {
    // Not a realistic input (a ranked list shouldn't contain duplicates), but the function should
    // behave predictably rather than throw — later occurrences just add more score.
    const fused = reciprocalRankFusion([['a', 'a']], (x) => x)
    expect(fused).toHaveLength(1)
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10)
  })
})
