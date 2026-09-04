import { describe, it, expect } from 'vitest'
import { rankVerseTags } from '@/lib/verseTagSearch'
import type { VerseTag } from '@/types'

const tag = (name: string, verseCount = 0, chapterCount = 0): VerseTag => ({
  id: name, name, color: null, createdAt: 0, memberCount: 0, verseCount, chapterCount,
})

describe('rankVerseTags', () => {
  const tags = [
    tag('prophecy', 40, 5),
    tag('prophets', 12, 2),
    tag('pride', 3, 1),
    tag('grace', 20, 4),
  ]

  it('empty needle returns all tags (sorted by verse count desc, then name)', () => {
    expect(rankVerseTags(tags, '').map((t) => t.name)).toEqual(['prophecy', 'grace', 'prophets', 'pride'])
  })

  it('substring match, case-insensitive', () => {
    expect(rankVerseTags(tags, 'PROPH').map((t) => t.name)).toEqual(['prophecy', 'prophets'])
    expect(rankVerseTags(tags, 'ri').map((t) => t.name).sort()).toEqual(['pride'])
  })

  it('exact match ranks above a longer prefix match', () => {
    const t2 = [tag('joy', 2), tag('joyful', 99)]
    expect(rankVerseTags(t2, 'joy').map((t) => t.name)).toEqual(['joy', 'joyful'])
  })

  it('prefix match ranks above a mid-string match', () => {
    const t2 = [tag('unmerited', 50), tag('merit', 1)]
    expect(rankVerseTags(t2, 'merit').map((t) => t.name)).toEqual(['merit', 'unmerited'])
  })

  it('no match → empty', () => {
    expect(rankVerseTags(tags, 'zzz')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const input = [tag('b'), tag('a')]
    rankVerseTags(input, '')
    expect(input.map((t) => t.name)).toEqual(['b', 'a'])
  })
})
