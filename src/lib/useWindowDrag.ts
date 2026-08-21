import { useRef } from 'react'

/**
 * Manual, JS-tracked "drag this element to move the window" handler — an onMouseDown to spread
 * onto any element that should behave like a window-drag region.
 *
 * Deliberately NOT a real `-webkit-app-region: drag` CSS region. That approach is what
 * PanelHeader.tsx and PDFViewer.tsx's floating toolbar used before this hook existed, and it's
 * the same mechanism Sidebar.tsx, ShellHeader.tsx, Ribbon.tsx, and TabBar.tsx were all
 * individually converted away from (see their own no-drag comments, and app:moveWindowBy's
 * comment in electron/main.ts) after repeated reports of exactly two symptoms:
 *
 *  1. "Sometimes it doesn't drag" / "starts selecting text instead" — Electron computes the
 *     OS-level draggable mask from a scan of the render tree on its own schedule, not
 *     synchronously per DOM mutation, and any no-drag portal (menus, popovers, tooltips —
 *     everything in this app is `createPortal`-ed to `document.body`) that happens to overlap a
 *     real drag region purely by screen coordinates can desync from that mask. When it does,
 *     the mousedown that should start a window-drag instead falls through to normal DOM
 *     handling, which for a click-and-drag gesture over plain text reads as a text selection.
 *  2. Dragging across a multi-monitor setup (different DPI scaling per display) is where
 *     Chromium's native OS-level drag-region hit-testing is least reliable — the cursor can
 *     detach from the window mid-drag, or the drag can silently fail to start at all.
 *
 * Tracking mousedown+mousemove deltas in the renderer and moving the window via
 * `window.app.moveWindowBy` (IPC → BrowserWindow.setPosition) sidesteps both: there's no OS-level
 * drag-region mask to desync, and screen-space pixel deltas are DPI-agnostic, so crossing a
 * monitor boundary with different scaling doesn't perturb the drag. A small movement threshold
 * before the first moveWindowBy call keeps a plain click from ever nudging the window.
 *
 * `skip(e)` lets the caller exclude interactive descendants (buttons, tab items, etc.) from
 * starting a window-drag, matching the old CSS `.app-drag-region button/a/input/...` exclusion —
 * pass a predicate that returns true for targets that should behave normally instead.
 */
export function useWindowDrag(skip?: (target: HTMLElement) => boolean) {
  const dragRef = useRef<{ lastScreenX: number; lastScreenY: number; moved: boolean } | null>(null)

  function onMouseDown(e: React.MouseEvent) {
    const t = e.target as HTMLElement
    if (skip?.(t)) return
    if (e.button !== 0) return
    if (!window.app?.moveWindowBy) return
    dragRef.current = { lastScreenX: e.screenX, lastScreenY: e.screenY, moved: false }
    const DRAG_THRESHOLD = 4
    function onMove(ev: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return
      const dx = ev.screenX - drag.lastScreenX
      const dy = ev.screenY - drag.lastScreenY
      if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      drag.moved = true
      drag.lastScreenX = ev.screenX
      drag.lastScreenY = ev.screenY
      window.app.moveWindowBy(dx, dy)
    }
    function onUp() {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return onMouseDown
}

/** Default `skip` predicate: matches the old `.app-drag-region` CSS exclusion list. */
export function isInteractiveDragTarget(t: HTMLElement): boolean {
  return !!t.closest('button, a, input, select, textarea, [role="button"], [role="combobox"], [role="listbox"]')
}
