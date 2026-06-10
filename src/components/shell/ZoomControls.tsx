import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn } from 'lucide-react'
import { useAppStore } from '@/store'
import { zoomPercent, ZOOM_DEFAULT, type ZoomContext } from '@/lib/zoom'

/**
 * A single ZoomIn icon that reveals a floating − % + popover on hover.
 * The popover stays open while the cursor is over either the icon or the popover.
 */
export default function ZoomControls({ context, compact = false }: { context: ZoomContext; compact?: boolean }) {
  const level = useAppStore((s) => s.panelZoom[context])
  const adjust = useAppStore((s) => s.adjustPanelZoom)
  const reset = useAppStore((s) => s.resetPanelZoom)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const anchorRef = useRef<HTMLButtonElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelHide() {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }
  function scheduleHide() {
    hideTimer.current = setTimeout(() => setOpen(false), 120)
  }
  function handleAnchorEnter() {
    cancelHide()
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect()
      // popover right-aligns to icon's right edge, drops below
      setPos({ x: r.right, y: r.bottom + 4 })
    }
    setOpen(true)
  }

  const isNonDefault = level !== ZOOM_DEFAULT
  const iconSize = compact ? 11 : 13

  const popoverBtn = 'flex items-center justify-center w-5 h-5 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors text-[11px] leading-none font-medium'

  return (
    <>
      <button
        ref={anchorRef}
        title={`Zoom (⌘+/⌘−/⌘0)${isNonDefault ? ` — ${zoomPercent(level)}` : ''}`}
        className={`flex-shrink-0 rounded p-0.5 transition-colors cursor-pointer ${
          isNonDefault
            ? 'text-[rgb(var(--color-accent))]'
            : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
        }`}
        onMouseEnter={handleAnchorEnter}
        onMouseLeave={scheduleHide}
      >
        <ZoomIn size={iconSize} />
      </button>

      {open && createPortal(
        <div
          style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, transform: 'translateX(-100%)' }}
          className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <button onClick={() => adjust(context, -1)} title="Zoom out (⌘−)" className={popoverBtn}>−</button>
          <button
            onClick={() => reset(context)}
            title="Reset zoom (⌘0)"
            className={`text-[10px] tabular-nums w-8 text-center cursor-pointer transition-colors leading-none ${isNonDefault ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'} hover:text-[rgb(var(--color-text-primary))]`}
          >
            {zoomPercent(level)}
          </button>
          <button onClick={() => adjust(context, 1)} title="Zoom in (⌘+)" className={popoverBtn}>+</button>
        </div>,
        document.body
      )}
    </>
  )
}
