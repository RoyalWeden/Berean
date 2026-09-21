import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { haptic } from './haptics'

/**
 * Bottom sheet with detents (R073): collapsed → drag up → expanded → full → drag down → dismiss.
 * Detents are fractions of the viewport height. The sheet body scrolls when at the top detent;
 * a downward drag from a scrolled-to-top body, or on the grabber, moves the sheet.
 */
export interface SheetOptions {
  id: string
  title?: string
  /** Fractions of the viewport height, ascending. Default [0.45, 0.92]. */
  detents?: number[]
  /** Index into `detents` to open at. Default 0. */
  initialDetent?: number
  render: (api: SheetApi) => React.ReactNode
  onClose?: () => void
}
export interface SheetApi {
  close: () => void
  expand: () => void
  detent: number
}

interface SheetHostState {
  open: (o: SheetOptions) => void
  close: (id?: string) => void
  /** Top-most open sheet id. */
  currentId: string | null
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
  const open = useCallback((o: SheetOptions) => {
    setStack((s) => [...s.filter((x) => x.id !== o.id), o])
  }, [])
  const close = useCallback((id?: string) => {
    setStack((s) => {
      const target = id ?? s[s.length - 1]?.id
      const closing = s.find((x) => x.id === target)
      closing?.onClose?.()
      return s.filter((x) => x.id !== target)
    })
  }, [])
  const value = useMemo(() => ({ open, close, currentId: stack[stack.length - 1]?.id ?? null }), [open, close, stack])
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

function SheetView({ options, onClose, depth }: { options: SheetOptions; onClose: () => void; depth: number }) {
  const detents = options.detents ?? [0.45, 0.92]
  const [detentIndex, setDetentIndex] = useState(Math.min(options.initialDetent ?? 0, detents.length - 1))
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const heightFor = (i: number) => Math.round(vh * detents[i])
  const y = useMotionValue(vh)
  const dragControls = useDragControls()
  const bodyRef = useRef<HTMLDivElement>(null)
  const targetY = (i: number) => vh - heightFor(i)

  useEffect(() => {
    animate(y, targetY(detentIndex), { type: 'spring', stiffness: 420, damping: 40 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detentIndex])

  const settle = (_: unknown, info: PanInfo) => {
    const current = y.get() + info.velocity.y * 0.15
    // Fling down past the lowest detent → close
    if (current > vh - heightFor(0) * 0.6 || (info.velocity.y > 900 && detentIndex === 0)) { void haptic.light(); onClose(); return }
    let best = 0, bestDist = Infinity
    for (let i = 0; i < detents.length; i++) { const d = Math.abs(targetY(i) - current); if (d < bestDist) { bestDist = d; best = i } }
    if (best !== detentIndex) void haptic.selection()
    setDetentIndex(best)
    animate(y, targetY(best), { type: 'spring', stiffness: 420, damping: 40 })
  }

  const api: SheetApi = { close: onClose, expand: () => setDetentIndex(detents.length - 1), detent: detentIndex }
  const atTop = detentIndex === detents.length - 1

  return (
    <>
      <motion.div
        className="mobile-sheet-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ zIndex: 100 + depth * 2 }}
        aria-hidden
      />
      <motion.div
        className="mobile-sheet"
        role="dialog" aria-modal="true" aria-label={options.title}
        style={{ y, height: heightFor(detents.length - 1), zIndex: 101 + depth * 2 }}
        initial={{ y: vh }}
        exit={{ y: vh, transition: { duration: 0.22 } }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: targetY(detents.length - 1), bottom: vh }}
        dragElastic={{ top: 0.05, bottom: 0.2 }}
        onDragEnd={settle}
      >
        <div
          className="mobile-sheet-grabber-area"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="mobile-sheet-grabber" />
          {options.title && <div className="mobile-sheet-title">{options.title}</div>}
          {/* Explicit close for VoiceOver / Switch Control users who cannot drag or reach the backdrop. */}
          <button type="button" className="mobile-sheet-close" aria-label="Close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="mobile-sheet-body"
          style={{ overflowY: atTop ? 'auto' : 'hidden' }}
          onPointerDown={(e) => {
            // Body scrolled to the top (or not scrollable at this detent): the drag moves the sheet.
            const el = bodyRef.current
            if (!atTop || (el && el.scrollTop <= 0)) dragControls.start(e)
          }}
        >
          {options.render(api)}
        </div>
      </motion.div>
    </>
  )
}
