import { useEffect, useRef, useState } from 'react'

/**
 * Reveals (returns true) while the cursor is within `distance` px of the
 * target element's own bounding rect (or directly over it) — used for Focus
 * mode's auto-hiding floating toolbar, which fades to fully hidden and back
 * in based on proximity to its own docked position, rather than a separate
 * hover trigger. Only listens for mousemove while `active`; when inactive,
 * `revealed` is held `true` so the caller's normal (non-Focus) styling is
 * untouched. The element's own opacity/pointer-events should be the only
 * thing toggled by the caller — never its position — so its rect stays
 * accurate while hidden.
 */
export function useProximityReveal<T extends HTMLElement>(active: boolean, distance = 56) {
  const ref = useRef<T>(null)
  const [revealed, setRevealed] = useState(!active)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!active) { setRevealed(true); return }
    setRevealed(false)
    function onMove(e: MouseEvent) {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right)
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom)
        setRevealed(Math.hypot(dx, dy) <= distance)
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [active, distance])

  return { ref, revealed }
}
