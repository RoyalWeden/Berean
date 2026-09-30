import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, type PanInfo } from 'framer-motion'
import { haptic } from '../primitives/haptics'

/**
 * A per-space navigation stack (R070): `push` slides a page in from the right, `pop` slides it
 * out; an edge swipe from the left (first 28 px) pops interactively. The root page is always
 * present. Pages are plain React elements keyed by a stable id so re-rendering the stack keeps
 * their state.
 */
export interface StackEntry { key: string; element: React.ReactNode }

interface NavApi {
  push: (key: string, element: React.ReactNode) => void
  pop: () => void
  popToRoot: () => void
  replaceTop: (key: string, element: React.ReactNode) => void
  depth: number
}
const NavContext = createContext<NavApi | null>(null)
export function useNavigation(): NavApi {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNavigation() outside <NavigationStack>')
  return ctx
}

const EDGE_PX = 28
const POP_DISTANCE = 90
/** Root-page edge swipe (tab history back / close): a narrower strip than pushed pages so the
 *  reader's own chapter-edge tap strip and text selection keep working. */
const ROOT_EDGE_PX = 20

export function NavigationStack({ root, rootKey = 'root', canEdgeBack, onEdgeBack }: {
  root: React.ReactNode
  rootKey?: string
  /** The root page's edge swipe (iOS back gesture) — see navigation/edgeBack.ts. */
  canEdgeBack?: () => boolean
  onEdgeBack?: () => void
}) {
  const [stack, setStack] = useState<StackEntry[]>([])
  const push = useCallback((key: string, element: React.ReactNode) => {
    setStack((s) => [...s.filter((e) => e.key !== key), { key, element }])
  }, [])
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), [])
  const popToRoot = useCallback(() => setStack([]), [])
  const replaceTop = useCallback((key: string, element: React.ReactNode) => {
    setStack((s) => [...s.slice(0, -1), { key, element }])
  }, [])
  const api = useMemo(() => ({ push, pop, popToRoot, replaceTop, depth: stack.length }), [push, pop, popToRoot, replaceTop, stack.length])

  return (
    <NavContext.Provider value={api}>
      <div className="mobile-nav-stack">
        <RootPage key={rootKey} under={stack.length > 0} canEdgeBack={canEdgeBack} onEdgeBack={onEdgeBack}>{root}</RootPage>
        <AnimatePresence initial={false}>
          {stack.map((e, i) => (
            <PushedPage key={e.key} isTop={i === stack.length - 1} onPop={pop}>{e.element}</PushedPage>
          ))}
        </AnimatePresence>
      </div>
    </NavContext.Provider>
  )
}

function PushedPage({ children, isTop, onPop }: { children: React.ReactNode; isTop: boolean; onPop: () => void }) {
  const dragControls = useDragControls()
  return (
    <motion.div
      className="mobile-nav-page is-pushed"
      initial={{ x: '100%' }}
      animate={{ x: 0, transition: { type: 'spring', stiffness: 380, damping: 38 } }}
      exit={{ x: '100%', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      drag={isTop ? 'x' : false}
      dragControls={dragControls}
      dragListener={false}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.6 }}
      onDragEnd={(_: unknown, info: PanInfo) => {
        if (info.offset.x > POP_DISTANCE || info.velocity.x > 600) { void haptic.light(); onPop() }
      }}
      aria-hidden={!isTop}
      // Only a drag that begins at the screen's left edge becomes the pop gesture; anywhere else
      // the content scrolls / selects normally.
      onPointerDown={(e) => { if (isTop && e.clientX <= EDGE_PX) dragControls.start(e) }}
    >
      {children}
    </motion.div>
  )
}

/**
 * The tab's root page. An edge swipe (first 20 px) drags it right like an iOS back gesture; on
 * release past the threshold it slides off and `onEdgeBack` steps the tab's history back (or closes
 * the tab at its first step), and the next page is shown in place. The swipe is claimed in the
 * CAPTURE phase so the reader's chapter pager never also sees it.
 */
function RootPage({ children, under, canEdgeBack, onEdgeBack }: { children: React.ReactNode; under: boolean; canEdgeBack?: () => boolean; onEdgeBack?: () => void }) {
  const dragControls = useDragControls()
  const x = useMotionValue(0)
  const [dragging, setDragging] = useState(false)
  const busy = useRef(false)
  const enabled = !!onEdgeBack && !under
  return (
    <motion.div
      className={`mobile-nav-page${under ? ' is-under' : ''}${dragging ? ' is-edge-dragging' : ''}`}
      aria-hidden={under}
      style={{ x }}
      drag={enabled ? 'x' : false}
      dragControls={dragControls}
      dragListener={false}
      dragDirectionLock
      dragMomentum={false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 1 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={(_: unknown, info: PanInfo) => {
        setDragging(false)
        const width = typeof window !== 'undefined' ? window.innerWidth : 390
        if (!busy.current && (info.offset.x > POP_DISTANCE || info.velocity.x > 600)) {
          busy.current = true
          void haptic.light()
          void animate(x, width, { duration: 0.18, ease: [0.32, 0.72, 0, 1] }).then(() => {
            onEdgeBack?.()
            x.set(0)
            busy.current = false
          })
        } else animate(x, 0, { type: 'spring', stiffness: 420, damping: 40 })
      }}
      onPointerDownCapture={(e) => {
        if (!enabled || busy.current || e.clientX > ROOT_EDGE_PX || (e.pointerType === 'mouse' && e.button !== 0)) return
        if (canEdgeBack && !canEdgeBack()) return
        e.stopPropagation()
        dragControls.start(e)
      }}
    >
      {children}
    </motion.div>
  )
}
