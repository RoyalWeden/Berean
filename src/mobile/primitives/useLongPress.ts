import { useRef, useCallback } from 'react'
import type React from 'react'

/**
 * Long-press detection for touch (iOS WKWebView does not fire `contextmenu` on a press).
 * Cancels on movement (> 8 px) so scrolling never triggers it; suppresses the click that
 * follows a completed long press.
 */
export function useLongPress(onLongPress: (e: { clientX: number; clientY: number; target: EventTarget | null }) => void, delayMs = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    start.current = null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    fired.current = false
    start.current = { x: e.clientX, y: e.clientY }
    const target = e.target
    const x = e.clientX, y = e.clientY
    timer.current = setTimeout(() => {
      timer.current = null
      fired.current = true
      onLongPress({ clientX: x, clientY: y, target })
    }, delayMs)
  }, [onLongPress, delayMs])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return
    if (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8) clear()
  }, [clear])

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (fired.current) { e.stopPropagation(); e.preventDefault(); fired.current = false }
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear, onClickCapture }
}
