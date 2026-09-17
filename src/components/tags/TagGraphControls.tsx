import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Spline, Type } from 'lucide-react'
import { IconButton, Divider } from '@/components/ui'

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

/** Floating frosted control cluster, bottom-right of the graph canvas. Static surface (no
 *  per-frame repaint) so .material-popover's backdrop-filter is safe here. */
export default function TagGraphControls({
  onZoomIn, onZoomOut, onFit, onResetLayout,
  showCoOccurrence, showLabels, onToggleCoOccurrence, onToggleLabels,
}: Props) {
  return (
    <div className="absolute bottom-4 right-4 z-raised pointer-events-auto flex items-center gap-0.5 material-popover rounded-menu px-1.5 py-1">
      <IconButton icon={ZoomOut} label="Zoom out" size={28} onClick={onZoomOut} />
      <IconButton icon={ZoomIn} label="Zoom in" size={28} onClick={onZoomIn} />
      <IconButton icon={Maximize2} label="Fit graph" size={28} onClick={onFit} />
      <Divider orientation="vertical" className="mx-0.5" />
      <IconButton icon={RotateCcw} label="Reset layout & view" size={28} onClick={onResetLayout} />
      <IconButton
        icon={Spline}
        label={showCoOccurrence ? 'Hide shared-verse links' : 'Show shared-verse links'}
        size={28}
        active={showCoOccurrence}
        onClick={onToggleCoOccurrence}
      />
      <IconButton
        icon={Type}
        label={showLabels ? 'Hide labels' : 'Show labels'}
        size={28}
        active={showLabels}
        onClick={onToggleLabels}
      />
    </div>
  )
}
