import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// The connected-lines engine: a single absolutely-positioned SVG overlay per spine, drawing
// real paths between the ACTUAL measured pixel positions of spine dots and branch-row markers
// — not the previous per-row floating 28px line swatch, which never touched anything on
// either end. Every point (a spine dot, a connection row's marker, a glance-group's marker) is
// registered via a ref callback; this component reads their live getBoundingClientRect() on
// every render (cheap at this data size — at most a few hundred elements) plus on resize/
// content-size changes, and draws curves between whichever pairs the caller asks for.
//
// `zoom` normalizes measured pixel positions back to LOCAL (pre-transform) units: the whole
// spine is wrapped in a `transform: scale(zoom)` ancestor (see MapView.tsx) for real pinch/
// scroll zoom, and getBoundingClientRect() always reports POST-transform visual coordinates —
// feeding those directly into this SVG's own path data would double-apply the scale (the SVG
// is itself a descendant of that same transformed ancestor, so the browser re-scales
// whatever we draw here by `zoom` again at render time). Dividing every measured coordinate
// by the current zoom factor recovers the local units the SVG needs.

export interface TrailPoint { x: number; y: number }
export interface TrailEdge {
  key: string
  from: string
  to: string
  color: string
  dashed?: boolean
  thick?: boolean
  curved?: boolean
  arrow?: boolean
  opacity?: number
}

/** One shared registry of "connector point key → its DOM element", plus the ref-callback
 *  factory every anchor (spine dot, row marker) uses to register itself. Lives in the parent
 *  (MapView/EverythingView) so both the rows themselves and the overlay can share it. */
export function useTrailConnectorPoints() {
  const pointsRef = useRef<Map<string, HTMLElement>>(new Map())
  const registerPoint = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) pointsRef.current.set(key, el)
    else pointsRef.current.delete(key)
  }, [])
  return { pointsRef, registerPoint }
}

// A visible gap between a path's endpoint and the dot/marker it's pointing at, so the
// arrowhead reads as a distinct shape pointing AT something rather than merging into it (dots
// render on top of the overlay in z-order, so an arrow tip landing dead-center used to vanish
// under the dot entirely). Radius is a rough guess from the point's key prefix — spine dots
// (9px box) are a bit bigger than row/group markers (7px/6px boxes).
function radiusFor(key: string): number {
  if (key.startsWith('node:')) return 5
  if (key.startsWith('row:')) return 4
  return 3
}
const ENDPOINT_GAP = 3

/** Pulls a path's endpoint back off the target point by its radius + a visible gap, along the
 *  path's actual approach direction — for curved edges (the cubic bezier this file draws) the
 *  end tangent is ALWAYS horizontal regardless of the two points' relative positions (both
 *  control points are offset the same +36 in x from their own endpoint — see the `d` build
 *  below), so the pullback is a pure x-shift; straight edges pull back along the literal a→b
 *  direction. */
function pullBackEnd(from: TrailPoint, to: TrailPoint, curved: boolean, dist: number): TrailPoint {
  if (curved) return { x: to.x + dist, y: to.y }
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return { x: to.x - (dx / len) * dist, y: to.y - (dy / len) * dist }
}
/** Same idea for the START point — the path begins slightly clear of the source dot too,
 *  rather than dead-center inside it. */
function pushOffStart(from: TrailPoint, to: TrailPoint, curved: boolean, dist: number): TrailPoint {
  if (curved) return { x: from.x + dist, y: from.y }
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist }
}

export default function TrailConnectorOverlay({
  containerRef, pointsRef, edges, zoom = 1,
}: {
  containerRef: React.RefObject<HTMLElement>
  pointsRef: React.MutableRefObject<Map<string, HTMLElement>>
  edges: TrailEdge[]
  zoom?: number
}) {
  const [coords, setCoords] = useState<Map<string, TrailPoint>>(new Map())

  // setCoords with a genuinely new Map object on EVERY call (even when nothing actually
  // moved) was the bug: useLayoutEffect below has no dependency array so it reruns after
  // every render, including the one setCoords itself triggers — an unconditional setState
  // there is an infinite "render → effect → setState → render" loop (React's "Maximum update
  // depth exceeded"). Only committing state when a value actually changed breaks the cycle:
  // the effect still reruns after every render (needed to catch layout changes with no
  // dedicated signal — glance-group expand/collapse, etc.), but once positions stabilize it
  // becomes a no-op instead of scheduling another update.
  const recompute = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const next = new Map<string, TrailPoint>()
    pointsRef.current.forEach((el, key) => {
      const r = el.getBoundingClientRect()
      next.set(key, {
        x: (r.left + r.width / 2 - cRect.left) / zoom,
        y: (r.top + r.height / 2 - cRect.top) / zoom,
      })
    })
    setCoords((prev) => {
      if (prev.size === next.size) {
        let same = true
        for (const [key, pt] of next) {
          const p = prev.get(key)
          if (!p || p.x !== pt.x || p.y !== pt.y) { same = false; break }
        }
        if (same) return prev
      }
      return next
    })
  }, [containerRef, pointsRef, zoom])

  // Every render (cheap — this is small DOM, and it's the only way to catch a glance-group
  // expanding/collapsing or new nodes streaming in without wiring a bespoke "recompute" signal
  // into every caller of every state setter that could change row layout). Safe against
  // infinite loops because recompute() above only calls setCoords when something truly moved.
  useLayoutEffect(() => { recompute() })

  // Catches layout shifts React itself didn't cause a re-render for — window resize, and any
  // size change of the container (fonts finishing load, etc.).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(container)
    window.addEventListener('resize', recompute)
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute) }
  }, [containerRef, recompute])

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        {/* refX=7 (not 5.5) puts the arrow's actual TIP at the path's endpoint with zero
            overshoot — the previous 1.5-unit overshoot was scaling with strokeWidth (markers
            default to markerUnits="strokeWidth") and, combined with dots rendering on top of
            this overlay in z-order, was hiding the arrowhead under the dot rather than merely
            touching it. userSpaceOnUse keeps the marker a fixed visual size regardless of the
            referencing path's stroke width, so a thick "revisited" edge doesn't get an
            oversized arrowhead either. */}
        <marker id="trail-arrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke" />
        </marker>
      </defs>
      {edges.map((e) => {
        const rawA = coords.get(e.from), rawB = coords.get(e.to)
        if (!rawA || !rawB) return null
        const curved = !!e.curved
        const startGap = radiusFor(e.from) + ENDPOINT_GAP
        const endGap = radiusFor(e.to) + (e.arrow ? ENDPOINT_GAP + 2 : ENDPOINT_GAP)
        const a = pushOffStart(rawA, rawB, curved, startGap)
        const b = pullBackEnd(rawA, rawB, curved, endGap)
        const d = curved
          ? `M${a.x},${a.y} C${a.x + 36},${a.y} ${b.x + 36},${b.y} ${b.x},${b.y}`
          : `M${a.x},${a.y} L${b.x},${b.y}`
        return (
          <path
            key={e.key} d={d} stroke={e.color} strokeWidth={e.thick ? 3 : 1.75} fill="none"
            strokeDasharray={e.dashed ? '4 4' : undefined} strokeLinecap="round" opacity={e.opacity ?? 1}
            markerEnd={e.arrow ? 'url(#trail-arrow)' : undefined}
          />
        )
      })}
    </svg>
  )
}
