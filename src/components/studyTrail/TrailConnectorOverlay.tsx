import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// The connected-lines engine: a single absolutely-positioned SVG overlay per spine, drawing
// real paths between the ACTUAL measured pixel positions of spine dots and branch-row markers
// — not the previous per-row floating 28px line swatch, which never touched anything on
// either end. Every point (a spine dot, a connection row's marker, a glance-group's marker) is
// registered via a ref callback; this component reads their live getBoundingClientRect() on
// every render (cheap at this data size — at most a few hundred elements) plus on resize/
// content-size changes, and draws curves between whichever pairs the caller asks for.

export interface TrailPoint { x: number; y: number }
export interface TrailEdge {
  key: string
  from: string
  to: string
  color: string
  dashed?: boolean
  thick?: boolean
  curved?: boolean
  arrow?: boolean
  opacity?: number
}

/** One shared registry of "connector point key → its DOM element", plus the ref-callback
 *  factory every anchor (spine dot, row marker) uses to register itself. Lives in the parent
 *  (MapView/EverythingView) so both the rows themselves and the overlay can share it. */
export function useTrailConnectorPoints() {
  const pointsRef = useRef<Map<string, HTMLElement>>(new Map())
  const registerPoint = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) pointsRef.current.set(key, el)
    else pointsRef.current.delete(key)
  }, [])
  return { pointsRef, registerPoint }
}

export default function TrailConnectorOverlay({
  containerRef, pointsRef, edges,
}: {
  containerRef: React.RefObject<HTMLElement>
  pointsRef: React.MutableRefObject<Map<string, HTMLElement>>
  edges: TrailEdge[]
}) {
  const [coords, setCoords] = useState<Map<string, TrailPoint>>(new Map())

  const recompute = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const next = new Map<string, TrailPoint>()
    pointsRef.current.forEach((el, key) => {
      const r = el.getBoundingClientRect()
      next.set(key, { x: r.left + r.width / 2 - cRect.left, y: r.top + r.height / 2 - cRect.top })
    })
    setCoords(next)
  }, [containerRef, pointsRef])

  // Every render (cheap — this is small DOM, and it's the only way to catch a glance-group
  // expanding/collapsing or new nodes streaming in without wiring a bespoke "recompute" signal
  // into every caller of every state setter that could change row layout).
  useLayoutEffect(() => { recompute() })

  // Catches layout shifts React itself didn't cause a re-render for — window resize, and any
  // size change of the container (fonts finishing load, etc.).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(container)
    window.addEventListener('resize', recompute)
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute) }
  }, [containerRef, recompute])

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        <marker id="trail-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke" />
        </marker>
      </defs>
      {edges.map((e) => {
        const a = coords.get(e.from), b = coords.get(e.to)
        if (!a || !b) return null
        const d = e.curved
          ? `M${a.x},${a.y} C${a.x + 36},${a.y} ${b.x + 36},${b.y} ${b.x},${b.y}`
          : `M${a.x},${a.y} L${b.x},${b.y}`
        return (
          <path
            key={e.key} d={d} stroke={e.color} strokeWidth={e.thick ? 3 : 1.75} fill="none"
            strokeDasharray={e.dashed ? '4 4' : undefined} strokeLinecap="round" opacity={e.opacity ?? 1}
            markerEnd={e.arrow ? 'url(#trail-arrow)' : undefined}
          />
        )
      })}
    </svg>
  )
}
