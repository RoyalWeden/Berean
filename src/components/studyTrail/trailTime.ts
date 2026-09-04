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

// Log-scaled spine-segment height: near-instant follow-ups stay at a fixed floor, a 40min gap
// visibly opens up, long gaps hit a ceiling rather than blowing out the layout.
//
// Floor and ceiling trimmed (36 -> 24, 104 -> 76) per direct feedback: "i think the gaps can be
// decreased a bit". They had been raised twice in earlier rounds to make a main-spine hop read as
// roomier than a tangent's stacking — but that was while the type was small; now that the map's
// text and bullets are larger, the same separation is carried by the rows themselves and the old
// values just pushed content off screen. The RATIO between a short and a long gap is unchanged,
// so a break in time still reads as one.
export function gapSegmentHeight(gapMs: number): number {
  const minutes = gapMs / 60_000
  return Math.min(76, Math.max(24, 24 + 8 * Math.log2(1 + minutes)))
}

// Below this, the gap stays implicit (just the slightly taller segment) — showing a chip for
// every few-minute gap would make the trail chatty rather than legible.
export const GAP_CHIP_THRESHOLD_MS = 20 * 60_000

// Fixed "revisit within" window — a chapter re-arrival inside this span of real elapsed time
// still renders as a REVISIT (dashed backlink + badge) rather than a fresh independent bullet;
// past it, it reads as an unrelated new visit. Used to be a user-facing slider (1h–168h) in
// StudyTrailApp.tsx's title bar; per direct feedback that control was useless UI and got
// removed outright, with this constant taking over as the always-on default. 24h was the
// slider's own previous default (a same-day return still reads as "revisiting," a return after
// several days usually doesn't) — carried forward unchanged rather than picked fresh, since it
// was already tuned to the intended behavior, just via a control nobody needed to touch. Never
// persisted to settings.json (the slider's value lived in local component state only), so there
// is no old on-disk value to migrate away from.
export const DEFAULT_REVISIT_WINDOW_MS = 24 * 3_600_000

export function formatGap(gapMs: number): string {
  const minutes = gapMs / 60_000
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 48) return `${Math.round(hours)}h`
  const days = hours / 24
  return days >= 2 ? `${Math.round(days)}d` : `${Math.round(hours)}h`
}
