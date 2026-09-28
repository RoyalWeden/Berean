/** DATA-SAFE-001…003 — the pure merge model (merge.ts). */
import { describe, it, expect } from 'vitest'
import { relate, mergeConcurrent, childLineage, trimLineage, fieldHashes, type VersionInfo } from '../merge'

const h = (ms: number, dev = 'a', c = 0) => `${String(1_700_000_000_000 + ms).padStart(13, '0')}-${c.toString(16).padStart(4, '0')}-${dev}`
const v = (hlc: string, lineage: string[] | null, fieldHlc: Record<string, string> | null = null): VersionInfo => ({ hlc, lineage, fieldHlc })

describe('relate', () => {
  it('known: the remote version is ours or an ancestor (replay, duplicate, relayed old version)', () => {
    const local = v(h(3), [h(1), h(2)])
    expect(relate(local, v(h(3), [h(1), h(2)]))).toBe('known')
    expect(relate(local, v(h(2), [h(1)]))).toBe('known')
  })
  it('descends: the remote version was made on top of ours', () => {
    expect(relate(v(h(1), []), v(h(2, 'b'), [h(1)]))).toBe('descends')
    // across a third device we have not heard from yet (A → B → C, C arrives first)
    expect(relate(v(h(1), []), v(h(3, 'c'), [h(1), h(2, 'b')]))).toBe('descends')
  })
  it('concurrent: made apart', () => {
    expect(relate(v(h(2), [h(1)]), v(h(3, 'b'), [h(1)]))).toBe('concurrent')
  })
  it('a pre-v47 op (no lineage) is never silently dropped as "known" just for being older', () => {
    expect(relate(v(h(5), null), v(h(3, 'b'), null))).toBe('concurrent')
  })
})

describe('mergeConcurrent — field by field', () => {
  const base = h(1)
  const local = { ...v(h(2), [base], { content: base, pinned: h(2), title: base }), fields: { content: 'old', pinned: 1, title: 'T' } }
  const remote = { ...v(h(3, 'b'), [base], { content: h(3, 'b'), pinned: base, title: base }), fields: { content: 'new text', pinned: 0, title: 'T' } }
  it('independent fields both survive (pinned on A, edited on B) — the reported overwrite bug', () => {
    const m = mergeConcurrent(local, remote)
    expect(m.fields).toEqual({ content: 'new text', pinned: 1, title: 'T' })
    expect(m.conflicts).toEqual([])
    expect(m.hlc).toBe(h(3, 'b'))
    expect(m.lineage).toContain(h(2))
  })
  it('symmetric: the other device computes the same result', () => {
    const m = mergeConcurrent(remote, local)
    expect(m.fields).toEqual({ content: 'new text', pinned: 1, title: 'T' })
    expect(m.hlc).toBe(h(3, 'b'))
  })
  it('both changed the same field: higher clock wins, the other value is reported (never dropped)', () => {
    const a = { ...v(h(2), [base], { name: h(2) }), fields: { name: 'Sermons' } }
    const b = { ...v(h(3, 'b'), [base], { name: h(3, 'b') }), fields: { name: 'Teachings' } }
    const m1 = mergeConcurrent(a, b), m2 = mergeConcurrent(b, a)
    expect(m1.fields.name).toBe('Teachings'); expect(m2.fields.name).toBe('Teachings')
    expect(m1.conflicts).toEqual([{ field: 'name', keptClock: h(3, 'b'), lostClock: h(2), lostValue: 'Sermons', lostSide: 'local' }])
    expect(m2.conflicts[0]).toMatchObject({ lostValue: 'Sermons', lostSide: 'remote' })
  })
  it('bookkeeping fields (updated_at, order_key) merge without being reported', () => {
    const a = { ...v(h(2), [base], { updated_at: h(2) }), fields: { updated_at: 2 } }
    const b = { ...v(h(3, 'b'), [base], { updated_at: h(3, 'b') }), fields: { updated_at: 3 } }
    const m = mergeConcurrent(a, b)
    expect(m.fields.updated_at).toBe(3); expect(m.conflicts).toEqual([])
  })
  it('an empty creation never blanks existing text (preferNonEmpty)', () => {
    const cloud = { ...v(h(2, 'b'), [], { content: h(2, 'b') }), fields: { content: 'Morning reading…' } }
    const fresh = { ...v(h(9), [], { content: h(9) }), fields: { content: '' } }
    expect(mergeConcurrent(cloud, fresh, { preferNonEmpty: ['content'] }).fields.content).toBe('Morning reading…')
    expect(mergeConcurrent(fresh, cloud, { preferNonEmpty: ['content'] }).fields.content).toBe('Morning reading…')
  })
})

describe('lineage bookkeeping', () => {
  it('childLineage adds the parent; trim keeps the newest, deduplicated', () => {
    expect(childLineage(v(h(2), [h(1)]))).toEqual([h(1), h(2)])
    expect(childLineage(null)).toEqual([])
    expect(trimLineage([h(3), h(1), h(3), h(2)], 2)).toEqual([h(2), h(3)])
  })
  it('field hashes differ exactly where values differ', () => {
    const a = fieldHashes({ x: 1, y: 'a' }), b = fieldHashes({ x: 1, y: 'b' })
    expect(a.x).toBe(b.x); expect(a.y).not.toBe(b.y)
  })
})
