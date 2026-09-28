import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion'
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

export function NavigationStack({ root, rootKey = 'root' }: { root: React.ReactNode; rootKey?: string }) {
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
        <div className={`mobile-nav-page${stack.length ? ' is-under' : ''}`} key={rootKey} aria-hidden={stack.length > 0}>
          {root}
        </div>
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
