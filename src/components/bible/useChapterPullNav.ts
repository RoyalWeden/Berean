import { useEffect, useRef, useState } from 'react'

/**
 * Rubber-band chapter navigation for the PAGED (non-continuous) scripture reader.
 *
 * Pull past the top or bottom of a chapter and the content stretches away, opening a gap that
 * shows the adjacent chapter (see ChapterPullIndicator). Pull far enough and it opens.
 *
 * ── Why this is built the way it is ──────────────────────────────────────────────────────────
 * Chromium 128 (this Electron) gives the renderer NO way to tell a user-driven trackpad scroll
 * from post-lift inertia: `WheelEvent.momentum` doesn't ship until Chrome 151, `scrollend` never
 * fires when the scroller is already pinned at its extremity (our exact case), and two-finger
 * scrolling produces no pointer events. There is no release signal. So:
 *
 *   1. NEVER commit on stillness. A dead momentum stream and a motionless hand are the same
 *      signal — no events. Any "commit after N ms of quiet" rule navigates on a flick, which is
 *      precisely the bug that made a previous countdown-based version unusable.
 *   2. NEVER damp the position by velocity. Resistance comes only from the stateless rubber-band
 *      curve below, exactly as Chromium's own `overscroll_controller.cc` maps overscroll 1:1.
 *      Velocity-based damping made pushing harder open the gap ~25x slower, and made the mapping
 *      path-dependent so pulling back didn't retrace the way out.
 *   3. Commit ONLY on a deliberate over-pull past COMPLETE_FRACTION of the viewport, AND only
 *      once the gesture has proven it is live input (see `liveProvenRef`). Momentum can open the
 *      gap and have it spring shut — that's the inert bounce — but can never navigate.
 *
 * `liveInputProven` rests on two things momentum physically cannot do: pause (a gap between
 * events) and accelerate (a delta larger than the running maximum). A discrete mouse wheel — no
 * momentum, no release — satisfies the first on essentially every notch.
 *
 * One rAF loop is the ONLY writer of the content transform, and no CSS transition is ever set on
 * it. Earlier versions had four writers (a render loop, two CSS transitions and a bounce loop)
 * racing over the same property behind guard flags, which is what made the motion stutter and
 * "hold then snap".
 *
 * Continuous-scroll mode already flows between chapters, so this is paged-only. Book boundaries
 * are handled by the caller's getPrev/NextChapterRef.
 */

export interface ChapterPullState {
  dir: 'prev' | 'next' | null
  /** Px the content is currently slid by (>= 0; caller applies it up or down per `dir`). */
  offset: number
  /** 0‥1 across the range the banner is visible for — 0 the instant it appears, 1 at commit.
   *  Deliberately NOT offset/commitPoint, which would have the bar already part-filled the
   *  moment it faded in. */
  progress: number
  /** The gesture has proven itself user-driven, so it is allowed to commit. */
  live: boolean
  /** This gesture began at the matching edge, so it is allowed to turn the page. False for a
   *  swipe that started mid-chapter and merely ran into the end — that still stretches the band,
   *  but can never navigate and shows no banner. */
  canCommit: boolean
  /** True while a committed navigation plays out. */
  committing: boolean
}

interface Options {
  scrollElRef: React.RefObject<HTMLElement | null>
  contentElRef: React.RefObject<HTMLElement | null>
  enabled: boolean
  hasPrev: boolean
  hasNext: boolean
  onCommitPrev: () => void
  onCommitNext: () => void
  isBlocked?: () => boolean
  /** Changing this tears the gesture down and clears any in-flight pull. Pass the identity of
   *  whatever the panel is currently showing (tab + book + chapter): BiblePanel is a single
   *  persistent instance across tab switches, so without this an armed pull from one tab stayed
   *  live — and its transform stayed applied — after switching to another. */
  resetKey?: string
}

const IDLE: ChapterPullState = { dir: null, offset: 0, progress: 0, live: false, canCommit: false, committing: false }

/** Overscroll before the banner/preview appears. Matches Chromium's kStartTouchpadThresholdDips.
 *  The content still stretches from the very first pixel — only the UI waits — so first contact
 *  feels alive rather than dead. */
const INDICATOR_AT = 60

/**
 * How far the band can EVER stretch — the asymptote `d` in Apple's curve, and the single knob
 * that decides how quickly resistance builds.
 *
 * This is deliberately much smaller than the reader's height. Feeding the full viewport in (the
 * obvious reading of Apple's formula, where `d` is the scroll view's dimension) puts the whole
 * usable range of the gesture down in the curve's nearly-linear foot, so it pulls with the same
 * light constant resistance the entire way and never fights back — which is what made it feel
 * loose and unlike a browser. Capping the stretch at a few hundred px puts the pull squarely in
 * the bend, so every further pixel costs visibly more than the last and it firms up against a
 * hard ceiling, the way overscrolling a web page does.
 */
const STRETCH_FRACTION = 0.35
const STRETCH_MIN = 220
const STRETCH_MAX = 320
/** Commit once the band is this far out, as a fraction of its own maximum stretch — so the
 *  gesture keeps the same proportions (and needs the same effort) in any panel size. */
const COMPLETE_OF_STRETCH = 0.44
/** Apple's rubber-band tightness — how much of your finger's motion the band gives back before
 *  resistance builds. Lower is stiffer everywhere. b(x,d,c) = (1 - 1/(x*c/d + 1)) * d */
const RUBBER_C = 0.45
/** Offset over which the banner fades in once past INDICATOR_AT, so it never pops. */
const INDICATOR_FADE = 45
/** A run of wheel events closer together than this is one continuous gesture. The first event of
 *  a gesture decides, once and for all, whether that gesture is allowed to turn the page. */
const GESTURE_GAP_MS = 140
/** No events for this long ⇒ the gesture is over; spring home. Never commits. */
const RELEASE_MS = 140
/** Momentum never pauses: a gap at least this long proves live input. */
const LIVE_GAP_MS = 120
/** Momentum never accelerates: a delta this much above the running max proves live input. */
const LIVE_GROWTH = 1.15
/** Spring used to return home. Slightly under-damped for a little bounce. */
const SPRING_K = 220
const SPRING_D = 26

/** The band's maximum stretch for a reader of this height — the curve's asymptote. */
export function maxStretchFor(viewportH: number): number {
  return Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, viewportH * STRETCH_FRACTION))
}

/** How far out the band must be to commit, for a reader of this height. */
export function completeAtFor(viewportH: number): number {
  return maxStretchFor(viewportH) * COMPLETE_OF_STRETCH
}

/**
 * Apple's rubber-band curve. Stateless in `travel`, so pulling back retraces the way out
 * exactly, and asymptotic in `maxStretch`, so resistance climbs the further you go and the band
 * can never be dragged past its ceiling.
 */
export function rubberBand(travel: number, viewportH: number): number {
  if (travel <= 0) return 0
  const d = maxStretchFor(viewportH)
  return (1 - 1 / ((travel * RUBBER_C) / d + 1)) * d
}

/**
 * Does this wheel event prove the gesture is live input rather than post-lift inertia?
 *
 * Inertia has two properties it cannot violate: it never pauses (events arrive continuously
 * until they stop for good) and it never accelerates (deltas decay monotonically). Either one
 * being broken means a hand is driving. A discrete mouse wheel — which has no momentum at all —
 * satisfies the gap test on essentially every notch.
 *
 * Exported for tests: this predicate is the only thing standing between a flick and an
 * unwanted chapter change, so it is covered directly.
 */
export function provesLiveInput(gapMs: number, mag: number, maxMagSoFar: number): boolean {
  if (gapMs >= LIVE_GAP_MS) return true
  return maxMagSoFar > 0 && mag > maxMagSoFar * LIVE_GROWTH
}

export function useChapterPullNav(opts: Options): ChapterPullState {
  const { scrollElRef, contentElRef, enabled } = opts
  const [state, setState] = useState<ChapterPullState>(IDLE)

  const liveRef = useRef(opts)
  liveRef.current = opts

  const dirRef = useRef<'prev' | 'next' | null>(null)
  const travelRef = useRef(0)          // raw accumulated overscroll travel
  const offsetRef = useRef(0)          // rendered slide (rubber-banded travel, or spring value)
  const phaseRef = useRef<'idle' | 'drag' | 'release' | 'commit'>('idle')
  const liveProvenRef = useRef(false)
  const canCommitRef = useRef(false)
  const maxDeltaRef = useRef(0)
  const lastEventTsRef = useRef(0)
  const gestureLastTsRef = useRef(0)
  const gestureStartEdgeRef = useRef<{ top: boolean; bottom: boolean } | null>(null)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameTsRef = useRef(0)
  const springVelRef = useRef(0)
  const touchYRef = useRef<number | null>(null)
  const publishedRef = useRef<ChapterPullState>(IDLE)

  useEffect(() => {
    const el = scrollElRef.current
    if (!el || !enabled) return

    const atTop = () => el.scrollTop <= 0
    const atBottom = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    const viewportH = () => el.clientHeight
    const completeAt = () => completeAtFor(el.clientHeight)

    function publish() {
      const dir = dirRef.current
      const offset = offsetRef.current
      // Progress spans the banner's own visible life: 0 the moment it appears, 1 at commit.
      const span = Math.max(1, completeAt() - INDICATOR_AT)
      const next: ChapterPullState = {
        dir,
        offset,
        progress: Math.max(0, Math.min(1, (offset - INDICATOR_AT) / span)),
        live: liveProvenRef.current,
        canCommit: canCommitRef.current,
        committing: phaseRef.current === 'commit',
      }
      const p = publishedRef.current
      if (p.dir === next.dir && p.live === next.live && p.canCommit === next.canCommit
        && p.committing === next.committing && Math.abs(p.offset - next.offset) < 0.5) return
      publishedRef.current = next
      setState(next)
    }

    /** The one and only writer of the content transform. */
    function paint() {
      const content = liveRef.current.contentElRef.current
      if (!content) return
      const o = offsetRef.current
      const dir = dirRef.current
      content.style.transform = o > 0.4 && dir ? `translateY(${dir === 'next' ? -o : o}px)` : ''
    }

    function stopLoop() {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      lastFrameTsRef.current = 0
    }

    function ensureLoop() {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(frame)
    }

    function frame(ts: number) {
      rafRef.current = null
      const dtMs = lastFrameTsRef.current ? Math.min(48, ts - lastFrameTsRef.current) : 16
      lastFrameTsRef.current = ts
      const dt = dtMs / 1000

      if (phaseRef.current === 'release') {
        // Critically-ish damped spring home. Continuous and frame-driven, so there is no seam
        // between the input-driven phase and this one — the velocity carries straight over.
        const x = offsetRef.current
        const a = -SPRING_K * x - SPRING_D * springVelRef.current
        springVelRef.current += a * dt
        offsetRef.current = x + springVelRef.current * dt
        if (Math.abs(offsetRef.current) < 0.4 && Math.abs(springVelRef.current) < 8) {
          offsetRef.current = 0
          springVelRef.current = 0
          reset()
          return
        }
        paint(); publish(); ensureLoop(); return
      }

      // 'drag' and 'commit' just keep the painted value in step with offsetRef.
      paint(); publish()
      if (phaseRef.current === 'drag' || phaseRef.current === 'commit') ensureLoop()
    }

    function clearReleaseTimer() {
      if (releaseTimerRef.current) { clearTimeout(releaseTimerRef.current); releaseTimerRef.current = null }
    }

    function reset() {
      clearReleaseTimer()
      stopLoop()
      dirRef.current = null
      travelRef.current = 0
      offsetRef.current = 0
      springVelRef.current = 0
      liveProvenRef.current = false
      canCommitRef.current = false
      maxDeltaRef.current = 0
      lastEventTsRef.current = 0
      // Zeroed, not left stale: whatever comes next is a new gesture and must re-snapshot which
      // edge the reader is standing at (a spring-home only happens after RELEASE_MS of silence,
      // and a commit has just changed the chapter under us).
      gestureLastTsRef.current = 0
      gestureStartEdgeRef.current = null
      touchYRef.current = null
      phaseRef.current = 'idle'
      paint()
      publish()
    }

    /** Hand the current motion over to the spring. Never commits — stillness is not consent. */
    function beginRelease() {
      clearReleaseTimer()
      if (phaseRef.current !== 'drag') return
      phaseRef.current = 'release'
      lastFrameTsRef.current = 0
      ensureLoop()
    }

    function commit() {
      const dir = dirRef.current
      if (!dir || phaseRef.current === 'commit') return
      clearReleaseTimer()
      phaseRef.current = 'commit'
      publish()
      // Let the gap finish opening for a beat so the preview the user has been reading is what
      // they land on, then swap the chapter underneath it.
      window.setTimeout(() => {
        if (dir === 'prev') liveRef.current.onCommitPrev()
        else liveRef.current.onCommitNext()
        requestAnimationFrame(() => reset())
      }, 140)
    }

    /** signed: <0 opens the TOP (toward previous), >0 opens the BOTTOM (toward next). */
    function applyDelta(signed: number, now: number): boolean {
      const o = liveRef.current
      if (phaseRef.current === 'commit') return true
      if (o.isBlocked?.()) return false

      let dir = dirRef.current
      if (!dir) {
        if (signed < 0 && atTop() && o.hasPrev) dir = 'prev'
        else if (signed > 0 && atBottom() && o.hasNext) dir = 'next'
        else return false
        dirRef.current = dir
        travelRef.current = 0
        liveProvenRef.current = false
        maxDeltaRef.current = 0
        // Only a gesture that BEGAN at this edge may turn the page. A swipe started mid-chapter
        // that merely ran into the end still gets the rubber band, but can never navigate —
        // reaching the end of a chapter is not the same as asking to leave it.
        const start = gestureStartEdgeRef.current
        canCommitRef.current = !start ? false : dir === 'prev' ? start.top : start.bottom
      }

      const mag = Math.abs(signed)
      const gap = lastEventTsRef.current ? now - lastEventTsRef.current : Infinity
      lastEventTsRef.current = now

      // Two proofs momentum cannot fake: it never pauses, and it never accelerates.
      if (!liveProvenRef.current && provesLiveInput(gap, mag, maxDeltaRef.current)) liveProvenRef.current = true
      maxDeltaRef.current = Math.max(maxDeltaRef.current, mag)

      // 1:1 accumulation. Resistance is the rubber-band curve's job, nothing else's.
      const toward = dir === 'prev' ? -signed : signed
      travelRef.current = Math.max(0, travelRef.current + toward)
      if (travelRef.current === 0) { beginRelease(); return true }

      phaseRef.current = 'drag'
      const prevOffset = offsetRef.current
      offsetRef.current = rubberBand(travelRef.current, viewportH())
      springVelRef.current = ((offsetRef.current - prevOffset) / Math.max(1, gap === Infinity ? 16 : gap)) * 1000

      if (canCommitRef.current && liveProvenRef.current && offsetRef.current >= completeAt()) {
        paint(); publish(); commit(); return true
      }

      lastFrameTsRef.current = 0
      ensureLoop()
      clearReleaseTimer()
      releaseTimerRef.current = setTimeout(beginRelease, RELEASE_MS)
      return true
    }

    function onWheel(e: WheelEvent) {
      const o = liveRef.current
      if (!o.enabled || o.isBlocked?.()) return
      if (phaseRef.current === 'commit') { e.preventDefault(); return }
      const now = e.timeStamp || performance.now()
      // A new run of wheel events: snapshot where the reader was standing when it began. This is
      // what lets us tell "already at the end and pulling" from "scrolled into the end".
      if (!dirRef.current && now - gestureLastTsRef.current > GESTURE_GAP_MS) {
        gestureStartEdgeRef.current = { top: atTop(), bottom: atBottom() }
      }
      gestureLastTsRef.current = now
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      if (!dirRef.current) {
        const canPull = (px < 0 && atTop() && o.hasPrev) || (px > 0 && atBottom() && o.hasNext)
        if (!canPull) return
      }
      if (applyDelta(px, e.timeStamp || performance.now())) e.preventDefault()
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return
      touchYRef.current = e.touches[0].clientY
      // Same rule as the wheel: where the finger landed decides whether this drag may turn the
      // page. A touchstart is an unambiguous gesture boundary, so no timing guess is needed.
      if (!dirRef.current) gestureStartEdgeRef.current = { top: atTop(), bottom: atBottom() }
    }
    function onTouchMove(e: TouchEvent) {
      const startY = touchYRef.current
      if (startY == null || e.touches.length !== 1) return
      const o = liveRef.current
      if (!o.enabled || o.isBlocked?.() || phaseRef.current === 'commit') return
      const dy = startY - e.touches[0].clientY // >0 = finger up = toward next
      if (!dirRef.current) {
        const canPull = (dy < 0 && atTop() && o.hasPrev) || (dy > 0 && atBottom() && o.hasNext)
        if (!canPull) return
        // A finger on the glass is live input by definition.
        liveProvenRef.current = true
      }
      touchYRef.current = e.touches[0].clientY
      liveProvenRef.current = true
      if (applyDelta(dy, e.timeStamp || performance.now())) e.preventDefault()
    }
    function onTouchEnd() {
      touchYRef.current = null
      // Touch has a real release. Use it: below the threshold this springs home; the commit above
      // already fired if the user crossed it.
      if (dirRef.current && phaseRef.current === 'drag') beginRelease()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      clearReleaseTimer()
      stopLoop()
      const content = liveRef.current.contentElRef.current
      if (content) { content.style.transform = ''; content.style.transition = '' }
      dirRef.current = null
      travelRef.current = 0
      offsetRef.current = 0
      phaseRef.current = 'idle'
      liveProvenRef.current = false
      publishedRef.current = IDLE
      setState(IDLE)
    }
  }, [scrollElRef, contentElRef, enabled, opts.hasPrev, opts.hasNext, opts.resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

export const CHAPTER_PULL = {
  INDICATOR_AT, INDICATOR_FADE, STRETCH_FRACTION, STRETCH_MIN, STRETCH_MAX, COMPLETE_OF_STRETCH,
  RUBBER_C, RELEASE_MS, LIVE_GAP_MS, LIVE_GROWTH, GESTURE_GAP_MS,
  rubberBand, maxStretchFor, completeAtFor,
}
