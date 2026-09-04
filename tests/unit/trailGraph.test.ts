import { describe, it, expect } from 'vitest'
import type { TrailConnection, TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import { buildTrailGraph, buildChapterIndex, nodeBefore, nodeNearest, MAX_GUTTER_LANES } from '@/components/studyTrail/trailGraph'

// Regression suite for the Study Trail's arrow targeting. The defect these lock down: nodes used
// to be indexed by `session:book:chapter` with last-write-wins, so any chapter visited more than
// once always resolved to the LATEST visit — every return arrow, origin line and same-chapter
// check silently pointed at a node in the FUTURE relative to the connection that produced it.

const SESSION = 's1'
const T0 = 1_700_000_000_000
const MIN = 60_000

const session: TrailSession = {
  id: SESSION, name: 'Test', status: 'live', possiblyAccidental: false,
  recapUserEdited: false, createdAt: T0, updatedAt: T0,
}

function node(id: string, bookId: string, chapter: number, at: number, extra: Partial<TrailNode> = {}): TrailNode {
  return {
    id, trailSessionId: SESSION, bookId, chapter, orderIndex: 0,
    anchorStartedAt: at, anchorEndedAt: at + 5 * MIN, isTopicBreak: false, ...extra,
  }
}

function conn(id: string, fromNodeId: string, at: number, extra: Partial<TrailConnection> = {}): TrailConnection {
  return {
    id, trailSessionId: SESSION, fromNodeId, toKind: 'chapter',
    clarityTier: 1, reasonTags: [], ties: [], tiesFrom: [], tiesTo: [],
    weight: 'full', createdAt: at, chainDepth: 0, isBranch: false, isBranchReturn: false, ...extra,
  }
}

function detailOf(nodes: TrailNode[], connections: TrailConnection[]): TrailSessionDetail {
  return { session, nodes: nodes.map((n, i) => ({ ...n, orderIndex: i })), connections, pausedIntervals: [] }
}

const edgeByKey = (edges: { key: string }[], key: string) => edges.find((e) => e.key === key)

describe('chapter node resolution', () => {
  // Genesis 1 is visited three times, with a Job 26 stop between each pair.
  const nodes = [
    node('n1', 'Gen', 1, T0),
    node('n2', 'Job', 26, T0 + 10 * MIN),
    node('n3', 'Gen', 1, T0 + 20 * MIN, { revisitOfNodeId: 'n1' }),
    node('n4', 'Job', 26, T0 + 30 * MIN, { revisitOfNodeId: 'n2' }),
    node('n5', 'Gen', 1, T0 + 40 * MIN, { revisitOfNodeId: 'n1' }),
  ]
  const idx = buildChapterIndex(nodes)

  it('nodeNearest picks the visit closest in time, not the last one', () => {
    expect(nodeNearest(idx, SESSION, 'Gen', 1, T0 + 1 * MIN)?.id).toBe('n1')
    expect(nodeNearest(idx, SESSION, 'Gen', 1, T0 + 21 * MIN)?.id).toBe('n3')
    expect(nodeNearest(idx, SESSION, 'Gen', 1, T0 + 41 * MIN)?.id).toBe('n5')
  })

  it('nodeBefore never returns a node created after the given moment', () => {
    expect(nodeBefore(idx, SESSION, 'Gen', 1, T0 + 25 * MIN)?.id).toBe('n3')
    expect(nodeBefore(idx, SESSION, 'Gen', 1, T0 - MIN)).toBeUndefined()
  })

  it('resolves identically whether nodes arrive in order_index or anchor order', () => {
    const shuffled = buildChapterIndex([...nodes].reverse())
    expect(nodeNearest(shuffled, SESSION, 'Gen', 1, T0 + 21 * MIN)?.id).toBe('n3')
    expect(nodeBefore(shuffled, SESSION, 'Gen', 1, T0 + 25 * MIN)?.id).toBe('n3')
  })

  it('keeps sessions apart in the merged Everything timeline', () => {
    const other = { ...node('x1', 'Gen', 1, T0 + 5 * MIN), trailSessionId: 's2' }
    const merged = buildChapterIndex([...nodes, other])
    expect(nodeNearest(merged, SESSION, 'Gen', 1, T0 + 5 * MIN)?.id).toBe('n1')
    expect(nodeNearest(merged, 's2', 'Gen', 1, T0 + 5 * MIN)?.id).toBe('x1')
  })
})

describe('return edges', () => {
  it('targets the visit that existed when the jump happened, never a later one', () => {
    // From the Isaiah 11 stop at +30m the reader glances back at Genesis 1 (no dwell, so no node
    // is promoted for it) and then carries on to Luke 4. The Genesis 1 visit that existed at that
    // moment is n3; n6 is created half an hour LATER. The old last-write-wins map returned n6
    // here — an arrow pointing into the future.
    const nodes = [
      node('n1', 'Gen', 1, T0),
      node('n2', 'Job', 26, T0 + 10 * MIN),
      node('n3', 'Gen', 1, T0 + 20 * MIN, { revisitOfNodeId: 'n1' }),
      node('n4', 'Isa', 11, T0 + 30 * MIN),
      node('n5', 'Luk', 4, T0 + 45 * MIN),
      node('n6', 'Gen', 1, T0 + 60 * MIN, { revisitOfNodeId: 'n1' }),
    ]
    const c = conn('c1', 'n4', T0 + 32 * MIN, { toBookId: 'Gen', toChapter: 1, toVerse: 2 })
    const g = buildTrailGraph(detailOf(nodes, [c]))
    expect(edgeByKey(g.edges, 'return:c1')?.to).toBe('node:n3')
  })

  it('never produces a return edge whose target postdates the connection', () => {
    const nodes = [
      node('n1', 'Gen', 1, T0),
      node('n2', 'Job', 26, T0 + 10 * MIN),
      node('n3', 'Gen', 1, T0 + 20 * MIN, { revisitOfNodeId: 'n1' }),
      node('n4', 'Isa', 11, T0 + 25 * MIN),
      node('n5', 'Gen', 1, T0 + 40 * MIN, { revisitOfNodeId: 'n1' }),
    ]
    const conns = [
      conn('c1', 'n2', T0 + 12 * MIN, { toBookId: 'Gen', toChapter: 1 }),
      conn('c2', 'n4', T0 + 27 * MIN, { toBookId: 'Gen', toChapter: 1 }),
    ]
    const g = buildTrailGraph(detailOf(nodes, conns))
    for (const e of g.edges) {
      if (!e.key.startsWith('return:')) continue
      const connId = e.key.slice('return:'.length)
      const c = conns.find((x) => x.id === connId)!
      const target = g.nodeById.get(e.to.slice('node:'.length))!
      expect(target.anchorStartedAt).toBeLessThanOrEqual(c.createdAt)
    }
  })

  it('carries the tying verse pair as the lane label', () => {
    const nodes = [
      node('n1', 'Hos', 2, T0),
      node('n2', 'Rev', 12, T0 + 10 * MIN),
    ]
    const c = conn('c1', 'n2', T0 + 12 * MIN, {
      toBookId: 'Hos', toChapter: 2, tiesFrom: ['Rev 12:6'], tiesTo: ['Hos 2:14'],
    })
    const g = buildTrailGraph(detailOf(nodes, [c]))
    expect(edgeByKey(g.edges, 'return:c1')?.label).toBe('Rev 12:6 ⇄ Hos 2:14')
  })
})

describe('spine arrows', () => {
  it('every suppressed spine arrow has a replacement edge landing on the same node', () => {
    const nodes = [
      node('n1', 'Isa', 11, T0),
      node('n2', 'Luk', 4, T0 + 5 * MIN),
      node('n3', 'Luk', 5, T0 + 12 * MIN),
    ]
    const conns = [
      conn('c1', 'n1', T0 + 4 * MIN, { toBookId: 'Luk', toChapter: 4, toVerse: 18, isBranch: true, originVersePinFrom: 2 }),
      // Low-signal forward origin: deliberately produces no row, so its arrival must KEEP the
      // generic spine arrow. The old code could mark the arrival "traced" and then emit nothing.
      conn('c2', 'n2', T0 + 11 * MIN, { toBookId: 'Luk', toChapter: 5, clarityTier: 2, reasonTags: ['reading'] }),
    ]
    const g = buildTrailGraph(detailOf(nodes, conns))
    const incoming = (nodeId: string) => g.edges.filter((e) => e.to === `node:${nodeId}`)
    for (const n of nodes.slice(1)) expect(incoming(n.id).length).toBeGreaterThan(0)
    // n2 arrives via the 3-segment branch path, so its generic spine arrow is gone…
    expect(edgeByKey(g.edges, 'spine:n1')).toBeUndefined()
    expect(edgeByKey(g.edges, 'tangent-arrive:n2')?.to).toBe('node:n2')
    // …while n3's low-signal origin produced no row, so its spine arrow survives.
    expect(edgeByKey(g.edges, 'spine:n2')?.to).toBe('node:n3')
  })

  it('does not join two chronologically adjacent nodes from different sessions', () => {
    const a = node('n1', 'Gen', 1, T0)
    const b = { ...node('n2', 'Gen', 2, T0 + MIN), trailSessionId: 's2' }
    const g = buildTrailGraph(detailOf([a, b], []))
    expect(edgeByKey(g.edges, 'spine:n1')).toBeUndefined()
  })
})

describe('gutter', () => {
  it('caps lanes so the reserved width is constant no matter how many backlinks overlap', () => {
    // Six mutually overlapping revisits — more than the gutter has lanes.
    const nodes = [node('base', 'Gen', 1, T0)]
    for (let i = 1; i <= 6; i++) nodes.push(node(`r${i}`, 'Gen', 1, T0 + i * MIN, { revisitOfNodeId: 'base' }))
    const g = buildTrailGraph(detailOf(nodes, []))
    const laned = g.edges.filter((e) => e.lane != null)
    expect(laned.length).toBe(6)
    for (const e of laned) expect(e.lane!).toBeLessThan(MAX_GUTTER_LANES)
    // Overflow is faded rather than dropped.
    expect(laned.some((e) => e.overflowLane)).toBe(true)

    const narrow = buildTrailGraph(detailOf([nodes[0], nodes[1]], []))
    expect(g.gutterWidth).toBe(narrow.gutterWidth)
  })

  it('reserves nothing when there are no backlinks at all', () => {
    const g = buildTrailGraph(detailOf([node('n1', 'Gen', 1, T0), node('n2', 'Gen', 2, T0 + MIN)], []))
    expect(g.gutterWidth).toBe(0)
  })
})

describe('same-chapter branches', () => {
  it('is decided from the source node itself, not from a later visit of that chapter', () => {
    const nodes = [
      node('n1', 'Gen', 1, T0),
      node('n2', 'Job', 26, T0 + 10 * MIN),
      node('n3', 'Gen', 1, T0 + 20 * MIN, { revisitOfNodeId: 'n1' }),
    ]
    // A cross-ref inside Genesis 1, fired from the FIRST Genesis 1 node.
    const c = conn('c1', 'n1', T0 + MIN, { toBookId: 'Gen', toChapter: 1, toVerse: 26 })
    const g = buildTrailGraph(detailOf(nodes, [c]))
    const row = g.rowsForNode.get('n1')!.find((r) => r.id === 'c1')!
    expect(row.isSameChapterBranch).toBe(true)
    expect(row.isReturn).toBeFalsy()
  })
})
