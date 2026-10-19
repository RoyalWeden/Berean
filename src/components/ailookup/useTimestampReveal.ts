import { useEffect, useRef, type RefObject } from 'react'

/** How far the messages slide to show the gutter: its width (`--chat-reveal-w`, chat.css — only
 *  a time inside a conversation, time + conversation in All Messages / a day) + the row's side
 *  padding. This is the fallback when the stylesheet gives no width. */
export const REVEAL_MAX = 120
const ROW_PAD = 12
/** Pulling this far (1.5× the gutter) and letting go keeps the gutter open. */
export const REVEAL_LOCK = Math.round(REVEAL_MAX * 1.5)
/** The slide distance for this transcript right now (read once per gesture). */
export function revealDistance(el: HTMLElement): number {
  const w = parseFloat(getComputedStyle(el).getPropertyValue('--chat-reveal-w'))
  return w > 0 ? w + ROW_PAD : REVEAL_MAX
}
/** Trackpads keep sending momentum after the fingers lift, with no "lifted" signal: the lock
 *  needs this much more pull there, so a quick flick doesn't lock by accident. */
export const WHEEL_LOCK_ALLOWANCE = 40
/** While locked, pulling back (rightward) at least this far closes it. */
export const REVEAL_CLOSE_PULL = 36
/** A trackpad gesture ends this long after its last wheel event (momentum included). The Mac
 *  sends no "fingers lifted" signal, and a slow, deliberate drag pauses between events — 140 ms
 *  read those pauses as letting go and slid the times back mid-drag (TEST 2026-10-19). */
export const WHEEL_END_MS = 380
/** The slide back after letting go. */
export const SETTLE_MS = 260
/** Past the full reveal the drag only stretches a little (rubber band)… */
const OVERSHOOT = 18
/** …and at the lock point the rows pop out this much and spring straight back to the locked
 *  position — while still dragging, so letting go needs no further movement (TEST 2026-10-19:
 *  "it stays at the further extended state for too long"). */
const LOCK_SNAP = 16
const SNAP_BACK_MS = 170
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

type Mode = 'idle' | 'drag' | 'locked'

/**
 * Drag the transcript right-to-left to see each message's time (and, in All Messages / a day,
 * its conversation) — Messages: your own messages slide left and every message's time comes in
 * from the right edge. Berean's answers stay put; their times slide in over the free margin.
 *
 *  - Peek: up to the gutter's width; letting go anywhere in that range slides it back.
 *  - Lock: pulling on to ~1.5× the width pops and settles into place (`onArm` — a haptic on
 *    iPhone); letting go keeps the gutter open. Pushing back below the lock point before letting
 *    go cancels it.
 *  - Locked: vertical scrolling keeps the times visible; a rightward swipe, a tap / click in the
 *    transcript (swallowed — it only closes; a conversation name in the gutter still opens it),
 *    Esc, or another conversation (`resetKey`) closes it. A rightward swipe while locked closes
 *    the gutter and never starts swipe-to-reply.
 *
 * Performance (TEST 2026-10-19 "lag in All Messages"): while dragging or settling, only the rows
 * on screen are moved, by inline transforms on exactly the elements that move — a custom property
 * on the scroller restyled every row (hundreds of long answers) each frame. The locked state is a
 * static class rule (`data-reveal='locked'`, chat.css), so rows scrolled into view are open too.
 *
 * Mac: a two-finger horizontal swipe (wheel deltaX). iPhone: a mostly horizontal touch drag
 * (leftward — rightward is swipe-to-reply unless the gutter is locked). A drag that starts inside
 * something that scrolls sideways (a wide table, a code block) scrolls that instead.
 */
export function useTimestampReveal(ref: RefObject<HTMLElement | null>, opts: { resetKey?: string; onArm?: () => void } = {}) {
  const onArmRef = useRef(opts.onArm)
  onArmRef.current = opts.onArm
  const closeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let mode: Mode = 'idle'
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let snapTimer: ReturnType<typeof setTimeout> | null = null
    let drag: { base: number; raw: number; armed: boolean; fromLocked: boolean; lockAt: number } | null = null
    // Where the rows were when they started sliding back: a drag that resumes during the slide
    // picks them up from there instead of jumping back to the edge.
    let settling: { from: number; at: number } | null = null
    let shownNow = 0
    // The elements being moved inline (on-screen rows only), and their gutters.
    let movers: HTMLElement[] = []
    let gutters: HTMLElement[] = []
    // This gesture's full reveal (narrower inside a conversation: only the time).
    let MAX = REVEAL_MAX

    const clearTimers = () => {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
      if (snapTimer) { clearTimeout(snapTimer); snapTimer = null }
    }
    /** The on-screen rows' moving parts: your message's `.chat-slide` parts (not a day
     *  separator), and only the gutter of Berean's. */
    const collect = () => {
      movers = []
      gutters = []
      const box = el.getBoundingClientRect()
      for (const row of Array.from(el.querySelectorAll<HTMLElement>('.chat-row[data-side]'))) {
        const r = row.getBoundingClientRect()
        if (r.bottom < box.top - 40 || r.top > box.bottom + 40) continue
        const g = row.querySelector<HTMLElement>('.chat-reveal')
        if (g) gutters.push(g)
        if (row.dataset.side === 'me') movers.push(...Array.from(row.querySelectorAll<HTMLElement>(':scope > .chat-slide')))
        else if (g) movers.push(g)
      }
      // Berean's times may sit over its text in a narrow window: they get the surface's colour.
      el.style.setProperty('--chat-reveal-bg', surfaceColor(el))
    }
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const paint = (x: number, ms = 0) => {
      if (reduced) ms = 0
      const t = ms ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : 'none'
      const tf = x ? `translateX(${(-x).toFixed(1)}px)` : ''
      for (const m of movers) { m.style.transition = t; m.style.transform = tf }
      const o = Math.min(1, x / MAX).toFixed(3)
      for (const g of gutters) { g.style.transition = t; g.style.opacity = o; g.style.display = 'flex' }
      shownNow = x
    }
    const clearInline = () => {
      for (const m of [...movers, ...gutters]) { for (const k of ['transform', 'transition', 'opacity', 'display']) m.style.removeProperty(k) }
      movers = []
      gutters = []
    }

    /** `allowance`: extra pull the lock needs (the trackpad's flick allowance). */
    const begin = (allowance: number) => {
      clearTimers()
      if (mode !== 'locked') MAX = revealDistance(el)
      const lockAt = Math.round(MAX * 1.5) + allowance
      const fromLocked = mode === 'locked'
      let base = fromLocked ? MAX : 0
      if (!fromLocked && settling) {
        const t = Math.min(1, (performance.now() - settling.at) / SETTLE_MS)
        base = Math.min(MAX, settling.from * (1 - t))
      }
      settling = null
      if (fromLocked || !movers.length) { clearInline(); collect() }
      el.dataset.reveal = 'drag'
      paint(base)
      drag = { base, raw: base, armed: false, fromLocked, lockAt }
      mode = 'drag'
    }
    const move = (delta: number) => {
      const s = drag
      if (!s) return
      s.raw = Math.max(0, Math.min(MAX + 200, s.base + delta))
      const armed = !s.fromLocked && s.raw >= s.lockAt
      if (armed) {
        if (!s.armed) {
          // Pop out, then spring back to the locked position right away (still dragging).
          s.armed = true
          onArmRef.current?.()
          paint(MAX + LOCK_SNAP)
          if (snapTimer) clearTimeout(snapTimer)
          snapTimer = setTimeout(() => { snapTimer = null; if (drag?.armed) paint(MAX, SNAP_BACK_MS) }, 40)
        }
        return
      }
      if (s.armed) { s.armed = false; if (snapTimer) { clearTimeout(snapTimer); snapTimer = null } }
      const d = s.raw
      paint(d <= MAX ? d : MAX + OVERSHOOT * (1 - Math.exp(-(d - MAX) / 60)))
    }
    const close = () => {
      drag = null
      clearTimers()
      if (mode === 'idle' && !el.dataset.reveal) return
      if (mode === 'locked') { collect(); paint(MAX) }
      mode = 'idle'
      el.dataset.reveal = 'settle'
      void el.offsetWidth // start the slide from where the rows are now
      settling = { from: shownNow, at: performance.now() }
      paint(0, SETTLE_MS)
      settleTimer = setTimeout(() => {
        settleTimer = null
        settling = null
        clearInline()
        delete el.dataset.reveal
      }, SETTLE_MS)
    }
    const lock = () => {
      drag = null
      clearTimers()
      mode = 'locked'
      // The class rule holds every row (including ones scrolled to later) at the same place.
      el.dataset.reveal = 'locked'
      clearInline()
      shownNow = MAX
    }
    const end = () => {
      const s = drag
      if (!s) return
      if (s.fromLocked) { if (s.raw <= MAX - REVEAL_CLOSE_PULL) close(); else lock() }
      else if (s.armed) lock()
      else close()
    }
    closeRef.current = () => { if (mode !== 'idle' || drag) close() }

    // ── Mac trackpad ──
    let wheel: { axis: 'x' | 'y'; d: number } | null = null
    let wheelTimer: ReturnType<typeof setTimeout> | null = null
    let wheelFrame = 0
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaMode !== 0) return // pinch-zoom, or a mouse wheel's line steps
      if (!wheel) {
        const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 && (e.deltaX > 0 || mode === 'locked' || !!settling)
        wheel = { axis: sideways && !inSidewaysScroller(e.target as HTMLElement, el) ? 'x' : 'y', d: 0 }
        if (wheel.axis === 'x') begin(WHEEL_LOCK_ALLOWANCE)
      }
      if (wheelTimer) clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        wheelTimer = null
        const was = wheel
        wheel = null
        if (wheelFrame) { cancelAnimationFrame(wheelFrame); wheelFrame = 0 }
        if (was?.axis === 'x') { move(was.d); end() }
      }, WHEEL_END_MS)
      if (wheel.axis !== 'x') return
      e.preventDefault() // locked sideways: the transcript does not also drift vertically
      wheel.d += e.deltaX
      // Trackpads can deliver several events per frame: paint once per frame.
      if (!wheelFrame) wheelFrame = requestAnimationFrame(() => { wheelFrame = 0; if (wheel?.axis === 'x') move(wheel.d) })
    }

    // ── iPhone touch ──
    let touch: { id: number; x: number; y: number; active: boolean } | null = null
    const onTouchStart = (e: TouchEvent) => {
      touch = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (inSidewaysScroller(e.target as HTMLElement, el)) return
      touch = { id: t.identifier, x: t.clientX, y: t.clientY, active: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const s = touch
      if (!s) return
      const t = [...e.touches].find((x) => x.identifier === s.id)
      if (!t) return
      const dx = s.x - t.clientX // leftward = positive
      const dy = t.clientY - s.y
      const locked = mode === 'locked'
      if (!s.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { touch = null; return } // a scroll
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        if (dx < 0 && !locked) { touch = null; return } // rightward = swipe-to-reply
        s.active = true
        begin(0)
        try { window.getSelection()?.removeAllRanges() } catch { /* */ }
      }
      if (e.cancelable) e.preventDefault()
      // The gesture is ours: swipe-to-reply (on an ancestor) never sees it — a rightward swipe
      // while locked closes the gutter instead of replying.
      e.stopPropagation()
      move(dx)
    }
    const onTouchEnd = () => { const was = touch?.active; touch = null; if (was) end() }

    // A tap / click while locked only closes (it doesn't also open a link under it) — except a
    // conversation name in the gutter, which opens that conversation.
    const onClick = (e: MouseEvent) => {
      if (mode !== 'locked') return
      if ((e.target as HTMLElement).closest?.('.chat-reveal-conv')) return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'locked' || e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      close()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey, true)
      if (wheelTimer) clearTimeout(wheelTimer)
      if (wheelFrame) cancelAnimationFrame(wheelFrame)
      clearTimers()
      closeRef.current = () => {}
    }
  }, [ref])

  // Another conversation / view: never carry an open gutter over.
  useEffect(() => { closeRef.current() }, [opts.resetKey])
}

/** The first non-transparent background behind `el` (the chat surface's colour). */
function surfaceColor(el: HTMLElement): string {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c
  }
  return 'transparent'
}

/** Inside an element that can scroll sideways (a wide table, a code block) — that scrolls instead. */
function inSidewaysScroller(from: HTMLElement | null, stop: HTMLElement): boolean {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}
