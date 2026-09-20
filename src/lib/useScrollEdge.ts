import { useEffect, useState, type RefObject } from 'react'

/**
 * Scroll-edge (§37/§61): tells a bar whether the content beneath it has scrolled, so the bar can
 * show its hairline + soft shadow ONLY then (a resting toolbar is seamless with the page, like
 * macOS 26/27). Passive listener; state is written only when the boolean flips.
 *
 * `source` is either a ref to the scroll container, or 'auto' — the bar element's next scrollable
 * sibling (or the first `[data-scroll-root]` / overflow-auto descendant of its next sibling).
 * `side` = which edge of the bar touches the content ('bottom' for a header, 'top' for a footer).
 */
export function useScrollEdge(
  barRef: RefObject<HTMLElement>,
  source: RefObject<HTMLElement> | 'auto' | null,
  side: 'bottom' | 'top' = 'bottom',
): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!source) return
    const bar = barRef.current
    const el = source === 'auto' ? findScrollRoot(bar) : source.current
    if (!el) return
    let last = false
    const read = () => {
      const v = side === 'bottom'
        ? el.scrollTop > 1
        : el.scrollHeight - el.clientHeight - el.scrollTop > 1
      if (v !== last) { last = v; setScrolled(v) }
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', read); ro?.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barRef.current, source === 'auto' ? 'auto' : source?.current, side])
  return scrolled
}

function isScroller(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const oy = getComputedStyle(el).overflowY
  return oy === 'auto' || oy === 'scroll' || el.hasAttribute('data-scroll-root')
}

/** Nearest element that scrolls under `bar`: the next sibling that scrolls, or a scroll root inside it. */
export function findScrollRoot(bar: HTMLElement | null): HTMLElement | null {
  if (!bar) return null
  let sib: Element | null = bar.nextElementSibling
  while (sib) {
    if (isScroller(sib)) return sib
    const inner = sib.querySelector<HTMLElement>('[data-scroll-root], .overflow-y-auto, .overflow-auto, .overflow-y-scroll')
    if (inner) return inner
    sib = sib.nextElementSibling
  }
  // Footer bars: look backwards.
  sib = bar.previousElementSibling
  while (sib) {
    if (isScroller(sib)) return sib
    const inner = sib.querySelector<HTMLElement>('[data-scroll-root], .overflow-y-auto, .overflow-auto, .overflow-y-scroll')
    if (inner) return inner
    sib = sib.previousElementSibling
  }
  return null
}
