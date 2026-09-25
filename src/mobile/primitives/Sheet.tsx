import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import './sheet.css'
import { AnimatePresence, motion, useDragControls, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { X, ChevronLeft } from 'lucide-react'
import { haptic } from './haptics'
import { sheetTakesOver, followY, handsBackToContent, releaseVelocity, blurActiveEditable, scrollOwner } from './sheetGesture'

interface BodyGesture {
  x: number; y: number; lastY: number
  /** Decided vertical (a horizontal gesture drops the tracking). */
  vertical: boolean
  mode: 'content' | 'sheet'
  /** Direction of the hand-off to the sheet: 1 = down, -1 = up. */
  dir: 1 | -1
  /** Sheet y and finger y where the sheet took over. */
  baseY: number; fingerAt: number
  /** False once this touch's first move was prevented (WebKit then scrolls nothing natively). */
  nativeScroll: boolean
  scroller: HTMLElement
  samples: Array<{ t: number; y: number }>
}

/**
 * Bottom sheet with detents (R073; reworked for TEST-026/027/040).
 *
 * Detent model — one reusable, per-sheet configuration instead of per-sheet hacks:
 *   • `detents` — fractions of the viewport height, ascending (MEDIUM, LARGE, …).
 *   • `lowDetent` — OPTIONAL special LOW / "verse-min" position below the others, given in px.
 *     Only verse-related sheets use it (the verse sheet, verse notes, cross references). At the
 *     low position the sheet is non-modal (no backdrop — the reader stays interactive so a text
 *     selection can still be adjusted) and it is the ONLY position that shows an explicit ✕.
 *     The caret sheet and the tab-cards sheet deliberately have no low detent.
 *   • `undimmedThrough` — highest detent index (counting the low detent as 0 when present) that
 *     keeps the page behind interactive (no backdrop). Default: only the low detent.
 * Dismissal is standard iOS: tap the backdrop, drag down past the lowest position, or a fast
 * downward fling from ANY position. There is no visible ✕ at the other positions; a visually
 * hidden Close button stays for VoiceOver / Switch Control.
 * The drag handle is a taller dedicated strip (the grabber area); the body hands a drag to the
 * sheet only at the content's scroll boundary (sheetGesture.ts), with no rubber-banding inside.
 *
 * Sheets are NAVIGABLE SURFACES (T23-006/012/019, mobile-navigation.md §5). A control inside a
 * sheet that shows another view of the same context calls `api.push({ title, render })`: the SAME
 * sheet replaces its content (slide forward) and its top shows a contextual back control
 * ("‹ Scripture", "‹ Tabs") that pops back to the previous view (slide back). No second sheet is
 * stacked on top. Any component rendered in a sheet can reach this through `useSheetApi()`.
 * Opening a genuinely separate surface (the audio player, a new-tab flow from elsewhere) is still
 * `useSheets().open`.
 */
export interface SheetOptions {
  id: string
  title?: string
  /** Fractions of the viewport height, ascending. Default [0.45, 0.92]. */
  detents?: number[]
  /** Special low position (px of visible sheet) — verse-related sheets only. */
  lowDetent?: number
  /** Index into the full detent list (low detent included) to open at. Default 0. */
  initialDetent?: number
  /** Highest detent index that keeps the page behind interactive. Default: 0 when a low detent exists, else -1. */
  undimmedThrough?: number
  /** Move an ALREADY-OPEN sheet to a detent (e.g. back to the low position while a text selection
   *  is being adjusted). A new `nonce` re-applies it. */
  forceDetent?: { index: number; nonce: number }
  /** Name of the root view, shown as the back label once a sub-view is pushed ("‹ Scripture").
   *  Defaults to `title`. */
  rootTitle?: string
  render: (api: SheetApi) => React.ReactNode
  onClose?: () => void
}
/** A sub-view shown inside the same sheet (see the navigable-surface note above). */
export interface SheetSubView {
  /** Stable identity (for transitions and de-duplication). */
  key: string
  /** Shown centred at the top of the sheet, and as the back label of any view pushed after it. */
  title: string
  render: (api: SheetApi) => React.ReactNode
}
export interface SheetApi {
  close: () => void
  expand: () => void
  /** Move to a detent index (low detent = 0 when present). */
  setDetent: (i: number) => void
  detent: number
  /** True while the sheet sits at its special low position. */
  atLow: boolean
  /** Show a sub-view in this same sheet, with a back control to the current view. */
  push: (view: SheetSubView) => void
  /** Back to the previous view (no-op at the root). */
  pop: () => void
  popToRoot: () => void
  /** 0 at the root view. */
  depth: number
}
const SheetApiContext = createContext<SheetApi | null>(null)
/** The sheet the calling component is rendered in (null outside a sheet). */
export function useSheetApi(): SheetApi | null { return useContext(SheetApiContext) }

interface SheetHostState {
  open: (o: SheetOptions) => void
  close: (id?: string) => void
  /** Update an open sheet in place (e.g. a new verse in the same verse sheet). */
  update: (id: string, patch: Partial<SheetOptions>) => void
  /** Top-most open sheet id. */
  currentId: string | null
  isOpen: (id: string) => boolean
}
const SheetContext = createContext<SheetHostState | null>(null)

export function useSheets(): SheetHostState {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error('useSheets() outside <SheetHost>')
  return ctx
}

/** Renders the open sheets (stacked) above the app; put it once at the root. */
export function SheetHost({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<SheetOptions[]>([])
  const stackRef = useRef(stack)
  stackRef.current = stack
  const open = useCallback((o: SheetOptions) => {
    setStack((s) => [...s.filter((x) => x.id !== o.id), o])
  }, [])
  const update = useCallback((id: string, patch: Partial<SheetOptions>) => {
    setStack((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }, [])
  const close = useCallback((id?: string) => {
    setStack((s) => {
      const target = id ?? s[s.length - 1]?.id
      const closing = s.find((x) => x.id === target)
      closing?.onClose?.()
      return s.filter((x) => x.id !== target)
    })
  }, [])
  const isOpen = useCallback((id: string) => stackRef.current.some((x) => x.id === id), [])
  const value = useMemo(() => ({ open, close, update, isOpen, currentId: stack[stack.length - 1]?.id ?? null }), [open, close, update, isOpen, stack])
  return (
    <SheetContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {stack.map((o, i) => (
          <SheetView key={o.id} options={o} onClose={() => close(o.id)} depth={i} />
        ))}
      </AnimatePresence>
    </SheetContext.Provider>
  )
}

/** Resolved heights (px) of every detent, low detent first when present. Exported for tests. */
export function resolveDetentHeights(vh: number, detents: number[], lowDetent?: number): number[] {
  const hs = detents.map((d) => Math.round(vh * d))
  return lowDetent != null ? [Math.min(lowDetent, hs[0] ?? lowDetent), ...hs] : hs
}

/** Where a release lands: -1 = dismiss, else the detent index. Exported for tests. */
export function settleDetent(opts: { heights: number[]; vh: number; releaseY: number; velocityY: number; current: number }): number {
  const { heights, vh, releaseY, velocityY, current } = opts
  // A fast downward fling closes the sheet from ANY position (TEST-040).
  if (velocityY > 1400) return -1
  const projected = releaseY + velocityY * 0.15
  // Dragged well below the lowest position → close.
  if (projected > vh - heights[0] * 0.55) return -1
  if (velocityY > 900 && current === 0) return -1
  let best = 0, bestDist = Infinity
  for (let i = 0; i < heights.length; i++) {
    const d = Math.abs(vh - heights[i] - projected)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

function SheetView({ options, onClose, depth }: { options: SheetOptions; onClose: () => void; depth: number }) {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const hasLow = options.lowDetent != null
  const heights = useMemo(() => resolveDetentHeights(vh, options.detents ?? [0.45, 0.92], options.lowDetent), [vh, options.detents, options.lowDetent])
  const [detentIndex, setDetentIndex] = useState(Math.min(options.initialDetent ?? 0, heights.length - 1))
  const forceNonce = options.forceDetent?.nonce
  useEffect(() => {
    if (options.forceDetent) setDetentIndex(Math.max(0, Math.min(heights.length - 1, options.forceDetent.index)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceNonce])
  const y = useMotionValue(vh)
  const dragControls = useDragControls()
  const bodyRef = useRef<HTMLDivElement>(null)
  const targetY = (i: number) => vh - heights[i]
  const top = heights.length - 1

  useEffect(() => {
    animate(y, targetY(detentIndex), { type: 'spring', stiffness: 420, damping: 40 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detentIndex, heights])

  const settleAt = (velocityY: number) => {
    const next = settleDetent({ heights, vh, releaseY: y.get(), velocityY, current: detentIndex })
    if (next < 0) { void haptic.light(); onClose(); return }
    if (next !== detentIndex) void haptic.selection()
    setDetentIndex(next)
    animate(y, targetY(next), { type: 'spring', stiffness: 420, damping: 40 })
  }
  const settle = (_: unknown, info: PanInfo) => settleAt(info.velocity.y)

  // ── in-sheet navigation stack ──────────────────────────────────────────────────────────
  const [views, setViews] = useState<SheetSubView[]>([])
  const openedAt = useRef(Date.now())
  const [viewAnim, setViewAnim] = useState('')
  const [direction, setDirection] = useState<1 | -1>(1)
  const scrollMemo = useRef<number[]>([])
  // A reopened / updated sheet (new options object) starts again at its root view.
  useEffect(() => { setViews([]) }, [options])
  const push = useCallback((view: SheetSubView) => {
    scrollMemo.current[views.length] = bodyRef.current?.scrollTop ?? 0
    setDirection(1)
    setViewAnim(Date.now() - openedAt.current < 450 ? '' : 'is-forward')
    setViews((v) => [...v.filter((x) => x.key !== view.key), view])
    // The sheet keeps its detent, position and size when its content changes (NEW-002).
    void haptic.selection()
  }, [views.length])
  const pop = useCallback(() => {
    setDirection(-1)
    setViewAnim('is-back')
    setViews((v) => v.slice(0, -1))
  }, [])
  const popToRoot = useCallback(() => { setDirection(-1); setViewAnim('is-back'); setViews([]) }, [])
  // Restore the parent view's scroll position after a pop; a pushed view starts at its top.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = direction < 0 ? (scrollMemo.current[views.length] ?? 0) : 0
  }, [views.length, direction])

  const atLow = hasLow && detentIndex === 0
  const undimmedThrough = options.undimmedThrough ?? (hasLow ? 0 : -1)
  const dimmed = detentIndex > undimmedThrough
  const api: SheetApi = {
    close: onClose, expand: () => setDetentIndex(top), setDetent: (i) => setDetentIndex(Math.max(0, Math.min(top, i))), detent: detentIndex, atLow,
    push, pop, popToRoot, depth: views.length,
  }
  const atTop = detentIndex === top
  const current = views[views.length - 1]
  // Body gesture (SEP25 SHEET-GESTURE): boundary-driven, re-decided on EVERY native touchmove
  // (sheetGesture.ts). The content scrolls until it reaches its boundary in the drag's direction —
  // top while dragging down, bottom (or nothing to scroll) while dragging up below the top detent —
  // and from that exact point the sheet follows the finger (no jump); pulling back past the
  // hand-off point returns the gesture to the content. Release settles by velocity like
  // UISheetPresentationController. The sheet itself is moved here (not framer's drag), so the
  // hand-off can start mid-gesture. The keyboard is dismissed the moment the sheet starts moving.
  const bodyGesture = useRef<BodyGesture | null>(null)
  const live = useRef({ atTop, top, targetY, settleAt })
  live.current = { atTop, top, targetY, settleAt }
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      const target = e.target as HTMLElement
      // Horizontal rows opt out; a touch inside a FOCUSED multi-line editor adjusts its selection.
      const focusedEditor = target.closest?.('textarea, [contenteditable="true"]')
      if (e.touches.length > 1 || !t || target.closest?.('[data-no-sheet-drag]') || (focusedEditor && focusedEditor.contains(document.activeElement))) { bodyGesture.current = null; return }
      bodyGesture.current = { x: t.clientX, y: t.clientY, lastY: t.clientY, vertical: false, mode: 'content', dir: 1, baseY: 0, fingerAt: 0, nativeScroll: true, scroller: scrollOwner(target, el), samples: [] }
    }
    const onMove = (e: TouchEvent) => {
      const g = bodyGesture.current
      const t = e.touches[0]
      if (!g || !t) return
      if (e.touches.length > 1) { bodyGesture.current = null; return }
      let first = false
      if (!g.vertical) {
        const dy = t.clientY - g.y, dx = t.clientX - g.x
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return
        if (Math.abs(dy) < Math.abs(dx)) { bodyGesture.current = null; return } // horizontal: not ours
        g.vertical = true
        first = true
      }
      const L = live.current
      const step = t.clientY - g.lastY
      g.lastY = t.clientY
      const sc = g.scroller
      if (g.mode === 'content') {
        if (sheetTakesOver(step, sc, L.atTop)) {
          g.mode = 'sheet'; g.dir = step > 0 ? 1 : -1
          y.stop(); g.baseY = y.get(); g.fingerAt = t.clientY - step; g.samples = []
          blurActiveEditable()
        } else if (!g.nativeScroll) {
          // Native scrolling was blocked for this touch (it began as a sheet drag): scroll by hand.
          sc.scrollTop -= step
          if (e.cancelable) e.preventDefault()
          return
        } else return
      }
      // The sheet follows the finger.
      if (e.cancelable) { e.preventDefault(); if (first) g.nativeScroll = false }
      else sc.scrollTop = g.dir === 1 ? 0 : sc.scrollHeight - sc.clientHeight // a native scroll is running: pin it at its boundary
      const ny = followY(g.baseY, t.clientY - g.fingerAt, L.targetY(L.top), vh)
      if (handsBackToContent(g.dir, g.baseY, ny)) {
        y.set(g.baseY); g.mode = 'content'
        if (!g.nativeScroll) sc.scrollTop -= ny - g.baseY
        return
      }
      y.set(ny)
      g.samples.push({ t: e.timeStamp || Date.now(), y: t.clientY })
      if (g.samples.length > 8) g.samples.shift()
    }
    const onEnd = () => {
      const g = bodyGesture.current
      bodyGesture.current = null
      if (g?.mode === 'sheet') live.current.settleAt(releaseVelocity(g.samples))
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const backLabel = views.length > 1 ? views[views.length - 2].title : (options.rootTitle ?? options.title ?? 'Back')
  const headerTitle = current ? current.title : options.title

  return (
    <>
      {dimmed && (
        <motion.div
          className="mobile-sheet-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ zIndex: 100 + depth * 2 }}
          aria-hidden
        />
      )}
      <motion.div
        className={`mobile-sheet${atLow ? ' is-low' : ''}`}
        role="dialog" aria-modal={dimmed} aria-label={options.title}
        data-sheet-id={options.id}
        data-detent={detentIndex}
        style={{ y, height: heights[top], zIndex: 101 + depth * 2 }}
        initial={{ y: vh }}
        exit={{ y: vh, transition: { duration: 0.22 } }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: targetY(top), bottom: vh }}
        dragElastic={{ top: 0.05, bottom: 0.2 }}
        onDragStart={() => { blurActiveEditable() }}
        onDragEnd={settle}
      >
        <div className="mobile-sheet-grabber-area" onPointerDown={(e) => dragControls.start(e)}>
          <div className="mobile-sheet-grabber" />
          {current ? (
            <div className="mobile-sheet-nav">
              <button type="button" className="mobile-sheet-back" onClick={pop} onPointerDown={(e) => e.stopPropagation()} aria-label={`Back to ${backLabel}`}>
                <ChevronLeft size={22} aria-hidden /><span>{backLabel}</span>
              </button>
              <div className="mobile-sheet-title is-nav" aria-live="polite">{headerTitle}</div>
            </div>
          ) : headerTitle && <div className="mobile-sheet-title">{headerTitle}</div>}
          {/* ✕ only at the special low (verse) position — elsewhere the sheet is dismissed the
              iOS way. Screen-reader users always get a Close button (visually hidden). */}
          <button
            type="button"
            className={atLow ? 'mobile-sheet-close' : 'mobile-sr-only'}
            aria-label="Close"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="mobile-sheet-body"
          // Content scrolls at EVERY detent (NEW-003: the half-open Tabs sheet could not scroll). The
          // part of the sheet below the screen edge at a partial detent is padded out, so the last
          // rows can be scrolled into view.
          style={{ overflowY: 'auto', overscrollBehavior: 'none', paddingBottom: `calc(var(--m-safe-bottom) + 16px + ${Math.max(0, heights[top] - heights[detentIndex])}px)` }}
        >
          <SheetApiContext.Provider value={api}>
            {/* A CSS keyframe slide (SEP24-011): it always runs to completion, so a view can never be
                left parked part-way (the framer presence spring could be interrupted — e.g. a view
                pushed while the sheet itself was still opening — leaving the list shifted sideways).
                Views pushed while the sheet opens appear without a slide. */}
            <div key={current?.key ?? '__root'} className={`mobile-sheet-view${viewAnim ? ` ${viewAnim}` : ''}`}>
              {current ? current.render(api) : options.render(api)}
            </div>
          </SheetApiContext.Provider>
        </div>
      </motion.div>
    </>
  )
}
