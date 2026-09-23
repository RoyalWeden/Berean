import { useEffect, useRef, useState } from 'react'

/**
 * Top-bar auto-hide for a scrolling reader (TEST-029): hide after the user has scrolled DOWN a
 * meaningful distance, reveal on a small scroll UP or near the top. Hysteresis thresholds keep tiny
 * jitters from flickering the bar. Listens in the capture phase on `rootRef`, so it covers the
 * pager's panes and the continuous-scroll root alike. While `frozen` (a sheet / action UI is
 * open) the bar keeps its state instead of fighting the sheet; `resetKey` (new chapter / tab)
 * brings it back.
 */
export const HIDE_AFTER_PX = 28
export const SHOW_AFTER_PX = 14
export const ALWAYS_SHOWN_ABOVE_PX = 40

/** Pure step function (exported for tests): accumulates same-direction travel and decides. */
export function stepHideOnScroll(st: { hidden: boolean; acc: number }, prevTop: number, top: number): { hidden: boolean; acc: number } {
  if (top <= ALWAYS_SHOWN_ABOVE_PX) return { hidden: false, acc: 0 }
  const d = top - prevTop
  if (d === 0) return st
  const acc = (d > 0) === (st.acc > 0) || st.acc === 0 ? st.acc + d : d
  if (!st.hidden && acc > HIDE_AFTER_PX) return { hidden: true, acc: 0 }
  if (st.hidden && acc < -SHOW_AFTER_PX) return { hidden: false, acc: 0 }
  return { hidden: st.hidden, acc }
}

export function useHideOnScroll(rootRef: React.RefObject<HTMLElement>, opts: { frozen?: boolean; resetKey?: string } = {}): boolean {
  const [hidden, setHidden] = useState(false)
  const st = useRef({ hidden: false, acc: 0 })
  const lastTop = useRef(new WeakMap<EventTarget, number>())
  const frozen = useRef(!!opts.frozen)
  frozen.current = !!opts.frozen
  useEffect(() => { st.current = { hidden: false, acc: 0 }; setHidden(false) }, [opts.resetKey])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el || typeof el.scrollTop !== 'number') return
      const prev = lastTop.current.get(el) ?? el.scrollTop
      lastTop.current.set(el, el.scrollTop)
      if (frozen.current) return
      const next = stepHideOnScroll(st.current, prev, el.scrollTop)
      st.current = next
      setHidden((h) => (h === next.hidden ? h : next.hidden))
    }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  }, [rootRef])
  return hidden
}
