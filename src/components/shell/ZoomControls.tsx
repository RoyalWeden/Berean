import { useState, useRef, useLayoutEffect } from 'react'
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
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverWidthRef = useRef(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelHide() {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }
  function scheduleHide() {
    // 350ms gives the cursor enough time to travel diagonally from the icon
    // to the popover without the menu vanishing in between.
    hideTimer.current = setTimeout(() => setOpen(false), 350)
  }
  function handleAnchorEnter() {
    cancelHide()
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect()
      // Store anchor right/bottom; MenuPositioner-style clamping runs after render.
      setPos({ x: r.right, y: r.bottom + 4 })
    }
    setOpen(true)
  }

  // Clamp after render: popover right-aligns to anchor's right edge but must stay on-screen.
  useLayoutEffect(() => {
    const el = popoverRef.current
    if (!open || !el) return
    const { width, height } = el.getBoundingClientRect()
    popoverWidthRef.current = width
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Right-align: left = pos.x - width; flip down/up as needed
    let x = pos.x - width
    let y = pos.y
    if (x < pad) x = pad
    if (x + width + pad > vw) x = vw - width - pad
    if (y + height + pad > vh) y = Math.max(pad, pos.y - height - (anchorRef.current?.getBoundingClientRect().height ?? 0) - 4 - 4)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.transform = 'none'
  })

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
        <>
          {/* Invisible bridge: covers the gap between the icon bottom and popover top
              so diagonal mouse movement doesn't trigger onMouseLeave and close the menu. */}
          <div
            style={{
              position: 'fixed',
              left: pos.x - (popoverWidthRef.current || 80),
              top: pos.y - 8,
              width: popoverWidthRef.current || 80,
              height: 12,
              zIndex: 9998,
            }}
            onMouseEnter={cancelHide}
          />
          <div
            ref={popoverRef}
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
          </div>
        </>,
        document.body
      )}
    </>
  )
}
