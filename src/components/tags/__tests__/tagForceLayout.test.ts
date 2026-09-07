import { describe, it, expect } from 'vitest'
import { nodeRadius, edgeCountByTag, seedNodes, stepLayout, R_MIN, R_MAX } from '../tagForceLayout'
import type { TagEdge, VerseTag } from '@/types'

const tag = (id: string, verseCount = 0, chapterCount = 0, extra: Partial<VerseTag> = {}): VerseTag => ({
  id, name: id, color: null, colorSlot: 0, createdAt: 0, memberCount: 0, verseCount, chapterCount, ...extra,
})
const edge = (source: string, target: string): TagEdge => ({
  id: `${source}-${target}`, source, target, arrows: 'none', color: null, dashed: false, note: '', createdAt: 0, updatedAt: 0,
})

describe('nodeRadius', () => {
  it('clamps within [R_MIN, R_MAX] and grows with usage + connections', () => {
    expect(nodeRadius(tag('a'), 0)).toBe(R_MIN)
    expect(nodeRadius(tag('b', 500, 50), 40)).toBe(R_MAX)
    expect(nodeRadius(tag('c', 20), 0)).toBeGreaterThan(nodeRadius(tag('c', 2), 0))
    expect(nodeRadius(tag('c'), 8)).toBeGreaterThan(nodeRadius(tag('c'), 1))
  })
})

describe('edgeCountByTag', () => {
  it('counts both endpoints', () => {
    const m = edgeCountByTag([edge('a', 'b'), edge('a', 'c')])
    expect(m.get('a')).toBe(2)
    expect(m.get('b')).toBe(1)
    expect(m.get('c')).toBe(1)
  })
})

describe('seedNodes', () => {
  it('keeps stored positions and pins, spirals the rest', () => {
    const nodes = seedNodes(
      [tag('pinned', 0, 0, { graphX: 10, graphY: 20, graphPinned: true }), tag('free')],
      [],
      { x: 0, y: 0 },
    )
    const pinned = nodes.find((n) => n.id === 'pinned')!
    expect(pinned).toMatchObject({ x: 10, y: 20, pinned: true })
    expect(nodes.find((n) => n.id === 'free')!.pinned).toBe(false)
  })
})

describe('stepLayout', () => {
  it('settles toward a low max displacement over many steps', () => {
    const nodes = seedNodes([tag('a'), tag('b'), tag('c'), tag('d')], [edge('a', 'b'), edge('c', 'd')], { x: 300, y: 300 })
    let disp = Infinity
    for (let i = 0; i < 400; i++) disp = stepLayout(nodes, [edge('a', 'b'), edge('c', 'd')], { center: { x: 300, y: 300 } })
    expect(disp).toBeLessThan(1)
    for (const n of nodes) { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true) }
  })

  it('never moves a pinned node', () => {
    const nodes = seedNodes([tag('p', 0, 0, { graphX: 5, graphY: 5, graphPinned: true }), tag('q')], [], { x: 0, y: 0 })
    for (let i = 0; i < 50; i++) stepLayout(nodes, [], { center: { x: 0, y: 0 } })
    const p = nodes.find((n) => n.id === 'p')!
    expect(p.x).toBe(5)
    expect(p.y).toBe(5)
  })
})
