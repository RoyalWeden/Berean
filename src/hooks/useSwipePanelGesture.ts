import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Two-finger trackpad swipe to open/close a side panel — a from-scratch rebuild after the
 * previous inline version (BiblePanel.tsx) turned out clunky under real use. Design, agreed
 * with the user up front rather than guessed at:
 *
 *  - Recognized anywhere over the panel area (not edge-restricted).
 *  - Live drag, decoupled from raw wheel-tick timing: the underlying target position
 *    (dragFracRef) is exact and updates synchronously the instant a wheel tick arrives — no
 *    lag there at all. What's actually RENDERED (dragFrac) is a per-animation-frame ease
 *    toward that target (see DISPLAY_LERP below), run by a loop that ticks every frame
 *    regardless of whether a new wheel event has arrived yet. This is deliberately
 *    different from an earlier, reverted attempt at smoothing (a fixed-duration CSS tween
 *    restarted per wheel tick): that approach committed to animating toward whatever target
 *    was current AT TICK TIME for a fixed duration, so between sparse/bursty real ticks the
 *    panel would still be mid-tween toward an already-stale target — visibly "chasing" and,
 *    on a quick reversal, fighting its way back through that outgoing tween first. A
 *    continuous per-frame ease toward a continuously-fresh target has no such commitment:
 *    every single frame re-reads whatever the target currently is, so a reversal is picked
 *    up on the very next frame (~16ms), it just approaches smoothly rather than snapping.
 *    Real trackpad tick delivery is itself irregular — gaps between ticks widen and narrow
 *    as swipe speed changes — which is what made a tick-driven-only update (even batched to
 *    one React commit per frame) still visibly freeze/jump between ticks; running the ease
 *    every frame independent of tick arrival is what actually fixes that.
 *  - A fast flick commits immediately regardless of how far it's traveled; a slow/deliberate
 *    drag is decided by whether it crossed the halfway point.
 *  - Several short strokes (swipe, pause, swipe again) accumulate toward the same open/close
 *    decision instead of each one restarting from scratch — pausing HOLDS the current
 *    position, only committing after a real finger-lift (native gesture-end IPC when
 *    available) or, as a fallback, a period of continued silence.
 *  - A bit of rubber-band resistance past fully open/closed (bounded asymptotically, never
 *    more than a small extra fraction of travel) rather than a hard clamp — settles back to
 *    the real limit the moment the gesture commits.
 */

export interface SwipePanelGestureOptions {
  /** Master on/off switch — Settings → swipePanelGestureEnabled. */
  enabled: boolean
  /** The panel's current committed open/closed state. */
  isOpen: boolean
  /** Called once a gesture (or a fast flick) decides the panel should flip open/closed. */
  onCommit: (open: boolean) => void
}

// ── Tunables ──────────────────────────────────────────────────────────────────
// Silence → hold position, no decision yet (lets a paused multi-stroke swipe resume).
const PAUSE_MS = 180
// Further silence after a pause → commit, ONLY used as a fallback for when the real
// finger-lift IPC signal (window.app.onTrackpadSwipeEnd) doesn't arrive.
const COMMIT_FALLBACK_MS = 550
// Physical trackpad px for a full 0→1 swipe — "medium" sensitivity: a deliberate stroke,
// not a hair-trigger flick, not a full-arm swipe either.
const SWIPE_REFERENCE_PX = 160
// px/ms — a stroke ending faster than this commits by direction regardless of distance.
const FAST_FLICK_VELOCITY = 0.5
// Rubber-band resistance past the 0/1 limits — asymptotically capped at this extra
// fraction of travel (e.g. 0.12 = at most 12% further than fully open/closed, no matter
// how hard the overswipe), using the same damping curve as iOS's own scroll bounce.
const RUBBER_BAND_MAX_OVERSHOOT = 0.12
const RUBBER_BAND_CONSTANT = 0.55

function rubberBand(overflow: number): number {
  const sign = overflow < 0 ? -1 : 1
  const mag = Math.abs(overflow)
  return sign * (mag * RUBBER_BAND_MAX_OVERSHOOT * RUBBER_BAND_CONSTANT) / (RUBBER_BAND_MAX_OVERSHOOT + RUBBER_BAND_CONSTANT * mag)
}

function applyRubberBand(rawFrac: number): number {
  if (rawFrac < 0) return rubberBand(rawFrac)
  if (rawFrac > 1) return 1 + rubberBand(rawFrac - 1)
  return rawFrac
}

interface SessionState {
  segmentStartFrac: number
  accumDeltaX: number
  lastTime: number
  recentTicks: Array<{ dx: number; dt: number }>
}

// How much of the remaining gap to the raw target the display value closes per animation
// frame — the actual fix for "choppy when my speed changes." Batching to one React commit
// per frame (the previous approach) only helps when wheel ticks arrive faster than the
// display refreshes; real trackpad ticks are BURSTY — gaps between them widen and narrow
// as swipe speed changes, so a display that only updates ON a tick still visibly freezes
// during a gap and jumps on the next one. This loop runs every frame regardless of whether
// a new tick has arrived, continuously easing the displayed value toward whatever the raw
// (exact, unsmoothed) target currently is — decoupling the visual frame rate from the
// input event rate entirely. 0.35 closes ~92% of any gap within ~100ms (6 frames), which
// is short enough to still read as "moving with my fingers" while smoothing over the gaps.
const DISPLAY_LERP = 0.35
// Stop the loop once within this fraction of the target — avoids running an idle rAF loop
// for the ~550ms COMMIT_FALLBACK_MS window after every pause once it's already converged.
const CONVERGED_EPSILON = 0.001

export function useSwipePanelGesture({ enabled, isOpen, onCommit }: SwipePanelGestureOptions) {
  // The RAW, exact position implied by accumulated wheel delta (+ rubber-banding) — used
  // for segment-seeding math and the final commit decision. Not what's rendered directly.
  // null = no gesture in progress.
  const dragFracRef = useRef<number | null>(null)
  // The SMOOTHED, rendered value — continuously eased toward dragFracRef by the loop below.
  // This is what actually reaches the component via the `dragFrac` return value.
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const displayFracRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const sessionRef = useRef<SessionState | null>(null)
  const lastVelocityRef = useRef(0)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rafIdRef = useRef<number | null>(null)
  const stopDisplayLoop = useCallback(() => {
    if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
  }, [])
  const startDisplayLoop = useCallback(() => {
    if (rafIdRef.current !== null) return // already running
    const step = () => {
      const target = dragFracRef.current
      if (target === null) { rafIdRef.current = null; return }
      const cur = displayFracRef.current ?? target
      const gap = target - cur
      if (Math.abs(gap) < CONVERGED_EPSILON) {
        displayFracRef.current = target
        setDragFrac(target)
        rafIdRef.current = null // converged — next wheel tick (new target) restarts the loop
        return
      }
      const next = cur + gap * DISPLAY_LERP
      displayFracRef.current = next
      setDragFrac(next)
      rafIdRef.current = requestAnimationFrame(step)
    }
    rafIdRef.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => stopDisplayLoop, [stopDisplayLoop])

  const clearTimers = useCallback(() => {
    if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null }
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
  }, [])

  // The actual decision point — position + smoothed velocity → open or closed. Ends the
  // whole gesture session: dragFracRef resets to null (display falls back to isOpen) and no
  // further segment can silently resume it.
  const commit = useCallback(() => {
    clearTimers()
    sessionRef.current = null
    stopDisplayLoop()
    displayFracRef.current = null
    const rest = dragFracRef.current
    dragFracRef.current = null
    setDragFrac(null)
    setIsDragging(false)
    if (rest === null) return // no session was active — nothing to decide
    const fastFlick = Math.abs(lastVelocityRef.current) > FAST_FLICK_VELOCITY
    const clamped = Math.max(0, Math.min(1, rest))
    const shouldOpen = fastFlick ? lastVelocityRef.current > 0 : clamped < 0.5
    if (shouldOpen !== isOpenRef.current) onCommitRef.current(shouldOpen)
  }, [clearTimers, stopDisplayLoop])
  const commitRef = useRef(commit)
  commitRef.current = commit

  // Silence → HOLD (not commit). Panel stays exactly where it visually is; only ends the
  // current segment's tracking so the next tick starts a fresh one seeded from here — this
  // is what lets several short strokes accumulate instead of each restarting from scratch.
  // Schedules the fallback commit timer in case the real gesture-end IPC signal never fires.
  const pause = useCallback(() => {
    sessionRef.current = null
    setIsDragging(false)
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => commitRef.current(), COMMIT_FALLBACK_MS)
  }, [])
  const pauseRef = useRef(pause)
  pauseRef.current = pause

  // Real trackpad finger-down/up, from Electron's main process (macOS NSEventPhase-driven).
  // Begin defensively cancels a stale pending fallback commit; End commits immediately
  // rather than waiting out COMMIT_FALLBACK_MS. Optional-chained since preload.ts changes
  // need a full Electron restart to take effect — a renderer that hot-reloaded without one
  // just falls back to the timeout alone, same as if these signals never existed.
  useEffect(() => {
    window.app.onTrackpadSwipeBegin?.(() => {
      if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
    })
    window.app.onTrackpadSwipeEnd?.(() => {
      if (sessionRef.current || dragFracRef.current !== null) commitRef.current()
    })
  }, [])

  // Stable (never recreated) wheel handler — reads only through refs, safe to attach once
  // per DOM node without re-running on every render.
  const onWheelRef = useRef((e: WheelEvent) => {
    if (!enabledRef.current) return
    // Real two-finger horizontal swipe only: pinch-zoom sets ctrlKey true, and a
    // vertical-dominant wheel event is ordinary scrolling — the min-magnitude and 1.5x-
    // ratio margins are what make vertical scrolling reliably fall through untouched
    // (a plain deltaX > deltaY only required horizontal movement to be barely larger,
    // which false-triggered on the diagonal jitter of an ordinary vertical scroll).
    if (e.ctrlKey) return
    const absX = Math.abs(e.deltaX)
    const absY = Math.abs(e.deltaY)
    if (absX < 4 || absX <= absY * 1.5) return

    e.preventDefault()
    setIsDragging(true)
    const now = performance.now()
    if (!sessionRef.current) {
      // Seed from wherever the panel is CURRENTLY resting (mid-pause from an earlier
      // stroke), falling back to the committed isOpen boolean only when no session is
      // in progress at all.
      const segmentStartFrac = dragFracRef.current ?? (isOpenRef.current ? 0 : 1)
      sessionRef.current = { segmentStartFrac, accumDeltaX: 0, lastTime: now, recentTicks: [] }
    }
    const s = sessionRef.current
    const dt = Math.max(1, now - s.lastTime)
    s.lastTime = now
    s.accumDeltaX += e.deltaX

    // Smoothed velocity over a short rolling window (not just the single most recent
    // tick) — an unsmoothed last-tick-only read made the fast-flick shortcut far more
    // available to decisive closing swipes (high instantaneous velocity right as fingers
    // lift) than to slower, tentative opening swipes.
    s.recentTicks.push({ dx: e.deltaX, dt })
    if (s.recentTicks.length > 4) s.recentTicks.shift()
    const sumDx = s.recentTicks.reduce((a, t) => a + t.dx, 0)
    const sumDt = s.recentTicks.reduce((a, t) => a + t.dt, 0)
    lastVelocityRef.current = sumDx / Math.max(1, sumDt)

    // macOS "natural" trackpad scrolling reports a LEFT two-finger swipe as positive
    // deltaX — sliding content left, which for a right-edge panel reveals more of it
    // (opening), matching Notification Center's own swipe-left-to-open convention.
    const rawFrac = s.segmentStartFrac - s.accumDeltaX / SWIPE_REFERENCE_PX
    const frac = applyRubberBand(rawFrac)
    dragFracRef.current = frac
    startDisplayLoop()

    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    // Also cancel any pending fallback commit — new activity means the previous pause
    // wasn't actually a release, so don't let a stale commit fire out from under an
    // in-progress resumed stroke.
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
    pauseTimerRef.current = setTimeout(() => pauseRef.current(), PAUSE_MS)
  })

  // A callback ref (not a plain useRef) — the panel area this attaches to can mount/unmount
  // independent of the rest of its owning component (e.g. only exists for one layout
  // variant). A callback ref fires on every attach/detach regardless of cause, so it always
  // tracks whichever node (if any) is currently mounted.
  const elRef = useRef<HTMLElement | null>(null)
  const panelAreaRef = useCallback((el: HTMLElement | null) => {
    const prev = elRef.current
    if (prev) prev.removeEventListener('wheel', onWheelRef.current, true)
    elRef.current = el
    // capture: true — fires on the way DOWN to whatever's under the cursor, before any
    // nested element (verse text, a horizontally-scrollable Strong's row, etc.) gets a
    // chance to see the event first, so nothing nested can ever consume/alter it first.
    if (el) el.addEventListener('wheel', onWheelRef.current, { passive: false, capture: true })
  }, [])

  return { panelAreaRef, dragFrac, isDragging }
}
