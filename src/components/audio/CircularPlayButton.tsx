import { Play, Pause, CheckCircle2 } from 'lucide-react'

interface CircularPlayButtonProps {
  fraction: number
  isPaused: boolean
  finished: boolean
  onToggle: () => void
}

const SIZE = 38
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Idle (non-hovered) Read Aloud pill: a small circular play/pause button with a thin progress
 * ring traced around its edge showing position in the chapter — the "genuinely minimal" idle
 * state from the pill redesign, replacing the old always-horizontal-capsule pattern. No skip
 * buttons, no label, no X here; those only appear in AudioPlayer's hover-expanded pill.
 *
 * Ring math (fraction -> stroke-dashoffset) is driven by the SAME `useChapterProgress()` hook
 * ChapterProgressBar.tsx uses for its own bar fill, so the two never disagree about position.
 */
export default function CircularPlayButton({ fraction, isPaused, finished, onToggle }: CircularPlayButtonProps) {
  const clamped = Math.min(1, Math.max(0, fraction))
  const offset = CIRCUMFERENCE * (1 - clamped)

  return (
    <button
      onClick={onToggle}
      className="relative flex items-center justify-center rounded-full bg-[rgb(var(--color-accent))] text-white cursor-pointer hover:opacity-90 active:scale-95 transition-all shadow-sm"
      style={{ width: SIZE, height: SIZE }}
      title={finished ? 'Finished' : isPaused ? 'Resume' : 'Pause'}
    >
      {/* -rotate-90 so the ring's 0% point is at 12 o'clock instead of SVG's default 3 o'clock,
          matching the mental model of a clock/progress dial. */}
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 -rotate-90 pointer-events-none">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
          fill="none" stroke="white" strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      {finished ? (
        <CheckCircle2 size={15} />
      ) : isPaused ? (
        <Play size={14} className="translate-x-[1px]" />
      ) : (
        <Pause size={14} />
      )}
    </button>
  )
}
