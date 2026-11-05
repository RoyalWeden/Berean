import { describe, it, expect } from 'vitest'
import { commentaryDepth, commentaryDepthRules } from '../commentaryDepth'

describe('commentaryDepth (spec §5.2: minimum interpretive depth)', () => {
  it('classifies the requested depth', () => {
    expect(commentaryDepth('explain Titus 2:11-14')).toBe('plain')
    expect(commentaryDepth('explain the historical setting of this verse')).toBe('historical')
    expect(commentaryDepth('compare the main interpretations of Romans 14')).toBe('perspectives')
    expect(commentaryDepth('make the case that the sabbath is the seventh day')).toBe('argument')
    expect(commentaryDepth('what does the Greek word in John 1:1 tell us')).toBe('linguistic')
  })

  it('plain answers forbid added interpretation; perspectives must be labelled and never a consensus', () => {
    expect(commentaryDepthRules('plain')).toMatch(/Do not add doctrine, application or interpretation/)
    expect(commentaryDepthRules('perspectives')).toMatch(/do not claim any view is the consensus/i)
    for (const d of ['plain', 'historical', 'linguistic', 'perspectives', 'argument'] as const) expect(commentaryDepthRules(d)).toMatch(/"Interpretation:"/)
  })
})
