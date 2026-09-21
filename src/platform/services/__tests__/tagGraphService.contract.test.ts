import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../index'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

describe('tagGraphService', () => {
  let userDb: DatabaseAdapter
  let registry: Services
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    userDb = await migratedUserDb()
    const rec = recordingEvents()
    changes = rec.changes
    // tagGraphService is built through the registry so its getGraph() -> verseTags.list() call
    // (the "() => Services" indirection that lets tagGraph and verseTags depend on each other
    // without an import cycle) is exercised for real, not stubbed.
    registry = createServices(makeContext({ userDb, events: rec.events }))
  })

  it('getGraph: tags come from verseTags, plus edges and co-occurrence weights >= 2', async () => {
    const a = (await registry.verseTags.create('Alpha')).find((t) => t.name === 'Alpha')!
    const b = (await registry.verseTags.create('Beta')).find((t) => t.name === 'Beta')!
    const c = (await registry.verseTags.create('Gamma')).find((t) => t.name === 'Gamma')!

    // A and B co-occur on GEN 1:1 and GEN 1:2 (weight 2); A and C co-occur only once (below the
    // weight >= 2 threshold, so should be omitted); B and C never co-occur.
    await registry.verseTags.addMembers({ tagIds: [a.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 2 }] }], label: 'A' })
    await registry.verseTags.addMembers({ tagIds: [b.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 2 }] }], label: 'B' })
    await registry.verseTags.addMembers({ tagIds: [c.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 1 }] }], label: 'C' })

    const created = await registry.tagGraph.createEdge(a.id, b.id)
    expect(created).toMatchObject({ created: true })

    const graph = await registry.tagGraph.getGraph()
    expect(graph.tags.map((t) => t.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({ source: a.id, target: b.id, arrows: 'none', dashed: false })
    expect(graph.coOccurrenceOmitted).toBe(false)
    // The co-occurrence self-join orders each pair by `tag_id <`, i.e. plain string comparison
    // of the (random) UUIDs — not by which tag is logically "a" or "b" — so compare sorted.
    expect(graph.coOccurrence).toHaveLength(1)
    expect([graph.coOccurrence[0].a, graph.coOccurrence[0].b].sort()).toEqual([a.id, b.id].sort())
    expect(graph.coOccurrence[0].weight).toBe(2)
  })

  it('createEdge: rejects same-tag, returns conflict for an existing pair, otherwise creates', async () => {
    const a = (await registry.verseTags.create('X')).find((t) => t.name === 'X')!
    const b = (await registry.verseTags.create('Y')).find((t) => t.name === 'Y')!

    expect(await registry.tagGraph.createEdge(a.id, a.id)).toEqual({ created: false, invalid: true })
    expect(await registry.tagGraph.createEdge('', b.id)).toEqual({ created: false, invalid: true })

    const first = await registry.tagGraph.createEdge(a.id, b.id)
    expect(first.created).toBe(true)
    expect(changes).toEqual(expect.arrayContaining([{ entity: 'tag_edge', id: (first as { edge: { id: string } }).edge.id, op: 'upsert', scope: undefined }]))

    const again = await registry.tagGraph.createEdge(a.id, b.id)
    expect(again).toMatchObject({ created: false, conflict: true, existing: { source: a.id, target: b.id } })
  })

  it('updateEdge: partial patch semantics (color: null clears, dashed coerces to 0/1), and notFound', async () => {
    const a = (await registry.verseTags.create('X')).find((t) => t.name === 'X')!
    const b = (await registry.verseTags.create('Y')).find((t) => t.name === 'Y')!
    const created = await registry.tagGraph.createEdge(a.id, b.id)
    const id = (created as { edge: { id: string } }).edge.id

    const withColor = await registry.tagGraph.updateEdge(id, { color: '#ff0000', dashed: true, note: 'hand-drawn' })
    expect(withColor.updated).toBe(true)
    let edge = (withColor.edges ?? []).find((e) => e.id === id)!
    expect(edge).toMatchObject({ color: '#ff0000', dashed: true, note: 'hand-drawn' })

    // Omitting color/dashed/note leaves them as-is; arrows is patched.
    const arrowsOnly = await registry.tagGraph.updateEdge(id, { arrows: 'forward' })
    edge = (arrowsOnly.edges ?? []).find((e) => e.id === id)!
    expect(edge).toMatchObject({ arrows: 'forward', color: '#ff0000', dashed: true, note: 'hand-drawn' })

    // Explicit color: null clears it back to neutral.
    const cleared = await registry.tagGraph.updateEdge(id, { color: null })
    edge = (cleared.edges ?? []).find((e) => e.id === id)!
    expect(edge.color).toBeNull()
    expect(edge.dashed).toBe(true) // untouched by this patch

    expect(await registry.tagGraph.updateEdge('missing', { arrows: 'both' })).toEqual({ updated: false, notFound: true })
  })

  it('deleteEdge removes the edge and emits a delete event', async () => {
    const a = (await registry.verseTags.create('X')).find((t) => t.name === 'X')!
    const b = (await registry.verseTags.create('Y')).find((t) => t.name === 'Y')!
    const created = await registry.tagGraph.createEdge(a.id, b.id)
    const id = (created as { edge: { id: string } }).edge.id

    const result = await registry.tagGraph.deleteEdge(id)
    expect(result.deleted).toBe(true)
    expect(result.edges).toEqual([])
    expect(changes).toEqual(expect.arrayContaining([{ entity: 'tag_edge', id, op: 'delete', scope: undefined }]))
  })

  it('setTagPosition persists graph_x/graph_y/graph_pinned, visible through verseTags.list', async () => {
    const [tag] = await registry.verseTags.create('Pinned')
    expect(tag.graphX).toBeNull()
    expect(tag.graphY).toBeNull()
    expect(tag.graphPinned).toBe(false)

    const result = await registry.tagGraph.setTagPosition(tag.id, 12.5, -7.25, true)
    expect(result).toEqual({ ok: true })

    const [updated] = await registry.verseTags.list()
    expect(updated.graphX).toBe(12.5)
    expect(updated.graphY).toBe(-7.25)
    expect(updated.graphPinned).toBe(true)

    // Clearing back to null / unpinned
    await registry.tagGraph.setTagPosition(tag.id, null, null, false)
    const [cleared] = await registry.verseTags.list()
    expect(cleared.graphX).toBeNull()
    expect(cleared.graphY).toBeNull()
    expect(cleared.graphPinned).toBe(false)

    expect(changes.some((c) => c.entity === 'verse_tag' && c.id === tag.id && c.op === 'upsert')).toBe(true)
  })
})
