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
// Bumped 10 -> 18 per direct feedback ("make the revisit arcs more varied in how far out they
// go so it's easier to follow") — concurrently-overlapping arcs (each in its own lane) now
// step out ~2x further apart, so a stack of them stays individually traceable instead of
// visually merging. MapView.tsx's gutter reservation mirrors this constant.
export const LANE_SPACING = 18

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
          // Round 9 — Michael gave precise, opposite-direction corrections for the two laned
          // edge types, so both now get their own dedicated virtual-anchor construction (neither
          // goes through pushOffStart/pullBackEnd's diagonal-chord pullback any more, which for
          // the return edge was pulling back along the A→B straight-line CHORD rather than the
          // actual bezier's own vertical-ish approach — a real direction mismatch, not just a
          // magnitude one, whenever `from`/`to` have any real x-difference, exactly the case for
          // a `row:` origin point vs. its target node dot).
          //
          //  - revisit-link (no arrow): was landing OUTSIDE the bullet pair (round 3's anchors
          //    pointed away from the span — top endpoint above the top bullet, bottom endpoint
          //    below the bottom bullet). Flipped INWARD: the higher point's anchor now sits BELOW
          //    it (toward the lower bullet) and the lower point's anchor sits ABOVE it (toward the
          //    higher bullet) — landing inside the span between the two bullets, not past either.
          //  - return (arrow): was landing INSIDE the bullet, overlapping its circle. Anchors now
          //    point OUTWARD — the higher point's anchor sits ABOVE it, the lower point's sits
          //    BELOW it — clearing the bullet's edge instead of cutting into it.
          //  - both: nudged further left (8px, up from revisit-link's old 3px; return had no left
          //    offset at all before) — per direct feedback both were still reading as too far
          //    right.
          //  - round 10 tuning per direct feedback ("[return] arcs are now too far out on both
          //    sides... do in between, prob around the same distance as the [revisit] ones" /
          //    "[revisit] can be shifted a tiny bit outward"): return's outward distance brought
          //    down from 12 to 6 (near revisit-link's distance), revisit-link's inward pull eased
          //    from 5 to 2 (a small nudge back outward from where it was).
          //  - round 11 per direct feedback ("the [return] arcs need the top node moved slightly
          //    down and the bottom node slightly up") — that's INWARD, same direction as
          //    revisit-link now, not outward: return flipped from an outward push to a small
          //    inward pull (its own, smaller-than-revisit-link magnitude, since it was reading as
          //    already close before this nudge).
          const REVISIT_ANCHOR_IN = 2
          const REVISIT_ANCHOR_LEFT = 8
          const RETURN_ANCHOR_IN = 3
          const RETURN_ANCHOR_LEFT = 8
          const aIsHigher = rawA.y <= rawB.y
          const start = e.arrow
            ? { x: rawA.x - RETURN_ANCHOR_LEFT, y: rawA.y + (aIsHigher ? RETURN_ANCHOR_IN : -RETURN_ANCHOR_IN) }
            : { x: rawA.x - REVISIT_ANCHOR_LEFT, y: rawA.y + (aIsHigher ? REVISIT_ANCHOR_IN : -REVISIT_ANCHOR_IN) }
          const end = e.arrow
            ? { x: rawB.x - RETURN_ANCHOR_LEFT, y: rawB.y + (aIsHigher ? -RETURN_ANCHOR_IN : RETURN_ANCHOR_IN) }
            : { x: rawB.x - REVISIT_ANCHOR_LEFT, y: rawB.y + (aIsHigher ? -REVISIT_ANCHOR_IN : REVISIT_ANCHOR_IN) }
          const vertRun = Math.abs(end.y - start.y)
          // How far left of the dot column the curve bulges — scales with vertRun so a return
          // spanning a lot of intervening content swings out further to visibly "go around" it,
          // not just lean slightly left of it. MapView's own gutterWidth reservation
          // (EXTRA_BOW_RESERVE) mirrors this same formula so the reserved scroll room actually
          // covers it.
          // Bumped 85 -> 105 per direct feedback ("shifted to the left a little") — MapView's
          // own EXTRA_BOW_BASE mirrors this constant for its reservation, keep them in sync.
          // Split by arrow/non-arrow per direct feedback ("the [revisit] arcs are too wide now")
          // — the revisit-link backlink (no arrowhead, using the virtual-anchor endpoints above)
          // wants a visibly tighter bow than the branch-return arrow, which keeps its own wider
          // 105/0.45 LINEAR formula unchanged (not asked to shrink, and it's still doing the
          // "swing wide enough to visibly go around the intervening content" job it was tuned
          // for).
          //
          // The first pass at the revisit-link's own numbers (base 44, still linear in vertRun)
          // didn't actually look any narrower for a longer revisit — confirmed from Michael's own
          // logged geometry: vertRun 202/298/878 → extraBow 75/96/224. A flat base term is a small
          // fraction of the total once vertRun gets large (base=44 vs. ~193px from the linear
          // term alone at vertRun=878) — shrinking ONLY the base barely moves the needle for any
          // revisit spanning real vertical distance, which is exactly what he reported. Switching
          // the GROWING part from linear-in-vertRun to sqrt(vertRun) (a much shallower curve at
          // large inputs) plus a hard ceiling fixes all three logged cases at once, not just the
          // short ones — sqrt(142)≈12, sqrt(238)≈15, sqrt(818)≈29, so even the 878 case's growth
          // term is only ~3x the 202 case's instead of ~6x under the old linear formula.
          // scale bumped 3 -> 4.5 and base eased 30 -> 26 per direct feedback ("more varied in
          // how far out they go") — a long revisit now bows visibly further than a short one
          // (the range between them roughly doubles) instead of the old near-flat sqrt curve.
          // Keep MapView's overlayBowFor mirror (base/scale/cap) in sync.
          const REVISIT_BOW_BASE = 26
          const REVISIT_BOW_SQRT_SCALE = 4.5
          const REVISIT_BOW_CAP = 100
          // Round 7: "the arcs still didn't change at all" turned out to (at least partly) mean
          // the ARROWED `return:` edges too — round 6's sqrt/cap rework only ever touched the
          // non-arrow revisit-link edge; `return:` was still running the original, unbounded
          // LINEAR formula (105 base, 0.45/px), which is exactly why a long-vertical-span return
          // arc would still balloon out just as far as it always did. Same sub-linear treatment
          // here, sized up from the revisit-link's own constants (not identical — a return arc is
          // still meant to read as more prominent, per the "swing wide enough to visibly go
          // around it" tuning goal that hasn't changed) so the two edge types stay visually
          // distinct rather than converging on one look.
          // scale bumped 6 -> 8 (same "more varied" feedback); cap held at 180.
          const RETURN_BOW_BASE = 66
          const RETURN_BOW_SQRT_SCALE = 8
          const RETURN_BOW_CAP = 180
          const EXTRA_BOW_BASE = e.arrow ? RETURN_BOW_BASE : REVISIT_BOW_BASE
          const EXTRA_BOW_SCALE = e.arrow ? RETURN_BOW_SQRT_SCALE : REVISIT_BOW_SQRT_SCALE
          const extraBowCap = e.arrow ? RETURN_BOW_CAP : REVISIT_BOW_CAP
          const extraBow = Math.min(extraBowCap, EXTRA_BOW_BASE + EXTRA_BOW_SCALE * Math.sqrt(Math.max(0, vertRun - 60)))
          // Sanity check against Michael's actual logged vertRun values (all narrower than
          // before, both edge types):
          //   revisit-link  vertRun=202 → 30 + 3·√142 ≈ 66   (was 75, old linear)
          //                 vertRun=298 → 30 + 3·√238 ≈ 76   (was 96)
          //                 vertRun=878 → 30 + 3·√818 ≈ 116 → capped to 85   (was 224)
          //   return        vertRun=202 → 70 + 6·√142 ≈ 141  (was 169, old linear)
          //                 vertRun=298 → 70 + 6·√238 ≈ 163  (was 212)
          //                 vertRun=878 → 70 + 6·√818 ≈ 242 → capped to 180 (was 473)
          // Floor is a last-resort safety net only — with the new construction above, laneX
          // going small just makes for a narrower (not broken) bulge; nothing here can loop.
          const laneX = Math.max(24, baseLaneX - extraBow)
          d = `M${start.x},${start.y} C${laneX},${start.y} ${laneX},${end.y} ${end.x},${end.y}`
          if (window.__bereanTrailDebug) {
            // Per direct feedback ("the revisit arc width fix isn't visible at all") — logs
            // exactly which branch this edge resolved to (arrow vs non-arrow) and the actual
            // EXTRA_BOW_BASE/SCALE values used, alongside the geometry those values produced, so
            // it's directly checkable whether: (a) this code path is even being hit for the edge
            // in question, (b) `edgeType`/`arrow` classifies it the way it's expected to
            // (`revisit-link:` should show arrow:false/edgeType containing "revisit-link", the
            // narrow 44/0.22 constants; `return:` should show arrow:true, the wide 105/0.45
            // ones), and (c) the resulting extraBow/laneX actually reflects that — every field
            // needed to settle "is my fix even running" without guessing.
            const summary = {
              key: e.key,
              edgeType: e.key.split(':')[0],
              arrow: !!e.arrow,
              extraBowBase: EXTRA_BOW_BASE, extraBowScale: EXTRA_BOW_SCALE,
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
