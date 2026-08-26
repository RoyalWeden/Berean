import { GripHorizontal, X } from 'lucide-react'

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
    <div
      className="no-drag"
      style={{
        width, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}
    >
      <div
        {...dragHandleProps}
        className="no-drag"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 10px', borderBottom: '1px solid rgb(var(--color-surface-4))',
          cursor: dragHandleProps ? 'grab' : 'default', userSelect: 'none',
          ...dragHandleProps?.style,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'rgb(var(--color-text-primary))' }}>
          {dragHandleProps && <GripHorizontal size={12} color="rgb(var(--color-text-muted))" />}
          {title}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}
