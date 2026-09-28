/**
 * Hybrid logical clock (docs/mobile/icloud.md §3–4).
 *
 * An HLC timestamp is `<wallMs 13 digits>-<counter 4 hex>-<deviceId>`; string comparison gives a
 * total order that respects causality across devices with skewed clocks: a device never issues a
 * timestamp below anything it has already seen (received timestamps advance the local clock), and
 * concurrent events on different devices are ordered by wall time, then counter, then device id.
 */
export interface Hlc {
  wallMs: number
  counter: number
  deviceId: string
}

export const HLC_ZERO = '0000000000000-0000-'

export function formatHlc(h: Hlc): string {
  return `${String(h.wallMs).padStart(13, '0')}-${h.counter.toString(16).padStart(4, '0')}-${h.deviceId}`
}

export function parseHlc(s: string): Hlc {
  const m = /^(\d{13})-([0-9a-f]{4})-(.*)$/.exec(s)
  if (!m) throw new Error(`invalid HLC: ${s}`)
  return { wallMs: Number(m[1]), counter: parseInt(m[2], 16), deviceId: m[3] }
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Maximum a wall clock may run ahead of the latest observed HLC before it is clamped (§9). */
export const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000

export class HybridLogicalClock {
  private wallMs = 0
  private counter = 0
  readonly deviceId: string
  private readonly now: () => number
  private readonly onDrift?: (aheadMs: number) => void

  constructor(deviceId: string, opts: { now?: () => number; last?: string; onDrift?: (aheadMs: number) => void } = {}) {
    if (!deviceId || deviceId.includes('-')) throw new Error('HLC deviceId must be non-empty and contain no "-"')
    this.deviceId = deviceId
    this.now = opts.now ?? (() => Date.now())
    this.onDrift = opts.onDrift
    if (opts.last) {
      const p = parseHlc(opts.last)
      this.wallMs = p.wallMs
      this.counter = p.counter
    }
  }

  /** Timestamp for a local event. */
  tick(): string {
    let wall = this.now()
    if (wall > this.wallMs + MAX_CLOCK_DRIFT_MS && this.wallMs > 0) {
      this.onDrift?.(wall - this.wallMs)
      wall = this.wallMs + MAX_CLOCK_DRIFT_MS
    }
    if (wall > this.wallMs) {
      this.wallMs = wall
      this.counter = 0
    } else {
      this.counter += 1
      if (this.counter > 0xffff) { this.wallMs += 1; this.counter = 0 }
    }
    return formatHlc({ wallMs: this.wallMs, counter: this.counter, deviceId: this.deviceId })
  }

  /** Advance past a timestamp received from another device (call before/after applying its op). */
  receive(remote: string): void {
    const r = parseHlc(remote)
    const wall = this.now()
    if (r.wallMs > wall + MAX_CLOCK_DRIFT_MS) {
      // A remote clock absurdly ahead must not drag ours into the future; keep our own time.
      this.onDrift?.(r.wallMs - wall)
      return
    }
    if (r.wallMs > this.wallMs) {
      this.wallMs = r.wallMs
      this.counter = r.counter
    } else if (r.wallMs === this.wallMs && r.counter > this.counter) {
      this.counter = r.counter
    }
  }

  /** The latest timestamp issued or received (persist this in sync_state and pass as `last`). */
  latest(): string {
    return formatHlc({ wallMs: this.wallMs, counter: this.counter, deviceId: this.deviceId })
  }
}
