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
  /** Routes this edge through the shared right-hand gutter lane `lane` (0-indexed) instead of
   *  a bezier bulge — see MapView.tsx's greedy lane-packing pass. Requires a `gutter:x` point
   *  to be registered (MapView reserves a fixed-width spacer column for this). Takes priority
   *  over `curved` when both are somehow set. */
  lane?: number
  /** Overrides the thick/1.75 default entirely — for return/revisit-link edges wanting their
   *  own quieter, thinner-than-normal weight independent of the thick flag. */
  strokeWidth?: number
}

// Shared with MapView.tsx, which needs these to size the reserved gutter column — a lane
// routes at `gutterBaseX - lane * LANE_SPACING` (see the `d` construction below), so the
// column must be at least `GUTTER_BASE + maxLane * LANE_SPACING` wide to fit every lane.
export const GUTTER_BASE = 16
export const LANE_SPACING = 10

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
        const startGap = radiusFor(e.from) + ENDPOINT_GAP
        const endGap = radiusFor(e.to) + (e.arrow ? ENDPOINT_GAP + 2 : ENDPOINT_GAP)

        let d: string
        if (e.lane != null) {
          // Laned (gutter) routing: a vertical run confined to this lane's column, jogging
          // horizontally only right at each end — never crosses through intervening content
          // regardless of how far apart the two points are. The two jog corners are true
          // quarter-circle arcs (Q command), not hard L-to-L corners — per direct feedback
          // ("i also hate the boxing looking arrow... this whole line and arrow thing needs to
          // be curved"), strokeLinejoin:"round" alone only bevels a corner's visual join, it
          // doesn't actually curve the path's geometry the way these arcs do.
          const gutter = coords.get('gutter:x')
          const laneX = gutter ? gutter.x - e.lane * LANE_SPACING : Math.max(rawA.x, rawB.x) + 40
          // Text clearance: the old routing jogged out to the lane at the DOT's exact y —
          // since a row's text sits right at that same height and stretches across nearly the
          // whole row width, that jog drew straight across it. Dipping vertically first (still
          // at the dot's own x, i.e. left of where any text starts) into the blank padding a
          // node's own row reserves below its text, THEN jogging horizontally at that safe y,
          // means the horizontal run never shares a y-band with any text at all. Symmetric on
          // both ends. Clamped so a short span between adjacent rows never dips past the other
          // endpoint.
          const vertRun = Math.abs(rawB.y - rawA.y)
          const V_CLEARANCE = Math.min(16, vertRun / 3 || 16)
          const dirAtoB = rawB.y >= rawA.y ? 1 : -1
          const jogYA = rawA.y + dirAtoB * V_CLEARANCE
          const jogYB = rawB.y - dirAtoB * V_CLEARANCE
          const start = pushOffStart(rawA, { x: rawA.x, y: jogYA }, false, startGap)
          const end = pullBackEnd({ x: rawB.x, y: jogYB }, rawB, false, endGap)
          const CORNER_R = 7
          const r = Math.min(CORNER_R, vertRun / 4 || CORNER_R, Math.abs(laneX - rawA.x) || CORNER_R, Math.abs(rawB.x - laneX) || CORNER_R)
          const signX1 = laneX >= rawA.x ? 1 : -1
          const signY = rawB.y >= rawA.y ? 1 : -1
          const signX2 = rawB.x >= laneX ? 1 : -1
          const c1a = { x: laneX - signX1 * r, y: jogYA }
          const c1b = { x: laneX, y: jogYA + signY * r }
          const c2a = { x: laneX, y: jogYB - signY * r }
          const c2b = { x: laneX + signX2 * r, y: jogYB }
          d = `M${start.x},${start.y} L${rawA.x},${jogYA} L${c1a.x},${c1a.y} Q${laneX},${jogYA} ${c1b.x},${c1b.y} L${c2a.x},${c2a.y} Q${laneX},${jogYB} ${c2b.x},${c2b.y} L${rawB.x},${jogYB} L${end.x},${end.y}`
        } else {
          const curved = !!e.curved
          const a = pushOffStart(rawA, rawB, curved, startGap)
          const b = pullBackEnd(rawA, rawB, curved, endGap)
          d = curved
            ? `M${a.x},${a.y} C${a.x + 36},${a.y} ${b.x + 36},${b.y} ${b.x},${b.y}`
            : `M${a.x},${a.y} L${b.x},${b.y}`
        }
        return (
          <path
            key={e.key} d={d} stroke={e.color} strokeWidth={e.strokeWidth ?? (e.thick ? 3 : 1.75)} fill="none"
            strokeDasharray={e.dashed ? '4 4' : undefined}
            // A round cap adds a small rounded bump extending PAST the path's mathematical
            // endpoint (half the stroke width) — harmless on its own, but on an arrowed edge
            // that bump sits right where the marker's flat back edge is supposed to meet the
            // line, making the join look slightly off/disconnected instead of the line
            // flowing cleanly into the arrowhead. A flat ("butt") cap terminates exactly at
            // the endpoint with no extension, so the arrowhead's back sits flush against it.
            strokeLinecap={e.arrow ? 'butt' : 'round'} strokeLinejoin="round" opacity={e.opacity ?? 1}
            markerEnd={e.arrow ? 'url(#trail-arrow)' : undefined}
          />
        )
      })}
    </svg>
  )
}
