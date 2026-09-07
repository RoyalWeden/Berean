import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Spline, Type } from 'lucide-react'

interface Props {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetLayout: () => void
  showCoOccurrence: boolean
  showLabels: boolean
  onToggleCoOccurrence: () => void
  onToggleLabels: () => void
}

const BASE = 'w-7 h-7 rounded-shell flex items-center justify-center transition-colors cursor-pointer'
const IDLE = 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
const TOGGLED = 'bg-[rgb(var(--color-accent)/0.18)] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent)/0.28)]'

/** Floating frosted control cluster, bottom-right of the graph canvas. Static surface (no
 *  per-frame repaint) so .glass-panel's backdrop-filter is safe here. */
export default function TagGraphControls({
  onZoomIn, onZoomOut, onFit, onResetLayout,
  showCoOccurrence, showLabels, onToggleCoOccurrence, onToggleLabels,
}: Props) {
  return (
    <div className="absolute bottom-4 right-4 z-20 pointer-events-auto flex items-center gap-0.5 rounded-shell-lg glass-panel px-1.5 py-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
      <button className={`${BASE} ${IDLE}`} title="Zoom out" onClick={onZoomOut}><ZoomOut size={14} /></button>
      <button className={`${BASE} ${IDLE}`} title="Zoom in" onClick={onZoomIn}><ZoomIn size={14} /></button>
      <button className={`${BASE} ${IDLE}`} title="Fit graph" onClick={onFit}><Maximize2 size={14} /></button>
      <span className="w-px self-stretch mx-0.5 bg-[rgb(var(--color-surface-4))]" />
      <button className={`${BASE} ${IDLE}`} title="Reset layout & view" onClick={onResetLayout}><RotateCcw size={14} /></button>
      <button
        className={`${BASE} ${showCoOccurrence ? TOGGLED : IDLE}`}
        title={showCoOccurrence ? 'Hide shared-verse links' : 'Show shared-verse links'}
        aria-pressed={showCoOccurrence}
        onClick={onToggleCoOccurrence}
      ><Spline size={14} /></button>
      <button
        className={`${BASE} ${showLabels ? TOGGLED : IDLE}`}
        title={showLabels ? 'Hide labels' : 'Show labels'}
        aria-pressed={showLabels}
        onClick={onToggleLabels}
      ><Type size={14} /></button>
    </div>
  )
}
