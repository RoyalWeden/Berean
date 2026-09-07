import { describe, it, expect } from 'vitest'
import { rubberBand, provesLiveInput, maxStretchFor, completeAtFor, CHAPTER_PULL } from '../useChapterPullNav'

/**
 * The chapter-pull gesture went through eight rounds of "this doesn't feel right" with no test
 * coverage at all, which is exactly how each fix managed to re-break an earlier one. These cover
 * the two invariants the whole design rests on.
 */

describe('rubberBand', () => {
  const H = 900

  it('is zero at rest and never negative', () => {
    expect(rubberBand(0, H)).toBe(0)
    expect(rubberBand(-50, H)).toBe(0)
  })

  it('is monotonically increasing in travel', () => {
    let prev = -1
    for (let t = 0; t <= 3000; t += 25) {
      const o = rubberBand(t, H)
      expect(o).toBeGreaterThan(prev)
      prev = o
    }
  })

  it('resists: offset always falls short of raw travel, increasingly so', () => {
    expect(rubberBand(100, H)).toBeLessThan(100)
    expect(rubberBand(1000, H)).toBeLessThan(1000)
    // Ratio of returned motion to finger motion keeps shrinking.
    const r1 = rubberBand(100, H) / 100
    const r2 = rubberBand(500, H) / 500
    const r3 = rubberBand(2000, H) / 2000
    expect(r2).toBeLessThan(r1)
    expect(r3).toBeLessThan(r2)
  })

  it('gets progressively harder — every further 100px of finger buys less movement', () => {
    // The point of the tightened asymptote: the gesture lives in the bend of the curve, not its
    // nearly-linear foot, so it firms up noticeably as you pull further.
    const gains = [0, 100, 200, 300, 400, 500, 600].map((t) => rubberBand(t + 100, H) - rubberBand(t, H))
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1])
    // And the falloff is steep, not a token amount: the last 100px of finger buys well under
    // half what the first 100px did.
    expect(gains[gains.length - 1]).toBeLessThan(gains[0] * 0.5)
  })

  it('can never be dragged past its ceiling however hard you pull', () => {
    const cap = maxStretchFor(H)
    expect(rubberBand(100000, H)).toBeLessThan(cap)
    expect(rubberBand(100000, H)).toBeGreaterThan(cap * 0.9)
    // The ceiling is a fraction of the reader, not the whole thing — a browser doesn't let you
    // drag a page half off the screen either.
    expect(cap).toBeLessThan(H * 0.5)
  })

  it('is stateless in travel, so pulling back retraces the way out exactly', () => {
    // This is why cancelling feels right: offset depends only on accumulated travel, never on
    // the path taken to get there. The previous velocity-damped version was path-dependent.
    const out = [0, 40, 120, 260, 430].map((t) => rubberBand(t, H))
    const back = [430, 260, 120, 40, 0].map((t) => rubberBand(t, H))
    expect(back).toEqual([...out].reverse())
  })

  it('scales with the reader height, so the feel is the same in any panel size', () => {
    expect(rubberBand(300, 1200)).toBeGreaterThan(rubberBand(300, 600))
  })
})

describe('provesLiveInput — the guard between a flick and an unwanted chapter change', () => {
  /** A macOS momentum tail: continuous (~8ms apart) and monotonically decaying. */
  function momentumTail(peak: number, events: number) {
    const out: { gap: number; mag: number }[] = []
    let mag = peak
    for (let i = 0; i < events; i++) {
      out.push({ gap: 8, mag })
      mag *= 0.94 // decay, never grows
    }
    return out
  }

  function feed(seq: { gap: number; mag: number }[]) {
    let live = false
    let maxMag = 0
    for (const { gap, mag } of seq) {
      if (!live && provesLiveInput(gap, mag, maxMag)) live = true
      maxMag = Math.max(maxMag, mag)
    }
    return live
  }

  it('never fires for a pure decaying momentum stream, however long', () => {
    // The headline invariant: a flick must not be able to navigate.
    expect(feed(momentumTail(100, 200))).toBe(false)
    expect(feed(momentumTail(40, 400))).toBe(false)
    expect(feed(momentumTail(250, 60))).toBe(false)
  })

  it('never fires for momentum that decays slowly enough to look deliberate', () => {
    const slowDecay = Array.from({ length: 300 }, (_, i) => ({ gap: 8, mag: 60 * Math.pow(0.995, i) }))
    expect(feed(slowDecay)).toBe(false)
  })

  it('fires as soon as a delta grows — fingers accelerate, inertia cannot', () => {
    const push = [
      { gap: 8, mag: 10 },
      { gap: 8, mag: 9 },
      { gap: 8, mag: 14 }, // grew past 10 * 1.15
    ]
    expect(feed(push)).toBe(true)
  })

  it('fires on a pause — inertia never stops and restarts', () => {
    expect(feed([{ gap: 8, mag: 30 }, { gap: 8, mag: 26 }, { gap: 200, mag: 20 }])).toBe(true)
  })

  it('fires for a discrete mouse wheel, which has no momentum or release at all', () => {
    // Notches arrive far apart, so the gap test carries it.
    const notches = Array.from({ length: 4 }, () => ({ gap: 140, mag: 100 }))
    expect(feed(notches)).toBe(true)
  })

  it('fires for a sustained two-finger push with ordinary jitter', () => {
    // A real drag is never perfectly monotonic; natural variation proves it live quickly.
    const jitter = [12, 11, 13, 12, 15, 14, 16]
    expect(feed(jitter.map((mag) => ({ gap: 8, mag })))).toBe(true)
  })

  it('treats the very first event as inconclusive rather than live', () => {
    // Nothing to compare against yet, and no gap, so a coast's first event proves nothing.
    expect(provesLiveInput(8, 120, 0)).toBe(false)
  })
})

describe('progress reported to the banner', () => {
  // Mirrors publish() in the hook.
  const progressFor = (offset: number, h: number) => {
    const span = Math.max(1, completeAtFor(h) - CHAPTER_PULL.INDICATOR_AT)
    return Math.max(0, Math.min(1, (offset - CHAPTER_PULL.INDICATOR_AT) / span))
  }

  it('starts at zero exactly when the banner first appears', () => {
    // Regression: progress used to be offset/commitPoint, so the bar was already ~40% full the
    // instant it faded in.
    expect(progressFor(CHAPTER_PULL.INDICATOR_AT, 900)).toBe(0)
  })

  it('reaches one exactly at the commit point', () => {
    expect(progressFor(completeAtFor(900), 900)).toBe(1)
  })

  it('is monotonic and clamped either side', () => {
    expect(progressFor(0, 900)).toBe(0)
    expect(progressFor(10_000, 900)).toBe(1)
    expect(progressFor(120, 900)).toBeGreaterThan(progressFor(90, 900))
  })
})

describe('gesture origin — a swipe that ran into the end must not turn the page', () => {
  // Mirrors the canCommit decision in applyDelta.
  const canCommit = (dir: 'prev' | 'next', start: { top: boolean; bottom: boolean } | null) =>
    !start ? false : dir === 'prev' ? start.top : start.bottom

  it('allows a pull that began already parked at the matching edge', () => {
    expect(canCommit('next', { top: false, bottom: true })).toBe(true)
    expect(canCommit('prev', { top: true, bottom: false })).toBe(true)
  })

  it('refuses a swipe that began mid-chapter and merely reached the end', () => {
    expect(canCommit('next', { top: false, bottom: false })).toBe(false)
    expect(canCommit('prev', { top: false, bottom: false })).toBe(false)
  })

  it('refuses a pull toward the end you did NOT start against', () => {
    expect(canCommit('next', { top: true, bottom: false })).toBe(false)
    expect(canCommit('prev', { top: false, bottom: true })).toBe(false)
  })

  it('allows both directions on a chapter short enough to need no scrolling', () => {
    // atTop and atBottom are both true when there is nothing to scroll.
    expect(canCommit('next', { top: true, bottom: true })).toBe(true)
    expect(canCommit('prev', { top: true, bottom: true })).toBe(true)
  })

  it('refuses when no gesture start was ever recorded', () => {
    expect(canCommit('next', null)).toBe(false)
  })
})

describe('commit threshold', () => {
  it('stays in fixed proportion to the band, so the effort feels the same in any panel size', () => {
    for (const h of [400, 700, 900, 1400, 3000]) {
      expect(completeAtFor(h) / maxStretchFor(h)).toBeCloseTo(CHAPTER_PULL.COMPLETE_OF_STRETCH, 6)
    }
  })

  it('clamps the band for very small and very large readers', () => {
    expect(maxStretchFor(300)).toBe(CHAPTER_PULL.STRETCH_MIN)
    expect(maxStretchFor(3000)).toBe(CHAPTER_PULL.STRETCH_MAX)
  })

  it('sits inside the reachable part of the curve, never up against the asymptote', () => {
    // If commit were too near the ceiling it would cost near-infinite effort to reach.
    for (const h of [400, 900, 1400]) {
      expect(completeAtFor(h)).toBeLessThan(maxStretchFor(h) * 0.6)
    }
  })

  const travelToCommit = (h: number) => {
    let travel = 0
    while (rubberBand(travel, h) < completeAtFor(h) && travel < 100000) travel += 1
    return travel
  }

  it('needs a deliberate, sustained drag — but one that fits in a single stroke', () => {
    const H = 900
    const travel = travelToCommit(H)
    // Resistance means the finger moves several times further than the gap opens. Kept as a
    // floor on the *property* (this is a firm pull, not a nudge) rather than a snapshot of the
    // current tuning, so ordinary feel adjustments don't trip it.
    expect(travel).toBeGreaterThan(completeAtFor(H) * 3.5)
    // Still reachable without a second stroke (which would release and spring home in between).
    expect(travel).toBeLessThan(800)
  })

  it('gives the banner a long, useful life rather than appearing near the end', () => {
    const H = 900
    let appearsAt = 0
    while (rubberBand(appearsAt, H) < CHAPTER_PULL.INDICATOR_AT && appearsAt < 100000) appearsAt += 1
    const commitsAt = travelToCommit(H)
    // From first sight of the banner to commit should be most of the gesture, so the progress
    // bar has room to actually read as progress.
    expect(commitsAt - appearsAt).toBeGreaterThan(commitsAt * 0.5)
  })

  it('costs a comparable stroke at every reader size', () => {
    const travels = [500, 900, 1400].map(travelToCommit)
    expect(Math.max(...travels) / Math.min(...travels)).toBeLessThan(2)
  })
})
