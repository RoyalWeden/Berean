import { GripVertical, ChevronDown } from 'lucide-react'
import { IconButton, TextField } from '@/components/ui'
import type { TrailHeaderPos } from './trailWindowPrefs'

// Deliberately NOT the shared CARET_COLLAPSED_ROTATE from trailStyle.ts — that constant is
// tuned for the Threads/Map fold carets (right-when-collapsed, per that feedback), but this
// header's own collapse caret was asked to point the OTHER way (left-when-collapsed). Since
// changing the shared constant would flip every other caret in the app too, this one gets its
// own, opposite rotation instead. rotate(90deg) is clockwise, which turns a down-pointing
// chevron to point LEFT (see trailStyle.ts's own comment on this exact rotation-direction math).
const HEADER_CARET_COLLAPSED_ROTATE = 'rotate(90deg)'

// Shared floating session-header pill for both the per-session Map view (StudyTrailApp) and the
// merged "Everything" view (EverythingView) — previously each had its own copy of this markup,
// which is exactly why the collapse/drag feature below needed to land in both places identically.
//
// Per feedback ("the header block in the map is getting in the way... is there a way for it to
// minimize/collapse and be moved around when the user wants"): collapsed shows just the title in
// a small chip; a drag handle (the grip icon, always visible) lets the whole thing be repositioned
// anywhere in the map viewport. `pos` is null until the user drags it at least once — until then
// the caller's own `side` ('left'/'right', from the live layoutRoom-avoidance logic) still applies.
//
// The live current-hour display used to live inside this pill — moved OUT to its own separate
// floating badge (see StudyTrailApp's renderCurrentHourBadge) so it stays visible even while this
// header is collapsed.
export default function TrailMapHeader({
  side, collapsed, onToggleCollapsed, pos, onDragStart, title, filterValue, onFilterChange, statsLine,
}: {
  side: 'left' | 'right'
  collapsed: boolean
  onToggleCollapsed: () => void
  pos: TrailHeaderPos | null
  onDragStart: (e: React.MouseEvent) => void
  title: React.ReactNode
  filterValue: string
  onFilterChange: (v: string) => void
  statsLine: React.ReactNode
}) {
  return (
    <div
      className="material-popover rounded-menu"
      style={{
        position: 'absolute', zIndex: 'var(--z-raised)' as unknown as number, width: 'fit-content', maxWidth: collapsed ? 180 : 260,
        top: pos ? pos.y : 0,
        ...(pos ? { left: pos.x } : side === 'left' ? { left: 0 } : { right: 0 }),
        display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 9px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <GripVertical
          size={13}
          onMouseDown={onDragStart}
          className="flex-shrink-0 text-text-muted opacity-60"
          style={{ cursor: 'grab' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
        <IconButton
          icon={ChevronDown} label={collapsed ? 'Expand' : 'Collapse'} size={20} tooltip={false}
          onClick={onToggleCollapsed}
          style={{ transform: collapsed ? HEADER_CARET_COLLAPSED_ROTATE : undefined, transition: 'transform 120ms' }}
        />
      </div>
      {!collapsed && (
        <>
          <TextField
            value={filterValue}
            onChange={(e) => onFilterChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') window.dispatchEvent(new CustomEvent('berean:trailFilterSubmit')) }}
            placeholder="Filter timeline…"
            size="sm"
          />
          <div className="text-caption text-text-secondary">{statsLine}</div>
        </>
      )}
    </div>
  )
}
