import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useAppStore } from '@/store'
import { haptic } from '../primitives/haptics'

export const BIBLE_FONT_MIN = 12
export const BIBLE_FONT_MAX = 32

/**
 * Pinch on the reader → `bibleFontSize` (R078): the real reading setting, clamped, with a
 * haptic tick at the bounds and a transient badge. Two-finger only, so single-finger scrolling
 * and the chapter pager are untouched; the browser's own zoom is suppressed by the viewport meta.
 */
export function usePinchFontSize() {
  const setBibleFontSize = useAppStore((s) => s.setBibleFontSize)
  const startDist = useRef<number | null>(null)
  const startSize = useRef(16)
  const lastApplied = useRef(16)
  const [badge, setBadge] = useState<string | null>(null)
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) return
    startDist.current = dist(e.touches)
    startSize.current = useAppStore.getState().bibleFontSize
    lastApplied.current = startSize.current
  }, [])
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || startDist.current == null) return
    e.preventDefault()
    const scale = dist(e.touches) / startDist.current
    const next = Math.round(Math.min(BIBLE_FONT_MAX, Math.max(BIBLE_FONT_MIN, startSize.current * scale)))
    if (next !== lastApplied.current) {
      if ((next === BIBLE_FONT_MIN || next === BIBLE_FONT_MAX) && lastApplied.current !== next) void haptic.light()
      lastApplied.current = next
      setBibleFontSize(next)
      setBadge(`${next} px`)
      if (badgeTimer.current) clearTimeout(badgeTimer.current)
      badgeTimer.current = setTimeout(() => setBadge(null), 900)
    }
  }, [setBibleFontSize])
  const onTouchEnd = useCallback((e: React.TouchEvent) => { if (e.touches.length < 2) startDist.current = null }, [])
  useEffect(() => () => { if (badgeTimer.current) clearTimeout(badgeTimer.current) }, [])

  return { handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }, badge }
}
