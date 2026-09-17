/**
 * Design-system motion presets (see docs/design-system.md → Motion).
 *
 * Two springs cover every framer-motion use in the app; pick by feel, not by component:
 *   SPRING_SNAPPY — layout/geometry that must track the pointer or a toggle instantly
 *                   (sidebar collapse, segmented-control thumb, tab pill, rail expand).
 *   SPRING_GENTLE — content that appears/settles (popovers, panels sliding in, cards).
 * Tweens use the CSS duration tokens so CSS and JS motion stay on one clock.
 *
 * Reduced motion: every renderer root wraps its tree in <MotionConfig reducedMotion="user">,
 * which makes framer skip transform/layout animation when the OS asks for it — the CSS side is
 * covered by global.css's prefers-reduced-motion rule. Nothing here needs to check it.
 */
import type { Transition } from 'framer-motion'

export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 500, damping: 45 }
export const SPRING_GENTLE: Transition = { type: 'spring', stiffness: 400, damping: 32 }

export const DURATION_FAST = 0.1
export const DURATION_BASE = 0.15
export const DURATION_SLOW = 0.22

export const TWEEN_FAST: Transition = { duration: DURATION_FAST, ease: 'easeOut' }
export const TWEEN_BASE: Transition = { duration: DURATION_BASE, ease: 'easeOut' }
export const TWEEN_SLOW: Transition = { duration: DURATION_SLOW, ease: [0.16, 1, 0.3, 1] }

/** Standard enter/exit for popovers, menus, hover cards, toasts. */
export const POP_IN = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: TWEEN_BASE,
} as const

/** Standard enter/exit for anything that drops in from a bar (find bar, selection bar). */
export const DROP_IN = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: TWEEN_BASE,
} as const
