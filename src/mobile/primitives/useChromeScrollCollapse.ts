import { useEffect, useRef } from 'react'
import { chromeState } from '../navigation/chromeState'
import { stepHideOnScroll } from '../reader/useHideOnScroll'

/**
 * Bottom controls hide while scrolling DOWN on every page, return on scrolling up (TEST25-NAV-010)
 * — the same hysteresis as the Scripture header. Scripture views (reader, Compare) drive the chrome
 * themselves (`chromeState.overlay`), so this watcher stands aside while one is showing. Scrolls
 * inside sheets never count. `resetKey` (space / tab) brings the controls back.
 */
export function useChromeScrollCollapse(rootRef: React.RefObject<HTMLElement>, resetKey: string): void {
  const st = useRef({ hidden: false, acc: 0 })
  const lastTop = useRef(new WeakMap<EventTarget, number>())
  useEffect(() => { st.current = { hidden: false, acc: 0 }; chromeState.set({ pageCollapsed: false }) }, [resetKey])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el || typeof el.scrollTop !== 'number' || el.closest?.('.mobile-sheet')) return
      const prev = lastTop.current.get(el) ?? el.scrollTop
      lastTop.current.set(el, el.scrollTop)
      if (chromeState.get().overlay) return
      const next = stepHideOnScroll(st.current, prev, el.scrollTop)
      st.current = next
      chromeState.set({ pageCollapsed: next.hidden })
    }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  }, [rootRef])
}
