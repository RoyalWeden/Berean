import { useEffect, useRef, useState } from 'react'

/**
 * Top-bar auto-hide for a scrolling reader (TEST-029): hide after the user has scrolled DOWN a
 * meaningful distance, reveal on a small scroll UP or near the top. Hysteresis thresholds keep tiny
 * jitters from flickering the bar. Listens in the capture phase on `rootRef`, so it covers the
 * pager's panes and the continuous-scroll root alike. While `frozen` (a sheet / action UI is
 * open) the bar keeps its state instead of fighting the sheet; `resetKey` (new chapter / tab)
 * brings it back, and so does `forceShown` (the caret is open, so the bar it acts on — the
 * passage title — is visible while the reading controls are adjusted, T23-014).
 */
export const HIDE_AFTER_PX = 40
export const SHOW_AFTER_PX = 32
/** Settling (TEST 2026-10-19 "it feels like it flickers too much if I scroll up and down a lot"):
 *  within SETTLE_PX of the place where the bars last moved, moving them back the other way takes
 *  SETTLE_FACTOR × the usual travel. Scrolling up and down a few lines to re-read no longer flips
 *  the chrome on every reversal, while a deliberate scroll still does, and reading on past that
 *  zone restores the usual light touch. Distance from a place, not time. */
export const SETTLE_PX = 220
export const SETTLE_FACTOR = 2.5
export const ALWAYS_SHOWN_ABOVE_PX = 40

/** `anchor` = the scroll position where the bars last moved (absent: not yet / long ago). */
export type HideOnScrollState = { hidden: boolean; acc: number; anchor?: number }

/** Pure step function (exported for tests): accumulates same-direction travel and decides. */
export function stepHideOnScroll(st: HideOnScrollState, prevTop: number, top: number): HideOnScrollState {
  if (top <= ALWAYS_SHOWN_ABOVE_PX) return st.hidden || st.acc !== 0 ? { hidden: false, acc: 0 } : st
  const d = top - prevTop
  if (d === 0) return st
  const acc = (d > 0) === (st.acc > 0) || st.acc === 0 ? st.acc + d : d
  const factor = st.anchor !== undefined && Math.abs(top - st.anchor) < SETTLE_PX ? SETTLE_FACTOR : 1
  if (!st.hidden && acc > HIDE_AFTER_PX * factor) return { hidden: true, acc: 0, anchor: top }
  if (st.hidden && acc < -SHOW_AFTER_PX * factor) return { hidden: false, acc: 0, anchor: top }
  return { hidden: st.hidden, acc, anchor: st.anchor }
}

/** The scroll position the bars react to: clamped to the real range. A rubber-band bounce at the
 *  end of a chapter overshoots the maximum and springs back (simulator, 2026-10-19: max 880,
 *  overshoot 914 → back to 880); that 34 px "upward" travel used to bring the bars back while the
 *  reader was still reading down — a flash at every chapter end. */
export function hideOnScrollTop(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  return Math.min(Math.max(0, scrollTop), Math.max(0, scrollHeight - clientHeight))
}

export function useHideOnScroll(rootRef: React.RefObject<HTMLElement>, opts: { frozen?: boolean; resetKey?: string; forceShown?: boolean } = {}): boolean {
  const [hidden, setHidden] = useState(false)
  const st = useRef<HideOnScrollState>({ hidden: false, acc: 0 })
  const lastTop = useRef(new WeakMap<EventTarget, number>())
  const frozen = useRef(!!opts.frozen)
  frozen.current = !!opts.frozen
  useEffect(() => { st.current = { hidden: false, acc: 0 }; setHidden(false) }, [opts.resetKey])
  useEffect(() => { if (opts.forceShown) { st.current = { hidden: false, acc: 0 }; setHidden(false) } }, [opts.forceShown])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el || typeof el.scrollTop !== 'number') return
      const top = hideOnScrollTop(el.scrollTop, el.scrollHeight, el.clientHeight)
      const prev = lastTop.current.get(el) ?? top
      lastTop.current.set(el, top)
      if (frozen.current) return
      const next = stepHideOnScroll(st.current, prev, top)
      st.current = next
      setHidden((h) => (h === next.hidden ? h : next.hidden))
    }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  }, [rootRef])
  return hidden
}
