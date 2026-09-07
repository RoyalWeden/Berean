import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveTagColor, tagSlotVar } from '@/lib/tagPalette'
import type { TagCoOccurrence, TagEdge, VerseTag } from '@/types'
import type { SimNode } from './tagForceLayout'

export interface CanvasView { x: number; y: number; zoom: number }

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2.5
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))

interface Props {
  tags: VerseTag[]
  nodes: Map<string, SimNode>
  edges: TagEdge[]
  coOccurrence: TagCoOccurrence[]
  showCoOccurrence: boolean
  showLabels: boolean
  selectedTagId: string | null
  selectedEdgeId: string | null
  pendingSourceId: string | null
  dimmedTagIds: Set<string> | null   // graph-search dim; null = nothing dimmed
  view: CanvasView
  onViewChange: (v: CanvasView) => void
  onNodeClick: (id: string) => void
  onNodeDragEnd: (id: string, x: number, y: number) => void
  onNodeDrag: (id: string, x: number, y: number) => void
  onNodeConnect: (sourceId: string, targetId: string) => void
  onEdgeClick: (id: string, at: { x: number; y: number }) => void
  onBackgroundClick: () => void
  registerFitter?: (fn: (ids?: string[]) => void) => void
}

/** Quadratic control point offset perpendicular to the chord, so A→B and B→A don't overlap. */
function curve(ax: number, ay: number, bx: number, by: number, bend: number) {
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  return { cx: mx + nx * bend, cy: my + ny * bend, mx: mx + nx * bend * 0.5, my: my + ny * bend * 0.5 }
}

// Cheap static "gloss" — an inset top highlight + a soft drop shadow. No blur-glow: this sits on
// every node and the sim repaints them every frame.
const NODE_GLOSS = 'inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(0 0 0 / 0.28)'

export default function TagGraphCanvas(props: Props) {
  const {
    tags, nodes, edges, coOccurrence, showCoOccurrence, showLabels, selectedTagId, selectedEdgeId,
    pendingSourceId, dimmedTagIds, view, onViewChange, onNodeClick, onNodeDragEnd, onNodeDrag,
    onNodeConnect, onEdgeClick, onBackgroundClick, registerFitter,
  } = props

  const scrollRef = useRef<HTMLDivElement>(null)
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])
  const [hoverEdge, setHoverEdge] = useState<{ id: string; note: string; x: number; y: number } | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  // Live rubber-band while dragging one node toward another to connect them.
  const [connectDrag, setConnectDrag] = useState<{ from: string; x: number; y: number; target: string | null } | null>(null)

  // Latest view for the non-passive wheel listener (subscribe once).
  const viewRef = useRef(view)
  viewRef.current = view

  // Fit-to-view: center the given node ids (or all) in the viewport.
  const fit = useCallback((ids?: string[]) => {
    const el = scrollRef.current
    if (!el) return
    const list = (ids && ids.length ? ids : [...nodes.keys()]).map((id) => nodes.get(id)).filter(Boolean) as SimNode[]
    if (!list.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of list) {
      minX = Math.min(minX, n.x - n.r); minY = Math.min(minY, n.y - n.r)
      maxX = Math.max(maxX, n.x + n.r); maxY = Math.max(maxY, n.y + n.r)
    }
    const pad = 80
    const w = el.clientWidth, h = el.clientHeight
    const zoom = clampZoom(Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2), ZOOM_MAX))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    onViewChange({ zoom, x: w / 2 - cx * zoom, y: h / 2 - cy * zoom })
  }, [nodes, onViewChange])

  useEffect(() => { registerFitter?.(fit) }, [registerFitter, fit])

  // ── Wheel zoom via a NON-passive native listener (React's onWheel is passive, so
  //    e.preventDefault() there only warns). Subscribed once; reads viewRef for current state. ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && Math.abs(e.deltaY) < 2) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const v = viewRef.current
      const nz = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0022))
      const wx = (px - v.x) / v.zoom
      const wy = (py - v.y) / v.zoom
      onViewChange({ zoom: nz, x: px - wx * nz, y: py - wy * nz })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [onViewChange])

  const worldFromClient = (clientX: number, clientY: number) => {
    const rect = scrollRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom }
  }
  const nodeAt = (wx: number, wy: number, exclude?: string) => {
    for (const n of nodes.values()) {
      if (n.id === exclude) continue
      if (Math.hypot(n.x - wx, n.y - wy) <= n.r + 6) return n.id
    }
    return null
  }

  // ── Background pan ──
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const bgDownRef = useRef(false)
  const movedRef = useRef(false)
  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    bgDownRef.current = true
    movedRef.current = false
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onBgPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current
    if (!p) return
    const dx = e.clientX - p.sx
    const dy = e.clientY - p.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true
    onViewChange({ ...view, x: p.ox + dx, y: p.oy + dy })
  }
  const onBgPointerUp = () => {
    const wasBg = bgDownRef.current
    const moved = movedRef.current
    panRef.current = null
    bgDownRef.current = false
    movedRef.current = false
    if (wasBg && !moved) onBackgroundClick()
  }

  // ── Node drag: move+pin on empty drop, connect on drop over another node ──
  const nodeDragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const onNodePointerDown = (e: React.PointerEvent, n: SimNode) => {
    e.stopPropagation()
    if (e.button !== 0) return
    nodeDragRef.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onNodePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    const d = nodeDragRef.current
    if (!d) return
    const dx = (e.clientX - d.sx) / view.zoom
    const dy = (e.clientY - d.sy) / view.zoom
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (!d.moved) return
    const w = worldFromClient(e.clientX, e.clientY)
    const target = nodeAt(w.x, w.y, d.id)
    if (target) {
      // heading for another node → show a connect rubber-band, don't drag the node itself
      setConnectDrag({ from: d.id, x: w.x, y: w.y, target })
    } else if (connectDrag) {
      setConnectDrag({ from: d.id, x: w.x, y: w.y, target: null })
      onNodeDrag(d.id, d.ox + dx, d.oy + dy)
    } else {
      onNodeDrag(d.id, d.ox + dx, d.oy + dy)
    }
  }
  const onNodePointerUp = (e: React.PointerEvent, n: SimNode) => {
    e.stopPropagation()
    const d = nodeDragRef.current
    nodeDragRef.current = null
    const cd = connectDrag
    setConnectDrag(null)
    if (!d) return
    if (cd?.target && cd.target !== d.id) {
      onNodeConnect(d.id, cd.target)
      return
    }
    if (d.moved) {
      const dx = (e.clientX - d.sx) / view.zoom
      const dy = (e.clientY - d.sy) / view.zoom
      onNodeDragEnd(d.id, d.ox + dx, d.oy + dy)
    } else {
      onNodeClick(n.id)
    }
  }

  const dim = (id: string) => dimmedTagIds != null && dimmedTagIds.has(id)

  // A→B vs B→A share a chord — bend opposite ways.
  const bendFor = (e: TagEdge) => ((e.source < e.target ? 1 : -1) * 34)

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 overflow-hidden bg-[rgb(var(--color-surface-1))] cursor-grab active:cursor-grabbing"
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className="absolute overflow-visible pointer-events-none" style={{ left: 0, top: 0, width: 1, height: 1 }}>
          <defs>
            <marker id="tg-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1.5 1.5 L10.5 6 L1.5 10.5 Z" fill="context-stroke" stroke="context-stroke" strokeWidth="1.5" strokeLinejoin="round" />
            </marker>
          </defs>

          {showCoOccurrence && coOccurrence.map((c, i) => {
            const a = nodes.get(c.a); const b = nodes.get(c.b)
            if (!a || !b) return null
            if (dim(c.a) && dim(c.b)) return null
            // stop the line at each circle's edge, not its centre
            const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
            const ux = dx / len, uy = dy / len
            return (
              <line key={`co-${i}`}
                x1={a.x + ux * a.r} y1={a.y + uy * a.r}
                x2={b.x - ux * b.r} y2={b.y - uy * b.r}
                stroke="rgb(var(--color-text-muted))" strokeLinecap="round"
                strokeWidth={Math.min(6, 0.8 + Math.sqrt(c.weight))}
                opacity={0.14} />
            )
          })}

          {edges.map((e) => {
            const a = nodes.get(e.source); const b = nodes.get(e.target)
            if (!a || !b) return null
            const faded = dimmedTagIds != null && !(dimmedTagIds.has(e.source) || dimmedTagIds.has(e.target))
              ? 0.12
              : (dim(e.source) && dim(e.target) ? 0.12 : 1)
            const bend = bendFor(e)
            const { cx, cy, mx, my } = curve(a.x, a.y, b.x, b.y, bend)
            const stroke = e.color != null ? tagSlotVar(Number(e.color)) : 'rgb(var(--color-text-muted))'
            const selected = e.id === selectedEdgeId
            const arrowStart = e.arrows === 'backward' || e.arrows === 'both'
            const arrowEnd = e.arrows === 'forward' || e.arrows === 'both'
            // Pull each endpoint back to the circle's edge (plus a hair, plus room for an
            // arrowhead) along the curve's tangent, so lines/arrows only touch the rim.
            const sd = Math.hypot(cx - a.x, cy - a.y) || 1
            const ed = Math.hypot(cx - b.x, cy - b.y) || 1
            const p0x = a.x + ((cx - a.x) / sd) * (a.r + 2 + (arrowStart ? 3 : 0))
            const p0y = a.y + ((cy - a.y) / sd) * (a.r + 2 + (arrowStart ? 3 : 0))
            const p1x = b.x + ((cx - b.x) / ed) * (b.r + 2 + (arrowEnd ? 3 : 0))
            const p1y = b.y + ((cy - b.y) / ed) * (b.r + 2 + (arrowEnd ? 3 : 0))
            const d = `M ${p0x} ${p0y} Q ${cx} ${cy} ${p1x} ${p1y}`
            return (
              <g key={e.id} opacity={faded}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 3.5 : 2}
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={e.dashed ? '6 5' : undefined}
                  markerEnd={arrowEnd ? 'url(#tg-arrow)' : undefined}
                  markerStart={arrowStart ? 'url(#tg-arrow)' : undefined} />
                {/* fat invisible hit path */}
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-auto cursor-pointer"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => onEdgeClick(e.id, { x: 0, y: 0 })}
                  onMouseMove={(ev) => setHoverEdge(e.note ? { id: e.id, note: e.note, x: ev.clientX, y: ev.clientY } : null)}
                  onMouseLeave={() => setHoverEdge((h) => (h?.id === e.id ? null : h))} />
                {showLabels && e.note && (
                  <text x={mx} y={my} fontSize={10} textAnchor="middle"
                    fill="rgb(var(--color-text-secondary))" className="select-none">
                    {e.note.length > 22 ? e.note.slice(0, 21) + '…' : e.note}
                  </text>
                )}
              </g>
            )
          })}

          {/* connect rubber-band */}
          {connectDrag && nodes.get(connectDrag.from) && (
            <line
              x1={nodes.get(connectDrag.from)!.x} y1={nodes.get(connectDrag.from)!.y}
              x2={connectDrag.target ? (nodes.get(connectDrag.target)?.x ?? connectDrag.x) : connectDrag.x}
              y2={connectDrag.target ? (nodes.get(connectDrag.target)?.y ?? connectDrag.y) : connectDrag.y}
              stroke="rgb(var(--color-accent))" strokeWidth={2} strokeDasharray="5 4" opacity={0.85} />
          )}

          {/* pending-source hint ring (click-A-then-B flow) */}
          {pendingSourceId && nodes.get(pendingSourceId) && (
            <circle cx={nodes.get(pendingSourceId)!.x} cy={nodes.get(pendingSourceId)!.y}
              r={nodes.get(pendingSourceId)!.r + 6} fill="none"
              stroke="rgb(var(--color-accent))" strokeWidth={2} strokeDasharray="4 3" />
          )}
        </svg>

        {[...nodes.values()].map((n) => {
          const tag = tagById.get(n.id)
          if (!tag) return null
          const sel = n.id === selectedTagId
          const isConnectTarget = connectDrag?.target === n.id
          const hovered = hoverNodeId === n.id && !nodeDragRef.current
          return (
            <div
              key={n.id}
              className="absolute flex items-center justify-center rounded-full select-none pointer-events-auto cursor-pointer"
              style={{
                left: n.x - n.r, top: n.y - n.r, width: n.r * 2, height: n.r * 2,
                backgroundColor: resolveTagColor(tag, 0.92),
                boxShadow: NODE_GLOSS,
                outline: sel
                  ? '2px solid rgb(var(--color-text-primary))'
                  : isConnectTarget || n.id === pendingSourceId
                    ? '2px solid rgb(var(--color-accent))'
                    : hovered
                      ? '1.5px solid rgb(var(--color-text-primary) / 0.4)'
                      : 'none',
                outlineOffset: 2,
                opacity: dim(n.id) ? 0.15 : 1,
              }}
              onPointerDown={(e) => onNodePointerDown(e, n)}
              onPointerMove={onNodePointerMove}
              onPointerUp={(e) => onNodePointerUp(e, n)}
              onPointerEnter={() => setHoverNodeId(n.id)}
              onPointerLeave={() => setHoverNodeId((h) => (h === n.id ? null : h))}
              title={tag.name}
            >
              {showLabels && (
                <span
                  className="absolute whitespace-nowrap text-xs font-medium text-[rgb(var(--color-text-primary))]"
                  style={{ top: '100%', marginTop: 3, textShadow: '0 1px 2px rgb(var(--color-surface-1)), 0 0 4px rgb(var(--color-surface-1))' }}
                >
                  {tag.name}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {hoverEdge && createPortal(
        <div className="fixed z-[160] pointer-events-none px-2.5 py-1.5 rounded-shell glass-panel text-xs max-w-[240px] text-[rgb(var(--color-text-primary))]"
          style={{ left: hoverEdge.x + 12, top: hoverEdge.y + 12 }}>
          {hoverEdge.note}
        </div>,
        document.body,
      )}
    </div>
  )
}

export { ZOOM_MIN, ZOOM_MAX, clampZoom }
