import { useRef, useState, type ReactNode } from 'react'

// Generic hover-card wrapper for Study Trail's Map/Everything views — spine nodes, branch
// nodes, and edges all use this for the same "hover shows detail, click navigates" split (see
// the design spec's §3). A short delay before showing (so passing the mouse across the spine
// doesn't spam cards open) but instant hide on mouseleave; flips to the left of the trigger if
// it would overflow the window's right edge, same collision-avoidance idea StrongsTooltip
// already uses elsewhere in the app.
const SHOW_DELAY_MS = 350

export default function TrailHoverCard({ content, children, disabled }: { content: ReactNode; children: ReactNode; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  function scheduleOpen() {
    if (disabled) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const overflowsRight = rect.right + 280 > window.innerWidth
      setPos(overflowsRight
        ? { top: rect.top, right: window.innerWidth - rect.left + 8 }
        : { top: rect.top, left: rect.right + 8 })
      setOpen(true)
    }, SHOW_DELAY_MS)
  }
  function cancelOpen() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} onMouseEnter={scheduleOpen} onMouseLeave={cancelOpen} style={{ display: 'contents' }}>
      {children}
      {open && pos && (
        <div
          style={{
            position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 10000,
            maxWidth: 260, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: '9px 11px', pointerEvents: 'none',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
