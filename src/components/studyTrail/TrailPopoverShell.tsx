import { GripHorizontal, X } from 'lucide-react'
import { IconButton, cx } from '@/components/ui'

// Shared visual shell for every note/reason-related popover in the Study Trail window
// (ReasonPromptPopover, the arrival prompt's full-popup variant) — per direct feedback ("make
// sure all of the note things for the study trail look pretty similar / uniform so that they
// dont look like they are for different things"), one common header/border/radius/shadow
// instead of each popover hand-rolling its own. TrailHoverCard's own card and TrailNoteBubble
// content already share this same rounded/bordered/shadowed look independently (they're plain
// hover bubbles, not draggable popups, so they don't need this header) — this shell just brings
// the two draggable popups in line with that same family look.
export default function TrailPopoverShell({
  title, onClose, width, children, dragHandleProps,
}: {
  title: string
  onClose: () => void
  width: number
  children: React.ReactNode
  /** Spread onto the header for drag-to-move — omitted entirely renders a plain, static header
   *  (the arrival prompt's compact variant doesn't need to be draggable). */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}) {
  return (
    <div className="no-drag material-popover rounded-menu overflow-hidden" style={{ width }}>
      <div
        {...dragHandleProps}
        className={cx('no-drag border-b border-separator flex items-center justify-between gap-2 px-2.5 py-2 select-none', dragHandleProps ? 'cursor-grab' : 'cursor-default')}
        style={dragHandleProps?.style}
      >
        <div className="flex items-center gap-1.5 text-footnote font-semibold text-text-primary">
          {dragHandleProps && <GripHorizontal size={12} className="text-text-muted" />}
          {title}
        </div>
        <IconButton icon={X} label="Close" size={20} tooltip={false} onClick={onClose} />
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
