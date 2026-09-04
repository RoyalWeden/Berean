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
  /** More concurrent laned edges than the gutter has lanes — this one shares the last lane and
   *  renders faintly, coming back to full strength only when hovered. Never dropped: a busy
   *  session still shows every backlink, it just doesn't widen the view to do it. */
  overflowLane?: boolean
  /** Short text drawn along a laned edge (the verse pair tying its two ends together, e.g.
   *  "Rev 12:6 ⇄ Hos 2:14") so a backlink says WHY it exists without being traced by eye.
   *  Truncated to the gutter's own width — it may never widen the layout. */
  label?: string
}

// Shared with trailGraph.ts, which sizes the reserved gutter column from these — a lane routes
// at `gutterRightEdge - LANE_RIGHT_INSET - lane * LANE_SPACING` (see the `d` construction below),
// so the column must be at least `GUTTER_BASE + (MAX_GUTTER_LANES - 1) * LANE_SPACING` wide to
// fit every lane. All three are now FIXED: the gutter used to be sized from the old bezier's
// vertical-run-dependent bow, which made the whole view grow wider the more revisits a session
// accumulated. It is a constant-width column now, and the orthogonal lane routing below stays
// inside it by construction rather than by keeping two tuning formulas in sync by hand.
export const GUTTER_BASE = 30
export const LANE_SPACING = 18
/** How far left of the gutter's right edge lane 0 runs. */
export const LANE_RIGHT_INSET = 14

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
  // Which overflow-lane edge is currently hovered — see the overflow handling in the edge map
  // below. Only ever set by an overflow edge's own hit-target, so a normal session never
  // re-renders for it.
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null)
  // Dedupe the missing-endpoint warning below — without this it re-fires identically on EVERY
  // render forever for any edge whose endpoint is legitimately not currently mounted (most
  // commonly: a spine edge touching a node hidden inside a collapsed "bounced Nx" cluster,
  // which only renders its first/last node — see NodeClusterGroup in MapView.tsx). That's
  // expected, not a bug, but logging it every render made the console useless for spotting a
  // REAL missing-endpoint case. Keyed by edge key + which side was missing, so a genuine fix
  // (endpoint starts resolving) or a genuine regression (a previously-fine edge goes missing)
  // both still surface — only the identical-every-render spam is suppressed.
  // Map, not a Set — per direct feedback ("right-click STILL hides connection lines... it comes
  // back when I switch sessions and back"), a plain Set that only ever ADDS entries can mask a
  // GENUINE regression: once `${key}:false:true}` (this edge's `to` missing) has fired once, it
  // never fires again even if the edge recovers (goes fully-present) and THEN goes missing again
  // later in the very same session — exactly the "state that only resets on a full remount"
  // shape the report described. Recording only "is this edge CURRENTLY missing" (cleared the
  // moment it resolves) instead of "has this exact combo ever been warned about" means a later,
  // real recurrence of the same edge going missing always re-logs.
  const missingRef = useRef<Map<string, string>>(new Map())
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
    // Hidden right now (an inactive tab/panel toggled to display:none, or a background window
    // whose renderer isn't laying out) — every getBoundingClientRect() here comes back all
    // zeros. Measuring anyway would collapse every edge onto the origin, so the whole overlay
    // draws blank until some LATER event (a scroll, a resize) happens to run recompute() again
    // while visible — exactly the "outline disappears until I start scrolling after switching
    // tabs" report. Bail without touching coords so the last good positions stay put; the
    // visibilitychange / IntersectionObserver hooks below re-run this the moment it's shown.
    if (cRect.width === 0 && cRect.height === 0) return
    const next = new Map<string, TrailPoint>()
    pointsRef.current.forEach((el, key) => {
      const r = el.getBoundingClientRect()
      next.set(key, {
        x: (r.left + r.width / 2 - cRect.left) / zoom,
        y: (r.top + r.height / 2 - cRect.top) / zoom,
      })
    })
    setCoords((prev) => {
      // THE FIX for "right-click hides every connector line" (100%-reproducible per direct
      // feedback, confirmed via the debug snapshot log below: pointsRegistered stayed at 10 the
      // whole time — the DOM points never actually left the registry — while coordsResolved (this
      // very state) dropped to 0 the instant the context menu opened). `registerPoint(key)` is
      // called fresh inline in JSX on every render (`ref={registerPoint(pointKey)}`), which hands
      // React a NEW ref-callback function identity every time — and a changed ref identity makes
      // React detach the OLD callback (firing it with `null`, which deletes the entry from
      // pointsRef) and attach the NEW one (firing it with the element, re-adding the entry) as
      // TWO SEPARATE steps of the SAME commit, not one atomic swap. Opening the context menu
      // triggers exactly the kind of tree-wide re-render (via `menu` state) that hits every
      // single spine row in one commit, so recompute() — this component's OWN layout effect, with
      // no dependency array, so it can run at any point relative to that churn — can catch
      // pointsRef mid-detach, see EVERY point momentarily gone, and (before this fix) would
      // happily replace a fully-populated coords map with a fully-EMPTY one for that one tick,
      // rendering the whole overlay blank until the next recompute happened to catch it fully
      // repopulated again — which, per Michael's report, evidently never reliably occurred while
      // the menu stayed open, only on some later unrelated event.
      //
      // The fix: never let a recompute regress a POPULATED coords map down to nothing. A
      // genuinely empty session (no nodes at all) is unaffected — next and prev both start empty,
      // so there's nothing to regress from. This is a targeted invariant on the SYMPTOM (an empty
      // registry snapshot must never blank out real, already-known positions) that holds
      // regardless of the exact commit-ordering quirk that produces the transient empty read —
      // the very next recompute (this effect reruns after every render) picks the real,
      // repopulated positions back up once the churn settles.
      if (next.size === 0 && prev.size > 0) return prev
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
    // Re-measure the moment this overlay becomes visible again. Switching away from the Study
    // Trail tab (react-mosaic toggles the inactive panel to display:none) or backgrounding its
    // window freezes layout at all-zero rects; nothing re-renders on the way back, so without
    // these the edges stayed blank until an unrelated scroll/resize nudged recompute(). An
    // IntersectionObserver covers the display:none tab case; visibilitychange / focus / pageshow
    // cover the separate-window case; the double rAF lets layout settle first after a show.
    const nudge = () => { requestAnimationFrame(() => requestAnimationFrame(recompute)) }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) nudge()
    })
    io.observe(container)
    document.addEventListener('visibilitychange', nudge)
    window.addEventListener('focus', nudge)
    window.addEventListener('pageshow', nudge)
    return () => {
      ro.disconnect(); io.disconnect()
      window.removeEventListener('resize', recompute)
      document.removeEventListener('visibilitychange', nudge)
      window.removeEventListener('focus', nudge)
      window.removeEventListener('pageshow', nudge)
    }
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
            const warnKey = `${!!rawA}:${!!rawB}`
            if (missingRef.current.get(e.key) !== warnKey) {
              missingRef.current.set(e.key, warnKey)
              console.warn('[TrailDebug] edge endpoint missing — not drawn', { key: e.key, from: e.from, to: e.to, hasFrom: !!rawA, hasTo: !!rawB })
            }
          }
          return null
        }
        // Resolved — clear any recorded "missing" state for this edge so a LATER regression
        // (this same edge going missing again after having been fine) logs again instead of
        // staying silently suppressed by an earlier warning from earlier in the session.
        if (window.__bereanTrailDebug && missingRef.current.has(e.key)) missingRef.current.delete(e.key)
        // Only actually reached by NON-laned edges now (round 9 moved BOTH laned edge types —
        // revisit-link and return — onto their own dedicated virtual-anchor constructions below,
        // neither of which uses this gap/pullback approach any more; see that branch's own
        // comment for why the return edge in particular needed to move off of it, not just get a
        // bigger number here).
        const startGap = radiusFor(e.from) + (e.lane != null ? 1 : ENDPOINT_GAP)
        const endGap = radiusFor(e.to) + (e.arrow ? (e.lane != null ? ENDPOINT_GAP + 3 : ENDPOINT_GAP + 2) : ENDPOINT_GAP)

        let d: string
        let laneGeom: { laneX: number; topY: number; bottomY: number } | null = null
        if (e.lane != null) {
          // REWRITTEN for the "never scroll horizontally" constraint. The previous construction
          // was a cubic bezier whose belly bowed left by `extraBow` — a value that GREW with how
          // much vertical distance the edge had to clear. MapView then had to reserve gutter
          // width to match, so every additional long-range revisit pushed the whole spine
          // further right and eventually forced a horizontal scrollbar (Michael: "i dont want to
          // have to horizontally scroll at all"). Worse, the two sides mirrored the same tuning
          // constants by hand and repeatedly drifted apart.
          //
          // The replacement is a plain ORTHOGONAL route confined to its own lane: leave the
          // source dot horizontally, turn down (or up) the lane's fixed x, run vertically past
          // whatever content is in between, then turn back in to the target dot. Rounded corners
          // keep it from reading as harsh. Because the lane's x is a constant derived only from
          // the lane index, the drawn width is bounded no matter how far apart the endpoints are
          // — the gutter is a fixed 3-lane column and nothing can ever exceed it.
          const gutter = coords.get('gutter:x')
          // The registered point is the spacer's CENTER and its left edge sits at containerRef's
          // own x=0, so the spacer's RIGHT edge is at x*2.
          const gutterRightEdge = gutter ? gutter.x * 2 : Math.min(rawA.x, rawB.x)
          const laneX = Math.max(4, gutterRightEdge - LANE_RIGHT_INSET - e.lane * LANE_SPACING)
          const sx = rawA.x - (radiusFor(e.from) + ENDPOINT_GAP)
          const ex = rawB.x - (radiusFor(e.to) + (e.arrow ? ENDPOINT_GAP + 2 : ENDPOINT_GAP))
          const sy = rawA.y
          const ey = rawB.y
          const dirY = Math.sign(ey - sy) || 1
          // Corner radius has to shrink for a short edge, otherwise the two arcs overlap and the
          // path folds back on itself — clamped against both the vertical run and the horizontal
          // reach so the route degrades gracefully to a near-square corner instead of breaking.
          const r = Math.max(0, Math.min(8, Math.abs(ey - sy) / 2, (Math.min(sx, ex) - laneX) / 2))
          d = r > 0.5
            ? `M${sx},${sy} L${laneX + r},${sy} Q${laneX},${sy} ${laneX},${sy + dirY * r} L${laneX},${ey - dirY * r} Q${laneX},${ey} ${laneX + r},${ey} L${ex},${ey}`
            : `M${sx},${sy} L${laneX},${sy} L${laneX},${ey} L${ex},${ey}`
          laneGeom = { laneX, topY: Math.min(sy, ey), bottomY: Math.max(sy, ey) }
          if (window.__bereanTrailDebug) {
            const summary = {
              key: e.key, edgeType: e.key.split(':')[0], arrow: !!e.arrow, lane: e.lane,
              overflow: !!e.overflowLane,
              gutterRightEdge: Math.round(gutterRightEdge), laneX: Math.round(laneX),
              vertRun: Math.round(Math.abs(ey - sy)), d,
            }
            const logStr = JSON.stringify(summary)
            if (lastArcLogRef.current.get(e.key) !== logStr) {
              lastArcLogRef.current.set(e.key, logStr)
              console.log('[TrailDebug] lane route', summary)
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
        // An overflow-lane edge (more concurrent backlinks than the gutter has lanes) is drawn
        // faintly and comes back to full strength only while either of its endpoints is hovered —
        // the alternative, widening the gutter to fit them all, is exactly the horizontal growth
        // this rewrite exists to eliminate.
        const dimmed = !!e.overflowLane && hoveredEdgeKey !== e.key
        return (
          <g key={e.key}>
          {laneGeom && e.label && (
            // Drawn along the lane, rotated to run with it, and hard-clipped to the gutter's own
            // width so a long verse pair can never push the layout wider.
            <text
              x={-(laneGeom.topY + laneGeom.bottomY) / 2} y={laneGeom.laneX - 3}
              transform="rotate(-90)" textAnchor="middle"
              style={{ fontSize: 8.5, fill: 'rgb(var(--color-text-muted))', opacity: dimmed ? 0.25 : 0.7, pointerEvents: 'none' }}
            >
              {e.label.length > 26 ? `${e.label.slice(0, 25)}…` : e.label}
            </text>
          )}
          <path
            d={d} stroke={e.color} strokeWidth={e.strokeWidth ?? (e.thick ? 3 : 1.75)} fill="none"
            strokeDasharray={e.dashed ? '4 4' : undefined}
            // A round cap adds a small rounded bump extending PAST the path's mathematical
            // endpoint (half the stroke width) — harmless on its own, but on an arrowed edge
            // that bump sits right where the marker's flat back edge is supposed to meet the
            // line, making the join look slightly off/disconnected instead of the line
            // flowing cleanly into the arrowhead. A flat ("butt") cap terminates exactly at
            // the endpoint with no extension, so the arrowhead's back sits flush against it.
            strokeLinecap={e.arrow ? 'butt' : 'round'} strokeLinejoin="round" opacity={(e.opacity ?? 1) * (dimmed ? 0.45 : 1)}
            markerEnd={e.arrow ? 'url(#trail-arrow)' : undefined}
          />
          {/* An invisible fat stroke over the same path — the visible hairline is far too thin to
              hover, and an overflow edge needs a way to be brought forward. pointerEvents is
              enabled only for this one, the SVG itself stays click-through. */}
          {e.overflowLane && (
            <path
              d={d} stroke="transparent" strokeWidth={10} fill="none" style={{ pointerEvents: 'stroke' }}
              onMouseEnter={() => setHoveredEdgeKey(e.key)} onMouseLeave={() => setHoveredEdgeKey((k) => (k === e.key ? null : k))}
            />
          )}
          </g>
        )
      })}
    </svg>
  )
}
