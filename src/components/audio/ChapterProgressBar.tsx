import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useChapterProgress } from '@/hooks/useChapterProgress'

interface ChapterProgressBarProps {
  bookId: string
  chapter: number
  textId: string
  currentVerseNum: number
  /** Verse-range playback (see AudioPlaybackState.endVerse) — when set, the bar (and its seek
   *  range) ends here instead of at the end of the whole chapter. */
  endVerseNum?: number | null
  onSeek: (verseNum: number) => void
  /** Whether the parent pill is already hovered/expanded. Drives the bar's thicker/interactive
   *  look directly, instead of the bar re-deriving its own hover state — see the doc comment on
   *  the `active` prop at its call site (AudioPlayer.tsx) for why a bar-local mouseenter alone
   *  doesn't reliably fire here. */
  active?: boolean
}

/**
 * Thin always-visible progress line across the top of the collapsed pill, showing how far
 * through the chapter Read Aloud is. Hovering it thickens the bar into a draggable slider
 * (Spotify/YouTube-style) — hovering OR dragging shows a "Verse N" magnifying-glass bubble above
 * the cursor's position and seeks on release. Verse-granularity, not char-granularity: that's
 * the only seek precision the engine actually supports (see ttsEngine.ts's skipToVerse), and
 * it's what a Bible reader wants to jump between anyway.
 *
 * The bubble is rendered via a `document.body` portal, `position: fixed` — NOT as an
 * absolutely-positioned child of the player card. The card has `overflow-hidden` (needed for
 * its own expand/collapse animation), which was silently clipping the bubble any time it would
 * render outside the card's narrow bounds (which was often).
 *
 * Position is deliberately NOT tracked from raw mouse clientX coordinates captured inside event
 * handlers (the previous approach) — that meant the bubble's X could drift slightly out of sync
 * with the actual snapped verse position/fill-bar edge it was reporting, and depended on the
 * right event firing at the right time to ever update at all. Instead, a layout effect
 * recomputes the bubble's position directly from the bar's OWN current rect plus `fraction` —
 * the exact same value driving the filled bar's width — every time hovering/dragging/fraction
 * changes. This guarantees the bubble always points at exactly the same spot as the visible
 * fill edge, self-corrects on every relevant change instead of relying on one-shot event
 * coordinates, and needs no manual "seed the position on enter" workaround.
 */
export default function ChapterProgressBar({ bookId, chapter, textId, currentVerseNum, endVerseNum, onSeek, active = false }: ChapterProgressBarProps) {
  const { verses, currentIdx, fraction: currentFraction } = useChapterProgress(bookId, chapter, textId, currentVerseNum, endVerseNum)
  const [hovering, setHovering] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const showingPreview = (hovering || dragging) && previewIdx != null
  const activeIdx = showingPreview ? previewIdx! : currentIdx
  const fraction = showingPreview && verses && verses.length > 1 ? previewIdx! / (verses.length - 1) : currentFraction
  // Thickness/interactivity follows the PARENT's expanded state (see the `active` prop doc
  // comment) — `hovering`/`dragging` below are still tracked locally, but purely to gate the
  // magnify bubble specifically (showing it any time the pill is merely expanded, even nowhere
  // near the bar, would be noisy).
  const expanded = active || hovering || dragging

  // Kept fresh every render (cheap) so the rAF loop below always reads the CURRENT fraction
  // without needing to restart the loop every time it changes.
  const fractionRef = useRef(fraction)
  fractionRef.current = fraction

  // Recomputes the bubble's fixed-viewport position from the bar's CURRENT rect every animation
  // frame, for as long as hovering/dragging is true — see the file-level doc comment for why
  // this replaced clientX-based tracking. A single-shot effect (the previous attempt) still
  // wasn't reliable: the bar can still be settling from the PARENT pill's own expand animation
  // (framer-motion's `layout` FLIP transform) at the exact moment hovering starts, so a rect
  // read taken once, right then, can be stale. Polling every frame for the duration of the
  // hover/drag makes this self-correcting regardless of any other animation's timing — it keeps
  // re-measuring and re-placing the bubble until it's provably right, rather than betting on one
  // measurement being taken at exactly the right moment.
  useEffect(() => {
    if (!hovering && !dragging) return
    let rafId: number
    const tick = () => {
      const el = barRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        const pad = 28 // keep the round bubble's edges fully on-screen
        const rawX = rect.left + fractionRef.current * rect.width
        const x = Math.min(rect.right - pad, Math.max(rect.left + pad, rawX))
        const y = Math.max(pad, rect.top - 14) // sit just above the bar, clamped off the top edge
        setBubblePos({ x, y })
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [hovering, dragging])

  if (!verses || verses.length === 0) return null

  function idxFromClientX(clientX: number): number {
    const el = barRef.current
    if (!el || !verses) return currentIdx
    const rect = el.getBoundingClientRect()
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0
    return Math.round(frac * (verses.length - 1))
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setPreviewIdx(idxFromClientX(e.clientX))
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setPreviewIdx(idxFromClientX(e.clientX))
  }
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging && previewIdx != null && verses) onSeek(verses[previewIdx].verse_num)
    setDragging(false)
    setPreviewIdx(null)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }
  function handleMouseEnter(e: React.MouseEvent<HTMLDivElement>) {
    setHovering(true)
    setPreviewIdx(idxFromClientX(e.clientX))
  }
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    // Pointer capture keeps drag events flowing to this element even once the cursor leaves its
    // bounds — don't let a plain mousemove (which DOES respect real bounds) fight that.
    if (dragging) return
    setHovering(true)
    setPreviewIdx(idxFromClientX(e.clientX))
  }
  function handleMouseLeave() {
    if (dragging) return // pointer capture may keep dragging going outside the bar's own bounds
    setHovering(false)
    setPreviewIdx(null)
  }

  const bubbleVerseNum = verses[activeIdx]?.verse_num

  return (
    <div
      className="relative px-3 pt-2.5 pb-1 select-none"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {/* Gated on local hovering/dragging specifically (not `expanded`, which also goes true
              from the parent pill alone) — otherwise the bubble would pop up any time the whole
              player is hovered, regardless of whether the cursor is anywhere near the bar. */}
          {(hovering || dragging) && bubblePos && bubbleVerseNum != null && (
            <motion.div
              key="verse-magnify-bubble"
              // x/y here are NOT plain CSS — once `initial`/`animate`/`exit` animate `scale`,
              // framer-motion takes over the element's `transform` property entirely via its own
              // motion-value pipeline, and per-frame overwrites the DOM node's inline style with
              // ONLY what it's tracking (scale) — a separate raw `transform: 'translate(...)'`
              // string in `style` below got silently dropped the instant the enter animation
              // ticked, so the bubble rendered anchored at its own top-left corner at (x,y)
              // instead of bottom-center ABOVE it — it never actually sat above the bar as
              // intended, reported repeatedly as "still isn't showing above the progress bar."
              // framer-motion composes `x`/`y` (given as percentages of the element's own size,
              // same semantics as a CSS translate) together with `scale` into ONE transform per
              // frame when they're set through its own props/style instead of a static string —
              // that's the supported way to combine a translate offset with an animated value.
              initial={{ x: '-50%', y: '-100%', scale: 0.5, opacity: 0 }}
              animate={{ x: '-50%', y: '-100%', scale: 1, opacity: 1 }}
              exit={{ x: '-50%', y: '-100%', scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              // Soft radial gradient + layered shadow (rather than a flat surface-2 fill) so the
              // bubble reads as "floating above" the bar instead of "pasted on" — plus a small
              // speech-bubble tail (below) pointing down at the exact bar position it reports.
              className="fixed z-[9999] pointer-events-none flex items-center justify-center rounded-full border border-[rgb(var(--color-surface-4))]"
              style={{
                left: bubblePos.x, top: bubblePos.y,
                width: 44, height: 44,
                background: 'radial-gradient(circle at 32% 28%, rgb(var(--color-surface-3)), rgb(var(--color-surface-1)) 75%)',
                boxShadow: '0 10px 28px -6px rgba(0,0,0,0.4), 0 3px 10px -2px rgba(0,0,0,0.25)',
              }}
            >
              {/* Tail: a rotated square, half-hidden behind the circle's bottom edge, sharing the
                  circle's border on its visible (lower-right) edges so it reads as one continuous
                  callout shape rather than a separate floating diamond. */}
              <span
                className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 border-r border-b border-[rgb(var(--color-surface-4))]"
                style={{ background: 'rgb(var(--color-surface-1))' }}
              />
              <span className="relative text-[15px] font-semibold text-[rgb(var(--color-text-primary))] tabular-nums">
                {bubbleVerseNum}
              </span>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative w-full rounded-full bg-[rgb(var(--color-surface-4))] cursor-pointer transition-[height] duration-150 ${expanded ? 'h-2' : 'h-[3px]'}`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[rgb(var(--color-accent))] transition-[width] duration-150"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}
