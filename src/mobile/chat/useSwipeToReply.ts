import { useCallback, useEffect, useRef } from 'react'
import { haptic } from '../primitives/haptics'

/** How far (px) a message must be dragged right before letting go replies to it. */
export const SWIPE_REPLY_THRESHOLD = 56
const MAX_SHIFT = 72
/** Starts this close to the left edge belong to the back-swipe (NavigationStack). */
const EDGE_GUARD = 28

/**
 * Swipe a message to the right to reply (Messages). A mostly horizontal drag that starts on a
 * message (away from the screen's back-swipe edge, and not inside something that scrolls sideways,
 * such as a wide table) slides that row with a reply arrow behind it; one haptic tick at the
 * threshold; letting go past it replies.
 *
 * TOUCH events, attached natively: WebKit sends `pointercancel` ~45 px into a horizontal drag in a
 * scrolling page (real swipe in the simulator, 2026-10-18), while touch events keep coming — and a
 * non-passive touchmove lets an active swipe stop the page from scrolling under it (React's own
 * touch listeners are passive). The row moves by direct style writes — no re-render per frame.
 * Returns a ref callback for the transcript container.
 */
export function useSwipeToReply(onReply: (messageId: string) => void) {
  const onReplyRef = useRef(onReply)
  onReplyRef.current = onReply
  const cleanup = useRef<(() => void) | null>(null)

  const attach = useCallback((el: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!el) return
    let g: { row: HTMLElement; id: string; x: number; y: number; active: boolean; armed: boolean; touch: number } | null = null
    let swallowUntil = 0

    const reset = (row: HTMLElement) => {
      row.style.removeProperty('--swipe-x')
      row.style.removeProperty('--swipe-p')
      delete row.dataset.swiping
    }
    const start = (e: TouchEvent) => {
      g = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const target = e.target as HTMLElement
      const row = target.closest?.<HTMLElement>('[data-message-id]')
      if (!row || t.clientX < EDGE_GUARD || hasSidewaysScroller(target, row)) return
      g = { row, id: row.dataset.messageId!, x: t.clientX, y: t.clientY, active: false, armed: false, touch: t.identifier }
    }
    const move = (e: TouchEvent) => {
      const s = g
      if (!s) return
      const t = [...e.touches].find((x) => x.identifier === s.touch)
      if (!t) return
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (!s.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return } // a scroll
        if (dx < 10 || dx < Math.abs(dy) * 1.5) return
        s.active = true
        s.row.dataset.swiping = 'true'
        try { window.getSelection()?.removeAllRanges() } catch { /* */ }
      }
      if (e.cancelable) e.preventDefault() // the page does not scroll under an active swipe
      const shift = Math.max(0, Math.min(MAX_SHIFT, dx * 0.6))
      s.row.style.setProperty('--swipe-x', `${shift}px`)
      s.row.style.setProperty('--swipe-p', String(Math.min(1, shift / SWIPE_REPLY_THRESHOLD)))
      const armed = shift >= SWIPE_REPLY_THRESHOLD
      if (armed !== s.armed) { s.armed = armed; if (armed) void haptic.light() }
    }
    const end = (commit: boolean) => () => {
      const s = g
      g = null
      if (!s?.active) return
      reset(s.row)
      swallowUntil = Date.now() + 350
      if (commit && s.armed) onReplyRef.current(s.id)
    }
    // A swipe never also taps what was under the finger (a verse link).
    const click = (e: MouseEvent) => { if (Date.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); swallowUntil = 0 } }
    const onEnd = end(true)
    const onCancel = end(false)
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    el.addEventListener('click', click, true)
    cleanup.current = () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      el.removeEventListener('click', click, true)
    }
  }, [])
  useEffect(() => () => { cleanup.current?.() }, [])
  return attach
}

function hasSidewaysScroller(from: HTMLElement, stop: HTMLElement): boolean {
  for (let el: HTMLElement | null = from; el && el !== stop; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}
