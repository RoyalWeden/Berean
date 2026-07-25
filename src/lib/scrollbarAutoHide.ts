const hideTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/**
 * Global scroll listener (capture phase — scroll events don't bubble) that flags
 * whichever element was just scrolled as `.scrollbar-visible` for a short window,
 * so global.css can reveal its scrollbar thumb briefly then fade it back out —
 * true auto-hide, not just a permanent low-opacity thumb.
 */
export function initScrollbarAutoHide(): void {
  document.addEventListener('scroll', (e) => {
    const el = e.target
    if (!(el instanceof Element)) return
    el.classList.add('scrollbar-visible')
    const existing = hideTimers.get(el)
    if (existing) clearTimeout(existing)
    hideTimers.set(el, setTimeout(() => {
      el.classList.remove('scrollbar-visible')
      hideTimers.delete(el)
    }, 900))
  }, { capture: true, passive: true })
}
