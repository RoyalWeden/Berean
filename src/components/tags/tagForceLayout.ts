import type { TagEdge, VerseTag } from '@/types'

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  pinned: boolean
}

export const R_MIN = 14
export const R_MAX = 40

/** Node radius blends usage (verses/chapters covered) and connectedness (drawn edges). */
export function nodeRadius(tag: VerseTag, edgeCount: number): number {
  const usage = Math.sqrt((tag.verseCount ?? 0) + 3 * (tag.chapterCount ?? 0))
  const conn = Math.sqrt(edgeCount)
  return Math.max(R_MIN, Math.min(R_MAX, R_MIN + 2.6 * usage + 3.2 * conn))
}

export function edgeCountByTag(edges: TagEdge[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of edges) {
    m.set(e.source, (m.get(e.source) ?? 0) + 1)
    m.set(e.target, (m.get(e.target) ?? 0) + 1)
  }
  return m
}

/** Seed sim nodes: pinned/known positions kept, the rest placed on a golden-angle spiral. */
export function seedNodes(tags: VerseTag[], edges: TagEdge[], center: { x: number; y: number }): SimNode[] {
  const ec = edgeCountByTag(edges)
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))
  return tags.map((t, i) => {
    const r = nodeRadius(t, ec.get(t.id) ?? 0)
    const hasPos = t.graphX != null && t.graphY != null
    if (hasPos) {
      return { id: t.id, x: t.graphX as number, y: t.graphY as number, vx: 0, vy: 0, r, pinned: !!t.graphPinned }
    }
    const rad = 40 + 22 * Math.sqrt(i + 1)
    const ang = i * GOLDEN
    return { id: t.id, x: center.x + rad * Math.cos(ang), y: center.y + rad * Math.sin(ang), vx: 0, vy: 0, r, pinned: false }
  })
}

export interface StepOptions {
  charge?: number       // repulsion strength
  spring?: number       // link spring strength
  springLength?: number
  gravity?: number      // pull toward center
  damping?: number
  center: { x: number; y: number }
}

/**
 * One Verlet-ish integration step over `nodes` (mutated in place). Only drawn `edges` create
 * springs; co-occurrence links are visual only. Returns the max displacement this step so the
 * caller can stop the rAF loop once the layout settles.
 */
export function stepLayout(nodes: SimNode[], edges: TagEdge[], opts: StepOptions): number {
  const charge = opts.charge ?? 1400
  const spring = opts.spring ?? 0.02
  const springLength = opts.springLength ?? 120
  const gravity = opts.gravity ?? 0.015
  const damping = opts.damping ?? 0.85
  const { center } = opts
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Repulsion (O(n²) — fine to a few hundred nodes; caller can pin the rest).
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; d2 = dx * dx + dy * dy }
      const minDist = (a.r + b.r + 24)
      const d = Math.sqrt(d2)
      const f = charge / d2 + (d < minDist ? (minDist - d) * 0.6 : 0)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }
  }

  // Link springs (drawn edges only).
  for (const e of edges) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const f = (d - springLength) * spring
    const fx = (dx / d) * f
    const fy = (dy / d) * f
    a.vx += fx; a.vy += fy
    b.vx -= fx; b.vy -= fy
  }

  // Gravity + integrate.
  let maxDisp = 0
  for (const n of nodes) {
    if (n.pinned) { n.vx = 0; n.vy = 0; continue }
    n.vx += (center.x - n.x) * gravity
    n.vy += (center.y - n.y) * gravity
    n.vx *= damping
    n.vy *= damping
    n.x += n.vx
    n.y += n.vy
    maxDisp = Math.max(maxDisp, Math.abs(n.vx) + Math.abs(n.vy))
  }

  // Hard non-overlap pass — the soft repulsion above can still leave circles touching/overlapping
  // (spring pull + centre gravity can win against it at rest). Positionally separate EVERY pair
  // closer than r+r+GAP. A pinned node normally holds and the other takes the whole push; if BOTH
  // are pinned they still split it 50/50 (the caller re-persists the moved pinned positions once
  // the sim settles) — "if one intersects, push the other", no exceptions.
  const GAP = 12
  for (let iter = 0; iter < 8; iter++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) { dx = Math.random() - 0.5 || 0.01; dy = Math.random() - 0.5 || 0.01; d = Math.hypot(dx, dy) }
        const min = a.r + b.r + GAP
        if (d >= min) continue
        const push = min - d
        const ux = dx / d
        const uy = dy / d
        let aShare: number, bShare: number
        if (a.pinned === b.pinned) { aShare = 0.5; bShare = 0.5 }
        else if (a.pinned) { aShare = 0; bShare = 1 }
        else { aShare = 1; bShare = 0 }
        a.x += ux * push * aShare
        a.y += uy * push * aShare
        b.x -= ux * push * bShare
        b.y -= uy * push * bShare
        // kill the velocity component pointing at the other node so the next integration step
        // doesn't just re-close the gap we just opened
        if (aShare > 0) { a.vx = 0; a.vy = 0 }
        if (bShare > 0) { b.vx = 0; b.vy = 0 }
        moved = true
      }
    }
    if (!moved) break
    maxDisp = Math.max(maxDisp, 1.5) // keep the sim running while any separation is still happening
  }
  return maxDisp
}
