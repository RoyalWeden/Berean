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
// GUTTER_BASE raised 16 -> 30 per direct feedback on the left-gutter revisit/return arcs
// ("make sure that it is going past the main spine bullet too, so the arc will need to be
// curved more") — the old 16px reservation put lane 0 barely left of the dot column at all,
// so the curve's belly (at 55% reach, see the bezier construction below) never visibly cleared
// the bullets it was supposed to arc around.
export const GUTTER_BASE = 30
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
 *  tangent at each end is VERTICAL (not horizontal — see the `d` build below, which is what a
 *  branch row reconverging into the main spine should look like: pointing down out of the
 *  bullet, curving over, then pointing down into the target, rather than shooting sideways out
 *  of the bullet first), so the pullback is a pure y-shift in the direction from A to B;
 *  straight edges pull back along the literal a→b direction. */
function pullBackEnd(from: TrailPoint, to: TrailPoint, curved: boolean, dist: number): TrailPoint {
  if (curved) return { x: to.x, y: to.y - Math.sign(to.y - from.y || 1) * dist }
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return { x: to.x - (dx / len) * dist, y: to.y - (dy / len) * dist }
}
/** Same idea for the START point — the path begins slightly clear of the source dot too,
 *  rather than dead-center inside it. */
function pushOffStart(from: TrailPoint, to: TrailPoint, curved: boolean, dist: number): TrailPoint {
  if (curved) return { x: from.x, y: from.y + Math.sign(to.y - from.y || 1) * dist }
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
  // Dedupe the missing-endpoint warning below — without this it re-fires identically on EVERY
  // render forever for any edge whose endpoint is legitimately not currently mounted (most
  // commonly: a spine edge touching a node hidden inside a collapsed "bounced Nx" cluster,
  // which only renders its first/last node — see NodeClusterGroup in MapView.tsx). That's
  // expected, not a bug, but logging it every render made the console useless for spotting a
  // REAL missing-endpoint case. Keyed by edge key + which side was missing, so a genuine fix
  // (endpoint starts resolving) or a genuine regression (a previously-fine edge goes missing)
  // both still surface — only the identical-every-render spam is suppressed.
  const warnedRef = useRef<Set<string>>(new Set())
  // Per direct feedback ("can you create some logs for the arc, its still having the same
  // issues") — logs every laned (revisit/return) edge's actual computed geometry, keyed and
  // deduped by edge key + a rounded summary of the values so it only re-logs when something
  // ACTUALLY changes (a resize, a new edge, real values shifting) rather than every render.
  // Reading gutterX/gutterRightEdge/extraBow/laneX/vertRun straight from here settles definitively
  // whether the constants bumped this round (EXIT_RUN, EXTRA_BOW_BASE, the laneX floor) are
  // actually being used with the values expected, or whether stale code/props are still in play.
  const lastArcLogRef = useRef<Map<string, string>>(new Map())

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
        if (!rawA || !rawB) {
          // Directly diagnoses "both ends of the connection is not on the two bullets it
          // should be" — a missing point here means this edge's from/to key never got
          // registered (or was unregistered/stale) at the time coords were last measured, so
          // it silently draws nothing instead of landing on the wrong spot. Gated behind the
          // same __bereanTrailDebug flag as Study Trail's other diagnostic logging — set
          // `window.__bereanTrailDebug = true` in devtools (persists across restarts; see
          // main.tsx's definePersistentDebugFlag) to turn it on.
          if (window.__bereanTrailDebug) {
            const warnKey = `${e.key}:${!!rawA}:${!!rawB}`
            if (!warnedRef.current.has(warnKey)) {
              warnedRef.current.add(warnKey)
              console.warn('[TrailDebug] edge endpoint missing — not drawn', { key: e.key, from: e.from, to: e.to, hasFrom: !!rawA, hasTo: !!rawB })
            }
          }
          return null
        }
        // Trimmed 1 -> ... per direct feedback ("the endpoints of the arc are still off... the
        // bottom endpoint can be shifted down") — the START side of a laned edge (the revisit/
        // return dot itself) had no special-casing at all, just the generic gap every edge uses;
        // shaving it slightly lets a laned edge's line reach a little further toward its own
        // source dot before the small clearance kicks in.
        const startGap = radiusFor(e.from) + (e.lane != null ? 1 : ENDPOINT_GAP)
        // A laned+arrowed edge (a branch's return arrow) needs SOME extra clearance so the
        // arrowhead reads as a distinct triangle rather than overlapping the dot — but the old
        // +9 was tuned generously and, per direct feedback this round ("the endpoints of the arc
        // are still off... it needs to extend up more"), reads as landing well short of the
        // actual dot rather than pointing at it: radiusFor(node)=5 + ENDPOINT_GAP(3) + 9 = 17px
        // of dead space between the arrow tip and the dot's own center for a 9px-wide dot.
        // Trimmed to +3 (11px total) — still enough separation for the arrowhead to read as its
        // own shape, not so much that the curve visibly falls short of the target.
        const endGap = radiusFor(e.to) + (e.arrow ? (e.lane != null ? ENDPOINT_GAP + 3 : ENDPOINT_GAP + 2) : ENDPOINT_GAP)

        let d: string
        if (e.lane != null) {
          // REWRITTEN FROM SCRATCH per direct feedback ("both of those are still not fixed...
          // maybe for the revisit arc, you just recreate the entire arc for that from scratch")
          // after several rounds of tuning a "toward/away from the other end" Y-offset on the
          // control points kept producing either a curve that fell visibly short of one dot
          // (the original, safe direction) or a closed loop that floated apart from both dots
          // entirely (an attempt at the opposite direction) — that whole family of "offset the
          // control point in Y by some tunable amount" was the wrong lever regardless of which
          // way it pointed or how big it was.
          //
          // New construction, deliberately as simple as it can be: a single cubic bezier whose
          // TWO CONTROL POINTS SIT EXACTLY AT THEIR OWN ENDPOINT'S OWN Y — control1 = (laneX,
          // start.y), control2 = (laneX, end.y). This is mathematically guaranteed to never
          // overshoot past start or end (a cubic bezier's points are a weighted average of its
          // four control points; with both middle points already inside the Y-range
          // [start.y, end.y], the whole curve's Y stays inside that range too) — so it can never
          // degenerate into a loop no matter how large the horizontal reach (laneX) is, and it
          // reaches EXACTLY from start's height to end's height by construction, not by tuning
          // some separate softening constant to approximate that span — solving "coming up
          // short" the same move that also makes "turning into a circle" structurally
          // impossible, instead of trading one for the other.
          const gutter = coords.get('gutter:x')
          // Anchored to the spacer's own RIGHT edge (gutter.x*2 — the registered point is the
          // spacer's CENTER, and its left edge sits at containerRef's own x=0), not its center.
          const gutterRightEdge = gutter ? gutter.x * 2 : 0
          const baseLaneX = gutter ? gutterRightEdge - e.lane * LANE_SPACING : Math.max(rawA.x, rawB.x) + 40
          const start = pushOffStart(rawA, rawB, false, startGap)
          const end = pullBackEnd(rawA, rawB, false, endGap)
          const vertRun = Math.abs(end.y - start.y)
          // How far left of the dot column the curve bulges — scales with vertRun so a return
          // spanning a lot of intervening content swings out further to visibly "go around" it,
          // not just lean slightly left of it. MapView's own gutterWidth reservation
          // (EXTRA_BOW_RESERVE) mirrors this same formula so the reserved scroll room actually
          // covers it.
          // Bumped 85 -> 105 per direct feedback ("shifted to the left a little") — MapView's
          // own EXTRA_BOW_BASE mirrors this constant for its reservation, keep them in sync.
          const EXTRA_BOW_BASE = 105
          const extraBow = EXTRA_BOW_BASE + Math.max(0, vertRun - 60) * 0.45
          // Floor is a last-resort safety net only — with the new construction above, laneX
          // going small just makes for a narrower (not broken) bulge; nothing here can loop.
          const laneX = Math.max(24, baseLaneX - extraBow)
          d = `M${start.x},${start.y} C${laneX},${start.y} ${laneX},${end.y} ${end.x},${end.y}`
          if (window.__bereanTrailDebug) {
            const summary = {
              key: e.key,
              gutterRightEdge: Math.round(gutterRightEdge), baseLaneX: Math.round(baseLaneX),
              vertRun: Math.round(vertRun), extraBow: Math.round(extraBow), laneX: Math.round(laneX),
              clampedToFloor: laneX === 24,
              rawA: { x: Math.round(rawA.x), y: Math.round(rawA.y) }, rawB: { x: Math.round(rawB.x), y: Math.round(rawB.y) },
              start: { x: Math.round(start.x), y: Math.round(start.y) }, end: { x: Math.round(end.x), y: Math.round(end.y) },
              d,
            }
            const logStr = JSON.stringify(summary)
            if (lastArcLogRef.current.get(e.key) !== logStr) {
              lastArcLogRef.current.set(e.key, logStr)
              console.log('[TrailDebug] arc geometry', summary)
            }
          }
        } else {
          const curved = !!e.curved
          const a = pushOffStart(rawA, rawB, curved, startGap)
          const b = pullBackEnd(rawA, rawB, curved, endGap)
          // Vertical control-point offsets (not the old +36 in x) — per direct feedback
          // ("start the arrow line from below the branch bullet instead of the right side"),
          // the curve should point straight down (or up) out of the source bullet and into the
          // target, bowing sideways only as much as their x-difference actually requires.
          const dir = Math.sign(b.y - a.y || 1)
          d = curved
            ? `M${a.x},${a.y} C${a.x},${a.y + dir * 28} ${b.x},${b.y - dir * 28} ${b.x},${b.y}`
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
