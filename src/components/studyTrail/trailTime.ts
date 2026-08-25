import type { TrailPausedInterval } from '@/types/studyTrail'

// Time-gap math shared by MapView/EverythingView — see the design spec's §1 ("the spine
// breathes"). A gap is the elapsed time between one node's anchor closing and the next one's
// anchor opening, with any paused-interval overlap subtracted out (a 20-minute pause between
// two chapters shouldn't visually read as "20 minutes of thinking about it").
export function effectiveGapMs(prevEndedAt: number, nextStartedAt: number, pausedIntervals: TrailPausedInterval[]): number {
  let raw = nextStartedAt - prevEndedAt
  if (raw <= 0) return 0
  for (const p of pausedIntervals) {
    const pausedEnd = p.resumedAt ?? nextStartedAt
    const overlapStart = Math.max(prevEndedAt, p.pausedAt)
    const overlapEnd = Math.min(nextStartedAt, pausedEnd)
    if (overlapEnd > overlapStart) raw -= (overlapEnd - overlapStart)
  }
  return Math.max(0, raw)
}

// Log-scaled spine-segment height: near-instant follow-ups stay tight (18px), a 40min gap
// visibly opens up, multi-hour/day gaps hit a 96px ceiling rather than blowing out the layout.
export function gapSegmentHeight(gapMs: number): number {
  const minutes = gapMs / 60_000
  return Math.min(96, Math.max(18, 18 + 10 * Math.log2(1 + minutes)))
}

// Below this, the gap stays implicit (just the slightly taller segment) — showing a chip for
// every few-minute gap would make the trail chatty rather than legible.
export const GAP_CHIP_THRESHOLD_MS = 20 * 60_000

export function formatGap(gapMs: number): string {
  const minutes = gapMs / 60_000
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 48) return `${Math.round(hours)}h`
  const days = hours / 24
  return days >= 2 ? `${Math.round(days)}d` : `${Math.round(hours)}h`
}
