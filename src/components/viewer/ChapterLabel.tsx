import { motion } from 'framer-motion'

/**
 * The presenter's chapter label — ONE element that lives in one of three places (TEST 2026-10-08:
 * "there should always only be one visible"):
 *
 *  - 'flash' — big and centred just under the title bar, the moment a new chapter arrives;
 *  - 'pill'  — the small capsule centred in the title bar while the page is scrolled;
 *  - 'page'  — the chapter title at the top of the page itself (no capsule), when scrolled to it.
 *
 * Moving between them is a shared-element morph (framer-motion `layoutId`): the label glides and
 * zooms from where it was to where it is now, the way an iOS navigation bar's large title becomes
 * its inline title. That only reads as one object if nothing but SIZE changes between the three —
 * so they share typography (weight, case, tracking) and em-based padding (the same aspect ratio at
 * every size, so the box scales uniformly and the text zooms rather than stretching), and the
 * capsule behind the text fades rather than popping. A critically-damped spring (no bounce), the
 * motion Apple uses for such hand-offs.
 */

export const CHAPTER_LABEL_ID = 'presenter-chapter-label'
export const CHAPTER_LABEL_SPRING = { type: 'spring', duration: 0.55, bounce: 0 } as const

export type ChapterLabelVariant = 'flash' | 'pill' | 'page'

export function ChapterLabel({ text, variant, fontSize, from }: {
  text: string
  variant: ChapterLabelVariant
  fontSize: number
  /** The variant the label is arriving from (null on first appearance) — sets where the capsule's
   *  fade starts, so going page → pill fades the capsule in instead of flashing it on. */
  from: ChapterLabelVariant | null
}) {
  const capsule = variant !== 'page'
  const capsuleFrom = from == null ? (capsule ? 1 : 0) : from === 'page' ? 0 : 1
  return (
    <motion.div
      layoutId={CHAPTER_LABEL_ID}
      transition={CHAPTER_LABEL_SPRING}
      className="relative inline-flex items-center justify-center text-text-primary"
      style={{
        fontSize,
        fontWeight: 600,
        letterSpacing: '0.01em',
        lineHeight: 1.25,
        padding: '0.3em 0.95em',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        maxWidth: '78vw',
      }}
    >
      <motion.span
        aria-hidden
        className={`absolute inset-0 ${variant === 'flash' ? 'material-sheet' : 'material-control'}`}
        style={{ borderRadius: 999 }}
        initial={{ opacity: capsuleFrom }}
        animate={{ opacity: capsule ? 1 : 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />
      <span className="relative truncate">{text}</span>
    </motion.div>
  )
}
