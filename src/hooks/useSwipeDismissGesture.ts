import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Two-finger trackpad swipe DOWN to dismiss a bottom-anchored toast — a one-directional sibling
 * of useSwipePanelGesture.ts, sharing its physics so the two gestures feel identical:
 *
 *  - Live drag decoupled from raw wheel-tick timing: an exact target (dragFracRef) updates
 *    synchronously on every tick; what's rendered (dragFrac) eases toward it every animation
 *    frame (DISPLAY_LERP), so bursty/irregular real trackpad ticks still read as smooth.
 *  - A fast downward flick commits (dismiss) immediately regardless of distance; a slow drag is
 *    decided by whether it passed the halfway point.
 *  - Short strokes accumulate (swipe, pause, swipe again) toward the same decision; a pause
 *    HOLDS position and only commits on a real finger-lift (native gesture-end IPC) or, as a
 *    fallback, continued silence.
 *  - Rubber-band resistance if pulled the wrong way (up, past rest).
 *
 * dragFrac: 0 = at rest, 1 = fully swiped away. `null` = no gesture (host renders its default).
 */

export interface SwipeDismissOptions {
  enabled: boolean
  /** Fired once the gesture decides the toast should be dismissed. */
  onDismiss: () => void
}

// The Bible reader's panel gesture owns the native trackpad-phase IPC (preload's
// onTrackpadSwipeBegin/End do removeAllListeners, so it's single-consumer). This hook therefore
// decides "finger lifted" from wheel-tick silence alone — kept snappy since a toast dismiss is
// low-stakes: a fast flick or a drag past 100% commits instantly (see the wheel handler), only a
// slow drag that stops between 50–99% waits out these timers.
const PAUSE_MS = 120
const COMMIT_FALLBACK_MS = 240
// Physical trackpad px for a full 0→1 dismiss swipe.
const SWIPE_REFERENCE_PX = 130
// px/ms downward — a stroke faster than this commits by direction regardless of distance.
const FAST_FLICK_VELOCITY = 0.5
const RUBBER_BAND_MAX_OVERSHOOT = 0.12
const RUBBER_BAND_CONSTANT = 0.55
const DISPLAY_LERP = 0.35
const CONVERGED_EPSILON = 0.001

function rubberBand(overflow: number): number {
  const sign = overflow < 0 ? -1 : 1
  const mag = Math.abs(overflow)
  return sign * (mag * RUBBER_BAND_MAX_OVERSHOOT * RUBBER_BAND_CONSTANT) / (RUBBER_BAND_MAX_OVERSHOOT + RUBBER_BAND_CONSTANT * mag)
}

interface SessionState {
  segmentStartFrac: number
  accumDeltaY: number
  lastTime: number
  recentTicks: Array<{ dy: number; dt: number }>
}

export function useSwipeDismissGesture({ enabled, onDismiss }: SwipeDismissOptions) {
  const dragFracRef = useRef<number | null>(null)
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const displayFracRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const sessionRef = useRef<SessionState | null>(null)
  const lastVelocityRef = useRef(0)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rafIdRef = useRef<number | null>(null)
  const stopLoop = useCallback(() => {
    if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
  }, [])
  const startLoop = useCallback(() => {
    if (rafIdRef.current !== null) return
    const step = () => {
      const target = dragFracRef.current
      if (target === null) { rafIdRef.current = null; return }
      const cur = displayFracRef.current ?? target
      const gap = target - cur
      if (Math.abs(gap) < CONVERGED_EPSILON) {
        displayFracRef.current = target
        setDragFrac(target)
        rafIdRef.current = null
        return
      }
      const next = cur + gap * DISPLAY_LERP
      displayFracRef.current = next
      setDragFrac(next)
      rafIdRef.current = requestAnimationFrame(step)
    }
    rafIdRef.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => stopLoop, [stopLoop])

  const clearTimers = useCallback(() => {
    if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null }
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
  }, [])

  const commit = useCallback(() => {
    clearTimers()
    sessionRef.current = null
    const rest = dragFracRef.current
    setIsDragging(false)
    if (rest === null) return
    const fastFlick = lastVelocityRef.current > FAST_FLICK_VELOCITY
    const clamped = Math.max(0, Math.min(1, rest))
    const dismiss = fastFlick || clamped > 0.5
    if (dismiss) {
      // ease the toast the rest of the way off, then let the host unmount it
      dragFracRef.current = 1
      startLoop()
      onDismissRef.current()
    } else {
      // spring back to rest
      dragFracRef.current = 0
      startLoop()
      window.setTimeout(() => {
        if (dragFracRef.current === 0) {
          stopLoop()
          dragFracRef.current = null
          displayFracRef.current = null
          setDragFrac(null)
        }
      }, 220)
    }
  }, [clearTimers, startLoop, stopLoop])
  const commitRef = useRef(commit)
  commitRef.current = commit

  const pause = useCallback(() => {
    sessionRef.current = null
    setIsDragging(false)
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => commitRef.current(), COMMIT_FALLBACK_MS)
  }, [])
  const pauseRef = useRef(pause)
  pauseRef.current = pause

  /** Hard-reset to rest — call when the host re-shows a fresh instance (e.g. a new toast), so a
   *  previous dismiss's dragFrac=1 doesn't leave the new one translated off-screen. */
  const reset = useCallback(() => {
    clearTimers()
    stopLoop()
    sessionRef.current = null
    dragFracRef.current = null
    displayFracRef.current = null
    lastVelocityRef.current = 0
    setDragFrac(null)
    setIsDragging(false)
  }, [clearTimers, stopLoop])

  const onWheelRef = useRef((e: WheelEvent) => {
    if (!enabledRef.current) return
    if (e.ctrlKey) return
    const absX = Math.abs(e.deltaX)
    const absY = Math.abs(e.deltaY)
    // vertical-dominant only; ordinary horizontal scroll / diagonal jitter falls through
    if (absY < 4 || absY <= absX * 1.5) return

    const now = performance.now()
    if (!sessionRef.current) {
      const segmentStartFrac = dragFracRef.current ?? 0
      sessionRef.current = { segmentStartFrac, accumDeltaY: 0, lastTime: now, recentTicks: [] }
    }
    const s = sessionRef.current
    const dt = Math.max(1, now - s.lastTime)
    s.lastTime = now
    s.accumDeltaY += e.deltaY

    s.recentTicks.push({ dy: e.deltaY, dt })
    if (s.recentTicks.length > 4) s.recentTicks.shift()
    const sumDy = s.recentTicks.reduce((a, t) => a + t.dy, 0)
    const sumDt = s.recentTicks.reduce((a, t) => a + t.dt, 0)
    // macOS natural scrolling: a physical DOWNWARD two-finger swipe reports negative deltaY, so
    // dismiss progress grows as -deltaY accumulates. Velocity is likewise -px/ms downward.
    lastVelocityRef.current = -sumDy / Math.max(1, sumDt)

    const rawFrac = s.segmentStartFrac - s.accumDeltaY / SWIPE_REFERENCE_PX
    // only a downward pull moves it; an upward pull past rest just rubber-bands
    const frac = rawFrac < 0 ? rubberBand(rawFrac) : rawFrac
    // once past ~1 it's committed anyway; soft-cap so it doesn't shoot far offscreen mid-drag
    const capped = frac > 1 ? 1 + rubberBand(frac - 1) : frac

    // Only start swallowing the event / driving the drag once it's clearly a downward gesture.
    if (capped <= 0 && s.accumDeltaY >= 0) {
      // purely upward so far — don't hijack the scroll
      return
    }
    e.preventDefault()
    setIsDragging(true)
    dragFracRef.current = capped
    startLoop()

    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }

    // Instant commit for a decisive gesture — no wait for the silence timers:
    //  • dragged the whole way (past 100%), or
    //  • a fast downward flick with real downward intent.
    if (capped >= 1 || (lastVelocityRef.current > FAST_FLICK_VELOCITY && capped > 0.08)) {
      commitRef.current()
      return
    }
    pauseTimerRef.current = setTimeout(() => pauseRef.current(), PAUSE_MS)
  })

  const elRef = useRef<HTMLElement | null>(null)
  const areaRef = useCallback((el: HTMLElement | null) => {
    const prev = elRef.current
    if (prev) prev.removeEventListener('wheel', onWheelRef.current, true)
    elRef.current = el
    if (el) el.addEventListener('wheel', onWheelRef.current, { passive: false, capture: true })
  }, [])

  return { areaRef, dragFrac, isDragging, reset }
}
