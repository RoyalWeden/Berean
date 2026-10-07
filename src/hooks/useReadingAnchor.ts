import { useEffect, type RefObject } from 'react'

/**
 * Keep the reader's place when the Scripture text re-wraps (TEST 2026-10-04: opening / widening /
 * closing the side panel, resizing the window). Remembers the topmost visible verse and its offset
 * from the top of the scroller as the user scrolls; when the scroller's WIDTH changes it scrolls
 * so that verse sits at the same offset again. Height-only changes (find bar, toolbar) are left
 * alone. Verses are found by their `data-verse` attribute.
 */
export function useReadingAnchor(hostRef: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const host = hostRef.current
    if (!host || !enabled || typeof ResizeObserver === 'undefined') return
    let anchor: { verse: string; offset: number } | null = null
    let width = 0
    let restoring = false

    const scroller = (): HTMLElement | null => {
      const first = host.querySelector<HTMLElement>('[data-verse]')
      let e: HTMLElement | null = first?.parentElement ?? null
      while (e && e !== host.parentElement) {
        const oy = getComputedStyle(e).overflowY
        if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) return e
        e = e.parentElement
      }
      return null
    }
    const capture = () => {
      if (restoring) return
      const sc = scroller()
      if (!sc || sc.scrollTop <= 0) { anchor = null; return }
      const top = sc.getBoundingClientRect().top
      for (const v of sc.querySelectorAll<HTMLElement>('[data-verse]')) {
        const r = v.getBoundingClientRect()
        if (r.bottom > top + 1) { anchor = { verse: v.dataset.verse!, offset: r.top - top }; return }
      }
    }
    const restore = () => {
      const sc = scroller()
      if (!sc || !anchor) return
      const el = sc.querySelector<HTMLElement>(`[data-verse="${CSS.escape(anchor.verse)}"]`)
      if (!el) return
      const delta = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - anchor.offset
      if (Math.abs(delta) < 1) return
      restoring = true
      sc.scrollTop += delta
      requestAnimationFrame(() => { restoring = false })
    }

    const onScroll = () => capture()
    host.addEventListener('scroll', onScroll, { capture: true, passive: true })
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (width && w !== width) restore()
      width = w
    })
    ro.observe(host)
    capture()
    return () => { host.removeEventListener('scroll', onScroll, { capture: true }); ro.disconnect() }
  }, [hostRef, enabled])
}
