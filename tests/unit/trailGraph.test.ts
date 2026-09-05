import { describe, it, expect } from 'vitest'
import type { TrailConnection, TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import { buildTrailGraph, buildChapterIndex, groupNodesForRender, nodeBefore, nodeNearest, MAX_GUTTER_LANES } from '@/components/studyTrail/trailGraph'
import { LINE_COLOR } from '@/components/studyTrail/trailStyle'

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

  it('a tied revisit renders as the branch/tangent path, not a duplicate plain return line', () => {
    // Per direct feedback ("back and forth between two chapters then a picker tie... looks
    // really wonky") — a connection that is BOTH a revisit (isReturn) AND a verse-tie/branch
    // (renderAsBranch) used to draw the plain `return:` backlink edge AND the tangent-stub/hop/
    // arrive path for the exact same move. Now only the branch path draws; the plain return
    // edge is skipped whenever renderAsBranch(c) is true.
    const nodes = [
      node('n1', 'Hos', 2, T0),
      node('n2', 'Rev', 12, T0 + 10 * MIN),
    ]
    const c = conn('c1', 'n2', T0 + 12 * MIN, {
      toBookId: 'Hos', toChapter: 2, tiesFrom: ['Rev 12:6'], tiesTo: ['Hos 2:14'],
    })
    const g = buildTrailGraph(detailOf(nodes, [c]))
    expect(edgeByKey(g.edges, 'return:c1')).toBeUndefined()
    // Tangent edges are keyed by the ARRIVAL node — c1 travels from n2 (Rev 12) to n1's own
    // chapter (Hos 2), so the arrival is n1 itself (the tied destination), not n2.
    expect(edgeByKey(g.edges, 'tangent-stub:n1')).toBeDefined()
    expect(edgeByKey(g.edges, 'tangent-hop:n1')).toBeDefined()
    expect(edgeByKey(g.edges, 'tangent-arrive:n1')).toBeDefined()
  })

  it('a SECOND, later tie to the same chapter takes over as its branch owner', () => {
    // Per direct feedback ("i did the same connection between luke 4 and isaiah 61 later in the
    // same session and i dont see the branching... it should show the branching again
    // separate") — the first tie to a chapter used to claim that arrival node PERMANENTLY (the
    // old guard only let a candidate win when the existing owner had NO user data at all), so a
    // second, later re-tie of the exact same chapter silently lost to the first and rendered as
    // a plain revisit instead of its own branch. The latest connection carrying real user data
    // now always takes over ownership of the node.
    const nodes = [
      node('n1', 'Hos', 2, T0),
      node('n2', 'Rev', 12, T0 + 10 * MIN),
      node('n3', 'Jhn', 3, T0 + 30 * MIN),
    ]
    const c1 = conn('c1', 'n2', T0 + 12 * MIN, { toBookId: 'Hos', toChapter: 2, tiesFrom: ['Rev 12:6'], tiesTo: ['Hos 2:14'] })
    const c2 = conn('c2', 'n3', T0 + 32 * MIN, { toBookId: 'Hos', toChapter: 2, tiesFrom: ['Jhn 3:16'], tiesTo: ['Hos 2:23'] })
    const g = buildTrailGraph(detailOf(nodes, [c1, c2]))
    expect(g.originConnByNodeId.get('n1')?.id).toBe('c2')
  })

  it('a tied connection that LOSES the branch-ownership race still draws its return line', () => {
    // Real regression, found from a live report ("connections are not showing... theres nothing
    // shown between two stops that should be joined"). Combining the previous two fixes exposed
    // a hole: pushRowEdges skipped the plain return/revisit line for ANY renderAsBranch(c)
    // connection, assuming it always owned (and was covered by) the tangent-stub/hop/arrive
    // path. But when TWO tied connections both resolve to the SAME arrival node, only the
    // ownership-winning one (originConnByNodeId) actually gets that tangent path — the loser
    // still has renderAsBranch(c) === true but nothing draws ITS path, so it rendered with no
    // connecting line to its target at all. Fixed by only skipping the return line when the
    // connection actually owns its arrival's tangent path (ownsBranchArrival).
    const nodes = [
      node('n0', 'Isa', 61, T0),                                    // original Isaiah 61 visit
      node('n1', 'Isa', 1, T0 + 5 * MIN),
      node('n2', 'Isa', 61, T0 + 9 * MIN, { revisitOfNodeId: 'n0' }), // the ONE revisit node both connections target
      node('n3', '1Ki', 1, T0 + 40 * MIN),
    ]
    // Both are RETURNS to n2 (fromNodeId=n3, whose own "next" is nothing — never misread as a
    // forward branch) — c_loser created first, c_winner later with its own real ties, so
    // originConnByNodeId hands ownership of n2 to c_winner per the previous test's fix.
    const cLoser = conn('c_loser', 'n3', T0 + 45 * MIN, { toBookId: 'Isa', toChapter: 61, tiesFrom: ['Luke 4:18-19'], tiesTo: ['Isaiah 61:1-2'] })
    const cWinner = conn('c_winner', 'n3', T0 + 50 * MIN, { toBookId: 'Isa', toChapter: 61, tiesFrom: ['Luke 4:22-24'], tiesTo: ['Isaiah 61:6-8'] })
    const g = buildTrailGraph(detailOf(nodes, [cLoser, cWinner]))
    expect(g.originConnByNodeId.get('n2')?.id).toBe('c_winner')
    // The winner is covered by the tangent path (no separate return line needed).
    expect(edgeByKey(g.edges, 'return:c_winner')).toBeUndefined()
    expect(edgeByKey(g.edges, 'tangent-arrive:n2')).toBeDefined()
    // The loser must NOT be left with nothing connecting it to n2.
    expect(edgeByKey(g.edges, 'return:c_loser')).toBeDefined()
  })

  it('never labels a plain (untied) return/revisit line — no verse text on the hairline', () => {
    // Per direct feedback ("dont put the verse stuff in the revisit line generally... it looks
    // really ugly") — even a genuine plain revisit (no tie at all) no longer carries an inline
    // verse-pair label; that detail lives on the tangent bullets for an actual branch/tie, not
    // repeated on every backlink.
    const nodes = [
      node('n1', 'Gen', 1, T0),
      node('n2', 'Job', 26, T0 + 10 * MIN),
    ]
    const c = conn('c1', 'n2', T0 + 12 * MIN, { toBookId: 'Gen', toChapter: 1 })
    const g = buildTrailGraph(detailOf(nodes, [c]))
    expect(edgeByKey(g.edges, 'return:c1')?.label).toBeUndefined()
  })
})

describe('spine arrows', () => {
  it('drops the segment a branch already carries, rather than drawing a faint copy alongside it', () => {
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
    // n2 arrives via the 3-segment branch path, which IS its connection to n1 — so no separate
    // spine segment is drawn for that stretch. A faint parallel copy read as the spine starting
    // and then stopping.
    expect(edgeByKey(g.edges, 'spine:n1')).toBeUndefined()
    expect(edgeByKey(g.edges, 'tangent-arrive:n2')?.to).toBe('node:n2')
    // n3's low-signal origin produced no row, so its segment carries the full forward treatment.
    const s2 = edgeByKey(g.edges, 'spine:n2')
    expect(s2?.to).toBe('node:n3')
    expect(s2!.role).toBe('forward')
    expect(s2!.arrow).toBe(true)
  })

  it('uses only the three sanctioned line colours', () => {
    const nodes = [
      node('n1', 'Isa', 11, T0),
      node('n2', 'Luk', 4, T0 + 5 * MIN),
      node('n3', 'Gen', 1, T0 + 12 * MIN),
      node('n4', 'Isa', 11, T0 + 20 * MIN, { revisitOfNodeId: 'n1' }),
    ]
    const conns = [
      conn('c1', 'n1', T0 + 4 * MIN, { toBookId: 'Luk', toChapter: 4, toVerse: 18, isBranch: true }),
      conn('c2', 'n2', T0 + 8 * MIN, { toKind: 'lexicon', toStrongsNum: 'G4151' }),
      conn('c3', 'n3', T0 + 15 * MIN, { toBookId: 'Isa', toChapter: 11, weight: 'glance' }),
    ]
    const g = buildTrailGraph(detailOf(nodes, conns))
    const allowed = new Set(Object.values(LINE_COLOR))
    expect(g.edges.length).toBeGreaterThan(0)
    for (const e of g.edges) expect(allowed.has(e.color as never)).toBe(true)
    // And clarity tier never reaches a line — that was the map's "random colours" problem.
    for (const e of g.edges) expect(e.color).not.toBe('#e08468')
  })

  it('does not join two chronologically adjacent nodes from different sessions', () => {
    const a = node('n1', 'Gen', 1, T0)
    const b = { ...node('n2', 'Gen', 2, T0 + MIN), trailSessionId: 's2' }
    const g = buildTrailGraph(detailOf([a, b], []))
    expect(edgeByKey(g.edges, 'spine:n1')).toBeUndefined()
  })
})

describe('gutter', () => {
  it('draws ONE line per revisited chapter, not one per pair of visits', () => {
    // Seven visits to Genesis 1 used to mean six overlapping arcs all saying the same thing —
    // "a lot of the revisit lines are overlapping, its hard to tell whats going on."
    const nodes = [node('base', 'Gen', 1, T0)]
    for (let i = 1; i <= 6; i++) nodes.push(node(`r${i}`, 'Gen', 1, T0 + i * MIN, { revisitOfNodeId: 'base' }))
    const g = buildTrailGraph(detailOf(nodes, []))
    const laned = g.edges.filter((e) => e.lane != null)
    expect(laned.length).toBe(1)
    // It spans first visit to last, and records the ones in between as ticks rather than as
    // separate lines.
    expect(laned[0].from).toBe('node:r6')
    expect(laned[0].to).toBe('node:base')
    expect(laned[0].ticks).toEqual(['node:r1', 'node:r2', 'node:r3', 'node:r4', 'node:r5'])
    // The always-on "×N" label was removed per feedback (it read as clutter) — the count and
    // visit dates now live in revisitCount/firstVisitAt/lastVisitAt instead, surfaced only via
    // a hover tooltip (see TrailConnectorOverlay), and "how much" shows on the line itself via
    // weight/saturation (strokeWidth/opacity scale with count, see trailStyle.ts's EDGE_STYLE.back
    // base values).
    expect(laned[0].label).toBeUndefined()
    expect(laned[0].revisitCount).toBe(7)
    expect(laned[0].firstVisitAt).toBe(T0)
    expect(laned[0].lastVisitAt).toBe(T0 + 6 * MIN)
    // 7 visits caps countStep at 4 (min(7-2, 4)): strokeWidth = base 1 + 4*0.4 = 2.6, opacity =
    // min(0.85, base 0.4 + 4*0.08) = 0.72. T0 is a fixed timestamp long in the past (recency-mute
    // floors at 0.55 once the original visit is >40 days old, which T0 always is), so this is
    // deterministic regardless of when the test actually runs: 0.72 * 0.55 = 0.396.
    expect(laned[0].strokeWidth).toBeCloseTo(2.6, 5)
    expect(laned[0].opacity).toBeCloseTo(0.396, 5)
  })

  it('caps lanes so the reserved width never grows', () => {
    // More separate revisited chapters than MAX_GUTTER_LANES, all overlapping in time.
    const nodes: TrailNode[] = []
    const books = ['Gen', 'Exo', 'Lev', 'Num', 'Deu', 'Jos']
    books.forEach((b, bi) => nodes.push(node(`a${bi}`, b, 1, T0 + bi * MIN)))
    books.forEach((b, bi) => nodes.push(node(`z${bi}`, b, 1, T0 + (20 + bi) * MIN, { revisitOfNodeId: `a${bi}` })))
    const g = buildTrailGraph(detailOf(nodes, []))
    const laned = g.edges.filter((e) => e.lane != null)
    expect(laned.length).toBe(books.length)
    for (const e of laned) expect(e.lane!).toBeLessThan(MAX_GUTTER_LANES)
    // Overflow is faded rather than dropped, so no backlink is ever silently lost.
    expect(laned.some((e) => e.overflowLane)).toBe(true)

    const narrow = buildTrailGraph(detailOf([nodes[0], nodes[books.length]], []))
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

describe('reading straight through', () => {
  const run = (n: number, from = 1) => Array.from({ length: n }, (_, i) =>
    node(`g${from + i}`, 'Gen', from + i, T0 + i * MIN))

  it('collapses a long consecutive run into one group', () => {
    const items = groupNodesForRender(run(8).map((n, i) => ({ ...n, orderIndex: i })))
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('run')
  })

  it('leaves ordinary reading alone', () => {
    // Three chapters is just reading, not a pattern worth folding away.
    const items = groupNodesForRender(run(3))
    expect(items.every((i) => i.type === 'single')).toBe(true)
  })

  it('breaks the run at a stop that has a branch — that stop is the whole point', () => {
    const nodes = run(8)
    const items = groupNodesForRender(nodes, { hasBranches: (id) => id === 'g4' })
    // Gen 1-3 is too short to fold, Gen 4 stands alone, Gen 5-8 folds.
    expect(items.filter((i) => i.type === 'run')).toHaveLength(1)
    expect(items.some((i) => i.type === 'single' && i.node.id === 'g4')).toBe(true)
  })

  it('does not run across a book change or a revisit', () => {
    const nodes = [...run(3), node('x', 'Exo', 4, T0 + 9 * MIN), ...run(4, 5).map((n) => ({ ...n, revisitOfNodeId: 'g1' }))]
    expect(groupNodesForRender(nodes).some((i) => i.type === 'run')).toBe(false)
  })
})

describe('home base', () => {
  it('marks the chapter a session kept returning to', () => {
    const nodes = [
      node('a1', 'Hos', 2, T0),
      node('b1', 'Rev', 12, T0 + 5 * MIN),
      node('a2', 'Hos', 2, T0 + 10 * MIN, { revisitOfNodeId: 'a1' }),
      node('c1', 'Isa', 11, T0 + 15 * MIN),
      node('a3', 'Hos', 2, T0 + 20 * MIN, { revisitOfNodeId: 'a1' }),
    ]
    const g = buildTrailGraph(detailOf(nodes, []))
    // Marked on the FIRST visit, so the badge doesn't wander down the map as more visits land.
    expect(g.anchorNodes.get('a1')).toBe(3)
    expect(g.anchorNodes.has('a3')).toBe(false)
  })

  it('does not mark anything when nothing was really returned to', () => {
    const nodes = [
      node('a1', 'Hos', 2, T0),
      node('b1', 'Rev', 12, T0 + 5 * MIN),
      node('a2', 'Hos', 2, T0 + 10 * MIN, { revisitOfNodeId: 'a1' }),
    ]
    expect(buildTrailGraph(detailOf(nodes, [])).anchorNodes.size).toBe(0)
  })
})
